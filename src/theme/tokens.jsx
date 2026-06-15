import { createContext, useContext } from "react";

// ── Shared style tokens ──────────────────────────────────────────────────────
const StyleTokens = {
  inp:   { background:"#070918",border:"1px solid #2a2e4a",color:"#cdd6ee",borderRadius:4,padding:"3px 7px",fontSize:16,outline:"none",boxSizing:"border-box",fontFamily:"monospace" },
  btn:   { background:"#0c0e20",border:"1px solid #2a2e48",color:"#9aa6c4",borderRadius:4,padding:"4px 10px",fontSize:16,cursor:"pointer",fontFamily:"monospace" },
  btnSm: { background:"#0c0e20",border:"1px solid #24283e",color:"#9aa6c4",borderRadius:3,padding:"2px 6px",fontSize:15,cursor:"pointer",fontFamily:"monospace" },
};

// ── UI text-color tokens ─────────────────────────────────────────────────────
// Semantic, changeable colors for all of the app's chrome (panels, labels,
// buttons, headings, inputs). Stored on the project node under these keys and
// editable in the theme panel. Defaults reproduce the original look.
const UI_TOKENS = [
  ["uiHeading",   "heading",       "#dde6f8"],
  ["uiText",      "body text",     "#cdd6ee"],
  ["uiMuted",     "muted text",    "#8c98b8"],
  ["uiFaint",     "faint text",    "#909bbb"],
  ["uiAccent",    "accent",        "#6ab2ff"],
  ["uiInputText", "input text",    "#cdd6ee"],
  ["uiInputBg",   "input bg",      "#070918"],
  ["uiInputBorder","input border", "#2a2e4a"],
  ["uiBtnText",   "button text",   "#9aa6c4"],
  ["uiBtnBg",     "button bg",     "#0c0e20"],
  ["uiBtnBorder", "button border", "#2a2e48"],
  ["uiPanelBar",  "panel bar bg",  "#0b0c1c"],
  ["uiDanger",    "danger",        "#ff7070"],
  ["uiGood",      "ok / on",       "#5fe39a"],
];
const UI_KEYS = UI_TOKENS.map(t=>t[0]);
const UI_DEFAULTS = Object.fromEntries(UI_TOKENS.map(([k,,d])=>[k,d]));

// Build a UI palette object from project props, falling back to defaults.
function buildUI(pn){
  const p=pn?.props||{};
  const ui={};
  for(const k of UI_KEYS) ui[k]=p[k]||UI_DEFAULTS[k];
  return ui;
}

// ── Node-graph palette ───────────────────────────────────────────────────────
// Colors for the node *cards* (not the chrome). Three modes:
//   dark / light — sensible built-in palettes
//   custom       — read explicit node* props off the project
// The per-type identity color (TYPE_META.tc) still tints the tag + accents, but
// card bg / header / border / label text now follow the theme so a light theme
// produces light cards.
const NODE_DARK = { nodeCardBg:"#0e1018", nodeHdrBg:"#161a28", nodeBorder:"#262a40", nodeSel:"#6aceff", nodeLabel:"#c8d4f0", nodeSub:"#5a6480", nodeShadow:"#000000" };
const NODE_LIGHT= { nodeCardBg:"#ffffff", nodeHdrBg:"#eef1f7", nodeBorder:"#cbd2e0", nodeSel:"#2f6fd0", nodeLabel:"#1e2740", nodeSub:"#6b7794", nodeShadow:"#94a0c0" };
const NODE_KEYS = Object.keys(NODE_DARK);
// Node-card colors are derived from the active theme/UI palette so that every
// theme preset reskins the node canvas too — there is no separate node theme.
// Authors can still override individual card colors via explicit props.
// Parse #rgb/#rgba/#rrggbb(aa) to [r,g,b] 0-255 (ignores alpha).
function parseHex(h){
  h=(h||"").replace("#","");
  if(h.length===3||h.length===4) h=h.split("").slice(0,3).map(c=>c+c).join("");
  else h=h.slice(0,6);
  const n=parseInt(h||"888888",16);
  return [(n>>16)&255,(n>>8)&255,n&255];
}
function relLum(h){ const [r,g,b]=parseHex(h).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}); return 0.2126*r+0.7152*g+0.0722*b; }
// Darken a (typically light pastel) identity color so it reads on a light card.
// Scales each channel toward 0 by `amt`; clamps to keep some saturation.
function darken(h, amt){
  const [r,g,b]=parseHex(h);
  const f=1-amt;
  return "#"+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v*f)))).map(v=>v.toString(16).padStart(2,"0")).join("");
}
// Linear blend of two hex colors, t∈[0,1] toward b.
function mix(a, b, t){
  const A=parseHex(a), B=parseHex(b);
  return "#"+[0,1,2].map(i=>Math.round(A[i]+(B[i]-A[i])*t)).map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,"0")).join("");
}

function buildNodePalette(pn){
  const p=pn?.props||{};
  // Pull from the resolved UI/view colors the preset already set on the project.
  const card = p.nodeCardBg || p.nodeBg || p.uiInputBg || NODE_DARK.nodeCardBg;
  const hdr  = p.nodeHdrBg  || p.uiPanelBar || p.uiBtnBg || NODE_DARK.nodeHdrBg;
  const bord = p.nodeBorder || p.overlayBorder || p.uiInputBorder || NODE_DARK.nodeBorder;
  const label= p.nodeLabel  || p.uiHeading || NODE_DARK.nodeLabel;
  const sub  = p.nodeSub    || p.uiMuted || NODE_DARK.nodeSub;
  const sel  = p.nodeSel    || p.uiAccent || NODE_DARK.nodeSel;
  const shadow = p.nodeShadow || "#000000";
  // Identity colors (TYPE_META.tc / node.color) are light pastels tuned for dark
  // cards; on a light theme they wash out. Detect a light card and provide a
  // `tcFor` that darkens identity colors to a readable level on that card.
  const isLight = relLum(hdr) > 0.45;
  const tcFor = isLight ? (c)=>darken(c, 0.62) : (c)=>c;
  // Theme-aware accent for small colored controls (enable/detach/delete chips,
  // expr value readouts, "playing" markers). On dark cards keep the bright color;
  // on light cards darken it so it reads. `chip` builds a faint tinted background
  // + readable foreground/border for a small button, matched to the card.
  const accent = isLight ? (c)=>darken(c, 0.45) : (c)=>c;
  const chip = (c)=>{
    const fg = isLight ? darken(c, 0.5) : c;
    const bg = isLight ? mix(card, c, 0.18) : mix(card, c, 0.30);
    const border = isLight ? darken(c, 0.3) : mix(card, c, 0.5);
    return { fg, bg, border };
  };
  return { nodeCardBg:card, nodeHdrBg:hdr, nodeBorder:bord, nodeSel:sel, nodeLabel:label, nodeSub:sub, nodeShadow:shadow, isLight, tcFor, accent, chip };
}

// Theme-aware versions of the shared S styles, derived from a UI palette.
function makeS(ui){
  return {
    inp:   { background:ui.uiInputBg,border:`1px solid ${ui.uiInputBorder}`,color:ui.uiInputText,borderRadius:4,padding:"3px 7px",fontSize:16,outline:"none",boxSizing:"border-box",fontFamily:"monospace" },
    btn:   { background:ui.uiBtnBg,border:`1px solid ${ui.uiBtnBorder}`,color:ui.uiBtnText,borderRadius:4,padding:"4px 10px",fontSize:16,cursor:"pointer",fontFamily:"monospace" },
    btnSm: { background:ui.uiBtnBg,border:`1px solid ${ui.uiBtnBorder}`,color:ui.uiBtnText,borderRadius:3,padding:"2px 6px",fontSize:15,cursor:"pointer",fontFamily:"monospace" },
  };
}

// Context carries the resolved UI palette + matching S styles to all chrome.
const UICtx = createContext({ ui: UI_DEFAULTS, StyleTokens });
function useUI(){ return useContext(UICtx); }

// ── Math helpers ─────────────────────────────────────────────────────────────
// Compiled-expression cache. mathjs `evaluate(string, scope)` re-parses the
// expression on every call — catastrophic inside the tight sampling loops used

export {
  StyleTokens, UI_TOKENS, UI_KEYS, UI_DEFAULTS, buildUI, NODE_DARK, NODE_LIGHT, NODE_KEYS, buildNodePalette, makeS, UICtx, useUI, darken, relLum
};
