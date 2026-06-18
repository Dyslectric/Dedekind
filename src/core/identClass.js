// LaTeX-style greek names → the actual unicode glyph. Typing "\alpha" in a math
// input converts to "α" in the stored text (Model A: the char IS the canonical
// identifier — mathjs accepts unicode greek as a symbol name, so nothing else in
// the evaluate/scope/serialize pipeline needs to know about the backslash form).
// No name here is a prefix of another, so each is unambiguous the moment it is
// fully typed.
const GREEK_NAMES={
  alpha:"α",beta:"β",gamma:"γ",delta:"δ",epsilon:"ε",zeta:"ζ",eta:"η",theta:"θ",
  iota:"ι",kappa:"κ",lambda:"λ",mu:"μ",nu:"ν",xi:"ξ",omicron:"ο",pi:"π",rho:"ρ",
  sigma:"σ",tau:"τ",upsilon:"υ",phi:"φ",chi:"χ",psi:"ψ",omega:"ω",
  Gamma:"Γ",Delta:"Δ",Theta:"Θ",Lambda:"Λ",Xi:"Ξ",Pi:"Π",Sigma:"Σ",Phi:"Φ",Psi:"Ψ",Omega:"Ω",
  varphi:"ϕ",varepsilon:"ϵ",vartheta:"ϑ",varsigma:"ς",varrho:"ϱ",varpi:"ϖ",
};

// ── Identifier classification for expression highlighting ──────────────────
// Used by MathInput (the contentEditable highlighter). Lives in core/ rather
// than a component file because it's pure domain logic — it has nothing to do
// with React or any particular input widget.
const MATH_CONSTANTS=new Set(["pi","e","tau","phi","Inf","Infinity"]);
const MATH_FUNCS=new Set(["sin","cos","tan","asin","acos","atan","atan2","sinh","cosh","tanh","exp","log","ln","log10","log2","sqrt","cbrt","abs","sign","floor","ceil","round","fract","mod","pow","min","max","gamma","factorial","hypot","norm","dot","cross","summation","product","integrate","differentiate","partial"]);
const MATH_BOUND=new Set(["x","y","z","u","v","s","r","t","n","i","j","k"]); // loop/param/index vars

// Tokenize a raw mathjs-style expression string into {t,v} tokens (ws, ident,
// num, index, op, other). Used for highlighting/painting and the pretty-preview
// renderer in MathInput. Identifiers may include greek unicode letters (U+0370–
// U+03FF) so that converted "\alpha" → "α" names classify and lay out as proper
// identifiers, not as stray "other" glyphs.
const IDENT_START="A-Za-z_\\u0370-\\u03ff\\u03d0-\\u03f6";
const IDENT_CONT ="A-Za-z0-9_\\u0370-\\u03ff\\u03d0-\\u03f6";
const MATH_TOKEN_RE=new RegExp(
  `(\\s+)|([${IDENT_START}][${IDENT_CONT}]*)|(\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)|(\\[[^\\]]*\\])|([+\\-*/^%(),.|])|(.)`,"g");
function tokenizeMath(str){
  const toks=[]; const re=new RegExp(MATH_TOKEN_RE.source,"g");
  let mm;
  while((mm=re.exec(str))){
    if(mm[1]!=null) toks.push({t:"ws",v:mm[1]});
    else if(mm[2]!=null) toks.push({t:"ident",v:mm[2]});
    else if(mm[3]!=null) toks.push({t:"num",v:mm[3]});
    else if(mm[4]!=null) toks.push({t:"index",v:mm[4]});       // [n-1] style
    else if(mm[5]!=null) toks.push({t:"op",v:mm[5]});
    else toks.push({t:"other",v:mm[6]});
  }
  return toks;
}

// classify an identifier given the live scope: is it an evaluated (in-scope)
// value/function, a known constant/builtin, a bound loop var, or unknown?
function classifyIdent(name, sc){
  if(sc && typeof sc[name]==="number") return "scopeVal";    // a wired scalar — evaluated
  if(sc && typeof sc[name]==="function") return "scopeFn";   // a wired function — evaluated
  if(MATH_FUNCS.has(name)) return "fn";
  if(MATH_CONSTANTS.has(name)) return "const";
  if(MATH_BOUND.has(name)) return "bound";
  return "unknown";
}
function tokenColor(cls, ui){
  switch(cls){
    case "scopeVal": return {c:ui.uiAccent, w:"bold", bg:ui.uiAccent+"22"};   // highlighted: evaluated token
    case "scopeFn":  return {c:ui.uiGood,   w:"bold", bg:ui.uiGood+"1e"};
    case "fn":       return {c:"#7fb0ff", w:"normal"};
    case "const":    return {c:"#e0a0ff", w:"normal"};
    case "bound":    return {c:ui.uiText, w:"normal"};
    default:         return {c:ui.uiMuted, w:"normal"};
  }
}

export {
  MATH_CONSTANTS, MATH_FUNCS, MATH_BOUND, GREEK_NAMES, tokenizeMath, classifyIdent, tokenColor
};
