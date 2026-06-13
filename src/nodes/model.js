import { uid, nextColor } from "../core/math.js";
import { catOf, SCALAR_TYPES } from "../core/taxonomy.js";
import { UI_KEYS, UI_DEFAULTS } from "../theme/tokens.jsx";

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
  slider:   {tag:"SLD",  tc:"#fd8",   bg:"#1a1400",hdr:"#251c00"},
  animator: {tag:"ANM",  tc:"#f76",   bg:"#1c0607",hdr:"#260c0c"},
  fnDef:    {tag:"FN()", tc:"#afd",   bg:"#0c1808",hdr:"#141f0c"},
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
  scalarFn:  {tag:"f()",  tc:"#6df",   bg:"#0c1820",hdr:"#10202e"},
  paramSpace:{tag:"PRM",  tc:"#b4f",   bg:"#11101c",hdr:"#181226"},
  points:    {tag:"PTS",  tc:"#f9a",   bg:"#1c0e16",hdr:"#221018"},
  fnMap:     {tag:"ƒ→",   tc:"#7ec8ff",bg:"#0a1622",hdr:"#0e1f30"},
  transformer:{tag:"TRN", tc:"#ffb454",bg:"#1a1206",hdr:"#241a08"},
};

// ── Node factory ─────────────────────────────────────────────────────────────
const PROJECT_ID=uid();
function makeNode(type,pos){
  const camProps=(mode)=>({posX:"6",posY:"4",posZ:"6",targetX:"0",targetY:"0",targetZ:"0",orbTheta:"0.8",orbPhi:"1.0",orbRadius:"14",fov:"50",near:"0.01",far:"2000",projection:"perspective",orthoSize:"10",mode,showGrid:true,showAxes:true,bgOverride:false,bgColor:"#0d0f18",showScalarOverlay:true,showCamLabel:true,showResetBtn:true,showHints:false,showShareBtn:true,planeMode:"xy",planeOx:"0",planeOy:"0",planeOz:"0",planeUx:"1",planeUy:"0",planeUz:"0",planeVx:"0",planeVy:"1",planeVz:"0",planeThreshold:"0.15",psExprX:"cos(u)*sin(v)",psExprY:"sin(u)*sin(v)",psExprZ:"cos(v)",psUMin:"0",psUMax:"2*pi",psVMin:"0",psVMax:"pi",psRes:"16",psDistThreshold:"0.35"});
  const defs={
    camera:{label:"Camera",props:camProps("3d"),attachments:[],enabled:true},
    camera3d:{label:"Camera 3D",props:camProps("3d"),attachments:[],enabled:true},
    camera2d:{label:"Camera 2D",props:camProps("2d"),attachments:[],enabled:true},
    constant:{label:"Const",name:"c",props:{value:"1"},attachments:[]},
    slider:  {label:"Slider",name:"a",value:0,props:{min:"-5",max:"5",step:"0.01"},attachments:[]},
    animator:{label:"Anim",name:"t",value:0,props:{min:"0",max:"1",period:"4",loop:"bounce",step:""},playing:false,attachments:[]},
    fnDef:   {label:"f(x)",name:"f",props:{params:"x",expr:"x^2"},attachments:[]},
    domain:  {label:"Domain",props:{kind:"interval",var:"x",aMin:"-5",aMax:"5",bMin:"-5",bMax:"5",cMin:"-3",cMax:"3",res:"300",resB:"30",resC:"5"},attachments:[]},
    point:   {label:"Point",color:nextColor(),props:{x:"0",y:"0",z:"0",radius:"0.08"},attachments:[]},
    pointSeq:{label:"Pt Seq",color:nextColor(),props:{points:"0, 0\n1, 1\n2, 0\n3, 1\n4, 0",radius:"4",drawLines:true},attachments:[]},
    curve3d: {label:"Curve3D",color:nextColor(),props:{exprX:"cos(t)",exprY:"sin(t)",exprZ:"t/4",tMin:"0",tMax:"2*pi",res:"300"},attachments:[]},
    fn1d:    {label:"y(x)",color:nextColor(),props:{expr:"sin(x)",xMin:"-5",xMax:"5",res:"300"},attachments:[]},
    surf3d:  {label:"z(x,y)",color:nextColor(),props:{expr:"sin(x)*cos(y)",xMin:"-4",xMax:"4",yMin:"-4",yMax:"4",res:"40"},attachments:[]},
    paramsurf:{label:"P-Surf",color:nextColor(),props:{exprX:"cos(u)*sin(v)",exprY:"sin(u)*sin(v)",exprZ:"cos(v)",uMin:"0",uMax:"2*pi",vMin:"0",vMax:"pi",uRes:"40",vRes:"30"},attachments:[]},
    plane:   {label:"Plane",color:nextColor(),props:{centerX:"0",centerY:"0",centerZ:"0",normalX:"0",normalY:"1",normalZ:"0",size:"8"},attachments:[]},
    quiver2d:{label:"Quiver2D",color:nextColor(),props:{exprX:"-y",exprY:"x",gridN:"14",xMin:"-4",xMax:"4",yMin:"-4",yMax:"4",normalize:true},attachments:[]},
    quiver3d:{label:"Quiver3D",color:nextColor(),props:{exprX:"-y",exprY:"x",exprZ:"0.3*z",gridN:"5",xMin:"-3",xMax:"3",yMin:"-3",yMax:"3",zMin:"-3",zMax:"3",normalize:true},attachments:[]},
    // flow: integrates a vector-field fnMap along trajectories seeded by a
    // paramSpace. Wire an fnMap (output dim = field dimensionality) and a
    // paramSpace (the seed manifold) into it. A degree-1 seed space yields a
    // stream surface (or streamlines); a degree-2 seed space yields a volume.
    flow:    {label:"Flow",color:nextColor(),props:{
      steps:"500", stepSize:"0.02",
      output:"surface",          // "surface" | "lines" (degree-1 seeds); volume auto for degree-2
      volSlices:"6",
      gradient:false, gradA:"#5b9cf6", gradB:"#f74fa0",
    },attachments:[]},
    glyphField:{label:"Glyphs",color:nextColor(),props:{
      pairs:"-2, 0, 0 | 0, 1, 0\n0, 0, 0 | 1, 0.5, 0\n2, 0, 0 | 0, -1, 0",
      arrowLen:"0.5",normalize:true,anim:"crest",speed:"1",crestColor:"#ffffff"},attachments:[]},

    // ── Unified kinds ──────────────────────────────────────────────────────
    // scalarFn: a scalar-valued function of `dims` spatial inputs.
    //   dims 1 → y(x) curve, dims 2 → z(x,y) surface, dims 3 → f(x,y,z) sampled
    //   as a value-coloured point cloud.
    scalarFn:{label:"f(x)",color:nextColor(),props:{
      dims:"1",
      expr:"sin(x)",
      xMin:"-5",xMax:"5",yMin:"-4",yMax:"4",zMin:"-3",zMax:"3",
      res:"40",
      colorByValue:false,colorLo:"#3a6df0",colorHi:"#f0533a",
    },attachments:[]},
    // paramSpace: a parameterized manifold of `degree` 1 (curve) or 2 (surface).
    paramSpace:{label:"Curve",color:nextColor(),props:{
      degree:"1",
      exprX:"cos(t)",exprY:"sin(t)",exprZ:"t/4",
      tMin:"0",tMax:"2*pi",res:"300",
      // surface (degree 2) params reuse u,v:
      exprXu:"cos(u)*sin(v)",exprYu:"sin(u)*sin(v)",exprZu:"cos(v)",
      uMin:"0",uMax:"2*pi",vMin:"0",vMax:"pi",uRes:"40",vRes:"30",
    },attachments:[]},
    // points: points / glyphs / sequences. `space` xy|xyz; `hasVectors` adds
    // per-point arrows (glyph mode). One unified `data` text supports plain,
    // recursive [n-1], index [i], and matrix [i,j] forms.
    points:{label:"Points",color:nextColor(),props:{
      space:"xy",
      hasVectors:false,
      data:"0, 0\n1, 1\n2, 0\n3, 1\n4, 0",
      radius:"4",drawLines:true,
      // glyph styling (used when hasVectors):
      arrowLen:"0.5",normalize:true,anim:"crest",speed:"1",crestColor:"#ffffff",
      // gradient coloring (used when colorMode==="gradient"): each point gets a
      // scalar from colorExpr (vars: i, n, x, y, z and any wired scalars), mapped
      // across [colorMin,colorMax] (auto when blank) onto the colorLo→colorHi ramp.
      colorMode:"off", colorExpr:"i", colorLo:"#3a6aff", colorHi:"#ff5ea8", colorMin:"", colorMax:"",
      // sequencing reveal:
      sequenced:false,seqFrac:"1",seqVar:"",
    },attachments:[]},

    // ── Function / transformer model ───────────────────────────────────────
    // fnMap: a pure map ℝ^inDim → ℝ^outDim. Inputs are the canonical symbols
    // x,y,z,w (first `inDim` of them). Outputs are out0..out3. inDim and outDim
    // each range 1–4. It does not plot on its own — it feeds a transformer.
    fnMap:{label:"map",color:nextColor(),props:{
      inDim:"1", outDim:"1",
      out0:"sin(x)", out1:"x", out2:"0", out3:"0",
    },attachments:[]},
    // transformer: renders a wired fnMap over a domain.
    //   mode "graph" — assign each input to a spatial axis and each output to a
    //     spatial axis (the classic y=f(x) / z=f(x,y) graph).
    //   mode "field" — draw the output vector as an arrow at each sample point
    //     (the quiver generalization, 2d→2d / 2d→3d / 3d→3d).
    //   domainSrc "inline" — min/max per input dim + resolution.
    //   domainSrc "param"  — sample points come from a wired paramSpace.
    transformer:{label:"Transformer",color:nextColor(),props:{
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
  return{id:uid(),type,pos:pos||{x:300+Math.random()*180,y:120+Math.random()*180},...defs[type]};
}

// Project node with default theme/palette — shared by blank and demo scenes.
function makeProjectNode(name){
  return {id:PROJECT_ID,type:"project",pos:{x:20,y:20},label:"Project",props:{name:name||"Untitled",author:"",canvasBg:"#11141f",nodeBg:"#11141f",bg2d:"#0d0f18",grid2d:"#1e2440",axes2d:"#324679",label2d:"#324679",bg3d:"#0d0f18",grid3d:"#1c2334",grid3d2:"#141a28",overlayBg:"#0c0f1c88",overlayBorder:"#222747",overlayText:"#54739a",...UI_DEFAULTS},attachments:[]};
}

// Blank starting project: a project node and a single 2-D camera, nothing else.
// This is what a fresh session opens with — a clean slate.
function makeBlankScene(){
  const project=makeProjectNode("Untitled");
  const cam2d=makeNode("camera2d",{x:180,y:160});cam2d.label="Cam2D";
  return {[project.id]:project,[cam2d.id]:cam2d};
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
  const project=makeProjectNode("Showcase");
  const N={[project.id]:project};
  const add=(n)=>{N[n.id]=n;return n;};

  // ── Cameras (right side) ───────────────────────────────────────────────────
  const cam3d=add(makeNode("camera3d",{x:1180,y:120}));cam3d.label="Cam3D";
  cam3d.props.orbRadius="13";cam3d.props.orbTheta="0.7";cam3d.props.orbPhi="1.1";
  const cam2d=add(makeNode("camera2d",{x:1180,y:440}));cam2d.label="Cam2D";

  // ── Drivers: animators, scalars, a recursive function ──────────────────────
  const t=add(makeNode("animator",{x:40,y:80}));t.name="t";t.label="t (loop)";t.value=0;
  t.props.period="8";t.props.min="0";t.props.max="6.283";t.props.loop="loop";t.playing=true;
  const s=add(makeNode("animator",{x:40,y:210}));s.name="s";s.label="s (bounce)";s.value=0;
  s.props.period="6";s.props.min="0";s.props.max="1";s.props.loop="bounce";s.playing=true;
  const amp=add(makeNode("slider",{x:40,y:340}));amp.name="a";amp.label="a (amplitude)";amp.value=0.8;
  amp.props.min="0";amp.props.max="2";amp.props.step="0.01";
  const kk=add(makeNode("constant",{x:40,y:450}));kk.name="k";kk.label="k";kk.value=3;
  const fib=add(makeNode("fnDef",{x:40,y:560}));fib.name="fib";fib.label="fib(n)";fib.props.params="n";fib.props.expr="n <= 1 ? n : fib(n-1) + fib(n-2)";

  // ── Function maps (left column) — most left for the user to wire up ────────
  const ripple=add(makeNode("fnMap",{x:330,y:60}));ripple.label="ripple ƒ";ripple.color="#7ec8ff";
  ripple.props.inDim="2";ripple.props.outDim="1";ripple.props.out0="a*sin(sqrt(x*x+y*y)*2 - t)*0.8";
  ripple.attachments=[amp.id,t.id];

  const saddle=add(makeNode("fnMap",{x:330,y:180}));saddle.label="saddle ƒ";saddle.color="#7ec8ff";
  saddle.props.inDim="2";saddle.props.outDim="1";saddle.props.out0="(x*x - y*y)*0.18";

  const wave=add(makeNode("fnMap",{x:330,y:300}));wave.label="wave ƒ";wave.color="#7ec8ff";
  wave.props.inDim="1";wave.props.outDim="1";wave.props.out0="sin(x*2 - t)*exp(-abs(x)*0.2)";
  wave.attachments=[t.id];

  const swirl=add(makeNode("fnMap",{x:330,y:420}));swirl.label="swirl ƒ (3→3)";swirl.color="#7ec8ff";
  swirl.props.inDim="3";swirl.props.outDim="3";swirl.props.out0="-y + 0.3*sin(t)";swirl.props.out1="x";swirl.props.out2="0.25*z";
  swirl.attachments=[t.id];

  const rot=add(makeNode("fnMap",{x:330,y:540}));rot.label="rot ƒ (2→2)";rot.color="#7ec8ff";
  rot.props.inDim="2";rot.props.outDim="2";rot.props.out0="-y";rot.props.out1="x";

  const cloud4=add(makeNode("fnMap",{x:330,y:660}));cloud4.label="hyper ƒ (4→4)";cloud4.color="#7ec8ff";
  cloud4.props.inDim="4";cloud4.props.outDim="4";
  cloud4.props.out0="x*cos(w)-y*sin(w)";cloud4.props.out1="x*sin(w)+y*cos(w)";cloud4.props.out2="z";cloud4.props.out3="w";

  // ── Param spaces (curves / manifolds) ──────────────────────────────────────
  const knot=add(makeNode("paramSpace",{x:330,y:790}));knot.label="Torus Knot";knot.color="#5b9cf6";
  knot.props.degree="1";knot.props.exprX="(2+cos(3*t))*cos(2*t)";knot.props.exprY="(2+cos(3*t))*sin(2*t)";knot.props.exprZ="sin(3*t)";knot.props.tMin="0";knot.props.tMax="2*pi";knot.props.res="400";

  const sphere=add(makeNode("paramSpace",{x:330,y:910}));sphere.label="Sphere (deg 2)";sphere.color="#b48cff";
  sphere.props.degree="2";sphere.props.exprXu="cos(u)*sin(v)";sphere.props.exprYu="sin(u)*sin(v)";sphere.props.exprZu="cos(v)";
  sphere.props.uMin="0";sphere.props.uMax="2*pi";sphere.props.vMin="0";sphere.props.vMax="pi";sphere.props.uRes="40";sphere.props.vRes="24";

  const seedLine=add(makeNode("paramSpace",{x:330,y:1030}));seedLine.label="seed line";seedLine.color="#9ad";
  seedLine.props.degree="1";seedLine.props.exprX="2.5";seedLine.props.exprY="t";seedLine.props.exprZ="0";seedLine.props.tMin="-1.5";seedLine.props.tMax="1.5";seedLine.props.res="9";

  // ── Transformers (graph + field). Most NOT wired to a camera. ──────────────
  const rippleSurf=add(makeNode("transformer",{x:680,y:40}));rippleSurf.label="Ripple Surface";rippleSurf.color="#4a90d0";
  rippleSurf.props.mode="graph";rippleSurf.props.inAxis0="x";rippleSurf.props.inAxis1="y";rippleSurf.props.outAxis0="z";
  rippleSurf.props.aMin="-5";rippleSurf.props.aMax="5";rippleSurf.props.bMin="-5";rippleSurf.props.bMax="5";rippleSurf.props.res="48";
  rippleSurf.props.colorMode="gradient";rippleSurf.props.colorExpr="out0";rippleSurf.props.colorLo="#1b3a8f";rippleSurf.props.colorHi="#ff5ea8";
  rippleSurf.attachments=[ripple.id];

  const saddleSurf=add(makeNode("transformer",{x:680,y:180}));saddleSurf.label="Saddle Surface";saddleSurf.color="#52d47e";
  saddleSurf.props.mode="graph";saddleSurf.props.inAxis0="x";saddleSurf.props.inAxis1="y";saddleSurf.props.outAxis0="z";
  saddleSurf.props.aMin="-4";saddleSurf.props.aMax="4";saddleSurf.props.bMin="-4";saddleSurf.props.bMax="4";saddleSurf.props.res="40";
  saddleSurf.props.colorMode="gradient";saddleSurf.props.colorExpr="out0";saddleSurf.props.colorLo="#5be0c0";saddleSurf.props.colorHi="#ffb454";
  saddleSurf.attachments=[saddle.id];

  const waveCurve=add(makeNode("transformer",{x:680,y:300}));waveCurve.label="Wave Curve";waveCurve.color="#f7cc4f";
  waveCurve.props.mode="graph";waveCurve.props.inAxis0="x";waveCurve.props.outAxis0="z";
  waveCurve.props.aMin="-8";waveCurve.props.aMax="8";waveCurve.props.res="300";
  waveCurve.props.colorMode="gradient";waveCurve.props.colorExpr="x";waveCurve.props.colorLo="#7ec8ff";waveCurve.props.colorHi="#f99ab4";
  waveCurve.attachments=[wave.id];

  const field3d=add(makeNode("transformer",{x:680,y:420}));field3d.label="Field 3D";field3d.color="#c761f7";
  field3d.props.mode="field";field3d.props.inAxis0="x";field3d.props.inAxis1="y";field3d.props.inAxis2="z";
  field3d.props.outAxis0="x";field3d.props.outAxis1="y";field3d.props.outAxis2="z";
  field3d.props.aMin="-3";field3d.props.aMax="3";field3d.props.bMin="-3";field3d.props.bMax="3";field3d.props.cMin="-3";field3d.props.cMax="3";field3d.props.res="4";field3d.props.arrowLen="0.6";
  field3d.attachments=[swirl.id];

  const field2d=add(makeNode("transformer",{x:680,y:540}));field2d.label="Field 2D";field2d.color="#ffb454";
  field2d.props.mode="field";field2d.props.inAxis0="x";field2d.props.inAxis1="y";field2d.props.outAxis0="x";field2d.props.outAxis1="y";
  field2d.props.aMin="-4";field2d.props.aMax="4";field2d.props.bMin="-4";field2d.props.bMax="4";field2d.props.res="12";field2d.props.arrowLen="0.4";
  field2d.attachments=[rot.id];

  const solid=add(makeNode("transformer",{x:680,y:660}));solid.label="Solid (3-in)";solid.color="#f99ab4";
  solid.props.mode="graph";solid.props.inAxis0="x";solid.props.inAxis1="y";solid.props.inAxis2="z";solid.props.outAxis0="none";
  solid.props.aMin="-2";solid.props.aMax="2";solid.props.bMin="-2";solid.props.bMax="2";solid.props.cMin="-2";solid.props.cMax="2";solid.props.res="14";
  solid.props.colorMode="gradient";solid.props.colorExpr="sqrt(x*x+y*y+z*z)";solid.props.colorLo="#1b3a8f";solid.props.colorHi="#5be0c0";
  solid.attachments=[swirl.id];

  // ── Flows ───────────────────────────────────────────────────────────────────
  const streamSurf=add(makeNode("flow",{x:680,y:1030}));streamSurf.label="Stream Surface";streamSurf.color="#52d47e";
  streamSurf.props.steps="500";streamSurf.props.stepSize="0.02";streamSurf.props.output="surface";
  streamSurf.props.gradient=true;streamSurf.props.gradA="#5be0c0";streamSurf.props.gradB="#5b9cf6";
  streamSurf.attachments=[rot.id,seedLine.id];

  // ── Points / glyphs / sequences ────────────────────────────────────────────
  // Toroidal glyph swirl (CONNECTED to cam3d — one of the few shown initially).
  const torusSwirl=add(makeNode("points",{x:680,y:780}));torusSwirl.label="Torus Swirl";torusSwirl.color="#5be0c0";
  torusSwirl.props.space="xyz";torusSwirl.props.hasVectors=true;
  torusSwirl.props.data=
    "3,0,0 | 0,1,0\n"+
    "(3+1.1*cos(0.16*n))*cos(0.045*n)+0*x[n-1], (3+1.1*cos(0.16*n))*sin(0.045*n), 1.1*sin(0.16*n) | "+
      "-sin(0.045*n+t), cos(0.045*n+t), 0.5*cos(0.16*n+t)\n"+
    "500";
  torusSwirl.props.arrowLen="0.45";torusSwirl.props.normalize=true;torusSwirl.props.anim="crest";torusSwirl.props.speed="1.4";torusSwirl.props.crestColor="#ffffff";
  torusSwirl.attachments=[t.id];

  // Gradient-colored matrix lattice (CONNECTED to cam3d).
  const lattice=add(makeNode("points",{x:920,y:120}));lattice.label="Lattice (gradient)";lattice.color="#f9a";
  lattice.props.space="xyz";lattice.props.hasVectors=false;
  lattice.props.data="i*0.6 - 3, j*0.6 - 3, sin(i*0.5 + j*0.5 + t)\n11, 11";
  lattice.props.drawLines=false;lattice.props.radius="0.08";
  lattice.props.colorMode="gradient";lattice.props.colorExpr="z";lattice.props.colorLo="#1b3a8f";lattice.props.colorHi="#ff5ea8";
  lattice.attachments=[t.id];

  // Recursive spiral sequence (XY) — disconnected.
  const spiral=add(makeNode("points",{x:680,y:900}));spiral.label="Spiral (recursive)";spiral.color="#ffd86b";
  spiral.props.space="xy";spiral.props.hasVectors=false;
  spiral.props.data="1, 0\nx[n-1]*0.97 - y[n-1]*0.12, x[n-1]*0.12 + y[n-1]*0.97\n160";
  spiral.props.drawLines=true;spiral.props.radius="3";

  // Index-mode gradient ring — disconnected.
  const ring=add(makeNode("points",{x:920,y:260}));ring.label="Ring (by index)";ring.color="#f9a";
  ring.props.space="xy";ring.props.hasVectors=false;
  ring.props.data="3*cos(i*0.13), 3*sin(i*0.13)\n48";
  ring.props.drawLines=false;ring.props.radius="6";
  ring.props.colorMode="gradient";ring.props.colorExpr="i";ring.props.colorLo="#b48cff";ring.props.colorHi="#ffb454";

  // Discrete flow seeds — disconnected.
  const seedPts=add(makeNode("points",{x:920,y:380}));seedPts.label="seed points";seedPts.color="#fc6";
  seedPts.props.space="xy";seedPts.props.hasVectors=false;seedPts.props.data="1, 0\n2.2, 0\n3.4, 0";seedPts.props.radius="5";

  // ── Camera attachments: only a few things are shown at first. ──────────────
  // Cam3D shows the torus glyph swirl + the gradient lattice. Everything else —
  // the surfaces, the curve, the fields, the solid, the flow, the extra point
  // clouds — is built and ready but left disconnected for you to wire in.
  cam3d.attachments=[torusSwirl.id,lattice.id];
  cam2d.attachments=[];   // nothing in 2D yet — try wiring Field 2D or a flow here

  return N;
}

export {
  NW, getOutPort, getInPort, TYPE_META, PROJECT_ID, makeNode, makeProjectNode, makeInitialScene, makeBlankScene, makeDemoScene
};
