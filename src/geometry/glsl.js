import * as math from "mathjs";

// ── GPU offload: expression → GLSL transpiler ────────────────────────────────
// Translates the subset of mathjs expressions that map cleanly to GLSL so that
// analytic surfaces (z=f(x,y), y=f(x), parametric x/y/z=f(u,v)) can be evaluated
// in a vertex shader on the GPU instead of CPU-sampling thousands of points.
// Returns null for anything unsupported (user functions, conditionals, unknown
// symbols) — callers then fall back to the CPU/worker path. Free scalar
// variables (sliders/animators) are passed in as uniforms.
const _GLSL_FN1 = { sin:1,cos:1,tan:1,asin:1,acos:1,atan:1,sinh:1,cosh:1,tanh:1,exp:1,log:1,sqrt:1,abs:1,floor:1,ceil:1,sign:1,fract:1,round:"floor" };
const _GLSL_FN2 = { pow:"pow",atan2:"atan",mod:"mod",min:"min",max:"max" };
const _GLSL_CONST = { pi:"3.141592653589793",e:"2.718281828459045",tau:"6.283185307179586",phi:"1.618033988749895" };
function _glslNum(v){ let s=String(v); if(!/[.eE]/.test(s)) s+=".0"; return s; }
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
        if(node.op==="^"){ const a=walk(node.args[0]),b=walk(node.args[1]); return (a==null||b==null)?null:"pow("+a+","+b+")"; }
        if(["+","-","*","/"].includes(node.op)){ const a=walk(node.args[0]),b=walk(node.args[1]); return (a==null||b==null)?null:"("+a+node.op+b+")"; }
        return null;
      }
      case "FunctionNode": {
        const n=node.fn.name;
        if(_GLSL_FN1[n]&&node.args.length===1){ const a=walk(node.args[0]); if(a==null)return null; const g=_GLSL_FN1[n]===1?n:_GLSL_FN1[n]; return g+"("+a+")"; }
        if(_GLSL_FN2[n]&&node.args.length===2){ const a=walk(node.args[0]),b=walk(node.args[1]); return (a==null||b==null)?null:_GLSL_FN2[n]+"("+a+","+b+")"; }
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
