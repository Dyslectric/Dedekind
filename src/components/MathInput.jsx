import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useUI, relLum, darken } from "../theme/tokens.jsx";
import { MATH_CONSTANTS, MATH_FUNCS, MATH_BOUND, tokenizeMath, classifyIdent, tokenColor } from "../core/identClass.js";
import { LiveMathInput, LiveMathInputMemo } from "./LiveMathInput.jsx";
import { useUISetting } from "../core/uisettings.js";

// ── Math expression tokenizer ────────────────────────────────────────────────
// (tokenizeMath, identifier classification, and the MATH_* vocab live in
// core/identClass.js.)

// Number literals get a warm orange. The base tone reads well on the default
// dark input background but is nearly invisible on a light/cream one, so darken
// it toward a deeper amber as the input background gets lighter. Keyed off the
// background's relative luminance so it adapts to any theme, not just two cases.
const NUM_BASE = "#d6a86a";
function numberColor(inputBg){
  const lum = relLum(inputBg || "#070918");
  if(lum < 0.4) return NUM_BASE;            // dark bg: original orange reads fine
  // Light bg: darken progressively (more for lighter backgrounds) so the orange
  // keeps contrast without losing its identity.
  const amt = Math.min(0.62, 0.28 + (lum - 0.4) * 0.7);
  return darken(NUM_BASE, amt);
}
// Prettify a token stream for the preview line (× · superscripts · Greek).
const GREEK={pi:"π",tau:"τ",phi:"φ",theta:"θ",alpha:"α",beta:"β",gamma:"γ",lambda:"λ",mu:"μ",omega:"ω",sigma:"σ",delta:"δ",rho:"ρ",epsilon:"ε"};
const SUP={"0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹","-":"⁻","+":"⁺","(":"⁽",")":"⁾","n":"ⁿ","x":"ˣ"};
function prettyPreview(str){
  if(!str) return "";
  const toks=tokenizeMath(str); let out=""; 
  for(let i=0;i<toks.length;i++){
    const tk=toks[i];
    if(tk.t==="ident"&&GREEK[tk.v]){ out+=GREEK[tk.v]; continue; }
    if(tk.t==="op"&&tk.v==="*"){ out+="·"; continue; }
    if(tk.t==="op"&&tk.v==="^"){
      // superscript the following number/ident/paren-group if simple
      const nx=toks[i+1];
      if(nx&&(nx.t==="num"||nx.t==="ident")&&[...nx.v].every(ch=>SUP[ch])){ out+=[...nx.v].map(ch=>SUP[ch]).join(""); i++; continue; }
      out+="^"; continue;
    }
    out+=tk.v;
  }
  return out;
}

// Highlighted, prettified math input. Transparent <input> over a colored,
// monospace-aligned overlay (so the caret lines up); a prettified preview sits
// below. In-scope ("evaluated") tokens are highlighted.
// Caret helpers for the contentEditable field: save/restore by absolute text
// offset so re-colorizing the spans doesn't move the cursor.
function caretOffset(el){
  const sel=window.getSelection&&window.getSelection();
  if(!sel||sel.rangeCount===0) return null;
  const range=sel.getRangeAt(0);
  if(!el.contains(range.startContainer)) return null;
  const pre=range.cloneRange(); pre.selectNodeContents(el); pre.setEnd(range.startContainer,range.startOffset);
  return pre.toString().length;
}
function setCaret(el,offset){
  if(offset==null) return;
  const sel=window.getSelection(); if(!sel) return;
  let remaining=offset, node=null, nodeOff=0;
  const walk=(n)=>{
    if(node) return;
    if(n.nodeType===3){ const len=n.textContent.length;
      if(remaining<=len){ node=n; nodeOff=remaining; } else remaining-=len;
    } else { for(const c of n.childNodes){ walk(c); if(node) return; } }
  };
  walk(el);
  const range=document.createRange();
  if(node){ range.setStart(node,nodeOff); }
  else { range.selectNodeContents(el); range.collapse(false); }
  range.collapse(true);
  sel.removeAllRanges(); sel.addRange(range);
}

function MathInput({v,sc,onChange,placeholder,multiline}){
  const{ui}=useUI();
  const ref=useRef(null);
  const[empty,setEmpty]=useState(!((v??"")!==""));
  const[foc,setFoc]=useState(false);
  const valRef=useRef(v??"");

  // Render the colored spans for a string into the editable element, then
  // restore the caret to `caret` (absolute offset) if provided.
  const paint=useCallback((str,caret)=>{
    const el=ref.current; if(!el) return;
    const toks=tokenizeMath(str);
    // build DOM
    el.textContent="";
    for(const tk of toks){
      const span=document.createElement("span");
      span.textContent=tk.v;
      if(tk.t==="ident"){const cl=classifyIdent(tk.v,sc);const col=tokenColor(cl,ui);
        span.style.color=col.c; if(col.w==="bold")span.style.fontWeight="700";
        if(col.bg){span.style.background=col.bg;span.style.borderRadius="3px";}
      } else if(tk.t==="num"){ span.style.color=numberColor(ui.uiInputBg); }
      else if(tk.t==="index"){ span.style.color=ui.uiAccent; span.style.fontStyle="italic"; }
      else if(tk.t==="op"){ span.style.color=ui.uiMuted; }
      else { span.style.color=ui.uiInputText; }
      el.appendChild(span);
    }
    if(caret!=null) setCaret(el,caret);
  },[sc,ui]);

  // External value change (e.g. switching selected node): repaint.
  useEffect(()=>{
    valRef.current=v??"";
    setEmpty((v??"")==="");
    if(ref.current && document.activeElement!==ref.current) paint(v??"",null);
  },[v,paint]);
  // Repaint when scope/theme changes (highlighting may change) while not editing.
  // Guard against redundant DOM work: only repaint if the set of in-scope value
  // names referenced by THIS expression actually changed. A running animation
  // bumps the scope object's identity at the preview rate, but unless it adds or
  // removes a value name this field highlights, the painted output is identical.
  const hlSigRef=useRef("");
  useEffect(()=>{
    const el=ref.current; if(!el || document.activeElement===el) return;
    const toks=tokenizeMath(valRef.current||"");
    const names=[];
    for(const tk of toks){ if(tk.t!=="ident") continue;
      const cl=classifyIdent(tk.v,sc); if(cl==="scopeVal"||cl==="scopeFn") names.push(tk.v+":"+cl);
    }
    const sig=names.sort().join(",")+"|"+(ui&&ui.uiAccent);
    if(sig===hlSigRef.current) return;   // nothing visible changed
    hlSigRef.current=sig;
    paint(valRef.current,null);
  },[sc,ui,paint]);

  const onInput=()=>{
    const el=ref.current; if(!el) return;
    const str=el.textContent;
    valRef.current=str; setEmpty(str==="");
    const caret=caretOffset(el);
    paint(str,caret);                 // re-colorize, keep caret in place
  };
  const commit=()=>onChange(valRef.current);

  return<div>
    <div style={{position:"relative",background:ui.uiInputBg,border:`1px solid ${foc?ui.uiAccent:ui.uiInputBorder}`,borderRadius:4,
      display:"flex",alignItems:multiline?"stretch":"center",minHeight:multiline?"5.4em":"1.9em"}}>
      <div ref={ref} contentEditable suppressContentEditableWarning spellCheck={false}
        data-math-input=""
        onInput={onInput}
        onFocus={()=>setFoc(true)}
        onBlur={()=>{setFoc(false);commit();}}
        onKeyDown={e=>{ if(!multiline&&e.key==="Enter"){e.preventDefault();commit();ref.current&&ref.current.blur();} }}
        style={{
          flex:1,minWidth:0,
          fontFamily:"ui-monospace,Menlo,Consolas,monospace",fontSize:15,lineHeight:1.5,
          color:ui.uiInputText,caretColor:ui.uiInputText,padding:multiline?"5px 7px":"0 7px",outline:"none",
          whiteSpace:multiline?"pre-wrap":"pre",
          overflowX:multiline?"hidden":"auto",overflowY:multiline?"auto":"hidden",
          maxHeight:multiline?"14em":undefined,
          wordBreak:multiline?"break-word":"normal",boxSizing:"border-box",
        }}/>
      {empty&&<div style={{position:"absolute",top:multiline?"5px":"50%",transform:multiline?"none":"translateY(-50%)",left:7,right:7,
        fontFamily:"ui-monospace,Menlo,Consolas,monospace",fontSize:15,lineHeight:1.5,color:ui.uiFaint,
        pointerEvents:"none",whiteSpace:multiline?"pre-wrap":"pre",overflow:"hidden"}}>{placeholder||""}</div>}
    </div>
    {!empty&&(()=>{const pp=prettyPreview(valRef.current);return pp&&pp!==valRef.current?<div style={{fontFamily:"Georgia,'Times New Roman',serif",fontStyle:"italic",fontSize:15,color:ui.uiMuted,padding:"2px 7px 0",lineHeight:1.4}}>{pp}</div>:null;})()}
    {(()=>{const toks=tokenizeMath(valRef.current);const ev=toks.filter(tk=>tk.t==="ident"&&(classifyIdent(tk.v,sc)==="scopeVal"||classifyIdent(tk.v,sc)==="scopeFn"));return ev.length?<div style={{fontSize:12,color:ui.uiAccent,opacity:0.75,padding:"1px 7px 0"}}>● uses evaluated value{ev.length>1?"s":""}</div>:null;})()}
  </div>;
}
// EI — scalar/bound field (min/max/res/domain numbers, etc).
// XF — free-expression field (curve/surface formulas, fn outputs, color exprs).
// Both render the same input; they differ only in name so call sites read
// intentionally. The active input is chosen by the project-level "math input
// mode" setting: "plain" → the contentEditable highlighter (MathInput), "live"
// → the from-scratch typeset editor (LiveMathInput). Switching is non-destructive
// since both edit the same plain mathjs text string. Sums/integrals/products are
// typed as ordinary text (summation/integrate/product) in either mode.
function MathField2(props){
  const mode = useUISetting("mathInputMode");
  return mode==="live" ? <LiveMathInputMemo {...props}/> : <MathInput {...props}/>;
}
function EI({v,sc,onChange,placeholder}){ return <MathField2 v={v} sc={sc} onChange={onChange} placeholder={placeholder}/>; }
function XF({v,sc,onChange,placeholder}){ return <MathField2 v={v} sc={sc} onChange={onChange} placeholder={placeholder}/>; }

// NameField — a single-identifier input (variable / axis-variable / scalar names).
// In live mode it's the typeset LiveMathInput in nameMode (italic KaTeX, greek
// \name→glyph, subscript display, identifier-only). In plain mode it's a plain
// text input filtered to identifier characters. Both enforce the mathjs rule
// that a name can't begin with a digit/underscore. `width` sizes the field.
function NameField({v,onChange,placeholder,width}){
  const mode = useUISetting("mathInputMode");
  const clean = s => (s||"").replace(/^[0-9_]+/, "");   // valid identifier start
  if(mode==="live"){
    return <div style={{width:width||"100%"}}><LiveMathInput
      v={v||""} sc={null} nameMode placeholder={placeholder}
      onChange={val=>onChange(clean(val))}
      hostStyle={{minHeight:"1.9em",padding:"2px 6px"}}/></div>;
  }
  return <MathInput v={v||""} sc={null} placeholder={placeholder}
    onChange={val=>onChange(clean((val||"").replace(/[^A-Za-z0-9_\u0370-\u03ff\u03d0-\u03f6]/g,"")))}/>;
}

export {
  MATH_CONSTANTS, MATH_FUNCS, MATH_BOUND, tokenizeMath, classifyIdent, tokenColor,
  GREEK, SUP, prettyPreview, caretOffset, setCaret, MathInput, EI, XF, NameField
};
