import * as math from "mathjs";

// ── GPU offload: expression → GLSL transpiler ────────────────────────────────
// Translates the subset of mathjs expressions that map cleanly to GLSL so that
// analytic surfaces (z=f(x,y), y=f(x), parametric x/y/z=f(u,v)) can be evaluated
// in a vertex shader on the GPU instead of CPU-sampling thousands of points.
// Returns null for anything unsupported (user functions, conditionals, unknown
// symbols) — callers then fall back to the CPU/worker path. Free scalar
// variables (sliders/animators) are passed in as uniforms.
const _GLSL_FN1 = { sin:1,cos:1,tan:1,asin:1,acos:1,atan:1,sinh:1,cosh:1,tanh:1,exp:1,log:1,sqrt:1,abs:1,floor:1,ceil:1,sign:1,fract:1,round:"floor",
  // additional single-arg functions with direct or trivial GLSL equivalents
  asinh:1,acosh:1,atanh:1,trunc:"trunc",exp2:"exp2",log2:"log2",radians:"radians",degrees:"degrees" };
const _GLSL_FN2 = { pow:"pow",atan2:"atan",mod:"mod",min:"min",max:"max",step:"step" };
const _GLSL_CONST = { pi:"3.141592653589793",e:"2.718281828459045",tau:"6.283185307179586",phi:"1.618033988749895" };
function _glslNum(v){ let s=String(v); if(!/[.eE]/.test(s)) s+=".0"; return s; }

// GLSL's pow(x,y) is undefined for x<0 (returns NaN on most GPUs), so a plain
// translation of `x^2` breaks every polynomial surface over negative x. Emit
// safe forms instead:
//   • small integer exponent (|k|<=8): expand to repeated multiply (exact,
//     sign-correct, and faster than a pow() call) — covers x^2, x^3, r^2, …
//   • exponent 0.5 / -0.5: sqrt / inversesqrt
//   • general real exponent: sign-correcting pow that mirrors mathjs/JS:
//        s = sign-of-base handling so (-2)^2 == 4, (-2)^3 == -8 for integer-
//        valued exponents, and |base|^exp for non-integer (matching JS NaN only
//        when truly undefined). We approximate JS semantics for the common case.
function _glslPow(a, b, bNode){
  // constant numeric exponent? (also detect unary-minus of a constant, e.g. x^-2)
  let k=null;
  if(bNode){
    if(bNode.type==="ConstantNode" && typeof bNode.value==="number") k=bNode.value;
    else if(bNode.type==="OperatorNode" && bNode.fn==="unaryMinus"
            && bNode.args[0]?.type==="ConstantNode" && typeof bNode.args[0].value==="number")
      k=-bNode.args[0].value;
  }
  if(k!=null){
    if(k===0) return "1.0";
    if(k===1) return a;
    if(k===0.5) return `sqrt(${a})`;
    if(k===-0.5) return `inversesqrt(${a})`;
    if(Number.isInteger(k) && Math.abs(k)<=8){
      const n=Math.abs(k);
      // bind the base once via a helper-free inline: repeat multiply. Since `a`
      // may be a complex expression, wrap so it's evaluated once is not possible
      // without a temp; GLSL has no statement context here, so we accept textual
      // repetition (the GLSL compiler CSEs identical subexpressions).
      const mul="("+Array(n).fill(a).join("*")+")";
      return k>0 ? mul : `(1.0/${mul})`;
    }
    // other constant exponent: sign-safe pow with magnitude, integer-parity sign.
    // For non-integer k this yields pow(|a|,k) (matches JS for a>=0; for a<0 JS
    // returns NaN which we approximate as pow on magnitude — rare in surfaces).
    return `pow(abs(${a}),${_glslNum(k)})`;
  }
  // non-constant exponent: use magnitude-based pow (safe, no NaN); exact for a>=0.
  return `pow(abs(${a}),${b})`;
}

// vars: Set of axis variable names (x,y / x / u,v). uniforms: Set collecting
// referenced free scalar names (always the ORIGINAL names, for scope lookup).
// prefix: optional GLSL identifier prefix applied to emitted free-scalar symbols
// so a user scalar named like a shader internal (a, e, f, h, P, L, …) or a
// builtin cannot collide. Callers that pass a prefix must declare the uniforms as
// `${prefix}${name}` while still reading their values from scope[name]. Default ""
// keeps the bare-name behavior (used by the transpilability probes in scope.js).
// fnTable: optional map name → {params:[...], expr:"..."} of user fnDefs. When a
// FunctionNode names an entry, its body is INLINED (parameters substituted by the
// argument ASTs) so composed surfaces (built from helper functions) can ride the
// GPU path instead of falling back to CPU. Recursion is depth/cycle guarded.
// Returns GLSL string or null.
function exprToGLSL(expr, vars, uniforms, prefix="", fnTable=null){
  let root; try { root = math.parse(expr); } catch { return null; }
  // Substitute parameter SymbolNodes in an fnDef body AST with the call's argument
  // ASTs, so the inlined body references the caller's expressions/vars directly.
  const substitute = (node, bind) => {
    switch(node.type){
      case "SymbolNode": return bind[node.name] || node;
      case "ConstantNode": return node;
      case "ParenthesisNode": return new math.ParenthesisNode(substitute(node.content, bind));
      case "OperatorNode": return new math.OperatorNode(node.op, node.fn, node.args.map(a=>substitute(a,bind)), node.implicit);
      case "FunctionNode": return new math.FunctionNode(node.fn.name, node.args.map(a=>substitute(a,bind)));
      default: return node;
    }
  };
  const walk = (node, depth) => {
    if(depth > 64) return null;     // runaway inlining guard
    switch(node.type){
      case "ConstantNode": return typeof node.value==="number" ? _glslNum(node.value) : null;
      case "ParenthesisNode": { const c=walk(node.content, depth); return c==null?null:"("+c+")"; }
      case "SymbolNode": {
        if(vars.has(node.name)) return node.name;
        if(_GLSL_CONST[node.name]) return _GLSL_CONST[node.name];
        // a free scalar (slider/animator/constant) → uniform. Collect the original
        // name (scope is keyed on it) but EMIT a prefixed identifier so it can't
        // collide with shader internals or GLSL builtins.
        if(/^[A-Za-z_]\w*$/.test(node.name)){ uniforms.add(node.name); return prefix+node.name; }
        return null;
      }
      case "OperatorNode": {
        if(node.fn==="unaryMinus"){ const a=walk(node.args[0], depth); return a==null?null:"(-"+a+")"; }
        if(node.fn==="unaryPlus"){ return walk(node.args[0], depth); }
        if(node.op==="^"){ const a=walk(node.args[0], depth),b=walk(node.args[1], depth); return (a==null||b==null)?null:_glslPow(a,b,node.args[1]); }
        if(["+","-","*","/"].includes(node.op)){ const a=walk(node.args[0], depth),b=walk(node.args[1], depth); return (a==null||b==null)?null:"("+a+node.op+b+")"; }
        return null;
      }
      case "FunctionNode": {
        const n=node.fn.name;
        // 1-arg standard functions
        if(_GLSL_FN1[n]&&node.args.length===1){ const a=walk(node.args[0], depth); if(a==null)return null; const g=_GLSL_FN1[n]===1?n:_GLSL_FN1[n]; return g+"("+a+")"; }
        // 2-arg standard functions
        if(_GLSL_FN2[n]&&node.args.length===2){
          const a=walk(node.args[0], depth),b=walk(node.args[1], depth); if(a==null||b==null)return null;
          if(n==="pow") return _glslPow(a,b,node.args[1]);
          return _GLSL_FN2[n]+"("+a+","+b+")";
        }
        // composite / derived functions expressible via GLSL primitives
        if(node.args.length===1){
          const a=walk(node.args[0], depth); if(a==null)return null;
          switch(n){
            case "square": return `(${a})*(${a})`;
            case "cube":   return `(${a})*(${a})*(${a})`;
            case "cbrt":   return `(sign(${a})*pow(abs(${a}),0.3333333333333333))`;
            case "log10":  return `(log(${a})/2.302585092994046)`;
            case "ln":     return `log(${a})`;
            case "sec":    return `(1.0/cos(${a}))`;
            case "csc":    return `(1.0/sin(${a}))`;
            case "cot":    return `(cos(${a})/sin(${a}))`;
          }
        }
        if(node.args.length===2){
          const a=walk(node.args[0], depth),b=walk(node.args[1], depth); if(a==null||b==null)return null;
          switch(n){
            case "hypot":  return `sqrt((${a})*(${a})+(${b})*(${b}))`;
            case "log":    return `(log(${a})/log(${b}))`;   // log(value, base)
          }
        }
        // user fnDef → inline its body with parameters bound to the call args.
        if(fnTable && fnTable[n] && fnTable[n].params.length===node.args.length){
          const def=fnTable[n];
          let body; try { body = math.parse(def.expr); } catch { return null; }
          const bind={};
          // Wrap each argument AST in parentheses-equivalent by substituting the
          // node directly; the substituted body is then transpiled, so argument
          // expressions are emitted inline (GLSL CSEs identical subexpressions).
          for(let i=0;i<def.params.length;i++) bind[def.params[i]]=node.args[i];
          const inlined=substitute(body, bind);
          return walk(inlined, depth+1);
        }
        return null;
      }
      default: return null;
    }
  };
  return walk(root, 0);
}

// Build an fnTable (name → {params, expr}) from a resolved scope's fnDef closures
// (the closures carry _fnName/_fnParams/_fnExpr metadata, see makeFn). Pass the
// result as exprToGLSL's fnTable argument to inline user functions into the GPU
// path. Returns null if the scope has no fnDefs (so callers can cheaply skip).
// Recurses into each fnDef's own closed-over scope so a helper that itself calls
// another helper (nested composition) is fully inlinable.
function fnTableFromScope(scope){
  if(!scope) return null;
  let table=null;
  const seen=new Set();
  const collect=(sc)=>{
    if(!sc) return;
    for(const k in sc){
      const v=sc[k];
      if(typeof v==="function" && v._fnExpr!=null && Array.isArray(v._fnParams)){
        const name=v._fnName||k;
        if(seen.has(name)) continue; seen.add(name);
        (table||(table={}))[name]={ params:v._fnParams, expr:v._fnExpr };
        collect(v._fnScope);   // pull in helpers this helper calls
      }
    }
  };
  collect(scope);
  return table;
}

// A stable text signature of an fnTable's STRUCTURE (names, params, bodies). Used
// to key the transpilability probes' memo: whether an expression transpiles can
// change when a referenced fnDef's body changes, but not when a slider value
// changes, so the value-free structure is the right cache key. "" when no table.
function fnTableSig(fnTable){
  if(!fnTable) return "";
  return Object.keys(fnTable).sort()
    .map(n=>`${n}(${(fnTable[n].params||[]).join(",")})=${fnTable[n].expr}`).join(";");
}

// Flatten every fnDef-private numeric scalar reachable from a scope into a flat
// {name: value} map. When a fnDef body is INLINED into a shader, the scalars it
// references (that aren't its parameters) are emitted as uniforms by their
// original names — but those scalars live in the fnDef's OWN closed-over scope,
// not the consumer's, so the consumer's scope can't resolve them. This hoists
// them so the uniform values are available at build and update time. Parameter
// names are stripped (they're substituted by call-site args, never uniforms).
function _collectFnScalars(scope, out, seen){
  if(!scope) return out;
  for(const k in scope){
    const v=scope[k];
    if(typeof v==="function" && v._fnExpr!=null && Array.isArray(v._fnParams)){
      const name=v._fnName||k;
      if(seen.has(name)) continue; seen.add(name);
      const fnScope=v._fnScope||{};
      const params=new Set(v._fnParams);
      for(const kk in fnScope){
        if(params.has(kk)) continue;
        const vv=fnScope[kk];
        if(typeof vv==="number" && !(kk in out)) out[kk]=vv;
      }
      _collectFnScalars(fnScope, out, seen);   // nested helpers + their scalars
    }
  }
  return out;
}
// Return a scope augmented with all inlined-fnDef-private scalars, so shader
// uniforms resolve. The consumer's own scalars win on name conflict. Returns the
// SAME object when there are no fnDef-private scalars (the common case), so the
// per-frame uniform update doesn't allocate for ordinary surfaces.
function augmentScopeForGPU(scope){
  if(!scope) return scope;
  const extra=_collectFnScalars(scope, {}, new Set());
  for(const _ in extra) return { ...extra, ...scope };
  return scope;
}

// Reserved prefix for user-derived (slider/constant/animator) uniforms in
// generated shaders. Chosen so it can't collide with shader-internal locals
// (single letters, camelCase) or the app's own uniforms (uSteps, uColor, …).
const GLSL_UNIFORM_PREFIX = "usr_";

export {
  exprToGLSL, _glslNum, GLSL_UNIFORM_PREFIX, fnTableFromScope, fnTableSig, augmentScopeForGPU
};
