import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { catOf, isCameraType } from "../core/taxonomy.js";
import { collectScalarDeps } from "../core/scope.js";
import { rebuildScene } from "../geometry/rebuild.js";
import { build2DScene, drawGrid2D, drawLabels2D } from "../render2d/render2d-gpu.js";
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
    // Orientation. Per-builder code maps math (x,y,z) → three (x, z, y). We want
    // the on-screen frame: math X → RIGHT, math Z → UP, math Y → AWAY from the
    // viewer, i.e. world (x, z, −y) — the standard right-handed math frame
    // (X×Y = Z: (1,0,0)×(0,0,−1) = (0,1,0) = up). The group flips three-Z so the
    // builder output (x, z, y) becomes (x, z, −y). Determinant −1, composed with
    // the builders' −1 swap → +1 overall (right-handed). three.js auto-corrects
    // winding for negative-determinant matrices and the shaders light with
    // abs(dot(n,L)), so culling/shading are unaffected. Grid + lights stay on root.
    const world = new THREE.Group();
    world.scale.z = -1;   // builder (x,z,y) → world (x,z,−y): X right, Z up, Y away
    scene.add(world);
    // Screen-space fat-line curves (Line2) can't live under a negative-determinant
    // matrix — the LineMaterial vertex shader expands width in clip space and the
    // mirror collapses it to nothing (the "1-spaces stopped rendering" bug after
    // the camera went right-handed). They instead go in this UNMIRRORED sibling
    // (det +1) and carry final world coords baked into their geometry, so they
    // share the exact same on-screen frame without the broken mirror.
    const worldFlat = new THREE.Group();
    scene.add(worldFlat);
    world._unmirrored = worldFlat;

    // Axis triad (X red, Y green, Z blue), placed in builder three space (x, z, y)
    // so the group transform carries each arrow to its world direction:
    // X→right, Z→up, Y→away.
    const axes=new THREE.Group();
    {
      const L=4, RC=0.045, HC=0.16, HL=0.5;
      // math-axis → builder three-space unit direction: math(x,y,z)→three(x,z,y)
      const dirs=[
        {name:"x", col:0xff5a5a, v:new THREE.Vector3(1,0,0)}, // math X → three +X
        {name:"y", col:0x5ad06a, v:new THREE.Vector3(0,0,1)}, // math Y → three +Z
        {name:"z", col:0x5a9cff, v:new THREE.Vector3(0,1,0)}, // math Z → three +Y
      ];
      for(const {col,v} of dirs){
        const shaftLen=L-HL;
        const shaft=new THREE.Mesh(
          new THREE.CylinderGeometry(RC,RC,shaftLen,12),
          new THREE.MeshBasicMaterial({color:col}));
        shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), v);
        shaft.position.copy(v.clone().multiplyScalar(shaftLen/2));
        const head=new THREE.Mesh(
          new THREE.ConeGeometry(HC,HL,14),
          new THREE.MeshBasicMaterial({color:col}));
        head.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), v);
        head.position.copy(v.clone().multiplyScalar(shaftLen+HL/2));
        axes.add(shaft, head);
      }
    }
    world.add(axes);

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
      // Live orthographic zoom (half-height of the view box in world units, ×2 =
      // the camNode's orthoSize prop). The wheel mutates this in ortho mode since
      // an orthographic camera's on-screen scale comes from its frustum size, not
      // its distance — changing orb.radius alone does nothing visible.
      orthoSize:resolveNum(ip.orthoSize,{},10),
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
          orthoSize:orb.orthoSize.toFixed(4),
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
    const onWheel=e=>{
      e.preventDefault();
      const f=Math.exp(e.deltaY*0.001);
      const cn=stRef.current.camNode;
      if(cn?.props?.projection==="orthographic"){
        // Ortho: zoom by scaling the view-box size. Distance (radius) is irrelevant
        // to an orthographic projection's scale, so we scale orthoSize instead.
        orb.orthoSize=Math.max(0.05,Math.min(1000,orb.orthoSize*f));
      } else {
        orb.radius=Math.max(0.5,Math.min(500,orb.radius*f));
      }
      stRef.current.userMoved=true;updateCam();syncCamProps();
    };
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
        const orthoMode=cn?.props?.projection==="orthographic";
        if(keys["KeyR"]){ if(orthoMode)orb.orthoSize=Math.max(0.05,orb.orthoSize*0.985); else orb.radius=Math.max(0.5,orb.radius*0.985); moved=true;}
        if(keys["KeyF"]){ if(orthoMode)orb.orthoSize=Math.min(1000,orb.orthoSize*1.015); else orb.radius=Math.min(500,orb.radius*1.015); moved=true;}
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
          orb.orthoSize=resolveNum(p.orthoSize,s,10);
          updateCam();
        }
        const isOrtho=p.projection==="orthographic";activeCam=isOrtho?ortho:persp;
        if(!isOrtho){persp.fov=resolveNum(p.fov,s,50);persp.near=resolveNum(p.near,s,0.01);persp.far=resolveNum(p.far,s,2000);persp.updateProjectionMatrix();}
        else{const asp=(el.clientWidth||w)/(el.clientHeight||h);const os=orb.orthoSize/2;ortho.left=-os*asp;ortho.right=os*asp;ortho.top=os;ortho.bottom=-os;ortho.near=resolveNum(p.near,s,0.01);ortho.far=resolveNum(p.far,s,2000);ortho.updateProjectionMatrix();}
        rebuildScene(world,objMap,cn,ns,s,stRef.current.animValsRef?.current);
        // Seed correct viewport size into any screen-space LineMaterials just built.
        { const w2=el.clientWidth||w, h2=el.clientHeight||h;
          scene.traverse(o=>{if(o.material?._isCurve3d) o.material.resolution.set(w2,h2);}); }
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

    // Coalesce resize work into a single rAF: applying renderer.setSize inside the
    // ResizeObserver callback (which fires mid-layout) leaves the canvas at the old
    // backing-store size until the loop's next render, producing a visible flash on
    // drag-resize. Deferring to rAF guarantees the resize and the render that uses it
    // happen in the same frame, and also sidesteps the "ResizeObserver loop" warning.
    let resizeRaf=0, lastW=0, lastH=0;
    const applyResize=()=>{
      resizeRaf=0;
      const w2=el.clientWidth,h2=el.clientHeight;if(!w2||!h2)return;
      if(w2===lastW&&h2===lastH)return; // ignore no-op notifications (avoids RO loop)
      lastW=w2; lastH=h2;
      renderer.setSize(w2,h2,false);persp.aspect=w2/h2;persp.updateProjectionMatrix();
      const cn=stRef.current.camNode;
      if(cn?.props.projection==="orthographic"){const os=orb.orthoSize/2,asp=w2/h2;ortho.left=-os*asp;ortho.right=os*asp;ortho.top=os;ortho.bottom=-os;ortho.updateProjectionMatrix();}
      // Update screen-space LineMaterial resolution so curve widths stay correct.
      scene.traverse(o=>{if(o.material?._isCurve3d) o.material.resolution.set(w2,h2);});
      stRef.current.dirty=true;
    };
    const ro=new ResizeObserver(()=>{ if(!resizeRaf) resizeRaf=requestAnimationFrame(applyResize); });
    ro.observe(el);

    stRef.current={renderer,scene,axes,persp,ortho,orb,objMap,dirty:true,userMoved:false,camNode,nodes,scope,projectNode,onCameraChange,animValsRef};
    return()=>{
      clearTimeout(syncTimer);cancelAnimationFrame(rafId);if(resizeRaf)cancelAnimationFrame(resizeRaf);ro.disconnect();
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

// ── 2D Viewport (GPU — Three.js orthographic + 2D overlay chrome) ────────────
// Plot curves/fills/arrows live on the GPU; grid, axes and number labels are
// drawn on a 2D <canvas> overlay so they stay a crisp constant size at any zoom.
// Two dirty flags: `plotDirty` rebuilds the (expensive) GPU plot geometry only
// when nodes/scope change or an animator advances; `viewDirty` just re-renders
// and redraws the cheap overlay on pan/zoom/resize.
function Viewport2D({ camNode, nodes, scope, theme, animValsRef, onUpdateNode }) {
  const mountRef=useRef(null);
  const stRef=useRef({camNode,nodes,scope,theme,animValsRef,plotDirty:true,viewDirty:true});
  const rafRef=useRef(null);
  const viewRef=useRef({cx:0,cy:0,hh:5}); // world centre + half-height (world units)
  const interRef=useRef({down:false,lx:0,ly:0});

  useEffect(()=>{
    const container=mountRef.current; if(!container)return;

    // Three stacked layers (bottom → top):
    //   1. grid canvas   — background + grid + axes (so plots draw OVER the grid)
    //   2. WebGL canvas  — plot curves / fills / arrows (transparent clear)
    //   3. label canvas  — number labels + pointer input (always on top, readable)
    const gridCv=document.createElement("canvas");
    gridCv.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;display:block";
    container.appendChild(gridCv);
    const gctx=gridCv.getContext("2d");

    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,premultipliedAlpha:false});
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000,0); // transparent so the grid shows through
    renderer.domElement.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;display:block;pointer-events:none";
    container.appendChild(renderer.domElement);

    const labelCv=document.createElement("canvas");
    labelCv.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;display:block;cursor:crosshair";
    container.appendChild(labelCv);
    const lctx=labelCv.getContext("2d");
    const overlay=labelCv; // pointer input target

    const scene=new THREE.Scene();
    const cam=new THREE.OrthographicCamera(-1,1,1,-1,0.001,100);
    cam.position.set(0,0,10); cam.lookAt(0,0,0);

    let plotObjs=[];
    // Persistent per-plot geometry cache (childId → {sig, objs}). build2DScene
    // reuses unchanged plots so a playing animator / pan / zoom only regenerates
    // the plots that actually changed, instead of re-integrating every flow and
    // re-projecting every surface 60×/second.
    const plotCache=new Map();
    const inScene=new Set(); // objects currently added to the THREE scene

    let W=container.clientWidth||400, H=container.clientHeight||300;
    const dpr=window.devicePixelRatio||1;
    let sizedOnce=false;   // the first doResize() must always size the canvases/renderer
    const doResize=()=>{
      const w2=container.clientWidth||400, h2=container.clientHeight||300;
      if(sizedOnce && w2===W && h2===H) return; // no real change → skip (avoids RO loop + flash)
      sizedOnce=true;
      W=w2; H=h2;
      renderer.setSize(W,H,false);
      for(const [cv,cx] of [[gridCv,gctx],[labelCv,lctx]]){
        cv.width=W*dpr; cv.height=H*dpr;
        cv.style.width=W+"px"; cv.style.height=H+"px";
        cx._dpr=dpr;
      }
      stRef.current.viewDirty=true; stRef.current.plotDirty=true;
    };
    let resizeRaf=0;
    const resize=()=>{ if(!resizeRaf) resizeRaf=requestAnimationFrame(()=>{resizeRaf=0; doResize();}); };
    const ro=new ResizeObserver(resize); ro.observe(container); doResize();

    const extents=()=>{
      const v=viewRef.current;
      const hw=v.hh*(W/H||1);
      return{wxMin:v.cx-hw,wxMax:v.cx+hw,wyMin:v.cy-v.hh,wyMax:v.cy+v.hh};
    };
    const pxPerWorld=()=> (H/(2*viewRef.current.hh)); // pixels per world unit (y)
    const syncCam=()=>{
      const{wxMin,wxMax,wyMin,wyMax}=extents();
      cam.left=wxMin; cam.right=wxMax; cam.bottom=wyMin; cam.top=wyMax;
      cam.updateProjectionMatrix();
    };

    const rebuildPlots=()=>{
      const st=stRef.current;
      const th=st.theme||DEFAULT_THEME;
      const{wxMin,wxMax,wyMin,wyMax}=extents();
      const{plotObjs:po,dirty}=build2DScene(
        st.camNode,st.nodes,st.scope||{},st.animValsRef?.current,
        wxMin,wxMax,wyMin,wyMax,th,pxPerWorld(),plotCache
      );
      plotObjs=po;
      // Only touch the scene graph when the object SET changed (a cache miss).
      // On an all-hit frame this is a no-op, so the render is essentially free.
      if(dirty){
        const want=new Set(po);
        for(const o of inScene){ if(!want.has(o)){ scene.remove(o); inScene.delete(o); } }
        for(const o of po){ if(!inScene.has(o)){ scene.add(o); inScene.add(o); } }
        scene.background=null;
      }
      return dirty;
    };

    const redrawChrome=()=>{
      const st=stRef.current;
      const th={...(st.theme||DEFAULT_THEME),
        __showGrid: st.camNode?.props?.showGrid!==false,
        __showAxes: st.camNode?.props?.showAxes!==false};
      // custom background override is honoured by the grid layer
      if(st.camNode?.props?.bgOverride) th.bg2d=st.camNode.props.bgColor;
      drawGrid2D(gctx, viewRef.current, W, H, th);
      drawLabels2D(lctx, viewRef.current, W, H, th);
    };

    const loop=()=>{
      rafRef.current=requestAnimationFrame(loop);
      const st=stRef.current;
      // animator-driven plot updates: only mark dirty if a PLAYING animator
      // actually feeds this camera or one of its plots (cached plots that don't
      // depend on it stay hits and cost nothing).
      const ns=st.nodes, cn=st.camNode;
      if(ns&&cn){
        const playing=new Set(); for(const n of Object.values(ns)) if(n.type==="animator"&&n.playing) playing.add(n.id);
        if(playing.size){
          let live=false;
          const chk=(id)=>{const d=new Set();collectScalarDeps(id,ns,d,new Set());for(const x of d) if(playing.has(x)){live=true;break;}};
          chk(cn.id); if(!live) for(const pid of (cn.attachments||[])){ if(catOf(ns[pid]?.type)==="plot"){ chk(pid); if(live)break; } }
          if(live) st.plotDirty=true;
        }
      }
      if(!st.plotDirty && !st.viewDirty) return;
      const viewMoved=st.viewDirty;
      syncCam();
      let geomChanged=false;
      if(st.plotDirty){ st.plotDirty=false; geomChanged=rebuildPlots(); }
      st.viewDirty=false;
      // Re-render only when something visible actually changed: geometry was
      // rebuilt, or the camera/view moved (pan/zoom/resize). An all-cache-hit
      // animator frame with no view change does no GPU work at all.
      if(geomChanged || viewMoved){
        if(viewMoved) redrawChrome();
        renderer.render(scene,cam);
      }
    };
    rafRef.current=requestAnimationFrame(loop);

    // ── interaction (overlay sits on top, receives events) ──
    const ir=interRef.current;
    const onMD=e=>{e.preventDefault();ir.down=true;ir.lx=e.clientX;ir.ly=e.clientY;};
    const onMU=()=>{ir.down=false;};
    const onMM=e=>{
      if(!ir.down)return;
      const v=viewRef.current; const hw=v.hh*(W/H||1);
      v.cx-=(e.clientX-ir.lx)/W*hw*2;
      v.cy+=(e.clientY-ir.ly)/H*v.hh*2;
      ir.lx=e.clientX; ir.ly=e.clientY;
      // pan keeps geometry, only the view changed → also rebuild plots whose
      // domain auto-fills the view (fn1d/quiver use view extents), so mark both.
      stRef.current.viewDirty=true; stRef.current.plotDirty=true;
    };
    const onWheel=e=>{
      e.preventDefault();
      const v=viewRef.current; const f=e.deltaY<0?0.88:1.13;
      const rect=overlay.getBoundingClientRect();
      const hw=v.hh*(W/H||1);
      const wx=v.cx+((e.clientX-rect.left)/rect.width-0.5)*hw*2;
      const wy=v.cy-((e.clientY-rect.top)/rect.height-0.5)*v.hh*2;
      v.hh=Math.max(1e-4,Math.min(1e6,v.hh*f));
      const nhw=v.hh*(W/H||1);
      v.cx=wx-((e.clientX-rect.left)/rect.width-0.5)*nhw*2;
      v.cy=wy+((e.clientY-rect.top)/rect.height-0.5)*v.hh*2;
      // zoom changes pxPerWorld → arrows/points must re-size → rebuild plots
      stRef.current.viewDirty=true; stRef.current.plotDirty=true;
    };
    overlay.addEventListener("mousedown",onMD);
    window.addEventListener("mouseup",onMU);
    window.addEventListener("mousemove",onMM);
    overlay.addEventListener("wheel",onWheel,{passive:false});

    return()=>{
      cancelAnimationFrame(rafRef.current); if(resizeRaf)cancelAnimationFrame(resizeRaf); ro.disconnect();
      overlay.removeEventListener("mousedown",onMD);
      window.removeEventListener("mouseup",onMU);
      window.removeEventListener("mousemove",onMM);
      overlay.removeEventListener("wheel",onWheel);
      for(const o of inScene) scene.remove(o);
      for(const [,entry] of plotCache){ for(const o of entry.objs){ o.geometry?.dispose?.(); (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m?.dispose?.()); } }
      plotCache.clear(); inScene.clear();
      renderer.dispose();
      if(container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      if(container.contains(gridCv)) container.removeChild(gridCv);
      if(container.contains(labelCv)) container.removeChild(labelCv);
    };
  },[]);

  useEffect(()=>{ stRef.current={...stRef.current,camNode,nodes,scope,theme,animValsRef,plotDirty:true,viewDirty:true}; },[camNode,nodes,scope,theme,animValsRef]);

  return(
    <div ref={mountRef} style={{width:"100%",height:"100%",position:"relative",overflow:"hidden"}}>
      {animValsRef&&<ScalarOverlay camNode={camNode} nodes={nodes} scope={scope} animValsRef={animValsRef} onUpdateNode={onUpdateNode}/>}
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
