// ── Bridge between the app's plain-text expression syntax (mathjs) and LaTeX ──
//
// The app's source of truth for every expression is a plain mathjs-style string
// (e.g. "sin(x)*cos(y)", "u*sin(v)*cos(w)", "out0"). MathLive edits a *typeset*
// (LaTeX) projection of that string. To keep builders, GLSL translation,
// serialization and scope evaluation untouched, this module converts:
//
//   textToLatex(text)  → LaTeX to seed / display in the mathfield
//   latexToText(latex) → mathjs-parseable text emitted back through onChange
//
// textToLatex uses mathjs' own `.toTex()` (reliable, structure-aware). When the
// text doesn't parse yet (mid-typing), it falls back to light escaping so the
// field still shows something rather than throwing.
//
// latexToText is a small hand-written recursive-descent parser over the LaTeX
// subset that actually occurs here (\frac, ^, _, \sqrt, \cdot, \left/\right,
// \mathrm/\operatorname groups, named functions like \sin, Greek macros). It is
// used in preference to MathLive's ascii-math serializer because that serializer
// splits multi-character identifiers ("out0" -> "o u t0"), which breaks variable
// names the app relies on.

import { parse as mathParse } from "./math.js";

// ── text -> LaTeX ────────────────────────────────────────────────────────────
// Custom rendering for the bounded operators so they typeset as ∑ / ∏ / ∫ with
// stacked bounds rather than as plain function calls.
function bigopHandler(node, options){
  if(node.type!=="FunctionNode") return undefined;
  const name=node.fn && node.fn.name;
  if((name==="summation"||name==="product") && node.args.length>=4){
    const sym = name==="summation" ? "\\sum" : "\\prod";
    const [body,idx,lo,hi]=node.args;
    return `${sym}_{${idx.toTex(options)}=${lo.toTex(options)}}^{${hi.toTex(options)}} ${body.toTex(options)}`;
  }
  if(name==="integrate" && node.args.length>=4){
    const [body,v,a,b]=node.args;
    return `\\int_{${a.toTex(options)}}^{${b.toTex(options)}} ${body.toTex(options)}\\,d${v.toTex(options)}`;
  }
  return undefined;
}

export function textToLatex(text){
  const s=(text??"").trim();
  if(!s) return "";
  try{
    return mathParse(s).toTex({ handler:bigopHandler, parenthesis:"keep", implicit:"hide" });
  }catch{
    return s.replace(/\\/g,"\\backslash ").replace(/([{}])/g,"\\$1");
  }
}

// ── LaTeX -> text ────────────────────────────────────────────────────────────
const MACRO_IDENT={
  pi:"pi", tau:"tau", phi:"phi", theta:"theta", alpha:"alpha", beta:"beta",
  gamma:"gamma", delta:"delta", epsilon:"epsilon", lambda:"lambda", mu:"mu",
  omega:"omega", sigma:"sigma", rho:"rho", infty:"Infinity",
};
const MACRO_FUNC=new Set(["sin","cos","tan","asin","acos","atan","sinh","cosh",
  "tanh","exp","ln","log","sqrt","abs","sign","floor","ceil","min","max",
  "arcsin","arccos","arctan"]);
const FUNC_RENAME={ ln:"log", arcsin:"asin", arccos:"acos", arctan:"atan" };

export function latexToText(latex){
  const s=(latex??"").trim();
  if(!s) return "";
  try{
    const p=new LatexParser(s);
    const out=p.parseExpr();
    return out||"";
  }catch{
    return permissiveStrip(s);
  }
}

function permissiveStrip(s){
  return s
    .replace(/\\left|\\right/g,"")
    .replace(/\\cdot|\\times/g,"*")
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,"($1)/($2)")
    .replace(/\\sqrt\s*\{([^{}]*)\}/g,"sqrt($1)")
    .replace(/\\operatorname\s*\{([^{}]*)\}|\\mathrm\s*\{([^{}]*)\}/g,(m,a,b)=>a||b||"")
    .replace(/\\[A-Za-z]+/g,m=>{const k=m.slice(1);return MACRO_IDENT[k]??(MACRO_FUNC.has(k)?(FUNC_RENAME[k]||k):"");})
    .replace(/[{}]/g,"")
    .replace(/\s+/g,"")
    .trim();
}

class LatexParser{
  constructor(s){ this.s=s; this.i=0; this.barDepth=0; }
  skipSpace(){ while(this.i<this.s.length){ const c=this.s[this.i];
    if(c===" "||c==="\t"||c==="\n"){ this.i++; continue; }
    if(c==="~"){ this.i++; continue; }
    if(this.s.startsWith("\\,",this.i)||this.s.startsWith("\\;",this.i)||
       this.s.startsWith("\\ ",this.i)||this.s.startsWith("\\!",this.i)||
       this.s.startsWith("\\:",this.i)){ this.i+=2; continue; }
    if(this.s.startsWith("\\left",this.i)){ this.i+=5; continue; }
    if(this.s.startsWith("\\right",this.i)){ this.i+=6; continue; }
    break;
  } }
  peek(){ this.skipSpace(); return this.s[this.i]; }
  eat(ch){ this.skipSpace(); if(this.s[this.i]===ch){ this.i++; return true; } return false; }

  readMacro(){
    if(this.s[this.i]!=="\\") return null;
    let j=this.i+1, name="";
    while(j<this.s.length && /[A-Za-z]/.test(this.s[j])){ name+=this.s[j]; j++; }
    if(!name){ name=this.s[this.i+1]||""; this.i+=2; return {sym:name}; }
    this.i=j; return {name};
  }

  parseExpr(){
    let left=this.parseTerm();
    for(;;){
      const c=this.peek();
      if(c==="+"||c==="-"){ this.i++; const r=this.parseTerm(); left=`${left}${c}${r}`; }
      else if(this.s.startsWith("\\pm",this.i)){ this.i+=3; const r=this.parseTerm(); left=`${left}+${r}`; }
      else break;
    }
    return left;
  }
  parseTerm(){
    let left=this.parseFactor();
    if(left==="") return left;
    for(;;){
      this.skipSpace();
      const c=this.s[this.i];
      if(c==="*"||c==="/"){ this.i++; const r=this.parseFactor(); left=`${left}${c}${r}`; }
      else if(this.s.startsWith("\\cdot",this.i)){ this.i+=5; const r=this.parseFactor(); left=`${left}*${r}`; }
      else if(this.s.startsWith("\\times",this.i)){ this.i+=6; const r=this.parseFactor(); left=`${left}*${r}`; }
      else if(this.s.startsWith("\\div",this.i)){ this.i+=4; const r=this.parseFactor(); left=`${left}/${r}`; }
      else if(this.isFactorStart()){ const r=this.parseFactor(); if(r==="")break; left=`${left}*${r}`; }
      else break;
    }
    return left;
  }
  isFactorStart(){
    this.skipSpace();
    const c=this.s[this.i];
    if(c==null) return false;
    if(c==="|"){ return this.barDepth===0; }  // a | closing an abs is NOT a new factor
    if(c==="("||c==="{") return true;
    if(c==="\\"){
      if(this.s.startsWith("\\cdot",this.i)||this.s.startsWith("\\times",this.i)||
         this.s.startsWith("\\div",this.i)||this.s.startsWith("\\right",this.i)||
         this.s.startsWith("\\pm",this.i)) return false;
      return true;
    }
    if(/[A-Za-z0-9.]/.test(c)) return true;
    return false;
  }
  parseFactor(){
    let base=this.parseUnary();
    this.skipSpace();
    if(this.s[this.i]==="^"){
      this.i++;
      const exp=this.parseSuperGroup();
      base=`${base}^${exp}`;
    }
    return base;
  }
  parseUnary(){
    this.skipSpace();
    const c=this.s[this.i];
    if(c==="-"){ this.i++; return `-${this.parseUnary()}`; }
    if(c==="+"){ this.i++; return this.parseUnary(); }
    return this.parsePrimary();
  }
  parseSuperGroup(){
    this.skipSpace();
    if(this.s[this.i]==="{"){ const inner=this.readBraced(); const t=new LatexParser(inner).parseExpr(); return needsParens(t)?`(${t})`:t; }
    const prim=this.parsePrimary();
    return needsParens(prim)?`(${prim})`:prim;
  }
  readBraced(){
    this.skipSpace();
    if(this.s[this.i]!=="{") return "";
    let depth=0, j=this.i, out="";
    for(; j<this.s.length; j++){
      const ch=this.s[j];
      if(ch==="{"){ depth++; if(depth===1) continue; }
      else if(ch==="}"){ depth--; if(depth===0){ j++; break; } }
      if(depth>=1) out+=ch;
    }
    this.i=j;
    return out;
  }
  parsePrimary(){
    this.skipSpace();
    const c=this.s[this.i];
    if(c==null) return "";
    if(c==="("){ this.i++; const e=this.parseExpr(); this.eat(")"); return alreadyWrapped(e)?e:`(${e})`; }
    if(c==="{"){ const inner=this.readBraced(); const t=new LatexParser(inner).parseExpr(); return needsParens(t)?`(${t})`:t; }
    if(c==="|"){ this.i++; this.barDepth++; const e=this.parseExpr(); this.barDepth--; this.eat("|"); return `abs(${e})`; }
    if(/[0-9.]/.test(c)){ let n=""; while(/[0-9.]/.test(this.s[this.i]||"")){ n+=this.s[this.i]; this.i++; } return n; }
    if(/[A-Za-z]/.test(c)){ let id=""; while(/[A-Za-z0-9_]/.test(this.s[this.i]||"")){ id+=this.s[this.i]; this.i++; }
      // A bare function name directly followed by "(" is a call, e.g. a user
      // typed "sin(x)" and MathLive stored it without the \sin macro.
      this.skipSpace();
      if(this.s[this.i]==="(" && isFuncName(id)){ this.i++; const e=this.parseExpr(); this.eat(")"); return `${FUNC_RENAME[id]||id}(${e})`; }
      return id;
    }
    if(c==="\\"){
      const m=this.readMacro();
      if(!m) return "";
      if(m.sym!=null) return m.sym;
      const name=m.name;
      if(name==="frac"||name==="dfrac"||name==="tfrac"){ const a=this.readBraced(); const b=this.readBraced();
        const an=new LatexParser(a).parseExpr(); const bn=new LatexParser(b).parseExpr();
        const ap=fracNeedsParens(an)?`(${an})`:an;
        const bp=fracNeedsParens(bn)?`(${bn})`:bn;
        return `${ap}/${bp}`;
      }
      if(name==="sqrt"){
        this.skipSpace();
        if(this.s[this.i]==="["){ let j=this.i+1,idx=""; while(this.s[j]!=="]"&&j<this.s.length){idx+=this.s[j];j++;} this.i=j+1;
          const a=this.readBraced(); const an=new LatexParser(a).parseExpr(); const idxn=new LatexParser(idx).parseExpr();
          return `(${an})^(1/(${idxn}))`;
        }
        const a=this.readBraced(); return `sqrt(${new LatexParser(a).parseExpr()})`;
      }
      if(name==="sum"||name==="prod"){
        // \sum_{i=lo}^{hi} body   (sub/sup may be in either order)
        const {sub,sup}=this.readSubSup();
        // sub is "i=lo" (or just "lo"); split on '='.
        let idx="i", lo=sub;
        const eq=sub.indexOf("=");
        if(eq>=0){ idx=sub.slice(0,eq).trim()||"i"; lo=sub.slice(eq+1); }
        const loT=new LatexParser(lo).parseExpr();
        const hiT=new LatexParser(sup).parseExpr();
        const body=this.parseBigopBody();
        const fn = name==="sum" ? "summation" : "product";
        return `${fn}(${body},${idx},${loT},${hiT})`;
      }
      if(name==="int"){
        // \int_{a}^{b} body \, d x
        const {sub,sup}=this.readSubSup();
        const aT=new LatexParser(sub).parseExpr();
        const bT=new LatexParser(sup).parseExpr();
        const {body,varName}=this.parseIntegralBody();
        return `integrate(${body},${varName},${aT},${bT})`;
      }
      if(name==="operatorname"||name==="mathrm"||name==="mathit"||name==="text"||name==="mathbf"){
        const inner=this.readBraced();
        return this.maybeApply(inner.trim());
      }
      if(MACRO_FUNC.has(name)){ return this.applyFunc(FUNC_RENAME[name]||name); }
      if(name in MACRO_IDENT){ return MACRO_IDENT[name]; }
      return "";
    }
    this.i++;
    return "";
  }
  maybeApply(id){
    if(MACRO_FUNC.has(id) || isFuncName(id)) return this.applyFunc(FUNC_RENAME[id]||id);
    return id;
  }
  applyFunc(fname){
    this.skipSpace();
    if(this.s[this.i]==="("){ this.i++; const e=this.parseExpr(); this.eat(")"); return `${fname}(${e})`; }
    if(this.s[this.i]==="{"){ const inner=this.readBraced(); return `${fname}(${new LatexParser(inner).parseExpr()})`; }
    const arg=this.parseFactor();
    return `${fname}(${arg})`;
  }
  // Read the _{…}^{…} (or ^{…}_{…}) bound groups after \sum/\prod/\int. Each
  // bound may also be a single unbraced token (e.g. \sum_1^n).
  readSubSup(){
    let sub="", sup="";
    for(let pass=0; pass<2; pass++){
      this.skipSpace();
      const c=this.s[this.i];
      if(c==="_"){ this.i++; sub=this.readScriptArg(); }
      else if(c==="^"){ this.i++; sup=this.readScriptArg(); }
      else break;
    }
    return { sub, sup };
  }
  // A script argument: a braced group {…} or a single token.
  readScriptArg(){
    this.skipSpace();
    if(this.s[this.i]==="{") return this.readBraced();
    // single char / macro
    const c=this.s[this.i];
    if(c==="\\"){ const start=this.i; this.readMacro(); return this.s.slice(start,this.i); }
    if(c!=null){ this.i++; return c; }
    return "";
  }
  // The summand/multiplicand after \sum/\prod bounds: take one term (so
  // "\sum_{i=1}^{n} i^2 + x" binds the i^2 to the sum, then +x is outside).
  parseBigopBody(){
    const t=this.parseTerm();
    return t;
  }
  // The integrand after \int bounds, up to the trailing "\, d x" or "dx".
  // Returns { body, varName }. Falls back to var "x" if no d-var is found.
  parseIntegralBody(){
    const term=this.parseIntegrandUntilD();
    const varName=term.varName||"x";
    return { body:term.body, varName };
  }
  // Parse an integrand term, stopping when we hit a "d<var>" differential.
  parseIntegrandUntilD(){
    let parts=[]; let varName="x";
    for(;;){
      this.skipSpace();
      const c=this.s[this.i];
      if(c==null) break;
      // differential "d <var>" — d, optional whitespace, then a single letter
      // not part of a longer identifier. Covers "dx", "d x", "\,d x".
      if(c==="d"){
        let j=this.i+1;
        while(this.s[j]===" "||this.s[j]==="\t") j++;
        if(/[A-Za-z]/.test(this.s[j]||"") && !/[A-Za-z0-9_]/.test(this.s[j+1]||"")){
          varName=this.s[j]; this.i=j+1; break;
        }
      }
      if(this.s.startsWith("\\mathrm{d}",this.i)){ this.i+=10; this.skipSpace();
        if(/[A-Za-z]/.test(this.s[this.i]||"")){ varName=this.s[this.i]; this.i++; } break; }
      if(c==="+"||c==="-"||c===")"||c==="|") break;
      const f=this.parseFactor();
      if(f==="") break;
      parts.push(f);
      this.skipSpace();
      if(this.s[this.i]==="*"){ this.i++; }
      else if(this.s.startsWith("\\cdot",this.i)){ this.i+=5; }
    }
    const body=parts.length?parts.join("*"):"0";
    return { body, varName };
  }
}

function isFuncName(id){
  return ["sin","cos","tan","asin","acos","atan","sinh","cosh","tanh","exp","ln",
    "log","sqrt","abs","sign","floor","ceil","min","max","cbrt","round","atan2",
    "pow","hypot"].includes(id);
}
function needsParens(s){ return /[+\-*/^]/.test(s) && s.length>1 && !alreadyWrapped(s); }
// A fraction operand needs parens only if it contains an operator at the top
// level that binds looser than '/'. Single tokens, function calls and powers
// are safe bare. Be conservative: wrap if it has +,-,*,/ outside of parens.
function fracNeedsParens(s){
  if(s.length<=1) return false;
  if(alreadyWrapped(s)) return false;
  let depth=0;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c==="("||c==="[") depth++;
    else if(c===")"||c==="]") depth--;
    else if(depth===0 && (c==="+"||c==="*"||c==="/"||(c==="-"&&i>0))) return true;
  }
  return false;
}
// Is the whole string a single parenthesized group, e.g. "(x+1)" (so adding
// another pair would be redundant)? Checks the outermost pair spans the string.
function alreadyWrapped(s){
  if(s[0]!=="(" || s[s.length-1]!==")") return false;
  let depth=0;
  for(let i=0;i<s.length;i++){
    if(s[i]==="(") depth++;
    else if(s[i]===")"){ depth--; if(depth===0 && i!==s.length-1) return false; }
  }
  return depth===0;
}
