import { create, all } from "mathjs";

// A single configured mathjs instance shared across the app. We extend the
// stock instance with bounded reduction/integration operators the app's
// expression language needs (∑, ∏, ∫) — none of which mathjs ships. Every
// expression in the app compiles/evaluates through this instance, so these are
// available anywhere an expression is allowed.
const math = create(all);

// ── Bounded operators (rawArgs so the body re-evaluates per index) ───────────
// mathjs evaluates function arguments eagerly; a `rawArgs` function instead
// receives the unevaluated AST nodes + the live scope, letting us bind the
// index/integration variable and evaluate the body in a loop. Bounds may be
// arbitrary sub-expressions (e.g. slider variables), resolved against `scope`.
const _MAX_TERMS = 1e6;          // runaway-range guard

// Bind `name`→`val` on a (possibly Map-like) scope, evaluate `body`, then
// restore. mathjs passes a PartitionedMap to rawArgs functions — a Map-like
// object that is NOT `instanceof Map` and whose entries are not plain own
// properties, so copying it with Object.assign loses every variable (sliders,
// constants, etc.). We instead bind the loop variable directly on the live
// scope (preserving all parent variables) and restore the prior binding after,
// which also makes nested sums and a shadowed outer variable behave correctly.
function _scopeHas(scope, name){
  if (scope instanceof Map || (scope && typeof scope.has === "function")) return scope.has(name);
  return Object.prototype.hasOwnProperty.call(scope, name);
}
function _scopeGet(scope, name){
  if (scope instanceof Map || (scope && typeof scope.get === "function")) return scope.get(name);
  return scope[name];
}
function _scopeSet(scope, name, val){
  if (scope instanceof Map || (scope && typeof scope.set === "function")) scope.set(name, val);
  else scope[name] = val;
}
function _scopeDelete(scope, name){
  if (scope instanceof Map || (scope && typeof scope.delete === "function")) scope.delete(name);
  else delete scope[name];
}

// Evaluate `body` with `name` temporarily bound to `val` in `scope`.
function _evalWith(body, name, val, scope) {
  const had = _scopeHas(scope, name);
  const prev = had ? _scopeGet(scope, name) : undefined;
  _scopeSet(scope, name, val);
  let v;
  try { v = body.evaluate(scope); }
  finally {
    if (had) _scopeSet(scope, name, prev);
    else _scopeDelete(scope, name);
  }
  return typeof v === "number" ? v : NaN;
}

// summation(body, i, lo, hi)  — Σ_{i=lo}^{hi} body, integer steps.
function summation(args, _m, scope) {
  if (args.length < 4 || !args[1].isSymbolNode) return NaN;
  const name = args[1].name;
  const lo = Math.round(args[2].compile().evaluate(scope));
  const hi = Math.round(args[3].compile().evaluate(scope));
  if (!isFinite(lo) || !isFinite(hi) || hi - lo > _MAX_TERMS) return NaN;
  const body = args[0].compile();
  let acc = 0;
  for (let i = lo; i <= hi; i++) acc += _evalWith(body, name, i, scope);
  return acc;
}
summation.rawArgs = true;

// product(body, i, lo, hi)  — Π_{i=lo}^{hi} body, integer steps.
function product(args, _m, scope) {
  if (args.length < 4 || !args[1].isSymbolNode) return NaN;
  const name = args[1].name;
  const lo = Math.round(args[2].compile().evaluate(scope));
  const hi = Math.round(args[3].compile().evaluate(scope));
  if (!isFinite(lo) || !isFinite(hi) || hi - lo > _MAX_TERMS) return NaN;
  const body = args[0].compile();
  let acc = 1;
  for (let i = lo; i <= hi; i++) acc *= _evalWith(body, name, i, scope);
  return acc;
}
product.rawArgs = true;

// integrate(body, x, a, b)  — ∫_a^b body dx, numeric (composite Simpson).
function integrate(args, _m, scope) {
  if (args.length < 4 || !args[1].isSymbolNode) return NaN;
  const name = args[1].name;
  const a = args[2].compile().evaluate(scope);
  const b = args[3].compile().evaluate(scope);
  if (!isFinite(a) || !isFinite(b)) return NaN;
  if (a === b) return 0;
  const body = args[0].compile();
  const N = 200;                 // even panel count; smooth-integrand accuracy
  const h = (b - a) / N;
  let s = _evalWith(body, name, a, scope) + _evalWith(body, name, b, scope);
  for (let k = 1; k < N; k++) s += (k % 2 ? 4 : 2) * _evalWith(body, name, a + k * h, scope);
  return s * h / 3;
}
integrate.rawArgs = true;

math.import({ summation, product, integrate }, { override: true });

// Re-export parse so other modules (e.g. mathlatex) share this instance and its
// knowledge of the custom operators.
const parse = math.parse;

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
  math, parse,
  uid, PAL, nextColor, compileExpr, resolveNum, safeEval, linspace, makeFn
};
