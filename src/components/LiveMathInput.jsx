import { useRef, useEffect, useState, useCallback, useLayoutEffect } from "react";
import { useUI, relLum, darken } from "../theme/tokens.jsx";
import { classifyIdent, tokenColor, GREEK_NAMES } from "../core/identClass.js";
import { layoutMath } from "../core/mathmeasure.js";

// ── LiveMathInput ─────────────────────────────────────────────────────────────
// A from-scratch typeset math editor. The plain mathjs text string (`v`) is the
// single source of truth; we maintain our own caret index into it and render the
// expression typeset (fractions, exponents, ∑/∫/∏, √) via the pure layout core.
// The browser never manages the caret or the structure — we draw both — so none
// of the contentEditable/MathLive structural-editing breakage applies here.
//
// PROPS mirror the old MathInput so EI/XF can adopt it as a drop-in:
//   { v, sc, onChange, placeholder }
//
// FONT METRICS: the pure layout uses nominal per-glyph widths (em units). Real
// glyph advance differs by font, which would make the caret drift from the text.
// We correct this by measuring the actual pixel width of one reference glyph in
// the live font and scaling the layout's x-coordinates by (realCharPx / nominal).
// Because the field is monospace, a single ratio is accurate for plain runs; the
// structural pieces (fractions/exponents) are positioned relative to those runs
// so they ride along correctly.

const NUM_BASE = "#d6a86a";
function numberColor(inputBg){
  const lum = relLum(inputBg || "#070918");
  if(lum < 0.4) return NUM_BASE;
  return darken(NUM_BASE, Math.min(0.62, 0.28 + (lum-0.4)*0.7));
}

// Map a box's classification to a fill color, mirroring the old highlighter.
function boxColor(box, sc, ui){
  if(box.tk==="ident"){
    const cl = classifyIdent(box.v!=null?box.v:box.text, sc);
    return tokenColor(cl, ui);
  }
  if(box.tk==="num") return { c: numberColor(ui.uiInputBg), w:"normal" };
  if(box.tk==="op" || box.tk==="call") return { c: ui.uiMuted, w:"normal" };
  return { c: ui.uiInputText, w:"normal" };
}

// KaTeX math fonts (vendored in /public/katex-fonts, declared in index.html).
// Variables + greek use the italic Math face; numbers, operators, parens use
// the upright Main face; the large operators (∑ ∏ ∫ √) come from the Size faces.
const FONT_VAR  = '"KaTeX_Math","Cambria Math",serif';        // italic letters/greek
const FONT_MAIN = '"KaTeX_Main","Cambria Math",serif';        // upright digits/ops/parens
const FONT_SIZE = '"KaTeX_Size1","Cambria Math",serif'; // big operators (inline size)
const FONT = FONT_MAIN;        // default/fallback
const BASE_PX = 20;            // base font size for the field
const NOMINAL_CHAR_EM = 0.55;  // fallback only

// Map a layout "kind" to the font family used to render (and measure) it.
function fontForKind(kind){
  if(kind==="var") return FONT_VAR;
  return FONT_MAIN;  // num, op, main, parens
}

// A shared offscreen canvas to measure real glyph advances in the math fonts.
let _mctx=null;
function measureCtx(){ if(!_mctx){ const c=document.createElement("canvas"); _mctx=c.getContext("2d"); } return _mctx; }

// nameMode: restrict to a single identifier (for variable-name fields). Greek
// \name conversion and subscript DISPLAY still apply, but template auto-expansion
// (sum/int/prod/sqrt) is off and only identifier characters are accepted, so a
// name can never accidentally become a fraction/exponent/operator expression.
function LiveMathInput({ v, sc, onChange, placeholder, nameMode, hostStyle, outerStyle }){
  const { ui } = useUI();
  const hostRef = useRef(null);
  const valRef = useRef(v ?? "");
  const caretRef = useRef((v ?? "").length);   // caret = text index (the focus end)
  const anchorRef = useRef(null);              // selection anchor; null = no selection
  const fieldStopsRef = useRef(null);          // sorted caret offsets of the active template's slots
  const [focused, setFocused] = useState(false);
  const [, force] = useState(0);     // re-render trigger
  const rerender = useCallback(()=>force(n=>n+1), []);
  const [fontsReady, setFontsReady] = useState(false);
  const [hostW, setHostW] = useState(0);

  // Re-render once the KaTeX fonts have actually loaded, so measurement uses the
  // real metrics (not the fallback serif) and the caret aligns.
  useEffect(()=>{
    if(typeof document==="undefined" || !document.fonts) { setFontsReady(true); return; }
    let alive=true;
    Promise.all([
      document.fonts.load(`${BASE_PX}px "KaTeX_Math"`),
      document.fonts.load(`${BASE_PX}px "KaTeX_Main"`),
      document.fonts.load(`${BASE_PX}px "KaTeX_Size1"`),
      document.fonts.load(`${BASE_PX}px "KaTeX_Size2"`),
    ]).then(()=>{ if(alive){ setFontsReady(true); rerender(); } }).catch(()=>{ if(alive) setFontsReady(true); });
    return ()=>{ alive=false; };
  }, [rerender]);

  // Measured-width function passed into the layout: returns the em-width (px /
  // BASE_PX) of `str` rendered in the font for `kind`, via canvas measureText.
  // Cached per (kind,str). Falls back to nominal if canvas is unavailable.
  const widthCache = useRef(new Map());
  const widthOf = useCallback((str, kind)=>{
    const key = kind+"\u0000"+str;
    const cache = widthCache.current;
    const hit = cache.get(key);
    if(hit!=null) return hit;
    let em;
    try{
      const ctx = measureCtx();
      ctx.font = `${BASE_PX}px ${fontForKind(kind)}`;
      em = ctx.measureText(str).width / BASE_PX;
    }catch{ em = str.length * NOMINAL_CHAR_EM; }
    cache.set(key, em);
    return em;
  }, []);
  // bust the width cache when fonts finish loading (fallback metrics → real)
  useEffect(()=>{ widthCache.current.clear(); }, [fontsReady]);

  // Track the host's content-box width so the layout can wrap long expressions
  // to fit. ResizeObserver keeps it current through panel resizes / reflows.
  useLayoutEffect(()=>{
    const el = hostRef.current; if(!el || typeof ResizeObserver==="undefined") return;
    const ro = new ResizeObserver(()=>{ const w=el.clientWidth; if(w>0) setHostW(w); });
    ro.observe(el);
    setHostW(el.clientWidth||0);
    return ()=>ro.disconnect();
  }, []);

  // keep valRef in sync with external prop when not focused (selecting a
  // different node, undo, etc.). When focused, the user is the authority.
  useEffect(()=>{
    if(!focused){ valRef.current = v ?? ""; caretRef.current = Math.min(caretRef.current, (v??"").length); anchorRef.current=null; fieldStopsRef.current=null; rerender(); }
  }, [v, focused, rerender]);

  const text = valRef.current;
  // With a measured widthOf, all layout x-metrics are already real em widths, so
  // one em maps straight to BASE_PX — no monospace correction ratio needed.
  const emPx = BASE_PX;
  const PAD_X = 7, PAD_Y = 4;
  const availPx = hostW>0 ? hostW - PAD_X*2 - 2 : 0;     // -2 for border
  const wrapWidthEm = availPx>0 ? availPx / emPx : Infinity;
  const caret = Math.max(0, Math.min(caretRef.current, text.length));
  // Pass the caret only while focused so a sqrt grows to fit its guide-parens
  // exactly when the caret is inside it (and not when the field is inert).
  const layout = layoutMath(text, { scale: 1, wrapWidth: wrapWidthEm, widthOf, caret: focused ? caret : -1 });

  // Convert a layout coordinate to px (em → px; x and y both just scale by emPx).
  const toPxX = (x)=> x * emPx;
  const toPxY = (y)=> y * emPx;

  // Current caret anchor (snap hidden offsets to a drawable one).
  const snapped = layout.snap[caret] ?? caret;
  const caretAnchor = layout.anchors.find(a=>a.offset===snapped) || layout.anchors[0] || { x:0, y:0, h:layout.ascent+layout.descent };

  const contentW = toPxX(layout.width);
  const contentH = toPxY(layout.height!=null ? layout.height : (layout.ascent + layout.descent));

  // ── caret-stop navigation ───────────────────────────────────────────────────
  // A bigop/sqrt is stored as raw text (summation(i,i,1,n)) but should FEEL like
  // an atomic structure: arrows skip its hidden syntax, a single backspace just
  // after it deletes the whole thing, and shift-arrow from outside selects it.
  //
  // "Real" caret stops are offsets that map to themselves in the snap map (a
  // visible/drawable position); offsets hidden inside collapsed syntax snap to a
  // neighbour. nextStop moves to the next real stop in a direction — so one arrow
  // press glides over "ummation(" etc. instead of stalling on each hidden char.
  const isStop = (i)=> i>=0 && i<=text.length && (layout.snap[i]??i)===i;
  const nextStop = (from, dir)=>{
    let i = from + dir;
    while(i>0 && i<text.length && !isStop(i)) i += dir;
    return Math.max(0, Math.min(text.length, i));
  };
  // The structure span (bigop/sqrt) whose START is exactly `off`, if any — used to
  // select/delete the whole unit when the caret sits just before/after it.
  const spanStartingAt = (off)=> (layout.spans||[]).find(s=>s.s===off) || null;
  const spanEndingAt   = (off)=> (layout.spans||[]).find(s=>s.e===off) || null;

  // ── input handling ──────────────────────────────────────────────────────────
  // Selection helpers. anchorRef===null means a collapsed caret. When a range is
  // selected, [selLo, selHi) is the ordered span.
  const selRange = ()=>{
    const c = caretRef.current, a = anchorRef.current;
    if(a==null || a===c) return null;
    return a<c ? [a,c] : [c,a];
  };
  const clearSel = ()=>{ anchorRef.current = null; };

  // Replace [start,end) with `ins`, collapsing selection and placing caret after
  // the inserted text (unless caretAt is given for template field placement).
  const splice = (start, end, ins, caretAt)=>{
    const t = valRef.current;
    const next = t.slice(0,start) + ins + t.slice(end);
    valRef.current = next;
    caretRef.current = caretAt!=null ? caretAt : start + ins.length;
    anchorRef.current = null;
    onChange && onChange(next);
    rerender();
  };

  // Templates: typing the bare words expands to the call form with empty slots,
  // dropping the caret into a starting field. Bigops have four fields (the caret
  // starts at the lower bound; Tab cycles lower → upper → body → index). sqrt
  // has one field — the radicand — and the caret goes straight inside the parens.
  const TEMPLATES = {
    sum:  { text:"summation(,,,)",  // body, idx, lo, hi  → all empty
            // caret offsets of each empty slot, in tab order (lower, upper, body):
            // "summation(" = 10 chars; slots at body=10, idx=11, lo=12, hi=13
            fields:[12,13,10,11], first:12 },
    prod: { text:"product(,,,)",    // "product(" = 8 chars; body=8,idx=9,lo=10,hi=11
            fields:[10,11,8,9], first:10 },
    int:  { text:"integrate(,,,)",  // "integrate(" = 10; body=10,var=11,lo=12,hi=13
            fields:[12,13,10,11], first:12 },
    sqrt: { text:"sqrt()",          // "sqrt(" = 5 chars; radicand slot at offset 5
            fields:[5], first:5 },
  };

  // Detect whether the user just completed a trigger word ending at caret `c`,
  // i.e. the letters immediately before the caret spell a template key AND are a
  // standalone token (not part of a longer identifier like "sumx" or "sqrtx").
  const maybeExpandTemplate = (c)=>{
    const t = valRef.current;
    for(const key of Object.keys(TEMPLATES)){
      const L = key.length;
      if(c>=L && t.slice(c-L,c)===key){
        // boundary checks: char before the word isn't an identifier char, and
        // the char at the caret isn't one either (so "summation" won't trigger
        // on its inner "sum", and "sumx" won't trigger).
        const before = c-L>0 ? t[c-L-1] : "";
        const after  = c<t.length ? t[c] : "";
        const isWord = ch=>/[A-Za-z0-9_]/.test(ch);
        if(!isWord(before) && !isWord(after)){
          const tpl = TEMPLATES[key];
          // replace the trigger word with the template; caret to first field
          const start = c-L;
          const insert = tpl.text;
          const caretAt = start + tpl.first;
          splice(start, c, insert, caretAt);
          // remember field stops for this structure so Tab/arrows can cycle.
          fieldStopsRef.current = tpl.fields.map(off=>start+off).sort((a,b)=>a-b);
          return true;
        }
      }
    }
    // Special trigger: "d/d" → differentiate operator. Distinct from the word
    // templates because the trigger contains "/". Fires when the second "d" lands
    // (so the text just before the caret is "d/d") and the preceding char isn't an
    // identifier char (so "x/d" → nothing, but "d/d" or "2*d/d" triggers).
    if(c>=3 && t.slice(c-3,c)==="d/d"){
      const before = c-3>0 ? t[c-4] : "";
      if(!/[A-Za-z0-9_]/.test(before)){
        const start = c-3;
        // "differentiate(" = 14 chars; then ",,)" → body=14, var=15, point=16
        const insert = "differentiate(,,)";
        const off = start;
        // caret in the VAR slot first; Tab cycles var → body → point
        splice(start, c, insert, off+15);
        fieldStopsRef.current = [off+15, off+14, off+16].sort((a,b)=>a-b);
        return true;
      }
    }
    return false;
  };

  // Convert a completed "\name" greek escape ending at caret `c` into its glyph.
  // Scans back from the caret for a backslash followed by letters; if those
  // letters exactly match a greek name (none is a prefix of another, so a full
  // match is unambiguous), replace "\name" with the single unicode char. Runs on
  // every printable keystroke, so it fires the instant the name is complete.
  const maybeConvertGreek = (c)=>{
    const t = valRef.current;
    // find the backslash that starts the escape immediately before the caret
    let i = c-1;
    while(i>=0 && /[A-Za-z]/.test(t[i])) i--;
    if(i<0 || t[i]!=="\\") return false;
    const name = t.slice(i+1, c);
    const glyph = GREEK_NAMES[name];
    if(!glyph) return false;
    splice(i, c, glyph);   // replace "\name" with the glyph; caret lands after it
    return true;
  };

  const onKeyDown = (e)=>{
    const t = valRef.current; let c = caretRef.current;
    const sel = selRange();
    const shift = e.shiftKey;
    const mod = e.ctrlKey || e.metaKey;

    // Select-all
    if(mod && (e.key==="a"||e.key==="A")){ e.preventDefault(); e.stopPropagation(); anchorRef.current=0; caretRef.current=t.length; rerender(); return; }
    // Copy / Cut
    if(mod && (e.key==="c"||e.key==="C")){ if(sel){ try{navigator.clipboard.writeText(t.slice(sel[0],sel[1]));}catch{} } return; }
    if(mod && (e.key==="x"||e.key==="X")){ if(sel){ try{navigator.clipboard.writeText(t.slice(sel[0],sel[1]));}catch{} splice(sel[0],sel[1],""); } e.preventDefault(); return; }

    if(e.key==="Enter"){ e.preventDefault(); hostRef.current && hostRef.current.blur(); return; }

    if(e.key==="ArrowLeft"){
      e.preventDefault();
      if(shift){
        if(anchorRef.current==null) anchorRef.current=c;
        // from just AFTER a structure, one shift-left selects the whole unit
        const sp = spanEndingAt(c);
        caretRef.current = sp ? sp.s : nextStop(c,-1);
      }
      else if(sel){ caretRef.current=sel[0]; clearSel(); }
      else { caretRef.current = nextStop(c,-1); }
      rerender(); return;
    }
    if(e.key==="ArrowRight"){
      e.preventDefault();
      if(shift){
        if(anchorRef.current==null) anchorRef.current=c;
        // from just BEFORE a structure, one shift-right selects the whole unit
        const sp = spanStartingAt(c);
        caretRef.current = sp ? sp.e : nextStop(c,1);
      }
      else if(sel){ caretRef.current=sel[1]; clearSel(); }
      else { caretRef.current = nextStop(c,1); }
      rerender(); return;
    }
    if(e.key==="Home"){ e.preventDefault(); if(shift){if(anchorRef.current==null)anchorRef.current=c;}else clearSel(); caretRef.current=0; rerender(); return; }
    if(e.key==="End"){ e.preventDefault(); if(shift){if(anchorRef.current==null)anchorRef.current=c;}else clearSel(); caretRef.current=t.length; rerender(); return; }

    // Tab cycles template fields when one is active.
    if(e.key==="Tab" && fieldStopsRef.current){
      e.preventDefault();
      const stops=fieldStopsRef.current;
      const dir = shift?-1:1;
      // find current position among stops, move to next
      let idx = stops.findIndex(s=>s>=c);
      if(idx<0) idx = stops.length-1; else if(stops[idx]!==c && dir<0) idx=Math.max(0,idx-1);
      let ni = idx+dir;
      if(ni<0) ni=stops.length-1; if(ni>=stops.length) ni=0;
      caretRef.current=stops[ni]; clearSel(); rerender(); return;
    }

    if(e.key==="Backspace"){
      e.preventDefault();
      if(sel){ splice(sel[0],sel[1],""); return; }
      // just AFTER a structure → delete the whole unit in one backspace
      const sp = spanEndingAt(c);
      if(sp){ splice(sp.s, sp.e, ""); return; }
      if(c>0){ splice(c-1,c,""); }
      return;
    }
    if(e.key==="Delete"){
      e.preventDefault();
      if(sel){ splice(sel[0],sel[1],""); return; }
      // just BEFORE a structure → delete the whole unit in one delete
      const sp = spanStartingAt(c);
      if(sp){ splice(sp.s, sp.e, ""); return; }
      if(c<t.length){ splice(c,c+1,""); }
      return;
    }

    // printable character
    if(e.key.length===1 && !mod){
      e.preventDefault();
      // In name mode, accept only characters valid in an identifier: ascii
      // letters/digits, underscore (subscript), greek, and backslash (to start a
      // \greek escape). This keeps a name a single identifier — no operators,
      // slashes, parens, etc. — so it can never become an expression.
      if(nameMode && !/[A-Za-z0-9_\u0370-\u03ff\u03d0-\u03f6\\]/.test(e.key)) return;
      const s = sel ? sel[0] : c;
      const en = sel ? sel[1] : c;
      // insert (replacing any selection)
      const t2 = valRef.current;
      const next = t2.slice(0,s) + e.key + t2.slice(en);
      valRef.current = next; caretRef.current = s + 1; anchorRef.current = null;
      // template auto-expansion (sum→∑ etc.) is expression-only; skip in nameMode.
      if(!nameMode && maybeExpandTemplate(caretRef.current)) return;
      // greek escape conversion (\alpha → α) applies in both modes.
      if(maybeConvertGreek(caretRef.current)) return;
      onChange && onChange(next); rerender();
      return;
    }
  };

  const onPaste = (e)=>{
    e.preventDefault();
    let txt = (e.clipboardData||window.clipboardData).getData("text");
    if(!txt) return;
    txt = txt.replace(/\n/g," ");
    if(nameMode) txt = txt.replace(/[^A-Za-z0-9_\u0370-\u03ff\u03d0-\u03f6\\]/g,"");
    const sel=selRange(); const s=sel?sel[0]:caretRef.current, en=sel?sel[1]:caretRef.current; splice(s,en,txt);
  };

  // Click → nearest anchor by x (then offset). Hit-test in px space. Shift-click
  // extends the selection from the existing caret; plain click collapses it.
  const onMouseDown = (e)=>{
    const host = hostRef.current; if(!host) return;
    const rect = host.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD_X;
    let best=null, bestD=Infinity;
    for(const a of layout.anchors){ const ax=toPxX(a.x); const d=Math.abs(ax-px); if(d<bestD){bestD=d;best=a;} }
    if(best){
      if(e.shiftKey){ if(anchorRef.current==null) anchorRef.current=caretRef.current; }
      else { anchorRef.current=null; }
      caretRef.current = best.offset;
    }
    fieldStopsRef.current = null;   // leaving template editing on an explicit click
    requestAnimationFrame(()=>{ host.focus(); rerender(); });
  };

  const empty = text==="";

  return (
    <div style={outerStyle}>
      <div
        ref={hostRef}
        tabIndex={0}
        data-math-input=""
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onMouseDown={onMouseDown}
        onFocus={()=>{ setFocused(true); }}
        onBlur={()=>{ setFocused(false); onChange && onChange(valRef.current); }}
        style={{
          position:"relative",
          background: ui.uiInputBg,
          border:`1px solid ${focused?ui.uiAccent:ui.uiInputBorder}`,
          borderRadius:4,
          minHeight:"1.9em",
          padding:`${PAD_Y}px ${PAD_X}px`,
          cursor:"text",
          outline:"none",
          overflow:"hidden",
          boxSizing:"border-box",
          ...hostStyle,
        }}
      >
        {/* the typeset content, absolutely positioned inside a sized box. When
            wrapping is active the visual width is the available width, not the
            (longer) unwrapped single-line width. */}
        <div style={{ position:"relative",
          width: Math.max(wrapWidthEm<Infinity ? Math.min(contentW, availPx) : contentW, 1),
          height: Math.max(contentH, BASE_PX) }}>
          {/* selection highlight (drawn under the glyphs). v1 spans from the
              low anchor's x to the high anchor's x at full content height — exact
              for flat expressions, approximate across stacked structures. */}
          {(()=>{
            const sel = selRange();
            if(!sel) return null;
            const aLo = layout.anchors.find(a=>a.offset===(layout.snap[sel[0]]??sel[0]));
            const aHi = layout.anchors.find(a=>a.offset===(layout.snap[sel[1]]??sel[1]));
            if(!aLo||!aHi) return null;
            const x0=Math.min(toPxX(aLo.x),toPxX(aHi.x)), x1=Math.max(toPxX(aLo.x),toPxX(aHi.x));
            return <div style={{ position:"absolute", left:x0, top:0, width:Math.max(x1-x0,1), height:contentH,
              background: ui.uiAccent+"33", borderRadius:2, pointerEvents:"none" }}/>;
          })()}
          {layout.boxes.map((box, i)=>{
            const x = toPxX(box.x);
            if(box.type==="slot"){
              // empty fillable field — faint dashed box the user types into
              return <div key={i} style={{
                position:"absolute", left:x+1, top: toPxY(box.y),
                width: Math.max(toPxX(box.w)-2, 4), height: toPxY(box.h),
                border:`1px dashed ${ui.uiFaint}`, borderRadius:2, opacity:0.6,
                boxSizing:"border-box", pointerEvents:"none",
              }}/>;
            }
            if(box.type==="text"){
              const col = boxColor(box, sc, ui);
              // variables/greek render in the italic Math face; numbers, operators
              // and parens in the upright Main face.
              const fam = box.tk==="ident" ? FONT_VAR : FONT_MAIN;
              return <span key={i} style={{
                position:"absolute", left:x, top: toPxY(box.y) - box.scale*emPx*0.78,
                fontFamily:fam, fontSize: box.scale*BASE_PX, lineHeight:1,
                color: col.c, fontWeight: col.w==="bold"?700:400,
                background: col.bg||"transparent", borderRadius: col.bg?3:0,
                whiteSpace:"pre",
              }}>{box.text}</span>;
            }
            if(box.type==="bigglyph"){
              // Render the large operator as a real KaTeX Size-font glyph. The
              // Size fonts are already display-sized, so the font-size is a modest
              // multiple of the base text size (NOT the full metric-box height,
              // which double-counts and made the glyphs huge). The metric box
              // (ga/gd) still positions it and reserves vertical room.
              const fontPx = box.glyphFontEm * BASE_PX;
              // vertical-center the glyph within its metric box
              const boxTop = toPxY(box.y - box.ga);
              const boxH = toPxY(box.ga + box.gd);
              return <span key={i} style={{
                position:"absolute", left:x, top: boxTop, height: boxH,
                display:"inline-flex", alignItems:"center",
                fontFamily:FONT_SIZE, fontSize: fontPx, lineHeight:1, color: ui.uiInputText,
                whiteSpace:"pre",
              }}>{box.glyph}</span>;
            }
            if(box.type==="rule"){
              return <div key={i} style={{
                position:"absolute", left:x, top: toPxY(box.y), width: toPxX(box.w), height: Math.max(1, toPxY(box.h)),
                background: ui.uiInputText,
              }}/>;
            }
            if(box.type==="paren"){
              return <span key={i} style={{
                position:"absolute", left:x, top: toPxY(box.y) - box.scale*emPx*0.78,
                fontFamily:FONT_MAIN, fontSize: box.scale*BASE_PX, lineHeight:1, color: ui.uiMuted,
              }}>{box.which}</span>;
            }
            if(box.type==="sqrt"){
              // SVG radical sized to the full box (which already includes any room
              // reserved for guide-parens when the caret is inside). A bold tick
              // rises across the base lead to the overline; the overline spans the
              // whole box, so it covers the parens too when they're shown.
              const wPx = toPxX(box.w), hPx = toPxY(box.h);
              const tickLeadPx = toPxX(box.tickLead);
              const stroke = Math.max(1.6, BASE_PX*0.085);
              const olY = stroke;                      // overline near the top
              // tick geometry uses the base (tick) lead, not the paren-expanded lead
              const xStart = tickLeadPx*0.02, xValley = tickLeadPx*0.50, xPeak = tickLeadPx*0.90;
              const yEnter = hPx*0.52, yValley = hPx-stroke;
              const pf = (box.radA + box.radD) * emPx * 0.92;
              const pTop = toPxY(box.radBaselineY - box.radA) + (toPxY(box.radA+box.radD)-pf)*0.5;
              return <span key={i}>
                <svg width={wPx} height={hPx} viewBox={`0 0 ${wPx} ${hPx}`}
                  style={{ position:"absolute", left:x, top: toPxY(box.y), color: ui.uiInputText, overflow:"visible", pointerEvents:"none" }}>
                  <path
                    d={`M${xStart} ${yEnter} L${xValley} ${yValley} L${xPeak} ${olY} L${wPx-stroke/2} ${olY}`}
                    fill="none" stroke="currentColor" strokeWidth={stroke}
                    strokeLinejoin="round" strokeLinecap="round"/>
                </svg>
                {box.showParens && <>
                  {/* left paren in the reserved gap between the tick and radicand */}
                  <span style={{ position:"absolute", left: toPxX(box.radL)-pf*0.30, top: pTop,
                    height: pf, display:"inline-flex", alignItems:"center",
                    fontFamily:FONT_MAIN, fontSize: pf, lineHeight:1, color: ui.uiFaint, opacity:0.5, pointerEvents:"none" }}>(</span>
                  {/* right paren in the reserved trailing room after the radicand */}
                  <span style={{ position:"absolute", left: toPxX(box.radR)+pf*0.04, top: pTop,
                    height: pf, display:"inline-flex", alignItems:"center",
                    fontFamily:FONT_MAIN, fontSize: pf, lineHeight:1, color: ui.uiFaint, opacity:0.5, pointerEvents:"none" }}>)</span>
                </>}
              </span>;
            }
            return null;
          })}

          {/* caret */}
          {focused && <div style={{
            position:"absolute",
            left: toPxX(caretAnchor.x),
            top: toPxY(caretAnchor.y),
            width: 1.5,
            height: toPxY(caretAnchor.h),
            background: ui.uiAccent,
            animation: "lmiBlink 1.06s steps(1) infinite",
            pointerEvents:"none",
          }}/>}
        </div>

        {/* placeholder */}
        {empty && <div style={{
          position:"absolute", top:"50%", left:PAD_X, transform:"translateY(-50%)",
          fontFamily:FONT, fontSize:BASE_PX, color:ui.uiFaint, pointerEvents:"none",
        }}>{placeholder||""}</div>}

        <style>{`@keyframes lmiBlink{0%,50%{opacity:1}50.01%,100%{opacity:0}}`}</style>
      </div>
    </div>
  );
}

export { LiveMathInput };
