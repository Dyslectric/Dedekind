import * as math from "mathjs";

let _id = 0;
const uid = () => `n${++_id}`;
const PAL = ["#5b9cf6","#f75f5f","#52d47e","#f7cc4f","#c761f7","#f78b4f","#4ff4ef","#ff70bb"];
let _ci = 0;
const nextColor = () => PAL[_ci++ % PAL.length];

// rebuild). `math.compile(expr)` parses once into a reusable object whose
// `.evaluate(scope)` skips parsing entirely (~29× faster in practice). We cache
// the compiled object keyed by the raw source string so repeated samples and
// repeated rebuilds across frames all share one parse.
const _exprCache = new Map();
const _EXPR_CACHE_MAX = 2000;
function compileExpr(expr) {
  if (expr == null) return null;
  const key = String(expr);
  let entry = _exprCache.get(key);
  if (entry !== undefined) return entry; // may be null (known-bad)
  try {
    entry = math.compile(key);
  } catch {
    entry = null; // cache the failure so we don't re-attempt parsing each sample
  }
  // simple size cap: drop oldest insertion when over budget
  if (_exprCache.size >= _EXPR_CACHE_MAX) {
    const firstKey = _exprCache.keys().next().value;
    _exprCache.delete(firstKey);
  }
  _exprCache.set(key, entry);
  return entry;
}

function resolveNum(expr, scope, fallback = 0) {
  if (expr === "" || expr == null) return fallback;
  const n = Number(expr); if (!isNaN(n)) return n;
  const c = compileExpr(expr);
  if (!c) return fallback;
  try { const r = c.evaluate(scope); return typeof r === "number" ? r : fallback; }
  catch { return fallback; }
}
function safeEval(expr, scope) {
  const c = compileExpr(expr);
  if (!c) return null;
  try { const v = c.evaluate(scope); return typeof v === "number" ? v : null; }
  catch { return null; }
}
function linspace(a, b, n) {
  const r = []; for (let i = 0; i < n; i++) r.push(a + (b-a)*i/(n-1)); return r;
}

// ── Recursive user-defined functions ────────────────────────────────────────
function makeFn(name, params, expr, sc) {
  const compiled = compileExpr(expr);
  const fn = function(...args) {
    if (fn._d === 0) fn._calls = 0;
    fn._calls = (fn._calls||0) + 1;
    if (fn._calls > 20000) return NaN;
    if ((fn._d = (fn._d||0)+1) > 120) { fn._d--; return NaN; }
    const ls = {...sc};
    params.forEach((p,i) => { ls[p] = args[i]??0; });
    ls[name] = fn;
    let r = null;
    if (compiled) { try { const v = compiled.evaluate(ls); r = typeof v === "number" ? v : null; } catch { r = null; } }
    fn._d--;
    return r??NaN;
  };
  fn._d = 0; fn._calls = 0;
  return fn;
}

export {
  uid, PAL, nextColor, compileExpr, resolveNum, safeEval, linspace, makeFn
};
