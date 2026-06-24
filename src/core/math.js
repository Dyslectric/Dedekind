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

// ── Constants, Greek normalization, multiplication by juxtaposition ──────────
// Three related concerns handled here, all at the text/AST level before eval:
//
// 1. RESERVED CONSTANTS. pi, e, i ALWAYS mean π, Euler's number, and the
//    imaginary unit. A scoped variable may never shadow them (mathjs lets scope
//    win by default — `evaluate("e",{e:99})===99` — which we override by deleting
//    those keys from the scope before evaluating). Naming a node pi/e/i is
//    blocked in the UI (see NameField), but this is the runtime backstop.
//
// 2. GREEK NORMALIZATION. The input shows π/τ/φ for readability, but mathjs only
//    knows the ASCII names, so we map the glyphs back before parsing.
//
// 3. JUXTAPOSITION. mathjs treats an unbroken letter run as ONE identifier: `xy`
//    is a single symbol, not x*y. Mathematicians expect products. We rewrite a
//    glued run into a product by GREEDY LONGEST-MATCH tokenizing left-to-right:
//      • `pi` (the only multi-char constant token) is matched greedily first, so
//        `pir` → pi*r and `piei` → pi*e*i.
//      • otherwise a single char is a token iff it is a known letter (a scoped /
//        axis / bound variable) or a single-char constant (e, i).
//      • if any position matches nothing (an unknown letter with no `pi`), the
//        WHOLE run is left as its original symbol so it errors honestly rather
//        than silently inventing a free variable.
//    A name that is itself a known whole token (a scoped `foo`, builtin `sin`)
//    is never split.

// Greek glyph → ASCII constant/name. π/τ/φ are the constants; the rest are just
// conventional variable spellings mathjs can't lex, normalized to ASCII so a
// variable typed as θ resolves to a scalar named `theta`, etc.
const _GREEK_TO_ASCII = {
  "π":"pi","τ":"tau","φ":"phi","θ":"theta","α":"alpha","β":"beta","γ":"gamma",
  "λ":"lambda","μ":"mu","ω":"omega","σ":"sigma","δ":"delta","ρ":"rho","ε":"epsilon",
};
function _normalizeGreek(text) {
  let s = String(text);
  for (const g in _GREEK_TO_ASCII) if (s.indexOf(g) >= 0) s = s.split(g).join(_GREEK_TO_ASCII[g]);
  return s;
}

// Reserved constant names that scope must never shadow.
const RESERVED_CONSTANTS = new Set(["pi", "e", "i"]);
// Single-character constants that are always valid juxtaposition tokens.
const _SINGLE_CONST = new Set(["e", "i"]);
// Sentinel symbol that `\i` compiles to (a name no user can type — backslash is
// stripped from identifiers), bound to the imaginary unit at eval time so it
// stays imaginary even in index contexts where bare `i` is the loop index.
const _IMAG_SENTINEL = "__imag_unit__";

function _isBuiltinName(name) {
  return (name in math) && (typeof math[name] === "number" || typeof math[name] === "function" || typeof math[name] === "object");
}
// Single-letter names known by virtue of scope membership. Numbers, functions,
// arrays (list nodes) all count — any defined binding makes the letter a token.
// Reserved-constant letters (e, i) are excluded here; they are always-available
// constants, handled separately, and must not be treated as scoped variables.
function _singleLetterKnownInScope(scope) {
  const out = new Set();
  if (!scope) return out;
  const keys = (scope instanceof Map || (scope && typeof scope.keys === "function" && typeof scope.forEach === "function"))
    ? [...scope.keys()] : Object.keys(scope);
  for (const k of keys) if (k.length === 1 && /^[A-Za-z]$/.test(k) && !RESERVED_CONSTANTS.has(k)) out.add(k);
  return out;
}
// Harvest single-letter variables that the expression's own operators bind:
// the index/var of summation/product/integrate/differentiate (arg[1]) and the
// independent-variable list of partial (arg[1] + the [..] names in arg[2]).
function _harvestBoundLetters(root) {
  const out = new Set();
  try {
    root.traverse(function (n) {
      if (!n.isFunctionNode) return;
      const fn = n.fn && n.fn.name;
      if (!fn) return;
      if (fn === "summation" || fn === "product" || fn === "integrate" || fn === "differentiate" || fn === "partial") {
        const v = n.args && n.args[1];
        if (v && v.isSymbolNode && v.name.length === 1) out.add(v.name);
      }
      if (fn === "partial") {
        const lst = n.args && n.args[2];
        if (lst && lst.isArrayNode) for (const it of (lst.items || [])) if (it.isSymbolNode && it.name.length === 1) out.add(it.name);
      }
    });
  } catch {}
  return out;
}
// Greedy longest-match tokenizer for a pure-letter run. `pi` is matched first
// (the only multi-char constant), then single known letters / single-char
// constants. Returns the token-name array, or null if any position fails (→ the
// run is left intact).
function _tokenizeRun(name, knownLetters) {
  if (name.length < 2 || !/^[A-Za-z]+$/.test(name)) return null;
  const toks = [];
  let p = 0;
  while (p < name.length) {
    if (name.startsWith("pi", p)) { toks.push("pi"); p += 2; continue; }   // greedy π
    const c = name[p];
    if (knownLetters.has(c) || _SINGLE_CONST.has(c)) { toks.push(c); p += 1; continue; }
    return null;   // unknown char and not the start of `pi` → whole run fails
  }
  return toks.length >= 2 ? toks : null;
}
// Rewrite glued letter-run SymbolNodes into left-associated products per the
// tokenizer. Known whole names (scoped or builtin) pass through. mathjs's
// transform does not re-transform replacement nodes, so this terminates.
function _splitJuxtaposition(root, knownLetters) {
  return root.transform(function (n) {
    if (n.isSymbolNode) {
      const nm = n.name;
      // a known whole token (scoped var, builtin fn/const, or a reserved
      // constant like pi/e/i) is never split
      if (knownLetters.has(nm) || _isBuiltinName(nm) || RESERVED_CONSTANTS.has(nm)) return n;
      const toks = _tokenizeRun(nm, knownLetters);
      if (toks) {
        let acc = new math.SymbolNode(toks[0]);
        for (let i = 1; i < toks.length; i++) acc = new math.OperatorNode("*", "multiply", [acc, new math.SymbolNode(toks[i])]);
        return acc;
      }
    }
    return n;
  });
}

// Strip reserved-constant keys from a scope so pi/e/i can never be shadowed by a
// user binding. In an index context, `i` is the loop index and is NOT stripped.
// Returns the same object when nothing needs removing (the common case), else a
// shallow copy with the offending keys deleted (never mutates the caller's scope).
function _shieldConstants(scope, idxContext) {
  if (!scope) scope = {};
  const reserved = idxContext ? ["pi", "e"] : ["pi", "e", "i"];
  let hit = false;
  for (const k of reserved) { if (_scopeHas(scope, k)) { hit = true; break; } }
  // Always provide the imaginary sentinel (cheap) so `\i` resolves; copy only
  // when we must remove a shadowing reserved key or add the sentinel.
  const needSentinel = !_scopeHas(scope, _IMAG_SENTINEL);
  if (!hit && !needSentinel) return scope;
  const copy = (scope instanceof Map) ? new Map(scope) : { ...scope };
  for (const k of reserved) {
    if (copy instanceof Map) copy.delete(k); else delete copy[k];
  }
  const imag = math.complex(0, 1);
  if (copy instanceof Map) copy.set(_IMAG_SENTINEL, imag); else copy[_IMAG_SENTINEL] = imag;
  return copy;
}

// Scope-aware compile: normalize Greek, parse, split juxtaposition against the
// scope's known single-letter names (+ the expression's own bound vars), then
// compile. Cached by (text | idx-flag | sorted-known-single-letters) because the
// split depends only on which single letters are known, not their values — so
// animating a slider reuses the compiled form, while defining/removing a
// single-letter scalar correctly recompiles. Falls back to the plain compile if
// anything goes wrong, so this can never make a previously-working expr fail.
//
// `idxContext` (set by the index/matrix/recursive point & glyph parsers) flips
// two behaviors: `i` becomes a known loop-index letter rather than the imaginary
// constant, and `\i` (written by the user to mean imaginary in those contexts)
// is normalized to the imaginary unit. Elsewhere bare `i` is already imaginary.
const _scopedCache = new Map();
const _SCOPED_CACHE_MAX = 4000;
function compileExprScoped(expr, scope, idxContext = false) {
  if (expr == null) return null;
  let text = _normalizeGreek(String(expr));
  // `\i` → imaginary unit. In index contexts bare `i` is the loop index, so `\i`
  // is how the user writes the imaginary unit; mapping it to a reserved sentinel
  // symbol (bound to complex(0,1) at eval time by _shieldConstants) keeps it
  // imaginary even though `i` itself resolves to the index. Outside index
  // contexts it resolves to the same imaginary unit.
  if (text.indexOf("\\i") >= 0) text = text.split("\\i").join(_IMAG_SENTINEL);
  let root;
  try { root = math.parse(text); } catch { try { return math.compile(text); } catch { return null; } }
  const known = _singleLetterKnownInScope(scope);
  for (const b of _harvestBoundLetters(root)) known.add(b);
  if (idxContext) known.add("i");   // loop index, not imaginary, in this context
  const sig = (idxContext ? "@" : "") + [...known].sort().join("");
  const key = text + "\u0001" + sig;
  let entry = _scopedCache.get(key);
  if (entry !== undefined) return entry;
  try {
    const rewritten = _splitJuxtaposition(root, known);
    entry = rewritten.compile();
  } catch {
    try { entry = math.compile(text); } catch { entry = null; }   // never regress
  }
  if (_scopedCache.size >= _SCOPED_CACHE_MAX) {
    const firstKey = _scopedCache.keys().next().value;
    _scopedCache.delete(firstKey);
  }
  _scopedCache.set(key, entry);
  return entry;
}

// Coerce an evaluation result to a plain real number, or null if it isn't one.
// mathjs returns a Complex object for any expression touching the imaginary unit
// (even when the result is real, e.g. i^2 = -1+0i), so a near-zero imaginary part
// is treated as a real number; a genuinely complex value (nonzero imaginary) is
// not plottable and returns null.
function _toReal(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof v.re === "number" && typeof v.im === "number") {
    return Math.abs(v.im) < 1e-12 ? v.re : null;
  }
  return null;
}

function resolveNum(expr, scope, fallback = 0) {
  if (expr === "" || expr == null) return fallback;
  const n = Number(expr); if (!isNaN(n)) return n;
  const c = compileExprScoped(expr, scope);
  if (!c) return fallback;
  try { const r = _toReal(c.evaluate(_shieldConstants(scope, false))); return r == null ? fallback : r; }
  catch { return fallback; }
}
function safeEval(expr, scope, idxContext = false) {
  const c = compileExprScoped(expr, scope, idxContext);
  if (!c) return null;
  try { return _toReal(c.evaluate(_shieldConstants(scope, idxContext))); }
  catch { return null; }
}
function linspace(a, b, n) {
  const r = []; for (let i = 0; i < n; i++) r.push(a + (b-a)*i/(n-1)); return r;
}
// Evaluate an expression expected to yield an ARRAY (a list value). Normalizes a
// mathjs Matrix to a plain nested JS array; returns null if it isn't array-like.
// Used by the list node — the one place scope keeps a value that isn't a number.
function evalArray(expr, scope) {
  const c = compileExprScoped(expr, scope);
  if (!c) return null;
  try {
    let v = c.evaluate(scope);
    if (v && typeof v.toArray === "function") v = v.toArray();
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

// ── Recursive user-defined functions ────────────────────────────────────────
function makeFn(name, params, expr, sc) {
  // Compile the body with juxtaposition split against the names the body can see:
  // its own parameters plus everything in its closed-over scope (sliders, other
  // fnDefs). Params are bound per call, but which single letters are KNOWN is
  // fixed, so we can split once here. A representative scope (params present as
  // placeholders + the closure) drives the known-letter set.
  const knownScope = {};
  for (const k in (sc || {})) knownScope[k] = sc[k];
  for (const p of (params || [])) if (!(p in knownScope)) knownScope[p] = 0;
  const compiled = compileExprScoped(expr, knownScope);
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

// Symbolic derivative as SOURCE TEXT (not compiled), memoized by (body, var).
// `compiledDerivative` above returns a compiled evaluator for CPU sampling; the
// GPU normal path instead needs the derivative EXPRESSION so it can be handed to
// exprToGLSL and inlined into a shader. Returns the derivative source string, or
// null when the body can't be differentiated (caller then uses the dFdx/dFdy
// screen-space fallback).
const _derivSrcCache = new Map();
function derivativeExpr(bodyText, varName) {
  if (typeof bodyText !== "string" || !bodyText.length) return null;
  const key = varName + " " + bodyText;
  const hit = _derivSrcCache.get(key);
  if (hit !== undefined) return hit;
  let src = null;
  try { src = math.derivative(math.parse(bodyText), varName).toString(); }
  catch { src = null; }
  if (_derivSrcCache.size >= 2000) {
    const firstKey = _derivSrcCache.keys().next().value;
    _derivSrcCache.delete(firstKey);
  }
  _derivSrcCache.set(key, src);
  return src;
}

export {
  math, parse,
  uid, PAL, nextColor, compileExpr, compileExprScoped, resolveNum, safeEval, evalArray, linspace, makeFn, splitTopLevel, derivativeExpr,
  RESERVED_CONSTANTS, _normalizeGreek as normalizeGreek
};
