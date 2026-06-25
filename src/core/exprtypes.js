// ── Expression type registry ─────────────────────────────────────────────────
//
// Dedekind expressions are elements of a FIELD (or, later, richer algebraic
// structures). Historically every expression was evaluated in ℂ under the hood
// and coerced to ℝ at the plotting boundary, which meant `i` was *always* the
// imaginary unit. This registry makes the type a SELECTABLE, per-expression
// property instead, and centralizes everything the eval + transpile pipeline
// needs to know about a type so new types (vectors, quaternions, ℤ/modular,
// matrices…) can be added in one place without touching the evaluator.
//
// Each type is a descriptor object:
//   id            stable string stored in node props (e.g. "real", "complex")
//   label         short UI label ("ℝ", "ℂ")
//   name          longer UI name ("real", "complex")
//   freesI        true → `i` is an ordinary free variable (and usable as a loop
//                 index); false → `i` is a reserved constant of this type
//   constants     map of reserved constant name → value provider. Values are
//                 produced lazily (so e.g. the imaginary unit is only built when
//                 a complex-typed expression is evaluated). `pi`/`e` are provided
//                 by mathjs already and never overridden here.
//   coerce(v)     map a raw mathjs evaluation result to a PLOTTABLE scalar:
//                 a finite real number, or null if the value can't be plotted as
//                 a real (e.g. a complex number with nonzero imaginary part).
//                 Vector/other types will return arrays here in a later pass.
//   glslImaginary true → the GLSL transpiler must treat `i` as the imaginary unit
//                 and refuse to transpile expressions that use it (no complex on
//                 the GPU). false → `i` is a plain real symbol the GPU can handle.
//
// The registry is deliberately tiny and data-driven; the evaluator asks the type
// "what are your constants?", "do you free i?", "coerce this result", and the
// transpiler asks "is i imaginary for you?". Nothing else hardcodes ℝ-vs-ℂ.

// NOTE: the imaginary-unit VALUE is injected by the evaluator (which owns the
// mathjs instance). The registry only needs to declare WHICH constants a type
// reserves and how to coerce; the evaluator binds the actual values. So the
// imaginary unit appears here as a marker the evaluator recognizes.
const IMAGINARY_UNIT = Symbol("imaginary-unit");

// Coerce a mathjs result (number | Complex | …) to a plottable real, or null.
// Shared by the real and complex types (real never produces a Complex, but a
// real expression that calls a complex-capable function defensively goes through
// the same collapse).
function _complexToReal(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object" && typeof v.re === "number" && typeof v.im === "number") {
    // a near-zero imaginary part is a real number; a genuine complex value is not
    // plottable as a single real and returns null.
    return Math.abs(v.im) < 1e-12 && Number.isFinite(v.re) ? v.re : null;
  }
  return null;
}

const REAL = {
  id: "real",
  label: "ℝ",
  name: "real",
  freesI: true,            // `i` is a free variable / loop index, never imaginary
  constants: {},           // pi, e come from mathjs; real reserves nothing extra
  coerce: _complexToReal,
  glslImaginary: false,    // `i` is a real symbol → GPU-friendly
};

const COMPLEX = {
  id: "complex",
  label: "ℂ",
  name: "complex",
  freesI: false,           // `i` is the imaginary unit
  constants: { i: IMAGINARY_UNIT },
  coerce: _complexToReal,  // plot the real part when the result is (near-)real
  glslImaginary: true,     // complex can't go to GLSL; transpiler rejects `i`
};

const _REGISTRY = new Map();
function registerExprType(t) { _REGISTRY.set(t.id, t); return t; }
registerExprType(REAL);
registerExprType(COMPLEX);

// The default type for a field with no explicit selection. Per the redesign,
// expressions default to ℝ (i freed); a field opts into ℂ to get the imaginary
// unit. Saved projects that predate the selector therefore become real — verified
// safe because no demo/frontend expression used `i` as the imaginary unit (every
// occurrence was the loop index, which ℝ frees anyway).
const DEFAULT_EXPR_TYPE = "real";

// Resolve a type id (or undefined/legacy) to a descriptor, always non-null.
function exprType(id) {
  return _REGISTRY.get(id) || _REGISTRY.get(DEFAULT_EXPR_TYPE);
}

// All registered types, in a stable display order, for building UI selectors.
function exprTypeList() {
  // explicit order so the picker reads ℝ, ℂ, then any future additions
  const order = ["real", "complex"];
  const seen = new Set();
  const out = [];
  for (const id of order) { if (_REGISTRY.has(id)) { out.push(_REGISTRY.get(id)); seen.add(id); } }
  for (const [id, t] of _REGISTRY) if (!seen.has(id)) out.push(t);
  return out;
}

export {
  IMAGINARY_UNIT, REAL, COMPLEX, DEFAULT_EXPR_TYPE,
  exprType, exprTypeList, registerExprType,
};
