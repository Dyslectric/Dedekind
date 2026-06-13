import { useState, useRef, useEffect, useMemo } from "react";
import { makeNode, makeProjectNode } from "../nodes/model.js";
import { buildScopeForCamera } from "../core/scope.js";
import { buildTheme } from "../theme/presets.js";
import { ViewportSwitch } from "../components/Viewport.jsx";

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
  pts.props.space="xyz";pts.props.hasVectors=false;
  pts.props.data=
    "2.6*sqrt(i/360)*cos(i*2.4), 2.6*sqrt(i/360)*sin(i*2.4), (i/360)*3 - 1.5\n360";
  pts.props.drawLines=false;pts.props.radius="0.075";
  pts.props.colorMode="gradient";pts.props.colorExpr="z";pts.props.colorLo="#1b3a8f";pts.props.colorHi="#ffb454";
  cam.attachments=[pts.id];
  return {scene:{[project.id]:project,[cam.id]:cam,[pts.id]:pts},camId:cam.id,animated:false};
}

const SCENES = { surface:surfaceScene, field:fieldScene, flow:flowScene, lattice:latticeScene };

// ── Embeddable live viewport ────────────────────────────────────────────────
// Builds one of the scenes above and renders its camera with the real
// ViewportSwitch, running the animator loop locally. Only ticks while visible
// (IntersectionObserver) so off-screen previews don't burn frames.
function LivePreview({ kind="field" }){
  const built = useMemo(()=>SCENES[kind](), [kind]);
  const [nodes] = useState(built.scene);
  const camId = built.camId;
  const animated = built.animated!==false &&
    Object.values(built.scene).some(n=>n.type==="animator" && n.playing);
  const animValsRef = useRef({});
  useEffect(()=>{ for(const n of Object.values(nodes)){ if(n.type==="animator") animValsRef.current[n.id]=n.value??0; } },[nodes]);

  const hostRef = useRef(null);
  const visible = useRef(false);
  const [tick, setTick] = useState(0);

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
            const period=parseFloat(n.props.period)||8, min=parseFloat(n.props.min)||0, max=parseFloat(n.props.max)||1;
            const span=max-min || 1;
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

  return (
    <div ref={hostRef} style={{position:"absolute",inset:0}}>
      <ViewportSwitch camNode={camNode} nodes={nodes} scope={scope} theme={theme} projectNode={proj}
        onCameraChange={()=>{}} animValsRef={animValsRef} onUpdateNode={()=>{}}/>
    </div>
  );
}

export { LivePreview };
