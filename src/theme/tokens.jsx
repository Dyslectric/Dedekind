import { createContext, useContext } from "react";

// ── Shared style tokens ──────────────────────────────────────────────────────
const StyleTokens = {
  inp:   { background:"#070918",border:"1px solid #1c1e35",color:"#b8c4e0",borderRadius:4,padding:"3px 7px",fontSize:16,outline:"none",boxSizing:"border-box",fontFamily:"monospace" },
  btn:   { background:"#0c0e20",border:"1px solid #1e2038",color:"#5a6888",borderRadius:4,padding:"4px 10px",fontSize:16,cursor:"pointer",fontFamily:"monospace" },
  btnSm: { background:"#0c0e20",border:"1px solid #1a1c30",color:"#4a5670",borderRadius:3,padding:"2px 6px",fontSize:15,cursor:"pointer",fontFamily:"monospace" },
};

// ── UI text-color tokens ─────────────────────────────────────────────────────
// Semantic, changeable colors for all of the app's chrome (panels, labels,
// buttons, headings, inputs). Stored on the project node under these keys and
// editable in the theme panel. Defaults reproduce the original look.
const UI_TOKENS = [
  ["uiHeading",   "heading",       "#d0dcf4"],
  ["uiText",      "body text",     "#c0cce8"],
  ["uiMuted",     "muted text",    "#5a6888"],
  ["uiFaint",     "faint text",    "#2a3050"],
  ["uiAccent",    "accent",        "#5aaaff"],
  ["uiInputText", "input text",    "#b8c4e0"],
  ["uiInputBg",   "input bg",      "#070918"],
  ["uiInputBorder","input border", "#1c1e35"],
  ["uiBtnText",   "button text",   "#5a6888"],
  ["uiBtnBg",     "button bg",     "#0c0e20"],
  ["uiBtnBorder", "button border", "#1e2038"],
  ["uiPanelBar",  "panel bar bg",  "#0b0c1c"],
  ["uiDanger",    "danger",        "#f55f5f"],
  ["uiGood",      "ok / on",       "#4fda8a"],
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
  return { nodeCardBg:card, nodeHdrBg:hdr, nodeBorder:bord, nodeSel:sel, nodeLabel:label, nodeSub:sub, nodeShadow:shadow };
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
  StyleTokens, UI_TOKENS, UI_KEYS, UI_DEFAULTS, buildUI, NODE_DARK, NODE_LIGHT, NODE_KEYS, buildNodePalette, makeS, UICtx, useUI
};
