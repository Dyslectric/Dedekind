import { NODE_KEYS, UI_DEFAULTS, UI_KEYS, UI_TOKENS } from "./tokens.jsx";

const THEME_GROUPS = [
  {title:"App chrome", items:[["canvasBg","panel background","#0a0c18"],["nodeBg","node graph","#0a0c18"]]},
  {title:"UI text", items:UI_TOKENS.map(([k,label,def])=>[k,label,def])},
  {title:"2D viewport", items:[["bg2d","background","#070810"],["grid2d","grid lines","#181d32"],["axes2d","axes","#283a6a"],["label2d","labels","#283a6a"]]},
  {title:"3D viewport", items:[["bg3d","background","#070810"],["grid3d","grid major","#151b2a"],["grid3d2","grid minor","#0e1320"]]},
  {title:"Overlay HUD", items:[["overlayBg","background","#06081488"],["overlayBorder","border","#1a1e38"],["overlayText","text","#4a6888"]]},
];

// ── Theme presets ────────────────────────────────────────────────────────────
// Each preset is a full set of project theme props (viewport colors + UI text
// tokens). Applying one patches all theme-related fields at once, leaving
// project name/author untouched.

// Helper: derive a complete preset from viewport colors + a UI text palette.
function preset(view, ui){
  return {...view, ...ui};
}
// Default-ish UI palette generator for the original dark presets (keeps the
// classic blue-grey chrome). Catppuccin presets supply their own explicitly.
const DARK_UI = {
  uiHeading:"#dde6f8",uiText:"#cdd6ee",uiMuted:"#8c98b8",uiFaint:"#909bbb",uiAccent:"#6ab2ff",
  uiInputText:"#cdd6ee",uiInputBg:"#070918",uiInputBorder:"#2a2e4a",uiBtnText:"#9aa6c4",
  uiBtnBg:"#0c0e20",uiBtnBorder:"#2a2e48",uiPanelBar:"#0b0c1c",uiDanger:"#ff7070",uiGood:"#5fe39a",
};
// Catppuccin UI palette builder from the named swatches of each flavour.
// Text tokens must come from the *text* swatches (text/subtext/overlay), never
// from `surface` (a background swatch) — using surface for faint text made it
// nearly invisible. faint = overlay, muted = subtext, body = subtext, heading = text.
function catppuccinUI(c){
  // Latte is a LIGHT flavour: its overlay swatch is too light for faint text on
  // the light panel, so pull faint/muted toward the darker subtext swatches.
  const light = c.light;
  return {
    uiHeading:c.text, uiText:c.subtext, uiMuted:light?c.text:c.subtext, uiFaint:light?c.subtext:c.overlay, uiAccent:c.blue,
    uiInputText:c.text, uiInputBg:c.mantle, uiInputBorder:c.overlay, uiBtnText:c.subtext,
    uiBtnBg:c.crust, uiBtnBorder:c.overlay, uiPanelBar:c.mantle, uiDanger:c.red, uiGood:c.green,
  };
}
function catppuccinView(c){
  return {
    canvasBg:c.base, nodeBg:c.mantle, bg2d:c.crust, grid2d:c.surface, axes2d:c.overlay,
    label2d:c.subtext, bg3d:c.crust, grid3d:c.surface, grid3d2:c.mantle,
    overlayBg:c.mantle+"cc", overlayBorder:c.surface, overlayText:c.subtext,
  };
}
const CAT = {
  Latte:     {light:true,base:"#eff1f5",mantle:"#e6e9ef",crust:"#dce0e8",surface:"#ccd0da",overlay:"#9ca0b0",subtext:"#6c6f85",text:"#4c4f69",blue:"#1e66f5",mauve:"#8839ef",green:"#40a02b",red:"#d20f39"},
  "Frappé":  {base:"#303446",mantle:"#292c3c",crust:"#232634",surface:"#414559",overlay:"#838ba7",subtext:"#a5adce",text:"#c6d0f5",blue:"#8caaee",mauve:"#ca9ee6",green:"#a6d189",red:"#e78284"},
  Macchiato: {base:"#24273a",mantle:"#1e2030",crust:"#181926",surface:"#363a4f",overlay:"#8087a2",subtext:"#a5adcb",text:"#cad3f5",blue:"#8aadf4",mauve:"#c6a0f6",green:"#a6da95",red:"#ed8796"},
  Mocha:     {base:"#1e1e2e",mantle:"#181825",crust:"#11111b",surface:"#313244",overlay:"#9399b2",subtext:"#a6adc8",text:"#cdd6f4",blue:"#89b4fa",mauve:"#cba6f7",green:"#a6e3a1",red:"#f38ba8"},
};

const THEME_PRESETS = {
  "Midnight": preset({canvasBg:"#11141f",nodeBg:"#11141f",bg2d:"#0d0f18",grid2d:"#1e2440",axes2d:"#324679",label2d:"#324679",bg3d:"#0d0f18",grid3d:"#1c2334",grid3d2:"#141a28",overlayBg:"#0c0f1c88",overlayBorder:"#222747",overlayText:"#54739a"}, DARK_UI),
  "Slate":    preset({canvasBg:"#101319",nodeBg:"#0d1015",bg2d:"#0c0f14",grid2d:"#222731",axes2d:"#3a4654",label2d:"#46525f",bg3d:"#0c0f14",grid3d:"#1e242c",grid3d2:"#161b21",overlayBg:"#0c0f1499",overlayBorder:"#252b34",overlayText:"#5a6675"}, {...DARK_UI,uiHeading:"#d2d8e2",uiText:"#aeb6c4",uiMuted:"#9aa6b8",uiFaint:"#9098a8",uiAccent:"#6aa0d8",uiInputBg:"#0d1015",uiInputBorder:"#252b34",uiBtnBg:"#12161c",uiBtnBorder:"#252b34",uiPanelBar:"#0d1015"}),
  "Carbon":   preset({canvasBg:"#0d0d0f",nodeBg:"#0a0a0c",bg2d:"#08080a",grid2d:"#1e1e22",axes2d:"#3a3a44",label2d:"#44444e",bg3d:"#08080a",grid3d:"#1a1a1e",grid3d2:"#101012",overlayBg:"#0a0a0c99",overlayBorder:"#222228",overlayText:"#55555f"}, {...DARK_UI,uiHeading:"#dadade",uiText:"#b0b0b8",uiMuted:"#9a9aa6",uiFaint:"#8e8e98",uiAccent:"#8a8a96",uiInputBg:"#0a0a0c",uiInputBorder:"#222228",uiBtnBg:"#111113",uiBtnBorder:"#222228",uiPanelBar:"#0a0a0c"}),
  "Forest":   preset({canvasBg:"#0a120e",nodeBg:"#08100c",bg2d:"#070f0b",grid2d:"#16281e",axes2d:"#2a5a3e",label2d:"#356648",bg3d:"#070f0b",grid3d:"#14241a",grid3d2:"#0d180f",overlayBg:"#070f0b99",overlayBorder:"#1a3024",overlayText:"#48886a"}, {...DARK_UI,uiHeading:"#cfe8d6",uiText:"#a0c4ac",uiMuted:"#88c4a0",uiFaint:"#7fb896",uiAccent:"#5ec888",uiInputBg:"#08100c",uiInputBorder:"#1a3024",uiBtnBg:"#0c1810",uiBtnBorder:"#1a3024",uiPanelBar:"#08100c",uiGood:"#5ec888"}),
  "Plum":     preset({canvasBg:"#120a18",nodeBg:"#100814",bg2d:"#0f0710",grid2d:"#281630",axes2d:"#5a2a6a",label2d:"#663578",bg3d:"#0f0710",grid3d:"#241428",grid3d2:"#180d1c",overlayBg:"#0f071099",overlayBorder:"#301a38",overlayText:"#88488a"}, {...DARK_UI,uiHeading:"#e6d2f0",uiText:"#c0a0d0",uiMuted:"#c79ad8",uiFaint:"#b88ac8",uiAccent:"#c061f7",uiInputBg:"#100814",uiInputBorder:"#301a38",uiBtnBg:"#180c1e",uiBtnBorder:"#301a38",uiPanelBar:"#100814"}),
  "Ember":    preset({canvasBg:"#160c08",nodeBg:"#140a06",bg2d:"#120907",grid2d:"#301a12",axes2d:"#6a3a28",label2d:"#7a4632",bg3d:"#120907",grid3d:"#281610",grid3d2:"#1a0d09",overlayBg:"#12090799",overlayBorder:"#381e16",overlayText:"#a06048"}, {...DARK_UI,uiHeading:"#f0d8c8",uiText:"#d0a890",uiMuted:"#d8a088",uiFaint:"#c8907a",uiAccent:"#f7964f",uiInputBg:"#140a06",uiInputBorder:"#381e16",uiBtnBg:"#1c0f08",uiBtnBorder:"#381e16",uiPanelBar:"#140a06"}),
  "Paper":    preset({canvasBg:"#f4f5f8",nodeBg:"#eaecf1",bg2d:"#ffffff",grid2d:"#d4d8e2",axes2d:"#8a93a8",label2d:"#5a647c",bg3d:"#eef0f5",grid3d:"#cfd4e0",grid3d2:"#dde1ea",overlayBg:"#ffffffcc",overlayBorder:"#c4c9d6",overlayText:"#55607a"}, {uiHeading:"#1e2436",uiText:"#3a4258",uiMuted:"#525c74",uiFaint:"#5e6880",uiAccent:"#2f6fd0",uiInputText:"#26304a",uiInputBg:"#ffffff",uiInputBorder:"#b4bacb",uiBtnText:"#3a4458",uiBtnBg:"#ffffff",uiBtnBorder:"#bdc2d0",uiPanelBar:"#eaecf1",uiDanger:"#d23838",uiGood:"#2f9e54"}),
  "Catppuccin Latte":     preset(catppuccinView(CAT.Latte),     catppuccinUI(CAT.Latte)),
  "Catppuccin Frappé":    preset(catppuccinView(CAT["Frappé"]), catppuccinUI(CAT["Frappé"])),
  "Catppuccin Macchiato": preset(catppuccinView(CAT.Macchiato), catppuccinUI(CAT.Macchiato)),
  "Catppuccin Mocha":     preset(catppuccinView(CAT.Mocha),     catppuccinUI(CAT.Mocha)),
};
const THEME_KEYS=["canvasBg","nodeBg","bg2d","grid2d","axes2d","label2d","bg3d","grid3d","grid3d2","overlayBg","overlayBorder","overlayText"];
const ALL_THEME_KEYS=[...THEME_KEYS,...UI_KEYS];

// ── Theme ────────────────────────────────────────────────────────────────────
const DEFAULT_THEME={canvasBg:"#24273a",nodeBg:"#1e2030",bg2d:"#181926",grid2d:"#363a4f",axes2d:"#8087a2"};
function buildTheme(pn){
  if(!pn)return DEFAULT_THEME;
  const t={
    canvasBg:pn.props.canvasBg||DEFAULT_THEME.canvasBg,
    nodeBg:pn.props.nodeBg||DEFAULT_THEME.nodeBg,
    bg2d:pn.props.bg2d||DEFAULT_THEME.bg2d,
    grid2d:pn.props.grid2d||DEFAULT_THEME.grid2d,
    axes2d:pn.props.axes2d||DEFAULT_THEME.axes2d,
    label2d:pn.props.label2d||"#283a6a",
    overlayBg:pn.props.overlayBg||"#06081488",
    overlayBorder:pn.props.overlayBorder||"#1a1e38",
    overlayText:pn.props.overlayText||"#4a6888",
    nodeTheme:pn.props.nodeTheme||"dark",
  };
  // carry custom node-palette keys through so consumers reading only `theme`
  // still see them
  for(const k of NODE_KEYS) if(pn.props[k]!==undefined) t[k]=pn.props[k];
  return t;
}

export {
  THEME_GROUPS, preset, DARK_UI, catppuccinUI, catppuccinView, CAT, THEME_PRESETS, THEME_KEYS, ALL_THEME_KEYS, DEFAULT_THEME, buildTheme
};
