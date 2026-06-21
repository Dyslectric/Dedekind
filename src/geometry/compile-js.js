import * as math from "mathjs";

// ─────────────────────────────────────────────────────────────────────────────
// Compile a math expression to a NATIVE JS closure for hot loops (flow
// integration, recurrences). mathjs's evaluate() walks a compiled tree and does
// a scope-map lookup per variable on every call; in an RK4 inner loop that runs
// thousands of times this dominates. Transpiling once to a plain JS function that
// takes the integration variables as direct arguments is ~6x faster.
//
// This mirrors exprToGLSL (same safe operator/function subset) but emits JS using
// Math.*. Free scalars (sliders/animators/constants) are read from a captured
// scope object at compile time and baked in as constants — correct because the
// flow rebuilds (recompiles) whenever a wired scalar changes, exactly as the GPU
// uniform path does. Returns null when the expression uses anything outside the
// supported subset, so callers fall back to safeEval.
// ─────────────────────────────────────────────────────────────────────────────

const FN1 = new Set([
  "sin","cos","tan","asin","acos","atan","sinh","cosh","tanh",
  "exp","log","sqrt","abs","sign","floor","ceil","round","cbrt",
]);
const FN2 = new Set(["atan2","pow","max","min","hypot","mod"]);
const CONST = { pi: "Math.PI", e: "Math.E", tau: "(2*Math.PI)" };

function num(v){
  if(!isFinite(v)) return null;
  // keep full precision; wrap negatives in parens at call sites via the operator walk
  return String(v);
}

// Build a JS expression string from a math node. `vars` are the closure's
// argument names (e.g. x,y,z). `scope` supplies values for any other symbol
// (free scalars), which are baked in as numeric literals. Returns null if
// anything unsupported appears.
function nodeToJS(node, vars, scope){
  switch(node.type){
    case "ConstantNode":
      return typeof node.value === "number" ? num(node.value) : null;
    case "ParenthesisNode": {
      const c = nodeToJS(node.content, vars, scope);
      return c == null ? null : "(" + c + ")";
    }
    case "SymbolNode": {
      if(vars.has(node.name)) return node.name;
      if(CONST[node.name]) return CONST[node.name];
      // a free scalar: bake its current value in
      const v = scope ? scope[node.name] : undefined;
      if(typeof v === "number" && isFinite(v)) return "(" + num(v) + ")";
      return null;
    }
    case "OperatorNode": {
      if(node.fn === "unaryMinus"){ const a = nodeToJS(node.args[0],vars,scope); return a==null?null:"(-"+a+")"; }
      if(node.fn === "unaryPlus"){ return nodeToJS(node.args[0],vars,scope); }
      if(node.op === "^"){ const a=nodeToJS(node.args[0],vars,scope),b=nodeToJS(node.args[1],vars,scope); return (a==null||b==null)?null:`Math.pow(${a},${b})`; }
      if(["+","-","*","/"].includes(node.op)){ const a=nodeToJS(node.args[0],vars,scope),b=nodeToJS(node.args[1],vars,scope); return (a==null||b==null)?null:"("+a+node.op+b+")"; }
      return null;
    }
    case "FunctionNode": {
      const n = node.fn.name;
      if(FN1.has(n) && node.args.length===1){
        const a = nodeToJS(node.args[0],vars,scope); if(a==null) return null;
        if(n==="cbrt") return `Math.cbrt(${a})`;
        return `Math.${n}(${a})`;
      }
      if(FN2.has(n) && node.args.length===2){
        const a=nodeToJS(node.args[0],vars,scope),b=nodeToJS(node.args[1],vars,scope); if(a==null||b==null) return null;
        if(n==="mod") return `(((${a})%(${b})+(${b}))%(${b}))`;  // true modulo
        if(n==="hypot") return `Math.hypot(${a},${b})`;
        return `Math.${n==="pow"?"pow":n}(${a},${b})`;
      }
      // composite one-arg forms
      if(node.args.length===1){
        const a=nodeToJS(node.args[0],vars,scope); if(a==null) return null;
        switch(n){
          case "square": return `((${a})*(${a}))`;
          case "cube":   return `((${a})*(${a})*(${a}))`;
          case "ln":     return `Math.log(${a})`;
          case "log10":  return `(Math.log(${a})/Math.LN10)`;
          case "log2":   return `(Math.log(${a})/Math.LN2)`;
          case "sec":    return `(1/Math.cos(${a}))`;
          case "csc":    return `(1/Math.sin(${a}))`;
          case "cot":    return `(Math.cos(${a})/Math.sin(${a}))`;
        }
      }
      if(node.args.length===2){
        const a=nodeToJS(node.args[0],vars,scope),b=nodeToJS(node.args[1],vars,scope); if(a==null||b==null) return null;
        switch(n){
          case "log": return `(Math.log(${a})/Math.log(${b}))`;  // log(value, base)
        }
      }
      return null;
    }
    default: return null;
  }
}

// Public: compile `expr` to a closure (…args)=>number over the named `vars`,
// baking `scope` scalars in. Returns null if unsupported.
// `varNames` is an ordered array, e.g. ["x","y","z"].
function compileFieldJS(expr, varNames, scope){
  if(expr == null) return null;
  let root;
  try { root = math.parse(String(expr)); } catch { return null; }
  const vars = new Set(varNames);
  const body = nodeToJS(root, vars, scope);
  if(body == null) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...varNames, `"use strict"; const r=${body}; return (typeof r==="number"&&isFinite(r))?r:0;`);
    // smoke-test it returns a number on a sample point
    const test = fn(...varNames.map(()=>0.123));
    if(typeof test !== "number") return null;
    return fn;
  } catch {
    return null;
  }
}

export { compileFieldJS };
