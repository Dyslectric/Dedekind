import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { catOf, canAttach, SCALAR_TYPES, isCameraType } from "./core/taxonomy.js";
import { buildScopeForCamera, resolveScope, collectScalarDeps } from "./core/scope.js";
import { serializeProject, deserializeProject, serializeCameraShare, deserializeCameraShare, isShareHash, migrateModel } from "./core/serialize.js";
import { makeNode, makeInitialScene, makeDemoScene, TYPE_META, PROJECT_ID } from "./nodes/model.js";
import { collectDependencies, collectConnected, buildSelectionPayload, importSelection } from "./core/graph.js";
import { uid, makeFn, resolveNum } from "./core/math.js";
import { kindEnabled, ADDABLE_KINDS, ALL_KINDS } from "./nodes/kinds.js";
import { UICtx, UI_DEFAULTS, buildUI, makeS, darken, relLum } from "./theme/tokens.jsx";
import { buildTheme } from "./theme/presets.js";
import { useAnimators } from "./hooks/useAnimators.js";
import { makeDemoProject } from "./landing/previews.jsx";

// Demo route: a URL hash like "#demo" or "#demo=clebsch" boots the editor
// straight into a curated showcase scene (default: the Clebsch cubic). Lets you
// open a striking scene from the address bar with no setup.
function demoKindFromHash(hash){
  if(hash==="demo") return "clebsch";
  const m = /^demo=([a-z0-9_]+)$/i.exec(hash||"");
  return m ? m[1] : null;
}
import { setUISetting } from "./core/uisettings.js";
import { useHistory } from "./hooks/useHistory.js";
import { NodeCanvas } from "./components/NodeCanvas.jsx";
import { PropsPanel } from "./components/PropsPanel.jsx";
import { ViewportStrip, ViewportSwitch, DetachedWindow, useIsMobile } from "./components/Viewport.jsx";
import { PropsPanelWindow } from "./components/primitives.jsx";
import { Landing } from "./landing/Landing.jsx";
import { Tutorials, isTutorialsHash } from "./landing/Tutorials.jsx";
import { lazy, Suspense } from "react";
// Benchmark harness is a dev/perf tool — lazy-load it so it splits into its own
// chunk and never ships to normal visitors (only downloads on the #bench route).
const Benchmarks = lazy(()=>import("./bench/Benchmarks.jsx").then(m=>({default:m.Benchmarks})));
const isBenchHash = (h) => (h||"").replace(/^#/,"").split("?")[0] === "bench";

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

function Editor({initialHash, active=true}){
  const initialNodes=useMemo(()=>{
    const demoKind = demoKindFromHash(initialHash);
    if(demoKind){ try{ const d=makeDemoProject(demoKind); if(d) return d; }catch{} }
    if(initialHash){const l=deserializeProject(initialHash);if(l)return l;}
    return makeInitialScene();
  },[]);
  const hist=useHistory(initialNodes);
  const nodes=hist.state;
  // User-facing edits record history (coalescing rapid bursts like a drag).
  const setNodes=hist.set;
  // Animator playback commits (e.g. a "once" loop finishing) must NOT create
  // undo points — route them through the silent setter.
  const setNodesSilent=hist.setSilent;
  const[selected,setSelected]=useState(null);
  // Multi-selection: a set of node ids. `selected` is the PRIMARY node (drives
  // the properties editor); `selectionSet` is the full set (includes primary).
  // A plain click selects one (set = {id}); shift+click toggles membership.
  const[selectionSet,setSelectionSet]=useState(()=>new Set());
  const[clipMsg,setClipMsg]=useState(null);   // transient status for copy/import
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
    const iv=setInterval(()=>{
      // Don't re-render the editor while the user is typing in a math field. The
      // animTick re-render exists only to refresh live evaluated-value previews in
      // the props panel; firing it mid-edit re-feeds the field its (not-yet-
      // propagated) prop value and snaps the edit back. The live preview pausing
      // for the moment a field is focused is imperceptible; losing the edit isn't.
      const ae=document.activeElement;
      if(ae && ae.closest && ae.closest("[data-math-input]")) return;
      setAnimTick(t=>t+1);
    },1000/PREVIEW_HZ);
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


  const projectNode=useMemo(()=>Object.values(nodes).find(n=>n.type==="project"),[nodes]);
  const theme=useMemo(()=>buildTheme(projectNode),[projectNode]);
  const ui=useMemo(()=>buildUI(projectNode),[projectNode]);
  const uiCtx=useMemo(()=>({ui,S:makeS(ui)}),[ui]);
  // Mirror the project's math-input-mode preference into the shared UI-settings
  // holder that the EI/XF input wrappers subscribe to (they're too far down the
  // tree to thread the project node to).
  useEffect(()=>{ setUISetting("mathInputMode", projectNode?.props?.mathInputMode || "live"); },[projectNode]);
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
    if(!selectedNode) return {};
    // A node's editing scope = ONLY the scalars/functions resolved from its own
    // transitive deps. We do NOT merge the global scope — that would cause every
    // unrelated named variable to appear as "evaluated" (highlighted) in the
    // expression inputs even when the node has no dependency on them.
    const animVals=selectedAnimated?animValsRef.current:{};
    const sc=resolveScope(selectedNode.id,nodes,animVals);
    // For a fnDef or expr node being viewed, include the node's own result in
    // scope so expression-input previews can see it as an evaluated value.
    if(selectedNode.type==="fnDef" && selectedNode.name && selectedNode.props?.expr){
      const params=(selectedNode.props.params||"x").split(",").map(s=>s.trim()).filter(Boolean);
      sc[selectedNode.name]=makeFn(selectedNode.name,params,selectedNode.props.expr,sc);
    }
    if(selectedNode.type==="expr" && selectedNode.name && selectedNode.props?.expr!==undefined){
      sc[selectedNode.name]=resolveNum(selectedNode.props.expr,sc,0);
    }
    return sc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selectedNode,nodes,panelTick,selectedAnimated]);

  const urlTimer=useRef(null);
  useEffect(()=>{
    // Don't touch the URL while the landing overlay is still showing — the
    // editor is mounted underneath it from the start, but until the user
    // actually opens it we must leave the address bar untouched (otherwise a
    // fresh visit rewrites the hash to the default project before any click).
    if(!active) return;
    clearTimeout(urlTimer.current);
    urlTimer.current=setTimeout(()=>{const s=serializeProject(nodes);if(s)window.history.replaceState(null,"","#"+s);},800);
    return()=>clearTimeout(urlTimer.current);
  },[nodes,active]);

  const copyUrl=useCallback((type,camId)=>{
    const s=type==="project"?serializeProject(nodes):serializeCameraShare(camId,nodes);
    navigator.clipboard?.writeText(window.location.origin+window.location.pathname+"#"+s);
    setCopied(type==="project"?"project":camId);setTimeout(()=>setCopied(null),1800);
  },[nodes]);

  const updateNode=useCallback((id,patch)=>setNodes(ns=>({...ns,[id]:{...ns[id],...patch}})),[setNodes]);
  const moveNode=useCallback((id,pos)=>setNodes(ns=>({...ns,[id]:{...ns[id],pos}})),[setNodes]);
  // Batch move: apply a {id:pos} map in a single update so a group drag is one
  // atomic change (and a single coalesced history entry).
  const moveNodes=useCallback((posById)=>setNodes(ns=>{
    const next={...ns};
    for(const [id,pos] of Object.entries(posById)) if(next[id]) next[id]={...next[id],pos};
    return next;
  }),[setNodes]);

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
    setSelectionSet(prev=>{ if(!prev.has(id)) return prev; const n=new Set(prev); n.delete(id); return n; });
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
    setSelectionSet(new Set());
    beginStep();
    setNodes(makeDemoScene());
  },[setNodes,beginStep]);
  const addNode=useCallback((type,attachToCamId=null)=>{
    const node=makeNode(type);
    beginStep();
    setNodes(ns=>{const next={...ns,[node.id]:node};if(attachToCamId&&ns[attachToCamId])next[attachToCamId]={...ns[attachToCamId],attachments:[...ns[attachToCamId].attachments,node.id]};return next;});
    setSelected(node.id);
    setSelectionSet(new Set([node.id]));
  },[setNodes,beginStep]);

  // Add a node at a specific world position, optionally auto-wiring it to a set
  // of existing nodes. Used by the node-editor canvas letter-key shortcuts:
  //  - plain (no wiring): drop a fresh node under the cursor.
  //  - wireFrom: the new node should CONSUME each listed node (they are
  //    dependencies whose output drives the new node's input).
  //  - wireInto: the new node should DRIVE each listed node (the new node is a
  //    dependency feeding each listed consumer's input).
  // Only links permitted by canAttach are made; the rest are silently skipped.
  // Everything happens in a single history step so it's one undo.
  const addNodeAt=useCallback((type,pos,opts={})=>{
    const wireFrom=(opts.wireFrom||[]).filter(id=>id&&id!==undefined);
    const wireInto=(opts.wireInto||[]).filter(id=>id&&id!==undefined);
    const node=makeNode(type,pos);
    beginStep();
    setNodes(ns=>{
      const next={...ns,[node.id]:node};
      // new node consumes each wireFrom dep (dep → new)
      for(const depId of wireFrom){
        const dep=next[depId]; if(!dep) continue;
        if(!canAttach(dep.type,node.type)) continue;
        if((next[node.id].attachments||[]).includes(depId)) continue;
        next[node.id]={...next[node.id],attachments:[...(next[node.id].attachments||[]),depId]};
      }
      // new node drives each wireInto consumer (new → consumer)
      for(const consId of wireInto){
        const cons=next[consId]; if(!cons) continue;
        if(!canAttach(node.type,cons.type)) continue;
        if((cons.attachments||[]).includes(node.id)) continue;
        next[consId]={...cons,attachments:[...(cons.attachments||[]),node.id]};
      }
      return next;
    });
    setSelected(node.id);
    setSelectionSet(new Set([node.id]));
  },[setNodes,beginStep]);
  // Plain click: select exactly one (or clear when id is null). Shift+click:
  // toggle the clicked node in/out of the set; the clicked node becomes primary
  // when added, and when the primary is removed we hand primary to any remaining
  // member. Passing null with additive=false clears everything.
  const selectNode=useCallback((id, additive=false)=>{
    if(id==null){ setSelected(null); setSelectionSet(new Set()); return; }
    if(!additive){ setSelected(id); setSelectionSet(new Set([id])); return; }
    setSelectionSet(prev=>{
      const next=new Set(prev);
      if(next.has(id)){
        next.delete(id);
        setSelected(s=> s===id ? (next.size?[...next][next.size-1]:null) : s);
      } else {
        next.add(id);
        setSelected(id);
      }
      return next;
    });
  },[]);

  // Select every node (so the user can then shift+click to subtract specific
  // nodes from a near-complete selection). Excludes the project singleton, which
  // isn't a graph node the user manipulates.
  const selectAll=useCallback(()=>{
    const ids=Object.values(nodes).filter(n=>n.type!=="project").map(n=>n.id);
    setSelectionSet(new Set(ids));
    setSelected(s=>(s&&nodes[s]&&nodes[s].type!=="project")?s:(ids[0]??null));
  },[nodes]);

  // Replace the whole selection with a given set of ids (used by the expand
  // buttons / shortcuts). Primary becomes the previous primary if still present,
  // else the first id.
  const setSelectionTo=useCallback((idsIterable)=>{
    const ids=[...idsIterable].filter(id=>nodes[id]);
    const set=new Set(ids);
    setSelectionSet(set);
    setSelected(s=> (s&&set.has(s)) ? s : (ids[0]??null));
  },[nodes]);

  // Rectangular (marquee) selection. mode "add" unions the hit ids into the
  // current selection; mode "subtract" removes them. Primary is kept if still
  // selected, otherwise handed to any remaining member.
  const marqueeSelect=useCallback((ids, mode)=>{
    const hit=[...ids].filter(id=>nodes[id]&&nodes[id].type!=="project");
    if(!hit.length) return;
    setSelectionSet(prev=>{
      const next=new Set(prev);
      if(mode==="subtract") for(const id of hit) next.delete(id);
      else for(const id of hit) next.add(id);
      setSelected(s=>{
        if(s&&next.has(s)) return s;
        if(mode!=="subtract") return hit[hit.length-1];   // newest added becomes primary
        return next.size?[...next][next.size-1]:null;
      });
      return next;
    });
  },[nodes]);

  // Expand current selection to include every node the selection DEPENDS ON
  // (transitive upstream via attachments).
  const expandToDependencies=useCallback(()=>{
    setSelectionSet(prev=>{
      const seeds=prev.size?prev:(selected?new Set([selected]):new Set());
      if(!seeds.size) return prev;
      const grown=collectDependencies(seeds, nodes);
      setSelected(s=>(s&&grown.has(s))?s:[...grown][0]??null);
      return grown;
    });
  },[nodes,selected]);

  // Expand current selection to its full connected component (undirected).
  const expandToConnected=useCallback(()=>{
    setSelectionSet(prev=>{
      const seeds=prev.size?prev:(selected?new Set([selected]):new Set());
      if(!seeds.size) return prev;
      const grown=collectConnected(seeds, nodes);
      setSelected(s=>(s&&grown.has(s))?s:[...grown][0]??null);
      return grown;
    });
  },[nodes,selected]);

  // Copy the current selection (full node JSON, internal edges only) to clipboard.
  const copySelection=useCallback(async()=>{
    const ids=selectionSet.size?selectionSet:(selected?new Set([selected]):new Set());
    if(!ids.size){ setClipMsg("nothing selected"); setTimeout(()=>setClipMsg(null),1500); return; }
    const payload=buildSelectionPayload(ids, nodes);
    const json=JSON.stringify(payload,null,2);
    try{
      await navigator.clipboard.writeText(json);
      setClipMsg(`copied ${payload.nodes.length} node${payload.nodes.length!==1?"s":""}`);
    }catch{
      // Clipboard API unavailable (insecure context / permissions) — fall back to
      // a prompt so the user can still grab the JSON manually.
      window.prompt("Copy selection JSON:", json);
      setClipMsg("copy via dialog");
    }
    setTimeout(()=>setClipMsg(null),1800);
  },[selectionSet,selected,nodes]);

  // Read + parse a selection payload from the clipboard (with prompt fallback),
  // returning a validated import result or null (and setting a status message on
  // failure). `placement` is forwarded to importSelection (offset or center).
  const readAndImport=useCallback(async(placement)=>{
    let text=null;
    try{ text=await navigator.clipboard.readText(); }
    catch{ text=window.prompt("Paste selection JSON:"); }
    if(!text){ setClipMsg("clipboard empty"); setTimeout(()=>setClipMsg(null),1500); return null; }
    let payload=null;
    try{ payload=JSON.parse(text); }
    catch{ setClipMsg("invalid JSON"); setTimeout(()=>setClipMsg(null),1800); return null; }
    const result=importSelection(payload, uid, placement);
    if(!result){ setClipMsg("not a selection"); setTimeout(()=>setClipMsg(null),1800); return null; }
    return result;
  },[]);

  const commitImport=useCallback((result)=>{
    beginStep();
    setNodes(ns=>({...ns, ...result.nodes}));
    setSelectionTo(result.ids);
    setClipMsg(`imported ${result.ids.length} node${result.ids.length!==1?"s":""}`);
    setTimeout(()=>setClipMsg(null),1800);
  },[beginStep,setNodes,setSelectionTo]);

  // Import a selection payload from the clipboard, merging it as new nodes with
  // fresh ids, then select the freshly imported cluster (top-bar button — uses
  // the default fixed offset).
  const importFromClipboard=useCallback(async()=>{
    const result=await readAndImport({});
    if(result) commitImport(result);
  },[readAndImport,commitImport]);

  // Paste the clipboard selection centered on a world-space point (Ctrl+V from
  // the canvas, centered under the cursor).
  const pasteAtWorld=useCallback(async(worldPoint)=>{
    const result=await readAndImport(worldPoint?{center:worldPoint}:{});
    if(result) commitImport(result);
  },[readAndImport,commitImport]);


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

  // Selection shortcuts. Ctrl/⌘+A selects all nodes (so you can shift+click to
  // subtract); Ctrl/⌘+C copies the selection to the clipboard; Ctrl/⌘+Shift+D
  // grows the selection to everything it depends on; Ctrl/⌘+Shift+C grows it to
  // the full connected component. All suppressed while editing a text field.
  //
  // We match on e.code (the physical key: "KeyC", "KeyD", "KeyA") rather than
  // e.key, because with Shift held some layouts report a shifted/!-letter
  // e.key, which made the letter comparison miss.
  useEffect(()=>{
    const isEditing=()=>{
      const el=document.activeElement;if(!el)return false;
      const tag=el.tagName;
      // LiveMathInput's host is a focusable <div> (we manage its caret), not a
      // native input/contentEditable — it flags itself with data-math-input so
      // global shortcuts (select-all, copy) defer to it while it has focus.
      if(el.getAttribute && el.getAttribute("data-math-input")!=null) return true;
      return tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||el.isContentEditable;
    };
    const onKey=e=>{
      const mod=e.ctrlKey||e.metaKey;
      if(!mod) return;
      if(isEditing()) return;
      const code=e.code;
      if(code==="KeyA"&&!e.shiftKey){ e.preventDefault(); selectAll(); return; }
      // Ctrl/⌘+C (no shift): copy selection — but only when there isn't an active
      // page text selection, so the browser's normal text-copy still works.
      if(code==="KeyC"&&!e.shiftKey){
        const hasTextSel=(window.getSelection?.()?.toString()||"").length>0;
        if(hasTextSel) return;
        e.preventDefault(); copySelection(); return;
      }
      if(!e.shiftKey) return;
      if(code!=="KeyD"&&code!=="KeyC") return;
      e.preventDefault();
      if(code==="KeyD") expandToDependencies();
      else expandToConnected();
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[expandToDependencies,expandToConnected,selectAll,copySelection]);

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
      onDisconnect={disconnect}
      onPopOut={panelOnPopOut} popped={panelPopped}
      selectionSet={selectionSet}
      onCopySelection={copySelection}
      onSelectDependencies={expandToDependencies}
      onSelectConnected={expandToConnected}
      layout={panelLayout}/>
  );

  // Resize handle for the docked panel, placed on the edge facing the canvas.
  const panelResizeHandle=(
    <div onMouseDown={()=>{panelDrag.current=true;document.body.style.userSelect="none";}}
      title="Drag to resize"
      style={{width:5,flexShrink:0,cursor:"col-resize",background:ui.uiPanelBar,
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
          <button onClick={importFromClipboard} title="Import a selection (JSON) from the clipboard as new nodes" style={{...uiCtx.S.btnSm,color:ui.uiAccent,borderColor:ui.uiAccent+"55"}}>⇲ import sel</button>
          {clipMsg&&<span style={{color:ui.uiGood,fontSize:12.5,fontFamily:"monospace"}}>{clipMsg}</span>}
          {ALL_KINDS.filter(t=>kindEnabled(projectNode,t)).map(t=>{const m=TYPE_META[t]||{tc:ui.uiAccent,tag:t};
            // Identity colors are light pastels; on a light/mid toolbar they
            // vanish. Darken proportionally to how light the button bg is so the
            // label keeps ~AA contrast across dark, mid (Ableton) and light themes.
            const bl=relLum(ui.uiBtnBg||"#0c0e20");
            const amt=bl>0.6?0.7:bl>0.3?0.64:bl>0.12?0.42:0;
            const tcol=amt>0?darken(m.tc,amt):m.tc;
            return(
            <button key={t} onClick={()=>addNode(t)} style={{...uiCtx.S.btnSm,color:tcol,borderColor:tcol+"55",padding:"2px 5px",background:ui.uiBtnBg}}>+{m.tag}</button>
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
              <NodeCanvas nodes={nodes} selected={selected} selectionSet={selectionSet} onSelect={selectNode} onMove={moveNode} onMoveMany={moveNodes}
                onConnect={connect} onDisconnect={disconnect} onDelete={deleteNode}
                onMarqueeSelect={marqueeSelect} onPasteAtWorld={pasteAtWorld}
                onToggleEnabled={toggleEnabled} onDetach={detachCamera} onUpdateNode={updateNode} animValsRef={animValsRef} theme={theme} projectNode={projectNode}
                onAddNodeAt={addNodeAt}/>
            </div>
            {panelSpan==="main" && panelSide==="right" && panelDock}
          </div>

          {/* Resize handle (only when the dock is expanded) */}
          {!dockCollapsed&&<div onMouseDown={()=>{vpDrag.current=true;}} style={{height:5,flexShrink:0,cursor:"row-resize",background:ui.uiPanelBar,borderTop:`1px solid ${ui.uiInputBorder}`}}/>}

          {/* Dock bar — always visible; toggles the embedded viewports */}
          <div style={{display:"flex",alignItems:"center",gap:10,height:26,flexShrink:0,padding:"0 12px",background:ui.uiPanelBar,borderTop:`1px solid ${ui.uiInputBorder}`,cursor:"pointer",userSelect:"none"}}
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
    <Editor initialHash={hash} active={!showLanding && !tutorials}/>
    {showLanding && !tutorials && <Landing onOpen={()=>openEditor(true)} closing={closing}/>}
    {tutorials && <Tutorials onExit={exitTutorials}/>}
  </>;
}

export default function App(){
  // Benchmark harness (#bench): gated before any hook so the rules of hooks hold
  // (this component returns early and runs no hooks of its own on the bench path).
  if(isBenchHash(window.location.hash)) return <Suspense fallback={<div style={{minHeight:"100vh",background:"#070810"}}/>}><Benchmarks/></Suspense>;
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
