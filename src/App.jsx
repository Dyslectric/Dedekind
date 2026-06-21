import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense, Component } from "react";
import { isCameraType } from "./core/taxonomy.js";
import { buildScopeForCamera } from "./core/scope.js";
import { serializeProject, deserializeProject, serializeCameraShare, deserializeCameraShare, isShareHash, migrateModel } from "./core/serialize.js";
import { TYPE_META } from "./nodes/model.js";
import { buildUI, makeS, UICtx } from "./theme/tokens.jsx";
import { buildTheme } from "./theme/presets.js";
import { useAnimators } from "./hooks/useAnimators.js";

// Demo route: a URL hash like "#demo" or "#demo=clebsch" boots the editor
// straight into a curated showcase scene (default: the Clebsch cubic). Lets you
// open a striking scene from the address bar with no setup.
function demoKindFromHash(hash){
  if(hash==="demo") return "clebsch";
  const m = /^demo=([a-z0-9_-]+)$/i.exec(hash||"");
  return m ? m[1] : null;
}
import { ViewportSwitch, useIsMobile } from "./components/Viewport.jsx";
import { Landing } from "./landing/Landing.jsx";
import { Tutorials, isTutorialsHash } from "./landing/Tutorials.jsx";
// The editor (node canvas + props panel + every per-type editor) is the heavy
// part of the app, but a fresh visit lands on the marketing overlay and may
// never open it. Split it into its own chunk so first paint doesn't parse/
// execute it; Root prefetches the chunk on mount so the open transition stays
// instant. Benchmarks/RawShowcases are likewise route-gated, dev/secondary tools.
const Editor = lazy(()=>import("./Editor.jsx").then(m=>({default:m.Editor})));
const prefetchEditor = ()=>{ import("./Editor.jsx").catch(()=>{}); };
const Benchmarks = lazy(()=>import("./bench/Benchmarks.jsx").then(m=>({default:m.Benchmarks})));
const isBenchHash = (h) => (h||"").replace(/^#/,"").split("?")[0] === "bench";
const RawShowcases = lazy(()=>import("./landing/RawShowcases.jsx").then(m=>({default:m.RawShowcases})));
const isRawShowcasesHash = (h) => (h||"").replace(/^#/,"").split("?")[0] === "raw-showcases";

// Catch render-time errors — most importantly a failed lazy chunk import (a
// flaky network, a stale deploy whose hashed chunk no longer exists, or a host
// that refuses the asset). Without this, such a throw unmounts the whole React
// tree and the page goes blank; with it the user gets a legible message and a
// reload button instead. Reloading re-fetches index.html, which points at the
// current chunk hashes, so a stale-deploy mismatch self-heals.
class ChunkErrorBoundary extends Component {
  constructor(props){ super(props); this.state={ failed:false }; }
  static getDerivedStateFromError(){ return { failed:true }; }
  componentDidCatch(err){ try{ console.error("Dedekind: failed to load a code chunk", err); }catch{} }
  render(){
    if(this.state.failed){
      return this.props.fallback ?? (
        <div style={{position:"fixed",inset:0,background:"#24273a",color:"#cad3f5",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
          gap:14,fontFamily:"system-ui,sans-serif",padding:"0 24px",textAlign:"center"}}>
          <div style={{fontSize:18,color:"#8aadf4",fontWeight:600}}>◈ Dedekind</div>
          <div style={{fontSize:15,maxWidth:420,lineHeight:1.5}}>
            Something failed to load. This is usually a stale tab after an update,
            or a flaky connection.
          </div>
          <button onClick={()=>window.location.reload()}
            style={{marginTop:4,padding:"8px 16px",borderRadius:7,cursor:"pointer",
              background:"#8aadf4",color:"#1e2030",border:"none",fontSize:14,fontWeight:600}}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Share page ───────────────────────────────────────────────────────────────
// Renders a single camera from a shared payload. `camIdOverride` lets the mobile
// project picker reuse this to show any chosen camera; `onBack` (when provided)
// shows a back affordance to return to that picker.
function SharePage({data, camIdOverride, onBack}){
  const isMobile=useIsMobile();
  const animValsRef=useRef({});
  const[liveNodes,setLiveNodes]=useState(()=>migrateModel({...data.nodes}));
  useAnimators(liveNodes,setLiveNodes,animValsRef);
  const[tick,setTick]=useState(0);
  const camId = camIdOverride || data.camId;
  useEffect(()=>{let raf;const loop=()=>{if(Object.values(liveNodes).some(n=>n.type==="animator"&&n.playing))setTick(t=>t+1);raf=requestAnimationFrame(loop);};raf=requestAnimationFrame(loop);return()=>cancelAnimationFrame(raf);},[liveNodes]);
  const scope=useMemo(()=>buildScopeForCamera(camId,liveNodes,animValsRef.current),[liveNodes,tick,camId]);
  const camNode=liveNodes[camId];
  const proj=Object.values(liveNodes).find(n=>n.type==="project");
  const theme=buildTheme(proj);
  const ui=useMemo(()=>buildUI(proj),[proj]);
  const uiCtx=useMemo(()=>({ui,S:makeS(ui)}),[ui]);
  const updateNode=useCallback((id,patch)=>setLiveNodes(ns=>({...ns,[id]:{...ns[id],...patch}})),[]);
  const showLabel = camNode?.props.showCamLabel !== false;
  // A shared/embedded page can offer a button to open the whole scene in the
  // full editor (desktop only — the viewport places it). The shared payload
  // carries the camera's whole dependency subgraph plus the project node, so we
  // re-serialize it as a project hash and reload into the editor.
  const openProject=useCallback(()=>{
    try{
      const hash=serializeProject(liveNodes);
      if(!hash) return;
      window.location.hash=hash;
      window.location.reload();
    }catch{ /* no-op if serialization fails */ }
  },[liveNodes]);

  const header = (showLabel||onBack) && (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"5px 14px",background:ui.uiPanelBar,flexShrink:0}}>
      {onBack&&<button onClick={onBack} style={{...uiCtx.S.btnSm,color:ui.uiAccent,borderColor:ui.uiAccent+"55",cursor:"pointer"}}>← viewports</button>}
      <span style={{color:ui.uiAccent,fontSize:16,fontFamily:"monospace",fontWeight:"bold"}}>◈ Dedekind</span>
      <span style={{color:ui.uiMuted,fontSize:15,fontFamily:"monospace"}}>{camNode?.label}</span>
    </div>
  );

  const viewport = (
    <ViewportSwitch camNode={camNode} nodes={liveNodes} scope={scope} theme={theme} projectNode={proj}
      onCameraChange={()=>{}} animValsRef={animValsRef} onUpdateNode={updateNode} onOpenProject={openProject}/>
  );

  // On mobile the graph sits centered in a fixed box above the controls (the
  // viewport itself drops the scalar overlay into a bar below the canvas), the
  // same treatment the landing-page previews get.
  const body = isMobile ? (
    <div style={{flex:1,minHeight:0,overflowY:"auto",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px 12px"}}>
      <div style={{width:"100%",maxWidth:380,height:540,position:"relative",border:`1px solid ${ui.uiPanelBorder||"#222747"}`,borderRadius:13,overflow:"hidden",background:theme.canvasBg,boxShadow:"0 24px 60px -38px #000"}}>
        {viewport}
      </div>
    </div>
  ) : (
    <div style={{flex:1,minHeight:0,position:"relative"}}>{viewport}</div>
  );

  return<UICtx.Provider value={uiCtx}><div style={{position:"fixed",inset:0,background:theme.canvasBg,display:"flex",flexDirection:"column"}}>
    {header}
    {body}
  </div></UICtx.Provider>;
}

// ── Mobile project picker ────────────────────────────────────────────────────
// A full project URL opened on a phone can't drop into the desktop-only editor,
// so we list the project's cameras and let the user pick one to view (rendered
// through SharePage). We synthesize a share-style payload from the full graph.
function MobileProjectPicker({nodes}){
  const proj=Object.values(nodes).find(n=>n.type==="project");
  const ui=useMemo(()=>buildUI(proj),[proj]);
  const uiCtx=useMemo(()=>({ui,S:makeS(ui)}),[ui]);
  const cams=useMemo(()=>Object.values(nodes).filter(n=>isCameraType(n.type)&&n.enabled!==false),[nodes]);
  const [picked,setPicked]=useState(null);

  if(picked){
    // Reuse the camera-share renderer for the chosen camera.
    return <SharePage data={{share:true,camId:picked,nodes}} camIdOverride={picked} onBack={()=>setPicked(null)}/>;
  }
  return <UICtx.Provider value={uiCtx}>
    <div style={{position:"fixed",inset:0,background:ui.uiBg||"#0d0f18",color:ui.uiText||"#c8d1e6",display:"flex",flexDirection:"column",fontFamily:"Inter,system-ui,sans-serif",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:ui.uiPanelBar,flexShrink:0}}>
        <span style={{color:ui.uiAccent,fontSize:17,fontFamily:"monospace",fontWeight:"bold"}}>◈ Dedekind</span>
      </div>
      <div style={{padding:"20px 18px"}}>
        <h2 style={{fontSize:20,margin:"0 0 6px"}}>Choose a viewport</h2>
        <p style={{fontSize:14.5,color:ui.uiMuted,margin:"0 0 18px",lineHeight:1.5}}>
          The full editor is desktop-only. Pick one of this project's cameras to view it here.
        </p>
        {cams.length===0 && <p style={{color:ui.uiMuted}}>This project has no active cameras.</p>}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {cams.map(c=>(
            <button key={c.id} onClick={()=>setPicked(c.id)}
              style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,
                padding:"14px 16px",borderRadius:10,cursor:"pointer",textAlign:"left",
                background:ui.uiPanel||"#141828",border:`1px solid ${ui.uiPanelBorder||"#222747"}`,
                color:ui.uiText||"#c8d1e6",fontSize:16}}>
              <span>{c.label||c.name||"Camera"}</span>
              <span style={{color:ui.uiMuted,fontFamily:"monospace",fontSize:13}}>
                {c.props?.mode==="2d"?"2D":"3D"} →
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  </UICtx.Provider>;
}


function Root(){
  const hash=window.location.hash.slice(1);
  // a fresh visit (no hash / not a share) starts on the landing overlay; a demo
  // route opens straight into the editor showcase.
  const isShare = hash ? isShareHash(hash) : false;
  const isDemo = !!demoKindFromHash(hash);
  const startOnLanding=!isShare && !isDemo && !hash;
  const [showLanding,setShowLanding]=useState(startOnLanding);
  const [closing,setClosing]=useState(false);
  const closeTimer=useRef(null);

  // Tutorials overlay: shown whenever the hash is a #tutorials route. Tracked in
  // state and kept in sync with the address bar so deep links and the browser
  // Back button work. Exiting clears the hash and returns to the editor.
  const [tutorials,setTutorials]=useState(()=>isTutorialsHash(window.location.hash));
  useEffect(()=>{
    const onHash=()=>setTutorials(isTutorialsHash(window.location.hash));
    window.addEventListener("hashchange",onHash);
    return ()=>window.removeEventListener("hashchange",onHash);
  },[]);
  const exitTutorials=useCallback(()=>{
    try{ history.replaceState(null,"",window.location.pathname); }catch{}
    setTutorials(false);
  },[]);

  // Open the editor: slide the landing away and push a history entry so the
  // browser Back button (or Alt+Left) returns to the landing.
  const openEditor=useCallback((pushHistory=true)=>{
    if(pushHistory){ try{ history.pushState({dkEditor:true}, ""); }catch{} }
    setClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current=setTimeout(()=>setShowLanding(false), 820);
  },[]);

  // Re-show the landing (slide it back down). Used when Back is pressed.
  const restoreLanding=useCallback(()=>{
    clearTimeout(closeTimer.current);
    setShowLanding(true);
    // next frame, clear the closing class so it animates back into view
    requestAnimationFrame(()=>requestAnimationFrame(()=>setClosing(false)));
  },[]);

  // Prefetch the editor chunk as soon as Root mounts so that by the time the
  // visitor clicks "open" it's already downloaded — the open transition stays
  // instant despite the editor living in a lazy chunk. The fetch is fire-and-
  // forget; the Suspense boundary below covers the rare case it isn't ready yet.
  useEffect(()=>{ prefetchEditor(); },[]);

  useEffect(()=>{
    // Seed a base history entry representing the landing, so the first
    // pushState (on open) has something to come back to.
    if(startOnLanding){ try{ history.replaceState({dkEditor:false}, ""); }catch{} }
    const onPop=(e)=>{
      const inEditor=!!(e.state&&e.state.dkEditor);
      if(inEditor){ openEditor(false); }   // forward again → editor (no new push)
      else { restoreLanding(); }            // back → landing
    };
    window.addEventListener("popstate",onPop);
    return ()=>window.removeEventListener("popstate",onPop);
  },[startOnLanding,openEditor,restoreLanding]);

  return <>
    <ChunkErrorBoundary>
      <Suspense fallback={<div style={{position:"fixed",inset:0,background:"#24273a"}}/>}>
        <Editor initialHash={hash} active={!showLanding && !tutorials}/>
      </Suspense>
    </ChunkErrorBoundary>
    {showLanding && !tutorials && <Landing onOpen={()=>openEditor(true)} closing={closing}/>}
    {tutorials && <Tutorials onExit={exitTutorials}/>}
  </>;
}

export default function App(){
  // Benchmark harness (#bench): gated before any hook so the rules of hooks hold
  // (this component returns early and runs no hooks of its own on the bench path).
  if(isBenchHash(window.location.hash)) return <ChunkErrorBoundary><Suspense fallback={<div style={{minHeight:"100vh",background:"#070810"}}/>}><Benchmarks/></Suspense></ChunkErrorBoundary>;
  if(isRawShowcasesHash(window.location.hash)) return <ChunkErrorBoundary><Suspense fallback={<div style={{minHeight:"100vh",background:"#070810"}}/>}><RawShowcases/></Suspense></ChunkErrorBoundary>;
  return <MainApp/>;
}

function MainApp(){
  const isMobile=useIsMobile();
  const hash=window.location.hash.slice(1);
  const parsed=useMemo(()=>{
    if(!hash) return null;
    return deserializeCameraShare(hash);
  },[hash]);
  const projectNodes=useMemo(()=>{
    if(!hash || parsed) return null;   // parsed truthy means it WAS a share; skip
    return deserializeProject(hash);
  },[parsed,hash]);

  const isDemo = !!demoKindFromHash(hash);
  if(hash && !isDemo){
    // A camera/viewport share opens straight into that single camera.
    if(parsed) return<SharePage data={parsed}/>;
    // A full project URL on mobile can't open the desktop editor — show a
    // picker of the project's cameras instead.
    if(isMobile && projectNodes) return<MobileProjectPicker nodes={projectNodes}/>;
  }
  return <Root/>;
}
