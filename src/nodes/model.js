import { uid, nextColor } from "../core/math.js";
import { catOf, SCALAR_TYPES } from "../core/taxonomy.js";
import { UI_KEYS, UI_DEFAULTS } from "../theme/tokens.jsx";
import { THEME_PRESETS } from "../theme/presets.js";
import { DEFAULT_TEXTURE_SRC } from "./textureDefault.js";

// ── Node Canvas (SVG) ────────────────────────────────────────────────────────
const NW=200;
function getOutPort(n){return{x:n.pos.x+NW,y:n.pos.y+34};}
function getInPort(n){return{x:n.pos.x,y:n.pos.y+28};}

// ── Node type metadata ───────────────────────────────────────────────────────
const TYPE_META={
  project:  {tag:"PRJ",  tc:"#9aab",  bg:"#13141e",hdr:"#1a1c28"},
  camera:   {tag:"CAM",  tc:"#5bbf",  bg:"#0b1c38",hdr:"#102040"},
  camera3d: {tag:"3D",   tc:"#5bbf",  bg:"#0b1c38",hdr:"#102040"},
  camera2d: {tag:"2D",   tc:"#6cd8b8",bg:"#0a1c1a",hdr:"#0e2420"},
  constant: {tag:"CST",  tc:"#fba",   bg:"#1c1006",hdr:"#221408"},
  expr:     {tag:"EXP",  tc:"#b5e8ff", bg:"#050e18",hdr:"#081420"},
  slider:   {tag:"SLD",  tc:"#fd8",   bg:"#1a1400",hdr:"#251c00"},
  animator: {tag:"ANM",  tc:"#f76",   bg:"#1c0607",hdr:"#260c0c"},
  fnDef:    {tag:"FN()", tc:"#afd",   bg:"#0c1808",hdr:"#141f0c"},
  list:     {tag:"[ ]",  tc:"#f7d9a0",bg:"#1a1408",hdr:"#221c0c"},
  domain:   {tag:"DOM",  tc:"#9cf",   bg:"#0a1422",hdr:"#0e1c30"},
  point:    {tag:"PT",   tc:"#f9a",   bg:"#1c0e16",hdr:"#221018"},
  pointSeq: {tag:"PTS",  tc:"#ffc",   bg:"#1c1a06",hdr:"#242208"},
  curve3d:  {tag:"C3D",  tc:"#b4f",   bg:"#11101c",hdr:"#181226"},
  fn1d:     {tag:"y(x)", tc:"#6df",   bg:"#0c1820",hdr:"#10202e"},
  surf3d:   {tag:"SRF",  tc:"#4fd",   bg:"#0c1c18",hdr:"#102420"},
  paramsurf:{tag:"PSF",  tc:"#d6f",   bg:"#160e22",hdr:"#1e1030"},
  plane:    {tag:"PLN",  tc:"#5fa",   bg:"#0c1c12",hdr:"#102618"},
  quiver2d: {tag:"Q2D",  tc:"#ffa",   bg:"#181806",hdr:"#202006"},
  quiver3d: {tag:"Q3D",  tc:"#fca",   bg:"#181206",hdr:"#201806"},
  flow:     {tag:"FLW",  tc:"#9ff",   bg:"#061818",hdr:"#082020"},
  glyphField:{tag:"GLY", tc:"#5ec",   bg:"#06180f",hdr:"#0a2418"},
  // ── Unified kinds ──
  texture:   {tag:"TEX",  tc:"#f5bde6",bg:"#1c1018",hdr:"#241420"},
  video:     {tag:"VID",  tc:"#f5a97f",bg:"#1c1410",hdr:"#241a12"},
  light:     {tag:"LGT",  tc:"#ffe08a",bg:"#1c1808",hdr:"#24200a"},
  paramSpace:{tag:"PRM",  tc:"#b4f",   bg:"#11101c",hdr:"#181226"},
  points:    {tag:"PTS",  tc:"#f9a",   bg:"#1c0e16",hdr:"#221018"},
  rawGeom:   {tag:"RAW",  tc:"#9fd6a0",bg:"#0e1810",hdr:"#122218"},
  mesh:      {tag:"MSH",  tc:"#cfd6e0",bg:"#10141c",hdr:"#161c28"},
  fnMap:     {tag:"ƒ→",   tc:"#7ec8ff",bg:"#0a1622",hdr:"#0e1f30"},
  equation:  {tag:"EQ=",  tc:"#ffd479",bg:"#1c1606",hdr:"#241d08"},
  transformer:{tag:"TRN", tc:"#ffb454",bg:"#1a1206",hdr:"#241a08"},
};

// ── Node factory ─────────────────────────────────────────────────────────────
const PROJECT_ID=uid();
function makeNode(type,pos){
  const camProps=(mode)=>({posX:"6",posY:"4",posZ:"6",targetX:"0",targetY:"0",targetZ:"0",orbTheta:"0.8",orbPhi:"1.0",orbRadius:"14",fov:"50",near:"0.01",far:"2000",projection:"perspective",orthoSize:"10",mode,showGrid:true,showAxes:true,bgOverride:false,bgColor:"#0d0f18",showScalarOverlay:true,showCamLabel:true,showResetBtn:true,showHints:false,showShareBtn:true,showOpenBtn:true,
    // ── 2-D camera plane: a single flat plane defined by an origin point and a
    // gradient / normal vector. 3-D plots are orthographically projected onto it
    // (no notion of distance). Default = world XY plane (normal +Z).
    planeOx:"0",planeOy:"0",planeOz:"0",normalX:"0",normalY:"0",normalZ:"1"});
  const defs={
    camera:{label:"Camera",props:camProps("3d"),attachments:[],enabled:true},
    camera3d:{label:"Camera 3D",props:camProps("3d"),attachments:[],enabled:true},
    camera2d:{label:"Camera 2D",props:camProps("2d"),attachments:[],enabled:true},
    constant:{label:"Const",name:"c",props:{value:"1"},attachments:[]},
    expr:    {label:"Expr", name:"e",props:{expr:"0"},   attachments:[]},
    slider:  {label:"Slider",name:"a",value:0,props:{min:"-5",max:"5",step:"0.01"},attachments:[]},
    animator:{label:"Anim",name:"t",value:0,props:{min:"0",max:"1",period:"4",loop:"bounce",step:""},playing:false,attachments:[]},
    fnDef:   {label:"f(x)",name:"f",props:{params:"x",expr:"x^2"},attachments:[]},
    // list: a named array value. The expr is any mathjs expression yielding an
    // array — a literal, a range (1:n), or a built list (e.g. a vertex table).
    list:    {label:"List",name:"L",props:{expr:"[1, 2, 3, 5, 8]"},attachments:[]},
    domain:  {label:"Domain",props:{kind:"interval",var:"x",aMin:"-5",aMax:"5",bMin:"-5",bMax:"5",cMin:"-3",cMax:"3",res:"300",resB:"30",resC:"5"},attachments:[]},
    point:   {label:"Point",color:"__AUTO__",props:{x:"0",y:"0",z:"0",radius:"0.08"},attachments:[]},
    pointSeq:{label:"Pt Seq",color:"__AUTO__",props:{points:"0, 0\n1, 1\n2, 0\n3, 1\n4, 0",radius:"4",drawLines:true},attachments:[]},
    curve3d: {label:"Curve3D",color:"__AUTO__",props:{exprX:"cos(t)",exprY:"sin(t)",exprZ:"t/4",tMin:"0",tMax:"2*pi",res:"300"},attachments:[]},
    fn1d:    {label:"y(x)",color:"__AUTO__",props:{expr:"sin(x)",xMin:"-5",xMax:"5",res:"300"},attachments:[]},
    surf3d:  {label:"z(x,y)",color:"__AUTO__",props:{expr:"sin(x)*cos(y)",xMin:"-4",xMax:"4",yMin:"-4",yMax:"4",res:"40"},attachments:[]},
    paramsurf:{label:"P-Surf",color:"__AUTO__",props:{exprX:"cos(u)*sin(v)",exprY:"sin(u)*sin(v)",exprZ:"cos(v)",uMin:"0",uMax:"2*pi",vMin:"0",vMax:"pi",uRes:"40",vRes:"30"},attachments:[]},
    plane:   {label:"Plane",color:"__AUTO__",props:{centerX:"0",centerY:"0",centerZ:"0",normalX:"0",normalY:"1",normalZ:"0",size:"8"},attachments:[]},
    quiver2d:{label:"Quiver2D",color:"__AUTO__",props:{exprX:"-y",exprY:"x",gridN:"14",xMin:"-4",xMax:"4",yMin:"-4",yMax:"4",normalize:true},attachments:[]},
    quiver3d:{label:"Quiver3D",color:"__AUTO__",props:{exprX:"-y",exprY:"x",exprZ:"0.3*z",gridN:"5",xMin:"-3",xMax:"3",yMin:"-3",yMax:"3",zMin:"-3",zMax:"3",normalize:true},attachments:[]},
    // flow: integrates a vector-field fnMap along trajectories seeded by a
    // paramSpace. Wire an fnMap (output dim = field dimensionality) and a
    // paramSpace (the seed manifold) into it. A degree-1 seed space yields a
    // stream surface (or streamlines); a degree-2 seed space yields a volume.
    flow:    {label:"Flow",color:"__AUTO__",props:{
      steps:"500", stepSize:"0.02",
      output:"surface",          // "surface" | "lines" (degree-1 seeds); volume auto for degree-2
      volSlices:"6",
      gradient:false, gradA:"#5b9cf6", gradB:"#f74fa0",
    },attachments:[]},
    glyphField:{label:"Glyphs",color:"__AUTO__",props:{
      pairs:"-2, 0, 0 | 0, 1, 0\n0, 0, 0 | 1, 0.5, 0\n2, 0, 0 | 0, -1, 0",
      arrowLen:"0.5",normalize:true,anim:"crest",speed:"1",crestColor:"#ffffff"},attachments:[]},

    // ── Unified kinds ──────────────────────────────────────────────────────
    // texture: a static image source (uploaded file → data-URI, or a URL),
    // sampled by a surface's shader as a material channel. Defaults to the cute
    // Dedekind tile so a fresh node shows something. filter: linear|nearest,
    // wrap: clamp|repeat.
    texture:{label:"Texture",color:"__AUTO__",props:{
      src:DEFAULT_TEXTURE_SRC, filter:"linear", wrap:"clamp", role:"color",
    },attachments:[]},
    // video: a video source (URL or local file → object URL); its current frame
    // is uploaded each render tick (THREE.VideoTexture). Not embedded in the
    // project — the URL/reference is stored, the footage is the user's.
    video:{label:"Video",color:"__AUTO__",props:{
      src:"", filter:"linear", wrap:"clamp",
    },attachments:[]},
    // light: a scene light, wired into a camera. Every lit surface rendered for
    // that camera is shaded by it. kind: directional (a sun — dir x,y,z) or point
    // (a position x,y,z + inverse-square falloff). All fields are expressions, so
    // an animator wired in gives moving light. Values flow as live shader
    // uniforms (no rebuild on change); adding/removing a light recompiles.
    light:{label:"Light",color:"__AUTO__",props:{
      kind:"directional",
      dirX:"0.4", dirY:"0.5", dirZ:"0.9",          // directional: direction toward the light (z up; → legacy key light)
      posX:"3", posY:"3", posZ:"5", falloff:"0",   // point: world position + 1/(1+k·d²) falloff
      color:"#ffffff", intensity:"1",
    },attachments:[]},
    // paramSpace: a parameterized manifold of `degree` 1 (curve), 2 (surface),
    // or 3 (volume), mapped into 3-D Euclidean space.
    paramSpace:{label:"Curve",color:"__AUTO__",props:{
      degree:"1",
      exprX:"cos(t)",exprY:"sin(t)",exprZ:"t/4",
      tMin:"0",tMax:"2*pi",res:"300",
      // surface (degree 2) params reuse u,v:
      exprXu:"cos(u)*sin(v)",exprYu:"sin(u)*sin(v)",exprZu:"cos(v)",
      uMin:"0",uMax:"2*pi",vMin:"0",vMax:"pi",uRes:"40",vRes:"30",
      // volume (degree 3) params use u,v,w → a point cloud filling the image.
      exprXw:"u*sin(v)*cos(w)",exprYw:"u*sin(v)*sin(w)",exprZw:"u*cos(v)",
      wMin:"0",wMax:"2*pi",uRes3:"14",vRes3:"14",wRes3:"14",
      // volume coloring (optional gradient over the cloud):
      volColorMode:"off",volColorExpr:"u",volColorLo:"#3a6aff",volColorHi:"#ff5ea8",volColorMin:"",volColorMax:"",
    },attachments:[]},
    // points: points / glyphs / sequences.
    //   kind   "points" | "glyphs"           (top dropdown)
    //   mode   "list" | "index" | "recursive" (second dropdown)
    //   useColor  adds a trailing color slot to every tuple (recursible)
    // Each (kind, mode) pair has its own dedicated input field(s) so the authoring
    // form is explicit rather than auto-detected from text syntax. normalize.js
    // assembles these into the canonical text the parsers consume.
    points:{label:"Points",color:"__AUTO__",props:{
      kind:"points",            // points | glyphs
      mode:"list",              // list | index | recursive
      useColor:false,           // extra trailing color slot in each tuple
      // ── points · list ─ comma/newline separated ordered pairs or triples
      listPoints:"0, 0\n1, 1\n2, 0\n3, 1\n4, 0",
      // ── points · index ─ one tuple in i,j,k,n + a count
      idxPoint:"cos(i*0.3), sin(i*0.3)",
      idxCount:"64",
      // ── points · recursive ─ initial tuple, recurrence, count
      recInit:"1, 0",
      recStep:"x[n-1]*0.99, y[n-1]+0.1",
      recCount:"80",
      // ── glyphs · list ─ "seed | vector" pairs of pairs/triples per line
      listGlyphs:"0, 0 | 1, 0\n1, 1 | 0, 1\n2, 0 | 1, 0",
      // ── glyphs · index ─ "seed | vector" in i,j,k,n + a count
      idxGlyph:"cos(i), sin(i) | -sin(i), cos(i)",
      idxGlyphCount:"48",
      // ── glyphs · recursive ─ initial, recurrence (x[n-k],vx[n-k]…), count
      recGlyphInit:"4, 4 | 0, 1",
      recGlyphStep:"x[n-1]*0.97 - y[n-1]*0.12, y[n-1]*0.97 + x[n-1]*0.12 | vx[n-1], vy[n-1]",
      recGlyphCount:"120",
      // ── color slot expressions (only used when useColor) ─ a scalar per tuple,
      //    mapped onto the colorLo→colorHi ramp. Recursible via c[n-k].
      colListPoints:"i",   // appended as the trailing slot in list rows (see UI)
      colExpr:"i",         // index / recursive color expression
      colRecInit:"0",      // recursive: initial color scalar
      colRecStep:"c[n-1]+1",
      radius:"4",drawLines:true,
      // glyph styling (used for glyphs):
      arrowLen:"0.5",normalize:true,lenMode:"uniform",anim:"crest",speed:"1",crestColor:"#ffffff",
      // gradient ramp endpoints + range for the color slot / legacy gradient:
      colorMode:"off", colorExpr:"i", colorLo:"#3a6aff", colorHi:"#ff5ea8", colorMin:"", colorMax:"",
      // sequencing reveal:
      sequenced:false,seqFrac:"1",seqVar:"",
    },attachments:[]},

    // rawGeom: explicit primitives typed in directly (no formula/transformer).
    //   prim "points" | "segments" | "glyphs" | "triangles"
    //   src  "list"  — literal data, one primitive per line
    //        "index" — ONE template primitive whose coords are expressions in the
    //                  indices i (sequence) / i,j,k (lattice) + n, over a count.
    // Coordinates may reference wired scalars and fnDefs, so primitives express
    // against arbitrary dependency functions. Every vertex can be colored by a
    // per-vertex scalar (colorExpr) mapped through the lo→hi ramp (Gouraud).
    rawGeom:{label:"Raw Geometry",color:"__AUTO__",props:{
      prim:"segments", src:"index",
      // ── list data ──
      rawPoints:"0, 0, 0\n1, 1, 0\n-1, 1, 0",
      rawSegments:"-1, 0, 0 | 1, 0, 0\n0, -1, 0 | 0, 1, 0\n0, 0, -1 | 0, 0, 1",
      rawGlyphs:"0, 0, 0 | 1, 0, 0\n0, 0, 0 | 0, 1, 0\n0, 0, 0 | 0, 0, 1",
      rawTris:"0, 0, 0 | 1, 0, 0 | 0, 1, 0\n1, 0, 0 | 1, 1, 0 | 0, 1, 0",
      // ── index templates (expressions in i,j,k,n) ──
      idxPoints:"cos(i*0.4), sin(i*0.4), i*0.05",
      idxSegments:"cos(i*0.4), sin(i*0.4), 0 | cos(i*0.4)*1.4, sin(i*0.4)*1.4, 0",
      idxGlyphs:"cos(i*0.4), sin(i*0.4), 0 | -sin(i*0.4), cos(i*0.4), 0",
      idxTris:"cos(i*0.5), sin(i*0.5), 0 | cos((i+1)*0.5), sin((i+1)*0.5), 0 | 0, 0, 0",
      idxCount:"16",
      // ── per-vertex color ──
      //   colorMode "ramp" — a scalar (colorExpr) mapped through the lo→hi ramp
      //   colorMode "rgb"  — three expressions, each 0..1024 (10-bit per channel)
      colorOn:false, colorMode:"ramp",
      colorExpr:"i", colorLo:"#3a6aff", colorHi:"#ff5ea8", colorMin:"", colorMax:"",
      colorR:"512", colorG:"512", colorB:"512",
      // ── per-vertex alpha (0..1024 → opacity), independent of color mode ──
      alphaOn:false, colorA:"1024",
      radius:"0.08", drawLines:false,                   // points
      arrowLen:"0.5", normalize:false, lenMode:"raw",   // glyphs
      showWire:true,                                    // triangles
    },attachments:[]},

    // mesh: an embedded triangle-mesh asset. `data` is a compact JSON string
    //   {"p":[x,y,z,…math-space positions],"i":[…flat triangle indices]} — the
    // geometry baked into the project (imported from OBJ/GLTF/STL/PLY via the
    // editor's file drop, or generated, e.g. the Utah teapot demo). Coordinates
    // are MATH space (z up); the builder applies the same math→three swap as every
    // other plot. `scale` multiplies the geometry; `lit` shades it with the
    // scene's lights (a MeshPhong); otherwise a flat MeshBasic. __dataSig is a
    // cheap content fingerprint so the rebuild cache invalidates on re-import.
    mesh:{label:"Mesh",color:"__AUTO__",props:{
      data:"", __dataSig:"",
      scale:"1", lit:true, opacity:"1", shininess:"36",
      flatShading:false, doubleSide:true, showWire:false,
      castShadow:true, receiveShadow:true,             // hard shadows (lit meshes)
    },attachments:[]},

    // ── Function / transformer model ───────────────────────────────────────
    // fnMap: a pure map ℝ^inDim → ℝ^outDim. Inputs are the canonical symbols
    // x,y,z,w (first `inDim` of them). Outputs are out0..out3. inDim and outDim
    // each range 1–4. It does not plot on its own — it feeds a transformer.
    fnMap:{label:"map",color:"__AUTO__",props:{
      inDim:"1", outDim:"1",
      out0:"sin(x)", out1:"x", out2:"0", out3:"0",
    },attachments:[]},
    // equation: an implicit relation lhs = rhs.
    //   dims "2d" — relation in two vars (varA, varB) → curve via marching squares
    //   dims "3d" — relation in x,y,z → surface via marching cubes
    // Optional wired scalars/functions are in scope. Wire it into a transformer
    // to render; the transformer's domain box sets the sampling region.
    equation:{label:"equation",color:"__AUTO__",props:{
      dims:"2d", lhs:"x^2 + y^2", rhs:"4", varA:"x", varB:"y", varC:"z",
    },attachments:[]},
    // transformer: renders a wired fnMap over a domain.
    //   mode "graph" — assign each input to a spatial axis and each output to a
    //     spatial axis (the classic y=f(x) / z=f(x,y) graph).
    //   mode "field" — draw the output vector as an arrow at each sample point
    //     (the quiver generalization, 2d→2d / 2d→3d / 3d→3d).
    //   domainSrc "inline" — min/max per input dim + resolution.
    //   domainSrc "param"  — sample points come from a wired paramSpace.
    transformer:{label:"Transformer",color:"__AUTO__",props:{
      mode:"graph",
      // graph axis assignment: where input k and output k live in world space.
      // values: "x" | "y" | "z" | "none". Output defaults to z, the up axis, so
      // a z=f(x,y) graph rises vertically.
      inAxis0:"x", inAxis1:"y", inAxis2:"z",
      outAxis0:"z", outAxis1:"y", outAxis2:"none",
      // field styling
      normalize:true, arrowLen:"0.5",
      // domain
      domainSrc:"inline",
      aMin:"-5",aMax:"5",bMin:"-5",bMax:"5",cMin:"-3",cMax:"3",dMin:"-3",dMax:"3",
      res:"60",
      // gradient coloring: when colorMode==="gradient" each vertex gets a scalar
      // from colorExpr (vars: x,y,z,w inputs, out0..out3 outputs, t/u/v domain
      // params, n index, plus wired scalars), mapped across [colorMin,colorMax]
      // (auto when blank) onto the colorLo→colorHi ramp.
      colorMode:"off", colorExpr:"out0", colorLo:"#3a6aff", colorHi:"#ff5ea8", colorMin:"", colorMax:"",
    },attachments:[]},
  };
  // Build only the selected type's entry into a node. The defs literal assigns a
  // placeholder color so the palette cursor is NOT advanced for every colored type
  // on each makeNode call (it previously burned ~14 colors per node); resolve the
  // sentinel to a real palette color here, consuming exactly one — and only when
  // the selected type actually carries a color.
  const def=defs[type];
  const node={id:uid(),type,pos:pos||{x:300+Math.random()*180,y:120+Math.random()*180},...def};
  if(node.color==="__AUTO__") node.color=nextColor();
  return node;
}

// Project node with default theme/palette — shared by blank and demo scenes.
function makeProjectNode(name){
  // Default theme: Midnight. Spread the real preset (rather than duplicating
  // its values here) so this stays in sync if Midnight's definition changes,
  // and so a fresh project is the theme actually labeled "Midnight" in the
  // theme picker — not just visually similar to some other preset.
  return {id:PROJECT_ID,type:"project",pos:{x:20,y:20},label:"Project",props:{name:name||"Untitled",author:"",
    ...THEME_PRESETS["Midnight"],
    },attachments:[]};
}

// Blank starting project: a project node and a single 2-D camera, nothing else.
// This is what a fresh session opens with — a clean slate.
function makeBlankScene(){
  const project=makeProjectNode("Untitled");
  //const cam2d=makeNode("camera2d",{x:180,y:160});cam2d.label="Cam2D";
  //return {[project.id]:project,[cam2d.id]:cam2d};
  return {[project.id]:project};
}

// makeInitialScene is the app's default — kept as the blank scene so new
// sessions start clean. The full feature showcase lives in makeDemoScene.
function makeInitialScene(){ return makeBlankScene(); }

// Feature showcase: exercises every advanced capability — unified function maps
// rendered through transformers (graph + vector field, 2D and 3D), parametric
// curves/surfaces, GPU instanced point clouds (recursive, index and matrix
// modes), animated swirling glyph fields, flows seeded by both a parametric
// space (filled stream surface in the 2-D plane) and discrete points (stream
// curves), recursive function definitions, and an animator driving it all.
function makeDemoScene(){
  // A "four lenses" showcase: ONE set of animated maps, watched by four cameras
  // from four different projections (perspective 3-D, orthographic 3-D, a top-down
  // 2-D plane, and a side 2-D plane). Animators drive time; sliders shape the
  // transformations (amplitude, frequency, decay, twist) — drag a slider and every
  // camera updates together.
  const project=makeProjectNode("Four Lenses");
  const N={[project.id]:project};
  const add=(n)=>{N[n.id]=n;return n;};

  // ── Drivers ────────────────────────────────────────────────────────────────
  // One looping clock; sliders the viewer can tweak live.
  const t=add(makeNode("animator",{x:40,y:60}));t.name="t";t.label="t (clock)";t.value=0;
  t.props.period="9";t.props.min="0";t.props.max="6.283";t.props.loop="loop";t.playing=true;
  const spin=add(makeNode("animator",{x:40,y:185}));spin.name="s";spin.label="s (spin)";spin.value=0;
  spin.props.period="20";spin.props.min="0";spin.props.max="6.283";spin.props.loop="loop";spin.playing=true;

  const amp=add(makeNode("slider",{x:40,y:310}));amp.name="a";amp.label="a · amplitude";amp.value=0.9;
  amp.props.min="0";amp.props.max="2";amp.props.step="0.01";
  const freq=add(makeNode("slider",{x:40,y:420}));freq.name="f";freq.label="f · frequency";freq.value=1.6;
  freq.props.min="0.2";freq.props.max="4";freq.props.step="0.01";
  const decay=add(makeNode("slider",{x:40,y:530}));decay.name="d";decay.label="d · decay";decay.value=0.18;
  decay.props.min="0";decay.props.max="0.6";decay.props.step="0.005";
  const twist=add(makeNode("slider",{x:40,y:640}));twist.name="tw";twist.label="tw · twist";twist.value=0.6;
  twist.props.min="-1.5";twist.props.max="1.5";twist.props.step="0.01";

  // ── Shared maps (the things every camera looks at) ─────────────────────────
  // 1) Morphing ripple surface  z = a·sin(f·r − t)·e^(−d·r),  r = √(x²+y²).
  const surfFn=add(makeNode("fnMap",{x:360,y:120}));surfFn.label="ripple ƒ";surfFn.color="#8aadf4";
  surfFn.props.inDim="2";surfFn.props.outDim="1";
  surfFn.props.out0="a*sin(f*sqrt(x*x+y*y) - t)*exp(-d*sqrt(x*x+y*y))";
  surfFn.attachments=[amp.id,freq.id,decay.id,t.id];

  const surf=add(makeNode("transformer",{x:680,y:120}));surf.label="Ripple Surface";surf.color="#8aadf4";
  surf.props.mode="graph";surf.props.inAxis0="x";surf.props.inAxis1="y";surf.props.outAxis0="z";
  surf.props.aMin="-5";surf.props.aMax="5";surf.props.bMin="-5";surf.props.bMax="5";surf.props.res="56";
  surf.attachments=[surfFn.id];

  // 2) Swirl 3-D vector field, twisting with t and the twist slider.
  const swirlFn=add(makeNode("fnMap",{x:360,y:300}));swirlFn.label="swirl ƒ";swirlFn.color="#a6da95";
  swirlFn.props.inDim="3";swirlFn.props.outDim="4";
  swirlFn.props.out0="-y + tw*sin(t)";swirlFn.props.out1="x + tw*cos(t)";swirlFn.props.out2="0.3*z";
  swirlFn.props.out3="sqrt(x*x+y*y+z*z)";
  swirlFn.attachments=[twist.id,t.id];

  const field=add(makeNode("transformer",{x:680,y:300}));field.label="Swirl Field";field.color="#a6da95";
  field.props.mode="field";field.props.colorLo="#a6da95";field.props.colorHi="#ed8796";
  field.props.inAxis0="x";field.props.inAxis1="y";field.props.inAxis2="z";
  field.props.outAxis0="x";field.props.outAxis1="y";field.props.outAxis2="z";field.props.outAxis3="color";
  field.props.colorMin="0";field.props.colorMax="5";
  field.props.aMin="-4";field.props.aMax="4";field.props.bMin="-4";field.props.bMax="4";field.props.cMin="-1.5";field.props.cMax="1.5";
  field.props.res="5";field.props.arrowLen="0.7";
  field.attachments=[swirlFn.id];

  // 3) A torus knot curve, slowly rotating via s (a phase added to the angle).
  const knot=add(makeNode("paramSpace",{x:360,y:500}));knot.label="Torus Knot";knot.color="#c6a0f6";
  knot.props.degree="1";
  knot.props.exprX="(2.4+cos(3*t+s))*cos(2*t)";knot.props.exprY="(2.4+cos(3*t+s))*sin(2*t)";knot.props.exprZ="sin(3*t+s)";
  knot.props.tMin="0";knot.props.tMax="2*pi";knot.props.res="420";
  knot.attachments=[t.id,spin.id];

  // 4) A slider-morphable implicit surface: a gyroid — the triply-periodic minimal
  //      surface  sin(kx)cos(ky) + sin(ky)cos(kz) + sin(kz)cos(kx) = 0
  // Ray-marched directly on the GPU. It's riddled with tunnels and holes, so the
  // surface is obviously see-through — a clear test that the ray marcher resolves
  // interior structure. The `k` slider sets the frequency (how many cells pack
  // into the box); slide it to watch the lattice get finer or coarser.
  const gyK=add(makeNode("slider",{x:40,y:750}));gyK.name="k";gyK.label="k · cell freq";gyK.value=1.6;
  gyK.props.min="0.6";gyK.props.max="3";gyK.props.step="0.01";

  const gyroidEq=add(makeNode("equation",{x:360,y:680}));gyroidEq.label="Gyroid = 0";gyroidEq.color="#f5a97f";
  gyroidEq.props.dims="3d";
  gyroidEq.props.lhs="sin(k*x)*cos(k*y) + sin(k*y)*cos(k*z) + sin(k*z)*cos(k*x)";gyroidEq.props.rhs="0";
  gyroidEq.props.varA="x";gyroidEq.props.varB="y";gyroidEq.props.varC="z";
  gyroidEq.attachments=[gyK.id];

  const gyroid=add(makeNode("transformer",{x:680,y:680}));gyroid.label="Implicit Gyroid";gyroid.color="#f5a97f";
  gyroid.props.mode="graph";
  gyroid.props.aMin="-3.2";gyroid.props.aMax="3.2";gyroid.props.bMin="-3.2";gyroid.props.bMax="3.2";gyroid.props.cMin="-3.2";gyroid.props.cMax="3.2";
  gyroid.props.res="200";  // ray-march steps per pixel (cheap — it's a fragment shader, not a mesh)
  gyroid.attachments=[gyroidEq.id];

  // ── Four cameras, four projections of the SAME plots ───────────────────────
  const persp=add(makeNode("camera3d",{x:1040,y:60}));persp.label="Perspective";
  persp.props.projection="perspective";persp.props.orbTheta="0.7";persp.props.orbPhi="1.05";persp.props.orbRadius="13";

  const ortho=add(makeNode("camera3d",{x:1040,y:230}));ortho.label="Orthographic";
  ortho.props.projection="orthographic";ortho.props.orthoSize="7";ortho.props.orbTheta="2.3";ortho.props.orbPhi="0.95";ortho.props.orbRadius="13";

  const top=add(makeNode("camera2d",{x:1040,y:400}));top.label="Top (xy)";
  // default plane is world XY (normal +Z) — nothing to set.

  const side=add(makeNode("camera2d",{x:1040,y:560}));side.label="Side (xz)";
  // view the x–z plane: looking along −Y, so the plane normal is +Y.
  side.props.normalX="0";side.props.normalY="1";side.props.normalZ="0";

  // Every 3-D camera sees the ripple surface, the implicit torus, the field, and
  // the knot. The 2-D cameras skip the dense surfaces (projecting them every frame
  // was the main 2-D performance sink) and instead show the field + knot projected
  // onto their plane, which is light and reads clearly.
  const plots3d=[surf.id,gyroid.id,field.id,knot.id];
  const plots2d=[field.id,knot.id];
  persp.attachments=[...plots3d];
  ortho.attachments=[...plots3d];
  top.attachments=[...plots2d];
  side.attachments=[...plots2d];

  return N;
}

export {
  NW, getOutPort, getInPort, TYPE_META, PROJECT_ID, makeNode, makeProjectNode, makeInitialScene, makeBlankScene, makeDemoScene
};
