import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { makeNode, makeProjectNode } from "../nodes/model.js";
import { DEFAULT_NORMAL_SRC } from "../nodes/textureDefault.js";
import { buildScopeForCamera } from "../core/scope.js";
import { resolveNum } from "../core/math.js";
import { buildTheme } from "../theme/presets.js";
import { ViewportSwitch, useIsMobile } from "../components/Viewport.jsx";
import { serializeProject } from "../core/serialize.js";
import { RAWGEOM_SHOWCASE } from "./rawgeom-showcase.jsx";

// Load a demo's editable graph into the full editor: write it to the URL hash
// (the same channel a working-session save uses) and reload so the editor boots
// straight into that project. Shared by the landing feature rows and the
// per-preview "Open project" buttons.
function openDemoProject(kind){
  try{
    const scene = makeDemoProject(kind);
    const hash = serializeProject(scene);
    if(!hash) return;
    window.location.hash = hash;
    window.location.reload();
  }catch(e){ /* ignore — button just no-ops if serialization fails */ }
}

// ── Small self-contained scenes used by the landing previews ────────────────
// Each returns a node map with a project, one camera, and a plot wired to its
// inputs — the same shape the editor produces, so the real renderers draw them.
// `animated:false` scenes have no playing animator, so the preview won't run a
// render loop for them (no needless redraws / stutter).

// Gradient-colored ripple surface (graph transformer), animated by t.
function surfaceScene(){
  const project=makeProjectNode("preview");
  const cam=makeNode("camera3d",{x:980,y:120});cam.label="surface";
  cam.props.orbRadius="11";cam.props.orbTheta="0.72";cam.props.orbPhi="1.02";
  cam.props.showCamLabel=false;cam.props.showResetBtn=false;cam.props.showShareBtn=false;cam.props.showScalarOverlay=false;
  const anim=makeNode("animator",{x:40,y:300});anim.name="t";anim.value=0;anim.props.period="10";anim.props.min="0";anim.props.max="6.283";anim.props.loop="loop";anim.playing=true;
  const fn=makeNode("fnMap",{x:300,y:160});fn.props.inDim="2";fn.props.outDim="1";
  fn.props.out0="sin(sqrt(x*x+y*y)*1.6 - t)*0.9";
  const tr=makeNode("transformer",{x:620,y:160});tr.color="#4a90d0";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  tr.props.aMin="-4.5";tr.props.aMax="4.5";tr.props.bMin="-4.5";tr.props.bMax="4.5";tr.props.res="44";
  tr.props.colorMode="gradient";tr.props.colorExpr="out0";tr.props.colorLo="#1b3a8f";tr.props.colorHi="#ff5ea8";
  tr.attachments=[fn.id];fn.attachments=[anim.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[anim.id]:anim,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:true};
}

// 3D vector field colored by the reserved last output (field + color mode),
// animated by t so it swirls.
function fieldScene(){
  const project=makeProjectNode("preview");
  const cam=makeNode("camera3d",{x:980,y:120});cam.label="field";
  cam.props.orbRadius="9";cam.props.orbTheta="0.7";cam.props.orbPhi="1.05";
  cam.props.showCamLabel=false;cam.props.showResetBtn=false;cam.props.showShareBtn=false;cam.props.showScalarOverlay=false;
  const anim=makeNode("animator",{x:40,y:300});anim.name="t";anim.value=0;anim.props.period="9";anim.props.min="0";anim.props.max="6.283";anim.props.loop="loop";anim.playing=true;
  // 4-output map: 3D vector (out0..out2) + out3 reserved for the color gradient.
  const fn=makeNode("fnMap",{x:300,y:160});fn.props.inDim="3";fn.props.outDim="4";
  fn.props.out0="-y + 0.3*sin(t)";fn.props.out1="x";fn.props.out2="0.35*z";fn.props.out3="sqrt(x*x+y*y+z*z)";
  const tr=makeNode("transformer",{x:620,y:160});tr.color="#ffb454";
  tr.props.mode="field";tr.props.colorMode="gradient";tr.props.colorLo="#5be0c0";tr.props.colorHi="#ff5ea8";
  tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.inAxis2="z";
  tr.props.outAxis0="x";tr.props.outAxis1="y";tr.props.outAxis2="z";
  tr.props.aMin="-2.4";tr.props.aMax="2.4";tr.props.bMin="-2.4";tr.props.bMax="2.4";tr.props.cMin="-2.4";tr.props.cMax="2.4";
  tr.props.res="4";tr.props.arrowLen="0.7";
  tr.attachments=[fn.id];fn.attachments=[anim.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[anim.id]:anim,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:true};
}

// 2D stream surface: a spiral field, seeded along a short line → filled surface.
// No animator — static, so the preview won't run a render loop.
function flowScene(){
  const project=makeProjectNode("preview");
  const cam=makeNode("camera2d",{x:980,y:120});cam.label="flow";
  cam.props.showCamLabel=false;cam.props.showResetBtn=false;cam.props.showShareBtn=false;cam.props.showScalarOverlay=false;
  const field=makeNode("fnMap",{x:300,y:120});field.props.inDim="2";field.props.outDim="2";
  field.props.out0="-y + 0.32*x";field.props.out1="x + 0.32*y";
  const seeds=makeNode("paramSpace",{x:300,y:300});seeds.props.degree="1";
  seeds.props.exprX="0.5 + 0.9*t";seeds.props.exprY="-0.15";seeds.props.exprZ="0";seeds.props.tMin="0";seeds.props.tMax="1";seeds.props.res="9";
  const flow=makeNode("flow",{x:620,y:160});flow.color="#5be0c0";
  flow.props.steps="240";flow.props.stepSize="0.045";flow.props.output="surface";
  flow.props.gradient=true;flow.props.gradA="#5be0c0";flow.props.gradB="#5b9cf6";
  flow.attachments=[field.id,seeds.id];cam.attachments=[flow.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[field.id]:field,[seeds.id]:seeds,[flow.id]:flow},camId:cam.id,animated:false};
}

// 3D gradient point cloud on a static spiral shell — NO animator, fully static.
function latticeScene(){
  const project=makeProjectNode("preview");
  const cam=makeNode("camera3d",{x:980,y:120});cam.label="points";
  cam.props.orbRadius="11";cam.props.orbTheta="0.9";cam.props.orbPhi="1.0";
  cam.props.showCamLabel=false;cam.props.showResetBtn=false;cam.props.showShareBtn=false;cam.props.showScalarOverlay=false;
  // a phyllotaxis-style shell of points, colored by height — static, by index i.
  const pts=makeNode("points",{x:620,y:160});pts.color="#f99ab4";
  pts.props.kind="points";pts.props.mode="index";pts.props.useColor=false;
  pts.props.idxPoint="2.6*sqrt(i/360)*cos(i*2.4), 2.6*sqrt(i/360)*sin(i*2.4), (i/360)*3 - 1.5";
  pts.props.idxCount="360";
  pts.props.drawLines=false;pts.props.radius="0.075";
  pts.props.colorMode="gradient";pts.props.colorExpr="z";pts.props.colorLo="#1b3a8f";pts.props.colorHi="#ffb454";
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[pts.id]:pts},camId:cam.id,animated:false};
}

// ── "Crazy" showcase scene (for the #demo route) ────────────────────────────
// The Clebsch diagonal cubic — the most celebrated algebraic surface (it carries
// all 27 lines of a smooth cubic in real form). It's a torture test for the
// implicit renderer: a degree-3 surface with sharp ridges and near-singular
// pinches. We animate a morph parameter `s` that deforms the cubic's constant
// term, pushing it THROUGH singular configurations (nodes appear and vanish) so
// the new gradient-hardening + seam shading is visible in motion. This is the
// "open the URL and see something crazy" scene.
function clebschScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1100,y:120}));cam.label="clebsch";
  cam.props.orbRadius="13";cam.props.orbTheta="0.9";cam.props.orbPhi="1.0";
  // slow auto-orbit so the surface turns and the lit ridges sweep
  cam.props.spin="loop"; cam.props.spinPeriod="22";
  // morph animator: deforms the cubic through singular configs and back
  const anim=makeNode("animator",{x:40,y:320});anim.name="s";anim.value=0;
  anim.props.period="14";anim.props.min="-1";anim.props.max="1";anim.props.loop="pingpong";anim.playing=true;
  const eq=makeNode("equation",{x:380,y:160});eq.label="Clebsch";eq.color="#ffd479";
  eq.props.dims="3d";
  // Clebsch diagonal cubic in the symmetric form:
  //   81(x³+y³+z³) − 189(x²y+…) + 54xyz + 126(xy+yz+zx) − 9(x²+y²+z²) − 9(x+y+z) + 1 = 0
  // We expose a morph by scaling the linear+constant tail with the animator `s`,
  // which slides the surface through singular pinches. Written compactly:
  eq.props.lhs=[
    "81*(x^3+y^3+z^3)",
    "-189*(x^2*y+x^2*z+y^2*x+y^2*z+z^2*x+z^2*y)",
    "+54*x*y*z",
    "+126*(x*y+y*z+z*x)",
    "-9*(1+0.6*s)*(x^2+y^2+z^2)",
    "-9*(x+y+z)",
    "+1"
  ].join(" ");
  eq.props.rhs="0";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  const tr=makeNode("transformer",{x:740,y:160});tr.label="Clebsch Cubic";tr.color="#ffd479";
  tr.props.mode="graph";
  tr.props.aMin="-1.5";tr.props.aMax="1.5";tr.props.bMin="-1.5";tr.props.bMax="1.5";tr.props.cMin="-1.5";tr.props.cMax="1.5";
  tr.props.res="240";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[anim.id]:anim,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:true};
}

const SCENES = { surface:surfaceScene, field:fieldScene, flow:flowScene, lattice:latticeScene };

// ─────────────────────────────────────────────────────────────────────────────
// New showcase demos. Each builds a complete, editable node graph (project +
// camera(s) + plots). The same builder feeds both the inline LivePreview and the
// "Open project" button (which loads the graph into the full editor), so what you
// see on the page is exactly what opens.
// ─────────────────────────────────────────────────────────────────────────────

// Strip the preview-only camera chrome flags so a scene opened in the editor
// shows its normal HUD, while previews stay clean. The scalar overlay (slider /
// animator controls) is kept ON, though — the front-page demos are meant to be
// driven, so the sliders and animators need to be visible and interactive.
function previewCam(cam){
  cam.props.showCamLabel=false;cam.props.showResetBtn=false;cam.props.showShareBtn=false;
  cam.props.showScalarOverlay=true;
  return cam;
}

// 1) Sphere ↔ torus morph. Authored selection: a morph parameter slider `m`
// feeds an expr `t = m²` (so the blend eases in), which drives a single equation
// that linearly interpolates between the sphere level set
// (x²+y²+z²−r² = 0) and the torus level set
// ((x²+y²+z²+R²−r²)² − 4R²(x²+y²) = 0). Two sliders set the tube radius `r`
// and major radius `R`. Wired into a graph-mode transformer ("Morph Surface")
// and a 3D camera. No animation — drag `m`.
function sphereTorusScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="sphere → torus";
  cam.props.orbTheta="1.3";cam.props.orbPhi="0.89";cam.props.orbRadius="10.6435";
  cam.props.fov="50";cam.props.showGrid=false;cam.props.showAxes=false;
  const m=makeNode("slider",{x:-144,y:451});m.name="m";m.label="m · morph";m.value=0;
  m.props.min="0";m.props.max="1";m.props.step="0.01";
  const r=makeNode("slider",{x:15,y:117});r.name="r";r.label="small radius";r.value=1;
  r.props.min="1";r.props.max="3";r.props.step="0.01";
  const R=makeNode("slider",{x:19,y:221});R.name="R";R.label="Big Radius";R.value=2.35;
  R.props.min="2";R.props.max="6";R.props.step="0.01";
  const t=makeNode("expr",{x:163,y:391});t.name="t";t.label="Expr";t.props.expr="m^2";
  t.attachments=[m.id];
  const eq=makeNode("equation",{x:422,y:190});eq.label="sphere↔torus";eq.color="#00aeff";
  eq.props.dims="3d";
  eq.props.lhs="(1-t)*(x^2+y^2+z^2-r^2)+t*((x^2+y^2+z^2+R^2-r^2)^2-4*R^2*(x^2+y^2))";
  eq.props.rhs="1";eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  eq.attachments=[r.id,R.id,t.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="Morph Surface";tr.color="#fe7c7c";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.inAxis2="z";
  tr.props.outAxis0="z";tr.props.outAxis1="y";tr.props.outAxis2="none";
  tr.props.normalize=true;tr.props.arrowLen="0.5";tr.props.domainSrc="inline";
  tr.props.aMin="-4.4";tr.props.aMax="4.4";tr.props.bMin="-4.4";tr.props.bMax="4.4";
  tr.props.cMin="-1.6";tr.props.cMax="1.6";tr.props.res="180";tr.props.colorMode="off";
  tr.attachments=[eq.id];
  cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[m.id]:m,[r.id]:r,[R.id]:R,[t.id]:t,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:false};
}

// 2a/2b) Two implicit surfaces for a "acceleration" banner — each its own scene
// so two viewports can show different shapes. No animation. Both ray-marched.
function implicitGyroidScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="gyroid";
  cam.props.orbRadius="12";cam.props.orbTheta="0.8";cam.props.orbPhi="1.0";
  const eq=makeNode("equation",{x:360,y:160});eq.label="gyroid";eq.color="#a6e3a1";
  eq.props.dims="3d";
  eq.props.lhs="sin(1.4*x)*cos(1.4*y) + sin(1.4*y)*cos(1.4*z) + sin(1.4*z)*cos(1.4*x)";eq.props.rhs="0";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="Gyroid";tr.color="#a6e3a1";
  tr.props.mode="graph";
  tr.props.aMin="-3.2";tr.props.aMax="3.2";tr.props.bMin="-3.2";tr.props.bMax="3.2";tr.props.cMin="-3.2";tr.props.cMax="3.2";
  tr.props.res="200";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:false};
}
function barthScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="barth";
  cam.props.orbRadius="4.9";cam.props.orbTheta="-2.25";cam.props.orbPhi="1.515";
  cam.props.spin="loop";cam.props.spinPeriod="28";
  // morph animator slides the sphere term so the 65 nodes pulse through singular configs
  const anim=makeNode("animator",{x:40,y:320});anim.name="s";anim.value=0;
  anim.props.min="-1";anim.props.max="1";anim.props.period="16";anim.props.loop="pingpong";anim.playing=true;
  const eq=makeNode("equation",{x:360,y:160});eq.label="Barth Sextic";eq.color="#ff6ec7";
  eq.props.dims="3d";
  eq.props.lhs="4*((1.6180339887)^2*x^2 - y^2)*((1.6180339887)^2*y^2 - z^2)*((1.6180339887)^2*z^2 - x^2) - (1 + 2*1.6180339887)*(x^2 + y^2 + z^2 - (1+0.25*s))^2";
  eq.props.rhs="0";eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  eq.attachments=[anim.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="Depth";tr.color="#ff6ec7";
  tr.props.mode="graph";
  tr.props.aMin="-2.2";tr.props.aMax="2.2";tr.props.bMin="-2.2";tr.props.bMax="2.2";tr.props.cMin="-2.2";tr.props.cMax="2.2";
  tr.props.res="240";tr.props.colorMode="gradient";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[anim.id]:anim,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:true};
}
function whitneyScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="whitney";
  cam.props.orbRadius="7";cam.props.orbTheta="-3.675";cam.props.orbPhi="0.86";cam.props.targetZ="1";
  cam.props.spin="loop";cam.props.spinPeriod="26";
  const eq=makeNode("equation",{x:360,y:160});eq.label="Whitney Umbrella";eq.color="#7ad7ff";
  eq.props.dims="3d";
  eq.props.lhs="x^2 - y^2*z";eq.props.rhs="0";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="Whitney";tr.color="#7ad7ff";
  tr.props.mode="graph";
  tr.props.aMin="-2";tr.props.aMax="2";tr.props.bMin="-2";tr.props.bMax="2";tr.props.cMin="-0.5";tr.props.cMax="2.5";
  tr.props.res="240";tr.props.colorMode="gradient";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:true};
}
function implicitChmutovScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="chmutov";
  cam.props.orbRadius="10";cam.props.orbTheta="0.6";cam.props.orbPhi="1.05";
  const eq=makeNode("equation",{x:360,y:160});eq.label="chmutov";eq.color="#f9a8d4";
  eq.props.dims="3d";
  // a quartic Chmutov-style surface — bubbly, lots of interior structure.
  eq.props.lhs="x^4 - x^2 + y^4 - y^2 + z^4 - z^2";eq.props.rhs="-0.4";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="Chmutov";tr.color="#f9a8d4";
  tr.props.mode="graph";
  tr.props.aMin="-1.6";tr.props.aMax="1.6";tr.props.bMin="-1.6";tr.props.bMax="1.6";tr.props.cMin="-1.6";tr.props.cMax="1.6";
  tr.props.res="200";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:false};
}

// 3) Lissajous knot ribbon — a degree-2 parametric surface (a flat ribbon swept
// along a lissajous knot), with a sequenced reveal animated so a lit section of
// the ribbon travels around the knot.
function lissajousRibbonScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="lissajous ribbon";
  cam.props.orbRadius="11";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  // The animator drives the LEADING edge of the drawn section around the knot.
  // s runs a little past 2π so the section can fully exit before the loop wraps.
  const anim=makeNode("animator",{x:40,y:360});anim.name="s";anim.value=0;
  anim.props.period="5";anim.props.min="0";anim.props.max="7.5";anim.props.loop="loop";anim.playing=true;
  // A clean lissajous-knot ribbon: u runs ALONG the knot, v (−1..1) across the
  // ribbon width. The centerline is a (3,2,4)-lissajous curve; the width offset is
  // a small vector so the ribbon has body. No width-window trickery — the visible
  // SECTION is produced purely by animating the u-domain: only u∈[uMin,uMax] is
  // drawn, and that window slides around the loop. Because domain bounds are live
  // GPU uniforms now, the section runs at frame rate with no per-frame rebuild.
  const ribbon=makeNode("paramsurf",{x:560,y:160});ribbon.label="ribbon";ribbon.color="#c4b5fd";
  ribbon.props.exprX="2.2*cos(3*u) + 0.18*v*cos(3*u)";
  ribbon.props.exprY="2.2*sin(2*u) + 0.18*v*sin(2*u)";
  ribbon.props.exprZ="sin(4*u) + 0.18*v*cos(4*u)";
  // The drawn section: leading edge at s, trailing edge a fixed arc (1.4 rad)
  // behind. Clamped into [0, 2π] by the expressions so the window enters at the
  // start of the loop and exits at the end, then re-enters as s loops — reading
  // as a lit segment flying around the knot.
  ribbon.props.uMin="max(0, s - 1.4)";
  ribbon.props.uMax="min(6.283, s)";
  ribbon.props.vMin="-1";ribbon.props.vMax="1";
  ribbon.props.uRes="240";ribbon.props.vRes="6";
  ribbon.attachments=[anim.id];
  cam.attachments=[ribbon.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[anim.id]:anim,[ribbon.id]:ribbon},camId:cam.id,animated:true};
}

// 4) Flow surface in 3D: a line segment (0,0,0)→(1,0,0) integrated through a 3D
// vector field whose z-component is constant, with the field ALSO drawn as a
// quiver on the x-y plane so you can see what the surface is integrating.
function flowSurface3DScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="flow surface";
  cam.props.orbRadius="9";cam.props.orbTheta="0.8";cam.props.orbPhi="0.95";
  // The vector field: swirl in x-y with a CONSTANT z lift, so trajectories spiral
  // upward and the seeds sweep out a helicoidal stream surface.
  const field=makeNode("fnMap",{x:300,y:120});field.props.inDim="3";field.props.outDim="3";
  field.props.out0="-y";field.props.out1="x";field.props.out2="0.6";   // constant z
  // seed line segment (0,0,0) → (1,0,0)
  const seeds=makeNode("paramSpace",{x:300,y:320});seeds.label="seed line";seeds.props.degree="1";
  seeds.props.exprX="t";seeds.props.exprY="0";seeds.props.exprZ="0";seeds.props.tMin="0";seeds.props.tMax="1";seeds.props.res="28";
  const flow=makeNode("flow",{x:640,y:200});flow.label="Stream Surface";flow.color="#5be0c0";
  flow.props.steps="320";flow.props.stepSize="0.03";flow.props.output="surface";
  flow.props.gradient=true;flow.props.gradA="#5be0c0";flow.props.gradB="#5b9cf6";
  flow.attachments=[field.id,seeds.id];
  // the SAME field drawn as a quiver on the x-y plane (z=0 slice) to visualize it.
  // A 3D→3D fnMap into a field-mode transformer, sampled on a thin z slab.
  const fieldFn=makeNode("fnMap",{x:300,y:520});fieldFn.props.inDim="3";fieldFn.props.outDim="3";
  fieldFn.props.out0="-y";fieldFn.props.out1="x";fieldFn.props.out2="0.6";
  const quiver=makeNode("transformer",{x:640,y:460});quiver.label="Field (x-y plane)";quiver.color="#ffb454";
  quiver.props.mode="field";
  quiver.props.inAxis0="x";quiver.props.inAxis1="y";quiver.props.inAxis2="z";
  quiver.props.outAxis0="x";quiver.props.outAxis1="y";quiver.props.outAxis2="z";
  quiver.props.aMin="-2.5";quiver.props.aMax="2.5";quiver.props.bMin="-2.5";quiver.props.bMax="2.5";
  quiver.props.cMin="0";quiver.props.cMax="0";   // single z=0 plane
  quiver.props.res="9";quiver.props.arrowLen="0.45";quiver.props.normalize=true;
  quiver.attachments=[fieldFn.id];
  cam.attachments=[flow.id,quiver.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[field.id]:field,[seeds.id]:seeds,[flow.id]:flow,[fieldFn.id]:fieldFn,[quiver.id]:quiver},camId:cam.id,animated:false};
}

// 5) Recursive glyph sequence. Authored selection: a Points node in glyph mode
// whose data is a true recurrence — each step rotates/scales the previous point
// (and its attached vector) by the slider `a`, starting from (4,4) with a fixed
// first vector. The count comes from an expr `b = 256`, so 256 glyphs sweep out
// a self-similar logarithmic spiral. A 2D camera with grid + axes. A crest
// animation runs a highlight along the sequence. Drag `a` to reshape the spiral.
function recursiveGlyphScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:942,y:265}));cam.label="Cam2D";
  cam.props.orbTheta="0.8";cam.props.orbPhi="1.0";cam.props.orbRadius="14";
  cam.props.showGrid=true;cam.props.showAxes=true;
  const a=makeNode("slider",{x:86,y:128});a.name="a";a.label="Slider";a.value=0.53;
  a.props.min="0";a.props.max="1";a.props.step="0.01";
  const b=makeNode("expr",{x:61,y:344});b.name="b";b.label="Expr";b.props.expr="256";
  const pts=makeNode("points",{x:414,y:250});pts.label="Points";pts.color="#ff552b";
  pts.props.kind="glyphs";pts.props.mode="recursive";pts.props.useColor=false;
  pts.props.recGlyphInit="4, 4 | -8*a, 0";
  pts.props.recGlyphStep=
    "x[n-1] - (x[n-1] + y[n-1])*a, y[n-1] + (x[n-1] - y[n-1])*a | "+
    "-(x[n-1] - (x[n-1] + y[n-1])*a + y[n-1] + (x[n-1] - y[n-1])*a)*a, "+
    "((x[n-1] - (x[n-1] + y[n-1])*a) - (y[n-1] + (x[n-1] - y[n-1])*a))*a";
  pts.props.recGlyphCount="b";
  pts.props.radius="4";pts.props.drawLines=true;pts.props.arrowLen="1";pts.props.normalize=true;
  pts.props.anim="crest";pts.props.speed="1";pts.props.crestColor="#ffffff";
  pts.props.colorMode="off";pts.props.colorExpr="i";pts.props.colorLo="#3a6aff";pts.props.colorHi="#ff5ea8";
  pts.props.lenMode="raw";
  pts.attachments=[a.id,b.id];
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[a.id]:a,[b.id]:b,[pts.id]:pts},camId:cam.id,animated:false};
}

// 6) Wavy torus — an animated implicit surface. The level set
// (√(x²+y²) − 2)² + z² = 1 + 0.2·sin(8x+p)·sin(8y)·sin(8z) is a torus whose
// tube is rippled by a 3-axis sine product; an animator `p` (0 → 2π, looping)
// drifts the ripple phase so the bumps crawl around the surface. Graph-mode
// transformer + a long-lens 3D camera. Animated.
function wavyTorusScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:944,y:1185}));cam.label="Camera 3D";
  cam.props.orbTheta="-0.06";cam.props.orbPhi="0.925";cam.props.orbRadius="36.1935";
  cam.props.fov="10";cam.props.showGrid=false;cam.props.showAxes=false;
  const p=makeNode("animator",{x:56,y:1179});p.name="p";p.label="Anim";p.value=0;
  p.props.min="0";p.props.max="2*pi";p.props.period="4";p.props.loop="loop";p.props.step="";p.playing=true;
  const eq=makeNode("equation",{x:321,y:1177});eq.label="equation";eq.color="#4ff4ef";
  eq.props.dims="3d";
  eq.props.lhs="(sqrt(x^2+y^2)-2)^2+z^2";
  eq.props.rhs="1+0.2*sin(8*x+p)*sin(8*y)*sin(8*z)";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  eq.attachments=[p.id];
  const tr=makeNode("transformer",{x:634,y:1185});tr.label="Transformer";tr.color="#8ab9f9";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.inAxis2="z";
  tr.props.outAxis0="z";tr.props.outAxis1="y";tr.props.outAxis2="none";
  tr.props.normalize=true;tr.props.arrowLen="0.5";tr.props.domainSrc="inline";
  tr.props.aMin="-4";tr.props.aMax="4";tr.props.bMin="-4";tr.props.bMax="4";
  tr.props.cMin="-3";tr.props.cMax="3";tr.props.res="64";tr.props.colorMode="off";
  tr.attachments=[eq.id];
  cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[p.id]:p,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:true};
}

// A gallery of four implicit surfaces, each its own equation→transformer→camera
// chain: an animated quasicrystal, the morphing Barth sextic, the Whitney
// umbrella, and a 5-fold torus ring. Mirrors a saved selection; the polynomials
// are kept verbatim so the singular structure resolves correctly. Two of the
// chains carry their own `s` animator (independent, since scope is per-consumer).
function implicitGalleryScene(){
  const project=makeProjectNode("preview");
  const scene={[project.id]:project};
  const add=(n)=>{ scene[n.id]=n; return n; };

  // helper: build one equation→transformer→camera chain, with an optional animator
  const chain=(opts)=>{
    const y=opts.y;
    let animId=null;
    if(opts.anim){
      const a=add(makeNode("animator",{x:-220,y}));
      a.label=opts.anim.label; a.name="s"; a.value=0;
      Object.assign(a.props, opts.anim.props); a.playing=true;
      animId=a.id;
    }
    const eq=add(makeNode("equation",{x:60,y}));
    eq.label=opts.label; eq.color=opts.color;
    eq.props.dims="3d"; eq.props.lhs=opts.lhs; eq.props.rhs="0";
    eq.props.varA="x"; eq.props.varB="y"; eq.props.varC="z";
    if(animId) eq.attachments=[animId];
    const tr=add(makeNode("transformer",{x:320,y}));
    tr.label=opts.trLabel; tr.color=opts.color; tr.props.mode="graph";
    Object.assign(tr.props, opts.dom);
    tr.props.colorMode=opts.colorMode; tr.props.colorShift=opts.colorShift||"0";
    tr.attachments=[eq.id];
    const cam=add(previewCam(makeNode("camera3d",{x:600,y})));
    cam.label=opts.camLabel;
    Object.assign(cam.props, opts.cam);
    cam.props.spin="loop"; cam.props.spinPeriod=opts.spinPeriod||"28";
    cam.attachments=[tr.id];
    return cam.id;
  };

  const camId=chain({
    y:140, label:"Quasicrystal", trLabel:"Trippy", camLabel:"trippy", color:"#9b5cff",
    anim:{label:"flow", props:{min:"0",max:"6.2832",period:"24",loop:"loop",step:""}},
    lhs:"cos(8*x+s)*cos(2*y) + cos(2*y+s)*cos(2*z) + cos(2*z+s)*cos(2*x) + 0.6*(cos(3*x)+cos(3*y)+cos(3*z))",
    dom:{aMin:"-10",aMax:"10",bMin:"-3.4",bMax:"3.4",cMin:"-10",cMax:"10",res:"240"},
    colorMode:"normal", colorShift:"0.2",
    cam:{orbTheta:"-29.449",orbPhi:"1.445",orbRadius:"27.82",bgOverride:true,bgColor:"#05030f",showGrid:false,showAxes:false},
    spinPeriod:"30",
  });

  chain({
    y:360, label:"Barth Sextic", trLabel:"Depth", camLabel:"barth", color:"#ff6ec7",
    anim:{label:"morph", props:{min:"-1",max:"1",period:"16",loop:"pingpong",step:""}},
    lhs:"4*((1.6180339887)^2*x^2 - y^2)*((1.6180339887)^2*y^2 - z^2)*((1.6180339887)^2*z^2 - x^2) - (1 + 2*1.6180339887)*(x^2 + y^2 + z^2 - (1+0.25*s))^2",
    dom:{aMin:"-2.2",aMax:"2.2",bMin:"-2.2",bMax:"2.2",cMin:"-2.2",cMax:"2.2",res:"260"},
    colorMode:"gradient",
    cam:{orbTheta:"-2.25",orbPhi:"1.515",orbRadius:"4.9",bgOverride:true,bgColor:"#05030f",showGrid:false,showAxes:false},
    spinPeriod:"28",
  });

  chain({
    y:560, label:"Whitney Umbrella", trLabel:"Whitney", camLabel:"whitney", color:"#7ad7ff",
    lhs:"x^2 - y^2*z",
    dom:{aMin:"-2",aMax:"2",bMin:"-2",bMax:"2",cMin:"-0.5",cMax:"2.5",res:"260"},
    colorMode:"gradient",
    cam:{targetZ:"1",orbTheta:"-3.675",orbPhi:"0.86",orbRadius:"7",bgOverride:true,bgColor:"#06080f",showGrid:false,showAxes:false},
    spinPeriod:"26",
  });

  chain({
    y:760, label:"Torus Ring (5)", trLabel:"Torus Ring", camLabel:"ring", color:"#ffcf6e",
    lhs:"((sqrt((x-(1.60000))^2 + (y-(0.00000))^2) - 1)^2 + z^2 - 0.1024) * ((sqrt((x-(0.49443))^2 + (y-(1.52169))^2) - 1)^2 + z^2 - 0.1024) * ((sqrt((x-(-1.29443))^2 + (y-(0.94046))^2) - 1)^2 + z^2 - 0.1024) * ((sqrt((x-(-1.29443))^2 + (y-(-0.94046))^2) - 1)^2 + z^2 - 0.1024) * ((sqrt((x-(0.49443))^2 + (y-(-1.52169))^2) - 1)^2 + z^2 - 0.1024)",
    dom:{aMin:"-3",aMax:"3",bMin:"-3",bMax:"3",cMin:"-0.6",cMax:"0.6",res:"300"},
    colorMode:"gradient",
    cam:{orbTheta:"-3.86",orbPhi:"0.955",orbRadius:"5.0274",bgOverride:true,bgColor:"#07060e",showGrid:true,showAxes:true},
    spinPeriod:"30",
  });

  // camId points at the first (quasicrystal) camera for any embedded-preview use;
  // the #demo=implicit editor route shows the full four-surface graph.
  return {scene, camId, animated:true};
}

// Viviani's curve: the intersection of two implicit SURFACES. A sphere of radius
// 2 and a cylinder of radius 1 tangent to the sphere's axis meet in a figure-eight
// space curve. Two 3D equations wired into one transformer draw the curve
// {F=0}∩{G=0} directly (no parametrization). The two faint surfaces are drawn
// alongside so the curve reads as where they cross.
function vivianiScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1140,y:160}));cam.label="Viviani's curve";
  cam.props.orbRadius="7.5";cam.props.orbTheta="0.7";cam.props.orbPhi="1.05";
  cam.props.spin="loop";cam.props.spinPeriod="30";
  // sphere x²+y²+z² = 4
  const sph=makeNode("equation",{x:360,y:120});sph.label="sphere";sph.color="#5b9cf6";
  sph.props.dims="3d";sph.props.lhs="x^2 + y^2 + z^2";sph.props.rhs="4";
  sph.props.varA="x";sph.props.varB="y";sph.props.varC="z";
  // cylinder (x−1)² + y² = 1
  const cyl=makeNode("equation",{x:360,y:300});cyl.label="cylinder";cyl.color="#52d47e";
  cyl.props.dims="3d";cyl.props.lhs="(x-1)^2 + y^2";cyl.props.rhs="1";
  cyl.props.varA="x";cyl.props.varB="y";cyl.props.varC="z";
  // intersection curve transformer (both equations wired)
  const tr=makeNode("transformer",{x:740,y:210});tr.label="∩ curve";tr.color="#ffd479";
  tr.props.aMin="-2.2";tr.props.aMax="2.2";tr.props.bMin="-2.2";tr.props.bMax="2.2";tr.props.cMin="-2.2";tr.props.cMax="2.2";
  tr.props.res="96";
  tr.attachments=[sph.id,cyl.id];
  cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[sph.id]:sph,[cyl.id]:cyl,[tr.id]:tr},camId:cam.id,animated:false};
}

// ── Demos for the new shading / GPU / intersection features ──────────────────
// Each registers a hyphenated kind reachable at #demo=<kind>.

// LIT SHADING + ANALYTIC NORMALS: an animated ripple in "lit" mode. The
// highlight is computed per fragment from the EXACT analytic normal (symbolic
// f_x,f_y), so it stays smooth and tracks the true surface as it animates — no
// faceting, independent of grid resolution. Drop res low in the editor to see
// the silhouette coarsen while the shading stays smooth.
// Helper: a lit graph surface authored the design-correct way — an fnMap (the
// pure map z = f(x,y)) wired into a transformer (graph mode) that carries the
// plot + shading parameters. `o.mat` patches material props onto the transformer;
// `o.extraDeps` are extra fnMap dependencies (e.g. a helper fnDef); `o.period`
// adds an animator t wired into the fnMap.
function litGraphScene(o){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1120,y:120}));cam.label=o.label;
  cam.props.orbRadius=o.orbRadius||"11";cam.props.orbTheta="0.7";cam.props.orbPhi=o.orbPhi||"1.0";
  if(o.spin){ cam.props.spin="loop"; cam.props.spinPeriod=o.spin; }
  const col=o.color||"#5b9cf6";
  const fn=makeNode("fnMap",{x:380,y:160});fn.label=o.fnLabel||"f(x,y)";fn.color=col;
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0=o.expr;
  const tr=makeNode("transformer",{x:720,y:160});tr.label=o.trLabel||"graph · lit";tr.color=col;
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  const r=o.range||"4.5";
  tr.props.aMin="-"+r;tr.props.aMax=r;tr.props.bMin="-"+r;tr.props.bMax=r;tr.props.res=o.res||"64";
  tr.props.showWire=false;tr.props.shading="lit";
  Object.assign(tr.props, o.mat||{});
  const scene={[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr};
  const fnDeps=[];
  for(const d of (o.extraDeps||[])){ scene[d.id]=d; fnDeps.push(d.id); }
  let animated=false;
  if(o.period){
    const a=makeNode("animator",{x:40,y:320});a.name="t";a.value=0;
    a.props.min="0";a.props.max="6.283";a.props.period=o.period;a.props.loop="loop";a.playing=true;
    scene[a.id]=a; fnDeps.push(a.id); animated=true;
  }
  fn.attachments=fnDeps; tr.attachments=[fn.id]; cam.attachments=[tr.id];
  return {scene, camId:cam.id, animated};
}

// LIT SHADING + ANALYTIC NORMALS: an animated ripple. The highlight is the exact
// analytic normal (from the symbolic derivative of the mapped output), so it
// stays smooth and tracks the moving surface — drop res in the editor to see the
// silhouette coarsen while shading stays smooth.
function litRippleScene(){
  return litGraphScene({ label:"lit ripple · analytic normals", expr:"sin(sqrt(x^2+y^2)*1.6 - t)*0.9",
    fnLabel:"z = sin(r·1.6 − t)", trLabel:"graph · lit", color:"#5b9cf6", range:"4.5", res:"64", period:"7" });
}
// LIT SHADING on curvature: a slowly spinning monkey saddle; the specular
// highlight sweeps the analytic surface and reads its true curvature.
function litSaddleScene(){
  return litGraphScene({ label:"lit saddle", expr:"(x^3 - 3*x*y^2)*0.16", fnLabel:"z = x³ − 3xy²",
    color:"#c761f7", range:"2.4", res:"80", orbRadius:"9", orbPhi:"0.95", spin:"26" });
}
// fnDef GPU INLINING + lit: the map is COMPOSED from a helper bump(r). Before the
// inlining work this fell to the CPU; now the helper is inlined into the shader.
// Lit uses the screen-space normal fallback (mathjs can't differentiate a user
// function) — the documented behavior for composed surfaces.
function composedSurfaceScene(){
  const bump=makeNode("fnDef",{x:120,y:320});bump.name="bump";bump.color="#a6e3a1";
  bump.props.params="r";bump.props.expr="exp(-r^2)";
  return litGraphScene({ label:"composed surface (GPU-inlined)",
    expr:"bump(hypot(x-1.4,y)) + bump(hypot(x+1.4,y)) + 0.7*bump(hypot(x,y-1.4))",
    fnLabel:"z = Σ bump(…)", color:"#a6e3a1", range:"4", res:"72", orbRadius:"9", spin:"30",
    extraDeps:[bump] });
}

// INTERSECTION CURVE: the Steinmetz bicylinder — two perpendicular unit
// cylinders x²+y²=1 ∩ x²+z²=1 meet in a pair of ellipses.
function steinmetzScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1140,y:160}));cam.label="Steinmetz intersection";
  cam.props.orbRadius="5.5";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  cam.props.spin="loop";cam.props.spinPeriod="26";
  const cy1=makeNode("equation",{x:360,y:120});cy1.label="cylinder x²+y²";cy1.color="#5b9cf6";
  cy1.props.dims="3d";cy1.props.lhs="x^2 + y^2";cy1.props.rhs="1";cy1.props.varA="x";cy1.props.varB="y";cy1.props.varC="z";
  const cy2=makeNode("equation",{x:360,y:300});cy2.label="cylinder x²+z²";cy2.color="#52d47e";
  cy2.props.dims="3d";cy2.props.lhs="x^2 + z^2";cy2.props.rhs="1";cy2.props.varA="x";cy2.props.varB="y";cy2.props.varC="z";
  const tr=makeNode("transformer",{x:740,y:210});tr.label="∩ curve";tr.color="#ffd479";
  tr.props.aMin="-1.4";tr.props.aMax="1.4";tr.props.bMin="-1.4";tr.props.bMax="1.4";tr.props.cMin="-1.4";tr.props.cMax="1.4";
  tr.props.res="120";
  tr.attachments=[cy1.id,cy2.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[cy1.id]:cy1,[cy2.id]:cy2,[tr.id]:tr},camId:cam.id,animated:false};
}

// INTERSECTION CURVE: sphere ∩ plane = a circle. The second "surface" is the
// plane z = 0.7 written as an equation, so the intersection is the latitude circle.
function spherePlaneScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1140,y:160}));cam.label="sphere ∩ plane = circle";
  cam.props.orbRadius="7";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  cam.props.spin="loop";cam.props.spinPeriod="28";
  const sph=makeNode("equation",{x:360,y:120});sph.label="sphere";sph.color="#5b9cf6";
  sph.props.dims="3d";sph.props.lhs="x^2 + y^2 + z^2";sph.props.rhs="4";sph.props.varA="x";sph.props.varB="y";sph.props.varC="z";
  const pln=makeNode("equation",{x:360,y:300});pln.label="plane z = 0.7";pln.color="#52d47e";
  pln.props.dims="3d";pln.props.lhs="z";pln.props.rhs="0.7";pln.props.varA="x";pln.props.varB="y";pln.props.varC="z";
  const tr=makeNode("transformer",{x:740,y:210});tr.label="∩ curve";tr.color="#ffd479";
  tr.props.aMin="-2.2";tr.props.aMax="2.2";tr.props.bMin="-2.2";tr.props.bMax="2.2";tr.props.cMin="-2.2";tr.props.cMax="2.2";
  tr.props.res="96";
  tr.attachments=[sph.id,pln.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[sph.id]:sph,[pln.id]:pln,[tr.id]:tr},camId:cam.id,animated:false};
}

// MATERIAL (Stage 3): per-fragment colour from an expression, ramped to a crisp
// checkerboard albedo on a lit surface. Vertex-interpolated colour would smear
// the checker; evaluating per fragment keeps the edges sharp.
function matCheckerScene(){
  return litGraphScene({ label:"material · checker albedo", expr:"0.5*sin(x)*cos(y)",
    fnLabel:"z = ½ sin(x)cos(y)", color:"#5b9cf6", range:"3.2", res:"96", spin:"28", orbRadius:"9",
    mat:{ matColorMode:"ramp", matColor:"sign(sin(2.4*x))*sign(sin(2.4*y))",
          matColorLo:"#16213a", matColorHi:"#ffd166", matColorMin:"-1", matColorMax:"1" } });
}

// MATERIAL: an animated ramp colour tracking the wave — the material reads the
// animator t, so the colour sweeps with the surface.
function matRingsScene(){
  return litGraphScene({ label:"material · animated colour", expr:"sin(sqrt(x^2+y^2)*1.4 - t)*0.8",
    fnLabel:"z = sin(r·1.4 − t)", color:"#5b9cf6", range:"4.5", res:"64", period:"6",
    mat:{ matColorMode:"ramp", matColor:"sin(sqrt(x^2+y^2)*1.4 - t)",
          matColorLo:"#1b3a8f", matColorHi:"#ff5ea8", matColorMin:"-1", matColorMax:"1" } });
}

// MATERIAL (RGB mode): the colour is three independent expressions, a full colour
// field rather than a single gradient — here a smooth domain-coloured ramp.
function matRgbScene(){
  return litGraphScene({ label:"material · RGB colour field", expr:"0.4*sin(x)*sin(y)",
    fnLabel:"z = ⅖ sin(x)sin(y)", color:"#5b9cf6", range:"3.14", res:"96", spin:"30", orbRadius:"9",
    mat:{ matColorMode:"rgb", matR:"0.5+0.5*sin(x)", matG:"0.5+0.5*cos(y)", matB:"0.5+0.5*sin(x+y)" } });
}

// MATERIAL: additive emission — glow bands sweep a dark lit dome. Emission is
// added after lighting, so the bands self-illuminate.
function matGlowScene(){
  return litGraphScene({ label:"material · emission glow", expr:"exp(-(x^2+y^2)*0.16)*1.6",
    fnLabel:"z = e^(−0.16 r²)", color:"#16203a", range:"4", res:"72", period:"5", orbRadius:"9", orbPhi:"0.95",
    mat:{ matEmit:"pow(max(0.0, sin(2.5*(x+y) - t)), 3.0)", matEmitColor:"#5be0c0" } });
}

// TEXTURE SOURCE: a Texture node (the default Dedekind tile) wired into the
// transformer, sampled as albedo at the surface's UV (its grid coordinates).
function texSurfaceScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1120,y:120}));cam.label="textured surface";
  cam.props.orbRadius="9";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="30";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="z = ½ sin(x)cos(y)";fn.color="#8aadf4";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="0.5*sin(x)*cos(y)";
  const tex=makeNode("texture",{x:360,y:360});tex.label="Dedekind tile";tex.color="#f5bde6";   // src defaults to the embedded ◈ tile
  const tr=makeNode("transformer",{x:740,y:200});tr.label="graph · textured";tr.color="#8aadf4";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  tr.props.aMin="-3.14";tr.props.aMax="3.14";tr.props.bMin="-3.14";tr.props.bMax="3.14";tr.props.res="80";
  tr.props.showWire=false;tr.props.shading="lit";tr.props.matColorMode="texture";
  tr.attachments=[fn.id,tex.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tex.id]:tex,[tr.id]:tr},camId:cam.id,animated:false};
}

// TEXTURE on a parametric SURFACE: the Dedekind tile tiled over a torus's (u,v),
// sampled at the surface's own parameters with a UV tiling transform.
function texParamSurfScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1120,y:120}));cam.label="textured torus";
  cam.props.orbRadius="7.5";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="32";
  const ps=makeNode("paramSpace",{x:380,y:160});ps.label="torus";ps.color="#c761f7";
  ps.props.degree="2";
  ps.props.exprXu="(2+cos(v))*cos(u)";ps.props.exprYu="(2+cos(v))*sin(u)";ps.props.exprZu="sin(v)";
  ps.props.uMin="0";ps.props.uMax="2*pi";ps.props.vMin="0";ps.props.vMax="2*pi";ps.props.uRes="96";ps.props.vRes="48";
  ps.props.showWire=false;ps.props.shading="lit";ps.props.matColorMode="texture";ps.props.uvScaleU="6";ps.props.uvScaleV="2";
  const tex=makeNode("texture",{x:380,y:360});tex.label="Dedekind tile";tex.color="#f5bde6";tex.props.wrap="repeat";
  ps.attachments=[tex.id];cam.attachments=[ps.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[ps.id]:ps,[tex.id]:tex},camId:cam.id,animated:false};
}

// NORMAL MAP: a flat-ish lit surface carrying a tangent-space normal map. The
// geometry is nearly planar (a gentle dome) but the embossed pyramid bumps come
// entirely from the normal texture perturbing the lit normal — no extra polygons.
// A second Texture node (role = normal map) is wired alongside the colour tile.
function normalMapScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1120,y:120}));cam.label="normal-mapped surface";
  cam.props.orbRadius="9";cam.props.orbTheta="0.7";cam.props.orbPhi="0.85";cam.props.spin="loop";cam.props.spinPeriod="30";
  const fn=makeNode("fnMap",{x:360,y:140});fn.label="z = gentle dome";fn.color="#8aadf4";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="0.6*exp(-(x^2+y^2)*0.08)";
  const nrm=makeNode("texture",{x:360,y:360});nrm.label="normal map";nrm.color="#a6da95";
  nrm.props.role="normal";nrm.props.src=DEFAULT_NORMAL_SRC;nrm.props.wrap="repeat";
  const tr=makeNode("transformer",{x:740,y:200});tr.label="graph · lit + bumps";tr.color="#8aadf4";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  tr.props.aMin="-4";tr.props.aMax="4";tr.props.bMin="-4";tr.props.bMax="4";tr.props.res="80";
  // Flat node-colour albedo so the bumps are what you read; the relief is entirely
  // the normal map perturbing the lit normal. One copy of the tile → 16 pyramids.
  tr.props.showWire=false;tr.props.shading="lit";tr.props.matColorMode="off";
  tr.props.uvScaleU="1";tr.props.uvScaleV="1";tr.props.matNormalStrength="1";
  tr.attachments=[fn.id,nrm.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[nrm.id]:nrm,[tr.id]:tr},camId:cam.id,animated:false};
}

// SCENE LIGHTS: two coloured lights wired into the camera light a matte surface.
// A warm point light orbits the dome (its position driven by an animator t), and
// a cool directional light fills from the side. Lights are scene entities on the
// camera — not material inputs — so every lit surface in the view picks them up.
function lightsScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1140,y:120}));cam.label="scene lights";
  cam.props.orbRadius="10";cam.props.orbTheta="0.7";cam.props.orbPhi="0.92";
  const fn=makeNode("fnMap",{x:360,y:140});fn.label="z = ripple";fn.color="#cdd6f4";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="0.5*sin(x)*cos(y)";
  const tr=makeNode("transformer",{x:720,y:160});tr.label="graph · lit";tr.color="#cdd6f4";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  tr.props.aMin="-3.4";tr.props.aMax="3.4";tr.props.bMin="-3.4";tr.props.bMax="3.4";tr.props.res="90";
  tr.props.showWire=false;tr.props.shading="lit";   // matte node-colour albedo so the coloured light reads
  // an animator drives the orbiting point light
  const anim=makeNode("animator",{x:40,y:360});anim.name="t";anim.value=0;
  anim.props.min="0";anim.props.max="6.283";anim.props.period="6";anim.props.loop="loop";anim.playing=true;
  const warm=makeNode("light",{x:380,y:360});warm.label="warm orbit";warm.color="#ffd28a";
  warm.props.kind="point";warm.props.color="#ffcaa0";warm.props.intensity="2.2";warm.props.falloff="0.02";
  warm.props.posX="4.5*cos(t)";warm.props.posY="4.5*sin(t)";warm.props.posZ="3";
  warm.attachments=[anim.id];
  const cool=makeNode("light",{x:380,y:520});cool.label="cool fill";cool.color="#8fb7ff";
  cool.props.kind="directional";cool.props.color="#7fa8ff";cool.props.intensity="0.6";
  cool.props.dirX="-0.6";cool.props.dirY="-0.3";cool.props.dirZ="0.5";
  cam.attachments=[tr.id,warm.id,cool.id];tr.attachments=[fn.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr,[anim.id]:anim,[warm.id]:warm,[cool.id]:cool},camId:cam.id,animated:true};
}

// DYNAMIC LIGHTING on a PARAMETRIC SURFACE: a matte torus lit by a warm point
// light orbiting through its hole (position driven by the animator t) plus a cool
// directional fill. The surface keeps still while the moving light reveals its
// curvature — the highlight sweeps the tube as the lamp passes. Lights are on the
// camera, so the parametric surface picks them up just like a graph surface.
function lightsParamScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1140,y:120}));cam.label="dynamic light · torus";
  cam.props.orbRadius="8.5";cam.props.orbTheta="0.7";cam.props.orbPhi="0.78";
  const ps=makeNode("paramSpace",{x:380,y:160});ps.label="torus";ps.color="#cdd6f4";
  ps.props.degree="2";
  ps.props.exprXu="(2+0.9*cos(v))*cos(u)";ps.props.exprYu="(2+0.9*cos(v))*sin(u)";ps.props.exprZu="0.9*sin(v)";
  ps.props.uMin="0";ps.props.uMax="2*pi";ps.props.vMin="0";ps.props.vMax="2*pi";ps.props.uRes="120";ps.props.vRes="60";
  ps.props.showWire=false;ps.props.shading="lit";   // matte node colour → the moving light is the whole show
  // animator drives a warm point light orbiting through the torus hole
  const anim=makeNode("animator",{x:40,y:380});anim.name="t";anim.value=0;
  anim.props.min="0";anim.props.max="6.283";anim.props.period="7";anim.props.loop="loop";anim.playing=true;
  const warm=makeNode("light",{x:380,y:380});warm.label="orbiting lamp";warm.color="#ffd28a";
  warm.props.kind="point";warm.props.color="#ffd2a0";warm.props.intensity="2.6";warm.props.falloff="0.06";
  warm.props.posX="3.2*cos(t)";warm.props.posY="3.2*sin(t)";warm.props.posZ="1.2*sin(2*t)";
  warm.attachments=[anim.id];
  const cool=makeNode("light",{x:380,y:540});cool.label="cool fill";cool.color="#8fb7ff";
  cool.props.kind="directional";cool.props.color="#7fa8ff";cool.props.intensity="0.5";
  cool.props.dirX="-0.5";cool.props.dirY="-0.4";cool.props.dirZ="0.6";
  cam.attachments=[ps.id,warm.id,cool.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[ps.id]:ps,[anim.id]:anim,[warm.id]:warm,[cool.id]:cool},camId:cam.id,animated:true};
}

// BRICK SPHERE: the classic shading test. A parametric sphere with a brick albedo
// texture AND a matching brick normal map (both built-ins, referenced by id so the
// project stays shareable). The geometry is a smooth sphere — every brick edge and
// mortar groove is the normal map perturbing the lit normal. A warm point light
// orbits it so the relief catches the light as it passes.
function brickSphereScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1160,y:120}));cam.label="brick sphere";
  cam.props.orbRadius="7";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="40";
  const ps=makeNode("paramSpace",{x:380,y:140});ps.label="sphere";ps.color="#e6c9a8";
  ps.props.degree="2";
  ps.props.exprXu="2*cos(u)*sin(v)";ps.props.exprYu="2*sin(u)*sin(v)";ps.props.exprZu="2*cos(v)";
  ps.props.uMin="0";ps.props.uMax="2*pi";ps.props.vMin="0";ps.props.vMax="pi";ps.props.uRes="160";ps.props.vRes="100";
  ps.props.showWire=false;ps.props.shading="lit";ps.props.matColorMode="texture";
  ps.props.uvScaleU="6";ps.props.uvScaleV="3";ps.props.matNormalStrength="1.1";
  const tex=makeNode("texture",{x:380,y:340});tex.label="brick";tex.color="#c98a6a";
  tex.props.src="builtin:brick";tex.props.wrap="repeat";
  const nrm=makeNode("texture",{x:380,y:470});nrm.label="brick normal";nrm.color="#a6da95";
  nrm.props.role="normal";nrm.props.src="builtin:brick-normal";nrm.props.wrap="repeat";
  const anim=makeNode("animator",{x:40,y:360});anim.name="t";anim.value=0;
  anim.props.min="0";anim.props.max="6.283";anim.props.period="8";anim.props.loop="loop";anim.playing=true;
  const warm=makeNode("light",{x:380,y:600});warm.label="orbit lamp";warm.color="#ffd28a";
  warm.props.kind="point";warm.props.color="#ffdcb0";warm.props.intensity="2.4";warm.props.falloff="0.04";
  warm.props.posX="4.5*cos(t)";warm.props.posY="4.5*sin(t)";warm.props.posZ="2.5";
  warm.attachments=[anim.id];
  const cool=makeNode("light",{x:380,y:740});cool.label="sky fill";cool.color="#8fb7ff";
  cool.props.kind="directional";cool.props.color="#9fb8ff";cool.props.intensity="0.45";
  cool.props.dirX="-0.4";cool.props.dirY="-0.3";cool.props.dirZ="0.7";
  ps.attachments=[tex.id,nrm.id];cam.attachments=[ps.id,warm.id,cool.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[ps.id]:ps,[tex.id]:tex,[nrm.id]:nrm,[anim.id]:anim,[warm.id]:warm,[cool.id]:cool},camId:cam.id,animated:true};
}

// LISTS: a cube as two shared lists — a vertex list and an edge list of index
// pairs (1-based). The edges REFERENCE the vertices by index rather than copying
// coordinates, so the eight corners are one source of truth: edit a vertex and
// every edge that touches it moves. This is the first-class-list foundation.
function listCubeScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1140,y:120}));cam.label="cube from lists";
  cam.props.orbRadius="7";cam.props.orbTheta="0.8";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="22";
  const V=makeNode("list",{x:360,y:140});V.name="V";V.label="vertices";V.color="#f7d9a0";
  V.props.expr="[[-1.4,-1.4,-1.4],[1.4,-1.4,-1.4],[1.4,1.4,-1.4],[-1.4,1.4,-1.4],[-1.4,-1.4,1.4],[1.4,-1.4,1.4],[1.4,1.4,1.4],[-1.4,1.4,1.4]]";
  const E=makeNode("list",{x:360,y:340});E.name="E";E.label="edges";E.color="#f7d9a0";
  E.props.expr="[[1,2],[2,3],[3,4],[4,1],[5,6],[6,7],[7,8],[8,5],[1,5],[2,6],[3,7],[4,8]]";
  const pts=makeNode("points",{x:740,y:200});pts.label="cube";pts.color="#8aadf4";
  pts.props.kind="points";pts.props.mode="fromlist";pts.props.ptsList="V";pts.props.edgeList="E";
  pts.props.drawLines=false;pts.props.radius="6";
  pts.attachments=[V.id,E.id];cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[V.id]:V,[E.id]:E,[pts.id]:pts},camId:cam.id,animated:false};
}

// CULMINATION: one scene, every system at once. A normal-mapped brick sphere
// (texture albedo + brick normal map, sampled at its own u,v) sits inside a
// wireframe cage whose edges REFERENCE a shared vertex list by index, with an
// RGB-coloured orbit curve weaving past — all lit by a warm point light orbiting
// the scene (driven by an animator) plus a cool directional fill on the camera.
function showcaseScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1280,y:120}));cam.label="culmination";
  cam.props.orbRadius="10";cam.props.orbTheta="0.7";cam.props.orbPhi="0.95";cam.props.spin="loop";cam.props.spinPeriod="46";

  // ── central brick sphere: textured albedo + matching normal map, lit ──
  const sph=makeNode("paramSpace",{x:380,y:100});sph.label="brick sphere";sph.color="#e6c9a8";
  sph.props.degree="2";
  sph.props.exprXu="1.7*cos(u)*sin(v)";sph.props.exprYu="1.7*sin(u)*sin(v)";sph.props.exprZu="1.7*cos(v)";
  sph.props.uMin="0";sph.props.uMax="2*pi";sph.props.vMin="0";sph.props.vMax="pi";sph.props.uRes="150";sph.props.vRes="90";
  sph.props.showWire=false;sph.props.shading="lit";sph.props.matColorMode="texture";
  sph.props.uvScaleU="5";sph.props.uvScaleV="2.5";sph.props.matNormalStrength="1.1";
  const tex=makeNode("texture",{x:120,y:80});tex.label="brick";tex.color="#c98a6a";tex.props.src="builtin:brick";tex.props.wrap="repeat";
  const nrm=makeNode("texture",{x:120,y:210});nrm.label="brick normal";nrm.color="#a6da95";nrm.props.role="normal";nrm.props.src="builtin:brick-normal";nrm.props.wrap="repeat";
  sph.attachments=[tex.id,nrm.id];

  // ── list-defined cube cage: edges reference a shared vertex list by index ──
  const V=makeNode("list",{x:380,y:340});V.name="V";V.label="cage verts";V.color="#f7d9a0";
  V.props.expr="[[-2.7,-2.7,-2.7],[2.7,-2.7,-2.7],[2.7,2.7,-2.7],[-2.7,2.7,-2.7],[-2.7,-2.7,2.7],[2.7,-2.7,2.7],[2.7,2.7,2.7],[-2.7,2.7,2.7]]";
  const E=makeNode("list",{x:380,y:470});E.name="E";E.label="cage edges";E.color="#f7d9a0";
  E.props.expr="[[1,2],[2,3],[3,4],[4,1],[5,6],[6,7],[7,8],[8,5],[1,5],[2,6],[3,7],[4,8]]";
  const cage=makeNode("points",{x:720,y:380});cage.label="cage";cage.color="#7f9cf5";
  cage.props.kind="points";cage.props.mode="fromlist";cage.props.ptsList="V";cage.props.edgeList="E";cage.props.drawLines=false;cage.props.radius="5";
  cage.attachments=[V.id,E.id];

  // ── RGB orbit curve ──
  const cv=makeNode("paramSpace",{x:380,y:600});cv.label="orbit";cv.color="#5b9cf6";
  cv.props.degree="1";
  cv.props.exprX="3.5*cos(t)";cv.props.exprY="3.5*sin(t)";cv.props.exprZ="1.6*sin(2*t)";
  cv.props.tMin="0";cv.props.tMax="2*pi";cv.props.res="400";
  cv.props.colorMode="rgb";cv.props.colorR="0.5+0.5*sin(t)";cv.props.colorG="0.5+0.5*sin(t+2.1)";cv.props.colorB="0.5+0.5*sin(t+4.2)";

  // ── animated scene lights on the camera ──
  const anim=makeNode("animator",{x:40,y:340});anim.name="phase";anim.value=0;
  anim.props.min="0";anim.props.max="6.283";anim.props.period="9";anim.props.loop="loop";anim.playing=true;
  const warm=makeNode("light",{x:380,y:740});warm.label="orbit lamp";warm.color="#ffd28a";
  warm.props.kind="point";warm.props.color="#ffdcb0";warm.props.intensity="2.5";warm.props.falloff="0.03";
  warm.props.posX="5*cos(phase)";warm.props.posY="5*sin(phase)";warm.props.posZ="3";
  warm.attachments=[anim.id];
  const cool=makeNode("light",{x:380,y:870});cool.label="sky fill";cool.color="#8fb7ff";
  cool.props.kind="directional";cool.props.color="#9fb8ff";cool.props.intensity="0.45";
  cool.props.dirX="-0.4";cool.props.dirY="-0.3";cool.props.dirZ="0.7";

  cam.attachments=[sph.id,cage.id,cv.id,warm.id,cool.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[sph.id]:sph,[tex.id]:tex,[nrm.id]:nrm,
    [V.id]:V,[E.id]:E,[cage.id]:cage,[cv.id]:cv,[anim.id]:anim,[warm.id]:warm,[cool.id]:cool},camId:cam.id,animated:true};
}

// SIERPINSKI OCTAHEDRON: a depth-4 octahedron fractal — 6⁴ = 1296 small octahedra,
// 10368 coloured triangles. The 1296 centres are generated into three first-class
// Lists (Cx, Cy, Cz); a rawGeom index template stamps the 8 faces of an octahedron
// at each centre (face f picks a sign per axis), and the colour is a position-based
// RGB field so the whole fractal is a smooth rainbow. The index template compiles
// to native JS (the JIT handles the list lookups), so it stamps in ~140ms.
function sierpinskiOctaScene(){
  const L=4, S=3.0;
  const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let pts=[[0,0,0]], half=S;
  for(let l=0;l<L;l++){ const off=half/2, np=[];
    for(const c of pts) for(const d of dirs) np.push([c[0]+d[0]*off,c[1]+d[1]*off,c[2]+d[2]*off]);
    pts=np; half/=2; }
  const R=half;                                   // small-octahedron radius
  const col=a=>"["+pts.map(p=>+p[a].toFixed(4)).join(",")+"]";

  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1280,y:120}));cam.label="Sierpiński octahedron";
  cam.props.orbRadius="9.5";cam.props.orbTheta="0.7";cam.props.orbPhi="0.95";cam.props.spin="loop";cam.props.spinPeriod="48";
  const Cx=makeNode("list",{x:300,y:80});Cx.name="Cx";Cx.label="centres x";Cx.color="#f7d9a0";Cx.props.expr=col(0);
  const Cy=makeNode("list",{x:300,y:210});Cy.name="Cy";Cy.label="centres y";Cy.color="#f7d9a0";Cy.props.expr=col(1);
  const Cz=makeNode("list",{x:300,y:340});Cz.name="Cz";Cz.label="centres z";Cz.color="#f7d9a0";Cz.props.expr=col(2);
  const Rn=makeNode("constant",{x:300,y:470});Rn.name="R";Rn.label="cell radius";Rn.props.value=String(+R.toFixed(5));
  const g=makeNode("rawGeom",{x:720,y:220});g.label="fractal";g.color="#8aadf4";
  g.props.prim="triangles";g.props.src="index";
  g.props.idxTris=
    "Cx[i+1]+(1-2*mod(floor(j/4),2))*R, Cy[i+1], Cz[i+1] | "+
    "Cx[i+1], Cy[i+1]+(1-2*mod(floor(j/2),2))*R, Cz[i+1] | "+
    "Cx[i+1], Cy[i+1], Cz[i+1]+(1-2*mod(j,2))*R";
  g.props.idxCount=`${pts.length}, 8`;
  g.props.colorOn=true;g.props.colorMode="rgb";
  g.props.colorR="512+512*sin(1.5*x)";
  g.props.colorG="512+512*sin(1.5*y+2.1)";
  g.props.colorB="512+512*sin(1.5*z+4.2)";
  g.attachments=[Cx.id,Cy.id,Cz.id,Rn.id];cam.attachments=[g.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[Cx.id]:Cx,[Cy.id]:Cy,[Cz.id]:Cz,[Rn.id]:Rn,[g.id]:g},camId:cam.id,animated:false};
}

// RGB along a parametric CURVE: a trefoil knot coloured per-vertex by three
// expressions in the curve parameter t.
function curveRgbScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1120,y:120}));cam.label="RGB trefoil";
  cam.props.orbRadius="9";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="28";
  const cv=makeNode("paramSpace",{x:380,y:160});cv.label="trefoil";cv.color="#5b9cf6";
  cv.props.degree="1";
  cv.props.exprX="sin(t)+2*sin(2*t)";cv.props.exprY="cos(t)-2*cos(2*t)";cv.props.exprZ="-sin(3*t)";
  cv.props.tMin="0";cv.props.tMax="2*pi";cv.props.res="500";
  cv.props.colorMode="rgb";cv.props.colorR="0.5+0.5*sin(t)";cv.props.colorG="0.5+0.5*sin(t+2.1)";cv.props.colorB="0.5+0.5*sin(t+4.2)";
  cam.attachments=[cv.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[cv.id]:cv},camId:cam.id,animated:false};
}

// Register the new scenes alongside the originals.
Object.assign(SCENES, {
  spheretorus: sphereTorusScene,
  gyroid: implicitGyroidScene,
  chmutov: implicitChmutovScene,
  ribbon: lissajousRibbonScene,
  flowsurface: flowSurface3DScene,
  glyphspiral: recursiveGlyphScene,
  wavytorus: wavyTorusScene,
  clebsch: clebschScene,
  implicit: implicitGalleryScene,
  barth: barthScene,
  whitney: whitneyScene,
  viviani: vivianiScene,
  "lit-ripple": litRippleScene,
  "lit-saddle": litSaddleScene,
  "composed-surface": composedSurfaceScene,
  steinmetz: steinmetzScene,
  "sphere-plane": spherePlaneScene,
  "mat-checker": matCheckerScene,
  "mat-rings": matRingsScene,
  "mat-rgb": matRgbScene,
  "mat-glow": matGlowScene,
  "tex-surface": texSurfaceScene,
  "tex-paramsurf": texParamSurfScene,
  "normal-map": normalMapScene,
  "lights": lightsScene,
  "lights-param": lightsParamScene,
  "brick-sphere": brickSphereScene,
  "list-cube": listCubeScene,
  "showcase": showcaseScene,
  "sierpinski": sierpinskiOctaScene,
  "curve-rgb": curveRgbScene,
});

// ── Tutorial teaching scenes ────────────────────────────────────────────────
// Purpose-built, deliberately simple scenes for the in-app tutorials. Each one
// is a single step in a building progression, so they start minimal and add one
// idea at a time. They register in SCENES like any other scene, so LivePreview
// renders them and their "open project" button drops the exact graph into the
// editor.

// Tutorial: functions vs geometry. Step scenes build the same map three ways.

// Step 1: a lone fnMap, nothing drawn yet. We still need a camera so the preview
// has something to show, so we point it at an empty scene with just the map node
// present (the map produces no geometry on its own).
function tutFnOnlyScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="no geometry yet";cam.props.showOpenBtn=false;
  cam.props.orbRadius="9";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  cam.props.showGrid=true;cam.props.showAxes=true;
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="f(x,y)";fn.color="#a6e3a1";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="sin(x)*cos(y)";
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn},camId:cam.id,animated:false};
}
// Step 2: the same map wired into a graph transformer becomes a surface z=f(x,y).
function tutFnSurfaceScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="z = f(x,y)";cam.props.showOpenBtn=false;
  cam.props.orbRadius="11";cam.props.orbTheta="0.7";cam.props.orbPhi="1.05";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="f(x,y)";fn.color="#a6e3a1";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="sin(x)*cos(y)";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="graph";tr.color="#a6e3a1";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  tr.props.aMin="-3.14";tr.props.aMax="3.14";tr.props.bMin="-3.14";tr.props.bMax="3.14";tr.props.res="80";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step 3: the SAME map, drawn as a vector field instead — a different transformer
// on the identical function. (A 2->2 field so each sample has an arrow.)
function tutFnFieldScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="same f, as a field";cam.props.showOpenBtn=false;
  cam.props.orbRadius="11";cam.props.orbTheta="0.7";cam.props.orbPhi="1.1";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="f(x,y)";fn.color="#7ad7ff";
  fn.props.inDim="2";fn.props.outDim="2";fn.props.out0="sin(x)*cos(y)";fn.props.out1="cos(x)*sin(y)";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="field";tr.color="#7ad7ff";
  tr.props.mode="field";tr.props.inAxis0="x";tr.props.inAxis1="y";
  tr.props.aMin="-3";tr.props.aMax="3";tr.props.bMin="-3";tr.props.bMax="3";tr.props.res="14";
  tr.props.normalize=true;tr.props.arrowLen="0.4";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}

// Tutorial: implicit surfaces and level sets. Sphere, then a slider, then a real
// variety, each openable.

// Step 1: the simplest level set, a sphere x^2+y^2+z^2 = 1.
function tutSphereScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="x²+y²+z² = 1";cam.props.showOpenBtn=false;
  cam.props.orbRadius="4.4";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  const eq=makeNode("equation",{x:360,y:160});eq.label="sphere";eq.color="#a6e3a1";
  eq.props.dims="3d";eq.props.lhs="x^2 + y^2 + z^2";eq.props.rhs="1";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="surface";tr.color="#a6e3a1";
  tr.props.mode="graph";
  tr.props.aMin="-1.6";tr.props.aMax="1.6";tr.props.bMin="-1.6";tr.props.bMax="1.6";tr.props.cMin="-1.6";tr.props.cMax="1.6";
  tr.props.res="120";tr.props.colorMode="normal";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step 2: a slider r controls the radius; drag it to resize the level set live.
function tutSphereSliderScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="drag r";cam.props.showOpenBtn=false;
  cam.props.orbRadius="5.5";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  const r=makeNode("slider",{x:40,y:320});r.name="r";r.label="r · radius";r.value=1;
  r.props.min="0.4";r.props.max="1.8";r.props.step="0.01";
  const eq=makeNode("equation",{x:360,y:160});eq.label="sphere(r)";eq.color="#9b8cff";
  eq.props.dims="3d";eq.props.lhs="x^2 + y^2 + z^2";eq.props.rhs="r^2";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  eq.attachments=[r.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="surface";tr.color="#9b8cff";
  tr.props.mode="graph";
  tr.props.aMin="-2";tr.props.aMax="2";tr.props.bMin="-2";tr.props.bMax="2";tr.props.cMin="-2";tr.props.cMax="2";
  tr.props.res="120";tr.props.colorMode="normal";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[r.id]:r,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step 4: two surfaces meet in a curve. A sphere and a cylinder, each its own
// equation, wired into one transformer: it draws {F=0}∩{G=0} directly — Viviani's
// figure-eight space curve, which no single lhs=rhs could express.
function tutIntersectionScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1140,y:160}));cam.label="sphere ∩ cylinder";cam.props.showOpenBtn=false;
  cam.props.orbRadius="7";cam.props.orbTheta="0.7";cam.props.orbPhi="1.05";cam.props.spin="loop";cam.props.spinPeriod="30";
  const sph=makeNode("equation",{x:360,y:120});sph.label="sphere";sph.color="#5b9cf6";
  sph.props.dims="3d";sph.props.lhs="x^2 + y^2 + z^2";sph.props.rhs="4";
  sph.props.varA="x";sph.props.varB="y";sph.props.varC="z";
  const cyl=makeNode("equation",{x:360,y:300});cyl.label="cylinder";cyl.color="#52d47e";
  cyl.props.dims="3d";cyl.props.lhs="(x-1)^2 + y^2";cyl.props.rhs="1";
  cyl.props.varA="x";cyl.props.varB="y";cyl.props.varC="z";
  const tr=makeNode("transformer",{x:740,y:210});tr.label="∩ curve";tr.color="#ffd479";
  tr.props.aMin="-2.2";tr.props.aMax="2.2";tr.props.bMin="-2.2";tr.props.bMax="2.2";tr.props.cMin="-2.2";tr.props.cMax="2.2";
  tr.props.res="96";
  tr.attachments=[sph.id,cyl.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[sph.id]:sph,[cyl.id]:cyl,[tr.id]:tr},camId:cam.id,animated:false};
}
// Quadric morph: x² + y² + s·z² = 1. One slider sweeps the whole family of
// central quadrics — s>0 gives an ellipsoid/sphere, s=0 a cylinder, s<0 a
// one-sheet hyperboloid. The same degree-2 equation, three different surfaces.
function tutQuadricMorphScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="drag s: ellipsoid ↔ hyperboloid";cam.props.showOpenBtn=false;
  cam.props.orbRadius="7";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="36";
  const s=makeNode("slider",{x:40,y:320});s.name="s";s.label="s · z² coefficient";s.value=1;
  s.props.min="-1.5";s.props.max="1.5";s.props.step="0.01";
  const eq=makeNode("equation",{x:360,y:160});eq.label="x² + y² + s·z² = 1";eq.color="#9b8cff";
  eq.props.dims="3d";eq.props.lhs="x^2 + y^2 + s*z^2";eq.props.rhs="1";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  eq.attachments=[s.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="surface";tr.color="#9b8cff";
  tr.props.mode="graph";
  tr.props.aMin="-3";tr.props.aMax="3";tr.props.bMin="-3";tr.props.bMax="3";tr.props.cMin="-3";tr.props.cMax="3";
  tr.props.res="140";tr.props.colorMode="normal";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[s.id]:s,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:true};
}

// The hyperbolic paraboloid z = x² − y²: the saddle, a doubly-ruled quadric that
// curves up one way and down the other. The classic Pringle.
function tutQuadricSaddleScene(){
  return _implicitScene("hyperbolic paraboloid (saddle)","z","x^2 - y^2",2.2,"normal",6.5);
}

// The cone x² + y² = z²: the boundary case between the one- and two-sheet
// hyperboloids, where the surface pinches to a single point.
function tutQuadricConeScene(){
  return _implicitScene("a cone","x^2 + y^2","z^2",2.2,"normal",6.5);
}

// A polar rose r = cos(k·θ), drawn with the transformer's native polar mode: the
// fnMap is just r = cos(k·θ), and polar mode places it at (r cosθ, r sinθ). The
// petal count is a slider: odd k gives k petals, even k gives 2k.
function tutPolarRoseScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="r = cos(k·θ)";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="1.2";
  const k=makeNode("slider",{x:20,y:320});k.name="k";k.label="k · petals";k.value=3;
  k.props.min="1";k.props.max="8";k.props.step="1";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="r(θ) = cos(k·θ)";fn.color="#ff5ea8";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="cos(k*x)";fn.attachments=[k.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="polar curve";tr.color="#ff5ea8";
  tr.props.mode="polar";tr.props.aMin="0";tr.props.aMax="6.2832";tr.props.res="600";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[k.id]:k,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}

// Editor transformer-modes: polar mode reads a one-input map r(θ) as a radius
// swept around the origin. A distinct example from the analytic rose — an
// Archimedean spiral r = θ/turns, where the radius grows steadily with the angle.
function tutModePolarScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="polar mode: r grows with θ";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3.4";
  const turns=makeNode("slider",{x:20,y:320});turns.name="turns";turns.label="turns";turns.value=3;
  turns.props.min="1";turns.props.max="6";turns.props.step="1";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="r(θ) = θ/(2π)";fn.color="#ffb454";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="x/(2*pi)";fn.attachments=[];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="polar curve";tr.color="#ffb454";
  tr.props.mode="polar";tr.props.aMin="0";tr.props.aMax="6.2832*turns";tr.props.res="800";
  tr.attachments=[fn.id,turns.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[turns.id]:turns,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}

// Editor transformer-modes: spherical mode reads a two-input map r(θ,φ) as a
// radius over the sphere of directions. A distinct example from the analytic
// urchin — a peanut/dumbbell from a low-order spherical harmonic.
function tutModeSphericalScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="spherical mode: r(θ,φ)";cam.props.showOpenBtn=false;
  cam.props.orbRadius="4.6";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="32";
  const lobe=makeNode("slider",{x:20,y:320});lobe.name="lobe";lobe.label="lobe · polar order";lobe.value=2;
  lobe.props.min="1";lobe.props.max="6";lobe.props.step="1";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="r(θ,φ)";fn.color="#9b8cff";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="0.6 + 0.7*abs(cos(lobe*y))";fn.attachments=[lobe.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="spherical";tr.color="#9b8cff";
  tr.props.mode="spherical";tr.props.aMin="0";tr.props.aMax="6.2832";tr.props.bMin="0";tr.props.bMax="3.14159";
  tr.props.res="80";tr.props.colorMode="normal";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[lobe.id]:lobe,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:true};
}


// A cardioid/limaçon r = a + cos(θ) via polar mode; the offset a turns the
// cardioid into the family of limaçons (inner loop when a < 1).
function tutPolarCardioidScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="r = a + cos(θ)";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="2.4";cam.props.planeOx="0.3";
  const a=makeNode("slider",{x:20,y:320});a.name="a";a.label="a · offset";a.value=1;
  a.props.min="0.3";a.props.max="2";a.props.step="0.01";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="r(θ) = a + cos(θ)";fn.color="#ff9e64";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="a + cos(x)";fn.attachments=[a.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="polar curve";tr.color="#ff9e64";
  tr.props.mode="polar";tr.props.aMin="0";tr.props.aMax="6.2832";tr.props.res="600";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[a.id]:a,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}

// A spherical surface r = 1 + 0.18·sin(mθ)·sin(nφ): a bumpy sphere drawn with the
// transformer's spherical mode, where the radius is modulated by the two angles.
function tutPolarSpiralScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="r = 1 + bumps(θ,φ)";cam.props.showOpenBtn=false;
  cam.props.orbRadius="4.2";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="32";
  const m=makeNode("slider",{x:20,y:320});m.name="m";m.label="m · azimuth bumps";m.value=6;
  m.props.min="1";m.props.max="10";m.props.step="1";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="r(θ,φ)";fn.color="#5ad1e6";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="1 + 0.18*sin(m*x)*sin(4*y)";fn.attachments=[m.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="spherical";tr.color="#5ad1e6";
  tr.props.mode="spherical";tr.props.aMin="0";tr.props.aMax="6.2832";tr.props.bMin="0";tr.props.bMax="3.14159";
  tr.props.res="80";tr.props.colorMode="normal";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[m.id]:m,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:true};
}

// Transformer modes — the same transformer node reads its inputs three ways.
// Graph mode: a fnMap of two inputs becomes a height surface z = f(x,y).
function tutModeGraphScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="graph mode: z = f(x,y)";cam.props.showOpenBtn=false;
  cam.props.orbRadius="9";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="34";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="f(x,y)";fn.color="#5b9cf6";fn.props.inDim="2";fn.props.outDim="1";
  fn.props.out0="cos(x)*sin(y)";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="graph";tr.color="#5b9cf6";
  tr.props.mode="graph";tr.props.aMin="-3.1";tr.props.aMax="3.1";tr.props.bMin="-3.1";tr.props.bMax="3.1";
  tr.props.res="120";tr.props.colorMode="normal";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:true};
}

// Parametric mode: a paramSpace traces a path from a single parameter t.
function tutModeParamScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="parametric mode: a curve in t";cam.props.showOpenBtn=false;
  cam.props.orbRadius="8";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="30";
  const ps=makeNode("paramSpace",{x:520,y:160});ps.label="helix";ps.color="#5be0c0";
  ps.props.degree="1";ps.props.exprX="cos(t)";ps.props.exprY="sin(t)";ps.props.exprZ="0.16*t";
  ps.props.tMin="0";ps.props.tMax="18.85";ps.props.res="500";
  cam.attachments=[ps.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[ps.id]:ps},camId:cam.id,animated:true};
}

// Field mode: a fnMap of two outputs becomes an arrow at every sample point.
function tutModeFieldScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="field mode: a vector at each point";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3";
  const fn=makeNode("fnMap",{x:360,y:160});fn.props.inDim="2";fn.props.outDim="2";
  fn.props.out0="-y";fn.props.out1="x";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="field";tr.color="#ffb454";
  tr.props.mode="field";tr.props.inAxis0="x";tr.props.inAxis1="y";
  tr.props.aMin="-3";tr.props.aMax="3";tr.props.bMin="-3";tr.props.bMax="3";
  tr.props.res="15";tr.props.arrowLen="0.3";tr.props.normalize=true;
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}

// ── Raw geometry tutorials ──

// helper: a rawGeom node with sensible defaults filled in, so each scene only
// sets what it cares about.
function _rawNode(pos,label,color,overrides){
  const g=makeNode("rawGeom",pos);g.label=label;g.color=color;
  g.props={
    prim:"segments",src:"list",
    rawPoints:"0,0,0",rawSegments:"0,0,0 | 1,0,0",rawGlyphs:"0,0,0 | 1,0,0",rawTris:"0,0,0 | 1,0,0 | 0,1,0",
    idxPoints:"cos(i),sin(i),0",idxSegments:"0,0,0 | 1,0,0",idxGlyphs:"0,0,0 | 1,0,0",idxTris:"0,0,0 | 1,0,0 | 0,1,0",
    idxCount:"16",
    colorOn:false,colorExpr:"i",colorLo:"#3a6aff",colorHi:"#ff5ea8",colorMin:"",colorMax:"",
    radius:"0.08",drawLines:false,arrowLen:"0.5",normalize:false,lenMode:"raw",showWire:true,
    ...overrides,
  };
  return g;
}

// 1) Hand-built primitives in LIST mode: a tetrahedron drawn three ways at once —
// its vertices (points), its edges (segments), and its faces (triangles), each a
// separate rawGeom node sharing the same four corners. Shows direct authoring.
function tutRawListScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1100,y:120}));cam.label="a tetrahedron, three ways";cam.props.showOpenBtn=false;
  cam.props.orbRadius="5.5";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="40";
  const A="1,1,1", B="1,-1,-1", C="-1,1,-1", D="-1,-1,1";
  const faces=_rawNode({x:300,y:80},"faces","#5b9cf6",{prim:"triangles",src:"list",
    rawTris:`${A} | ${B} | ${C}\n${A} | ${B} | ${D}\n${A} | ${C} | ${D}\n${B} | ${C} | ${D}`, showWire:false});
  const edges=_rawNode({x:300,y:300},"edges","#ffcf6e",{prim:"segments",src:"list",
    rawSegments:`${A} | ${B}\n${A} | ${C}\n${A} | ${D}\n${B} | ${C}\n${B} | ${D}\n${C} | ${D}`});
  const verts=_rawNode({x:300,y:520},"vertices","#ff5ea8",{prim:"points",src:"list",
    rawPoints:`${A}\n${B}\n${C}\n${D}`, radius:"0.1"});
  cam.attachments=[faces.id,edges.id,verts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[faces.id]:faces,[edges.id]:edges,[verts.id]:verts},camId:cam.id,animated:true};
}

// 2) INDEX sequence: one segment template swept over i to make a sunburst of
// spokes, each colored by its index (Gouraud along the spoke). A slider sets the
// spoke count, so one template + one number = a whole family.
function tutRawSequenceScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1100,y:120}));cam.label="one template, many spokes";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="1.6";
  const N=makeNode("slider",{x:40,y:340});N.name="N";N.label="N · spokes";N.value=24;
  N.props.min="3";N.props.max="60";N.props.step="1";
  const g=_rawNode({x:340,y:140},"spokes","#ff5ea8",{prim:"segments",src:"index",
    idxSegments:"0.3*cos(2*pi*i/N), 0.3*sin(2*pi*i/N), 0 | cos(2*pi*i/N), sin(2*pi*i/N), 0",
    idxCount:"N",
    colorOn:true,colorExpr:"i+part",colorLo:"#5ad1e6",colorHi:"#ff5ea8",colorMin:"0"});
  g.attachments=[N.id];
  cam.attachments=[g.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[N.id]:N,[g.id]:g},camId:cam.id,animated:false};
}

// 3) INDEX lattice → a triangulated surface. An i,j grid emits two triangles per
// cell from two rawGeom nodes (upper + lower), Gouraud-colored by height. A real
// mesh built entirely from index expressions plus a wired height function.
function tutRawLatticeScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1100,y:120}));cam.label="a surface from a lattice";cam.props.showOpenBtn=false;
  cam.props.orbRadius="7";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="44";
  const h=makeNode("fnDef",{x:60,y:120});h.name="h";h.label="h(x,y)";h.props.params="x,y";h.props.expr="0.6*sin(x)*cos(y)";
  const X=(e)=>`(${e}-6)*0.5`;
  const P=(ie,je)=>`${X(ie)}, ${X(je)}, h(${X(ie)}, ${X(je)})`;
  const upper=_rawNode({x:360,y:120},"upper tris","#7a5cf0",{prim:"triangles",src:"index",
    idxTris:`${P("i","j")} | ${P("i+1","j")} | ${P("i","j+1")}`,
    idxCount:"12, 12", colorOn:true, colorExpr:"z", colorLo:"#2a3a8a", colorHi:"#ff9e64", colorMin:"-0.6", colorMax:"0.6", showWire:false});
  upper.attachments=[h.id];
  const lower=_rawNode({x:360,y:360},"lower tris","#7a5cf0",{prim:"triangles",src:"index",
    idxTris:`${P("i+1","j")} | ${P("i+1","j+1")} | ${P("i","j+1")}`,
    idxCount:"12, 12", colorOn:true, colorExpr:"z", colorLo:"#2a3a8a", colorHi:"#ff9e64", colorMin:"-0.6", colorMax:"0.6", showWire:false});
  lower.attachments=[h.id];
  cam.attachments=[upper.id,lower.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[h.id]:h,[upper.id]:upper,[lower.id]:lower},camId:cam.id,animated:true};
}

// 4) Dependency functions: a discrete vector field. Two wired functions fx,fy
// define the field; a glyph rawGeom samples them over an i,j lattice and colors
// each arrow by magnitude. Primitives expressing against dependency functions.
function tutRawGlyphsScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1100,y:120}));cam.label="a field sampled from f(x,y)";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3";
  const fx=makeNode("fnDef",{x:60,y:100});fx.name="fx";fx.label="fx(x,y)";fx.props.params="x,y";fx.props.expr="-y + 0.3*x";
  const fy=makeNode("fnDef",{x:60,y:240});fy.name="fy";fy.label="fy(x,y)";fy.props.params="x,y";fy.props.expr="x + 0.3*y";
  const px="(i-6)*0.45", py="(j-6)*0.45";
  const g=_rawNode({x:360,y:160},"glyph field","#5ad1e6",{prim:"glyphs",src:"index",
    idxGlyphs:`${px}, ${py}, 0 | fx(${px}, ${py}), fy(${px}, ${py}), 0`,
    idxCount:"13, 13",
    arrowLen:"0.32", normalize:true,
    colorOn:true, colorExpr:`hypot(fx(${px},${py}), fy(${px},${py}))`,
    colorLo:"#3a6aff", colorHi:"#ff5ea8", colorMin:"0", colorMax:"4"});
  g.attachments=[fx.id,fy.id];
  cam.attachments=[g.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fx.id]:fx,[fy.id]:fy,[g.id]:g},camId:cam.id,animated:false};
}

// 6) Capstone — a twisted, rippled torus assembled entirely from raw triangles.
// Sliders feed helper functions (rippled radius, twist angle); coordinate
// functions SX/SY/SZ build each vertex; color functions CR/CG/CB/CA drive the
// three-channel RGB and per-vertex alpha. Two raw nodes tile an M×M lattice into
// triangles. Everything the node can do — index lattices, dependency functions,
// rgb color, alpha — in one graph. The compiled-expression path keeps it fast.
function tutRawTorusScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1320,y:200}));cam.label="a twisted torus from raw triangles";cam.props.showOpenBtn=false;
  cam.props.orbRadius="9";cam.props.orbTheta="0.7";cam.props.orbPhi="1.05";cam.props.spin="loop";cam.props.spinPeriod="60";
  cam.props.showAxes=false;cam.props.showGrid=false;
  // parameters
  const R0=makeNode("slider",{x:-160,y:-40});R0.name="R0";R0.label="R0 · major radius";R0.value=2.4;R0.props.min="1.5";R0.props.max="3.5";R0.props.step="0.05";
  const A =makeNode("slider",{x:-160,y:60}); A.name="A"; A.label="A · ripple amp";  A.value=0.35;A.props.min="0";A.props.max="1";A.props.step="0.01";
  const rt=makeNode("slider",{x:-160,y:160});rt.name="rt";rt.label="rt · tube radius";rt.value=0.8;rt.props.min="0.2";rt.props.max="1.2";rt.props.step="0.02";
  const P =makeNode("slider",{x:-160,y:260});P.name="p"; P.label="p · ripple count"; P.value=5; P.props.min="1";P.props.max="9";P.props.step="1";
  const Q =makeNode("slider",{x:-160,y:360});Q.name="q"; Q.label="q · twist";        Q.value=3; Q.props.min="0";Q.props.max="6";Q.props.step="1";
  const M =makeNode("slider",{x:-160,y:460});M.name="M"; M.label="M · resolution";   M.value=72;M.props.min="24";M.props.max="160";M.props.step="4";
  // helper functions
  const RRf=makeNode("fnDef",{x:200,y:-20});RRf.name="RR";RRf.label="RR(u) · rippled radius";RRf.props.params="u";RRf.props.expr="R0 + A*sin(p*u)";RRf.attachments=[R0.id,A.id,P.id];
  const Wf =makeNode("fnDef",{x:200,y:90}); Wf.name="W"; Wf.label="W(u,v) · twist angle";Wf.props.params="u,v";Wf.props.expr="v + q*u";Wf.attachments=[Q.id];
  // coordinate functions
  const SX=makeNode("fnDef",{x:540,y:-40});SX.name="SX";SX.label="SX(u,v)";SX.props.params="u,v";SX.props.expr="(RR(u) + rt*cos(W(u,v)))*cos(u)";SX.attachments=[RRf.id,Wf.id,rt.id];
  const SY=makeNode("fnDef",{x:540,y:70}); SY.name="SY";SY.label="SY(u,v)";SY.props.params="u,v";SY.props.expr="(RR(u) + rt*cos(W(u,v)))*sin(u)";SY.attachments=[RRf.id,Wf.id,rt.id];
  const SZ=makeNode("fnDef",{x:540,y:180});SZ.name="SZ";SZ.label="SZ(u,v)";SZ.props.params="u,v";SZ.props.expr="rt*sin(W(u,v))";SZ.attachments=[Wf.id,rt.id];
  // color + alpha functions (0..1024 per channel)
  const CR=makeNode("fnDef",{x:540,y:300});CR.name="CR";CR.label="CR(u,v) · red";  CR.props.params="u,v";CR.props.expr="512 + 512*sin(3*u)";
  const CG=makeNode("fnDef",{x:540,y:410});CG.name="CG";CG.label="CG(u,v) · green";CG.props.params="u,v";CG.props.expr="512 + 512*sin(3*u + v + 2.1)";
  const CB=makeNode("fnDef",{x:540,y:520});CB.name="CB";CB.label="CB(u,v) · blue"; CB.props.params="u,v";CB.props.expr="512 + 512*sin(3*u + 2*v + 4.2)";
  const CA=makeNode("fnDef",{x:540,y:630});CA.name="CA";CA.label="CA(u,v) · alpha";CA.props.params="u,v";CA.props.expr="720 + 304*sin(2*v)";
  // mesh: two raw nodes (upper + lower triangle of each lattice cell)
  const U=(di)=>`(2*pi*(i+${di})/M)`, V=(dj)=>`(2*pi*(j+${dj})/M)`;
  const VTX=(di,dj)=>{const u=U(di),v=V(dj);return `SX(${u},${v}), SY(${u},${v}), SZ(${u},${v})`;};
  const u0=U(0), v0=V(0);
  const colProps={colorOn:true,colorMode:"rgb",alphaOn:true,colorR:`CR(${u0},${v0})`,colorG:`CG(${u0},${v0})`,colorB:`CB(${u0},${v0})`,colorA:`CA(${u0},${v0})`};
  const colAtt=[CR.id,CG.id,CB.id,CA.id];
  const upper=_rawNode({x:920,y:120},"torus · upper tris","#7a5cf0",{prim:"triangles",src:"index",idxCount:"M, M",showWire:false,...colProps,
    idxTris:`${VTX(0,0)} | ${VTX(1,0)} | ${VTX(0,1)}`});
  upper.attachments=[SX.id,SY.id,SZ.id,M.id,...colAtt];
  const lower=_rawNode({x:920,y:360},"torus · lower tris","#7a5cf0",{prim:"triangles",src:"index",idxCount:"M, M",showWire:false,...colProps,
    idxTris:`${VTX(1,0)} | ${VTX(1,1)} | ${VTX(0,1)}`});
  lower.attachments=[SX.id,SY.id,SZ.id,M.id,...colAtt];
  cam.attachments=[upper.id,lower.id];
  return {scene:{[project.id]:project,[cam.id]:cam,
    [R0.id]:R0,[A.id]:A,[rt.id]:rt,[P.id]:P,[Q.id]:Q,[M.id]:M,
    [RRf.id]:RRf,[Wf.id]:Wf,[SX.id]:SX,[SY.id]:SY,[SZ.id]:SZ,
    [CR.id]:CR,[CG.id]:CG,[CB.id]:CB,[CA.id]:CA,[upper.id]:upper,[lower.id]:lower},
    camId:cam.id,animated:true};
}

// 5) Gouraud focus: a fan of triangles around a center, each rim vertex colored
// by its angle so the color sweeps smoothly around the disk — a color wheel built
// from raw triangles with per-vertex interpolation.
function tutRawGouraudScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1100,y:120}));cam.label="per-vertex color (a color wheel)";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="1.3";
  const g=_rawNode({x:360,y:160},"color wheel","#ffffff",{prim:"triangles",src:"index",
    idxTris:"0,0,0 | cos(2*pi*i/36), sin(2*pi*i/36), 0 | cos(2*pi*(i+1)/36), sin(2*pi*(i+1)/36), 0",
    idxCount:"36",
    colorOn:true, colorExpr:"atan2(y,x)", colorLo:"#1bd6c0", colorHi:"#ff5ea8", colorMin:"-3.15", colorMax:"3.15",
    showWire:false});
  cam.attachments=[g.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[g.id]:g},camId:cam.id,animated:false};
}

// ── helper: a 2D curve driven by a fnMap whose expression references sliders ──
// builds slider nodes from specs [{name,label,value,min,max,step}], a fnMap with
// the given output expression(s), a transformer, and a camera. mode "graph"
// (y=f(x)) or "param" (x=out0, y=out1 over t). Returns the scene object.
function _sliderCurve(opts){
  const { label, specs, out0, out1, mode="graph", aMin=-6, aMax=6, ortho=4, oy="0", ox="0", color="#7aa2f7" } = opts;
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1180,y:120}));cam.label=label;cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize=String(ortho);cam.props.planeOx=ox;cam.props.planeOy=oy;
  const scene={[project.id]:project,[cam.id]:cam};
  const sliders=specs.map((s,k)=>{
    const nd=makeNode("slider",{x:-40,y:-40+k*96});nd.name=s.name;nd.label=s.label;nd.value=s.value;
    nd.props.min=String(s.min);nd.props.max=String(s.max);nd.props.step=String(s.step);
    scene[nd.id]=nd; return nd;
  });
  const fn=makeNode("fnMap",{x:380,y:160});fn.label=label;fn.color=color;
  fn.props.inDim="1";fn.props.outDim=mode==="param"?"2":"1";
  fn.props.out0=out0; if(out1!=null) fn.props.out1=out1;
  fn.attachments=sliders.map(s=>s.id);
  scene[fn.id]=fn;
  const tr=makeNode("transformer",{x:760,y:160});tr.label="curve";tr.color=color;
  if(mode==="param"){ tr.props.mode="graph";tr.props.inAxis0="none";tr.props.inAxis1="none";tr.props.outAxis0="x";tr.props.outAxis1="y"; }
  else { tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="y"; }
  tr.props.aMin=String(aMin);tr.props.aMax=String(aMax);tr.props.res="400";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  scene[tr.id]=tr;
  return {scene,camId:cam.id,animated:false};
}

// ALGEBRAIC — the general conic Ax²+Bxy+Cy²+Dx+Ey+F=0 as a 3D level set sliced
// flat, morphing through ellipse, parabola, and hyperbola as the coefficients
// move. The discriminant B²−4AC decides the type.
function tutConicZooScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1180,y:120}));cam.label="A·x² + B·xy + C·y² + D·x + E·y + F = 0";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="2.4";
  const specs=[
    {name:"A",label:"A · x²",value:1,min:-2,max:2,step:0.05},
    {name:"B",label:"B · xy",value:0.6,min:-3,max:3,step:0.05},
    {name:"C",label:"C · y²",value:1.5,min:-2,max:2,step:0.05},
    {name:"D",label:"D · x",value:0,min:-3,max:3,step:0.05},
    {name:"E",label:"E · y",value:0,min:-3,max:3,step:0.05},
    {name:"F",label:"F · 1",value:-2.5,min:-4,max:4,step:0.05},
  ];
  const scene={[project.id]:project,[cam.id]:cam};
  const sliders=specs.map((s,k)=>{ const nd=makeNode("slider",{x:-40,y:-40+k*92});nd.name=s.name;nd.label=s.label;nd.value=s.value;nd.props.min=String(s.min);nd.props.max=String(s.max);nd.props.step=String(s.step);scene[nd.id]=nd;return nd; });
  const eq=makeNode("equation",{x:380,y:170});eq.label="conic";eq.color="#f7768e";
  eq.props.dims="2d";eq.props.varA="x";eq.props.varB="y";
  eq.props.lhs="A*x^2 + B*x*y + C*y^2 + D*x + E*y + F";eq.props.rhs="0";
  eq.attachments=sliders.map(s=>s.id);scene[eq.id]=eq;
  const tr=makeNode("transformer",{x:760,y:170});tr.label="curve";tr.color="#f7768e";
  tr.props.mode="graph";tr.props.aMin="-4.5";tr.props.aMax="4.5";tr.props.bMin="-4.5";tr.props.bMax="4.5";tr.props.res="260";
  tr.attachments=[eq.id];cam.attachments=[tr.id];scene[tr.id]=tr;
  return {scene,camId:cam.id,animated:false};
}

// ANALYTIC — a harmonograph: two damped sinusoids per axis trace the looping
// figures a pendulum-driven drawing table makes. Sliders for the frequencies,
// phase, and decay. Built as a paramSpace curve in t.
function tutHarmonographScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1180,y:120}));cam.label="a harmonograph";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="1.0";
  const specs=[
    {name:"fx",label:"fx · x freq",value:3,min:1,max:8,step:1},
    {name:"fy",label:"fy · y freq",value:2,min:1,max:8,step:1},
    {name:"ph",label:"φ · phase",value:0.5,min:0,max:3.14159,step:0.02},
    {name:"d", label:"d · decay",value:0.12,min:0,max:0.6,step:0.01},
  ];
  const scene={[project.id]:project,[cam.id]:cam};
  const sliders=specs.map((s,k)=>{ const nd=makeNode("slider",{x:-40,y:-40+k*96});nd.name=s.name;nd.label=s.label;nd.value=s.value;nd.props.min=String(s.min);nd.props.max=String(s.max);nd.props.step=String(s.step);scene[nd.id]=nd;return nd; });
  const ps=makeNode("paramSpace",{x:420,y:160});ps.label="harmonograph";ps.color="#7dcfff";ps.props.degree="1";
  ps.props.exprX="exp(-d*t)*sin(fx*t)";
  ps.props.exprY="exp(-d*t)*sin(fy*t + ph)";
  ps.props.exprZ="0";ps.props.tMin="0";ps.props.tMax="62.83";ps.props.res="1200";
  ps.attachments=sliders.map(s=>s.id);scene[ps.id]=ps;
  cam.attachments=[ps.id];
  return {scene,camId:cam.id,animated:false};
}

// DIFFERENTIAL — a curve and its osculating circle. A bump function whose width
// and height slide; the circle of curvature at the apex grows and shrinks,
// radius = 1/κ. Shows curvature as a tangible radius.
function tutOsculatingScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1180,y:120}));cam.label="curve and its circle of curvature";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="1.6";cam.props.planeOy="0.6";
  const specs=[
    {name:"a",label:"a · height",value:1.2,min:0.2,max:2.5,step:0.05},
    {name:"w",label:"w · width",value:1,min:0.4,max:3,step:0.05},
  ];
  const scene={[project.id]:project,[cam.id]:cam};
  const sliders=specs.map((s,k)=>{ const nd=makeNode("slider",{x:-40,y:0+k*96});nd.name=s.name;nd.label=s.label;nd.value=s.value;nd.props.min=String(s.min);nd.props.max=String(s.max);nd.props.step=String(s.step);scene[nd.id]=nd;return nd; });
  // curve y = a*exp(-(x/w)^2). At x=0: y=a, y''=-2a/w². κ = |y''| = 2a/w²,
  // radius R = 1/κ = w²/(2a). Circle center at (0, a - R).
  const fn=makeNode("fnMap",{x:380,y:60});fn.label="bump";fn.color="#9ece6a";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="a*exp(-(x/w)^2)";
  fn.attachments=sliders.map(s=>s.id);scene[fn.id]=fn;
  const tr=makeNode("transformer",{x:760,y:60});tr.label="curve";tr.color="#9ece6a";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="y";tr.props.aMin="-3";tr.props.aMax="3";tr.props.res="400";
  tr.attachments=[fn.id];scene[tr.id]=tr;
  // osculating circle as a parametric raw-ish curve via paramSpace
  const circ=makeNode("paramSpace",{x:760,y:300});circ.label="osculating circle";circ.color="#f7768e";circ.props.degree="1";
  circ.props.exprX="(w^2/(2*a))*cos(t)";
  circ.props.exprY="(a - w^2/(2*a)) + (w^2/(2*a))*sin(t)";
  circ.props.exprZ="0";circ.props.tMin="0";circ.props.tMax="6.2832";circ.props.res="200";
  circ.attachments=sliders.map(s=>s.id);scene[circ.id]=circ;
  cam.attachments=[tr.id,circ.id];
  return {scene,camId:cam.id,animated:false};
}

// DYNAMICS — driven damped oscillator response. The steady-state amplitude of
// x'' + 2ζω₀x' + ω₀²x = F cos(ωt) as a function of drive frequency ω, with the
// resonance peak sliding as damping and natural frequency change.
function tutResonanceScene(){
  return _sliderCurve({
    label:"resonance: amplitude vs drive frequency",
    specs:[
      {name:"w0",label:"ω₀ · natural freq",value:2,min:0.5,max:4,step:0.05},
      {name:"z", label:"ζ · damping",value:0.08,min:0.02,max:1,step:0.01},
      {name:"F", label:"F · drive",value:1,min:0.2,max:3,step:0.05},
    ],
    mode:"graph",
    // amplitude A(ω) = F / sqrt((ω₀²−ω²)² + (2ζω₀ω)²), x-axis is ω
    out0:"F / sqrt((w0^2 - x^2)^2 + (2*z*w0*x)^2)",
    aMin:0, aMax:6, ortho:3.2, oy:"1.6", color:"#bb9af7",
  });
}

// EDITOR — a pure wiring page: one expression fed by many sliders, showing how a
// single curve responds to a whole panel of live parameters. A general cubic
// y = a x³ + b x² + c x + d with all four coefficients on sliders.
function tutLiveParamsScene(){
  return _sliderCurve({
    label:"one curve, four live parameters",
    specs:[
      {name:"a",label:"a · x³",value:0.3,min:-1,max:1,step:0.02},
      {name:"b",label:"b · x²",value:0,min:-2,max:2,step:0.05},
      {name:"c",label:"c · x",value:-1,min:-3,max:3,step:0.05},
      {name:"d",label:"d · 1",value:0,min:-3,max:3,step:0.05},
    ],
    mode:"graph",
    out0:"a*x^3 + b*x^2 + c*x + d",
    aMin:-4, aMax:4, ortho:5, color:"#e0af68",
  });
}


// Taylor series of eˣ: drag N and the polynomial chases the exponential, matching
// it over a widening interval. Like sin, eˣ is entire — the series converges for
// every x.
function tutTaylorExpScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="drag N: Taylor of eˣ";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="4";cam.props.planeOx="0";cam.props.planeOy="3";
  const N=makeNode("slider",{x:20,y:320});N.name="N";N.label="N · terms";N.value=3;
  N.props.min="0";N.props.max="12";N.props.step="1";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="Taylor eˣ";fn.color="#a6e3a1";
  fn.props.inDim="1";fn.props.outDim="1";
  fn.props.out0="summation(x^j / factorial(j), j, 0, N)";
  fn.attachments=[N.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="curve";tr.color="#a6e3a1";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="y";
  tr.props.aMin="-4";tr.props.aMax="3";tr.props.res="240";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[N.id]:N,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}

// Radius of convergence: the geometric series Σxʲ equals 1/(1−x), but only for
// |x| < 1. Drag N and the partial sums hug the true curve inside the unit
// interval while blowing up outside it — the series has a hard wall at x = ±1.
function tutTaylorRadiusScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="drag N: a radius of convergence";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3";cam.props.planeOx="0";cam.props.planeOy="1.5";
  const N=makeNode("slider",{x:20,y:320});N.name="N";N.label="N · terms";N.value=6;
  N.props.min="0";N.props.max="24";N.props.step="1";
  // partial sum of the geometric series
  const fn=makeNode("fnMap",{x:360,y:120});fn.label="Σ xʲ";fn.color="#ffcf6e";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="summation(x^j, j, 0, N)";fn.attachments=[N.id];
  const tr=makeNode("transformer",{x:700,y:120});tr.label="partial sum";tr.color="#ffcf6e";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="y";
  tr.props.aMin="-1.4";tr.props.aMax="0.95";tr.props.res="240";
  tr.attachments=[fn.id];
  // the true limit 1/(1-x) for comparison
  const fn2=makeNode("fnMap",{x:360,y:300});fn2.label="1/(1−x)";fn2.color="#5b9cf6";
  fn2.props.inDim="1";fn2.props.outDim="1";fn2.props.out0="1/(1 - x)";
  const tr2=makeNode("transformer",{x:700,y:300});tr2.label="limit";tr2.color="#5b9cf6";
  tr2.props.mode="graph";tr2.props.inAxis0="x";tr2.props.outAxis0="y";
  tr2.props.aMin="-1.4";tr2.props.aMax="0.95";tr2.props.res="240";
  tr2.attachments=[fn2.id];
  cam.attachments=[tr2.id,tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[N.id]:N,[fn.id]:fn,[tr.id]:tr,[fn2.id]:fn2,[tr2.id]:tr2},camId:cam.id,animated:false};
}

// Step 3: a genuine variety. A torus level set, the next step up in complexity
// from a sphere, still a single readable equation.
function tutTorusLevelScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="a torus level set";cam.props.showOpenBtn=false;
  cam.props.orbRadius="7";cam.props.orbTheta="0.8";cam.props.orbPhi="0.95";
  const eq=makeNode("equation",{x:360,y:160});eq.label="torus";eq.color="#ffcf6e";
  eq.props.dims="3d";eq.props.lhs="(sqrt(x^2 + y^2) - 1.4)^2 + z^2";eq.props.rhs="0.36";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="surface";tr.color="#ffcf6e";
  tr.props.mode="graph";
  tr.props.aMin="-2.2";tr.props.aMax="2.2";tr.props.bMin="-2.2";tr.props.bMax="2.2";tr.props.cMin="-1";tr.props.cMax="1";
  tr.props.res="160";tr.props.colorMode="gradient";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:false};
}

// Register tutorial scenes alongside the rest.
// Raw-geometry showcase / benchmark scenes (mathematical, organic, architectural,
// fractal) — registered as ordinary preview kinds so #bench and direct hashes can
// render them.
Object.assign(SCENES, RAWGEOM_SHOWCASE);

Object.assign(SCENES, {
  "tut-fn-only": tutFnOnlyScene,
  "tut-fn-surface": tutFnSurfaceScene,
  "tut-fn-field": tutFnFieldScene,
  "tut-sphere": tutSphereScene,
  "tut-sphere-slider": tutSphereSliderScene,
  "tut-quadric-morph": tutQuadricMorphScene,
  "tut-quadric-saddle": tutQuadricSaddleScene,
  "tut-quadric-cone": tutQuadricConeScene,
  "tut-polar-rose": tutPolarRoseScene,
  "tut-polar-cardioid": tutPolarCardioidScene,
  "tut-spherical": tutPolarSpiralScene,
  "tut-mode-polar": tutModePolarScene,
  "tut-mode-spherical": tutModeSphericalScene,
  "tut-mode-graph": tutModeGraphScene,
  "tut-mode-param": tutModeParamScene,
  "tut-mode-field": tutModeFieldScene,
  "tut-raw-list": tutRawListScene,
  "tut-raw-sequence": tutRawSequenceScene,
  "tut-raw-lattice": tutRawLatticeScene,
  "tut-raw-glyphs": tutRawGlyphsScene,
  "tut-raw-gouraud": tutRawGouraudScene,
  "tut-raw-torus": tutRawTorusScene,
  "tut-conic-zoo": tutConicZooScene,
  "tut-harmonograph": tutHarmonographScene,
  "tut-osculating": tutOsculatingScene,
  "tut-resonance": tutResonanceScene,
  "tut-live-params": tutLiveParamsScene,
  "tut-taylor-exp": tutTaylorExpScene,
  "tut-taylor-radius": tutTaylorRadiusScene,
  "tut-torus-level": tutTorusLevelScene,
  "tut-intersection-curve": tutIntersectionScene,
  "tut-const-curve": tutConstCurveScene,
  "tut-slider-curve": tutSliderCurveScene,
  "tut-animator-curve": tutAnimatorCurveScene,
  "tut-named-scope": tutNamedScopeScene,
  "tut-cam-3d": tutCam3dScene,
  "tut-cam-2d": tutCam2dScene,
  "tut-graph-1d": tutGraph1dScene,
  "tut-graph-2d": tutGraph2dScene,
  "tut-graph-anim": tutGraphAnimScene,
  "tut-param-curve": tutParamCurveScene,
  "tut-param-surface": tutParamSurfaceScene,
  "tut-param-anim": tutParamAnimScene,
  "tut-cubic-smooth": tutCubicSmoothScene,
  "tut-cubic-nodal": tutCubicNodalScene,
  "tut-node-gradient": tutNodeGradientScene,
  "tut-poly-curve": tutPolyCurveScene,
  "tut-transcendental": tutTranscendentalScene,
  "tut-analytic-surface": tutAnalyticSurfaceScene,
  "tut-normal-color": tutNormalColorScene,
  "tut-revolution": tutRevolutionScene,
  "tut-vector-field": tutVectorFieldScene,
  "tut-streamlines": tutStreamlinesScene,
  "tut-points-list": tutPointsListScene,
  "tut-points-index": tutPointsIndexScene,
  "tut-points-recursive": tutPointsRecursiveScene,
  "tut-combine-union": tutCombineUnionScene,
  "tut-combine-product": tutCombineProductScene,
  "tut-combine-intersect": tutCombineIntersectScene,
  "tut-orbit-logistic": tutOrbitLogisticScene,
  "tut-orbit-attractor": tutOrbitAttractorScene,
  "tut-orbit-converge": tutOrbitConvergeScene,
  "tut-sensitive": tutSensitiveScene,
  "tut-henon": tutHenonScene,
  "tut-gingerbread": tutGingerbreadScene,
  "tut-series-1": tutSeries1Scene,
  "tut-series-5": tutSeries5Scene,
  "tut-series-15": tutSeries15Scene,
  "tut-integral-area": tutIntegralAreaScene,
  "tut-frame-tube": tutFrameTubeScene,
  "tut-frame-moving": tutFrameMovingScene,
  "tut-tangent-line": tutTangentLineScene,
  "tut-tangent-plane": tutTangentPlaneScene,
  "tut-tangent-bundle": tutTangentBundleScene,
  "tut-frenet": tutFrenetScene,
  "tut-frenet-measure": tutFrenetMeasureScene,
  "tut-geodesic-sphere": tutGeodesicSphereScene,
  "tut-geodesic-compare": tutGeodesicCompareScene,
  "tut-gauss-curvature": tutGaussCurvatureScene,
  "tut-point-types": tutPointTypesScene,
  "tut-combine-inputs": tutCombineInputsScene,
  "tut-curve-family": tutCurveFamilyScene,
  "tut-taylor": tutTaylorScene,
  "tut-curvature-feel": tutCurvatureFeelScene,
  "tut-logistic-r": tutLogisticRScene,
  "tut-combine-one": tutCombineOneScene,
  "tut-combine-two": tutCombineTwoScene,
  "tut-combine-surface": tutCombineSurfaceScene,
  "tut-combine-lissajous": tutCombineLissajousScene,
  "tut-conic-family": tutConicFamilyScene,
  "tut-surface-family": tutSurfaceFamilyScene,
  "tut-logistic-fixed2": tutLogisticFixed2Scene,
  "tut-logistic-fixed4": tutLogisticFixed4Scene,
  "tut-cobweb": tutCobwebScene,
  "tut-flow-source": tutFlowSourceScene,
  "tut-flow-saddle": tutFlowSaddleScene,
  "tut-flow-shear": tutFlowShearScene,
  "tut-flow-morph": tutFlowMorphScene,
  "tut-flow-lines": tutFlowLinesScene,
  "tut-flow-surface": tutFlowSurfaceScene,
  "tut-flow-pendulum": tutFlowPendulumScene,
  "tut-flow-3d": tutFlow3dScene,
  "tut-fixed-attract": tutFixedAttractScene,
  "tut-fixed-repel": tutFixedRepelScene,
  "tut-fixed-center": tutFixedCenterScene,
  "tut-limitcycle": tutLimitCycleScene,
  "tut-lorenz": tutLorenzScene,
  "tut-rossler": tutRosslerScene,
  "tut-flow-dense2d": tutFlowDense2dScene,
  "tut-flow-dense-surface": tutFlowDenseSurfaceScene,
  "tut-flow-dense-grid": tutFlowDenseGridScene,
});

// Dense flows — high seed counts that exercise the GPU batch integrator.

// Many streamlines across a 2D field: ~150 seeds on a ring, each integrated.
// On the GPU these advance in parallel; on the CPU they fall back gracefully.
function tutFlowDense2dScene(){
  return _flow2d({label:"150 streamlines at once", vx:"-y + 0.18*x - 0.3*x*(x*x+y*y)*0.1", vy:"x + 0.18*y - 0.3*y*(x*x+y*y)*0.1",
    size:3.2, seedX:"2.8*cos(6.2832*t)", seedY:"2.8*sin(6.2832*t)", seedRes:64,
    steps:240, stepSize:0.03, output:"lines"});
}
// A dense stream surface: ~120 seeds along a line swept into a fine sheet.
function tutFlowDenseSurfaceScene(){
  return _flow2d({label:"a finely-sampled stream surface", vx:"-y + 0.25*x", vy:"x + 0.25*y",
    size:3.4, seedX:"0.2 + 3.0*t", seedY:"0.05", seedRes:60, steps:260, stepSize:0.03, output:"surface"});
}
// A dense 3D stream surface: a seed line of 96 points swept through a helical
// field into a smooth helicoidal sheet (the GPU path's best 3D case).
function tutFlowDenseGridScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="96 seeds → smooth sheet";cam.props.showOpenBtn=false;
  cam.props.orbRadius="10";cam.props.orbTheta="0.8";cam.props.orbPhi="0.95";cam.props.spin="loop";cam.props.spinPeriod="44";
  const field=makeNode("fnMap",{x:300,y:120});field.props.inDim="3";field.props.outDim="3";
  field.props.out0="-y";field.props.out1="x";field.props.out2="0.5";
  const seeds=makeNode("paramSpace",{x:300,y:320});seeds.label="seed line";seeds.props.degree="1";
  seeds.props.exprX="0.4 + 2.2*t";seeds.props.exprY="0";seeds.props.exprZ="0";
  seeds.props.tMin="0";seeds.props.tMax="1";seeds.props.res="56";
  const flow=makeNode("flow",{x:640,y:200});flow.label="stream surface";flow.color="#5be0c0";
  flow.props.steps="360";flow.props.stepSize="0.03";flow.props.output="surface";
  flow.props.gradient=true;flow.props.gradA="#5be0c0";flow.props.gradB="#5b9cf6";
  flow.attachments=[field.id,seeds.id];
  cam.attachments=[flow.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[field.id]:field,[seeds.id]:seeds,[flow.id]:flow},camId:cam.id,animated:false};
}

// The Rössler attractor: x'=−y−z, y'=x+ay, z'=b+z(x−c), classic a=b=0.2, c=5.7.
// Same cheap reveal approach as Lorenz: integrate once as a recursive points
// sequence, reveal a growing prefix with the sequenced animator.
function tutRosslerScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="the Rössler attractor";cam.props.showOpenBtn=false;
  cam.props.targetX="0";cam.props.targetY="0";cam.props.targetZ="6";
  cam.props.orbRadius="42";cam.props.orbTheta="0.5";cam.props.orbPhi="1.15";
  cam.props.spin="loop";cam.props.spinPeriod="40";
  const f=makeNode("animator",{x:40,y:360});f.name="f";f.value=0;
  f.props.min="0";f.props.max="1";f.props.period="18";f.props.loop="loop";f.playing=true;
  const pts=makeNode("points",{x:620,y:160});pts.label="Rössler trajectory";pts.color="#ffcf6e";
  pts.props.kind="points";pts.props.mode="recursive";
  pts.props.recInit="1, 1, 1";
  pts.props.recStep=
    "x[n-1] + 0.02*(-y[n-1] - z[n-1]), "+
    "y[n-1] + 0.02*(x[n-1] + 0.2*y[n-1]), "+
    "z[n-1] + 0.02*(0.2 + z[n-1]*(x[n-1] - 5.7))";
  pts.props.recCount="6000";pts.props.drawLines=true;pts.props.radius="0";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#ffcf6e";pts.props.colorHi="#ff6ec7";
  pts.props.sequenced=true;pts.props.seqVar="f";
  pts.attachments=[f.id];
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[f.id]:f,[pts.id]:pts},camId:cam.id,animated:true};
}

// Dynamical systems: fixed points & stability ────────────────────────────────

// an attracting spiral: everything winds inward to the origin.
function tutFixedAttractScene(){
  const w=makeNode("slider",{x:20,y:300});w.name="w";w.label="w · swirl";w.value=1;
  w.props.min="0.2";w.props.max="3";w.props.step="0.02";
  return _flow2d({label:"a stable spiral (drag swirl)", vx:"-x - w*y", vy:"w*x - y", size:2.6,
    seedX:"2.3*cos(6.2832*t)", seedY:"2.3*sin(6.2832*t)", seedRes:24, steps:240, stepSize:0.03,
    output:"lines", sliders:[w]});
}
// a repelling spiral: everything winds outward.
function tutFixedRepelScene(){
  const w=makeNode("slider",{x:20,y:300});w.name="w";w.label="w · swirl";w.value=1;
  w.props.min="0.2";w.props.max="3";w.props.step="0.02";
  return _flow2d({label:"an unstable spiral (drag swirl)", vx:"x - w*y", vy:"w*x + y", size:2.6,
    seedX:"0.25*cos(6.2832*t)", seedY:"0.25*sin(6.2832*t)", seedRes:24, steps:150, stepSize:0.03,
    output:"lines", sliders:[w]});
}
// a center: closed orbits, neither attracting nor repelling (the boundary case).
function tutFixedCenterScene(){
  const w=makeNode("slider",{x:20,y:300});w.name="w";w.label="w · rotation";w.value=1;
  w.props.min="0.3";w.props.max="3";w.props.step="0.02";
  return _flow2d({label:"a center (drag rotation)", vx:"-w*y", vy:"w*x", size:2.6,
    seedX:"0.4 + 1.8*t", seedY:"0", seedRes:14, steps:320, stepSize:0.03,
    output:"lines", sliders:[w]});
}

// Dynamical systems: limit cycles (Van der Pol) ──────────────────────────────
// x' = y, y' = μ(1−x²)y − x. For μ>0 every trajectory spirals onto one isolated
// closed loop, the limit cycle — the signature of self-sustained oscillation.
function tutLimitCycleScene(){
  const mu=makeNode("slider",{x:20,y:300});mu.name="mu";mu.label="μ · nonlinearity";mu.value=1;
  mu.props.min="0.2";mu.props.max="3";mu.props.step="0.02";
  return _flow2d({label:"Van der Pol limit cycle", vx:"y", vy:"mu*(1 - x*x)*y - x", size:3.4,
    seedX:"0.1 + 3.0*t", seedY:"0.1", seedRes:9, steps:420, stepSize:0.02, output:"lines",
    sliders:[mu], animated:false});
}

// Dynamical systems: continuous chaos (Lorenz) ───────────────────────────────
// The Lorenz system σ(y−x), x(ρ−z)−y, xy−βz with the classic σ=10, ρ=28, β=8/3.
// We integrate the trajectory ONCE as a recursive points sequence (Euler step,
// small h), then reveal a growing prefix with the points node's O(1) sequenced
// reveal driven by an animator. This avoids re-integrating thousands of steps
// every frame (which is what made the earlier flow-node version stutter and never
// finish). The camera targets the attractor's center (≈ z=25).
function tutLorenzScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="the Lorenz attractor";cam.props.showOpenBtn=false;
  cam.props.targetX="0";cam.props.targetY="0";cam.props.targetZ="25";
  cam.props.orbRadius="62";cam.props.orbTheta="0.6";cam.props.orbPhi="1.35";
  cam.props.spin="loop";cam.props.spinPeriod="40";
  // reveal fraction 0→1 loops; the points node shows that prefix of the path
  const f=makeNode("animator",{x:40,y:360});f.name="f";f.value=0;
  f.props.min="0";f.props.max="1";f.props.period="16";f.props.loop="loop";f.playing=true;
  const pts=makeNode("points",{x:620,y:160});pts.label="Lorenz trajectory";pts.color="#5ad1e6";
  pts.props.kind="points";pts.props.mode="recursive";
  pts.props.recInit="0.1, 0, 0";
  // Euler step, h=0.005: xₙ = xₙ₋₁ + h·f(xₙ₋₁)
  pts.props.recStep=
    "x[n-1] + 0.005*(10*(y[n-1]-x[n-1])), "+
    "y[n-1] + 0.005*(x[n-1]*(28-z[n-1]) - y[n-1]), "+
    "z[n-1] + 0.005*(x[n-1]*y[n-1] - (8/3)*z[n-1])";
  pts.props.recCount="5000";pts.props.drawLines=true;pts.props.radius="0";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#5ad1e6";pts.props.colorHi="#9b8cff";
  pts.props.sequenced=true;pts.props.seqVar="f";
  pts.attachments=[f.id];
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[f.id]:f,[pts.id]:pts},camId:cam.id,animated:true};
}

// Applications: flow scenes ──────────────────────────────────────────────────

// helper: a 2D flow scene (field quiver + integrated streamlines from a seed line)
function _flow2d(opts){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label=opts.label;cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize=String(opts.size||3);
  if(opts.cx!=null){cam.props.planeOx=String(opts.cx);cam.props.planeOy=String(opts.cy||0);}
  // sliders + an optional looping animator all feed the field (and its quiver)
  const extraSliders=opts.sliders||[];
  const anim=opts.anim||null;
  const feeders=[...extraSliders, ...(anim?[anim]:[])];
  const field=makeNode("fnMap",{x:300,y:120});field.label="V(x,y)";field.props.inDim="2";field.props.outDim="2";
  field.props.out0=opts.vx;field.props.out1=opts.vy;
  if(feeders.length) field.attachments=feeders.map(s=>s.id);
  const seeds=makeNode("paramSpace",{x:300,y:320});seeds.label="seeds";seeds.props.degree="1";
  seeds.props.exprX=opts.seedX||"-2.4 + 4.8*t";seeds.props.exprY=opts.seedY||"-2.2";seeds.props.exprZ="0";
  // resolutions kept modest so re-integration on slider/animation frames stays
  // smooth even when the GPU path isn't carrying the load
  seeds.props.tMin="0";seeds.props.tMax="1";seeds.props.res=String(opts.seedRes||20);
  const flow=makeNode("flow",{x:640,y:200});flow.label="streamlines";flow.color="#5be0c0";
  flow.props.steps=String(opts.steps||220);flow.props.stepSize=String(opts.stepSize||0.035);flow.props.output=opts.output||"surface";
  flow.props.gradient=true;flow.props.gradA="#5be0c0";flow.props.gradB="#5b9cf6";
  flow.attachments=[field.id,seeds.id];
  // companion quiver of the same field (denser grid now that it's cheap)
  const qfn=makeNode("fnMap",{x:300,y:520});qfn.props.inDim="2";qfn.props.outDim="2";
  qfn.props.out0=opts.vx;qfn.props.out1=opts.vy;
  if(feeders.length) qfn.attachments=feeders.map(s=>s.id);
  const quiver=makeNode("transformer",{x:640,y:460});quiver.label="field";quiver.color="#ffb454";
  quiver.props.mode="field";quiver.props.inAxis0="x";quiver.props.inAxis1="y";
  const ext=opts.size||3;
  quiver.props.aMin=String(-ext);quiver.props.aMax=String(ext);quiver.props.bMin=String(-ext);quiver.props.bMax=String(ext);
  quiver.props.res=String(opts.quiverRes||12);quiver.props.arrowLen="0.3";quiver.props.normalize=true;
  quiver.attachments=[qfn.id];
  const scene={[project.id]:project,[cam.id]:cam,[field.id]:field,[seeds.id]:seeds,[flow.id]:flow,[qfn.id]:qfn,[quiver.id]:quiver};
  for(const s of feeders) scene[s.id]=s;
  cam.attachments=[flow.id,quiver.id];
  return {scene,camId:cam.id,animated:!!opts.animated || !!anim};
}
// Step: a source/sink — arrows point outward, streamlines radiate.
function tutFlowSourceScene(){
  // A pure source (s=0) radiates straight out; raising s adds rotation so it
  // becomes a spiral source. Because the flow normalizes speed, a plain magnitude
  // scale would be invisible — s changes the DIRECTION field, which shows.
  const s=makeNode("slider",{x:20,y:300});s.name="s";s.label="s · swirl";s.value=0;
  s.props.min="0";s.props.max="1.4";s.props.step="0.01";
  return _flow2d({label:"a source (drag swirl)", vx:"x - s*y", vy:"s*x + y", size:2.6,
    seedX:"2.2*cos(6.2832*t)", seedY:"2.2*sin(6.2832*t)", seedRes:24, steps:120, stepSize:0.02,
    output:"lines", sliders:[s]});
}
// Step: a saddle — flow in along one axis, out along the other.
function tutFlowSaddleScene(){
  const a=makeNode("slider",{x:20,y:300});a.name="a";a.label="a · asymmetry";a.value=1;
  a.props.min="0.3";a.props.max="2.5";a.props.step="0.01";
  return _flow2d({label:"a saddle (drag asymmetry)", vx:"a*x", vy:"-y", size:2.6,
    seedX:"-2.4 + 4.8*t", seedY:"-2.3", seedRes:24, steps:200, stepSize:0.03,
    output:"lines", sliders:[a]});
}
// Step: a shear — horizontal speed grows with height.
function tutFlowShearScene(){
  // Pure shear (k=0) is V=(y,0): every streamline is horizontal, faster higher up.
  // Raising k adds a vertical response so the straight shear bends toward rotation.
  // A magnitude scale on (y,0) would be invisible to the normalized flow; k changes
  // the direction field, so the streamlines visibly curve.
  const k=makeNode("slider",{x:20,y:300});k.name="k";k.label="k · bend";k.value=0;
  k.props.min="0";k.props.max="1.2";k.props.step="0.01";
  return _flow2d({label:"a shear flow (drag bend)", vx:"y", vy:"k*x", size:2.6,
    seedX:"-2.4", seedY:"-2.4 + 4.8*t", seedRes:24, steps:200, stepSize:0.03,
    output:"lines", sliders:[k]});
}
// Step: a slider morphs the field from pure rotation to spiral.
function tutFlowMorphScene(){
  const a=makeNode("slider",{x:20,y:300});a.name="a";a.label="a · inward pull";a.value=0;
  a.props.min="-0.6";a.props.max="0.6";a.props.step="0.01";
  return _flow2d({label:"drag a: swirl ↔ spiral", vx:"-y + a*x", vy:"x + a*y", size:2.8,
    seedX:"2.4*cos(6.2832*t)", seedY:"2.4*sin(6.2832*t)", seedRes:26, steps:240, stepSize:0.03,
    output:"lines", sliders:[a]});
}
// Deeper page: lines output (discrete trajectories).
function tutFlowLinesScene(){
  return _flow2d({label:"trajectories as lines", vx:"-y + 0.25*x", vy:"x + 0.25*y", size:3,
    seedX:"0.3 + 2.4*t", seedY:"0.1", seedRes:18, steps:320, stepSize:0.035, output:"lines"});
}
// Deeper page: surface output (the seeds sweep a filled stream surface).
function tutFlowSurfaceScene(){
  // A genuine 3D stream surface: a swirling field with a steady vertical lift
  // sweeps a dense seed line into a spiral ramp. The camera slowly orbits to show
  // the form from all sides. The surface is built ONCE — only the camera moves per
  // frame, so the scene stays cheap (no per-frame re-integration or rebuild).
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="trajectories as a surface";cam.props.showOpenBtn=false;
  cam.props.orbRadius="11";cam.props.orbTheta="0.8";cam.props.orbPhi="0.95";cam.props.spin="loop";cam.props.spinPeriod="32";
  const field=makeNode("fnMap",{x:300,y:120});field.props.inDim="3";field.props.outDim="3";
  field.props.out0="-y + 0.12*x";field.props.out1="x + 0.12*y";field.props.out2="0.55";
  const seeds=makeNode("paramSpace",{x:300,y:320});seeds.label="seed line";seeds.props.degree="1";
  seeds.props.exprX="0.3 + 2.4*t";seeds.props.exprY="0.1";seeds.props.exprZ="0";
  seeds.props.tMin="0";seeds.props.tMax="1";seeds.props.res="36";
  const flow=makeNode("flow",{x:640,y:200});flow.label="stream surface";flow.color="#5be0c0";
  flow.props.steps="200";flow.props.stepSize="0.04";flow.props.output="surface";
  flow.props.gradient=true;flow.props.gradA="#5be0c0";flow.props.gradB="#5b9cf6";
  flow.attachments=[field.id,seeds.id];
  cam.attachments=[flow.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[field.id]:field,[seeds.id]:seeds,[flow.id]:flow},camId:cam.id,animated:true};
}
// Deeper page: a pendulum phase portrait, a physically meaningful field.
function tutFlowPendulumScene(){
  // state (θ, ω): θ' = ω, ω' = −sin θ (undamped pendulum). Closed orbits near the
  // center, over-the-top rotation outside the separatrix.
  const g=makeNode("slider",{x:20,y:300});g.name="g";g.label="g · gravity";g.value=1;
  g.props.min="0.3";g.props.max="2.5";g.props.step="0.02";
  return _flow2d({label:"pendulum phase portrait (drag g)", vx:"y", vy:"-g*sin(x)", size:3.2,
    seedX:"-3 + 6*t", seedY:"0.05", seedRes:26, steps:300, stepSize:0.03,
    output:"lines", sliders:[g]});
}
// Deeper page: a 3D flow (reuse the helicoidal stream surface pattern).
function tutFlow3dScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="a 3D flow";cam.props.showOpenBtn=false;
  cam.props.orbRadius="9";cam.props.orbTheta="0.8";cam.props.orbPhi="0.95";cam.props.spin="loop";cam.props.spinPeriod="40";
  const field=makeNode("fnMap",{x:300,y:120});field.props.inDim="3";field.props.outDim="3";
  field.props.out0="-y";field.props.out1="x";field.props.out2="0.6";
  const seeds=makeNode("paramSpace",{x:300,y:320});seeds.label="seed line";seeds.props.degree="1";
  seeds.props.exprX="t";seeds.props.exprY="0";seeds.props.exprZ="0";seeds.props.tMin="0";seeds.props.tMax="1";seeds.props.res="48";
  const flow=makeNode("flow",{x:640,y:200});flow.label="stream surface";flow.color="#5be0c0";
  flow.props.steps="320";flow.props.stepSize="0.03";flow.props.output="surface";
  flow.props.gradient=true;flow.props.gradA="#5be0c0";flow.props.gradB="#5b9cf6";
  flow.attachments=[field.id,seeds.id];
  cam.attachments=[flow.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[field.id]:field,[seeds.id]:seeds,[flow.id]:flow},camId:cam.id,animated:false};
}

// A cobweb diagram. The orbit zigzags between the map curve y=f(x) and the
// diagonal y=x. A cobweb is a sequence that alternates: move vertically to the
// curve, then horizontally to the diagonal, repeat. That alternation is a depth-1
// recurrence keyed on the parity of n (no new node type needed): on odd steps
// keep x and set y=f(x) (vertical), on even steps keep y and set x=y (horizontal).
// We draw it over the map curve and the diagonal for the classic picture.
function tutCobwebScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="cobweb: orbit on the map";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="0.6";cam.props.planeOx="0.5";cam.props.planeOy="0.5";
  const r=makeNode("slider",{x:20,y:340});r.name="r";r.label="r · growth rate";r.value=3.2;
  r.props.min="2.6";r.props.max="4.0";r.props.step="0.005";
  // the map curve y = r·x(1−x) over [0,1]
  const mapFn=makeNode("fnMap",{x:340,y:80});mapFn.label="f(x)=r·x(1−x)";mapFn.color="#7a8499";
  mapFn.props.inDim="1";mapFn.props.outDim="1";mapFn.props.out0="r*x*(1-x)";mapFn.attachments=[r.id];
  const mapTr=makeNode("transformer",{x:680,y:80});mapTr.label="map";mapTr.color="#7a8499";
  mapTr.props.mode="graph";mapTr.props.inAxis0="x";mapTr.props.outAxis0="y";
  mapTr.props.aMin="0";mapTr.props.aMax="1";mapTr.props.res="200";mapTr.attachments=[mapFn.id];
  // the diagonal y = x
  const diagFn=makeNode("fnMap",{x:340,y:220});diagFn.label="y=x";diagFn.color="#3a4256";
  diagFn.props.inDim="1";diagFn.props.outDim="1";diagFn.props.out0="x";
  const diagTr=makeNode("transformer",{x:680,y:220});diagTr.label="diagonal";diagTr.color="#3a4256";
  diagTr.props.mode="graph";diagTr.props.inAxis0="x";diagTr.props.outAxis0="y";
  diagTr.props.aMin="0";diagTr.props.aMax="1";diagTr.props.res="2";diagTr.attachments=[diagFn.id];
  // the cobweb zigzag itself, as a recurrence alternating on parity of n
  const odd="(mod(n,2)==1)", even="(mod(n,2)==0)";
  const pts=makeNode("points",{x:680,y:360});pts.label="cobweb";pts.color="#ffcf6e";
  pts.props.kind="points";pts.props.mode="recursive";
  pts.props.recInit="0.15, 0.15";
  // x_next: odd→keep x (vertical), even→jump to y (horizontal)
  // y_next: odd→f(x) (vertical),  even→keep y (horizontal)
  pts.props.recStep=
    `${odd}*x[n-1] + ${even}*y[n-1], `+
    `${odd}*(r*x[n-1]*(1-x[n-1])) + ${even}*y[n-1]`;
  pts.props.recCount="160";pts.props.drawLines=true;pts.props.radius="0";
  pts.attachments=[r.id];
  cam.attachments=[mapTr.id,diagTr.id,pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[r.id]:r,
    [mapFn.id]:mapFn,[mapTr.id]:mapTr,[diagFn.id]:diagFn,[diagTr.id]:diagTr,[pts.id]:pts},camId:cam.id,animated:false};
}

// Algebraic: more family scenes ──────────────────────────────────────────────

// A conic family: x²/1 + y²/c going from ellipse (c>0) through to hyperbola (c<0).
function tutConicFamilyScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="drag c: ellipse ↔ hyperbola";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="4";
  const c=makeNode("slider",{x:20,y:320});c.name="c";c.label="c";c.value=1;
  c.props.min="-3";c.props.max="3";c.props.step="0.02";
  const eq=makeNode("equation",{x:360,y:160});eq.label="x² + c·y² = 1 (scaled)";eq.color="#9b8cff";
  // x^2 + (1/c) y^2 = 1 is awkward at c=0; use x^2 + sign-carrying c*y^2 form:
  eq.props.dims="2d";eq.props.lhs="x^2 + c*y^2";eq.props.rhs="1";eq.props.varA="x";eq.props.varB="y";
  eq.attachments=[c.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="curve";tr.color="#9b8cff";
  tr.props.mode="graph";tr.props.aMin="-4";tr.props.aMax="4";tr.props.bMin="-4";tr.props.bMax="4";tr.props.res="320";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[c.id]:c,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:false};
}
// A 3D surface family: the Clebsch-style cubic deformed by a slider.
function tutSurfaceFamilyScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="drag t through the family";cam.props.showOpenBtn=false;
  cam.props.orbRadius="6";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="40";
  const t=makeNode("slider",{x:20,y:320});t.name="t";t.label="t · deformation";t.value=0;
  t.props.min="-1";t.props.max="1";t.props.step="0.01";
  const eq=makeNode("equation",{x:360,y:160});eq.label="cubic(t)";eq.color="#9b8cff";
  eq.props.dims="3d";eq.props.lhs="x^3 + y^3 + z^3 + t - 0.6*(x+y+z)";eq.props.rhs="3*x*y*z";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";eq.attachments=[t.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="surface";tr.color="#9b8cff";
  tr.props.mode="graph";tr.props.aMin="-2";tr.props.aMax="2";tr.props.bMin="-2";tr.props.bMax="2";tr.props.cMin="-2";tr.props.cMax="2";
  tr.props.res="150";tr.props.colorMode="normal";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[t.id]:t,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:true};
}

// Applications: more logistic scenes ─────────────────────────────────────────
function _logisticAt(label, r){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label=label;cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3.4";cam.props.planeOx="3";cam.props.planeOy="0.5";
  const pts=makeNode("points",{x:620,y:160});pts.label=`r = ${r}`;pts.color="#ffcf6e";
  pts.props.kind="points";pts.props.mode="recursive";
  pts.props.recInit="2.6, 0.3";
  pts.props.recStep=`x[n-1] + 0.014, ${r}*y[n-1]*(1 - y[n-1])`;
  pts.props.recCount="100";pts.props.drawLines=false;pts.props.radius="3";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#5b9cf6";pts.props.colorHi="#ff5ea8";
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[pts.id]:pts},camId:cam.id,animated:false};
}
// a 2-cycle (period 2) at r=3.2 and a 4-cycle at r=3.5
function tutLogisticFixed2Scene(){ return _logisticAt("period 2 (r = 3.2)", "3.2"); }
function tutLogisticFixed4Scene(){ return _logisticAt("period 4 (r = 3.5)", "3.5"); }

// The editor: combining inputs — full progression ────────────────────────────

// Step A: a single slider scaling a wave (the starting point).
function tutCombineOneScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="one slider";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3";
  const A=makeNode("slider",{x:20,y:320});A.name="A";A.label="A · amplitude";A.value=1.5;
  A.props.min="0.1";A.props.max="2.8";A.props.step="0.01";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="A·sin(x)";fn.color="#a6e3a1";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="A*sin(x)";fn.attachments=[A.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="curve";tr.color="#a6e3a1";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="y";tr.props.aMin="-6.28";tr.props.aMax="6.28";tr.props.res="300";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[A.id]:A,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step B: two sliders that interact (a sum of two waves — beats).
function tutCombineTwoScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="two frequencies add";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3";
  const k1=makeNode("slider",{x:20,y:320});k1.name="k1";k1.label="k₁";k1.value=3;
  k1.props.min="1";k1.props.max="8";k1.props.step="0.05";
  const k2=makeNode("slider",{x:20,y:400});k2.name="k2";k2.label="k₂";k2.value=4;
  k2.props.min="1";k2.props.max="8";k2.props.step="0.05";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="sin(k₁x)+sin(k₂x)";fn.color="#9b8cff";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="sin(k1*x) + sin(k2*x)";fn.attachments=[k1.id,k2.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="curve";tr.color="#9b8cff";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="y";tr.props.aMin="-6.28";tr.props.aMax="6.28";tr.props.res="400";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[k1.id]:k1,[k2.id]:k2,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step C: sliders shaping a 2D surface (two inputs, two knobs).
function tutCombineSurfaceScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="shape a surface";cam.props.showOpenBtn=false;
  cam.props.orbRadius="12";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  const kx=makeNode("slider",{x:20,y:320});kx.name="kx";kx.label="kx · x-waves";kx.value=1;
  kx.props.min="0.3";kx.props.max="4";kx.props.step="0.05";
  const ky=makeNode("slider",{x:20,y:400});ky.name="ky";ky.label="ky · y-waves";ky.value=1;
  ky.props.min="0.3";ky.props.max="4";ky.props.step="0.05";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="sin(kx·x)·cos(ky·y)";fn.color="#7ad7ff";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="sin(kx*x)*cos(ky*y)";fn.attachments=[kx.id,ky.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="surface";tr.color="#7ad7ff";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  tr.props.aMin="-3.14";tr.props.aMax="3.14";tr.props.bMin="-3.14";tr.props.bMax="3.14";tr.props.res="90";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[kx.id]:kx,[ky.id]:ky,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step D (capstone): a Lissajous curve, two parametric coordinates each with its
// own frequency slider plus a phase — sliders composing into a 2D path.
function tutCombineLissajousScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="a Lissajous figure";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="1.5";
  const a=makeNode("slider",{x:20,y:300});a.name="a";a.label="a · x-frequency";a.value=3;
  a.props.min="1";a.props.max="7";a.props.step="1";
  const b=makeNode("slider",{x:20,y:380});b.name="b";b.label="b · y-frequency";b.value=2;
  b.props.min="1";b.props.max="7";b.props.step="1";
  // phase loops on its own so the figure continuously weaves; frequencies stay draggable
  const ph=makeNode("animator",{x:20,y:460});ph.name="ph";ph.label="φ · phase";ph.value=0;
  ph.props.min="0";ph.props.max="6.2832";ph.props.period="14";ph.props.loop="loop";ph.playing=true;
  const ps=makeNode("paramSpace",{x:520,y:160});ps.label="Lissajous";ps.color="#ffcf6e";
  ps.props.degree="1";ps.props.exprX="sin(a*t + ph)";ps.props.exprY="sin(b*t)";ps.props.exprZ="0";
  ps.props.tMin="0";ps.props.tMax="6.2832";ps.props.res="600";ps.attachments=[a.id,b.id,ph.id];
  cam.attachments=[ps.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[a.id]:a,[b.id]:b,[ph.id]:ph,[ps.id]:ps},camId:cam.id,animated:true};
}

// The editor: combining inputs (three sliders on one wave) ───────────────────
function tutCombineInputsScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="drag A, k, φ";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3.2";
  const A=makeNode("slider",{x:20,y:300});A.name="A";A.label="A · amplitude";A.value=1.5;
  A.props.min="0.1";A.props.max="2.8";A.props.step="0.01";
  const k=makeNode("slider",{x:20,y:380});k.name="k";k.label="k · frequency";k.value=2;
  k.props.min="0.5";k.props.max="6";k.props.step="0.05";
  const ph=makeNode("slider",{x:20,y:460});ph.name="ph";ph.label="φ · phase";ph.value=0;
  ph.props.min="0";ph.props.max="6.2832";ph.props.step="0.02";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="A·sin(k·x + φ)";fn.color="#a6e3a1";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="A*sin(k*x + ph)";
  fn.attachments=[A.id,k.id,ph.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="curve";tr.color="#a6e3a1";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="y";
  tr.props.aMin="-6.28";tr.props.aMax="6.28";tr.props.res="300";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[A.id]:A,[k.id]:k,[ph.id]:ph,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}

// Algebraic: families of curves (slide a through a cubic family) ──────────────
function tutCurveFamilyScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="drag a: y² = x³ + a·x";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="4";
  const a=makeNode("slider",{x:20,y:320});a.name="a";a.label="a · family parameter";a.value=-1;
  a.props.min="-2";a.props.max="2";a.props.step="0.02";
  // elliptic-curve family y^2 = x^3 + a x  (singular at a=0, splits/joins as a varies)
  const eq=makeNode("equation",{x:360,y:160});eq.label="y² − x³ − a·x";eq.color="#9b8cff";
  eq.props.dims="2d";eq.props.lhs="y^2";eq.props.rhs="x^3 + a*x";eq.props.varA="x";eq.props.varB="y";
  eq.attachments=[a.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="curve";tr.color="#9b8cff";
  tr.props.mode="graph";tr.props.aMin="-3";tr.props.aMax="3";tr.props.bMin="-3";tr.props.bMax="3";tr.props.res="300";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[a.id]:a,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:false};
}

// Analytic: approximating functions (Taylor terms via a slider) ──────────────
function tutTaylorScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="drag N: Taylor terms";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="2.6";
  const N=makeNode("slider",{x:20,y:320});N.name="N";N.label="N · terms";N.value=3;
  N.props.min="0";N.props.max="10";N.props.step="1";
  // Taylor partial sum of sin(x) = sum_{j=0}^{N} (-1)^j x^(2j+1)/(2j+1)!
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="Taylor sin(x)";fn.color="#7ad7ff";
  fn.props.inDim="1";fn.props.outDim="1";
  fn.props.out0="summation((-1)^j * x^(2*j+1) / factorial(2*j+1), j, 0, N)";
  fn.attachments=[N.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="curve";tr.color="#7ad7ff";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="y";
  tr.props.aMin="-6.5";tr.props.aMax="6.5";tr.props.res="240";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[N.id]:N,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}

// Differential: curvature you can feel (sliders bend a surface) ──────────────
function tutCurvatureFeelScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="drag the bend";cam.props.showOpenBtn=false;
  cam.props.orbRadius="11";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  const a=makeNode("slider",{x:20,y:320});a.name="a";a.label="a · bend";a.value=0.4;
  a.props.min="-1";a.props.max="1";a.props.step="0.01";
  const b=makeNode("slider",{x:20,y:400});b.name="b";b.label="b · twist";b.value=0.2;
  b.props.min="-1";b.props.max="1";b.props.step="0.01";
  // a saddle-ish height field whose two curvatures are set by a and b
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="a·x² − b·y²";fn.color="#c4b5fd";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="a*x^2 - b*y^2";
  fn.attachments=[a.id,b.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="surface";tr.color="#c4b5fd";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  tr.props.aMin="-2.4";tr.props.aMax="2.4";tr.props.bMin="-2.4";tr.props.bMax="2.4";tr.props.res="80";
  tr.props.colorMode="normal";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[a.id]:a,[b.id]:b,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}

// Applications: tuning a system (logistic r slider through period-doubling) ───
function tutLogisticRScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="drag r: 2.8 → 4.0";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3.4";cam.props.planeOx="3";cam.props.planeOy="0.5";
  const r=makeNode("slider",{x:20,y:320});r.name="r";r.label="r · growth rate";r.value=3.2;
  r.props.min="2.6";r.props.max="4.0";r.props.step="0.005";
  const pts=makeNode("points",{x:620,y:160});pts.label="xₙ₊₁ = r·xₙ(1−xₙ)";pts.color="#ffcf6e";
  pts.props.kind="points";pts.props.mode="recursive";
  // plot the orbit as (n stepped across the view, x_n); r comes from the slider
  pts.props.recInit="2.6, 0.3";
  pts.props.recStep="x[n-1] + 0.014, r*y[n-1]*(1 - y[n-1])";
  pts.props.recCount="100";pts.props.drawLines=false;pts.props.radius="3";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#5b9cf6";pts.props.colorHi="#ff5ea8";
  pts.attachments=[r.id];
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[r.id]:r,[pts.id]:pts},camId:cam.id,animated:false};
}

// Analytic geometry: sums, integrals, series ─────────────────────────────────

// helper: a 1D curve y = f(x) on a 2D camera (for the series pages)
function _curve2d(label, expr, color, xspan, yspan){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label=label;cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize=String(yspan);
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="partial sum";fn.color=color;
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0=expr;
  const tr=makeNode("transformer",{x:700,y:160});tr.label="curve";tr.color=color;
  // 2D camera views the Z-normal plane, so the in-plane vertical is world Y.
  // Output must go to Y, not Z (Z is out-of-plane here and would flatten the curve).
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="y";
  tr.props.aMin=String(-xspan);tr.props.aMax=String(xspan);tr.props.res="500";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}
const _sqwave = (N) => `summation((4/3.14159265)*sin((2*k+1)*x)/(2*k+1), k, 0, ${N})`;
// Step 1: one term — a lone sine.
function tutSeries1Scene(){ return _curve2d("N = 0 (one term)", _sqwave(0), "#a6e3a1", 6.5, 2.2); }
// Step 2: a few terms — the square wave taking shape.
function tutSeries5Scene(){ return _curve2d("N = 5 (six terms)", _sqwave(5), "#9b8cff", 6.5, 2.2); }
// Step 3: many terms — the sum approaches a square wave (Gibbs ears at the jumps).
function tutSeries15Scene(){ return _curve2d("N = 15 (sixteen terms)", _sqwave(15), "#7ad7ff", 6.5, 2.2); }
// A definite integral as accumulated area: F(x) = ∫₀ˣ sin(t²) dt, the Fresnel-like
// curve, plotted by evaluating the integral with a moving upper limit.
function tutIntegralAreaScene(){
  return _curve2d("F(x) = ∫₀ˣ sin(t²) dt", "integrate(sin(t^2), t, 0, x)", "#ffcf6e", 4.5, 1.4);
}

// Differential geometry: frames along a curve ────────────────────────────────

// Step 1: a tube around a curve — a ribbon/tube swept along a helix, giving the
// curve body so its framing is visible.
function tutFrameTubeScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="a tube along a curve";cam.props.showOpenBtn=false;
  cam.props.orbRadius="8";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="34";
  // tube of radius rho around a helix: center (cos u, sin u, u/4), plus a circle
  // of radius rho in the normal plane parameterized by v.
  const ps=makeNode("paramsurf",{x:520,y:160});ps.label="tube";ps.color="#c4b5fd";
  ps.props.exprX="(1 + 0.28*cos(v))*cos(u)";
  ps.props.exprY="(1 + 0.28*cos(v))*sin(u)";
  ps.props.exprZ="u/3 + 0.28*sin(v)";
  ps.props.uMin="0";ps.props.uMax="18.85";ps.props.vMin="0";ps.props.vMax="6.2832";
  ps.props.uRes="200";ps.props.vRes="20";
  cam.attachments=[ps.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[ps.id]:ps},camId:cam.id,animated:false};
}
// Step 2: a point (a small marker set) moving along the curve as a parameter
// animates — the moving frame's position.
function tutFrameMovingScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="a point traveling the curve";cam.props.showOpenBtn=false;
  cam.props.orbRadius="8";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  const s=makeNode("animator",{x:40,y:340});s.name="s";s.value=0;
  s.props.min="0";s.props.max="18.85";s.props.period="10";s.props.loop="loop";s.playing=true;
  // the curve itself
  const curve=makeNode("paramSpace",{x:360,y:120});curve.label="helix";curve.color="#7ad7ff";
  curve.props.degree="1";curve.props.exprX="cos(t)";curve.props.exprY="sin(t)";curve.props.exprZ="t/3";
  curve.props.tMin="0";curve.props.tMax="18.85";curve.props.res="300";
  // a marker point at parameter s (index mode, single point at the current s)
  const mark=makeNode("points",{x:360,y:340});mark.label="marker";mark.color="#ffcf6e";
  mark.props.kind="points";mark.props.mode="index";
  mark.props.idxPoint="cos(s), sin(s), s/3";mark.props.idxCount="1";
  mark.props.drawLines=false;mark.props.radius="0.13";mark.attachments=[s.id];
  const cam3=cam;cam3.attachments=[curve.id,mark.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[curve.id]:curve,[mark.id]:mark,[s.id]:s},camId:cam.id,animated:true};
}

// ── Tangent spaces and the tangent bundle ──

// A tangent LINE to a plane curve: the parabola y=x² with its tangent at a point
// you drag. The tangent is the best straight-line approximation at that point.
function tutTangentLineScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="tangent line at x = a";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3";cam.props.planeOy="2";
  const a=makeNode("slider",{x:20,y:340});a.name="a";a.label="a · contact point";a.value=0.8;
  a.props.min="-2";a.props.max="2";a.props.step="0.01";
  // the parabola
  const fn=makeNode("fnMap",{x:360,y:120});fn.label="y = x²";fn.color="#7ad7ff";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="x^2";
  const tr=makeNode("transformer",{x:700,y:120});tr.label="curve";tr.color="#7ad7ff";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="y";tr.props.aMin="-2.4";tr.props.aMax="2.4";tr.props.res="200";
  tr.attachments=[fn.id];
  // tangent line through (a, a²) with slope 2a: a 2-point segment over i=0..1
  // x = a-1 + 2i, y = a² + 2a(x-a). At i=0: x=a-1; at i=1: x=a+1.
  const tan=makeNode("points",{x:360,y:300});tan.label="tangent";tan.color="#ffcf6e";
  tan.props.kind="points";tan.props.mode="index";
  tan.props.idxPoint="a - 1 + 2*i, a*a + 2*a*((a-1+2*i) - a), 0";tan.props.idxCount="2";
  tan.props.drawLines=true;tan.props.radius="0";tan.attachments=[a.id];
  // the point of tangency
  const pt=makeNode("points",{x:360,y:440});pt.label="contact";pt.color="#ff5ea8";
  pt.props.kind="points";pt.props.mode="index";pt.props.idxPoint="a, a*a, 0";pt.props.idxCount="1";
  pt.props.drawLines=false;pt.props.radius="5";pt.attachments=[a.id];
  cam.attachments=[tr.id,tan.id,pt.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[a.id]:a,[fn.id]:fn,[tr.id]:tr,[tan.id]:tan,[pt.id]:pt},camId:cam.id,animated:false};
}

// A tangent PLANE on a surface: the saddle z=x²−y² with its tangent plane at a
// point you drag. The plane touches at one point and is the linear approximation.
function tutTangentPlaneScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="tangent plane on a saddle";cam.props.showOpenBtn=false;
  cam.props.orbRadius="6.5";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="38";
  const a=makeNode("slider",{x:20,y:320});a.name="a";a.label="a · base x";a.value=0.7;
  a.props.min="-1.3";a.props.max="1.3";a.props.step="0.01";
  const b=makeNode("slider",{x:20,y:400});b.name="b";b.label="b · base y";b.value=0.5;
  b.props.min="-1.3";b.props.max="1.3";b.props.step="0.01";
  // the saddle surface z = x² − y²
  const surf=makeNode("paramsurf",{x:520,y:120});surf.label="z = x²−y²";surf.color="#9b8cff";
  surf.props.exprX="u";surf.props.exprY="v";surf.props.exprZ="u*u - v*v";
  surf.props.uMin="-1.5";surf.props.uMax="1.5";surf.props.vMin="-1.5";surf.props.vMax="1.5";
  surf.props.uRes="40";surf.props.vRes="40";
  // tangent plane at (a,b): z = a²−b² + 2a(x−a) − 2b(y−b). Parameterize a small
  // patch in (u,v) around the base point, u,v ∈ [-0.6,0.6].
  const plane=makeNode("paramsurf",{x:520,y:320});plane.label="tangent plane";plane.color="#ffcf6e";
  plane.props.exprX="a + u";plane.props.exprY="b + v";
  plane.props.exprZ="(a*a - b*b) + 2*a*u - 2*b*v";
  plane.props.uMin="-0.6";plane.props.uMax="0.6";plane.props.vMin="-0.6";plane.props.vMax="0.6";
  plane.props.uRes="2";plane.props.vRes="2";plane.attachments=[a.id,b.id];
  const pt=makeNode("points",{x:520,y:460});pt.label="contact";pt.color="#ff5ea8";
  pt.props.kind="points";pt.props.mode="index";pt.props.idxPoint="a, b, a*a - b*b";pt.props.idxCount="1";
  pt.props.drawLines=false;pt.props.radius="0.07";pt.attachments=[a.id,b.id];
  cam.attachments=[surf.id,plane.id,pt.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[a.id]:a,[b.id]:b,[surf.id]:surf,[plane.id]:plane,[pt.id]:pt},camId:cam.id,animated:true};
}

// The tangent BUNDLE of a circle, drawn as the family of tangent LINES. At angle
// θ the fiber is the full tangent line base + L·(tangent direction); sweeping θ
// over the circle and L over the fiber sweeps a sheet that fills the exterior.
// Rendered as a wireframe surface viewed top-down: each constant-θ line is one
// tangent line, and they crowd (brighten) near the circle and thin out beyond it.
function tutTangentBundleScene(){
  const project=makeProjectNode("preview");
  // a 3D camera looking straight down gives a clean 2D view while letting the
  // wireframe surface (the line family) render.
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="the tangent bundle fills the exterior";cam.props.showOpenBtn=false;
  cam.props.orbRadius="7.2";cam.props.orbTheta="0";cam.props.orbPhi="0.04";cam.props.spin="off";
  cam.props.showAxes=false;cam.props.showGrid=false;
  // map (u=θ, v=L) → planar point P = base(θ) + L·tangent(θ), z=0
  //   base = (cosθ, sinθ),  tangent = (−sinθ, cosθ)
  // A paramsurf lets us set uRes high (many tangent lines) and vRes=2 (just the
  // two fiber endpoints). With only 2 rows there are no interior constant-L rings
  // to chord across the circle; the only cross-lines are the two far outer edges,
  // and every constant-θ isoline is one tangent line, staying outside (r=√(1+L²)).
  const surf=makeNode("paramsurf",{x:520,y:160});surf.label="tangent lines";surf.color="#ffb454";
  surf.props.exprX="cos(u) - v*sin(u)";
  surf.props.exprY="sin(u) + v*cos(u)";
  surf.props.exprZ="0";
  surf.props.uMin="0";surf.props.uMax="6.2832";surf.props.vMin="-2.6";surf.props.vMax="2.6";
  surf.props.uRes="360";surf.props.vRes="2";
  surf.props.showWire=true;surf.props.wireOnly=true;
  // the base circle itself, drawn bright on top
  const circle=makeNode("paramSpace",{x:340,y:340});circle.label="circle";circle.color="#7ad7ff";
  circle.props.degree="1";circle.props.exprX="cos(t)";circle.props.exprY="sin(t)";circle.props.exprZ="0";
  circle.props.tMin="0";circle.props.tMax="6.2832";circle.props.res="240";
  cam.attachments=[surf.id,circle.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[surf.id]:surf,[circle.id]:circle},camId:cam.id,animated:false};
}

// ── The Frenet frame ──

// The moving TNB frame: tangent, normal, binormal as three orthonormal arrows
// riding along a helix. Drag/animate s and the frame turns as the curve twists.
function tutFrenetScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="the Frenet frame (T, N, B)";cam.props.showOpenBtn=false;
  cam.props.orbRadius="7";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  const s=makeNode("animator",{x:40,y:340});s.name="s";s.value=0;
  s.props.min="0";s.props.max="18.85";s.props.period="13";s.props.loop="loop";s.playing=true;
  // helix r(t)=(cos t, sin t, t/3)
  const curve=makeNode("paramSpace",{x:300,y:80});curve.label="helix";curve.color="#7ad7ff";
  curve.props.degree="1";curve.props.exprX="cos(t)";curve.props.exprY="sin(t)";curve.props.exprZ="t/3";
  curve.props.tMin="0";curve.props.tMax="18.85";curve.props.res="320";
  // c=1/3, |r'|=sqrt(1+1/9)=sqrt(10)/3≈1.0541. T=(-sin,cos,1/3)/|r'|.
  // N=(-cos,-sin,0). B=T×N. Base point P=(cos s, sin s, s/3). Arrow length L=0.7.
  const P="cos(s), sin(s), s/3";
  const L=0.7, sp=Math.sqrt(1+1/9); // |r'|
  // T components
  const Tx=`(-sin(s))/${sp}`, Ty=`(cos(s))/${sp}`, Tz=`(1/3)/${sp}`;
  // N components
  const Nx="(-cos(s))", Ny="(-sin(s))", Nz="0";
  // B = T × N
  const Bx=`((${Ty})*(${Nz}) - (${Tz})*(${Ny}))`;
  const By=`((${Tz})*(${Nx}) - (${Tx})*(${Nz}))`;
  const Bz=`((${Tx})*(${Ny}) - (${Ty})*(${Nx}))`;
  const arrow=(name,col,vx,vy,vz)=>{
    const n=makeNode("points",{x:300,y:200});n.label=name;n.color=col;
    n.props.kind="points";n.props.mode="index";
    n.props.idxPoint=`cos(s) + i*${L}*(${vx}), sin(s) + i*${L}*(${vy}), s/3 + i*${L}*(${vz})`;
    n.props.idxCount="2";n.props.drawLines=true;n.props.radius="0";n.attachments=[s.id];
    return n;
  };
  const Tn=arrow("T",  "#ff5ea8", Tx,Ty,Tz);
  const Nn=arrow("N",  "#5be0c0", Nx,Ny,Nz);
  const Bn=arrow("B",  "#ffcf6e", Bx,By,Bz);
  const mark=makeNode("points",{x:300,y:440});mark.label="point";mark.color="#ffffff";
  mark.props.kind="points";mark.props.mode="index";mark.props.idxPoint=P;mark.props.idxCount="1";
  mark.props.drawLines=false;mark.props.radius="0.09";mark.attachments=[s.id];
  cam.attachments=[curve.id,Tn.id,Nn.id,Bn.id,mark.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[s.id]:s,[curve.id]:curve,[Tn.id]:Tn,[Nn.id]:Nn,[Bn.id]:Bn,[mark.id]:mark},camId:cam.id,animated:true};
}

// Companion to the Frenet scene: a curve whose curvature and torsion VARY, so the
// frame visibly speeds up and slows down as it rides along — the helix's frame
// rotates steadily, but on this weave r(s)=(cos s, sin s, 0.6·sin 3s) the bending
// and twisting change with position. The frame is built from dependency functions
// (D1*, D2* for derivatives; T*, N*, B* for the orthonormal vectors).
function tutFrenetMeasureScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1180,y:120}));cam.label="curvature and torsion vary along the curve";cam.props.showOpenBtn=false;
  cam.props.orbRadius="6.5";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  const scene={[project.id]:project,[cam.id]:cam};
  const s=makeNode("animator",{x:-40,y:360});s.name="s";s.value=0;
  s.props.min="0";s.props.max="6.2832";s.props.period="16";s.props.loop="loop";s.playing=true;scene[s.id]=s;
  // the weave curve
  const curve=makeNode("paramSpace",{x:300,y:60});curve.label="weave";curve.color="#7ad7ff";
  curve.props.degree="1";curve.props.exprX="cos(t)";curve.props.exprY="sin(t)";curve.props.exprZ="0.6*sin(3*t)";
  curve.props.tMin="0";curve.props.tMax="6.2832";curve.props.res="400";scene[curve.id]=curve;
  // helper functions: first and second derivatives. Each fnDef attaches to the
  // other fnDefs it references (by name), so resolveScope threads the chain.
  const fns=[]; const byName={};
  const fn=(name,expr,x,y,deps=[])=>{ const nd=makeNode("fnDef",{x,y});nd.name=name;nd.label=`${name}(s)`;nd.props.params="s";nd.props.expr=expr;
    nd.attachments=deps.map(d=>byName[d].id);
    scene[nd.id]=nd;fns.push(nd);byName[name]=nd;return nd; };
  fn("D1X","-sin(s)",60,180); fn("D1Y","cos(s)",60,250); fn("D1Z","1.8*cos(3*s)",60,320);
  fn("D2X","-cos(s)",60,390); fn("D2Y","-sin(s)",60,460); fn("D2Z","-5.4*sin(3*s)",60,530);
  fn("SP","sqrt(D1X(s)^2 + D1Y(s)^2 + D1Z(s)^2)",340,200,["D1X","D1Y","D1Z"]);
  // T = r'/|r'|
  fn("TX","D1X(s)/SP(s)",340,300,["D1X","SP"]); fn("TY","D1Y(s)/SP(s)",340,360,["D1Y","SP"]); fn("TZ","D1Z(s)/SP(s)",340,420,["D1Z","SP"]);
  // N direction = d2 - (d2·T)T, normalized
  fn("DOT","D2X(s)*TX(s) + D2Y(s)*TY(s) + D2Z(s)*TZ(s)",620,200,["D2X","D2Y","D2Z","TX","TY","TZ"]);
  fn("NRX","D2X(s) - DOT(s)*TX(s)",620,270,["D2X","DOT","TX"]); fn("NRY","D2Y(s) - DOT(s)*TY(s)",620,330,["D2Y","DOT","TY"]); fn("NRZ","D2Z(s) - DOT(s)*TZ(s)",620,390,["D2Z","DOT","TZ"]);
  fn("NL","sqrt(NRX(s)^2 + NRY(s)^2 + NRZ(s)^2)",620,460,["NRX","NRY","NRZ"]);
  fn("NX","NRX(s)/NL(s)",900,200,["NRX","NL"]); fn("NY","NRY(s)/NL(s)",900,260,["NRY","NL"]); fn("NZ","NRZ(s)/NL(s)",900,320,["NRZ","NL"]);
  // B = T × N
  fn("BX","TY(s)*NZ(s) - TZ(s)*NY(s)",900,400,["TY","TZ","NY","NZ"]); fn("BY","TZ(s)*NX(s) - TX(s)*NZ(s)",900,460,["TZ","TX","NX","NZ"]); fn("BZ","TX(s)*NY(s) - TY(s)*NX(s)",900,520,["TX","TY","NX","NY"]);
  const allFns=fns.map(f=>f.id);
  const L=0.7;
  const arrow=(name,col,fx,fy,fz,y)=>{
    const n=makeNode("points",{x:1180,y});n.label=name;n.color=col;
    n.props.kind="points";n.props.mode="index";
    n.props.idxPoint=`cos(s) + i*${L}*${fx}(s), sin(s) + i*${L}*${fy}(s), 0.6*sin(3*s) + i*${L}*${fz}(s)`;
    n.props.idxCount="2";n.props.drawLines=true;n.props.radius="0";n.attachments=[s.id,...allFns];
    scene[n.id]=n; return n;
  };
  const Tn=arrow("T","#ff5ea8","TX","TY","TZ",300);
  const Nn=arrow("N","#5be0c0","NX","NY","NZ",380);
  const Bn=arrow("B","#ffcf6e","BX","BY","BZ",460);
  const mark=makeNode("points",{x:1180,y:540});mark.label="point";mark.color="#ffffff";
  mark.props.kind="points";mark.props.mode="index";mark.props.idxPoint="cos(s), sin(s), 0.6*sin(3*s)";mark.props.idxCount="1";
  mark.props.drawLines=false;mark.props.radius="0.09";mark.attachments=[s.id];scene[mark.id]=mark;
  cam.attachments=[curve.id,Tn.id,Nn.id,Bn.id,mark.id];
  return {scene,camId:cam.id,animated:true};
}

// ── Geodesics ──

// A geodesic on the sphere is a great circle. Show it as the straightest path
// between two MARKED points: a faint globe, endpoints A and B, the great-circle
// arc joining them, and a marker that travels the arc so it reads as a path.
function tutGeodesicSphereScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="the straightest path from A to B";cam.props.showOpenBtn=false;
  cam.props.orbRadius="4.2";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="44";
  // a faint, coarse wireframe globe so the arc reads clearly on top of it
  const fn=makeNode("fnMap",{x:300,y:60});fn.label="unit sphere";fn.color="#3d6fb4";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="1";
  const tr=makeNode("transformer",{x:620,y:60});tr.label="globe";tr.color="#3d6fb4";
  tr.props.mode="spherical";tr.props.aMin="0";tr.props.aMax="6.2832";tr.props.bMin="0";tr.props.bMax="3.14159";
  tr.props.res="18";tr.props.showWire=true;
  // two endpoints on the sphere. A and B are unit vectors; the geodesic is the
  // great-circle arc between them, drawn via slerp over s∈[0,1].
  const A=[Math.cos(0.5)*Math.cos(-1.1), Math.cos(0.5)*Math.sin(-1.1), Math.sin(0.5)];
  const B=[Math.cos(0.95)*Math.cos(1.2), Math.cos(0.95)*Math.sin(1.2), Math.sin(0.95)];
  const dot=A[0]*B[0]+A[1]*B[1]+A[2]*B[2], Om=Math.acos(Math.max(-1,Math.min(1,dot))), sOm=Math.sin(Om);
  const w0=`sin((1-t)*${Om})/${sOm}`, w1=`sin(t*${Om})/${sOm}`;
  const arc=makeNode("paramSpace",{x:300,y:240});arc.label="geodesic arc";arc.color="#ffcf6e";
  arc.props.degree="1";
  arc.props.exprX=`${w0}*(${A[0]}) + ${w1}*(${B[0]})`;
  arc.props.exprY=`${w0}*(${A[1]}) + ${w1}*(${B[1]})`;
  arc.props.exprZ=`${w0}*(${A[2]}) + ${w1}*(${B[2]})`;
  arc.props.tMin="0";arc.props.tMax="1";arc.props.res="200";
  // endpoint dots A and B
  const ends=makeNode("points",{x:300,y:380});ends.label="A, B";ends.color="#ff5ea8";
  ends.props.kind="points";ends.props.mode="index";
  ends.props.idxPoint=`(i<0.5)*(${A[0]}) + (i>0.5)*(${B[0]}), (i<0.5)*(${A[1]}) + (i>0.5)*(${B[1]}), (i<0.5)*(${A[2]}) + (i>0.5)*(${B[2]})`;
  ends.props.idxCount="2";ends.props.drawLines=false;ends.props.radius="0.08";
  // a marker that travels the geodesic
  const s=makeNode("animator",{x:40,y:470});s.name="s";s.value=0;
  s.props.min="0";s.props.max="1";s.props.period="6";s.props.loop="bounce";s.playing=true;
  const ws0=`sin((1-s)*${Om})/${sOm}`, ws1=`sin(s*${Om})/${sOm}`;
  const mover=makeNode("points",{x:300,y:520});mover.label="traveler";mover.color="#ffffff";
  mover.props.kind="points";mover.props.mode="index";
  mover.props.idxPoint=`${ws0}*(${A[0]}) + ${ws1}*(${B[0]}), ${ws0}*(${A[1]}) + ${ws1}*(${B[1]}), ${ws0}*(${A[2]}) + ${ws1}*(${B[2]})`;
  mover.props.idxCount="1";mover.props.drawLines=false;mover.props.radius="0.06";mover.attachments=[s.id];
  cam.attachments=[tr.id,arc.id,ends.id,mover.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr,[arc.id]:arc,[ends.id]:ends,[mover.id]:mover,[s.id]:s},camId:cam.id,animated:true};
}

// Geodesic vs the obvious route: between two points at the SAME latitude, the
// constant-latitude path (pink) looks natural but is longer than the great-circle
// arc (green), which bows toward the pole. Same two endpoints, two routes.
function tutGeodesicCompareScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="great circle (green) beats latitude (pink)";cam.props.showOpenBtn=false;
  cam.props.orbRadius="4.0";cam.props.orbTheta="0.5";cam.props.orbPhi="0.95";cam.props.spin="loop";cam.props.spinPeriod="44";
  const fn=makeNode("fnMap",{x:300,y:60});fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="1";
  const tr=makeNode("transformer",{x:620,y:60});tr.label="globe";tr.color="#3d6fb4";
  tr.props.mode="spherical";tr.props.aMin="0";tr.props.aMax="6.2832";tr.props.bMin="0";tr.props.bMax="3.14159";
  tr.props.res="18";tr.props.showWire=true;
  // two points at latitude 0.7 (above the equator), longitudes ±1.2. The latitude
  // path holds z constant; the great-circle arc between the same points is shorter.
  const lat0=0.7, lon=1.2, c=Math.cos(lat0), z=Math.sin(lat0);
  const lat=makeNode("paramSpace",{x:300,y:220});lat.label="latitude path";lat.color="#ff5ea8";
  lat.props.degree="1";
  lat.props.exprX=`${c}*cos(t)`;lat.props.exprY=`${c}*sin(t)`;lat.props.exprZ=`${z}`;
  lat.props.tMin=`${-lon}`;lat.props.tMax=`${lon}`;lat.props.res="160";
  // great-circle arc between the same endpoints A (t=-lon) and B (t=+lon)
  const A=[c*Math.cos(-lon), c*Math.sin(-lon), z], B=[c*Math.cos(lon), c*Math.sin(lon), z];
  const dot=A[0]*B[0]+A[1]*B[1]+A[2]*B[2], Om=Math.acos(Math.max(-1,Math.min(1,dot))), sOm=Math.sin(Om);
  const w0=`sin((1-t)*${Om})/${sOm}`, w1=`sin(t*${Om})/${sOm}`;
  const gc=makeNode("paramSpace",{x:300,y:360});gc.label="great-circle path";gc.color="#a6e3a1";
  gc.props.degree="1";
  gc.props.exprX=`${w0}*(${A[0]}) + ${w1}*(${B[0]})`;
  gc.props.exprY=`${w0}*(${A[1]}) + ${w1}*(${B[1]})`;
  gc.props.exprZ=`${w0}*(${A[2]}) + ${w1}*(${B[2]})`;
  gc.props.tMin="0";gc.props.tMax="1";gc.props.res="200";
  // the shared endpoints
  const ends=makeNode("points",{x:300,y:500});ends.label="A, B";ends.color="#ffcf6e";
  ends.props.kind="points";ends.props.mode="index";
  ends.props.idxPoint=`(i<0.5)*(${A[0]}) + (i>0.5)*(${B[0]}), (i<0.5)*(${A[1]}) + (i>0.5)*(${B[1]}), (i<0.5)*(${A[2]}) + (i>0.5)*(${B[2]})`;
  ends.props.idxCount="2";ends.props.drawLines=false;ends.props.radius="0.08";
  cam.attachments=[tr.id,lat.id,gc.id,ends.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr,[lat.id]:lat,[gc.id]:gc,[ends.id]:ends},camId:cam.id,animated:true};
}

// ── Gaussian curvature and point types ──

// Color a surface by the SIGN of its Gaussian curvature: a torus has positive
// curvature on the outer rim (dome-like), negative on the inner (saddle-like),
// and zero on the top and bottom circles. The classic gallery of point types.
function tutGaussCurvatureScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="Gaussian curvature on a torus";cam.props.showOpenBtn=false;
  cam.props.orbRadius="7.5";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="34";
  // torus (R=1.6, r=0.6). Gaussian curvature K = cos v / (r (R + r cos v)).
  // Its SIGN is the sign of cos v: positive on the outside (|v|<π/2), negative
  // inside. Color by cos(v) to show the sign directly.
  const surf=makeNode("paramsurf",{x:520,y:160});surf.label="torus";surf.color="#9b8cff";
  surf.props.exprX="(1.6 + 0.6*cos(v))*cos(u)";
  surf.props.exprY="(1.6 + 0.6*cos(v))*sin(u)";
  surf.props.exprZ="0.6*sin(v)";
  surf.props.uMin="0";surf.props.uMax="6.2832";surf.props.vMin="0";surf.props.vMax="6.2832";
  surf.props.uRes="120";surf.props.vRes="60";
  surf.props.colorMode="gradient";surf.props.colorExpr="cos(v)";surf.props.colorLo="#ff5ea8";surf.props.colorHi="#5ad1e6";
  surf.props.colorMin="-1";surf.props.colorMax="1";
  cam.attachments=[surf.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[surf.id]:surf},camId:cam.id,animated:true};
}

// The three point types side by side via one slider: z = x² + k·y². k>0 elliptic
// (bowl, K>0), k=0 parabolic (trough, K=0), k<0 hyperbolic (saddle, K<0). Drag k
// through zero to pass between the three local shapes a surface can have.
function tutPointTypesScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="elliptic ↔ parabolic ↔ hyperbolic";cam.props.showOpenBtn=false;
  cam.props.orbRadius="7.5";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="40";
  const k=makeNode("slider",{x:20,y:340});k.name="k";k.label="k · second curvature";k.value=1;
  k.props.min="-1.5";k.props.max="1.5";k.props.step="0.01";
  const surf=makeNode("paramsurf",{x:520,y:160});surf.label="z = x² + k·y²";surf.color="#9b8cff";
  surf.props.exprX="u";surf.props.exprY="v";surf.props.exprZ="u*u + k*v*v";
  surf.props.uMin="-1.15";surf.props.uMax="1.15";surf.props.vMin="-1.15";surf.props.vMax="1.15";
  surf.props.uRes="48";surf.props.vRes="48";surf.props.colorMode="normal";surf.attachments=[k.id];
  cam.attachments=[surf.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[k.id]:k,[surf.id]:surf},camId:cam.id,animated:true};
}

// The editor: point sets and sequences ───────────────────────────────────────

// Step 1: a handful of literal points.
function tutPointsListScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="a list of points";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="2.6";
  const pts=makeNode("points",{x:620,y:160});pts.label="points";pts.color="#a6e3a1";
  pts.props.kind="points";pts.props.mode="list";
  pts.props.listPoints="-2, -1\n-1, 1\n0, -0.5\n1, 1.5\n2, 0";
  pts.props.drawLines=true;pts.props.radius="6";
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[pts.id]:pts},camId:cam.id,animated:false};
}
// Step 2: a formula over an index i generates many points (a spiral).
function tutPointsIndexScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="drag the angle";cam.props.showOpenBtn=false;
  cam.props.orbRadius="11";cam.props.orbTheta="0.9";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="40";
  const g=makeNode("slider",{x:20,y:340});g.name="g";g.label="g · divergence angle";g.value=2.399963;
  g.props.min="2.3";g.props.max="2.5";g.props.step="0.0005";
  const pts=makeNode("points",{x:620,y:160});pts.label="phyllotaxis";pts.color="#9b8cff";
  pts.props.kind="points";pts.props.mode="index";
  pts.props.idxPoint="2.6*sqrt(i/360)*cos(i*g), 2.6*sqrt(i/360)*sin(i*g), (i/360)*2 - 1";
  pts.props.idxCount="360";pts.props.drawLines=false;pts.props.radius="0.06";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#1b3a8f";pts.props.colorHi="#ffb454";
  pts.attachments=[g.id];
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[g.id]:g,[pts.id]:pts},camId:cam.id,animated:false};
}
// Step 3: a recurrence — each point from the previous (a converging spiral).
function tutPointsRecursiveScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="drag decay & turn";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="5";
  const d=makeNode("slider",{x:20,y:320});d.name="d";d.label="d · decay";d.value=0.96;
  d.props.min="0.85";d.props.max="1.0";d.props.step="0.002";
  const w=makeNode("slider",{x:20,y:400});w.name="w";w.label="w · turn per step";w.value=0.4;
  w.props.min="0.1";w.props.max="1.2";w.props.step="0.01";
  const pts=makeNode("points",{x:620,y:160});pts.label="orbit";pts.color="#7ad7ff";
  pts.props.kind="points";pts.props.mode="recursive";
  pts.props.recInit="3, 0";
  pts.props.recStep="d*(x[n-1]*cos(w) - y[n-1]*sin(w)), d*(x[n-1]*sin(w) + y[n-1]*cos(w))";
  pts.props.recCount="120";pts.props.drawLines=true;pts.props.radius="3.5";
  pts.attachments=[d.id,w.id];
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[d.id]:d,[w.id]:w,[pts.id]:pts},camId:cam.id,animated:false};
}

// Algebraic geometry: combining surfaces ─────────────────────────────────────

// Step 1: union — product of two equations is zero where EITHER is. A slider d
// pulls the two spheres apart so the reader can watch them merge and separate.
function tutCombineUnionScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="union: drag the spheres apart";cam.props.showOpenBtn=false;
  cam.props.orbRadius="7";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="40";
  const d=makeNode("slider",{x:40,y:320});d.name="d";d.label="d · separation";d.value=1.3;
  d.props.min="0";d.props.max="2.4";d.props.step="0.02";
  const eq=makeNode("equation",{x:360,y:160});eq.label="two spheres";eq.color="#9b8cff";
  eq.props.dims="3d";eq.props.lhs="((x+d/2)^2+y^2+z^2-1) * ((x-d/2)^2+y^2+z^2-1)";eq.props.rhs="0";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";eq.attachments=[d.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="surface";tr.color="#9b8cff";
  tr.props.mode="graph";tr.props.aMin="-2.6";tr.props.aMax="2.6";tr.props.bMin="-2.6";tr.props.bMax="2.6";tr.props.cMin="-2.6";tr.props.cMax="2.6";
  tr.props.res="150";tr.props.colorMode="depth";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[d.id]:d,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step 2: a richer union — a product of three orthogonal cylinders.
function tutCombineProductScene(){
  return _implicitScene("product of 3 cylinders","(x^2+y^2-0.6) * (y^2+z^2-0.6) * (z^2+x^2-0.6)","0",2.0,"normal",6.5);
}
// Step 3: intersection — max(F,G) ≤ 0 boundary; surface where the larger crosses 0.
function tutCombineIntersectScene(){
  return _implicitScene("intersection (sphere ∩ cube-ish)","max(x^2+y^2+z^2-1.4, max(abs(x), max(abs(y),abs(z)))-1.0)","0",1.8,"normal",5.5);
}

// Applications: iteration and dynamical systems ──────────────────────────────

// Step 1: the logistic map orbit, plotted as (n, x_n) — period doubling visible.
function tutOrbitLogisticScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="logistic orbit";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3.4";cam.props.planeOx="2.8";cam.props.planeOy="0.5";
  const pts=makeNode("points",{x:620,y:160});pts.label="xₙ₊₁ = r·xₙ(1−xₙ)";pts.color="#ffcf6e";
  pts.props.kind="points";pts.props.mode="recursive";
  // plot (n scaled into view, x_n); r = 3.6 sits in the chaotic regime
  pts.props.recInit="0, 0.2";
  pts.props.recStep="x[n-1] + 0.06, 3.6*y[n-1]*(1 - y[n-1])";
  pts.props.recCount="100";pts.props.drawLines=false;pts.props.radius="3";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#5b9cf6";pts.props.colorHi="#ff5ea8";
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[pts.id]:pts},camId:cam.id,animated:false};
}
// Step 2: a 2D attractor traced by iteration (a Clifford-style attractor).
function tutOrbitAttractorScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="a strange attractor";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="4";
  // animate the number of plotted iterations so the attractor fills in over time
  const n=makeNode("animator",{x:40,y:340});n.name="N";n.value=80;
  n.props.min="80";n.props.max="1500";n.props.period="9";n.props.loop="loop";n.playing=true;
  const pts=makeNode("points",{x:620,y:160});pts.label="iterated map";pts.color="#c4b5fd";
  pts.props.kind="points";pts.props.mode="recursive";
  pts.props.recInit="0.1, 0.1";
  pts.props.recStep="sin(-1.4*y[n-1]) + 1.6*cos(-1.4*x[n-1]), sin(1.6*x[n-1]) + 0.7*cos(1.6*y[n-1])";
  pts.props.recCount="N";pts.props.drawLines=false;pts.props.radius="1.6";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#5ad1e6";pts.props.colorHi="#9b8cff";
  pts.attachments=[n.id];
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[n.id]:n,[pts.id]:pts},camId:cam.id,animated:true};
}

// An orbit that settles to a fixed point: the discrete analogue of a stable
// equilibrium. Logistic at r=2.8 spirals into 1−1/r and stays.
function tutOrbitConvergeScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="settling to a fixed point";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3.2";cam.props.planeOx="2.6";cam.props.planeOy="0.5";
  const pts=makeNode("points",{x:620,y:160});pts.label="r = 2.8";pts.color="#5ad1e6";
  pts.props.kind="points";pts.props.mode="recursive";
  pts.props.recInit="0, 0.08";
  pts.props.recStep="x[n-1] + 0.09, 2.8*y[n-1]*(1 - y[n-1])";
  pts.props.recCount="60";pts.props.drawLines=true;pts.props.radius="2.6";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#5b9cf6";pts.props.colorHi="#5ad1e6";
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[pts.id]:pts},camId:cam.id,animated:false};
}

// Sensitive dependence: two logistic orbits (r=3.9) starting 0.0005 apart, drawn
// together. They track for a while then diverge completely — the butterfly effect.
function tutSensitiveScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="sensitive dependence";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3.4";cam.props.planeOx="2.8";cam.props.planeOy="0.5";
  const a=makeNode("points",{x:620,y:120});a.label="x₀ = 0.300";a.color="#5ad1e6";
  a.props.kind="points";a.props.mode="recursive";
  a.props.recInit="0, 0.300";
  a.props.recStep="x[n-1] + 0.06, 3.9*y[n-1]*(1 - y[n-1])";
  a.props.recCount="100";a.props.drawLines=true;a.props.radius="2.2";
  const b=makeNode("points",{x:620,y:300});b.label="x₀ = 0.3005";b.color="#ff5ea8";
  b.props.kind="points";b.props.mode="recursive";
  b.props.recInit="0, 0.3005";
  b.props.recStep="x[n-1] + 0.06, 3.9*y[n-1]*(1 - y[n-1])";
  b.props.recCount="100";b.props.drawLines=true;b.props.radius="2.2";
  cam.attachments=[a.id,b.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[a.id]:a,[b.id]:b},camId:cam.id,animated:false};
}

// The Hénon map: the other canonical strange attractor, x'=1−a·x²+y, y'=b·x.
// Its banded, folded curve is a textbook fractal. Fills in over time.
function tutHenonScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="the Hénon attractor";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="1.6";cam.props.planeOy="0";
  const n=makeNode("animator",{x:40,y:340});n.name="N";n.value=120;
  n.props.min="120";n.props.max="3000";n.props.period="10";n.props.loop="loop";n.playing=true;
  const pts=makeNode("points",{x:620,y:160});pts.label="a = 1.4, b = 0.3";pts.color="#ffcf6e";
  pts.props.kind="points";pts.props.mode="recursive";
  pts.props.recInit="0, 0";
  pts.props.recStep="1 - 1.4*x[n-1]*x[n-1] + y[n-1], 0.3*x[n-1]";
  pts.props.recCount="N";pts.props.drawLines=false;pts.props.radius="1.4";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#ffcf6e";pts.props.colorHi="#ff5ea8";
  pts.attachments=[n.id];
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[n.id]:n,[pts.id]:pts},camId:cam.id,animated:true};
}

// The Gingerbreadman map: x'=1−y+|x|, y'=x. A piecewise-linear rule whose orbit
// tiles the plane into a polygonal, kaleidoscopic region — chaos without a curve.
function tutGingerbreadScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="the Gingerbreadman map";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="6";cam.props.planeOx="2.3";cam.props.planeOy="2.3";
  const n=makeNode("animator",{x:40,y:340});n.name="N";n.value=200;
  n.props.min="200";n.props.max="4000";n.props.period="11";n.props.loop="loop";n.playing=true;
  const pts=makeNode("points",{x:620,y:160});pts.label="x' = 1 − y + |x|, y' = x";pts.color="#9b8cff";
  pts.props.kind="points";pts.props.mode="recursive";
  pts.props.recInit="-0.1, 0";
  pts.props.recStep="1 - y[n-1] + abs(x[n-1]), x[n-1]";
  pts.props.recCount="N";pts.props.drawLines=false;pts.props.radius="1.3";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#5ad1e6";pts.props.colorHi="#9b8cff";
  pts.attachments=[n.id];
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[n.id]:n,[pts.id]:pts},camId:cam.id,animated:true};
}

// Algebraic geometry: singular points and nodes ──────────────────────────────

// helper: a 3D implicit surface scene with a chosen coloring
function _implicitScene(label, lhs, rhs, box, colorMode, orbRadius){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label=label;cam.props.showOpenBtn=false;
  cam.props.orbRadius=String(orbRadius);cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  cam.props.spin="loop";cam.props.spinPeriod="34";
  const eq=makeNode("equation",{x:360,y:160});eq.label=label;eq.color="#9b8cff";
  eq.props.dims="3d";eq.props.lhs=lhs;eq.props.rhs=rhs;eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="surface";tr.color="#9b8cff";
  tr.props.mode="graph";
  tr.props.aMin=String(-box);tr.props.aMax=String(box);tr.props.bMin=String(-box);tr.props.bMax=String(box);
  tr.props.cMin=String(-box);tr.props.cMax=String(box);tr.props.res="150";tr.props.colorMode=colorMode;
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:true};
}
// Step 1: a smooth cubic surface (no singular points).
function tutCubicSmoothScene(){
  return _implicitScene("smooth cubic","x^3 + y^3 + z^3 + 1 - 0.5*(x+y+z)","3*x*y*z",2.0,"normal",6.5);
}
// Step 2: a nodal cubic — the Cayley cubic, which has four ordinary double points.
function tutCubicNodalScene(){
  return _implicitScene("Cayley cubic (4 nodes)","-5*(x^2*(y+z) + y^2*(x+z) + z^2*(x+y)) + 2*(x*y+y*z+z*x)","-1",1.7,"normal",5.0);
}
// Step 3: the same nodal cubic, gradient-colored so the singular points light up.
function tutNodeGradientScene(){
  return _implicitScene("nodes light up","-5*(x^2*(y+z) + y^2*(x+z) + z^2*(x+y)) + 2*(x*y+y*z+z*x)","-1",1.7,"gradient",5.0);
}

// Analytic geometry: transcendental level sets ───────────────────────────────

// Step 1: an algebraic curve — a polynomial level set in the plane.
function tutPolyCurveScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="x³ − x = y  (algebraic)";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3.5";
  const eq=makeNode("equation",{x:360,y:160});eq.label="cubic curve";eq.color="#a6e3a1";
  eq.props.dims="2d";eq.props.lhs="x^3 - x";eq.props.rhs="y";eq.props.varA="x";eq.props.varB="y";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="curve";tr.color="#a6e3a1";
  tr.props.mode="graph";tr.props.aMin="-3";tr.props.aMax="3";tr.props.bMin="-3";tr.props.bMax="3";tr.props.res="200";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step 2: a transcendental curve no polynomial equation can produce.
function tutTranscendentalScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="y = eˣ·sin(3x)  (transcendental)";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="4";cam.props.planeOx="0";cam.props.planeOy="0";
  const eq=makeNode("equation",{x:360,y:160});eq.label="transcendental";eq.color="#9b8cff";
  eq.props.dims="2d";eq.props.lhs="exp(0.35*x)*sin(3*x)";eq.props.rhs="y";eq.props.varA="x";eq.props.varB="y";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="curve";tr.color="#9b8cff";
  tr.props.mode="graph";tr.props.aMin="-6";tr.props.aMax="3.5";tr.props.bMin="-5";tr.props.bMax="5";tr.props.res="400";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step 3: an analytic surface — a transcendental height field.
function tutAnalyticSurfaceScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="z = e^(−r²)·cos(...)";cam.props.showOpenBtn=false;
  cam.props.orbRadius="10";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="analytic f";fn.color="#7ad7ff";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="exp(-0.15*(x^2+y^2))*cos(2*sqrt(x^2+y^2))";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="graph";tr.color="#7ad7ff";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  tr.props.aMin="-5";tr.props.aMax="5";tr.props.bMin="-5";tr.props.bMax="5";tr.props.res="110";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}

// Differential geometry: curvature and normals ───────────────────────────────

// Step 1: a surface colored by normal direction — orientation made visible.
function tutNormalColorScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="colored by normal";cam.props.showOpenBtn=false;
  cam.props.orbRadius="6";cam.props.orbTheta="0.8";cam.props.orbPhi="0.95";cam.props.spin="loop";cam.props.spinPeriod="30";
  const eq=makeNode("equation",{x:360,y:160});eq.label="torus";eq.color="#c4b5fd";
  eq.props.dims="3d";eq.props.lhs="(sqrt(x^2+y^2) - 1.4)^2 + z^2";eq.props.rhs="0.36";
  eq.props.varA="x";eq.props.varB="y";eq.props.varC="z";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="surface";tr.color="#c4b5fd";
  tr.props.mode="graph";tr.props.aMin="-2.2";tr.props.aMax="2.2";tr.props.bMin="-2.2";tr.props.bMax="2.2";tr.props.cMin="-1";tr.props.cMax="1";
  tr.props.res="160";tr.props.colorMode="normal";
  tr.attachments=[eq.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[eq.id]:eq,[tr.id]:tr},camId:cam.id,animated:true};
}
// Step 2: a surface of revolution, built parametrically by spinning a profile.
function tutRevolutionScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="surface of revolution";cam.props.showOpenBtn=false;
  cam.props.orbRadius="9";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="32";
  const ps=makeNode("paramsurf",{x:520,y:160});ps.label="revolution";ps.color="#a6e3a1";
  // profile r(v) = 1 + 0.4 sin(3v) spun around the z-axis over u
  ps.props.exprX="(1.4 + 0.5*sin(3*v))*cos(u)";
  ps.props.exprY="(1.4 + 0.5*sin(3*v))*sin(u)";
  ps.props.exprZ="2*v";
  ps.props.uMin="0";ps.props.uMax="6.2832";ps.props.vMin="-1.5708";ps.props.vMax="1.5708";
  ps.props.uRes="60";ps.props.vRes="40";
  cam.attachments=[ps.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[ps.id]:ps},camId:cam.id,animated:false};
}

// Applications: vector fields and flow ───────────────────────────────────────

// Step 1: a 2D vector field (a spiral), drawn as arrows.
function tutVectorFieldScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="vector field";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3.3";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="V(x,y)";fn.color="#7ad7ff";
  fn.props.inDim="2";fn.props.outDim="2";fn.props.out0="-y + 0.25*x";fn.props.out1="x + 0.25*y";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="field";tr.color="#7ad7ff";
  tr.props.mode="field";tr.props.inAxis0="x";tr.props.inAxis1="y";
  tr.props.aMin="-3";tr.props.aMax="3";tr.props.bMin="-3";tr.props.bMax="3";tr.props.res="13";
  tr.props.normalize=true;tr.props.arrowLen="0.35";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step 2: integrate that field from seed points into streamlines.
function tutStreamlinesScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="streamlines";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="3.3";
  const field=makeNode("fnMap",{x:300,y:120});field.label="V(x,y)";field.props.inDim="2";field.props.outDim="2";
  field.props.out0="-y + 0.25*x";field.props.out1="x + 0.25*y";
  const seeds=makeNode("paramSpace",{x:300,y:320});seeds.label="seeds";seeds.props.degree="1";
  seeds.props.exprX="0.3 + 2.2*t";seeds.props.exprY="0.1";seeds.props.exprZ="0";seeds.props.tMin="0";seeds.props.tMax="1";seeds.props.res="24";
  // animate the trajectory length: the streamlines grow out from the seeds and
  // retrace, like particles released into the field. `g` drives the step count.
  const grow=makeNode("animator",{x:40,y:360});grow.name="g";grow.value=8;
  grow.props.min="8";grow.props.max="260";grow.props.period="6";grow.props.loop="bounce";grow.playing=true;
  const flow=makeNode("flow",{x:640,y:200});flow.label="flow";flow.color="#5be0c0";
  flow.props.steps="g";flow.props.stepSize="0.04";flow.props.output="surface";
  flow.props.gradient=true;flow.props.gradA="#5be0c0";flow.props.gradB="#5b9cf6";
  flow.attachments=[field.id,seeds.id,grow.id];cam.attachments=[flow.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[grow.id]:grow,[field.id]:field,[seeds.id]:seeds,[flow.id]:flow},camId:cam.id,animated:true};
}

// Tutorial: inputs and scope ─────────────────────────────────────────────────

// Step 1: a constant `a` feeds the amplitude of a curve y = a·sin(x).
function tutConstCurveScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="y = a·sin(x)";cam.props.showOpenBtn=false;
  cam.props.orbRadius="9";cam.props.orbTheta="0.0";cam.props.orbPhi="1.45";cam.props.showGrid=true;cam.props.showAxes=true;
  const c=makeNode("constant",{x:40,y:320});c.name="a";c.label="a = 1.5";c.props.value="1.5";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="a·sin(x)";fn.color="#a6e3a1";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="a*sin(x)";fn.attachments=[c.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="graph";tr.color="#a6e3a1";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="z";
  tr.props.aMin="-6.28";tr.props.aMax="6.28";tr.props.res="200";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[c.id]:c,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step 2: swap the constant for a slider — now the amplitude is draggable/live.
function tutSliderCurveScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="drag a";cam.props.showOpenBtn=false;
  cam.props.orbRadius="9";cam.props.orbTheta="0.0";cam.props.orbPhi="1.45";cam.props.showGrid=true;cam.props.showAxes=true;
  const a=makeNode("animator",{x:40,y:320});a.name="a";a.value=1;
  a.props.min="-2.5";a.props.max="2.5";a.props.period="8";a.props.loop="pingpong";a.playing=true;
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="a·sin(x)";fn.color="#9b8cff";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="a*sin(x)";fn.attachments=[a.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="graph";tr.color="#9b8cff";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="z";
  tr.props.aMin="-6.28";tr.props.aMax="6.28";tr.props.res="200";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[a.id]:a,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:true};
}
// Step 2b: an animator is a value that advances on its own. A travelling phase t
// inside sin(x − t) marches the wave sideways with no input from you — the
// difference from a slider is that time drives it, not your hand.
function tutAnimatorCurveScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="t advances on its own";cam.props.showOpenBtn=false;
  cam.props.orbRadius="9";cam.props.orbTheta="0.0";cam.props.orbPhi="1.45";cam.props.showGrid=true;cam.props.showAxes=true;
  const t=makeNode("animator",{x:40,y:320});t.name="t";t.value=0;
  t.props.min="0";t.props.max="6.2832";t.props.period="6";t.props.loop="loop";t.playing=true;
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="sin(x − t)";fn.color="#9b8cff";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="sin(x - t)";fn.attachments=[t.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="graph";tr.color="#9b8cff";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="z";
  tr.props.aMin="-6.28";tr.props.aMax="6.28";tr.props.res="200";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[t.id]:t,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:true};
}

function tutNamedScopeScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="k drives frequency";cam.props.showOpenBtn=false;
  cam.props.orbRadius="9";cam.props.orbTheta="0.0";cam.props.orbPhi="1.45";cam.props.showGrid=true;cam.props.showAxes=true;
  const k=makeNode("slider",{x:40,y:320});k.name="k";k.label="k · frequency";k.value=2;
  k.props.min="1";k.props.max="5";k.props.step="0.05";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="sin(k·x)";fn.color="#7ad7ff";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="sin(k*x)";fn.attachments=[k.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="graph";tr.color="#7ad7ff";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="z";
  tr.props.aMin="-6.28";tr.props.aMax="6.28";tr.props.res="240";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[k.id]:k,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}

// Tutorial: cameras and viewing ──────────────────────────────────────────────

// shared little surface for the camera tutorial
function _camSurface(project,scene){
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="ripple";fn.color="#c4b5fd";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="0.6*sin(2*sqrt(x^2+y^2))";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="graph";tr.color="#c4b5fd";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  tr.props.aMin="-3.2";tr.props.aMax="3.2";tr.props.bMin="-3.2";tr.props.bMax="3.2";tr.props.res="80";
  tr.attachments=[fn.id];scene[fn.id]=fn;scene[tr.id]=tr;
  return tr.id;
}
// Step 1: a 3D camera orbiting the ripple surface.
function tutCam3dScene(){
  const project=makeProjectNode("preview");const scene={[project.id]:project};
  const trId=_camSurface(project,scene);
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="3D camera";cam.props.showOpenBtn=false;
  cam.props.orbRadius="9";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  cam.props.spin="loop";cam.props.spinPeriod="30";cam.attachments=[trId];scene[cam.id]=cam;
  return {scene,camId:cam.id,animated:true};
}
// Step 2: a 2D camera on the XY plane projecting the same surface flat (a contour-
// like top-down view).
function tutCam2dScene(){
  const project=makeProjectNode("preview");const scene={[project.id]:project};
  const trId=_camSurface(project,scene);
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="2D camera (top-down)";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalX="0";cam.props.normalY="0";cam.props.normalZ="1";
  cam.props.planeOx="0";cam.props.planeOy="0";cam.props.planeOz="0";cam.props.orthoSize="3.6";
  cam.attachments=[trId];scene[cam.id]=cam;
  return {scene,camId:cam.id,animated:false};
}

// Tutorial: function graphs ──────────────────────────────────────────────────

// Step 1: a 1D function graph y = f(x).
function tutGraph1dScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="y = x·sin(x)";cam.props.showOpenBtn=false;
  cam.props.orbRadius="11";cam.props.orbTheta="0.0";cam.props.orbPhi="1.45";cam.props.showGrid=true;cam.props.showAxes=true;
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="f(x)";fn.color="#a6e3a1";
  fn.props.inDim="1";fn.props.outDim="1";fn.props.out0="x*sin(x)";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="graph";tr.color="#a6e3a1";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.outAxis0="z";
  tr.props.aMin="-9";tr.props.aMax="9";tr.props.res="240";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step 2: add a second input — z = f(x,y), a surface.
function tutGraph2dScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="z = f(x,y)";cam.props.showOpenBtn=false;
  cam.props.orbRadius="12";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="f(x,y)";fn.color="#9b8cff";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="sin(x)*cos(y)";
  const tr=makeNode("transformer",{x:700,y:160});tr.label="graph";tr.color="#9b8cff";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  tr.props.aMin="-3.14";tr.props.aMax="3.14";tr.props.bMin="-3.14";tr.props.bMax="3.14";tr.props.res="90";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:false};
}
// Step 3: animate a phase in the surface — a travelling wave.
function tutGraphAnimScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="travelling wave";cam.props.showOpenBtn=false;
  cam.props.orbRadius="12";cam.props.orbTheta="0.7";cam.props.orbPhi="1.0";
  const t=makeNode("animator",{x:40,y:320});t.name="t";t.value=0;
  t.props.min="0";t.props.max="6.2832";t.props.period="6";t.props.loop="loop";t.playing=true;
  const fn=makeNode("fnMap",{x:360,y:160});fn.label="f(x,y,t)";fn.color="#7ad7ff";
  fn.props.inDim="2";fn.props.outDim="1";fn.props.out0="0.7*sin(sqrt(x^2+y^2)*1.6 - t)";fn.attachments=[t.id];
  const tr=makeNode("transformer",{x:700,y:160});tr.label="graph";tr.color="#7ad7ff";
  tr.props.mode="graph";tr.props.inAxis0="x";tr.props.inAxis1="y";tr.props.outAxis0="z";
  tr.props.aMin="-5";tr.props.aMax="5";tr.props.bMin="-5";tr.props.bMax="5";tr.props.res="100";
  tr.attachments=[fn.id];cam.attachments=[tr.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[t.id]:t,[fn.id]:fn,[tr.id]:tr},camId:cam.id,animated:true};
}

// Tutorial: parametric curves and surfaces ───────────────────────────────────

// Step 1: a parametric curve (a helix) — coordinates are functions of t.
function tutParamCurveScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="helix (x(t),y(t),z(t))";cam.props.showOpenBtn=false;
  cam.props.orbRadius="9";cam.props.orbTheta="0.7";cam.props.orbPhi="1.1";cam.props.showGrid=true;cam.props.showAxes=true;
  const ps=makeNode("paramSpace",{x:520,y:160});ps.label="helix";ps.color="#a6e3a1";
  ps.props.degree="1";ps.props.exprX="cos(t)";ps.props.exprY="sin(t)";ps.props.exprZ="t/5";
  ps.props.tMin="0";ps.props.tMax="18.85";ps.props.res="400";
  const cam2=cam;cam2.attachments=[ps.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[ps.id]:ps},camId:cam.id,animated:false};
}
// Step 2: bump to a parametric surface — coordinates are functions of (u,v).
function tutParamSurfaceScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="(x(u,v),y(u,v),z(u,v))";cam.props.showOpenBtn=false;
  cam.props.orbRadius="6";cam.props.orbTheta="0.8";cam.props.orbPhi="0.95";
  const ps=makeNode("paramsurf",{x:520,y:160});ps.label="surface";ps.color="#9b8cff";
  ps.props.exprX="cos(u)*sin(v)";ps.props.exprY="sin(u)*sin(v)";ps.props.exprZ="cos(v)";
  ps.props.uMin="0";ps.props.uMax="6.2832";ps.props.vMin="0";ps.props.vMax="3.1416";
  ps.props.uRes="48";ps.props.vRes="36";
  cam.attachments=[ps.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[ps.id]:ps},camId:cam.id,animated:false};
}
// Step 3: animate a domain bound so a section of the surface sweeps into being.
function tutParamAnimScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="sweep the v-domain";cam.props.showOpenBtn=false;
  cam.props.orbRadius="6";cam.props.orbTheta="0.8";cam.props.orbPhi="0.95";
  const s=makeNode("animator",{x:40,y:320});s.name="s";s.value=0;
  s.props.min="0";s.props.max="3.1416";s.props.period="6";s.props.loop="pingpong";s.playing=true;
  const ps=makeNode("paramsurf",{x:520,y:160});ps.label="surface";ps.color="#ffcf6e";
  ps.props.exprX="cos(u)*sin(v)";ps.props.exprY="sin(u)*sin(v)";ps.props.exprZ="cos(v)";
  ps.props.uMin="0";ps.props.uMax="6.2832";ps.props.vMin="0";ps.props.vMax="s";
  ps.props.uRes="48";ps.props.vRes="36";ps.attachments=[s.id];
  cam.attachments=[ps.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[s.id]:s,[ps.id]:ps},camId:cam.id,animated:true};
}

// Build the editable node-map for a given demo kind (drops the project's
// preview-only camera chrome so the editor shows full HUD). Used by the
// "Open project" buttons on the landing page.
function makeDemoProject(kind){
  const built = SCENES[kind] ? SCENES[kind]() : surfaceScene();
  const scene = built.scene;
  for(const n of Object.values(scene)){
    if(n.type==="camera3d"||n.type==="camera2d"){
      delete n.props.showCamLabel; delete n.props.showResetBtn;
      delete n.props.showShareBtn; delete n.props.showScalarOverlay;
    }
  }
  return scene;
}

// ── Embeddable live viewport ────────────────────────────────────────────────
// Builds one of the scenes above and renders its camera with the real
// ViewportSwitch, running the animator loop locally. Only ticks while visible
// (IntersectionObserver) so off-screen previews don't burn frames.
//
// By default every preview screen carries an "Open project" button (the scene's
// camera ships with showOpenBtn:true). Pass onOpen to override what it does;
// it defaults to opening this same `kind` in the full editor. The button hides
// itself if the camera's showOpenBtn prop is turned off — the same toggle
// exposed in the camera's properties panel inside the editor.
function LivePreview({ kind="field", onOpen }){
  const isMobile = useIsMobile();
  const built = useMemo(()=>SCENES[kind](), [kind]);
  // On phones the front-page previews start paused: auto-playing every timer on
  // load is the main source of jank (each playing animator drives a continuous
  // render loop). Mobile users opt in by tapping play in the scalar overlay; the
  // scenes are otherwise identical. Desktop keeps the auto-playing showcase.
  const initialScene = useMemo(()=>{
    if(!isMobile) return built.scene;
    const s={};
    for(const [id,n] of Object.entries(built.scene)){
      s[id] = (n.type==="animator" && n.playing) ? {...n, playing:false} : n;
    }
    return s;
  },[built.scene,isMobile]);
  const [nodes, setNodes] = useState(initialScene);
  // Re-seed when the mobile/desktop split flips (e.g. orientation/resize across
  // the breakpoint) so the paused-vs-playing default matches the current layout,
  // unless the user has already interacted.
  const touched = useRef(false);
  useEffect(()=>{ if(!touched.current) setNodes(initialScene); },[initialScene]);
  const camId = built.camId;
  // Recompute "is anything animating" from current state so play/pause from the
  // overlay starts and stops the clock.
  const animated = Object.values(nodes).some(n=>n.type==="animator" && n.playing);
  const animValsRef = useRef({});
  useEffect(()=>{ for(const n of Object.values(built.scene)){ if(n.type==="animator") animValsRef.current[n.id]=n.value??0; } },[built.scene]);

  const hostRef = useRef(null);
  const visible = useRef(false);
  const [tick, setTick] = useState(0);

  // Front-page previews are interactive: dragging a slider or toggling an
  // animator in the scalar overlay updates the live node graph and re-renders.
  const onUpdateNode = useCallback((id, patch)=>{
    touched.current = true;
    setNodes(ns=>({ ...ns, [id]: { ...ns[id], ...patch } }));
    setTick(t=>t+1);
  },[]);

  useEffect(()=>{
    const el = hostRef.current; if(!el) return;
    const io = new IntersectionObserver(es=>{ visible.current = es[0]?.isIntersecting; }, {threshold:0.05});
    io.observe(el);
    return ()=>io.disconnect();
  },[]);

  // Animator clock — only for scenes that actually have a playing animator.
  // Static scenes (flow, the gradient point shell) render once and never tick,
  // so they don't burn frames or stutter.
  useEffect(()=>{
    if(!animated) return;
    let raf, last=performance.now();
    const loop=(now)=>{
      const dt=(now-last)/1000; last=now;
      if(visible.current){
        let moved=false;
        for(const n of Object.values(nodes)){
          if(n.type==="animator" && n.playing){
            const period=resolveNum(n.props.period,{},8)||8, min=resolveNum(n.props.min,{},0), max=resolveNum(n.props.max,{},1);
            const span=(max-min) || 1;
            let v=animValsRef.current[n.id] ?? min;
            v += (span/period)*dt;
            if(v>max) v=min+((v-min)%span);
            animValsRef.current[n.id]=v; moved=true;
          }
        }
        if(moved) setTick(t=>t+1);
      }
      raf=requestAnimationFrame(loop);
    };
    raf=requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(raf);
  },[nodes,animated]);

  const proj = useMemo(()=>Object.values(nodes).find(n=>n.type==="project"),[nodes]);
  const theme = useMemo(()=>buildTheme(proj),[proj]);
  const camNode = nodes[camId];
  const scope = useMemo(()=>buildScopeForCamera(camId, nodes, animValsRef.current), [nodes, camId, tick]);

  const handleOpen = onOpen || (()=>openDemoProject(kind));

  return (
    <div ref={hostRef} style={{position:"absolute",inset:0}}>
      <ViewportSwitch camNode={camNode} nodes={nodes} scope={scope} theme={theme} projectNode={proj}
        onCameraChange={()=>{}} animValsRef={animValsRef} onUpdateNode={onUpdateNode} onOpenProject={handleOpen} maxPixelRatio={isMobile?1.1:undefined}/>
    </div>
  );
}

export { LivePreview, makeDemoProject, openDemoProject };
