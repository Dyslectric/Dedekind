import * as THREE from "three";
import { resolveNum, safeEval, linspace } from "../core/math.js";
import { catOf } from "../core/taxonomy.js";
import { resolveScope, plotDomain, geomSignature, plotSignature } from "../core/scope.js";
import { disposeObjs, addPlotObj, updateGpuUniforms } from "./three-helpers.js";
import {
  buildSurfGPU, buildFn1dGPU, buildQuiver3dGPU, buildGlyphFieldGPU,
  buildCurve3d, buildSurf, buildPlane3d, buildPoint3d, buildPointSeq3d, buildPointSeqGPU, buildQuiver3d, buildRawGeom3d, buildSegments3d
} from "./builders.js";
import { buildFlowFromSeeds } from "./flow.js";
import { buildTransformer, sampleParamSpace } from "./transformer.js";
import { getNodeTexture } from "./textures.js";
import { parsePointSeq, parseGlyphField, parsePointsExplicit, parseGlyphsExplicit } from "./parse.js";
import { normalizedNode } from "../nodes/normalize.js";
import { buildScalarVolume } from "./builders.js";

// Compute per-point gradient colors for a points node. Each point gets a scalar
// from colorExpr (vars: i index, n count, x,y,z position, plus wired scalars in
// scope), normalized across [colorMin,colorMax] (auto from data when blank) and
// mapped onto the colorLo→colorHi ramp. Returns an array of [r,g,b] (0..1) or
// null when coloring is off.
function pointGradientColors(pts, p, scope){
  if((p.colorMode||"off")!=="gradient") return null;
  const expr=p.colorExpr||"i";
  const lo=new THREE.Color((p.colorLo||"#3a6aff")); const hi=new THREE.Color((p.colorHi||"#ff5ea8"));
  const n=pts.length;
  const vals=new Array(n);
  for(let i=0;i<n;i++){
    const pt=pts[i]||[0,0,0];
    const v=safeEval(expr,{...scope, i, n, x:pt[0]??0, y:pt[1]??0, z:pt[2]??0});
    vals[i]=(v==null||!isFinite(v))?0:v;
  }
  let mn=p.colorMin!==""&&p.colorMin!=null?resolveNum(p.colorMin,scope,0):Math.min(...vals);
  let mx=p.colorMax!==""&&p.colorMax!=null?resolveNum(p.colorMax,scope,1):Math.max(...vals);
  if(!isFinite(mn)) mn=0; if(!isFinite(mx)) mx=1;
  const span=(mx-mn)||1;
  const out=new Array(n);
  const c=new THREE.Color();
  for(let i=0;i<n;i++){
    let t=(vals[i]-mn)/span; t=t<0?0:t>1?1:t;
    c.copy(lo).lerp(hi,t);
    out[i]=[c.r,c.g,c.b];
  }
  return out;
}

// Map an array of raw color scalars (from an explicit color slot) onto the
// node's colorLo→colorHi ramp, auto-fitting the range when colorMin/Max blank.
// Returns [[r,g,b]…] in 0..1, or null when there are no usable values.
function rampColors(vals, p, scope){
  if(!vals || !vals.length) return null;
  const lo=new THREE.Color(p.colorLo||"#3a6aff"), hi=new THREE.Color(p.colorHi||"#ff5ea8"), c=new THREE.Color();
  let mn=(p.colorMin!==""&&p.colorMin!=null)?resolveNum(p.colorMin,scope,0):Math.min(...vals);
  let mx=(p.colorMax!==""&&p.colorMax!=null)?resolveNum(p.colorMax,scope,1):Math.max(...vals);
  if(!isFinite(mn)) mn=0; if(!isFinite(mx)) mx=1;
  const span=(mx-mn)||1;
  return vals.map(v=>{ let t=((v??0)-mn)/span; t=t<0?0:t>1?1:t; c.copy(lo).lerp(hi,t); return [c.r,c.g,c.b]; });
}

// Resolve the lights wired into a camera into plain descriptors (numbers + a
// colour hex), each against its OWN scope so an animator/slider wired to a light
// drives it. Re-run every rebuild (which runs per animated frame), so light
// values stay live; the values then flow to the GPU as uniforms. Empty → the lit
// shader keeps its single fixed key light, so unlit-by-nodes scenes are unchanged.
function gatherLights(camNode,nodes,animVals){
  const out=[];
  for(const id of (camNode.attachments||[])){
    const ln=nodes[id]; if(!ln || catOf(ln.type)!=="light" || ln.enabled===false) continue;
    const q=ln.props||{}; const lsc=resolveScope(id,nodes,animVals||{});
    out.push({
      kind: q.kind==="point" ? "point" : "directional",
      dirX:resolveNum(q.dirX,lsc,0), dirY:resolveNum(q.dirY,lsc,0), dirZ:resolveNum(q.dirZ,lsc,1),
      posX:resolveNum(q.posX,lsc,0), posY:resolveNum(q.posY,lsc,0), posZ:resolveNum(q.posZ,lsc,0),
      colorHex:q.color||"#ffffff", intensity:resolveNum(q.intensity,lsc,1), falloff:resolveNum(q.falloff,lsc,0),
    });
  }
  return out;
}

function rebuildScene(scene,objMap,camNode,nodes,scope,animVals){
  const seen=new Set();if(!camNode)return;
  const lights=gatherLights(camNode,nodes,animVals);
  for(const childId of(camNode.attachments||[])){
    const rawNode=nodes[childId];if(!rawNode)continue;
    if(catOf(rawNode.type)!=="plot") continue;   // only plots render in a camera
    seen.add(childId);
    // Normalize unified authoring kinds (scalarFn/paramSpace/points) down to the
    // legacy vocabulary the builders understand. childId stays the original id.
    const node=normalizedNode(rawNode);
    // Per-plot scope: ONLY the scalars/functions/exprs directly attached to THIS
    // plot. A plot can no longer reference variables it isn't wired to — neither
    // ambient globals nor scalars reachable only through another node. Functions
    // attached to the plot still close over their own direct deps internally.
    const pscope = resolveScope(childId, nodes, animVals||{});
    const dom = plotDomain(childId, nodes);
    const p = dom ? applyDomain(node.props, node.type, dom) : node.props;
    rebuildOnePlot(scene,objMap,childId,node,p,pscope,nodes,camNode,animVals,lights);
  }
  for(const[id,objs]of objMap){if(!seen.has(id)){disposeObjs(scene,objs);objMap.delete(id);}}
}
// Merge a domain node's parameters into a plot's effective props, mapping the
// domain's generic (a,b,c) ranges onto the plot's expected range prop names.
function applyDomain(props, type, dom){
  if(!dom) return props;
  const o={...props};
  const set=(k,v)=>{ if(v!==undefined&&v!=="") o[k]=v; };
  switch(type){
    case "fn1d": set("xMin",dom.aMin);set("xMax",dom.aMax);set("res",dom.res);break;
    case "curve3d": set("tMin",dom.aMin);set("tMax",dom.aMax);set("res",dom.res);break;
    case "surf3d": set("xMin",dom.aMin);set("xMax",dom.aMax);set("yMin",dom.bMin);set("yMax",dom.bMax);set("res",dom.res);break;
    case "paramsurf": set("uMin",dom.aMin);set("uMax",dom.aMax);set("vMin",dom.bMin);set("vMax",dom.bMax);set("uRes",dom.res);set("vRes",dom.resB);break;
    case "quiver2d": set("xMin",dom.aMin);set("xMax",dom.aMax);set("yMin",dom.bMin);set("yMax",dom.bMax);set("gridN",dom.res);break;
    case "quiver3d": set("xMin",dom.aMin);set("xMax",dom.aMax);set("yMin",dom.bMin);set("yMax",dom.bMax);set("zMin",dom.cMin);set("zMax",dom.cMax);set("gridN",dom.res);break;
  }
  return o;
}
function rebuildOnePlot(scene,objMap,childId,node,p,scope,nodes,camNode,animVals,lights){
    // Scene lights illuminate lit surfaces. Their VALUES ride as live uniforms
    // (no rebuild on change); only the count + kinds are structural, so fold just
    // that into the cache signature. null → the shader's single fixed key light.
    const litPlot = p.shading==="lit" && (node.type==="surf3d"||node.type==="paramsurf"||node.type==="transformer");
    const sceneLights = (litPlot && lights && lights.length) ? lights : null;
    const lightSig = sceneLights ? `|L:${sceneLights.length}:${sceneLights.map(l=>l.kind[0]).join("")}` : "";
    // Geometry signature (folds wired fnMap/paramSpace/equation expressions and
    // their scopes) — shared with the 2-D scene cache so both invalidate alike.
    let sig=plotSignature(node,p,scope,nodes,animVals);
    // A texture/video wired into a surface isn't in the normalized node's props,
    // so fold its source into the signature here (swapping the image rebuilds).
    if(sig!=null && (node.type==="surf3d"||node.type==="paramsurf")){
      for(const depId of (nodes[childId]?.attachments||[])){ const d=nodes[depId];
        if(d&&(d.type==="texture"||d.type==="video")){ sig+=`|tex:${d.type}|${d.props?.role||"color"}|${d.props?.src||""}|${d.props?.filter||""}|${d.props?.wrap||""}`; }
      }
      sig+=`|mat:${p.matColorMode||""}|${p.uvScaleU||""},${p.uvScaleV||""},${p.uvOffU||""},${p.uvOffV||""},${p.uvRot||""}|ns:${p.matNormalStrength||""}`;
    }
    if(sig!=null) sig+=lightSig;
    // sigScope is needed below for live uniform updates on cache hits.
    let sigScope=scope;
    if(node.type==="transformer"||node.type==="flow"){
      const structScopes=[];
      const animV=animVals||{};
      for(const depId of (node.attachments||[])){
        const dep=nodes[depId]; if(!dep) continue;
        if(dep.type==="fnMap"||dep.type==="equation"||dep.type==="paramSpace"||dep.type==="points") structScopes.push(resolveScope(dep.id,nodes,animV));
      }
      sigScope={...scope}; for(const s of structScopes) Object.assign(sigScope,s);
    }
    const prev=objMap.get(childId);

    // ── Cache hit ───────────────────────────────────────────────────────────
    // If nothing geometry-affecting changed, reuse the existing objects. For
    // GPU objects we still refresh uniforms (sliders animate for free); for CPU
    // objects we skip the rebuild entirely.
    if(prev && sig!=null && prev._sig===sig){
      // For GPU objects, push fresh uniform values (sliders/animators animate for
      // free). Use sigScope so transformers pick up scalars attached to the wired
      // fnMap/equation/paramSpace, not just the transformer's own scope.
      if(prev._gpu){
        // Push fresh (live) light values onto the cached lit objects before the
        // uniform refresh, so an animated light moves without a geometry rebuild.
        if(sceneLights) for(const o of prev){ if(o._gpuSurface && o._gpuSurface.lights) o._gpuSurface.lights=sceneLights; }
        updateGpuUniforms(prev,sigScope);
      }
      // sequencing reveal is cheap and may change every frame — apply it live
      if(prev._sequenced) applySequence(prev,node,scope);
      return;
    }

    // ── GPU fast path for analytic surfaces / curves / quivers ──────────────
    if(node.type==="surf3d"||node.type==="fn1d"||node.type==="paramsurf"||node.type==="quiver3d"||node.type==="glyphField"){
      let gpu=null;
      // A texture/video wired into this surface (a parametric surface can be
      // texturable) — resolve it so buildSurfGPU can sample it as albedo.
      let surfTex=null, surfTexNode=null, surfNorm=null, surfNormNode=null;
      if(node.type==="surf3d"||node.type==="paramsurf"){
        for(const depId of (nodes[childId]?.attachments||[])){ const d=nodes[depId]; if(!d) continue;
          if(d.type==="texture"||d.type==="video"){
            if(d.props && d.props.role==="normal"){ if(!surfNormNode){ surfNormNode=d; surfNorm=getNodeTexture(d); } }
            else if(!surfTexNode){ surfTexNode=d; surfTex=getNodeTexture(d); }
          }
        }
      }
      const surfNstr=resolveNum(p.matNormalStrength,scope,1);
      if(node.type==="surf3d") gpu=buildSurfGPU("surf3d",p,scope,node.color||"#5b9cf6",surfTex,surfNorm,surfNstr,sceneLights);
      else if(node.type==="paramsurf") gpu=buildSurfGPU("paramsurf",p,scope,node.color||"#c761f7",surfTex,surfNorm,surfNstr,sceneLights);
      else if(node.type==="fn1d") gpu=buildFn1dGPU(p,scope,node.color||"#f7cc4f");
      else if(node.type==="quiver3d") gpu=buildQuiver3dGPU(p,scope,node.color||"#5b9cf6");
      else if(node.type==="glyphField"){
        // Prefer the explicit (dropdown-authored) parse so the recursible color
        // slot is honoured; fall back to the legacy text parse for old projects.
        let pairs, gcols=null;
        if(p.__explicit){
          const r=parseGlyphsExplicit(p.__explicit,scope);
          pairs=r.pairs;
          if(p.__useColor) gcols=rampColors(r.cols,p,scope);
        } else {
          pairs=parseGlyphField(p.pairs,scope);
        }
        gpu=buildGlyphFieldGPU(pairs,node.color||"#5be0c0",{
          arrowLen:resolveNum(p.arrowLen,scope,0.5),
          lenMode:p.lenMode||(p.normalize===false?"scaled":"uniform"),
          anim:p.anim||"crest", speed:resolveNum(p.speed,scope,1), crestColor:p.crestColor||"#ffffff",
          cols:gcols,
        });
      }
      if(gpu&&gpu.length){
        disposeObjs(scene,objMap.get(childId)||[]);
        gpu.forEach(o=>addPlotObj(scene,o));
        gpu._gpu=true; gpu._sig=sig;
        // mark animated glyph sets so the scene keeps redrawing & advancing time
        if(node.type==="glyphField" && gpu[0]?._glyphAnim) gpu._glyphAnim=true;
        if((surfTexNode && surfTexNode.type==="video")||(surfNormNode && surfNormNode.type==="video")) gpu._glyphAnim=true;   // keep ticking for video frames
        objMap.set(childId,gpu);
        return;
      }
      // else fall through to CPU build
    }

    disposeObjs(scene,objMap.get(childId)||[]);
    let objs=[];
    if(node.type==="curve3d"){
      const ts=linspace(resolveNum(p.tMin,scope,0),resolveNum(p.tMax,scope,Math.PI*2),Math.max(2,resolveNum(p.res,scope,300)));
      const cpts=ts.map(t=>{const x=safeEval(p.exprX,{...scope,t}),y=safeEval(p.exprY,{...scope,t}),z=safeEval(p.exprZ,{...scope,t});return x!=null&&y!=null&&z!=null?[x,y,z]:[NaN,NaN,NaN];});
      // RGB colour along the curve: per-vertex colour from three expressions in
      // the curve parameter t (+ wired scalars), clamped to 0..1.
      let ccols=null;
      if(p.colorMode==="rgb"){
        const cl=v=>{ v=Number(v); return isFinite(v)?(v<0?0:v>1?1:v):0; };
        ccols=ts.map(t=>{const sc={...scope,t};return [cl(safeEval(p.colorR,sc)),cl(safeEval(p.colorG,sc)),cl(safeEval(p.colorB,sc))];});
      }
      objs=buildCurve3d(cpts,node.color||"#5b9cf6",ccols);
    }
    if(node.type==="fn1d"){const xs=linspace(resolveNum(p.xMin,scope,-5),resolveNum(p.xMax,scope,5),Math.max(2,resolveNum(p.res,scope,300)));objs=buildCurve3d(xs.map(x=>{const y=safeEval(p.expr,{...scope,x});return y!=null?[x,y,0]:[NaN,NaN,NaN];}),node.color||"#f7cc4f");}
    if(node.type==="surf3d"){const res=Math.max(2,Math.min(200,resolveNum(p.res,scope,40)));const xs=linspace(resolveNum(p.xMin,scope,-4),resolveNum(p.xMax,scope,4),res),ys=linspace(resolveNum(p.yMin,scope,-4),resolveNum(p.yMax,scope,4),res);objs=buildSurf(ys.map(y=>xs.map(x=>{const z=safeEval(p.expr,{...scope,x,y});return z!=null?[x,y,z]:null;})),node.color||"#5b9cf6",null,p.showWire!==false);}
    if(node.type==="paramsurf"){const ur=Math.max(2,Math.min(200,resolveNum(p.uRes,scope,40))),vr=Math.max(2,Math.min(200,resolveNum(p.vRes,scope,30)));const us=linspace(resolveNum(p.uMin,scope,0),resolveNum(p.uMax,scope,Math.PI*2),ur),vs=linspace(resolveNum(p.vMin,scope,0),resolveNum(p.vMax,scope,Math.PI),vr);objs=buildSurf(vs.map(v=>us.map(u=>{const x=safeEval(p.exprX,{...scope,u,v}),y=safeEval(p.exprY,{...scope,u,v}),z=safeEval(p.exprZ,{...scope,u,v});return x!=null&&y!=null&&z!=null?[x,y,z]:null;})),node.color||"#c761f7",null,p.showWire!==false);}
    if(node.type==="paramvol"){
      // A degree-3 parametric manifold: sample a (u,v,w) grid and map each node
      // into 3-D space, drawn as a point cloud (optionally gradient-colored).
      const ur=Math.max(2,Math.min(96,resolveNum(p.uRes,scope,14))),
            vr=Math.max(2,Math.min(96,resolveNum(p.vRes,scope,14))),
            wr=Math.max(2,Math.min(96,resolveNum(p.wRes,scope,14)));
      const us=linspace(resolveNum(p.uMin,scope,0),resolveNum(p.uMax,scope,1),ur),
            vs=linspace(resolveNum(p.vMin,scope,0),resolveNum(p.vMax,scope,Math.PI),vr),
            ws=linspace(resolveNum(p.wMin,scope,0),resolveNum(p.wMax,scope,Math.PI*2),wr);
      const pts=[], cvals=(p.colorMode==="gradient")?[]:null;
      for(const u of us)for(const v of vs)for(const w of ws){
        const sc={...scope,u,v,w};
        const x=safeEval(p.exprX,sc),y=safeEval(p.exprY,sc),z=safeEval(p.exprZ,sc);
        if(x==null||y==null||z==null||!isFinite(x)||!isFinite(y)||!isFinite(z)) continue;
        pts.push([x,y,z]);
        if(cvals){const cv=safeEval(p.colorExpr||"u",sc);cvals.push((cv==null||!isFinite(cv))?0:cv);}
      }
      let cols=null;
      if(cvals&&cvals.length){
        const lo=new THREE.Color(p.colorLo||"#3a6aff"),hi=new THREE.Color(p.colorHi||"#ff5ea8"),c=new THREE.Color();
        let mn=(p.colorMin!==""&&p.colorMin!=null)?resolveNum(p.colorMin,scope,0):Math.min(...cvals);
        let mx=(p.colorMax!==""&&p.colorMax!=null)?resolveNum(p.colorMax,scope,1):Math.max(...cvals);
        if(!isFinite(mn))mn=0; if(!isFinite(mx))mx=1; const span=(mx-mn)||1;
        cols=cvals.map(val=>{let t=(val-mn)/span;t=t<0?0:t>1?1:t;c.copy(lo).lerp(hi,t);return [c.r,c.g,c.b];});
      }
      objs=buildPointSeqGPU(pts,node.color||"#b48cff",resolveNum(p.radius,scope,0.05),false,cols);
    }
    if(node.type==="plane"){const c=[resolveNum(p.centerX,scope,0),resolveNum(p.centerY,scope,0),resolveNum(p.centerZ,scope,0)],n=[resolveNum(p.normalX,scope,0),resolveNum(p.normalY,scope,1),resolveNum(p.normalZ,scope,0)];objs=buildPlane3d(c,n,resolveNum(p.size,scope,8),node.color||"#52d47e");}
    if(node.type==="point")objs=buildPoint3d(resolveNum(p.x,scope,0),resolveNum(p.y,scope,0),resolveNum(p.z,scope,0),node.color||"#ff70bb",resolveNum(p.radius,scope,0.08));
    if(node.type==="rawGeom")objs=buildRawGeom3d(p,scope,node.color||"#ff70bb");
    if(node.type==="__scalarVol"){
      objs=buildScalarVolume(p,scope,node.color||"#6df");
    }
    if(node.type==="transformer"){
      let fnNode=null, paramNode=null, eqNode=null, eqNode2=null, texNode=null, normTexNode=null;
      for(const depId of (node.attachments||[])){
        const dep=nodes[depId]; if(!dep) continue;
        if(dep.type==="fnMap" && !fnNode) fnNode=dep;
        else if(dep.type==="equation"){ if(!eqNode) eqNode=dep; else if(!eqNode2) eqNode2=dep; }
        else if(dep.type==="paramSpace" && !paramNode) paramNode=dep;
        else if(dep.type==="texture"||dep.type==="video"){
          if(dep.props && dep.props.role==="normal"){ if(!normTexNode) normTexNode=dep; }
          else if(!texNode) texNode=dep;
        }
      }
      // Each structural input (fnMap / equation / paramSpace) owns its own
      // expressions, which may reference scalars/functions wired directly into
      // THAT node. Under strict scoping those aren't in the transformer's scope,
      // so evaluate against a scope that layers each structural node's own direct
      // scope over the transformer's. (Transformer props still use `scope`.)
      const animV=animVals||{};
      const fnSc    = fnNode    ? resolveScope(fnNode.id, nodes, animV)    : null;
      const eqSc    = eqNode    ? resolveScope(eqNode.id, nodes, animV)    : null;
      const eqSc2   = eqNode2   ? resolveScope(eqNode2.id, nodes, animV)   : null;
      const paramSc = paramNode ? resolveScope(paramNode.id, nodes, animV) : null;
      const tScope={...scope,
        ...(paramSc||{}), ...(eqSc||{}), ...(eqSc2||{}), ...(fnSc||{})};
      // Per-equation scopes for the intersection path so two equations referencing
      // same-named scalars evaluate against their own wiring, not the merged scope.
      const scopeF = eqNode  ? {...scope, ...(paramSc||{}), ...(fnSc||{}), ...(eqSc||{})}  : tScope;
      const scopeG = eqNode2 ? {...scope, ...(paramSc||{}), ...(fnSc||{}), ...(eqSc2||{})} : tScope;
      const tex = texNode ? getNodeTexture(texNode) : null;
      const ntex = normTexNode ? getNodeTexture(normTexNode) : null;
      const nstr = resolveNum(node.props.matNormalStrength, tScope, 1);
      objs=buildTransformer(node,fnNode,paramNode,tScope,node.color||"#ffb454",eqNode,eqNode2,scopeF,scopeG,tex,ntex,nstr,sceneLights);
      // A video texture self-updates each frame; keep the render loop ticking.
      if(((texNode&&texNode.type==="video")||(normTexNode&&normTexNode.type==="video")) && objs && objs.length) objs._glyphAnim=true;
    }
    if(node.type==="pointSeq"){
      let pts, cols;
      if(p.__explicit){
        const r=parsePointsExplicit(p.__explicit,scope);
        pts=r.pts;
        // explicit color slot → ramp; else fall back to legacy gradient-by-value
        cols = p.__useColor ? rampColors(r.cols,p,scope) : pointGradientColors(pts,p,scope);
      } else {
        pts=parsePointSeq(p.points,scope);
        cols=pointGradientColors(pts,p,scope);
      }
      objs=buildPointSeqGPU(pts,node.color||"#ff70bb",resolveNum(p.radius,scope,0.07),p.drawLines!==false,cols);
      if(!objs.length) objs=buildPointSeq3d(pts,node.color||"#ff70bb",resolveNum(p.radius,scope,0.07),p.drawLines!==false);
      // Edges by index: a wired index-pair list [[i,j],…] (1-based, mathjs-style)
      // connects points of the vertex list — referenced, not duplicated. So one
      // shared list of vertices can carry many edge sets.
      const exEdges=p.__explicit&&p.__explicit.edgeList;
      if(exEdges && Array.isArray(scope[exEdges]) && pts.length){
        const segs=[];
        for(const e of scope[exEdges]){ if(!Array.isArray(e)||e.length<2) continue;
          const a=pts[Math.round(e[0])-1], b=pts[Math.round(e[1])-1]; if(a&&b) segs.push([a,b]); }
        if(segs.length){ const seg=buildSegments3d(segs,node.color||"#ff70bb"); if(seg.length) objs=[...objs,...seg]; }
      }
      if(p.sequenced){ objs._sequenced=true; applySequence(objs,node,scope); }
    }
    if(node.type==="quiver3d"){const gridN=Math.max(2,Math.min(48,resolveNum(p.gridN,scope,5)));objs=buildQuiver3d(p,p.exprX,p.exprY,p.exprZ,gridN,resolveNum(p.xMin,scope,-3),resolveNum(p.xMax,scope,3),resolveNum(p.yMin,scope,-3),resolveNum(p.yMax,scope,3),resolveNum(p.zMin,scope,-3),resolveNum(p.zMax,scope,3),node.color||"#5b9cf6",scope,p.normalize!==false);}
    if(node.type==="flow"){
      const steps=Math.max(2,Math.min(8000,resolveNum(p.steps,scope,500)));
      const stepSize=resolveNum(p.stepSize,scope,0.02);
      // Find the wired vector-field fnMap and the seed source. Seeds may come
      // from a paramSpace (continuous manifold → surface/volume) or a points
      // node (discrete seed points → one stream curve each).
      let fnNode=null, seedNode=null;
      for(const depId of (node.attachments||[])){
        const dep=nodes[depId]; if(!dep) continue;
        if(dep.type==="fnMap" && !fnNode) fnNode=dep;
        else if((dep.type==="paramSpace"||dep.type==="points") && !seedNode) seedNode=dep;
      }
      if(fnNode && seedNode){
        const field={ exprX:fnNode.props.out0||"0", exprY:fnNode.props.out1||"0", exprZ:fnNode.props.out2||"0" };
        const fromPoints = seedNode.type==="points";
        // The fnMap's field exprs and the seed source own their expressions and
        // may reference scalars/functions wired directly into those nodes. Build
        // each one's own direct scope and evaluate against it (layered over the
        // flow's scope so the flow's own variables remain available too).
        const animV=animVals||{};
        const fieldSc={...scope, ...resolveScope(fnNode.id, nodes, animV)};
        const seedSc ={...scope, ...resolveScope(seedNode.id, nodes, animV)};
        const seedInfo = fromPoints
          ? { pts: parsePointsExplicit(seedNode.props, seedSc).pts, grid:false }
          : sampleParamSpace(seedNode, seedSc);
        objs=buildFlowFromSeeds(field, seedInfo, steps, stepSize, fieldSc, node.color||"#f7cc4f", {
          // discrete point seeds always render as individual stream curves;
          // a continuous seed space honours the output mode.
          lines: fromPoints || p.output==="lines",
          gradient: !!p.gradient, gradA:p.gradA, gradB:p.gradB,
          slices: resolveNum(p.volSlices,scope,6),
          showWire: !!p.showWire,
        });
      } else {
        objs=[]; // unwired flow renders nothing (panel shows guidance)
      }
    }
    if(sig!=null) objs._sig=sig;
    objs.forEach(o=>addPlotObj(scene,o));objMap.set(childId,objs);
}

// ── Sequenced reveal ─────────────────────────────────────────────────────────
// Shows the first ⌈frac·N⌉ points of a sequence, where frac is driven by a
// scalar named in props.seqVar (default the first connected animator/slider) or
// the literal props.seqFrac. Lets recursive sequences / trajectories animate in
// point-by-point without rebuilding geometry.
function applySequence(objs, node, scope){
  const p=node.props;
  let frac;
  if(p.seqVar && typeof scope[p.seqVar]==="number") frac=scope[p.seqVar];
  else frac=resolveNum(p.seqFrac,scope,1);
  if(!isFinite(frac)) frac=1;
  frac=Math.max(0,Math.min(1,frac));
  // GPU instanced cloud: reveal by setting instanceCount; the connector Line is
  // clamped via drawRange. Both are O(1) per frame — no geometry rebuild.
  const inst=objs.find(o=>o.isInstancedMesh && o._gpuPoints);
  if(inst){
    const total=inst._fullCount||inst.count;
    const show=Math.max(0,Math.min(total,Math.ceil(frac*total)));
    inst.count=show;
    for(const ln of objs.filter(o=>o.type==="Line")){
      const g=ln.geometry; if(g&&g.attributes&&g.attributes.position){
        const tot=g.attributes.position.count;
        g.setDrawRange(0, Math.max(0,Math.min(tot, show)));
      }
    }
    return;
  }
  // CPU fallback: spheres are the point markers (Mesh w/ SphereGeometry); a
  // trailing Line is the connector. Reveal markers in order.
  const markers=objs.filter(o=>o.type==="Mesh");
  const lines=objs.filter(o=>o.type==="Line");
  const n=markers.length;
  const show=Math.max(0,Math.min(n,Math.ceil(frac*n)));
  markers.forEach((m,i)=>{ m.visible=i<show; });
  for(const ln of lines){
    const g=ln.geometry; if(g&&g.attributes&&g.attributes.position){
      const total=g.attributes.position.count;
      g.setDrawRange(0, Math.max(0,Math.min(total, show)));
    }
  }
}

export {
  rebuildScene, applyDomain, rebuildOnePlot, applySequence, pointGradientColors, rampColors
};
