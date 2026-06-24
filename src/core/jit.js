import * as math from "mathjs";

// ── Expression → native JS compiler ──────────────────────────────────────────
// Translates the arithmetic subset of mathjs expressions into a plain JS function
// so per-vertex sampling (rawGeom index meshes) skips mathjs's interpreted
// `.evaluate(scope)` entirely. Returns null for anything outside the subset
// (bounded operators ∑∏∫, conditionals, unknown constructs) so callers fall back
// to safeEval — results must match mathjs exactly or geometry would shift.
//
// The compiled function has signature  f(S, F, V)  where
//   S — scalar scope object (slider/constant values), looked up as S.name
//   F — function table (wired fnDefs), called as F.name(args…)
//   V — per-vertex variables { i, j, k, n, x, y, z, part }
// Names are classified at COMPILE time: a name in `fnNames` compiles to a call,
// a name in `vertexVars` to a V lookup, anything else to an S lookup.

// Single-arg functions that map to a Math.* call or a small helper.
const FN1 = {
  sin:"Math.sin", cos:"Math.cos", tan:"Math.tan",
  asin:"Math.asin", acos:"Math.acos", atan:"Math.atan",
  sinh:"Math.sinh", cosh:"Math.cosh", tanh:"Math.tanh",
  asinh:"Math.asinh", acosh:"Math.acosh", atanh:"Math.atanh",
  exp:"Math.exp", sqrt:"Math.sqrt", abs:"Math.abs",
  floor:"Math.floor", ceil:"Math.ceil", round:"Math.round",
  sign:"Math.sign", trunc:"Math.trunc", cbrt:"Math.cbrt",
  log2:"Math.log2", exp2:"__exp2", log10:"Math.log10", ln:"Math.log",
};
// Two-arg functions.
const FN2 = {
  pow:"Math.pow", atan2:"Math.atan2", min:"Math.min", max:"Math.max", hypot:"Math.hypot",
};
const CONST = { pi:"Math.PI", e:"Math.E", tau:"(2*Math.PI)", phi:"1.618033988749895" };

// Greek glyph → ASCII (mirrors core/math.js / glsl.js).
const _GREEK_JS = {
  "π":"pi","τ":"tau","φ":"phi","θ":"theta","α":"alpha","β":"beta","γ":"gamma",
  "λ":"lambda","μ":"mu","ω":"omega","σ":"sigma","δ":"delta","ρ":"rho","ε":"epsilon",
};
// Single-char constants always available as juxtaposition tokens.
const _JS_SINGLE_CONST = new Set(["e"]);   // 'i' is a vertex index here, in vertexVars
// Greedy longest tokenizer for a glued run. Splits `pi` first, then single
// tokens that are KNOWN: a vertex variable (i/j/k/n/x/y/z/u/v/part) or a
// single-char constant (e). A bare unknown letter is NOT a token — it could be
// part of a deliberately-named multi-letter scalar (e.g. a slider `rt` or `tw`),
// which must stay a single scope lookup, not split into r*t. Returns token names
// or null (→ leave the run as one symbol). `i`/`j`/`k`/`n` are vertex indices in
// this context (they're in vertexVars), not imaginary.
function _jsTokenizeRun(name, vertexVars){
  if(name.length<2 || !/^[A-Za-z]+$/.test(name)) return null;
  const toks=[]; let p=0;
  while(p<name.length){
    if(name.startsWith("pi",p)){ toks.push("pi"); p+=2; continue; }
    const c=name[p];
    if((vertexVars && vertexVars.has(c)) || _JS_SINGLE_CONST.has(c)){ toks.push(c); p+=1; continue; }
    return null;   // unknown letter → whole run stays one symbol (scope lookup)
  }
  return toks.length>=2 ? toks : null;
}
function _jsSplitJux(root, vertexVars, fnNames){
  return root.transform(function(n){
    if(n.isSymbolNode){
      const nm=n.name;
      // leave known whole names: vertex vars, constants, and wired fnDef names
      if((vertexVars && vertexVars.has(nm)) || (CONST[nm]) || (fnNames && fnNames.has(nm))) return n;
      const toks=_jsTokenizeRun(nm, vertexVars);
      if(toks){
        let acc=new math.SymbolNode(toks[0]);
        for(let i=1;i<toks.length;i++) acc=new math.OperatorNode("*","multiply",[acc,new math.SymbolNode(toks[i])]);
        return acc;
      }
    }
    return n;
  });
}

// Composite single-arg forms expressed inline.
function comp1(n, a){
  switch(n){
    case "square": return `(${a})*(${a})`;
    case "cube":   return `(${a})*(${a})*(${a})`;
    case "fract":  return `(${a}-Math.floor(${a}))`;
    case "sec":    return `(1/Math.cos(${a}))`;
    case "csc":    return `(1/Math.sin(${a}))`;
    case "cot":    return `(Math.cos(${a})/Math.sin(${a}))`;
    case "radians":return `(${a}*Math.PI/180)`;
    case "degrees":return `(${a}*180/Math.PI)`;
    default: return null;
  }
}
function comp2(n, a, b){
  switch(n){
    case "mod": return `(((${a})%(${b})+(${b}))%(${b}))`;   // mathjs mod is floored
    case "log": return `(Math.log(${a})/Math.log(${b}))`;    // log(value, base)
    case "step":return `((${a})<=(${b})?1:0)`;
    default: return null;
  }
}

// Translate one expression to a JS source string, or null if unsupported.
// `fnNames` / `vertexVars` are Sets used to classify SymbolNodes.
function exprToJS(expr, fnNames, vertexVars){
  let text = String(expr);
  for(const g in _GREEK_JS) if(text.indexOf(g)>=0) text = text.split(g).join(_GREEK_JS[g]);
  let root; try { root = math.parse(text); } catch { return null; }
  // Same juxtaposition rule as the other eval paths: a glued letter run splits
  // into a product of known tokens (vertex vars like i/j/k/n, plus pi/e). In this
  // per-vertex context `i` is the vertex index (a vertexVar), not imaginary.
  root = _jsSplitJux(root, vertexVars, fnNames);
  const walk = (node) => {
    switch(node.type){
      case "ConstantNode":
        return typeof node.value==="number" ? _num(node.value) : null;
      case "ParenthesisNode": { const c=walk(node.content); return c==null?null:"("+c+")"; }
      case "SymbolNode": {
        const nm=node.name;
        if(vertexVars.has(nm)) return "V."+nm;
        if(CONST[nm]) return CONST[nm];
        if(fnNames.has(nm)) return null;        // a function used as a bare symbol → unsupported
        if(/^[A-Za-z_]\w*$/.test(nm)) return "(S."+nm+")";  // free scalar (slider/const)
        return null;
      }
      case "OperatorNode": {
        if(node.fn==="unaryMinus"){ const a=walk(node.args[0]); return a==null?null:"(-"+a+")"; }
        if(node.fn==="unaryPlus"){ return walk(node.args[0]); }
        if(node.op==="^"){ const a=walk(node.args[0]),b=walk(node.args[1]); return (a==null||b==null)?null:_pow(a,b,node.args[1]); }
        if(["+","-","*","/"].includes(node.op)){
          const a=walk(node.args[0]),b=walk(node.args[1]);
          return (a==null||b==null)?null:"("+a+node.op+b+")";
        }
        if(node.op==="%"){ const a=walk(node.args[0]),b=walk(node.args[1]); return (a==null||b==null)?null:comp2("mod",a,b); }
        return null;
      }
      case "AccessorNode": {
        // 1-D array indexing: L[expr]. The object is a free scalar bound to an
        // array value (a list node); mathjs is 1-based, so the JS index is
        // trunc(expr)-1. Only a single numeric dimension is supported.
        const obj=walk(node.object); if(obj==null) return null;
        const idx=node.index;
        if(!idx || idx.type!=="IndexNode" || !idx.dimensions || idx.dimensions.length!==1) return null;
        const d=walk(idx.dimensions[0]); if(d==null) return null;
        return "("+obj+"[Math.trunc("+d+")-1])";
      }
      case "FunctionNode": {
        const n=node.fn.name;
        // wired fnDef call → F.name(args)
        if(fnNames.has(n)){
          const as=node.args.map(walk); if(as.some(a=>a==null)) return null;
          return "F."+n+"("+as.join(",")+")";
        }
        if(FN1[n] && node.args.length===1){ const a=walk(node.args[0]); return a==null?null:FN1[n]+"("+a+")"; }
        if(FN2[n] && node.args.length===2){ const a=walk(node.args[0]),b=walk(node.args[1]); return (a==null||b==null)?null:FN2[n]+"("+a+","+b+")"; }
        if(node.args.length===1){ const a=walk(node.args[0]); if(a==null)return null; const c=comp1(n,a); if(c!=null)return c; }
        if(node.args.length===2){ const a=walk(node.args[0]),b=walk(node.args[1]); if(a==null||b==null)return null; const c=comp2(n,a,b); if(c!=null)return c; }
        return null;
      }
      default: return null;
    }
  };
  return walk(root);
}

function _num(v){ return Number.isFinite(v) ? "("+v+")" : "NaN"; }

// Small integer powers expand to repeated multiply (matches JS exactly and is
// faster); everything else uses Math.pow (which matches mathjs for these cases).
function _pow(a, b, bNode){
  let k=null;
  if(bNode){
    if(bNode.type==="ConstantNode" && typeof bNode.value==="number") k=bNode.value;
    else if(bNode.type==="OperatorNode" && bNode.fn==="unaryMinus"
            && bNode.args[0]?.type==="ConstantNode" && typeof bNode.args[0].value==="number")
      k=-bNode.args[0].value;
  }
  if(k!=null && Number.isInteger(k) && Math.abs(k)<=8){
    if(k===0) return "1";
    const pos=Math.abs(k);
    const body="("+Array(pos).fill("("+a+")").join("*")+")";
    return k>0 ? body : "(1/"+body+")";
  }
  return "Math.pow("+a+","+b+")";
}

// Compile an expression to f(S,F,V) → number, or null if unsupported.
// Cached by (expr | fn-name-set) so repeated builds reuse the compiled fn.
const _jitCache = new Map();
function compileToJS(expr, fnNames, vertexVars){
  if(expr==null) return null;
  const key = String(expr)+"\u0001"+[...fnNames].sort().join(",");
  let hit=_jitCache.get(key);
  if(hit!==undefined) return hit;
  let fn=null;
  const src=exprToJS(String(expr), fnNames, vertexVars);
  if(src!=null){
    try{
      // __exp2 helper for exp2; everything else is Math.*
      const body="const __exp2=(x)=>Math.pow(2,x); return ("+src+");";
      fn=new Function("S","F","V", body);
    }catch{ fn=null; }
  }
  if(_jitCache.size>=4000){ const k0=_jitCache.keys().next().value; _jitCache.delete(k0); }
  _jitCache.set(key, fn);
  return fn;
}

export { compileToJS, exprToJS };
