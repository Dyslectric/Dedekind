import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { makeNode, makeProjectNode } from "../nodes/model.js";
import { buildScopeForCamera } from "../core/scope.js";
import { resolveNum } from "../core/math.js";
import { buildTheme } from "../theme/presets.js";
import { ViewportSwitch, useIsMobile } from "../components/Viewport.jsx";
import { serializeProject } from "../core/serialize.js";

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
  seeds.props.exprX="t";seeds.props.exprY="0";seeds.props.exprZ="0";seeds.props.tMin="0";seeds.props.tMax="1";seeds.props.res="24";
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
Object.assign(SCENES, {
  "tut-fn-only": tutFnOnlyScene,
  "tut-fn-surface": tutFnSurfaceScene,
  "tut-fn-field": tutFnFieldScene,
  "tut-sphere": tutSphereScene,
  "tut-sphere-slider": tutSphereSliderScene,
  "tut-torus-level": tutTorusLevelScene,
  "tut-const-curve": tutConstCurveScene,
  "tut-slider-curve": tutSliderCurveScene,
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
  "tut-series-1": tutSeries1Scene,
  "tut-series-5": tutSeries5Scene,
  "tut-series-15": tutSeries15Scene,
  "tut-integral-area": tutIntegralAreaScene,
  "tut-frame-tube": tutFrameTubeScene,
  "tut-frame-moving": tutFrameMovingScene,
});

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

// The editor: point sets and sequences ───────────────────────────────────────

// Step 1: a handful of literal points.
function tutPointsListScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="a list of points";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="6";
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
  const cam=previewCam(makeNode("camera3d",{x:1040,y:120}));cam.label="point(i), i = 0…359";cam.props.showOpenBtn=false;
  cam.props.orbRadius="11";cam.props.orbTheta="0.9";cam.props.orbPhi="1.0";cam.props.spin="loop";cam.props.spinPeriod="40";
  const pts=makeNode("points",{x:620,y:160});pts.label="phyllotaxis";pts.color="#9b8cff";
  pts.props.kind="points";pts.props.mode="index";
  pts.props.idxPoint="2.6*sqrt(i/360)*cos(i*2.399), 2.6*sqrt(i/360)*sin(i*2.399), (i/360)*2 - 1";
  pts.props.idxCount="360";pts.props.drawLines=false;pts.props.radius="0.06";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#1b3a8f";pts.props.colorHi="#ffb454";
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[pts.id]:pts},camId:cam.id,animated:false};
}
// Step 3: a recurrence — each point from the previous (a converging spiral).
function tutPointsRecursiveScene(){
  const project=makeProjectNode("preview");
  const cam=previewCam(makeNode("camera2d",{x:1040,y:120}));cam.label="x[n] from x[n−1]";cam.props.showOpenBtn=false;
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="5";
  const pts=makeNode("points",{x:620,y:160});pts.label="orbit";pts.color="#7ad7ff";
  pts.props.kind="points";pts.props.mode="recursive";
  pts.props.recInit="3, 0";
  pts.props.recStep="0.96*(x[n-1]*cos(0.4) - y[n-1]*sin(0.4)), 0.96*(x[n-1]*sin(0.4) + y[n-1]*cos(0.4))";
  pts.props.recCount="90";pts.props.drawLines=true;pts.props.radius="3.5";
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[pts.id]:pts},camId:cam.id,animated:false};
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
  const pts=makeNode("points",{x:620,y:160});pts.label="iterated map";pts.color="#c4b5fd";
  pts.props.kind="points";pts.props.mode="recursive";
  pts.props.recInit="0.1, 0.1";
  pts.props.recStep="sin(-1.4*y[n-1]) + 1.6*cos(-1.4*x[n-1]), sin(1.6*x[n-1]) + 0.7*cos(1.6*y[n-1])";
  pts.props.recCount="1500";pts.props.drawLines=false;pts.props.radius="1.6";
  pts.props.colorMode="gradient";pts.props.colorExpr="i";pts.props.colorLo="#5ad1e6";pts.props.colorHi="#9b8cff";
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[pts.id]:pts},camId:cam.id,animated:false};
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
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="6";
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
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="7";cam.props.planeOx="0";cam.props.planeOy="0";
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
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="6";
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
  cam.props.mode="2d";cam.props.normalZ="1";cam.props.orthoSize="6";
  const field=makeNode("fnMap",{x:300,y:120});field.label="V(x,y)";field.props.inDim="2";field.props.outDim="2";
  field.props.out0="-y + 0.25*x";field.props.out1="x + 0.25*y";
  const seeds=makeNode("paramSpace",{x:300,y:320});seeds.label="seeds";seeds.props.degree="1";
  seeds.props.exprX="0.3 + 2.2*t";seeds.props.exprY="0.1";seeds.props.exprZ="0";seeds.props.tMin="0";seeds.props.tMax="1";seeds.props.res="11";
  const flow=makeNode("flow",{x:640,y:200});flow.label="flow";flow.color="#5be0c0";
  flow.props.steps="260";flow.props.stepSize="0.04";flow.props.output="surface";
  flow.props.gradient=true;flow.props.gradA="#5be0c0";flow.props.gradB="#5b9cf6";
  flow.attachments=[field.id,seeds.id];cam.attachments=[flow.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[field.id]:field,[seeds.id]:seeds,[flow.id]:flow},camId:cam.id,animated:false};
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
// Step 3: a slider `k` is referenced by NAME in the expression without being
// wired straight to the transformer — showing named scalars live in global scope.
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
  cam.props.planeOx="0";cam.props.planeOy="0";cam.props.planeOz="0";cam.props.orthoSize="7";
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
