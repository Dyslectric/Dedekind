import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { resolveNum, safeEval, linspace, splitTopLevel, derivativeExpr } from "../core/math.js";
import { compileToJS } from "../core/jit.js";
import { exprToGLSL, _glslNum, GLSL_UNIFORM_PREFIX, fnTableFromScope, augmentScopeForGPU } from "./glsl.js";
import { hexToThree, makeSurfaceShader } from "./three-helpers.js";

// Target on-screen thickness for 1-space curves in 3D cameras (CSS pixels).
const CURVE_3D_PX = 2.6;
// Scratch matrix for per-frame view-space normal-matrix recompute on lit surfaces.
const _normMV = new THREE.Matrix4();

// When a surface is composed from user fnDefs, exprToGLSL inlines them and the
// scalars inside those fnDef bodies become shader uniforms by name. Those scalars
// live in the fnDef's own scope, so resolution must use the AUGMENTED scope. This
// guard rejects the GPU path (→ CPU fallback) if any collected uniform can't be
// resolved to a finite value there, so a composed surface never silently renders
// with a missing (zeroed) coefficient. Only applied when fnDefs are present, so
// plain surfaces keep their exact existing behavior.
function gpuUniformsResolvable(uniforms, ascope){
  for(const u of uniforms){ if(!Number.isFinite(Number(ascope[u]))) return false; }
  return true;
}

// Attempt a GPU-evaluated surface. Returns [mesh, wire] or null if the
// expression(s) can't be translated to GLSL.
function buildSurfGPU(kind, p, scope, color, tex, ntex, nstr, lights){
  // a parametrized grid of (u,v) or (x,y) in [0,1]^2 mapped to the domain
  const showWire = p.showWire!==false;
  const fnTable=fnTableFromScope(scope);
  const ascope=fnTable?augmentScopeForGPU(scope):scope;
  let bodyP, uniforms=new Set(), umin, umax, vmin, vmax, ures, vres;
  if(kind==="surf3d"){
    const gx=exprToGLSL(p.expr, new Set(["x","y"]), uniforms, GLSL_UNIFORM_PREFIX, fnTable);
    if(gx==null) return null;
    umin=resolveNum(p.xMin,scope,-4); umax=resolveNum(p.xMax,scope,4);
    vmin=resolveNum(p.yMin,scope,-4); vmax=resolveNum(p.yMax,scope,4);
    const res=Math.max(2,Math.min(512,resolveNum(p.res,scope,40))); ures=res; vres=res;
    // _gd.x∈[0,1]→x, _gd.y∈[0,1]→y, z=f(x,y). The grid-coord vec2 is named `_gd`
    // (not `d`) so a user scalar called `d` stays a distinct uniform inside the
    // shader. Domain bounds are UNIFORMS (uDomU/uDomV), not baked literals, so
    // animating a bound is a per-frame uniform write — no shader recompile.
    bodyP = `x = uDomU.x + _gd.x*(uDomU.y - uDomU.x);
             y = uDomV.x + _gd.y*(uDomV.y - uDomV.x);
             float zz = ${gx}; vec3 P = vec3(x, y, zz);`;
  } else if(kind==="paramsurf"){
    const sx=exprToGLSL(p.exprX,new Set(["u","v"]),uniforms,GLSL_UNIFORM_PREFIX,fnTable);
    const sy=exprToGLSL(p.exprY,new Set(["u","v"]),uniforms,GLSL_UNIFORM_PREFIX,fnTable);
    const sz=exprToGLSL(p.exprZ,new Set(["u","v"]),uniforms,GLSL_UNIFORM_PREFIX,fnTable);
    if(sx==null||sy==null||sz==null) return null;
    umin=resolveNum(p.uMin,scope,0); umax=resolveNum(p.uMax,scope,Math.PI*2);
    vmin=resolveNum(p.vMin,scope,0); vmax=resolveNum(p.vMax,scope,Math.PI);
    ures=Math.max(2,Math.min(512,resolveNum(p.uRes,scope,40)));
    vres=Math.max(2,Math.min(512,resolveNum(p.vRes,scope,30)));
    bodyP = `float u = uDomU.x + _gd.x*(uDomU.y - uDomU.x);
             float v = uDomV.x + _gd.y*(uDomV.y - uDomV.x);
             vec3 P = vec3(${sx}, ${sy}, ${sz});`;
  } else return null;

  // ── Opt-in per-fragment lighting (Stages 1/2/4). When p.shading==="lit", build
  // a `shade` descriptor: for a graph surface z=f(x,y) we transpile the SYMBOLIC
  // derivatives f_x,f_y so the fragment shader computes an exact analytic normal;
  // if either derivative can't be taken or transpiled (null), the shader falls
  // back to screen-space dFdx/dFdy. paramsurf always uses the fallback (no
  // closed-form normal for an arbitrary parametric map). Derivative uniforms are
  // collected into the SAME set so their sliders are declared + resolvable.
  let shade=null, matOpts=null;
  if(p.shading==="lit"){
    let fxG=null, fyG=null;
    if(kind==="surf3d"){
      const fxs=derivativeExpr(p.expr,"x"), fys=derivativeExpr(p.expr,"y");
      if(fxs) fxG=exprToGLSL(fxs, new Set(["x","y"]), uniforms, GLSL_UNIFORM_PREFIX, fnTable);
      if(fys) fyG=exprToGLSL(fys, new Set(["x","y"]), uniforms, GLSL_UNIFORM_PREFIX, fnTable);
    }
    // Stage 3 material channels — per-fragment expressions over the domain (x,y)
    // + wired scalars/animators. Graph surfaces only (they expose (x,y); a
    // parametric surface's vDomain is grid coords, not its own params). Each is
    // optional and transpile-or-skip: a null GLSL just omits that channel.
    let colorG=null, specG=null, emitG=null;
    if(kind==="surf3d"){
      const ax=new Set(["x","y"]);
      if(p.matColor) colorG=exprToGLSL(p.matColor, ax, uniforms, GLSL_UNIFORM_PREFIX, fnTable);
      if(p.matSpec)  specG=exprToGLSL(p.matSpec,  ax, uniforms, GLSL_UNIFORM_PREFIX, fnTable);
      if(p.matEmit)  emitG=exprToGLSL(p.matEmit,  ax, uniforms, GLSL_UNIFORM_PREFIX, fnTable);
    }
    shade={ fx:fxG, fy:fyG, specExpr:specG, emitExpr:emitG, emitColor:p.matEmitColor };
    if(p.matColorMode==="texture" && tex){
      // Texture albedo (works for any surface — sampled at the UV grid coord),
      // with the optional UV transform.
      shade.texture=tex;
      shade.uv={ scaleU:resolveNum(p.uvScaleU,scope,1), scaleV:resolveNum(p.uvScaleV,scope,1),
                 offU:resolveNum(p.uvOffU,scope,0), offV:resolveNum(p.uvOffV,scope,0),
                 rot:resolveNum(p.uvRot,scope,0) };
      matOpts={ shade };
    } else if(colorG){
      matOpts={ colorBody:colorG,
        colorLo:new THREE.Color(hexToThree(p.matColorLo||"#3a6aff")),
        colorHi:new THREE.Color(hexToThree(p.matColorHi||"#ff5ea8")),
        cmin:resolveNum(p.matColorMin, scope, -1),
        cmax:resolveNum(p.matColorMax, scope, 1),
        shade };
    } else {
      matOpts={ shade };
    }
    // Normal map — perturbs the lit normal, independent of the colour channel.
    if(ntex){
      shade.normalTex=ntex;
      shade.normalStrength=(nstr==null?1:nstr);
      if(!shade.uv) shade.uv={ scaleU:resolveNum(p.uvScaleU,scope,1), scaleV:resolveNum(p.uvScaleV,scope,1),
                 offU:resolveNum(p.uvOffU,scope,0), offV:resolveNum(p.uvOffV,scope,0),
                 rot:resolveNum(p.uvRot,scope,0) };
    }
    if(lights && lights.length) shade.lights=lights;   // scene lights → multi-light shading
  }

  // Composed surface: bail to CPU if an inlined fnDef pulled in a scalar we can't
  // resolve (so it never renders with a zeroed coefficient).
  if(fnTable && !gpuUniformsResolvable(uniforms, ascope)) return null;

  // Pass the initial domain so the shader's uDomU/uDomV uniforms start correct;
  // they are refreshed each frame by updateGpuUniforms, which re-resolves the
  // bound EXPRESSIONS (so an animator/slider in a bound updates live, no rebuild).
  const domExpr = kind==="surf3d"
    ? { uMin:p.xMin, uMax:p.xMax, vMin:p.yMin, vMax:p.yMax }
    : { uMin:p.uMin, uMax:p.uMax, vMin:p.vMin, vMax:p.vMax };
  return assembleSurfGPU(bodyP, [...uniforms], ascope, color, ures, vres, showWire,
    matOpts, { uDomU:[umin,umax], uDomV:[vmin,vmax],
            expr:domExpr, defs:{ uMin:umin, uMax:umax, vMin:vmin, vMax:vmax } }, p.wireOnly===true);
}
// Given a GLSL body that sets `vec3 P` (math-order x,y,z) from grid coords d∈[0,1]²,
// build the unit grid geometry + fill/wire shader meshes. Shared by analytic
// surfaces and GPU-accelerated graph-mode transformers. `colorOpts` (optional):
// { colorBody, colorLo, colorHi, cmin, cmax } enables per-vertex gradient fill.
function assembleSurfGPU(bodyP, uNames, scope, color, ures, vres, showWire, colorOpts, domain, wireOnly){
  const geo = new THREE.PlaneGeometry(1,1, ures-1, vres-1);
  const arr = geo.attributes.position.array;
  for(let i=0;i<arr.length;i+=3){ arr[i]+=0.5; arr[i+1]+=0.5; arr[i+2]=0; }
  geo.attributes.position.needsUpdate = true;
  // Wire-only: render the grid lines alone, no shaded fill. Used to draw a line
  // FAMILY (e.g. a tangent-line sweep) where the isolines are the content and a
  // solid sheet would bury them. The wire gets full opacity here since there is
  // no fill behind it.
  if(wireOnly){
    const matW = makeSurfaceShader(bodyP, uNames, scope, color, true, null, domain, GLSL_UNIFORM_PREFIX);
    matW.uniforms.uColor.value = new THREE.Color(hexToThree(color));
    matW.transparent = true; matW.opacity = 0.5;
    const w = new THREE.Mesh(geo, matW);
    w.frustumCulled = false;
    w._gpuSurface = { uNames, domain: domain||null, uPrefix: GLSL_UNIFORM_PREFIX };
    return [w];
  }
  const matFill = makeSurfaceShader(bodyP, uNames, scope, color, false, colorOpts, domain, GLSL_UNIFORM_PREFIX);
  const mesh = new THREE.Mesh(geo, matFill);
  // Lit surfaces light per-fragment in VIEW space and need the object→view normal
  // matrix in the FRAGMENT stage (three only exposes normalMatrix to the vertex
  // stage). Recompute it here each frame from the live camera so it stays correct
  // as the camera orbits and through the renderer's mirror group (negative scale).
  if(matFill._lit){
    mesh.onBeforeRender = (renderer, scene, camera) => {
      const u = matFill.uniforms.uNormalMat; if(!u) return;
      _normMV.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
      u.value.getNormalMatrix(_normMV);
    };
  }
  // The grid is a unit [0,1]² plane displaced to the real domain in the vertex
  // shader, so three.js's CPU-side bounding volume (a tiny 1×1 patch) does NOT
  // reflect where the surface actually is. Without disabling frustum culling the
  // mesh gets culled the moment the camera frames the displaced geometry — which
  // looked like "only the wireframe renders / fill is invisible".
  mesh.frustumCulled = false;
  // `domain` (uDomU/uDomV) is recorded so updateGpuUniforms can refresh the
  // bounds each frame — animating a domain bound costs one uniform write, no
  // rebuild. uNames covers the expression uniforms (sliders in exprX/Y/Z).
  mesh._gpuSurface = { uNames, domain: domain||null, uPrefix: GLSL_UNIFORM_PREFIX, lights: (colorOpts&&colorOpts.shade&&colorOpts.shade.lights)||null };
  if(showWire===false) return [mesh];
  const matWire = makeSurfaceShader(bodyP, uNames, scope, color, true, null, domain, GLSL_UNIFORM_PREFIX);
  matWire.uniforms.uColor.value = new THREE.Color(hexToThree(color)).multiplyScalar(1.4);
  // Wireframe shares the SAME geometry (no clone): two meshes can reference one
  // BufferGeometry, halving vertex memory and skipping a full-buffer clone on
  // each rebuild. Dispose must not double-free, so the wire is flagged shared.
  const wire = new THREE.Mesh(geo, matWire);
  wire.frustumCulled = false;
  wire._sharedGeometry = true;
  wire._gpuSurface = { uNames, domain: domain||null, uPrefix: GLSL_UNIFORM_PREFIX };
  return [mesh, wire];
}
// GPU-accelerated SPHERICAL transformer: a 2-input map r = f(θ,φ) drawn as a
// surface, with vertex positions computed in the shader. θ (=x grid coord) is the
// azimuth and φ (=y) the polar angle; out0 is the radius. The point is placed at
// (r·sinφ·cosθ, r·sinφ·sinθ, r·cosφ) in math order — the surface shader applies
// the math→three swap itself. Returns null (→ CPU buildSurf) if out0 can't
// transpile to GLSL. This is the parallel-friendly case worth accelerating: every
// vertex is independent, so the whole grid evaluates in one shader pass.
function buildTransformerSphericalGPU(tp, outs, scope, color){
  const aMin=resolveNum(tp.aMin,scope,0),aMax=resolveNum(tp.aMax,scope,6.2832);
  const bMin=resolveNum(tp.bMin,scope,0),bMax=resolveNum(tp.bMax,scope,3.14159);
  const res=Math.max(2,Math.min(512,Math.round(resolveNum(tp.res,scope,40))));
  const fnTable=fnTableFromScope(scope);
  const ascope=fnTable?augmentScopeForGPU(scope):scope;
  const uniforms=new Set();
  // radius from out0, in terms of grid symbols x=θ, y=φ
  const rG=exprToGLSL(outs[0]||"0", new Set(["x","y"]), uniforms, GLSL_UNIFORM_PREFIX, fnTable);
  if(rG==null) return null;
  if(fnTable && !gpuUniformsResolvable(uniforms, ascope)) return null;
  // grid coords _gd.x∈[0,1]→θ (x), _gd.y∈[0,1]→φ (y); then place the spherical
  // point. `_r` holds the radius once so the expression is evaluated a single time.
  const bodyP = `x = ${_glslNum(aMin)} + _gd.x*${_glslNum(aMax-aMin)};
                 y = ${_glslNum(bMin)} + _gd.y*${_glslNum(bMax-bMin)};
                 float _r = ${rG};
                 float _sp = sin(y);
                 vec3 P = vec3(_r*_sp*cos(x), _r*_sp*sin(x), _r*cos(y));`;
  return assembleSurfGPU(bodyP, [...uniforms], ascope, color, res, res, tp.showWire!==false);
}

// GPU-accelerated graph-mode transformer with TWO inputs → a surface.
// The two input axes sweep a grid (a,b) ∈ [aMin,aMax]×[bMin,bMax], mapped to the
// map's input symbols x=a, y=b. Each world axis (X,Y,Z math-order) is filled by
// an input value or, if an output is assigned to it, the output expression
// (outputs win on collision — matching placeGraph). Returns null if any needed
// output expression isn't GLSL-translatable, or the config isn't a 2-in graph.
//   tp     : transformer props (per-output bindings outAxis0..3 ∈ x/y/z/color/none)
//   outs   : array of output expression strings (out0..outN), length = outDim
//   inDim/outDim : map dimensions
//   colorInfo (optional): { lo, hi, cmin, cmax } for a gradient fill driven by
//     whichever output is bound to "color". Returns null (→ CPU) if an output
//     expression isn't GLSL-translatable or the config isn't a 2-in graph.
function buildTransformerGraphGPU(tp, outs, inDim, outDim, scope, color, colorInfo, tex, ntex, nstr, lights, directSpec){
  if(inDim!==2) return null;                      // only 2-input → surface here
  const AX={x:0,y:1,z:2};                          // color/none/undefined → not spatial
  const aMin=resolveNum(tp.aMin,scope,-5),aMax=resolveNum(tp.aMax,scope,5);
  const bMin=resolveNum(tp.bMin,scope,-5),bMax=resolveNum(tp.bMax,scope,5);
  const res=Math.max(2,Math.min(512,Math.round(resolveNum(tp.res,scope,40))));
  const fnTable=fnTableFromScope(scope);
  const ascope=fnTable?augmentScopeForGPU(scope):scope;
  const uniforms=new Set();
  // input grid coords in map symbols: x=a, y=b
  const inAx=[tp.inAxis0,tp.inAxis1,tp.inAxis2];
  const outAx=[tp.outAxis0,tp.outAxis1,tp.outAxis2,tp.outAxis3];
  // world[axis] default 0; place inputs, then outputs (outputs overwrite)
  const world=["0.0","0.0","0.0"];
  const inSym=["x","y"];               // grid coords mapped to these GLSL vars
  for(let k=0;k<inDim;k++){ const ax=AX[inAx[k]]; if(ax!=null) world[ax]=inSym[k]; }
  // Transpile each output expression once (needed for axis placement and color).
  const outGLSL=[];
  for(let k=0;k<outDim;k++){
    const g=exprToGLSL(outs[k]||"0", new Set(["x","y"]), uniforms, GLSL_UNIFORM_PREFIX, fnTable);
    if(g==null) return null;           // unsupported expr → caller uses CPU path
    outGLSL[k]=g;
  }
  // ── Lit shading + material on the transformer (per the design: shading is a
  // plot parameter of the renderer, not of the map). Reads the domain (x,y) — the
  // map's two inputs. Analytic normals come from the output bound to z, but only
  // for the canonical height graph (inputs→x,y, an output→z); other axis bindings
  // use the screen-space fallback. Material color is mode "ramp" (scalar→two
  // colours) or "rgb" (three expressions). All optional; default off.
  const ax2=new Set(["x","y"]);
  let matOpts=null;
  if(tp.shading==="lit"){
    let fxG=null,fyG=null;
    const zIdx=outAx.findIndex(a=>a==="z");
    if(inAx[0]==="x" && inAx[1]==="y" && zIdx>=0 && zIdx<outDim){
      const fxs=derivativeExpr(outs[zIdx]||"0","x"), fys=derivativeExpr(outs[zIdx]||"0","y");
      if(fxs) fxG=exprToGLSL(fxs,ax2,uniforms,GLSL_UNIFORM_PREFIX,fnTable);
      if(fys) fyG=exprToGLSL(fys,ax2,uniforms,GLSL_UNIFORM_PREFIX,fnTable);
    }
    const specG=tp.matSpec?exprToGLSL(tp.matSpec,ax2,uniforms,GLSL_UNIFORM_PREFIX,fnTable):null;
    const emitG=tp.matEmit?exprToGLSL(tp.matEmit,ax2,uniforms,GLSL_UNIFORM_PREFIX,fnTable):null;
    const shade={ fx:fxG, fy:fyG, specExpr:specG, emitExpr:emitG, emitColor:tp.matEmitColor, unlit:tp.matUnlit===true };
    const uvObj={ scaleU:resolveNum(tp.uvScaleU,scope,1), scaleV:resolveNum(tp.uvScaleV,scope,1),
                  offU:resolveNum(tp.uvOffU,scope,0), offV:resolveNum(tp.uvOffV,scope,0),
                  rot:resolveNum(tp.uvRot,scope,0) };
    const mode=tp.matColorMode||"off";
    if(mode==="rgb"){
      const r=tp.matR?exprToGLSL(tp.matR,ax2,uniforms,GLSL_UNIFORM_PREFIX,fnTable):null;
      const g=tp.matG?exprToGLSL(tp.matG,ax2,uniforms,GLSL_UNIFORM_PREFIX,fnTable):null;
      const b=tp.matB?exprToGLSL(tp.matB,ax2,uniforms,GLSL_UNIFORM_PREFIX,fnTable):null;
      if(r&&g&&b) shade.rgb=[r,g,b];
      matOpts={ shade };
    } else if(mode==="texture" && tex){
      // sampled at the surface's UV (the unit grid coord) in the shader
      shade.texture=tex; shade.uv=uvObj;
      matOpts={ shade };
    } else if(mode==="ramp" && tp.matColor){
      const cG=exprToGLSL(tp.matColor,ax2,uniforms,GLSL_UNIFORM_PREFIX,fnTable);
      matOpts = cG
        ? { colorBody:cG, colorLo:new THREE.Color(hexToThree(tp.matColorLo||"#3a6aff")), colorHi:new THREE.Color(hexToThree(tp.matColorHi||"#ff5ea8")), cmin:resolveNum(tp.matColorMin,scope,-1), cmax:resolveNum(tp.matColorMax,scope,1), shade }
        : { shade };
    } else { matOpts={ shade }; }
    // Normal map perturbs the lighting normal regardless of the colour mode.
    if(ntex){ shade.normalTex=ntex; shade.normalStrength=(nstr==null?1:nstr); if(!shade.uv) shade.uv=uvObj; }
    if(lights && lights.length) shade.lights=lights;   // scene lights → multi-light shading
  }
  if(fnTable && !gpuUniformsResolvable(uniforms, ascope)) return null;
  for(let k=0;k<outDim;k++){
    const ax=AX[outAx[k]]; if(ax==null) continue;   // skip color/none/unbound
    world[ax]=outGLSL[k];
  }
  // grid coord setup: _gd.x∈[0,1]→a (x symbol), _gd.y∈[0,1]→b (y symbol). The
  // grid vec2 is `_gd` (not `d`) so a user scalar named `d` — e.g. the ripple's
  // decay slider — is not shadowed by the sampling parameter inside the shader.
  const bodyP = `x = ${_glslNum(aMin)} + _gd.x*${_glslNum(aMax-aMin)};
                 y = ${_glslNum(bMin)} + _gd.y*${_glslNum(bMax-bMin)};
                 vec3 P = vec3(${world[0]}, ${world[1]}, ${world[2]});`;
  // ── Direct colour styles (rgb / hsl / huemag / cyclic) → per-fragment albedo.
  // Each colour sub-expression may reference out0..outN; we transpile it with
  // those names known, then substitute each outK with its already-transpiled
  // output GLSL so the shader recomputes the output inline. If anything can't
  // transpile, return null → CPU per-vertex fallback (still correct, just slower).
  let albedoBody=null;
  if(directSpec){
    const knownC=new Set(["x","y"]); for(let k=0;k<outDim;k++) knownC.add(`out${k}`);
    const subOut=(g)=>{ if(g==null) return null; let s=g; for(let k=0;k<outDim;k++){ s=s.replace(new RegExp(`\\b${GLSL_UNIFORM_PREFIX}out${k}\\b|\\bout${k}\\b`,"g"), `(${outGLSL[k]})`); } return s; };
    const tr=(e,d)=>{ if(e==null||e==="") return d; const g=exprToGLSL(e,knownC,uniforms,GLSL_UNIFORM_PREFIX,fnTable); return g==null?null:subOut(g); };
    const st=directSpec.style;
    if(st==="rgb"){
      const r=tr(directSpec.colorR,"0.0"), g=tr(directSpec.colorG,"0.0"), b=tr(directSpec.colorB,"0.0");
      if(r!=null&&g!=null&&b!=null) albedoBody=`vec3(${r}, ${g}, ${b})`;
    } else if(st==="hsl"){
      const h=tr(directSpec.colorH,"0.0"), s=tr(directSpec.colorS,"0.9"), l=tr(directSpec.colorL,"0.5");
      if(h!=null&&s!=null&&l!=null) albedoBody=`_hsl2rgb(${h}, clamp(${s},0.0,1.0), clamp(${l},0.0,1.0))`;
    } else if(st==="cyclic"){
      // angle-like scalar source → hue wheel
      const src=directSpec.source;
      let ae=null;
      const m=/^out(\d+)$/.exec(src);
      if(m) ae=`(${outGLSL[Math.min(outDim-1,+m[1])]})`;
      else if(src==="expr") ae=tr(directSpec.colorExpr,"0.0");
      if(ae!=null) albedoBody=`_hsl2rgb((${ae})/6.28318530718, 0.9, 0.5)`;
    } else if(st==="huemag"){
      // a 2-D source → (re,im) → domain colour. outPair = (out0,out1).
      const re=outGLSL[0]!=null?`(${outGLSL[0]})`:null;
      const im=outDim>1&&outGLSL[1]!=null?`(${outGLSL[1]})`:"0.0";
      if(re!=null) albedoBody=`_cplxcol(${re}, ${im})`;
    }
    if(albedoBody==null) return null;   // couldn't transpile → CPU path
  }
  let colorOpts=null;
  if(colorInfo){
    let ci=-1; for(let k=0;k<outDim;k++){ if((outAx[k]||"")==="color"){ ci=k; break; } }
    if(ci>=0 && outGLSL[ci]!=null){
      colorOpts={ colorBody:outGLSL[ci], colorLo:colorInfo.lo, colorHi:colorInfo.hi, cmin:colorInfo.cmin, cmax:colorInfo.cmax };
    }
  }
  // Fold the direct albedo into the active opts (lit material, or non-lit fill).
  if(albedoBody){
    if(tp.shading==="lit"){ matOpts = matOpts || { shade:{} }; matOpts.albedoBody=albedoBody; }
    else { colorOpts = { albedoBody }; }
  }
  return assembleSurfGPU(bodyP, [...uniforms], ascope, color, res, res, tp.showWire!==false,
    tp.shading==="lit" ? matOpts : colorOpts, null, tp.wireOnly===true);
}

function buildFn1dGPU(p, scope, color){
  // buildFn1dGPU can't use a custom vertex shader with LineMaterial (which has
  // its own), so fall back to CPU sampling + buildCurve3d for thick lines.
  const xmin=resolveNum(p.xMin,scope,-5), xmax=resolveNum(p.xMax,scope,5);
  const res=Math.max(2,Math.min(8000,resolveNum(p.res,scope,300)));
  const xs=linspace(xmin,xmax,res);
  // Evaluate y = expr(x) in scope. safeEval handles errors → NaN.
  const pts=xs.map(x=>{
    const y=safeEval(p.expr,{...scope,x});
    return (y!=null&&isFinite(y))?[x,y,0]:[NaN,NaN,NaN];
  });
  return buildCurve3d(pts, color);
}

function buildCurve3d(pts,color,cols=null){
  // Split at NaN gaps into continuous segments, then build each as a Line2
  // (screen-space fat line) so the width is a true CSS-pixel value on all
  // WebGL drivers (LineBasicMaterial.linewidth is ignored on most hardware).
  const segs=[]; let cur=[];
  for(let i=0;i<pts.length;i++){
    const p=pts[i];
    if(p&&p.every(isFinite)) cur.push({v:p, c:cols?cols[i]:null});
    else { if(cur.length>1)segs.push(cur); cur=[]; }
  }
  if(cur.length>1)segs.push(cur);

  const c3=new THREE.Color(hexToThree(color));
  return segs.map(s=>{
    const geo=new LineGeometry();
    // LineGeometry expects a flat [x,y,z, x,y,z, ...] array in world order.
    // buildCurve3d receives math-order [X,Y,Z]. Every other 3D builder emits
    // builder three-space (x,z,y) and relies on the Viewport's `world` group
    // (scale.z = -1) to land the final on-screen frame (X right, Z up, Y away).
    // Line2 fat lines, however, expand to width in clip space inside their own
    // vertex shader and DO NOT survive a negative-determinant model matrix: the
    // mirror collapses/inverts the screen-space offset and the curve renders at
    // zero width (invisible). So bake the FINAL world coords here — math
    // (x,y,z) → world (x, z, −y) — and let Viewport3D parent curves to an
    // unmirrored group (det +1) where the fat-line shader behaves.
    const pos=new Float32Array(s.length*3);
    for(let k=0;k<s.length;k++){
      const [mx,my,mz]=s[k].v;
      pos[k*3]=mx; pos[k*3+1]=mz; pos[k*3+2]=-my;
    }
    geo.setPositions(pos);

    const useCol=!!cols;
    if(useCol){
      const ca=new Float32Array(s.length*3);
      for(let k=0;k<s.length;k++){const c=s[k].c||[1,1,1];ca[k*3]=c[0];ca[k*3+1]=c[1];ca[k*3+2]=c[2];}
      geo.setColors(ca);
    }

    const _res = (typeof window!=="undefined" && window.innerWidth)
      ? new THREE.Vector2(window.innerWidth, window.innerHeight)
      : new THREE.Vector2(1024,768);
    const mat=new LineMaterial({
      color: useCol ? 0xffffff : c3.getHex(),
      vertexColors: useCol,
      linewidth: CURVE_3D_PX,
      worldUnits: false,   // linewidth in CSS pixels, not world units
      resolution: _res,    // real-ish size up front; Viewport3D refines on resize
    });
    mat._isCurve3d = true; // sentinel for Viewport3D ResizeObserver
    const line=new Line2(geo,mat);
    // Geometry is already in final world coords (see above): this object must be
    // added to the UNMIRRORED group, not the scale.z=-1 `world` group, or the
    // fat-line shader breaks. Viewport3D routes on this flag.
    line._unmirroredWorld = true;
    line.computeLineDistances();
    // A 1→1 graph (e.g. y=f(x)) is planar — all points share one coordinate — so
    // its bounding sphere is a flat disc that Line2's frustum test can wrongly cull,
    // making the curve vanish at some camera angles. Curves are cheap; skip culling.
    line.frustumCulled = false;
    return line;
  });
}

// Fat-line builder for DISCONNECTED 3D segments (e.g. marching-squares implicit
// curves). Same screen-space CSS-pixel width as buildCurve3d so these curves no
// longer render as 1px hairlines (LineBasicMaterial.linewidth is ignored by most
// WebGL drivers). `segs` is math-space [[ [x,y,z],[x,y,z] ], ...]; coordinates
// are baked to final world space (x, z, −y) and the object is flagged for the
// unmirrored group + resize refinement, exactly like buildCurve3d.
// opts: { world:boolean, width:number } — width in pixels (default, constant on
// screen) or in world units when world is true (so it scales with zoom / distance).
function buildSegments3d(segs, color, cols=null, opts=null){
  if(!segs||!segs.length) return [];
  const pos=new Float32Array(segs.length*2*3);
  let k=0;
  for(const [a,b] of segs){
    const ax=a[0], ay=a[1], az=a[2]||0;
    const bx=b[0], by=b[1], bz=b[2]||0;
    pos[k++]=ax; pos[k++]=az; pos[k++]=-ay;
    pos[k++]=bx; pos[k++]=bz; pos[k++]=-by;
  }
  const geo=new LineSegmentsGeometry();
  geo.setPositions(pos);
  // Per-endpoint colors → the fat-line shader interpolates them along each
  // segment (Gouraud). cols is one [ca, cb] pair per segment.
  const useCol=!!cols;
  if(useCol){
    const cArr=new Float32Array(segs.length*2*3); let ci=0;
    for(const [ca,cb] of cols){
      const a=ca||[1,1,1], b=cb||[1,1,1];
      cArr[ci++]=a[0]; cArr[ci++]=a[1]; cArr[ci++]=a[2];
      cArr[ci++]=b[0]; cArr[ci++]=b[1]; cArr[ci++]=b[2];
    }
    geo.setColors(cArr);
  }
  const c3=new THREE.Color(hexToThree(color));
  const _res = (typeof window!=="undefined" && window.innerWidth)
    ? new THREE.Vector2(window.innerWidth, window.innerHeight)
    : new THREE.Vector2(1024,768);
  const worldUnits = !!(opts && opts.world);
  const lw = (opts && opts.width!=null && isFinite(opts.width))
    ? opts.width : (worldUnits ? 0.04 : CURVE_3D_PX);
  const mat=new LineMaterial({
    color: useCol ? 0xffffff : c3.getHex(),
    linewidth: lw,
    worldUnits,
    resolution: _res,
    vertexColors: useCol,
  });
  mat._isCurve3d = true;
  const seg=new LineSegments2(geo,mat);
  seg._unmirroredWorld = true;
  seg.computeLineDistances();
  seg.frustumCulled = false;
  return [seg];
}
function buildSurf(rows,color,colRows=null,showWire=true){
  const nv=rows.length,nu=rows[0].length,pos=[],idx=[],colArr=[];
  const useCol=!!colRows;
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
    const p=rows[j][i];pos.push(p?p[0]:0,p?p[2]:0,p?p[1]:0);
    if(useCol){const c=(colRows[j]&&colRows[j][i])||[1,1,1];colArr.push(c[0],c[1],c[2]);}
  }
  for(let j=0;j<nv-1;j++)for(let i=0;i<nu-1;i++){const a=j*nu+i,b=j*nu+i+1,c=(j+1)*nu+i,d=(j+1)*nu+i+1;if([a,b,c,d].every(k=>{const p=rows[Math.floor(k/nu)][k%nu];return p&&p.every(isFinite);}))idx.push(a,b,c,b,d,c);}
  if(!idx.length)return[];
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  if(useCol) g.setAttribute("color",new THREE.Float32BufferAttribute(colArr,3));
  g.setIndex(idx);g.computeVertexNormals();
  const c3=hexToThree(color);
  const mat=new THREE.MeshPhongMaterial({color:useCol?0xffffff:c3,vertexColors:useCol,side:THREE.DoubleSide,transparent:true,opacity:0.82,shininess:40});
  const mesh=new THREE.Mesh(g,mat);
  if(!showWire) return [mesh];
  // WireframeGeometry builds a whole extra edge buffer; skip it when off.
  return[mesh,new THREE.LineSegments(new THREE.WireframeGeometry(g),new THREE.LineBasicMaterial({color:c3,transparent:true,opacity:0.18}))];
}
function buildPlane3d(center,normal,size,color){
  const n=new THREE.Vector3(...normal).normalize(),geo=new THREE.PlaneGeometry(size,size,12,12),c3=hexToThree(color);
  const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:c3,transparent:true,opacity:0.2,side:THREE.DoubleSide}));
  const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:c3,transparent:true,opacity:0.55}));
  const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),n);
  [mesh,edge].forEach(o=>{o.quaternion.copy(q);o.position.set(...center);}); return[mesh,edge];
}
function buildPoint3d(x,y,z,color,r=0.08){
  const m=new THREE.Mesh(new THREE.SphereGeometry(r,12,10),new THREE.MeshPhongMaterial({color:hexToThree(color),shininess:60}));
  m.position.set(x,z,y); return[m];
}
function buildPointSeq3d(pts, color, r=0.07, drawLines=true) {
  const objs = [];
  const mat = new THREE.MeshPhongMaterial({color:hexToThree(color),shininess:60});
  const lineMat = new THREE.LineBasicMaterial({color:hexToThree(color),opacity:0.7,transparent:true});
  const valid = pts.filter(p=>p&&p.every(isFinite));
  for(const [x,y,z] of valid) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r,8,7),mat);
    m.position.set(x,z,y); objs.push(m);
  }
  if(drawLines && valid.length>1){
    const g = new THREE.BufferGeometry().setFromPoints(valid.map(([x,y,z])=>new THREE.Vector3(x,z,y)));
    objs.push(new THREE.Line(g,lineMat));
  }
  return objs;
}

// GPU-accelerated point cloud: a single InstancedMesh of spheres for all points
// plus one connecting Line. Per-point colours optional (cols: array of [r,g,b]
// 0..1 or hex). The returned array carries _gpuPoints metadata so sequencing can
// reveal points by setting instanceCount without rebuilding. World axis swap
// (x, z, y) matches the rest of the renderer.
function buildPointSeqGPU(pts, color, r=0.07, drawLines=true, cols=null){
  const valid=[]; const validCols=[];
  for(let i=0;i<pts.length;i++){
    const p=pts[i];
    if(p&&p.length>=3&&isFinite(p[0])&&isFinite(p[1])&&isFinite(p[2])){ valid.push(p); if(cols) validCols.push(cols[i]); }
  }
  const n=valid.length;
  if(!n) return [];
  const sphere=new THREE.SphereGeometry(r,10,8);
  // InstancedMesh per-instance color comes from setColorAt → instanceColor, NOT
  // vertexColors (which would expect a per-vertex attribute on the sphere geo).
  // Base color white so instance colors aren't tinted; uses node color when no cols.
  const mat=new THREE.MeshPhongMaterial({color:cols?0xffffff:hexToThree(color),shininess:60});
  const inst=new THREE.InstancedMesh(sphere,mat,n);
  const m=new THREE.Matrix4();
  const useCol=!!cols;
  for(let i=0;i<n;i++){
    const [x,y,z]=valid[i];
    m.makeTranslation(x,z,y);
    inst.setMatrixAt(i,m);
    if(useCol){
      const c=validCols[i];
      const col = c==null ? new THREE.Color(hexToThree(color))
                 : (Array.isArray(c) ? new THREE.Color(c[0],c[1],c[2]) : new THREE.Color(hexToThree(c)));
      inst.setColorAt(i,col);
    }
  }
  inst.instanceMatrix.needsUpdate=true;
  if(inst.instanceColor) inst.instanceColor.needsUpdate=true;
  inst.frustumCulled=false;
  inst._gpuPoints={count:n};       // marker for sequencing + GPU classification
  inst._fullCount=n;
  const objs=[inst];
  if(drawLines && n>1){
    const lineMat=new THREE.LineBasicMaterial({color:hexToThree(color),opacity:0.7,transparent:true});
    const g=new THREE.BufferGeometry().setFromPoints(valid.map(([x,y,z])=>new THREE.Vector3(x,z,y)));
    const line=new THREE.Line(g,lineMat); line._fullCount=n;
    objs.push(line);
  }
  return objs;
}
function buildQuiver3d(p,exprX,exprY,exprZ,gridN,xMin,xMax,yMin,yMax,zMin,zMax,color,scope,normalize){
  const objs=[],c3=hexToThree(color);
  const shaftMat=new THREE.LineBasicMaterial({color:c3,opacity:0.8,transparent:true});
  const coneMat=new THREE.MeshBasicMaterial({color:c3,opacity:0.8,transparent:true,side:THREE.DoubleSide});
  const xs=linspace(xMin,xMax,gridN),ys=linspace(yMin,yMax,gridN),zs=linspace(zMin,zMax,gridN);
  let maxMag=0; const raw=[];
  for(const x of xs)for(const y of ys)for(const z of zs){
    const sc={...scope,x,y,z};const vx=safeEval(exprX,sc)??0,vy=safeEval(exprY,sc)??0,vz=exprZ?(safeEval(exprZ,sc)??0):0;
    const mag=Math.sqrt(vx*vx+vy*vy+vz*vz);raw.push({x,y,z,vx,vy,vz,mag});if(mag>maxMag)maxMag=mag;
  }
  if(maxMag===0)maxMag=1;
  const spX=(xMax-xMin)/(gridN-1||1),spY=(yMax-yMin)/(gridN-1||1),spZ=(zMax-zMin)/(gridN-1||1);
  const arrowLen=Math.min(spX,spY,spZ)*0.42;
  for(const{x,y,z,vx,vy,vz,mag}of raw){
    if(mag<1e-10)continue;
    const scale=normalize?arrowLen:arrowLen*(mag/maxMag);
    const dx=(vx/mag)*scale,dy=(vy/mag)*scale,dz=(vz/mag)*scale;
    const pts=[new THREE.Vector3(x,z,y),new THREE.Vector3(x+dx,z+dz,y+dy)];
    const g=new THREE.BufferGeometry().setFromPoints(pts);objs.push(new THREE.Line(g,shaftMat));
    const cg=new THREE.ConeGeometry(scale*0.18,scale*0.38,5);const cm=new THREE.Mesh(cg,coneMat);
    cm.position.set(x+dx,z+dz,y+dy);
    const dir=new THREE.Vector3(dx,dz,dy).normalize(),up=new THREE.Vector3(0,1,0);
    if(Math.abs(dir.dot(up))<0.999)cm.quaternion.setFromUnitVectors(up,dir);
    objs.push(cm);
  }
  return objs;
}

// ── GPU quiver ───────────────────────────────────────────────────────────────
// Evaluates the vector field in the vertex shader at each grid point and
// orients/scales an arrow instance accordingly. One InstancedMesh draw call for
// all arrows instead of hundreds of Line+Cone objects. Returns null if the
// field expressions aren't GLSL-translatable (→ CPU fallback).
function buildQuiver3dGPU(p, scope, color){
  const fnTable=fnTableFromScope(scope);
  const ascope=fnTable?augmentScopeForGPU(scope):scope;
  const uniforms=new Set();
  const gx=exprToGLSL(p.exprX, new Set(["x","y","z"]), uniforms, GLSL_UNIFORM_PREFIX, fnTable);
  const gy=exprToGLSL(p.exprY, new Set(["x","y","z"]), uniforms, GLSL_UNIFORM_PREFIX, fnTable);
  const gz=p.exprZ ? exprToGLSL(p.exprZ, new Set(["x","y","z"]), uniforms, GLSL_UNIFORM_PREFIX, fnTable) : "0.0";
  if(gx==null||gy==null||gz==null) return null;
  if(fnTable && !gpuUniformsResolvable(uniforms, ascope)) return null;
  const gridN=Math.max(2,Math.min(64,Math.round(resolveNum(p.gridN,scope,5))));
  const xMin=resolveNum(p.xMin,scope,-3),xMax=resolveNum(p.xMax,scope,3);
  const yMin=resolveNum(p.yMin,scope,-3),yMax=resolveNum(p.yMax,scope,3);
  const zMin=resolveNum(p.zMin,scope,-3),zMax=resolveNum(p.zMax,scope,3);
  const normalize=p.normalize!==false;
  const sp=Math.min((xMax-xMin),(yMax-yMin),(zMax-zMin))/(gridN-1||1);
  const arrowLen=sp*0.42;

  // Arrow template pointing +Y: a thin cylinder shaft + a cone head, merged.
  const tmpl=new THREE.CylinderGeometry(arrowLen*0.04, arrowLen*0.04, arrowLen*0.7, 5);
  tmpl.translate(0, arrowLen*0.35, 0);
  const head=new THREE.ConeGeometry(arrowLen*0.16, arrowLen*0.32, 6);
  head.translate(0, arrowLen*0.86, 0);
  const tpos=tmpl.toNonIndexed().attributes.position.array;
  const hpos=head.toNonIndexed().attributes.position.array;
  const merged=new Float32Array(tpos.length+hpos.length);
  merged.set(tpos,0); merged.set(hpos,tpos.length);
  tmpl.dispose(); head.dispose();

  const geo=new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(merged,3));
  const count=gridN*gridN*gridN;
  const base=new Float32Array(count*3);
  let k=0;
  for(let i=0;i<gridN;i++)for(let j=0;j<gridN;j++)for(let l=0;l<gridN;l++){
    base[k++]=xMin+(xMax-xMin)*(i/(gridN-1||1));
    base[k++]=yMin+(yMax-yMin)*(j/(gridN-1||1));
    base[k++]=zMin+(zMax-zMin)*(l/(gridN-1||1));
  }
  geo.setAttribute("iBase", new THREE.InstancedBufferAttribute(base,3));
  geo.instanceCount=count;

  const uobj={ uColor:{value:new THREE.Color(hexToThree(color))}, uMaxMag:{value:1.0}, uNorm:{value:normalize?1.0:0.0} };
  for(const u of uniforms) uobj[GLSL_UNIFORM_PREFIX+u]={value:Number(ascope[u])||0};
  const decls=[...uniforms].map(u=>`uniform float ${GLSL_UNIFORM_PREFIX}${u};`).join("\n");
  const vert=`
    ${decls}
    attribute vec3 iBase;
    uniform vec3 uColor; uniform float uMaxMag; uniform float uNorm;
    varying float vMag;
    vec3 field(float x, float y, float z){ return vec3(${gx}, ${gy}, ${gz}); }
    mat3 rotToDir(vec3 dir){
      vec3 up=vec3(0.0,1.0,0.0); vec3 a=normalize(dir);
      float c=dot(up,a); vec3 v=cross(up,a); float s=length(v);
      if(s<1e-6){ return c>0.0?mat3(1.0):mat3(-1.0,0.0,0.0, 0.0,-1.0,0.0, 0.0,0.0,1.0); }
      v=normalize(v); float ic=1.0-c;
      return mat3(
        c+v.x*v.x*ic,      v.x*v.y*ic+v.z*s,  v.x*v.z*ic-v.y*s,
        v.y*v.x*ic-v.z*s,  c+v.y*v.y*ic,      v.y*v.z*ic+v.x*s,
        v.z*v.x*ic+v.y*s,  v.z*v.y*ic-v.x*s,  c+v.z*v.z*ic);
    }
    void main(){
      vec3 fv = field(iBase.x, iBase.y, iBase.z);
      float mag = length(fv); vMag = mag;
      vec3 dir = (mag>1e-9) ? normalize(vec3(fv.x, fv.z, fv.y)) : vec3(0.0,1.0,0.0);
      float scl = uNorm>0.5 ? 1.0 : clamp(mag/max(uMaxMag,1e-6), 0.0, 1.0);
      vec3 world = rotToDir(dir) * (position*scl) + vec3(iBase.x, iBase.z, iBase.y);
      if(mag<1e-9){ gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
      gl_Position = projectionMatrix * modelViewMatrix * vec4(world,1.0);
    }`;
  const frag=`precision highp float; uniform vec3 uColor; varying float vMag;
    void main(){ gl_FragColor=vec4(uColor, 0.85); }`;
  const mat=new THREE.ShaderMaterial({uniforms:uobj,vertexShader:vert,fragmentShader:frag,transparent:true,side:THREE.DoubleSide});
  mat._uniformNames=[...uniforms];
  if(!normalize){
    let mx=0; const sc={...scope}; const stepN=Math.max(1,Math.floor(gridN/4));
    for(let i=0;i<gridN;i+=stepN)for(let j=0;j<gridN;j+=stepN)for(let l=0;l<gridN;l+=stepN){
      sc.x=xMin+(xMax-xMin)*(i/(gridN-1||1)); sc.y=yMin+(yMax-yMin)*(j/(gridN-1||1)); sc.z=zMin+(zMax-zMin)*(l/(gridN-1||1));
      const vx=safeEval(p.exprX,sc)??0,vy=safeEval(p.exprY,sc)??0,vz=p.exprZ?(safeEval(p.exprZ,sc)??0):0;
      const m=Math.sqrt(vx*vx+vy*vy+vz*vz); if(m>mx)mx=m;
    }
    uobj.uMaxMag.value=mx||1;
  }
  const mesh=new THREE.Mesh(geo,mat); mesh.frustumCulled=false;
  mesh._gpuSurface={uNames:[...uniforms], uPrefix:GLSL_UNIFORM_PREFIX};
  return [mesh];
}

// ── Instanced glyph field: explicit (seed, vector) pairs ─────────────────────
// One InstancedMesh draw call for all arrows. Per-instance attributes carry the
// base position and vector; the vertex shader orients & scales each arrow.
// A uTime uniform drives flow animation: arrows can pulse and a bright crest
// travels along each one, reading as a flowing vector field. Geometry is static
// (the pairs), so animation is just a uniform update — no rebuild per frame.
function buildGlyphFieldGPU(pairs, color, opts={}){
  if(!pairs.length) return [];
  const arrowLen = opts.arrowLen ?? 0.5;
  // Length mode: "uniform" (every arrow = arrowLen), "scaled" (arrowLen * mag/maxMag),
  // or "raw" (length = |vec| directly, ignoring arrowLen and maxMag). Falls back to
  // the legacy boolean `normalize` (true→uniform, false→scaled) when absent.
  const lenMode = opts.lenMode || (opts.normalize===false ? "scaled" : "uniform");
  const anim = opts.anim || "none";        // none | pulse | crest | advect
  // Arrow template pointing +Y, parametrised so the shader knows axial position
  // (t in [0,1] along the shaft) for the travelling crest.
  const tmpl=new THREE.CylinderGeometry(arrowLen*0.045, arrowLen*0.045, arrowLen*0.7, 6);
  tmpl.translate(0, arrowLen*0.35, 0);
  const head=new THREE.ConeGeometry(arrowLen*0.17, arrowLen*0.34, 7);
  head.translate(0, arrowLen*0.85, 0);
  const tpos=tmpl.toNonIndexed().attributes.position.array;
  const hpos=head.toNonIndexed().attributes.position.array;
  const merged=new Float32Array(tpos.length+hpos.length);
  merged.set(tpos,0); merged.set(hpos,tpos.length);
  // axial parameter (y/arrowLen) per template vertex for the crest highlight
  const axial=new Float32Array(merged.length/3);
  for(let i=0;i<axial.length;i++) axial[i]=Math.min(1,Math.max(0,merged[i*3+1]/arrowLen));
  tmpl.dispose(); head.dispose();

  const n=pairs.length;
  const iPos=new Float32Array(n*3), iVec=new Float32Array(n*3), iPhase=new Float32Array(n);
  const useVCol=!!opts.cols;
  const iCol=useVCol?new Float32Array(n*3):null;
  let maxMag=0;
  for(let i=0;i<n;i++){
    const {pos,vec}=pairs[i];
    iPos[i*3]=pos[0]; iPos[i*3+1]=pos[1]; iPos[i*3+2]=pos[2];
    iVec[i*3]=vec[0]; iVec[i*3+1]=vec[1]; iVec[i*3+2]=vec[2];
    iPhase[i]=i*0.137; // staggered phase so the flow ripples through the set
    if(useVCol){const c=opts.cols[i]||[1,1,1];iCol[i*3]=c[0];iCol[i*3+1]=c[1];iCol[i*3+2]=c[2];}
    const m=Math.hypot(vec[0],vec[1],vec[2]); if(m>maxMag) maxMag=m;
  }
  if(maxMag===0) maxMag=1;

  const geo=new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(merged,3));
  geo.setAttribute("axial", new THREE.BufferAttribute(axial,1));
  geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(iPos,3));
  geo.setAttribute("iVec", new THREE.InstancedBufferAttribute(iVec,3));
  geo.setAttribute("iPhase", new THREE.InstancedBufferAttribute(iPhase,1));
  if(useVCol) geo.setAttribute("iColor", new THREE.InstancedBufferAttribute(iCol,3));
  geo.instanceCount=n;

  const ANIM={none:0,pulse:1,crest:2,advect:3}[anim]||0;
  const LENMODE={uniform:0,scaled:1,raw:2}[lenMode]??0;
  const uobj={
    uColor:{value:new THREE.Color(hexToThree(color))},
    uCrest:{value:new THREE.Color(hexToThree(opts.crestColor||"#ffffff"))},
    uMaxMag:{value:maxMag}, uLenMode:{value:LENMODE}, uLen:{value:arrowLen},
    uTime:{value:0}, uAnim:{value:ANIM}, uSpeed:{value:opts.speed??1.0},
  };
  const vert=`
    attribute vec3 iPos; attribute vec3 iVec; attribute float iPhase; attribute float axial;
    #ifdef USE_VCOL
    attribute vec3 iColor; varying vec3 vCol;
    #endif
    uniform float uMaxMag; uniform float uLenMode; uniform float uLen;
    uniform float uTime; uniform float uAnim; uniform float uSpeed;
    varying float vAxial; varying float vMag; varying float vCrest;
    mat3 rotToDir(vec3 dir){
      vec3 up=vec3(0.0,1.0,0.0); vec3 a=normalize(dir);
      float c=dot(up,a); vec3 v=cross(up,a); float s=length(v);
      if(s<1e-6){ return c>0.0?mat3(1.0):mat3(-1.0,0.0,0.0, 0.0,-1.0,0.0, 0.0,0.0,1.0); }
      v=normalize(v); float ic=1.0-c;
      return mat3(
        c+v.x*v.x*ic,      v.x*v.y*ic+v.z*s,  v.x*v.z*ic-v.y*s,
        v.y*v.x*ic-v.z*s,  c+v.y*v.y*ic,      v.y*v.z*ic+v.x*s,
        v.z*v.x*ic+v.y*s,  v.z*v.y*ic-v.x*s,  c+v.z*v.z*ic);
    }
    void main(){
      vAxial=axial;
      #ifdef USE_VCOL
      vCol=iColor;
      #endif
      float mag=length(iVec); vMag=mag;
      vec3 dir=(mag>1e-9)?normalize(vec3(iVec.x,iVec.z,iVec.y)):vec3(0.0,1.0,0.0);
      // Length mode: 0=uniform (template already at arrowLen), 1=scaled
      // (arrowLen * mag/maxMag), 2=raw (final length = mag, so divide out the
      // template's baked-in arrowLen to leave only the magnitude).
      float scl;
      if(uLenMode<0.5){ scl=1.0; }
      else if(uLenMode<1.5){ scl=clamp(mag/max(uMaxMag,1e-6),0.05,1.0); }
      else { scl=mag/max(uLen,1e-6); }
      float ph=uTime*uSpeed + iPhase;
      // pulse: arrows breathe in length; crest: highlight travels; advect: the
      // whole arrow slides forward along its vector and loops.
      float pulse = (uAnim>0.5 && uAnim<1.5) ? (0.85+0.25*sin(ph*3.1416)) : 1.0;
      float crestPos = fract(ph*0.5);
      vCrest = (uAnim>1.5 && uAnim<2.5) ? smoothstep(0.12,0.0,abs(axial-crestPos)) : 0.0;
      vec3 local = position*scl*pulse;
      vec3 world = rotToDir(dir)*local + vec3(iPos.x,iPos.z,iPos.y);
      if(uAnim>2.5){ // advect along the (math-space) vector, looping
        float t=fract(ph*0.25);
        // slide distance tracks the effective arrow length: arrowLen*scl in
        // uniform/scaled modes, mag in raw mode (where scl already encodes it).
        float effLen=(uLenMode<1.5)?(uLen*scl):mag;
        world += vec3(dir.x,dir.y,dir.z) * (t*effLen*1.6);
      }
      if(mag<1e-9){ gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
      gl_Position=projectionMatrix*modelViewMatrix*vec4(world,1.0);
    }`;
  const frag=`precision highp float;
    uniform vec3 uColor; uniform vec3 uCrest;
    #ifdef USE_VCOL
    varying vec3 vCol;
    #endif
    varying float vAxial; varying float vMag; varying float vCrest;
    void main(){
      #ifdef USE_VCOL
      vec3 base=vCol;
      #else
      vec3 base=uColor;
      #endif
      vec3 c=mix(base, base*1.5, vAxial*0.5);     // brighter toward tip
      c=mix(c, uCrest, clamp(vCrest,0.0,1.0));          // travelling crest
      gl_FragColor=vec4(c, 0.92);
    }`;
  const mat=new THREE.ShaderMaterial({uniforms:uobj,vertexShader:vert,fragmentShader:frag,transparent:true,side:THREE.DoubleSide,defines:useVCol?{USE_VCOL:1}:{}});
  mat._uniformNames=[];     // no scalar uniforms (values are baked per-instance)
  const mesh=new THREE.Mesh(geo,mat); mesh.frustumCulled=false;
  // mark as time-animated so the render loop keeps ticking & updating uTime
  mesh._glyphAnim = ANIM>0;
  mesh._gpuSurface={uNames:[]};
  return [mesh];
}

// Build a GPU-rendered surface mesh from an explicit grid of [x,y,z] points.
// opts: { opacity, noWire, a, b, axis } — a/b/axis enable a vertex-color
// gradient between colors a→b across the "u" (column) or "v" (row) direction.
function buildSurfFromGridGPU(rows, color, opts={}){
  const nv=rows.length, nu=rows[0].length, pos=[], idx=[];
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const q=rows[j][i];pos.push(q?q[0]:0,q?q[2]:0,q?q[1]:0);}
  for(let j=0;j<nv-1;j++)for(let i=0;i<nu-1;i++){
    const a=j*nu+i,b=j*nu+i+1,c=(j+1)*nu+i,d=(j+1)*nu+i+1;
    if([a,b,c,d].every(kk=>{const q=rows[Math.floor(kk/nu)][kk%nu];return q&&q.every(isFinite);})) idx.push(a,b,c,b,d,c);
  }
  if(!idx.length) return [];
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.setIndex(idx); g.computeVertexNormals();
  const opacity = opts.opacity!=null ? opts.opacity : 0.8;
  let mat;
  const useGrad = !!(opts.a && opts.b);
  if(useGrad){
    const ca=new THREE.Color(hexToThree(opts.a)), cb=new THREE.Color(hexToThree(opts.b));
    const col=new Float32Array(nv*nu*3);
    for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
      const f = opts.axis==="v" ? (nv>1?j/(nv-1):0) : (nu>1?i/(nu-1):0);
      const idx3=(j*nu+i)*3;
      col[idx3]=ca.r+(cb.r-ca.r)*f; col[idx3+1]=ca.g+(cb.g-ca.g)*f; col[idx3+2]=ca.b+(cb.b-ca.b)*f;
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col,3));
    mat=new THREE.MeshPhongMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true,opacity,shininess:40});
  } else {
    mat=new THREE.MeshPhongMaterial({color:hexToThree(color),side:THREE.DoubleSide,transparent:true,opacity,shininess:40});
  }
  const mesh=new THREE.Mesh(g,mat);
  if(opts.noWire) return [mesh];
  const wireColor = useGrad ? hexToThree(opts.b) : hexToThree(color);
  const wire=new THREE.LineSegments(new THREE.WireframeGeometry(g),new THREE.LineBasicMaterial({color:wireColor,transparent:true,opacity:0.18}));
  return [mesh,wire];
}

// ── Scalar volume: f(x,y,z) sampled on a grid, drawn as a value-coloured point
// cloud. Used by the unified scalarFn node at dims=3 where there's no single
// surface to draw. Points are coloured by normalized value (colorLo→colorHi)
// when colorByValue is set, else the node colour.
function buildScalarVolume(p, scope, color){
  const res=Math.max(2,Math.min(96,Math.round(resolveNum(p.res,scope,18))));
  const xMin=resolveNum(p.xMin,scope,-5),xMax=resolveNum(p.xMax,scope,5);
  const yMin=resolveNum(p.yMin,scope,-4),yMax=resolveNum(p.yMax,scope,4);
  const zMin=resolveNum(p.zMin,scope,-3),zMax=resolveNum(p.zMax,scope,3);
  const xs=linspace(xMin,xMax,res),ys=linspace(yMin,yMax,res),zs=linspace(zMin,zMax,res);
  const colorByValue=!!p.colorByValue;
  const cLo=new THREE.Color(hexToThree(p.colorLo||"#3a6df0"));
  const cHi=new THREE.Color(hexToThree(p.colorHi||"#f0533a"));
  const vals=[],pos=[];
  let vmin=Infinity,vmax=-Infinity;
  for(const x of xs)for(const y of ys)for(const z of zs){
    const w=safeEval(p.expr,{...scope,x,y,z});
    if(w==null||!isFinite(w)){ continue; }
    pos.push([x,z,y]); vals.push(w);     // note y/z swap to match world axes
    if(w<vmin)vmin=w; if(w>vmax)vmax=w;
  }
  if(!pos.length) return [];
  const n=pos.length;
  const arr=new Float32Array(n*3), col=new Float32Array(n*3);
  const span=(vmax-vmin)||1;
  for(let i=0;i<n;i++){
    arr[i*3]=pos[i][0]; arr[i*3+1]=pos[i][1]; arr[i*3+2]=pos[i][2];
    let r=color, g, b;
    if(colorByValue){
      const f=(vals[i]-vmin)/span;
      col[i*3]=cLo.r+(cHi.r-cLo.r)*f; col[i*3+1]=cLo.g+(cHi.g-cLo.g)*f; col[i*3+2]=cLo.b+(cHi.b-cLo.b)*f;
    } else {
      const c=new THREE.Color(hexToThree(color));
      col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b;
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.BufferAttribute(arr,3));
  geo.setAttribute("color",new THREE.BufferAttribute(col,3));
  const mat=new THREE.PointsMaterial({size:Math.max(0.04,(xMax-xMin)/res*0.5),vertexColors:true,transparent:true,opacity:0.85,sizeAttenuation:true});
  return [new THREE.Points(geo,mat)];
}

// ── Raw geometry node ────────────────────────────────────────────────────────
// Build explicit primitives from typed-in data, no formula/transformer in the
// loop. Four primitive kinds (prim): points / segments / glyphs / triangles.
// Two source modes (src):
//   list  — literal vertex data, one primitive per line.
//   index — ONE template primitive whose coordinates are EXPRESSIONS over the
//           indices i (and j,k for a lattice) plus n (flat index), evaluated over
//           a count grid. Expressions see wired scalars and fnDefs, so primitives
//           can express against arbitrary dependency functions.
// Every vertex carries an optional color scalar (colorExpr) mapped through the
// lo→hi ramp, interpolated across the primitive (Gouraud).
function buildRawGeom3d(p, scope, color){
  const prim = p.prim || "points";
  const { verts, cols, rgb, alpha } = sampleRawGeom(p, prim, scope); // verts: array of vertex-groups
  if(!verts.length) return [];
  // Per-vertex colors as [r,g,b] groups. Either taken straight from the rgb
  // three-parameter mode, or produced by ramping the scalar groups.
  let rampGroups=null;
  if(rgb){
    rampGroups=rgb;                       // already [0,1] per channel, per vertex
  } else if(cols){
    const flat=[]; for(const g of cols) for(const cval of g) flat.push(cval);
    const ramped=rampRaw(flat, p, scope);
    rampGroups=[]; let idx=0; for(const g of cols){ const grp=[]; for(let m=0;m<g.length;m++) grp.push(ramped[idx++]); rampGroups.push(grp); }
  }
  const useCol = !!rampGroups;
  const alphaGroups = alpha;              // per-vertex [0,1] alpha groups, or null

  // For points/segments/glyphs the underlying materials don't carry per-vertex
  // alpha, so honor alpha as a single opacity (the mean of the per-vertex alphas).
  let meanAlpha=1;
  if(alphaGroups){ let s=0,c=0; for(const g of alphaGroups) for(const a of g){ s+=a; c++; } meanAlpha=c?s/c:1; }

  if(prim==="points"){
    const r = resolveNum(p.radius, scope, 0.08);
    const pts = verts.map(v=>v[0]);
    const pcols = rampGroups ? rampGroups.map(g=>g[0]) : null;
    const objs = buildPointSeqGPU(pts, color, r, p.drawLines===true, pcols);
    if(alphaGroups) for(const o of objs){ if(o.material){ o.material.transparent=true; o.material.opacity=meanAlpha; } }
    return objs;
  }
  if(prim==="segments"){
    const segs = verts.map(([a,b])=>[a,b]);
    const scols = rampGroups ? rampGroups.map(([ca,cb])=>[ca,cb]) : null;
    const world = p.lineMode==="world";
    const lw = (p.lineWidth!==""&&p.lineWidth!=null) ? resolveNum(p.lineWidth,scope, world?0.04:CURVE_3D_PX) : (world?0.04:undefined);
    const objs = buildSegments3d(segs, color, scols, {world, width:lw});
    if(alphaGroups) for(const o of objs){ if(o.material){ o.material.transparent=true; o.material.opacity=meanAlpha; } }
    return objs;
  }
  if(prim==="glyphs"){
    const pairs = verts.map(([pos,vec])=>({pos, vec}));
    const opts = {
      arrowLen: resolveNum(p.arrowLen,scope,0.5),
      lenMode: p.lenMode || "raw",
      normalize: p.normalize===true,
      anim: "none",
    };
    if(rampGroups) opts.cols = rampGroups.map(g=>g[0]); // glyph colored by its base vertex
    const objs = buildGlyphFieldGPU(pairs, color, opts);
    if(alphaGroups) for(const o of objs){ if(o.material){ o.material.transparent=true; o.material.opacity=meanAlpha; } }
    return objs;
  }
  // triangles → a filled mesh from explicit vertex triples (math→three swap), with
  // optional per-vertex colors interpolated across each face. When alpha is on,
  // colors are stored RGBA (4-component) so transparency interpolates per vertex.
  const hasA = !!alphaGroups;
  const cw = hasA ? 4 : 3;
  const pos=new Float32Array(verts.length*9);
  const colArr=(useCol||hasA)?new Float32Array(verts.length*3*cw):null;
  let k=0, ck=0;
  for(let t=0;t<verts.length;t++){
    const [a,b,c]=verts[t];
    const tri=[a,b,c];
    for(let m=0;m<3;m++){ const v=tri[m]; pos[k++]=v[0]; pos[k++]=v[2]||0; pos[k++]=-(v[1]||0);
      if(colArr){ const cc=(useCol?rampGroups[t][m]:null)||[1,1,1]; colArr[ck++]=cc[0]; colArr[ck++]=cc[1]; colArr[ck++]=cc[2];
        if(hasA){ const av=alphaGroups[t]; colArr[ck++]=(av&&av[m]!=null)?av[m]:1; } } }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos,3));
  if(colArr) geo.setAttribute("color", new THREE.BufferAttribute(colArr,cw));
  geo.computeVertexNormals();
  const c3=hexToThree(color);
  const vCol=useCol||hasA;
  // Only enter the transparent render pass when there is REAL per-vertex alpha
  // (hasA). A solid surface left at transparent:true with opacity 0.82 forces
  // three.js to depth-sort it per-object; when a surface is built from two meshes
  // (e.g. the upper/lower triangles of a lattice), the two meshes sort in a fixed
  // order and one triangle of every quad blends differently from its partner — the
  // "half of each quad" artifact. Opaque solid surfaces sort per-fragment via the
  // depth buffer and don't show it.
  const mat=new THREE.MeshPhongMaterial({color:vCol?0xffffff:c3,vertexColors:vCol,side:THREE.DoubleSide,
    transparent:hasA, opacity:1, shininess:36, flatShading:!useCol});
  const mesh=new THREE.Mesh(geo,mat);
  if(p.showWire===false) return [mesh];
  const wire=new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({color:c3,transparent:true,opacity:0.35}));
  return [mesh, wire];
}

// ── Embedded mesh asset ──────────────────────────────────────────────────────
// A `mesh` node stores its geometry as a compact JSON string in props.data:
//   {"p":[x,y,z,…],"i":[a,b,c,…]}   — positions are MATH space (z up), indices
// flat (triangle list). meshDataFromGeometry() encodes a three BufferGeometry
// (file convention: y up) into that string, rounding to keep the payload small;
// buildMesh3d() decodes it and builds the renderable mesh. The pair is the
// import↔render bridge: loaders → BufferGeometry → data string → node → mesh.
const _round5=(v)=>Math.round(v*1e5)/1e5;
function meshDataFromGeometry(geom){
  const pos=geom.getAttribute("position"); if(!pos) return "";
  const n=pos.count, p=new Array(n*3);
  for(let i=0;i<n;i++){
    // file/three space is y-up; store math (z-up): math(x,y,z)=three(x,z,y).
    p[i*3]   = _round5(pos.getX(i));
    p[i*3+1] = _round5(pos.getZ(i));
    p[i*3+2] = _round5(pos.getY(i));
  }
  const idx = geom.index ? Array.from(geom.index.array) : null;
  return JSON.stringify(idx ? {p,i:idx} : {p});
}
// A tiny order-sensitive checksum of a data string — used as the rebuild-cache
// fingerprint so re-importing a different asset of identical length still
// invalidates. Cheap (samples the string) rather than hashing every byte.
function meshDataSig(data){
  if(!data) return "";
  let h=2166136261>>>0; const L=data.length, step=Math.max(1,(L/512)|0);
  for(let i=0;i<L;i+=step){ h^=data.charCodeAt(i); h=Math.imul(h,16777619); }
  return L+":"+(h>>>0).toString(36);
}
function buildMesh3d(p, scope, color){
  let data=null; try{ data = p.data ? JSON.parse(p.data) : null; }catch{ data=null; }
  if(!data || !Array.isArray(data.p) || data.p.length<9) return [];
  const s = resolveNum(p.scale, scope, 1);
  const src=data.p, n=(src.length/3)|0;
  const posArr=new Float32Array(n*3);
  for(let i=0;i<n;i++){
    const mx=src[i*3]||0, my=src[i*3+1]||0, mz=src[i*3+2]||0;
    // math(x,y,z) → builder three-space (x,z,y); the world group's scale.z=−1
    // carries it to final (x,z,−y), exactly like every other plot builder.
    posArr[i*3]   = mx*s;
    posArr[i*3+1] = mz*s;
    posArr[i*3+2] = my*s;
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posArr,3));
  if(Array.isArray(data.i) && data.i.length){
    geo.setIndex(n>65535 ? data.i : data.i.map(v=>v|0));
  }
  geo.computeVertexNormals();
  const c3=hexToThree(color);
  const opacity=resolveNum(p.opacity,scope,1);
  const transparent=opacity<1;
  const side=p.doubleSide===false ? THREE.FrontSide : THREE.DoubleSide;
  const lit=p.lit!==false;
  // Lit → a MeshPhong shaded by the scene's lights (added to the root group, so
  // a standard material reacts automatically). Unlit → flat MeshBasic.
  const mat = lit
    ? new THREE.MeshPhongMaterial({color:c3, side, transparent, opacity,
        shininess:resolveNum(p.shininess,scope,36), flatShading:p.flatShading===true})
    : new THREE.MeshBasicMaterial({color:c3, side, transparent, opacity});
  const mesh=new THREE.Mesh(geo,mat);
  if(p.showWire!==true) return [mesh];
  const wire=new THREE.LineSegments(new THREE.WireframeGeometry(geo),
    new THREE.LineBasicMaterial({color:c3,transparent:true,opacity:0.3}));
  return [mesh, wire];
}

// Ramp helper for rawGeom (mirrors transformer's rampColors but reads rawGeom's
// own color props). Returns one [r,g,b] per input scalar.
function rampRaw(vals, p, scope){
  const lo=new THREE.Color(p.colorLo||"#3a6aff"), hi=new THREE.Color(p.colorHi||"#ff5ea8");
  let mn=(p.colorMin!==""&&p.colorMin!=null)?resolveNum(p.colorMin,scope,0):Math.min(...vals);
  let mx=(p.colorMax!==""&&p.colorMax!=null)?resolveNum(p.colorMax,scope,1):Math.max(...vals);
  if(!isFinite(mn))mn=0; if(!isFinite(mx))mx=1;
  const span=(mx-mn)||1, c=new THREE.Color();
  return vals.map(v=>{let t=(v-mn)/span;t=t<0?0:t>1?1:t;c.copy(lo).lerp(hi,t);return [c.r,c.g,c.b];});
}

// Sample rawGeom into vertex groups (+ optional per-vertex color scalars). Each
// group is a primitive's vertices: points→[v], segments/glyphs→[a,b], tris→[a,b,c].
// Build a JIT context for rawGeom index sampling: split the scope into plain
// scalars (S) and a function table (F) of native-JS-compiled fnDefs (recursively
// registering every fnDef reachable through the dependency chain). Returns
// { S, F, fnNames } or null if the scope can't be JIT-prepared. Any single fnDef
// that can't be compiled falls back to its mathjs closure inside F, so partial
// compilation is safe; a coordinate/color expression that can't compile makes the
// caller fall back to the interpreted path for THAT expression.
function buildJitContext(scope){
  const S={}, F={}, done=new Set();
  function reg(name, fnObj){
    if(done.has(name)) return; done.add(name);
    if(!fnObj || typeof fnObj!=="function"){ return; }
    const params=fnObj._fnParams, expr=fnObj._fnExpr, fnScope=fnObj._fnScope;
    if(params==null || expr==null){ F[name]=fnObj; return; }  // not a fnDef closure → keep as-is
    const innerFns=new Set(), innerS={};
    for(const k in (fnScope||{})){ const v=fnScope[k]; if(typeof v==="function"){ innerFns.add(k); reg(k, v); } else innerS[k]=v; }
    const jsfn=compileToJS(expr, innerFns, new Set(params));
    if(!jsfn){ F[name]=fnObj; return; }   // fall back to the mathjs closure for this fn
    F[name]=(...args)=>{ const V={}; for(let z=0;z<params.length;z++) V[params[z]]=args[z]??0; return jsfn(innerS, F, V); };
  }
  for(const k in scope){ const v=scope[k]; if(typeof v==="function") reg(k, v); else S[k]=v; }
  return { S, F, fnNames:new Set(Object.keys(F)) };
}

const _RAW_VERTEX_VARS = new Set(["i","j","k","n","x","y","z","part"]);

function sampleRawGeom(p, prim, scope){
  const want = prim==="points" ? 1 : prim==="triangles" ? 3 : 2;
  const useCol = p.colorOn===true;
  const mode = p.colorMode || "ramp";           // "ramp" (scalar→gradient) | "rgb" (3 exprs)
  const rgbMode = useCol && mode==="rgb";
  const colExpr = useCol ? (p.colorExpr || "i") : null;
  const rE = rgbMode ? (p.colorR ?? "512") : null;
  const gE = rgbMode ? (p.colorG ?? "512") : null;
  const bE = rgbMode ? (p.colorB ?? "512") : null;
  // Per-vertex alpha is independent of the color mode: an optional expression in
  // the same 0..1024 (10-bit) range → [0,1], default fully opaque. Interpolates
  // across the primitive like the colors do.
  const alphaOn = p.alphaOn===true;
  const aE = alphaOn ? (p.colorA ?? "1024") : null;
  const field = prim==="points" ? p.rawPoints : prim==="segments" ? p.rawSegments
              : prim==="glyphs" ? p.rawGlyphs : p.rawTris;
  const verts=[], cols=(useCol&&!rgbMode)?[]:null, rgb=rgbMode?[]:null, alpha=alphaOn?[]:null;

  const ch10=(e,sc)=>{ let x=safeEval(e,sc); if(!isFinite(x))x=0; x/=1024; return x<0?0:x>1?1:x; };
  // Evaluate one vertex's color into either the scalar group (ramp) or rgb group,
  // and its alpha into the alpha group when enabled.
  const evalColor=(sc, scalarGroup, rgbGroup, alphaGroup)=>{
    if(rgbMode){
      rgbGroup.push([ch10(rE,sc), ch10(gE,sc), ch10(bE,sc)]);
    } else if(scalarGroup){
      const cval=safeEval(colExpr,sc); scalarGroup.push(isFinite(cval)?cval:0);
    }
    if(alphaGroup) alphaGroup.push(ch10(aE,sc));
  };
  const anyPerVertex = useCol || alphaOn;

  if((p.src||"list")==="index"){
    // ONE template line; its parts/coords are expressions in i,j,k,n.
    const idxField = prim==="points" ? p.idxPoints : prim==="segments" ? p.idxSegments
                   : prim==="glyphs" ? p.idxGlyphs : p.idxTris;
    const line=String(idxField||"").split(/\n+/).map(s=>s.trim()).find(s=>s.length);
    if(!line) return { verts, cols, rgb, alpha };
    const parts=line.split("|").map(t=>t.trim());
    if(parts.length!==want) return { verts, cols, rgb, alpha };
    const exprs=parts.map(part=>splitCoords(part));
    const counts=String(p.idxCount||"").split(/[,;]/).map(s=>s.trim()).filter(Boolean);
    const ni=clampRawCount(safeEval(counts[0]||"1",scope)), 
          nj=counts[1]!=null?clampRawCount(safeEval(counts[1],scope)):1,
          nk=counts[2]!=null?clampRawCount(safeEval(counts[2],scope)):1;

    // ── JIT fast path ───────────────────────────────────────────────────────
    // Compile every coordinate + color + alpha expression to native JS. If all
    // compile, run a tight loop that calls them with a reused V object — no
    // mathjs interpretation, no per-vertex scope spread. Falls back to the
    // interpreted loop below if ANY expression is outside the JIT subset, so
    // results are always identical to mathjs.
    let jit=null;
    try{ jit=buildJitContext(scope); }catch(e){ jit=null; }
    if(jit){
      // compile the want×3 coordinate exprs
      const cfns=[]; let ok=true;
      for(let part=0;part<want && ok;part++){
        const row=[];
        for(let d=0;d<3;d++){ const f=compileToJS(exprs[part][d]||"0", jit.fnNames, _RAW_VERTEX_VARS); if(!f){ ok=false; break; } row.push(f); }
        cfns.push(row);
      }
      // compile color/alpha exprs
      let fR,fG,fB,fScal,fA;
      if(ok && rgbMode){ fR=compileToJS(rE,jit.fnNames,_RAW_VERTEX_VARS); fG=compileToJS(gE,jit.fnNames,_RAW_VERTEX_VARS); fB=compileToJS(bE,jit.fnNames,_RAW_VERTEX_VARS); if(!fR||!fG||!fB) ok=false; }
      else if(ok && cols){ fScal=compileToJS(colExpr,jit.fnNames,_RAW_VERTEX_VARS); if(!fScal) ok=false; }
      if(ok && alphaOn){ fA=compileToJS(aE,jit.fnNames,_RAW_VERTEX_VARS); if(!fA) ok=false; }

      if(ok){
        const S=jit.S, F=jit.F;
        const V={i:0,j:0,k:0,n:0,x:0,y:0,z:0,part:0};
        const clamp01=(x)=>{ if(!isFinite(x))x=0; x/=1024; return x<0?0:x>1?1:x; };
        for(let i=0;i<ni;i++)for(let j=0;j<nj;j++)for(let k=0;k<nk;k++){
          V.i=i; V.j=j; V.k=k; V.n=(i*nj+j)*nk+k;
          const group=[]; let bad=false; const cgroup=cols?[]:null; const rgroup=rgb?[]:null; const agroup=alpha?[]:null;
          for(let part=0;part<want;part++){
            V.part=part; V.x=0; V.y=0; V.z=0;
            const r=cfns[part];
            const vx=r[0](S,F,V), vy=r[1](S,F,V), vz=r[2](S,F,V);
            if(!isFinite(vx)||!isFinite(vy)||!isFinite(vz)){ bad=true; break; }
            group.push([vx,vy,vz]);
            if(anyPerVertex){
              V.x=vx; V.y=vy; V.z=vz;
              if(rgbMode) rgroup.push([clamp01(fR(S,F,V)), clamp01(fG(S,F,V)), clamp01(fB(S,F,V))]);
              else if(cgroup){ const cv=fScal(S,F,V); cgroup.push(isFinite(cv)?cv:0); }
              if(agroup) agroup.push(clamp01(fA(S,F,V)));
            }
          }
          if(bad) continue;
          verts.push(want===1?[group[0]]:group);
          if(cols) cols.push(cgroup);
          if(rgb) rgb.push(rgroup);
          if(alpha) alpha.push(agroup);
        }
        return { verts, cols, rgb, alpha };
      }
    }

    // ── interpreted fallback (mathjs) ───────────────────────────────────────
    for(let i=0;i<ni;i++)for(let j=0;j<nj;j++)for(let k=0;k<nk;k++){
      const n=(i*nj+j)*nk+k;
      const sc={...scope, i, j, k, n};
      const group=[]; let bad=false; const cgroup=cols?[]:null; const rgroup=rgb?[]:null; const agroup=alpha?[]:null;
      for(let part=0;part<want;part++){
        const e=exprs[part];
        const v=[safeEval(e[0]||"0",sc)??0, safeEval(e[1]||"0",sc)??0, safeEval(e[2]||"0",sc)??0];
        if(v.some(x=>!isFinite(x))){ bad=true; break; }
        group.push(v);
        if(anyPerVertex) evalColor({...sc, x:v[0], y:v[1], z:v[2], part}, cgroup, rgroup, agroup);
      }
      if(bad) continue;
      verts.push(want===1?[group[0]]:group);
      if(cols) cols.push(cgroup);
      if(rgb) rgb.push(rgroup);
      if(alpha) alpha.push(agroup);
    }
    return { verts, cols, rgb, alpha };
  }

  // list mode — literal numbers, but still evaluated (so constants/scalars work).
  let row=0;
  for(const ln of String(field||"").split(/\n+/)){
    const s=ln.trim(); if(!s) continue;
    const parts=s.split("|").map(t=>t.trim()).filter(t=>t.length);
    if(parts.length!==want){ row++; continue; }
    const group=[]; let bad=false; const cgroup=cols?[]:null; const rgroup=rgb?[]:null; const agroup=alpha?[]:null;
    let part=0;
    for(const partStr of parts){
      const nums=splitCoords(partStr).map(t=>resolveNum(t,scope,NaN));
      const v=[nums[0]??0, nums[1]??0, nums[2]??0];
      if(v.some(x=>!isFinite(x))){ bad=true; break; }
      group.push(v);
      if(anyPerVertex) evalColor({...scope, i:row, n:row, x:v[0], y:v[1], z:v[2], part}, cgroup, rgroup, agroup);
      part++;
    }
    if(bad){ row++; continue; }
    verts.push(want===1?[group[0]]:group);
    if(cols) cols.push(cgroup);
    if(rgb) rgb.push(rgroup);
    if(alpha) alpha.push(agroup);
    row++;
  }
  return { verts, cols, rgb, alpha };
}

function clampRawCount(c){ if(c==null||!isFinite(c))return 1; return Math.max(1,Math.min(20000,Math.round(c))); }

// Split a coordinate string on TOP-LEVEL commas only, so commas inside function
// calls — e.g. h(x, y) or atan2(y, x) — stay intact. Thin wrapper over the shared
// splitTopLevel in core/math.js (kept for the existing call sites in this file).
function splitCoords(s){ return splitTopLevel(s); }

// Back-compat: the 2D renderer imports parseRawRows for plain list parsing.
function parseRawRows(text, prim, scope){
  const want = prim==="points" ? 1 : prim==="triangles" ? 3 : 2;
  const out=[];
  for(const line of String(text||"").split(/\n+/)){
    const s=line.trim(); if(!s) continue;
    const parts=s.split("|").map(t=>t.trim()).filter(t=>t.length);
    if(parts.length!==want) continue;
    const vecs=parts.map(part=>{
      const nums=splitCoords(part).map(t=>resolveNum(t,scope,NaN));
      return [nums[0]??0, nums[1]??0, nums[2]??0];
    });
    if(vecs.some(v=>!isFinite(v[0])||!isFinite(v[1])||!isFinite(v[2]))) continue;
    out.push(want===1 ? vecs[0] : vecs);
  }
  return out;
}

export {
  buildSurfGPU, buildTransformerGraphGPU, buildTransformerSphericalGPU, buildFn1dGPU, buildCurve3d, buildSegments3d, buildSurf, buildPlane3d, buildPoint3d, buildPointSeq3d, buildPointSeqGPU, buildQuiver3d, buildQuiver3dGPU, buildGlyphFieldGPU, buildSurfFromGridGPU, buildScalarVolume, buildRawGeom3d, buildMesh3d, meshDataFromGeometry, meshDataSig, parseRawRows, sampleRawGeom
};
