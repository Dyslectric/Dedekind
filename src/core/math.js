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

// Memoized symbolic derivative + compile. Both `differentiate` and `partial` take
// the symbolic derivative of a body expression w.r.t. a variable and then compile
// the result for evaluation. Doing that on EVERY sample is ~440x slower than the
// closed form (measured): a derivative plotted over a grid re-derives and
// re-compiles per point. Since the body text and variable are stable across a
// plot's samples (only the bound values change), we cache the compiled derivative
// keyed on (body source, variable). Returns the compiled object, or null if the
// body can't be differentiated.
const _derivCache = new Map();
const _DERIV_CACHE_MAX = 2000;
function compiledDerivative(bodyNode, varName) {
  // Key on the body's source text + the differentiation variable. toString() is
  // stable for a given AST and cheap relative to derivative+compile.
  let src;
  try { src = bodyNode.toString(); } catch { src = null; }
  const key = src == null ? null : (varName + "\u0000" + src);
  if (key != null) {
    const hit = _derivCache.get(key);
    if (hit !== undefined) return hit;   // may be null (known un-differentiable)
  }
  let compiled = null;
  try { compiled = math.derivative(bodyNode, varName).compile(); }
  catch { compiled = null; }
  if (key != null) {
    if (_derivCache.size >= _DERIV_CACHE_MAX) {
      const firstKey = _derivCache.keys().next().value;
      _derivCache.delete(firstKey);
    }
    _derivCache.set(key, compiled);
  }
  return compiled;
}

// differentiate(body, x, point, [pin...])  — d/dx[body] evaluated at x = point.
// Takes the SYMBOLIC derivative of body w.r.t. x (mathjs `derivative`), then
// evaluates with x bound to `point`; remaining free variables resolve from the
// ambient scope unless pinned by a trailing `name=value` assignment arg. rawArgs
// keeps everything unevaluated so the differentiation variable isn't resolved
// early.
function differentiate(args, _m, scope) {
  if (args.length < 3 || !args[1].isSymbolNode) return NaN;
  const name = args[1].name;
  const d = compiledDerivative(args[0], name);   // cached symbolic derivative + compile
  if (!d) return NaN;
  let pt; try { pt = args[2].compile().evaluate(scope); } catch { return NaN; }
  if (typeof pt !== "number" || !isFinite(pt)) return NaN;
  const binds = [[name, pt]];
  for (let i = 3; i < args.length; i++) {
    const a = args[i];
    if (a && a.isAssignmentNode && a.object && a.object.isSymbolNode) {
      let val; try { val = a.value.compile().evaluate(scope); } catch { val = NaN; }
      binds.push([a.object.name, val]);
    }
  }
  for (const [, val] of binds) if (typeof val !== "number" || !isFinite(val)) return NaN;
  const nms = binds.map(b => b[0]);
  const had = nms.map(nm => _scopeHas(scope, nm));
  const prev = nms.map((nm, i) => had[i] ? _scopeGet(scope, nm) : undefined);
  binds.forEach(([nm, val]) => _scopeSet(scope, nm, val));
  let v;
  try { v = d.evaluate(scope); }
  catch { v = NaN; }
  finally {
    nms.forEach((nm, i) => { if (had[i]) _scopeSet(scope, nm, prev[i]); else _scopeDelete(scope, nm); });
  }
  return typeof v === "number" ? v : NaN;
}
differentiate.rawArgs = true;

// partial(expr, x, [freevars...], [values...])  — ∂/∂x[expr] evaluated at a point.
// Differentiates expr symbolically w.r.t. x (mathjs `derivative`, treating other
// variables as constants), then binds each free variable in the list to the
// positionally-matched value and evaluates. The diff variable x must appear in
// the free-var list (its value is the evaluation coordinate). Any free variable
// in expr NOT listed falls back to the ambient scope (sliders, scalars). rawArgs
// keeps everything unevaluated so the differentiation variable isn't resolved
// early.
function partial(args, _m, scope) {
  if (args.length < 4 || !args[1].isSymbolNode) return NaN;
  const dv = args[1].name;
  const d = compiledDerivative(args[0], dv);       // cached symbolic ∂/∂(dv) + compile
  if (!d) return NaN;
  const namesNode = args[2], valsNode = args[3];
  if (!namesNode || !namesNode.isArrayNode || !valsNode || !valsNode.isArrayNode) return NaN;
  const names = namesNode.items || [];
  const vals  = valsNode.items || [];
  const binds = [];
  for (let i = 0; i < names.length; i++) {
    const nm = names[i];
    if (!nm || !nm.isSymbolNode) return NaN;
    let val = NaN;
    if (i < vals.length) { try { val = vals[i].compile().evaluate(scope); } catch { val = NaN; } }
    binds.push([nm.name, val]);
  }
  if (!binds.some(b => b[0] === dv)) return NaN;    // diff var must be in the list
  for (const [, val] of binds) if (typeof val !== "number" || !isFinite(val)) return NaN;
  // bind listed vars on the live scope (so unlisted free vars still resolve from
  // scope), evaluate the derivative, then restore.
  const nms = binds.map(b => b[0]);
  const had = nms.map(nm => _scopeHas(scope, nm));
  const prev = nms.map((nm, i) => had[i] ? _scopeGet(scope, nm) : undefined);
  binds.forEach(([nm, val]) => _scopeSet(scope, nm, val));
  let v;
  try { v = d.evaluate(scope); }
  catch { v = NaN; }
  finally {
    nms.forEach((nm, i) => { if (had[i]) _scopeSet(scope, nm, prev[i]); else _scopeDelete(scope, nm); });
  }
  return typeof v === "number" ? v : NaN;
}
partial.rawArgs = true;

math.import({ summation, product, integrate, differentiate, partial }, { override: true });

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
  // Identity metadata for cache invalidation. The geometry cache keys off a
  // textual signature; functions are closures (not numbers) so they're invisible
  // to a value scan. We expose the definition (name+params+body) and the scope
  // the function closed over, so scopeSig() can (a) detect when the function
  // BODY changes and (b) recurse into the scalars the body transitively depends
  // on (e.g. f(x)=a*x where `a` is a slider not named in the caller's expr).
  fn._fnName = name;
  fn._fnParams = params;
  fn._fnExpr = expr;
  fn._fnScope = sc;
  return fn;
}

// Split a string on TOP-LEVEL delimiter chars only, so delimiters inside
// parentheses/brackets — e.g. the comma in atan2(y, x) or hypot(a, b) — stay
// intact. Coordinate/expression lists ("x, y, hypot(a,b)") MUST use this instead
// of a naive String.split(delim), which would shred function calls and silently
// drop or mis-evaluate the row. `delims` defaults to comma; pass "," or "|", etc.
// Returns trimmed, non-cosmetic parts (an empty trailing field is preserved only
// when there was real content, mirroring the prior splitCoords behavior).
function splitTopLevel(s, delim = ",") {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of String(s)) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === delim && depth === 0) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim().length || out.length) out.push(cur.trim());
  return out;
}

export {
  math, parse,
  uid, PAL, nextColor, compileExpr, resolveNum, safeEval, linspace, makeFn, splitTopLevel
};
