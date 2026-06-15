import { useRef, useEffect, useState } from "react";
import { useUI } from "../theme/tokens.jsx";
import { textToLatex, latexToText } from "../core/mathlatex.js";

// ── Live typeset expression editor (Desmos / GeoGebra style) ─────────────────
// Wraps MathLive's <math-field> custom element. The app's source of truth stays
// a plain mathjs-style string (the `v` prop); this component projects it to
// LaTeX for typeset editing and converts edits back to text via onChange. So
// every other consumer (builders, GLSL, serialization, scope eval) is unchanged.
//
// API mirrors MathInput/EI: { v, sc, onChange, placeholder }. `sc` (scope) is
// accepted for parity and used only to highlight in-scope variables; evaluation
// still happens downstream against the text value.

// MathLive registers a global custom element + needs its fonts. Load once.
let _mlPromise=null;
function ensureMathLive(){
  if(_mlPromise) return _mlPromise;
  _mlPromise=import("mathlive").then(ml=>{
    const ME=ml.MathfieldElement;
    if(ME){
      // Fonts copied into /public/mathlive/fonts by the build; point MathLive at
      // them so radicals/Greek render. Sounds disabled (no asset, and silent
      // editing fits a properties panel).
      try{ ME.fontsDirectory="/mathlive/fonts"; }catch{}
      try{ ME.soundsDirectory=null; }catch{}
    }
    injectGlobalCSS();
    return ml;
  });
  return _mlPromise;
}

// Hide the per-field toggles (virtual-keyboard + menu) and drop MathLive's
// focus outline so an expression box reads like the app's other inputs. These
// target exposed CSS ::part()s from the light DOM. Injected once.
let _cssInjected=false;
function injectGlobalCSS(){
  if(_cssInjected||typeof document==="undefined") return;
  _cssInjected=true;
  const s=document.createElement("style");
  s.textContent=`
    math-field::part(virtual-keyboard-toggle),
    math-field::part(menu-toggle){ display:none !important; }
    math-field:focus-within{ outline:none !important; }
    math-field{ outline:none !important; }
    /* Tighten MathLive's built-in container padding/min-height so the field
       matches the height of the app's other inputs, and let the background
       (set per-element from the theme) fill the whole control. */
    math-field::part(container){ min-height:1.7em !important; padding:1px 2px !important; }
  `;
  document.head.appendChild(s);
}

// Decide whether a hex color is "light" so we can pick MathLive's matching base
// theme (its internal element backgrounds/menus differ between light and dark).
// We then override the visible colors with the app's exact tokens on top.
function isLightColor(hex){
  if(typeof hex!=="string") return false;
  let h=hex.replace("#","").trim();
  if(h.length===3) h=h.split("").map(c=>c+c).join("");
  if(h.length<6) return false;
  const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
  if([r,g,b].some(n=>Number.isNaN(n))) return false;
  // Relative luminance (sRGB approximation).
  const lum=(0.2126*r+0.7152*g+0.0722*b)/255;
  return lum>0.5;
}

function MathField({ v, sc, onChange, placeholder }){
  const { ui }=useUI();
  const hostRef=useRef(null);      // wrapper div
  const mfRef=useRef(null);        // <math-field> element
  const [ready,setReady]=useState(false);
  const [empty,setEmpty]=useState((v??"")==="");
  const [foc,setFoc]=useState(false);
  const valRef=useRef(v??"");      // latest text value
  const scRef=useRef(sc??null);    // latest scope for latexToText
  const focusedRef=useRef(false);
  const onChangeRef=useRef(onChange);
  onChangeRef.current=onChange;
  scRef.current=sc??null;

  // Mount the math-field once MathLive is loaded.
  useEffect(()=>{
    let cancelled=false;
    ensureMathLive().then(()=>{
      if(cancelled||!hostRef.current) return;
      const mf=document.createElement("math-field");

      // IMPORTANT: append to the DOM *first*. MathLive builds its internal
      // mathfield in the custom element's connectedCallback; its property
      // setters and setValue/getValue throw "Mathfield not mounted" until then.
      hostRef.current.appendChild(mf);

      // Configure behaviour now that the element is connected. Wrap in a guard:
      // if the upgrade hasn't completed for any reason, fall back to attributes.
      const configure=()=>{
        try{
          mf.smartFence=true;            // auto-close ( [ { and \left\right
          mf.smartMode=false;            // don't switch to text mode on words
          mf.removeExtraneousParentheses=true;
          // Never pop the virtual keyboard: manual policy + hide the toggle.
          mf.mathVirtualKeyboardPolicy="manual";
          mf.menuItems=[];               // no context menu
          // Override the bounded-operator shortcuts so they insert templates the
          // app's evaluator understands: an index variable in the sum/prod
          // subscript, and a differential for integrals. #? are tab-able
          // placeholders. Merge over the existing table to keep Greek/const
          // shortcuts intact.
          mf.inlineShortcuts={
            ...mf.inlineShortcuts,
            sum:"\\sum_{i=#?}^{#?}#?",
            prod:"\\prod_{i=#?}^{#?}#?",
            int:"\\int_{#?}^{#?}#?\\,d#?",
          };
        }catch{
          mf.setAttribute("smart-mode","false");
          mf.setAttribute("math-virtual-keyboard-policy","manual");
        }
        mf.style.width="100%";
        mf.style.fontSize="16px";
        // Seed initial value (setValue is safe once connected).
        try{ mf.setValue(textToLatex(valRef.current),{ silenceNotifications:true }); }
        catch{ mf.value=textToLatex(valRef.current); }
      };
      configure();

      const onInput=()=>{
        const latex=mf.getValue ? mf.getValue("latex") : (mf.value||"");
        const text=latexToText(latex, scRef.current);
        valRef.current=text;
        setEmpty(text==="");
        onChangeRef.current && onChangeRef.current(text);
      };
      const onFocus=()=>{ focusedRef.current=true; setFoc(true); };
      const onBlur=()=>{ focusedRef.current=false; setFoc(false);
        // Re-seed from canonical text so the typeset form normalizes on blur.
        // Compare by text (LaTeX is normalized internally by MathLive).
        if(!mf.isConnected) return;
        try{
          const curText=latexToText(mf.getValue("latex"), scRef.current);
          if(curText!==valRef.current) mf.setValue(textToLatex(valRef.current),{ silenceNotifications:true });
        }catch{ /* not mounted */ }
      };
      mf.addEventListener("input",onInput);
      mf.addEventListener("focusin",onFocus);
      mf.addEventListener("focusout",onBlur);

      mfRef.current=mf;
      setReady(true);
    });
    return ()=>{ cancelled=true;
      const mf=mfRef.current;
      if(mf){ mf.remove(); mfRef.current=null; }
    };
  },[]);

  // External value change (e.g. switching selected node): re-seed, but never
  // while the user is actively typing in this field (would fight the caret).
  // Compare by *text* value, not raw LaTeX — MathLive normalizes the LaTeX it
  // stores (e.g. "{ x}^{2}" → "x^2"), so a raw-LaTeX compare would never match
  // and we'd re-seed (and reset the caret) on every render.
  useEffect(()=>{
    valRef.current=v??"";
    setEmpty((v??"")==="");
    const mf=mfRef.current;
    // Only touch the field if it exists, is still connected to the DOM, and the
    // user isn't actively typing in it. getValue/setValue throw "Mathfield not
    // mounted" if called on a disconnected element (e.g. mid-remount).
    if(!mf||!mf.isConnected||focusedRef.current) return;
    let curText;
    try{ curText=latexToText(mf.getValue("latex")); }
    catch{ return; }
    if(curText!==(v??"")){
      try{ mf.setValue(textToLatex(v??""),{ silenceNotifications:true }); }
      catch{ /* element not ready; mount effect will seed it */ }
    }
  },[v,ready]);

  // Theme the mathfield from the app's *actual* UI tokens (not just a generic
  // light/dark). We pick MathLive's matching base theme by the input-background
  // luminance so its internal element styling is in the right family, then
  // override every visible color with the exact app token.
  useEffect(()=>{
    const mf=mfRef.current;
    if(!mf) return;
    // Base theme = nearest of MathLive's two built-ins, chosen from the app bg.
    mf.setAttribute("theme", isLightColor(ui.uiInputBg) ? "" : "dark");
    // Background + glyph color carry the app's input palette. The math content
    // inherits `color`; the field background must be set on the element (the
    // wrapper behind it also uses uiInputBg, so they line up).
    mf.style.background=ui.uiInputBg;
    mf.style.color=ui.uiInputText;
    mf.style.setProperty("--caret-color",ui.uiInputText);
    mf.style.setProperty("--text-color",ui.uiInputText);
    mf.style.setProperty("--latex-color",ui.uiInputText);
    mf.style.setProperty("--selection-background-color",ui.uiAccent+"44");
    mf.style.setProperty("--selection-color",ui.uiInputText);
    mf.style.setProperty("--placeholder-color",ui.uiFaint);
    mf.style.setProperty("--placeholder-opacity","1");
    mf.style.setProperty("--contains-highlight-background-color","transparent");
    mf.style.setProperty("--smart-fence-color",ui.uiMuted);
    mf.style.setProperty("--primary-color",ui.uiAccent);
    // Some MathLive builds read --primary for the caret/accents.
    mf.style.setProperty("--primary",ui.uiAccent);
  },[ui,ready]);

  return (
    <div style={{ position:"relative" }}>
      <div ref={hostRef}
        style={{
          background:ui.uiInputBg,
          border:`1px solid ${foc?ui.uiAccent:ui.uiInputBorder}`,
          borderRadius:4,
          minHeight:"2.4em",
          display:"flex",
          alignItems:"center",
          padding:"2px 6px",
          transition:"border-color 0.1s",
        }}/>
      {ready && empty && placeholder &&
        <div style={{ position:"absolute", top:"50%", left:10, transform:"translateY(-50%)",
          fontFamily:"ui-monospace,Menlo,Consolas,monospace", fontSize:15, color:ui.uiFaint,
          pointerEvents:"none" }}>{placeholder}</div>}
      {!ready &&
        <div style={{ position:"absolute", top:"50%", left:10, transform:"translateY(-50%)",
          fontSize:13, color:ui.uiFaint, pointerEvents:"none" }}>…</div>}
    </div>
  );
}

// XF — expression field. Same props as EI; used at call sites that take a free
// mathematical expression (curve/surface formulas, fn outputs, color values)
// rather than a scalar bound (min/max/res/domain), which keep the plain EI.
function XF(props){ return <MathField {...props}/>; }

export { MathField, XF };
