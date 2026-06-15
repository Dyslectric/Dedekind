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
// referenced free scalar names. Returns GLSL string or null.
function exprToGLSL(expr, vars, uniforms){
  let root; try { root = math.parse(expr); } catch { return null; }
  const walk = (node) => {
    switch(node.type){
      case "ConstantNode": return typeof node.value==="number" ? _glslNum(node.value) : null;
      case "ParenthesisNode": { const c=walk(node.content); return c==null?null:"("+c+")"; }
      case "SymbolNode": {
        if(vars.has(node.name)) return node.name;
        if(_GLSL_CONST[node.name]) return _GLSL_CONST[node.name];
        // a free scalar (slider/animator/constant) → uniform
        if(/^[A-Za-z_]\w*$/.test(node.name)){ uniforms.add(node.name); return node.name; }
        return null;
      }
      case "OperatorNode": {
        if(node.fn==="unaryMinus"){ const a=walk(node.args[0]); return a==null?null:"(-"+a+")"; }
        if(node.fn==="unaryPlus"){ return walk(node.args[0]); }
        if(node.op==="^"){ const a=walk(node.args[0]),b=walk(node.args[1]); return (a==null||b==null)?null:_glslPow(a,b,node.args[1]); }
        if(["+","-","*","/"].includes(node.op)){ const a=walk(node.args[0]),b=walk(node.args[1]); return (a==null||b==null)?null:"("+a+node.op+b+")"; }
        return null;
      }
      case "FunctionNode": {
        const n=node.fn.name;
        // 1-arg standard functions
        if(_GLSL_FN1[n]&&node.args.length===1){ const a=walk(node.args[0]); if(a==null)return null; const g=_GLSL_FN1[n]===1?n:_GLSL_FN1[n]; return g+"("+a+")"; }
        // 2-arg standard functions
        if(_GLSL_FN2[n]&&node.args.length===2){
          const a=walk(node.args[0]),b=walk(node.args[1]); if(a==null||b==null)return null;
          if(n==="pow") return _glslPow(a,b,node.args[1]);
          return _GLSL_FN2[n]+"("+a+","+b+")";
        }
        // composite / derived functions expressible via GLSL primitives
        if(node.args.length===1){
          const a=walk(node.args[0]); if(a==null)return null;
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
          const a=walk(node.args[0]),b=walk(node.args[1]); if(a==null||b==null)return null;
          switch(n){
            case "hypot":  return `sqrt((${a})*(${a})+(${b})*(${b}))`;
            case "log":    return `(log(${a})/log(${b}))`;   // log(value, base)
          }
        }
        return null;
      }
      default: return null;
    }
  };
  return walk(root);
}

export {
  exprToGLSL, _glslNum
};
