import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { catOf, isCameraType } from "../core/taxonomy.js";
import { collectScalarDeps } from "../core/scope.js";
import { rebuildScene } from "../geometry/rebuild.js";
import { render2D } from "../render2d/render2d.js";
import { disposeObjs, hexToThree } from "../geometry/three-helpers.js";
import { useUI } from "../theme/tokens.jsx";
import { buildTheme, DEFAULT_THEME } from "../theme/presets.js";
import { ScalarOverlay } from "./ScalarOverlay.jsx";
import { PropsPanelWindow, WBtn } from "./primitives.jsx";
import { resolveNum } from "../core/math.js";

// ── 3D Viewport ──────────────────────────────────────────────────────────────
function Viewport3D({ camNode, nodes, scope, projectNode, onCameraChange, animValsRef, onUpdateNode }) {
  const{ui,S}=useUI();
  const mountRef = useRef(null);
  const stRef = useRef({});

  useEffect(() => {
    const el = mountRef.current; if(!el) return;
    const renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(window.devicePixelRatio);
    const w=el.clientWidth||400,h=el.clientHeight||300;
    renderer.setSize(w,h,false);
    // setSize(...,false) leaves the canvas CSS size unmanaged; with a HiDPI
    // pixelRatio the drawing buffer is larger than the container, which makes the
    // canvas overflow and the scene render off-centre. Pin the canvas to fill its
    // container in CSS pixels so the displayed image always matches the viewport.
    renderer.domElement.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;display:block";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff,0.55));
    const dl=new THREE.DirectionalLight(0xffffff,0.85);dl.position.set(5,10,7);scene.add(dl);
    const axes=new THREE.AxesHelper(4);scene.add(axes);

    let gridObj=null,lastGc1=-1,lastGc2=-1;
    const getGrid=(gc1,gc2)=>{
      if(gc1===lastGc1&&gc2===lastGc2&&gridObj)return gridObj;
      if(gridObj){scene.remove(gridObj);gridObj.geometry?.dispose?.();if(Array.isArray(gridObj.material))gridObj.material.forEach(m=>m.dispose?.());else gridObj.material?.dispose?.();}
      gridObj=new THREE.GridHelper(20,20,gc1,gc2);scene.add(gridObj);lastGc1=gc1;lastGc2=gc2;return gridObj;
    };

    const persp=new THREE.PerspectiveCamera(50,w/h,0.01,2000);
    const ortho=new THREE.OrthographicCamera(-5,5,5,-5,0.01,2000);
    let activeCam=persp;

    const ip=camNode?.props||{};
    const orb={
      theta: resolveNum(ip.orbTheta,{},0.8),
      phi:   resolveNum(ip.orbPhi,{},1.0),
      radius:resolveNum(ip.orbRadius,{},14),
      target:new THREE.Vector3(resolveNum(ip.targetX,{},0),resolveNum(ip.targetZ,{},0),resolveNum(ip.targetY,{},0)),
    };
    const updateCam=()=>{
      const p=new THREE.Vector3(
        orb.target.x+orb.radius*Math.sin(orb.phi)*Math.sin(orb.theta),
        orb.target.y+orb.radius*Math.cos(orb.phi),
        orb.target.z+orb.radius*Math.sin(orb.phi)*Math.cos(orb.theta)
      );
      [persp,ortho].forEach(c=>{c.position.copy(p);c.lookAt(orb.target);});
    };
    updateCam();

    let syncTimer=null;
    const syncCamProps=()=>{
      clearTimeout(syncTimer);
      syncTimer=setTimeout(()=>{
        const{onCameraChange:cb,camNode:cn}=stRef.current;
        if(!cb||!cn)return;
        cb({props:{...cn.props,
          targetX: orb.target.x.toFixed(4),
          targetY: orb.target.z.toFixed(4),
          targetZ: orb.target.y.toFixed(4),
          orbTheta: orb.theta.toFixed(4),
          orbPhi:   orb.phi.toFixed(4),
          orbRadius:orb.radius.toFixed(4),
        }});
      },250);
    };

    const focusRef={current:false};
    const onFocus=()=>{focusRef.current=true;};
    const onBlur=()=>{focusRef.current=false;Object.keys(keys).forEach(k=>delete keys[k]);};
    let mouseBtn=-1,lx=0,ly=0;
    const onMD=e=>{e.preventDefault();mouseBtn=e.button;lx=e.clientX;ly=e.clientY;stRef.current.userMoved=true;onFocus();};
    const onMU=()=>{mouseBtn=-1;};
    const onMM=e=>{
      const dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;
      if(mouseBtn===0){orb.theta-=dx*0.005;orb.phi=Math.max(0.05,Math.min(Math.PI-0.05,orb.phi-dy*0.005));}
      else if(mouseBtn===2){
        const fwd=new THREE.Vector3(Math.sin(orb.phi)*Math.sin(orb.theta),Math.cos(orb.phi),Math.sin(orb.phi)*Math.cos(orb.theta));
        const right=new THREE.Vector3().crossVectors(fwd,new THREE.Vector3(0,1,0)).normalize();
        const ps=orb.radius*0.001;
        orb.target.addScaledVector(right,-dx*ps);orb.target.addScaledVector(new THREE.Vector3(0,1,0),dy*ps);
      }
      if(mouseBtn>=0){updateCam();syncCamProps();}
    };
    const onWheel=e=>{e.preventDefault();orb.radius=Math.max(0.5,Math.min(500,orb.radius*Math.exp(e.deltaY*0.001)));stRef.current.userMoved=true;updateCam();syncCamProps();};
    const keys={};
    const onKD=e=>{keys[e.code]=true;};
    const onKU=e=>{keys[e.code]=false;};

    renderer.domElement.setAttribute("tabindex","0");
    renderer.domElement.addEventListener("mousedown",onMD);
    renderer.domElement.addEventListener("contextmenu",e=>e.preventDefault());
    renderer.domElement.addEventListener("wheel",onWheel,{passive:false});
    renderer.domElement.addEventListener("focus",onFocus);
    renderer.domElement.addEventListener("blur",onBlur);
    window.addEventListener("mouseup",onMU);
    window.addEventListener("mousemove",onMM);
    window.addEventListener("keydown",onKD);
    window.addEventListener("keyup",onKU);
    const onPD=e=>{if(!renderer.domElement.contains(e.target))onBlur();};
    document.addEventListener("pointerdown",onPD,true);

    const objMap=new Map();let rafId;
    // True when any playing animator is (transitively) wired into a plot this
    // camera shows — i.e. its value can change the geometry each frame. Read
    // from live refs so there's no stale-closure problem.
    const cameraHasLiveAnimator=()=>{
      const cn=stRef.current.camNode, ns=stRef.current.nodes; if(!cn||!ns) return false;
      const playing=new Set();
      for(const n of Object.values(ns)) if(n.type==="animator"&&n.playing) playing.add(n.id);
      if(!playing.size) return false;
      // does any plot shown by this camera depend (transitively) on a playing animator?
      for(const plotId of (cn.attachments||[])){
        if(catOf(ns[plotId]?.type)!=="plot") continue;
        const deps=new Set(); collectScalarDeps(plotId, ns, deps, new Set());
        for(const d of deps) if(playing.has(d)) return true;
      }
      // or a playing animator wired straight to the camera
      const cdeps=new Set(); collectScalarDeps(cn.id, ns, cdeps, new Set());
      for(const d of cdeps) if(playing.has(d)) return true;
      return false;
    };
    const loop=()=>{
      rafId=requestAnimationFrame(loop);
      const{camNode:cn,nodes:ns,scope:sc,projectNode:pn}=stRef.current;
      // Keep rebuilding while a wired animator plays (geometry tracks its value).
      if(cameraHasLiveAnimator()) stRef.current.dirty=true;

      if(focusRef.current){
        const speed=orb.radius*0.004;
        const fwd=new THREE.Vector3(Math.sin(orb.phi)*Math.sin(orb.theta),0,Math.sin(orb.phi)*Math.cos(orb.theta)).normalize();
        const right=new THREE.Vector3().crossVectors(fwd,new THREE.Vector3(0,1,0)).normalize();
        let moved=false;
        if(keys["KeyW"]||keys["ArrowUp"])   {orb.target.addScaledVector(fwd,-speed);moved=true;}
        if(keys["KeyS"]||keys["ArrowDown"]) {orb.target.addScaledVector(fwd,speed);moved=true;}
        if(keys["KeyA"]||keys["ArrowLeft"]) {orb.target.addScaledVector(right,speed);moved=true;}
        if(keys["KeyD"]||keys["ArrowRight"]){orb.target.addScaledVector(right,-speed);moved=true;}
        if(keys["KeyQ"]||keys["PageUp"])    {orb.target.y+=speed;moved=true;}
        if(keys["KeyE"]||keys["PageDown"])  {orb.target.y-=speed;moved=true;}
        if(keys["KeyR"]){orb.radius=Math.max(0.5,orb.radius*0.985);moved=true;}
        if(keys["KeyF"]){orb.radius=Math.min(500,orb.radius*1.015);moved=true;}
        if(keys["KeyI"]){orb.phi=Math.max(0.05,orb.phi-0.018);moved=true;}
        if(keys["KeyK"]){orb.phi=Math.min(Math.PI-0.05,orb.phi+0.018);moved=true;}
        if(keys["KeyJ"]){orb.theta-=0.018;moved=true;}
        if(keys["KeyL"]){orb.theta+=0.018;moved=true;}
        if(moved){stRef.current.userMoved=true;updateCam();syncCamProps();}
      }

      if(stRef.current.dirty){
        stRef.current.dirty=false;
        const p=cn?.props||{},s=sc||{};
        const bgHex=p.bgOverride?p.bgColor:(pn?.props?.bg3d||"#070810");
        renderer.setClearColor(parseInt(bgHex.replace("#",""),16),1);
        const gc1=hexToThree(pn?.props?.grid3d||"#151b2a");
        const gc2=hexToThree(pn?.props?.grid3d2||"#0e1320");
        const grid=getGrid(gc1,gc2);
        grid.visible=p.showGrid!==false;
        axes.visible=p.showAxes!==false;
        if(!stRef.current.userMoved){
          orb.target.set(resolveNum(p.targetX,s,0),resolveNum(p.targetZ,s,0),resolveNum(p.targetY,s,0));
          orb.theta=resolveNum(p.orbTheta,s,0.8);
          orb.phi=resolveNum(p.orbPhi,s,1.0);
          orb.radius=resolveNum(p.orbRadius,s,14);
          updateCam();
        }
        const isOrtho=p.projection==="orthographic";activeCam=isOrtho?ortho:persp;
        if(!isOrtho){persp.fov=resolveNum(p.fov,s,50);persp.near=resolveNum(p.near,s,0.01);persp.far=resolveNum(p.far,s,2000);persp.updateProjectionMatrix();}
        else{const asp=(el.clientWidth||w)/(el.clientHeight||h);const os=resolveNum(p.orthoSize,s,10)/2;ortho.left=-os*asp;ortho.right=os*asp;ortho.top=os;ortho.bottom=-os;ortho.near=resolveNum(p.near,s,0.01);ortho.far=resolveNum(p.far,s,2000);ortho.updateProjectionMatrix();}
        rebuildScene(scene,objMap,cn,ns,s,stRef.current.animValsRef?.current);
        // Frame the orbit pivot on the actual visible geometry. Runs on an
        // explicit refit (reset-view button) so rotation always centers on
        // what's drawn, regardless of where the geometry sits in world space.
        if(stRef.current.refit){
          stRef.current.refit=false;
          const box=new THREE.Box3();
          let any=false;
          for(const objs of objMap.values()){
            for(const o of objs){
              if(!o.geometry) continue;
              o.updateWorldMatrix?.(true,false);
              const b=new THREE.Box3().setFromObject(o);
              if(b.isEmpty()) continue;
              box.union(b); any=true;
            }
          }
          if(any && isFinite(box.min.x)){
            const c=box.getCenter(new THREE.Vector3());
            const sphereR=box.getBoundingSphere(new THREE.Sphere()).radius||1;
            orb.target.copy(c);
            // pull back enough to fit the content for the current fov
            const fov=(resolveNum(p.fov,s,50))*Math.PI/180;
            orb.radius=Math.max(1.5, sphereR/Math.sin(Math.min(1.4,fov/2))*1.1);
            stRef.current.userMoved=true;   // keep the framed pivot from being reset next frame
            updateCam(); syncCamProps();
          }
        }
      }
      // Advance flowing-glyph animation every frame (cheap uniform write, no
      // geometry rebuild). Keeps running independent of the dirty flag.
      {
        const tnow=(performance.now()-(stRef.current.t0||(stRef.current.t0=performance.now())))/1000;
        for(const objs of objMap.values()){
          if(!objs._glyphAnim) continue;
          for(const o of objs){ if(o.material?.uniforms?.uTime) o.material.uniforms.uTime.value=tnow; }
        }
      }
      renderer.render(scene,activeCam);
    };
    loop();

    const ro=new ResizeObserver(()=>{
      const w2=el.clientWidth,h2=el.clientHeight;if(!w2||!h2)return;
      renderer.setSize(w2,h2,false);persp.aspect=w2/h2;persp.updateProjectionMatrix();
      const cn=stRef.current.camNode,sc=stRef.current.scope||{};
      if(cn?.props.projection==="orthographic"){const os=resolveNum(cn.props.orthoSize,sc,10)/2,asp=w2/h2;ortho.left=-os*asp;ortho.right=os*asp;ortho.top=os;ortho.bottom=-os;ortho.updateProjectionMatrix();}
    });
    ro.observe(el);

    stRef.current={renderer,scene,axes,persp,ortho,orb,objMap,dirty:true,userMoved:false,camNode,nodes,scope,projectNode,onCameraChange,animValsRef};
    return()=>{
      clearTimeout(syncTimer);cancelAnimationFrame(rafId);ro.disconnect();
      renderer.domElement.removeEventListener("mousedown",onMD);renderer.domElement.removeEventListener("wheel",onWheel);
      renderer.domElement.removeEventListener("focus",onFocus);renderer.domElement.removeEventListener("blur",onBlur);
      window.removeEventListener("mouseup",onMU);window.removeEventListener("mousemove",onMM);
      window.removeEventListener("keydown",onKD);window.removeEventListener("keyup",onKU);
      document.removeEventListener("pointerdown",onPD,true);
      renderer.dispose();if(el.contains(renderer.domElement))el.removeChild(renderer.domElement);
    };
  },[]);

  useEffect(()=>{
    if(stRef.current.camNode?.id!==camNode?.id) stRef.current.userMoved=false;
    stRef.current.camNode=camNode;
    stRef.current.nodes=nodes;
    stRef.current.scope=scope;
    stRef.current.projectNode=projectNode;
    stRef.current.onCameraChange=onCameraChange;
    stRef.current.dirty=true;
  },[camNode,nodes,scope,projectNode,onCameraChange]);

  const handleReset=useCallback(()=>{stRef.current.userMoved=false;stRef.current.refit=true;stRef.current.dirty=true;},[]);

  return(
    <div ref={mountRef} style={{width:"100%",height:"100%",cursor:"grab",position:"relative"}}>
      {camNode.props.showResetBtn!==false&&<button onClick={handleReset} style={{position:"absolute",bottom:8,left:8,...S.btnSm,color:ui.uiAccent,borderColor:ui.uiAccent+"44",zIndex:2,pointerEvents:"auto"}}>⟳ reset view</button>}
      {camNode.props.showHints&&<div style={{position:"absolute",bottom:8,right:8,color:"#1c2a3a",fontSize:14,fontFamily:"monospace",pointerEvents:"none",lineHeight:1.8,textAlign:"right"}}>
        LMB orbit · RMB pan · scroll zoom<br/>WASD/↑↓←→ pan · QE up/dn<br/>IJKL orbit · R/F zoom
      </div>}
      {animValsRef && <ScalarOverlay camNode={camNode} nodes={nodes} scope={scope} animValsRef={animValsRef} onUpdateNode={onUpdateNode}/>}
    </div>
  );
}

// ── 2D Viewport ──────────────────────────────────────────────────────────────
function Viewport2D({ camNode, nodes, scope, theme, animValsRef, onUpdateNode }) {
  const mountRef=useRef(null),canvasRef=useRef(null);
  const stRef=useRef({camNode,nodes,scope,theme,dirty:true});
  const rafRef=useRef(null),interRef=useRef({down:false,lx:0,ly:0});
  useEffect(()=>{
    const container=mountRef.current;if(!container)return;
    const canvas=document.createElement("canvas");canvas.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair";
    canvas._view={panX:0,panY:0,zoom:1};canvasRef.current=canvas;container.appendChild(canvas);
    const resize=()=>{canvas.width=container.clientWidth;canvas.height=container.clientHeight;stRef.current.dirty=true;};
    const ro=new ResizeObserver(resize);ro.observe(container);resize();
    const loop=()=>{rafRef.current=requestAnimationFrame(loop);
      const ns=stRef.current.nodes, cn=stRef.current.camNode;
      if(ns&&cn){
        const playing=new Set(); for(const n of Object.values(ns)) if(n.type==="animator"&&n.playing) playing.add(n.id);
        if(playing.size){
          let live=false; const chk=(id)=>{const d=new Set();collectScalarDeps(id,ns,d,new Set());for(const x of d) if(playing.has(x)) live=true;};
          chk(cn.id); for(const pid of (cn.attachments||[])) if(catOf(ns[pid]?.type)==="plot") chk(pid);
          if(live) stRef.current.dirty=true;
        }
      }
      if(!stRef.current.dirty)return;stRef.current.dirty=false;render2D(canvasRef.current,stRef.current.camNode,stRef.current.nodes,stRef.current.scope||{},stRef.current.theme||DEFAULT_THEME,stRef.current.animValsRef?.current);};
    rafRef.current=requestAnimationFrame(loop);
    const ir=interRef.current;
    const onMD=e=>{e.preventDefault();ir.down=true;ir.lx=e.clientX;ir.ly=e.clientY;};
    const onMU=()=>{ir.down=false;};
    const onMM=e=>{if(!ir.down)return;const v=canvas._view;v.panX+=e.clientX-ir.lx;v.panY+=e.clientY-ir.ly;ir.lx=e.clientX;ir.ly=e.clientY;stRef.current.dirty=true;};

    // Zoom toward the cursor: keep the world point under the mouse fixed on
    // screen. With cx=W/2+panX, scale'=scale*f, solving cx' so the cursor's
    // world point stays put gives cx' = mx - (mx-cx)*f  ⇒  panX' = cx' - W/2.
    const onWheel=e=>{
      e.preventDefault();
      const v=canvas._view;
      const f=e.deltaY<0?1.12:0.89;
      const rect=canvas.getBoundingClientRect();
      const sx=canvas.width/(rect.width||1), sy=canvas.height/(rect.height||1);
      const mx=(e.clientX-rect.left)*sx, my=(e.clientY-rect.top)*sy;
      const cx=canvas.width/2+v.panX, cy=canvas.height/2+v.panY;
      const cxp=mx-(mx-cx)*f, cyp=my-(my-cy)*f;
      v.panX=cxp-canvas.width/2;
      v.panY=cyp-canvas.height/2;
      v.zoom*=f;
      stRef.current.dirty=true;
    };
    canvas.addEventListener("mousedown",onMD);window.addEventListener("mouseup",onMU);window.addEventListener("mousemove",onMM);canvas.addEventListener("wheel",onWheel,{passive:false});
    return()=>{cancelAnimationFrame(rafRef.current);ro.disconnect();canvas.removeEventListener("mousedown",onMD);window.removeEventListener("mouseup",onMU);window.removeEventListener("mousemove",onMM);canvas.removeEventListener("wheel",onWheel);if(container.contains(canvas))container.removeChild(canvas);};
  },[]);
  useEffect(()=>{stRef.current={camNode,nodes,scope,theme,dirty:true,animValsRef};},[camNode,nodes,scope,theme]);
  return(
    <div ref={mountRef} style={{width:"100%",height:"100%",position:"relative",overflow:"hidden"}}>
      {animValsRef && <ScalarOverlay camNode={camNode} nodes={nodes} scope={scope} animValsRef={animValsRef} onUpdateNode={onUpdateNode}/>}
    </div>
  );
}

function ViewportSwitch({ camNode, nodes, scope, theme, projectNode, onCameraChange, animValsRef, onUpdateNode }) {
  if(!camNode)return null;
  return camNode.props.mode==="2d"
    ?<Viewport2D camNode={camNode} nodes={nodes} scope={scope} theme={theme} animValsRef={animValsRef} onUpdateNode={onUpdateNode}/>
    :<Viewport3D camNode={camNode} nodes={nodes} scope={scope} projectNode={projectNode} onCameraChange={onCameraChange} animValsRef={animValsRef} onUpdateNode={onUpdateNode}/>;
}

// ── Detached floating window ─────────────────────────────────────────────────
function DetachedWindow({ camNode, nodes, scope, theme, projectNode, onClose, onDock, initPos, onShareUrl, onCameraChange, animValsRef, onUpdateNode }) {
  const{ui,S}=useUI();
  const[pos,setPos]=useState(initPos||{x:80,y:80});
  const[sz,setSz]=useState({w:500,h:360});
  const[min,setMin]=useState(false);
  const dr=useRef(false),rz=useRef(false);
  useEffect(()=>{
    const mm=e=>{if(dr.current)setPos(p=>({x:p.x+e.movementX,y:p.y+e.movementY}));if(rz.current)setSz(s=>({w:Math.max(240,s.w+e.movementX),h:Math.max(160,s.h+e.movementY)}));};
    const mu=()=>{dr.current=false;rz.current=false;};
    window.addEventListener("mousemove",mm);window.addEventListener("mouseup",mu);
    return()=>{window.removeEventListener("mousemove",mm);window.removeEventListener("mouseup",mu);};
  },[]);
  return(
    <div style={{position:"fixed",left:pos.x,top:pos.y,width:sz.w,height:min?32:sz.h,background:ui.uiPanelBar,border:`1px solid ${ui.uiBtnBorder}`,borderRadius:8,overflow:"hidden",zIndex:1000,boxShadow:"0 12px 48px #000c",display:"flex",flexDirection:"column",userSelect:"none"}}>
      <div onMouseDown={()=>{dr.current=true;}} style={{display:"flex",alignItems:"center",gap:8,padding:"0 8px",height:32,flexShrink:0,background:ui.uiBtnBg,borderBottom:min?"none":`1px solid ${ui.uiInputBorder}`,cursor:"grab"}}>
        <span style={{color:ui.uiAccent,fontSize:16}}>◈</span>
        <span style={{color:ui.uiHeading,fontSize:16,fontFamily:"monospace",fontWeight:"bold",flex:1}}>{camNode.label}</span>
        <span style={{color:ui.uiMuted,fontSize:14,fontFamily:"monospace"}}>{camNode.props.mode==="2d"?"2D":camNode.props.projection}</span>
        {camNode.props.showShareBtn!==false&&<button onClick={onShareUrl} style={{...S.btnSm,color:ui.uiAccent,borderColor:ui.uiAccent+"55",fontSize:14}}>⎘ share</button>}
        {onDock&&<button onClick={onDock} title="Dock to the bottom strip" style={{...S.btnSm,color:ui.uiAccent,borderColor:ui.uiAccent+"55",fontSize:14}}>⊟ dock</button>}
        <WBtn color={ui.uiAccent} onClick={()=>setMin(m=>!m)}>{min?"▼":"▲"}</WBtn>
        <WBtn color={ui.uiDanger} onClick={onClose}>×</WBtn>
      </div>
      {!min&&<>
        <div style={{flex:1,minHeight:0,position:"relative"}}>
          <ViewportSwitch camNode={camNode} nodes={nodes} scope={scope} theme={theme} projectNode={projectNode} onCameraChange={onCameraChange} animValsRef={animValsRef} onUpdateNode={onUpdateNode}/>
        </div>
        <div onMouseDown={()=>{rz.current=true;}} style={{position:"absolute",bottom:0,right:0,width:14,height:14,cursor:"nwse-resize",background:`linear-gradient(135deg,transparent 50%,${ui.uiBtnBorder} 50%)`,borderRadius:"0 0 8px 0"}}/>
      </>}
    </div>
  );
}

// ── Viewport strip ───────────────────────────────────────────────────────────
function ViewportStrip({ nodes, scopeMap, theme, detached, projectNode, onCameraChange, animValsRef, onUpdateNode, onDetach }) {
  const{ui,S}=useUI();
  const cams=Object.values(nodes).filter(n=>isCameraType(n.type)&&n.enabled&&!detached.has(n.id));
  if(!cams.length)return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:ui.uiFaint,fontFamily:"monospace",fontSize:16}}>no docked cameras · open one from its node or the properties panel</div>;
  return<div style={{display:"flex",height:"100%",overflow:"hidden"}}>
    {cams.map((cam,i)=>(
      <div key={cam.id} style={{flex:1,borderLeft:i>0?`1px solid ${ui.uiInputBorder}`:"none",position:"relative",overflow:"hidden"}}>
        {cam.props.showCamLabel!==false&&<div style={{position:"absolute",top:5,left:7,zIndex:10,color:ui.uiAccent,fontSize:14,fontFamily:"monospace",background:"#0009",padding:"1px 6px",borderRadius:3,pointerEvents:"none"}}>{cam.label} · {cam.props.mode==="2d"?"2D":cam.props.projection||"persp"}</div>}
        {onDetach&&<button onClick={()=>onDetach(cam.id)} title="Open in window" style={{position:"absolute",top:5,right:7,zIndex:11,...S.btnSm,color:ui.uiAccent,borderColor:ui.uiAccent+"55",fontSize:13,padding:"1px 6px"}}>⊞</button>}
        <ViewportSwitch camNode={cam} nodes={nodes} scope={scopeMap[cam.id]||{}} theme={theme} projectNode={projectNode}
          onCameraChange={patch=>onCameraChange(cam.id,patch)} animValsRef={animValsRef} onUpdateNode={onUpdateNode}/>
      </div>
    ))}
  </div>;
}

export {
  Viewport3D, Viewport2D, ViewportSwitch, DetachedWindow, ViewportStrip
};
