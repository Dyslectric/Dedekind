import { useState, useEffect, useRef, useMemo, memo } from "react";
import { resolveNum } from "../core/math.js";
import { buildScopeForCamera } from "../core/scope.js";
import { buildTheme } from "../theme/presets.js";
import { ViewportSwitch, useIsMobile } from "../components/Viewport.jsx";
import { getShowcaseScene } from "./previews.jsx";

// ── A self-running "demoscene": the Implicit Metamorphosis, full screen ────────
// One openable project (kind "metamorph" in previews.jsx) plays itself: a single
// level set f(x,y,z)=0 morphs through six algebraic surfaces, animator-driven, on
// the GPU raymarcher. This module is the full-screen *presentation* — it mounts
// that project, gently orbits the camera for cinematics, and overlays demoscene
// chrome (a title that names the surface currently in view, a phase bar, a
// greetings scroller, transport controls). Routed at #demoscene; lazily imported,
// so none of it is in the main bundle. "Open project →" drops the real graph into
// the editor (#demo=metamorph) so it can be read and taken apart.

const isDemoSceneHash = (h) => (h||"").replace(/^#/,"").split("?")[0] === "demoscene";

const KIND = "metamorph";
// The six surfaces, in the order the morph clock s (0..6) sweeps them. Used only
// to label what's on screen; the math itself lives in the project graph.
const STAGES = ["Sphere","Torus","Tanglecube","Chair","Heart","Goursat surface"];
const STAGE_SECS = 7;                 // must match the project: s period (42) / 6
const LOOP_SECS  = STAGE_SECS*6;      // one full pass through all six

const GREETS =
  "DEDEKIND ◈ IMPLICIT METAMORPHOSIS — one equation f(x,y,z)=0, six classic "+
  "surfaces, crossfaded by an animator and ray-marched on the GPU — sphere into "+
  "torus into tanglecube into chair into heart into Goursat and back, forever — "+
  "every form is a named function you can open and edit — SPACE pause · ESC exit "+
  "· OPEN PROJECT to take it apart ◈ ◈ ◈     ";

// The live stage: builds the morph project once, runs its animators (gated by
// `paused`) and gently orbits the camera, suppressing all viewport chrome.
const DemoStage = memo(function DemoStage({ mobile, pausedRef }){
  const built = useMemo(()=>getShowcaseScene(KIND), []);
  const baseScene = useMemo(()=>{
    if(!built) return null;
    const s={}; for(const [id,n] of Object.entries(built.scene)) s[id]=(n.type==="animator")?{...n,playing:true}:n;
    return s;
  }, [built]);
  const camId = built?.camId;
  const animValsRef = useRef({});
  const thetaRef = useRef(0.7);
  const [, setTick] = useState(0);

  useEffect(()=>{
    if(!baseScene) return;
    animValsRef.current={};
    for(const n of Object.values(baseScene)) if(n.type==="animator") animValsRef.current[n.id]=resolveNum(n.props.min,{},0);
    thetaRef.current = resolveNum(baseScene[camId]?.props?.orbTheta,{},0.7);
  }, [baseScene, camId]);

  useEffect(()=>{
    if(!baseScene) return;
    let raf, last=performance.now();
    const loop=(now)=>{
      const dt=Math.min(0.05,(now-last)/1000); last=now;
      if(!pausedRef.current){
        for(const n of Object.values(baseScene)){
          if(n.type==="animator" && n.playing){
            const period=resolveNum(n.props.period,{},8)||8, min=resolveNum(n.props.min,{},0), max=resolveNum(n.props.max,{},1);
            const span=(max-min)||1;
            let v=animValsRef.current[n.id] ?? min;
            v += (span/period)*dt;
            if(v>max) v=min+((v-min)%span);
            animValsRef.current[n.id]=v;
          }
        }
        thetaRef.current += 0.12*dt;        // cinematic camera drift
        setTick(t=>t+1);
      }
      raf=requestAnimationFrame(loop);
    };
    raf=requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(raf);
  }, [baseScene, pausedRef]);

  const liveCam = baseScene ? {...baseScene[camId], props:{...baseScene[camId].props,
    orbTheta:String(thetaRef.current),
    showScalarOverlay:false, showOpenBtn:false, showHints:false,
    showCamLabel:false, showShareBtn:false, showResetBtn:false }} : null;
  const nodes = baseScene ? {...baseScene, [camId]:liveCam} : null;
  const proj = useMemo(()=> nodes ? Object.values(nodes).find(n=>n.type==="project") : null, [nodes]);
  const theme = useMemo(()=> buildTheme(proj), [proj]);
  const scope = nodes ? buildScopeForCamera(camId, nodes, animValsRef.current) : {};

  if(!nodes || !liveCam) return null;
  return <ViewportSwitch camNode={liveCam} nodes={nodes} scope={scope} theme={theme} projectNode={proj}
    onCameraChange={()=>{}} animValsRef={animValsRef} onUpdateNode={()=>{}}
    maxPixelRatio={mobile?1.1:undefined}/>;
});

export function DemoScene(){
  const mobile = useIsMobile();
  const [paused, setPaused] = useState(false);
  const [hintOn, setHintOn] = useState(true);
  const [, force] = useState(0);                 // re-render the chrome on the clock
  const tRef = useRef(0);
  const pausedRef = useRef(false);
  useEffect(()=>{ pausedRef.current=paused; }, [paused]);

  // A light chrome clock, kept in step with the stage's own morph clock (both run
  // on wall time from 0), so the on-screen title names the surface in view.
  useEffect(()=>{
    let raf, last=performance.now();
    const loop=(now)=>{
      const dt=(now-last)/1000; last=now;
      if(!pausedRef.current) tRef.current=(tRef.current+dt)%LOOP_SECS;
      force(f=>(f+1)&1023);
      raf=requestAnimationFrame(loop);
    };
    raf=requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(raf);
  }, []);

  const exit = ()=> window.location.assign(window.location.pathname+window.location.search);
  const open = ()=> window.location.assign(window.location.pathname+window.location.search+"#demo="+KIND);
  useEffect(()=>{
    const onKey=(e)=>{
      if(e.code==="Escape") exit();
      else if(e.code==="Space"){ e.preventDefault(); setPaused(x=>!x); }
    };
    window.addEventListener("keydown", onKey);
    return ()=>window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(()=>{ const h=setTimeout(()=>setHintOn(false), 6500); return ()=>clearTimeout(h); }, []);

  const t = tRef.current;
  const sClock = t/STAGE_SECS;                          // 0..6
  const idx = Math.round(sClock) % STAGES.length;       // dominant surface
  // Local fade so the title eases out near each crossfade and back in after it.
  const frac = sClock - Math.floor(sClock);             // 0..1 within a stage
  const edge = Math.min(frac, 1-frac);                  // 0 at a crossfade, .5 mid-stage
  const titleVis = Math.min(1, edge/0.18);
  const next = STAGES[(idx+1)%STAGES.length];

  return (
    <div style={{position:"fixed",inset:0,background:"#04050a",overflow:"hidden",fontFamily:"ui-monospace,Menlo,Consolas,monospace",userSelect:"none"}}>
      <div style={{position:"absolute",inset:0}}><DemoStage mobile={mobile} pausedRef={pausedRef}/></div>

      {/* vignette */}
      <div style={{position:"absolute",inset:0,pointerEvents:"none",
        background:"radial-gradient(120% 120% at 50% 45%, transparent 55%, rgba(2,3,8,0.6) 100%)"}}/>

      {/* lower-third title — names the surface currently in view */}
      <div style={{position:"absolute",left:"min(6vw,64px)",bottom:"min(15vh,140px)",pointerEvents:"none",
        opacity:titleVis,transform:`translateY(${(1-titleVis)*14}px)`,transition:"opacity 0.12s linear"}}>
        <div style={{fontSize:13,letterSpacing:3,color:"#7e92c8",marginBottom:6}}>IMPLICIT METAMORPHOSIS</div>
        <div style={{fontSize:"clamp(28px,5.5vw,72px)",fontWeight:700,color:"#eef2ff",letterSpacing:0.5,
          textShadow:"0 2px 28px rgba(120,150,255,0.5)"}}>{STAGES[idx]}</div>
        <div style={{marginTop:8,fontSize:"clamp(11px,1.5vw,17px)",color:"#9fb4e8",letterSpacing:1.5}}>{"→ "}{next}</div>
      </div>

      {/* top-right brand + open/exit */}
      <div style={{position:"absolute",right:"min(5vw,40px)",top:"min(5vh,30px)",textAlign:"right",color:"#7e92c8"}}>
        <div style={{fontSize:13,letterSpacing:3,color:"#5b9cf6",pointerEvents:"none"}}>{"◈ DEDEKIND"}</div>
        <div style={{marginTop:10,display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={()=>setPaused(x=>!x)} style={btn}>{paused?"▶ play":"❚❚ pause"}</button>
          <button onClick={open} style={{...btn,color:"#cde0ff",borderColor:"#5b9cf688"}}>open project {"→"}</button>
          <button onClick={exit} style={btn}>{"✕"}</button>
        </div>
      </div>

      {/* phase bar */}
      <div style={{position:"absolute",left:0,right:0,bottom:34,height:3,background:"rgba(120,150,220,0.16)",pointerEvents:"none"}}>
        <div style={{height:"100%",width:`${(t/LOOP_SECS)*100}%`,background:"linear-gradient(90deg,#5b9cf6,#b388ff)",boxShadow:"0 0 10px rgba(91,156,246,0.7)"}}/>
        {STAGES.map((_,i)=>(<div key={i} style={{position:"absolute",left:`${(i/STAGES.length)*100}%`,top:-2,width:1,height:7,background:i===idx?"#fff":"rgba(150,175,235,0.4)"}}/>))}
      </div>

      {/* greetings scroller */}
      <div style={{position:"absolute",left:0,right:0,bottom:0,height:30,overflow:"hidden",
        background:"linear-gradient(180deg,transparent,rgba(4,6,14,0.85))",display:"flex",alignItems:"center",pointerEvents:"none"}}>
        <div style={{whiteSpace:"nowrap",fontSize:13,letterSpacing:2,color:"#8aa6e6",
          animation:`dkscroll ${mobile?42:54}s linear infinite`,willChange:"transform",animationPlayState:paused?"paused":"running"}}>{GREETS}{GREETS}</div>
      </div>

      {/* control hint (auto-hides) */}
      <div style={{position:"absolute",left:"min(6vw,64px)",top:"min(5vh,30px)",pointerEvents:"none",
        color:"#7e92c8",fontSize:13,letterSpacing:1.5,opacity:hintOn?0.85:0,transition:"opacity 0.8s"}}>
        SPACE pause {"·"} ESC exit
      </div>

      {paused && <div style={{position:"absolute",inset:0,pointerEvents:"none",
        display:"flex",alignItems:"center",justifyContent:"center",color:"#dfe6ff",
        fontSize:"clamp(18px,3vw,34px)",letterSpacing:4,opacity:0.8,textShadow:"0 2px 20px #000"}}>{"❚❚"}</div>}

      <style>{`@keyframes dkscroll{from{transform:translateX(60vw)}to{transform:translateX(-100%)}}`}</style>
    </div>
  );
}

const btn = {
  pointerEvents:"auto", cursor:"pointer", background:"rgba(8,12,22,0.7)",
  color:"#9fb4e8", border:"1px solid rgba(120,150,220,0.3)", borderRadius:7,
  padding:"5px 10px", fontSize:13, fontFamily:"inherit", letterSpacing:1,
};

export { isDemoSceneHash };
