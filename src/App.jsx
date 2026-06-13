import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ComputeWorker } from "./core/worker.js";
import { catOf, canAttach, SCALAR_TYPES, isCameraType } from "./core/taxonomy.js";
import { buildScopeForCamera, buildGlobalScope, resolveScope, collectScalarDeps } from "./core/scope.js";
import { serializeProject, deserializeProject, serializeCameraShare, migrateModel } from "./core/serialize.js";
import { makeNode, makeInitialScene, makeDemoScene, TYPE_META, PROJECT_ID } from "./nodes/model.js";
import { kindEnabled, ADDABLE_KINDS, ALL_KINDS } from "./nodes/kinds.js";
import { UICtx, UI_DEFAULTS, buildUI, makeS } from "./theme/tokens.jsx";
import { buildTheme } from "./theme/presets.js";
import { useAnimators } from "./hooks/useAnimators.js";
import { useHistory } from "./hooks/useHistory.js";
import { NodeCanvas } from "./components/NodeCanvas.jsx";
import { PropsPanel } from "./components/PropsPanel.jsx";
import { ViewportStrip, ViewportSwitch, DetachedWindow } from "./components/Viewport.jsx";
import { PropsPanelWindow } from "./components/primitives.jsx";
import { Landing } from "./landing/Landing.jsx";

// ── Share page ───────────────────────────────────────────────────────────────
function SharePage({data}){
  const animValsRef=useRef({});
  const[liveNodes,setLiveNodes]=useState(()=>migrateModel({...data.nodes}));
  useAnimators(liveNodes,setLiveNodes,animValsRef);
  const[tick,setTick]=useState(0);
  useEffect(()=>{let raf;const loop=()=>{if(Object.values(liveNodes).some(n=>n.type==="animator"&&n.playing))setTick(t=>t+1);raf=requestAnimationFrame(loop);};raf=requestAnimationFrame(loop);return()=>cancelAnimationFrame(raf);},[liveNodes]);
  const scope=useMemo(()=>buildScopeForCamera(data.camId,liveNodes,animValsRef.current),[liveNodes,tick]);
  const camNode=liveNodes[data.camId];
  const proj=Object.values(liveNodes).find(n=>n.type==="project");
  const theme=buildTheme(proj);
  const ui=useMemo(()=>buildUI(proj),[proj]);
  const uiCtx=useMemo(()=>({ui,S:makeS(ui)}),[ui]);
  const updateNode=useCallback((id,patch)=>setLiveNodes(ns=>({...ns,[id]:{...ns[id],...patch}})),[]);
  const showLabel = camNode?.props.showCamLabel !== false;
  return<UICtx.Provider value={uiCtx}><div style={{position:"fixed",inset:0,background:theme.canvasBg,display:"flex",flexDirection:"column"}}>
    {showLabel&&<div style={{display:"flex",alignItems:"center",gap:10,padding:"5px 14px",background:ui.uiPanelBar,flexShrink:0}}>
      <span style={{color:ui.uiAccent,fontSize:16,fontFamily:"monospace",fontWeight:"bold"}}>◈ Dedekind</span>
      <span style={{color:ui.uiMuted,fontSize:15,fontFamily:"monospace"}}>{camNode?.label}</span>
    </div>}
    <div style={{flex:1,minHeight:0}}>
      <ViewportSwitch camNode={camNode} nodes={liveNodes} scope={scope} theme={theme} projectNode={proj}
        onCameraChange={()=>{}} animValsRef={animValsRef} onUpdateNode={updateNode}/>
    </div>
  </div></UICtx.Provider>;
}

function Editor({initialHash}){
  const initialNodes=useMemo(()=>{if(initialHash){const l=deserializeProject(initialHash);if(l)return l;}return makeInitialScene();},[]);
  const hist=useHistory(initialNodes);
  const nodes=hist.state;
  // User-facing edits record history (coalescing rapid bursts like a drag).
  const setNodes=hist.set;
  // Animator playback commits (e.g. a "once" loop finishing) must NOT create
  // undo points — route them through the silent setter.
  const setNodesSilent=hist.setSilent;
  const[selected,setSelected]=useState(null);
  const[vpH,setVpH]=useState(270);
  const[dockCollapsed,setDockCollapsed]=useState(true);
  const[detached,setDetached]=useState(new Set());
  const[copied,setCopied]=useState(null);
  const[panelPopped,setPanelPopped]=useState(false);
  const[panelW,setPanelW]=useState(370);
  const[panelSide,setPanelSide]=useState("right");   // "right" | "left"
  const[panelSpan,setPanelSpan]=useState("main");      // "main" (beside canvas) | "full" (full window height)
  const panelDrag=useRef(false);
  const vpDrag=useRef(false);

  const animValsRef=useRef({});
  useEffect(()=>{for(const n of Object.values(nodes)){if(n.type==="animator"&&animValsRef.current[n.id]===undefined)animValsRef.current[n.id]=n.value??0;}},[nodes]);
  useAnimators(nodes,setNodesSilent,animValsRef);

  // Preview tick: refreshes the editor-side scope objects (used only for the
  // props-panel previews, value highlights, and scalar overlays) while an
  // animator plays. The 3D/2D viewports do NOT depend on this — they read
  // animValsRef directly in their own RAF loops and rebuild themselves. We
  // therefore throttle this to a low rate so playing an animation does not
  // re-render the whole editor (and every MathInput) 60×/second, which is what
  // made math values feel "locked" while something was animating.
  const[animTick,setAnimTick]=useState(0);
  const PREVIEW_HZ=8;
  useEffect(()=>{
    if(!Object.values(nodes).some(n=>n.type==="animator"&&n.playing)) return;
    const iv=setInterval(()=>setAnimTick(t=>t+1),1000/PREVIEW_HZ);
    return()=>clearInterval(iv);
  },[nodes]);

  // Ids of animators currently playing (recomputed only when nodes change).
  const playingAnimators=useMemo(()=>{
    const s=new Set();
    for(const n of Object.values(nodes)) if(n.type==="animator"&&n.playing) s.add(n.id);
    return s;
  },[nodes]);

  const scopeMap=useMemo(()=>{
    const m={};
    for(const n of Object.values(nodes)){if(isCameraType(n.type))m[n.id]=buildScopeForCamera(n.id,nodes,animValsRef.current);}
    return m;
  },[nodes,animTick]);

  // Static global scope: animators contribute their stored value, not their live
  // per-frame value. Rebuilt only when nodes change, so its identity is stable
  // across animation frames. This is the base for editing nodes that aren't
  // animated. The live variant folds in current animator values for previews of
  // nodes that ARE animated.
  const staticGlobalScope=useMemo(()=>buildGlobalScope(nodes,{}),[nodes]);
  const globalScope=useMemo(()=>buildGlobalScope(nodes,animValsRef.current),[nodes,animTick]);

  const projectNode=useMemo(()=>Object.values(nodes).find(n=>n.type==="project"),[nodes]);
  const theme=useMemo(()=>buildTheme(projectNode),[projectNode]);
  const ui=useMemo(()=>buildUI(projectNode),[projectNode]);
  const uiCtx=useMemo(()=>({ui,S:makeS(ui)}),[ui]);
  const selectedNode=selected?nodes[selected]:null;

  // Does the selected node depend (transitively) on a playing animator? If not,
  // its editing scope is frame-invariant and must NOT be rebuilt on every
  // preview tick — that keeps its MathInputs perfectly stable (and editable)
  // while unrelated nodes animate elsewhere.
  const selectedAnimated=useMemo(()=>{
    if(!selectedNode||!playingAnimators.size) return false;
    const deps=new Set(); collectScalarDeps(selectedNode.id,nodes,deps,new Set());
    for(const d of deps) if(playingAnimators.has(d)) return true;
    return false;
  },[selectedNode,nodes,playingAnimators]);

  // panelScope: for an animated selection, track live values at the preview rate;
  // otherwise build from the stable static base so a running animation elsewhere
  // produces no new scope object and no re-render of this node's editors.
  const panelTick=selectedAnimated?animTick:0;
  const panelScope=useMemo(()=>{
    if(!selectedNode) return selectedAnimated?globalScope:staticGlobalScope;
    const base=selectedAnimated?globalScope:staticGlobalScope;
    // A node's editing scope = the scalars/functions resolved from its own deps,
    // layered over the global scope so unconnected vars still preview.
    const own=resolveScope(selectedNode.id,nodes,selectedAnimated?animValsRef.current:{});
    return {...base,...own};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selectedNode,nodes,panelTick,selectedAnimated,staticGlobalScope]);

  const urlTimer=useRef(null);
  useEffect(()=>{clearTimeout(urlTimer.current);urlTimer.current=setTimeout(()=>{const s=serializeProject(nodes);if(s)window.history.replaceState(null,"","#"+s);},800);return()=>clearTimeout(urlTimer.current);},[nodes]);

  const copyUrl=useCallback((type,camId)=>{
    const s=type==="project"?serializeProject(nodes):serializeCameraShare(camId,nodes);
    navigator.clipboard?.writeText(window.location.origin+window.location.pathname+"#"+s);
    setCopied(type==="project"?"project":camId);setTimeout(()=>setCopied(null),1800);
  },[nodes]);

  const updateNode=useCallback((id,patch)=>setNodes(ns=>({...ns,[id]:{...ns[id],...patch}})),[setNodes]);
  const moveNode=useCallback((id,pos)=>setNodes(ns=>({...ns,[id]:{...ns[id],pos}})),[setNodes]);

  const beginStep=hist.beginStep;
  // Unified attachment: a dependency is stored on the CONSUMER that uses it.
  // attach(consumerId, depId) where canAttach(dep.type, consumer.type) must hold.
  // The legacy `kind` argument ("cam"/"scalar") is still accepted: for "cam",
  // (fromId,toId)=(camera,plot) → consumer=camera, dep=plot; for "scalar",
  // (fromId,toId)=(scalar,consumer) → consumer=toId, dep=fromId.
  const attachDep=useCallback((consumerId,depId)=>{
    beginStep();
    setNodes(ns=>{
      const consumer=ns[consumerId], dep=ns[depId];
      if(!consumer||!dep) return ns;
      if(!canAttach(dep.type, consumer.type)) return ns;
      if((consumer.attachments||[]).includes(depId)) return ns;
      return {...ns,[consumerId]:{...consumer,attachments:[...(consumer.attachments||[]),depId]}};
    });
  },[setNodes,beginStep]);
  const detachDep=useCallback((consumerId,depId)=>{
    beginStep();
    setNodes(ns=>{const c=ns[consumerId];if(!c)return ns;return{...ns,[consumerId]:{...c,attachments:(c.attachments||[]).filter(id=>id!==depId)}};});
  },[setNodes,beginStep]);
  const connect=useCallback((kind,fromId,toId)=>{
    if(kind==="dep") attachDep(toId,fromId);         // fromId=dep, toId=consumer
    else if(kind==="cam") attachDep(fromId,toId);    // camera consumes plot
    else attachDep(toId,fromId);                      // consumer toId consumes scalar/fn/domain fromId
  },[attachDep]);

  const disconnect=useCallback((kind,fromId,toId)=>{
    if(kind==="dep") detachDep(toId,fromId);
    else if(kind==="cam") detachDep(fromId,toId);
    else detachDep(toId,fromId);
  },[detachDep]);

  const deleteNode=useCallback((id)=>{
    if(id===PROJECT_ID)return;
    beginStep();
    setNodes(ns=>{const next={...ns};delete next[id];for(const[nid,n]of Object.entries(next)){if(n.attachments?.includes(id))next[nid]={...n,attachments:n.attachments.filter(a=>a!==id)};}return next;});
    setDetached(d=>{const nd=new Set(d);nd.delete(id);return nd;});
    setSelected(s=>s===id?null:s);
  },[setNodes,beginStep]);
  const toggleEnabled=useCallback((id)=>{beginStep();setNodes(ns=>({...ns,[id]:{...ns[id],enabled:!ns[id].enabled}}));},[setNodes,beginStep]);
  // Detach a camera into a floating window.
  const openWindow=useCallback((id)=>setDetached(d=>{const nd=new Set(d);nd.add(id);return nd;}),[]);
  // Re-dock a camera into the bottom strip (and reveal the strip).
  const dockCamera=useCallback((id)=>{setDetached(d=>{const nd=new Set(d);nd.delete(id);return nd;});setDockCollapsed(false);},[]);
  // Toggle (used by the node-canvas detach control).
  const detachCamera=useCallback((id)=>setDetached(d=>{const nd=new Set(d);nd.has(id)?nd.delete(id):nd.add(id);return nd;}),[]);
  // Replace the whole project with the feature-showcase demo. Confirms first so
  // a click doesn't silently discard the user's current work. Recorded as a
  // single undo step (its own boundary).
  const loadDemo=useCallback(()=>{
    if(!window.confirm("Load the demo project? This replaces your current scene.")) return;
    setDetached(new Set());
    setSelected(null);
    beginStep();
    setNodes(makeDemoScene());
  },[setNodes,beginStep]);
  const addNode=useCallback((type,attachToCamId=null)=>{
    const node=makeNode(type);
    beginStep();
    setNodes(ns=>{const next={...ns,[node.id]:node};if(attachToCamId&&ns[attachToCamId])next[attachToCamId]={...ns[attachToCamId],attachments:[...ns[attachToCamId].attachments,node.id]};return next;});
    setSelected(node.id);
  },[setNodes,beginStep]);

  const handleCameraChange=useCallback((camId,patch)=>{
    setNodes(ns=>ns[camId]?{...ns,[camId]:{...ns[camId],...patch}}:ns);
  },[setNodes]);

  useEffect(()=>{
    const mm=e=>{
      if(vpDrag.current)setVpH(h=>Math.max(60,Math.min(700,h-e.movementY)));
      if(panelDrag.current){
        // drag toward the canvas widens the panel; direction depends on which side it's on
        const dir = panelSide==="right" ? -1 : 1;
        setPanelW(w=>Math.max(260,Math.min(720,w + dir*e.movementX)));
      }
    };
    const mu=()=>{vpDrag.current=false;panelDrag.current=false;document.body.style.userSelect="";};
    window.addEventListener("mousemove",mm);window.addEventListener("mouseup",mu);
    return()=>{window.removeEventListener("mousemove",mm);window.removeEventListener("mouseup",mu);};
  },[panelSide]);

  // Undo / redo keyboard shortcuts. Ctrl/⌘+Z undoes; Ctrl/⌘+Shift+Z (or Ctrl+Y)
  // redoes. We don't intercept these while the user is editing text — a math
  // field, input, or any contenteditable should keep the browser's native
  // per-character undo so an edit-in-progress isn't disrupted.
  const{undo,redo}=hist;
  useEffect(()=>{
    const isEditing=()=>{
      const el=document.activeElement;
      if(!el) return false;
      const tag=el.tagName;
      return tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||el.isContentEditable;
    };
    const onKey=e=>{
      const mod=e.ctrlKey||e.metaKey;
      if(!mod) return;
      const k=e.key.toLowerCase();
      if(k!=="z"&&k!=="y") return;
      if(isEditing()) return;                 // let the field handle its own undo
      e.preventDefault();
      if(k==="y"||(k==="z"&&e.shiftKey)) redo();
      else undo();
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[undo,redo]);

  const cams=Object.values(nodes).filter(n=>isCameraType(n.type));
  const dockedCams=cams.filter(c=>!detached.has(c.id));

  // Stable handlers for the props panel so a re-render of <Editor> (e.g. the
  // throttled animation preview tick) doesn't hand PropsPanel fresh function
  // identities every time. Combined with the memoized PropsPanel below, an
  // animation that doesn't affect the selected node won't re-render its editors.
  const panelOnChange=useCallback(p=>{ if(selected) updateNode(selected,p); },[selected,updateNode]);
  const panelOnAttach=useCallback((camId,childId)=>connect("cam",camId,childId),[connect]);
  const panelOnShareUrl=useCallback(()=>{ if(isCameraType(nodes[selected]?.type)) copyUrl("cam",selected); },[nodes,selected,copyUrl]);
  const panelOnConnectScalar=useCallback((scId,camId)=>connect("scalar",scId,camId),[connect]);
  const panelOnDisconnectScalar=useCallback((scId,camId)=>disconnect("scalar",scId,camId),[disconnect]);
  const panelOnPopOut=useCallback(()=>setPanelPopped(v=>!v),[]);

  const panelLayout=useMemo(()=>({side:panelSide,span:panelSpan,setSide:setPanelSide,setSpan:setPanelSpan}),[panelSide,panelSpan]);

  const propsPanelEl=(
    <PropsPanel node={selectedNode} nodes={nodes} scope={panelScope}
      onChange={panelOnChange}
      onAttach={panelOnAttach}
      onAddNode={addNode}
      onDelete={deleteNode} onToggleEnabled={toggleEnabled} onDetach={detachCamera}
      onOpenWindow={openWindow} onDockCamera={dockCamera}
      isWindowed={selected?detached.has(selected):false}
      onShareUrl={panelOnShareUrl}
      animValsRef={animValsRef}
      onConnectScalar={panelOnConnectScalar}
      onDisconnectScalar={panelOnDisconnectScalar}
      onPopOut={panelOnPopOut} popped={panelPopped}
      layout={panelLayout}/>
  );

  // Resize handle for the docked panel, placed on the edge facing the canvas.
  const panelResizeHandle=(
    <div onMouseDown={()=>{panelDrag.current=true;document.body.style.userSelect="none";}}
      title="Drag to resize"
      style={{width:5,flexShrink:0,cursor:"col-resize",background:"#0c0e1e",
        borderLeft:`1px solid ${ui.uiInputBorder}`,borderRight:`1px solid ${ui.uiInputBorder}`}}/>
  );
  // The docked properties panel (resize handle + panel), ordered for its side.
  const panelDock = !panelPopped && (
    <div style={{display:"flex",flexShrink:0}}>
      {panelSide==="right" && panelResizeHandle}
      <div style={{width:panelW,flexShrink:0,
        borderLeft:panelSide==="right"?`1px solid ${ui.uiInputBorder}`:"none",
        borderRight:panelSide==="left"?`1px solid ${ui.uiInputBorder}`:"none",
        overflow:"hidden",display:"flex",flexDirection:"column"}}>
        {propsPanelEl}
      </div>
      {panelSide==="left" && panelResizeHandle}
    </div>
  );
  return(
    <UICtx.Provider value={uiCtx}>
    <div style={{display:"flex",flexDirection:"column",position:"fixed",inset:0,overflow:"hidden",background:theme.canvasBg,fontFamily:"monospace"}}>
      {/* Top bar */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 14px",background:ui.uiPanelBar,borderBottom:`1px solid ${ui.uiInputBorder}`,flexShrink:0,zIndex:5}}>
        <span style={{color:ui.uiAccent,fontWeight:"bold",fontSize:17}}>◈</span>
        <span style={{color:ui.uiAccent,fontWeight:"bold",fontSize:16}}>{projectNode?.props.name||"Dedekind"}</span>
        <span style={{color:ui.uiFaint,fontSize:15}}>v0.9</span>
        <div style={{marginLeft:"auto",display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={undo} disabled={!hist.canUndo} title="Undo (Ctrl+Z)" style={{...uiCtx.S.btnSm,color:hist.canUndo?ui.uiAccent:ui.uiFaint,borderColor:(hist.canUndo?ui.uiAccent:ui.uiFaint)+"40",opacity:hist.canUndo?1:0.5,cursor:hist.canUndo?"pointer":"default"}}>↶</button>
          <button onClick={redo} disabled={!hist.canRedo} title="Redo (Ctrl+Shift+Z)" style={{...uiCtx.S.btnSm,color:hist.canRedo?ui.uiAccent:ui.uiFaint,borderColor:(hist.canRedo?ui.uiAccent:ui.uiFaint)+"40",opacity:hist.canRedo?1:0.5,cursor:hist.canRedo?"pointer":"default"}}>↷</button>
          <button onClick={loadDemo} title="Load the feature showcase" style={{...uiCtx.S.btnSm,color:ui.uiGood,borderColor:ui.uiGood+"55"}}>✦ demo</button>
          <button onClick={()=>copyUrl("project")} style={{...uiCtx.S.btnSm,color:copied==="project"?ui.uiGood:ui.uiAccent,borderColor:ui.uiAccent+"55"}}>{copied==="project"?"✓ copied":"⎘ copy url"}</button>
          {ALL_KINDS.filter(t=>kindEnabled(projectNode,t)).map(t=>{const m=TYPE_META[t]||{tc:ui.uiAccent,tag:t};return(
            <button key={t} onClick={()=>addNode(t)} style={{...uiCtx.S.btnSm,color:m.tc,borderColor:m.tc+"33",padding:"2px 5px",background:ui.uiBtnBg}}>+{m.tag}</button>
          );})}
        </div>
      </div>

      {/* Body: when the panel spans the full height it sits beside everything;
          otherwise it sits inside the main area (above the dock). */}
      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>
        {panelSpan==="full" && panelSide==="left" && panelDock}

        {/* Content column: canvas (+ docked panel when span is "main") then dock */}
        <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {/* Main area */}
          <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>
            {panelSpan==="main" && panelSide==="left" && panelDock}
            <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
              <NodeCanvas nodes={nodes} selected={selected} onSelect={setSelected} onMove={moveNode}
                onConnect={connect} onDisconnect={disconnect} onDelete={deleteNode}
                onToggleEnabled={toggleEnabled} onDetach={detachCamera} animValsRef={animValsRef} theme={theme} projectNode={projectNode}/>
            </div>
            {panelSpan==="main" && panelSide==="right" && panelDock}
          </div>

          {/* Resize handle (only when the dock is expanded) */}
          {!dockCollapsed&&<div onMouseDown={()=>{vpDrag.current=true;}} style={{height:5,flexShrink:0,cursor:"row-resize",background:"#0c0e1e",borderTop:"1px solid #151728"}}/>}

          {/* Dock bar — always visible; toggles the embedded viewports */}
          <div style={{display:"flex",alignItems:"center",gap:10,height:26,flexShrink:0,padding:"0 12px",background:ui.uiPanelBar,borderTop:"1px solid #151728",cursor:"pointer",userSelect:"none"}}
            onClick={()=>setDockCollapsed(c=>!c)}>
            <span style={{color:ui.uiMuted,fontFamily:"monospace",fontSize:12.5}}>{dockCollapsed?"▸":"▾"} viewports</span>
            <span style={{color:ui.uiFaint,fontFamily:"monospace",fontSize:11.5}}>
              {dockedCams.length} docked{detached.size?` · ${detached.size} windowed`:""}
            </span>
          </div>

          {/* Embedded viewports (docked cameras), shown when expanded */}
          {!dockCollapsed&&<div style={{height:vpH,flexShrink:0,background:"#07080e",borderTop:"1px solid #10122a"}}>
            <ViewportStrip nodes={nodes} scopeMap={scopeMap} theme={theme} detached={detached} projectNode={projectNode}
              onCameraChange={handleCameraChange} animValsRef={animValsRef} onUpdateNode={updateNode} onDetach={detachCamera}/>
          </div>}
        </div>

        {panelSpan==="full" && panelSide==="right" && panelDock}
      </div>

      {/* Detached floating windows */}
      {cams.filter(c=>detached.has(c.id)).map((cam,i)=>(
        <DetachedWindow key={cam.id} camNode={cam} nodes={nodes} scope={scopeMap[cam.id]||{}} theme={theme} projectNode={projectNode}
          initPos={{x:60+i*44,y:60+i*32}} onClose={()=>detachCamera(cam.id)} onDock={()=>dockCamera(cam.id)}
          onShareUrl={()=>copyUrl("cam",cam.id)}
          onCameraChange={patch=>handleCameraChange(cam.id,patch)}
          animValsRef={animValsRef} onUpdateNode={updateNode}/>
      ))}

      {/* Popped-out properties panel */}
      {panelPopped&&(
        <PropsPanelWindow initPos={{x:Math.max(20,window.innerWidth-440),y:80}} onClose={()=>setPanelPopped(false)}>
          {propsPanelEl}
        </PropsPanelWindow>
      )}
    </div>
    </UICtx.Provider>
  );
}

function Root(){
  const hash=window.location.hash.slice(1);
  // a fresh visit (no hash / not a share) starts on the landing overlay
  const isShare=(()=>{ if(!hash) return false; try{const raw=JSON.parse(decodeURIComponent(atob(hash)));return !!raw.share;}catch{return false;} })();
  const startOnLanding=!isShare && !hash;
  const [showLanding,setShowLanding]=useState(startOnLanding);
  const [closing,setClosing]=useState(false);
  const closeTimer=useRef(null);

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
    <Editor initialHash={hash}/>
    {showLanding && <Landing onOpen={()=>openEditor(true)} closing={closing}/>}
  </>;
}

export default function App(){
  useEffect(()=>{ ComputeWorker.init(); },[]);
  const hash=window.location.hash.slice(1);
  if(hash){try{const raw=JSON.parse(decodeURIComponent(atob(hash)));if(raw.share)return<SharePage data={raw}/>;}catch{}}
  return <Root/>;
}
