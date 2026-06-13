import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useUI } from "../theme/tokens.jsx";

// ── Math expression tokenizer + highlighting ─────────────────────────────────
const MATH_CONSTANTS=new Set(["pi","e","tau","phi","Inf","Infinity"]);
const MATH_FUNCS=new Set(["sin","cos","tan","asin","acos","atan","atan2","sinh","cosh","tanh","exp","log","ln","log10","log2","sqrt","cbrt","abs","sign","floor","ceil","round","fract","mod","pow","min","max","gamma","factorial","hypot","norm","dot","cross"]);
const MATH_BOUND=new Set(["x","y","z","u","v","s","r","t","n","i","j","k"]); // loop/param/index vars
function tokenizeMath(str){
  const toks=[]; const re=/(\s+)|([A-Za-z_]\w*)|(\d+\.?\d*(?:[eE][+-]?\d+)?)|(\[[^\]]*\])|([+\-*/^%(),.|])|(.)/g;
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
      } else if(tk.t==="num"){ span.style.color="#d6a86a"; }
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
function EI({v,sc,onChange,placeholder}){ return <MathInput v={v} sc={sc} onChange={onChange} placeholder={placeholder}/>; }

export {
  MATH_CONSTANTS, MATH_FUNCS, MATH_BOUND, tokenizeMath, classifyIdent, tokenColor,
  GREEK, SUP, prettyPreview, caretOffset, setCaret, MathInput, EI
};
