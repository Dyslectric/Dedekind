import * as THREE from "three";
import { resolveNum, safeEval, linspace } from "../core/math.js";
import { catOf } from "../core/taxonomy.js";
import { resolveScope, plotDomain, geomSignature } from "../core/scope.js";
import { disposeObjs, updateGpuUniforms } from "./three-helpers.js";
import {
  buildSurfGPU, buildFn1dGPU, buildQuiver3dGPU, buildGlyphFieldGPU,
  buildCurve3d, buildSurf, buildPlane3d, buildPoint3d, buildPointSeq3d, buildPointSeqGPU, buildQuiver3d
} from "./builders.js";
import { buildFlowFromSeeds } from "./flow.js";
import { buildTransformer, sampleParamSpace } from "./transformer.js";
import { parsePointSeq, parseGlyphField } from "./parse.js";
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

function rebuildScene(scene,objMap,camNode,nodes,scope,animVals){
  const seen=new Set();if(!camNode)return;
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
    rebuildOnePlot(scene,objMap,childId,node,p,pscope,nodes,camNode,animVals);
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
function rebuildOnePlot(scene,objMap,childId,node,p,scope,nodes,camNode,animVals){
    // For transformers AND flows, fold the wired fnMap + paramSpace expressions
    // into the signature so geometry rebuilds when those upstream nodes change.
    let pSig=p;
    let sigScope=scope;
    if(node.type==="transformer"||node.type==="flow"){
      let fnSig="",paramSig="",eqSig="";
      const structScopes=[];
      const animV=animVals||{};
      for(const depId of (node.attachments||[])){
        const dep=nodes[depId]; if(!dep) continue;
        if(dep.type==="fnMap"){ fnSig=`${dep.props.inDim}|${dep.props.outDim}|${dep.props.out0}|${dep.props.out1}|${dep.props.out2}|${dep.props.out3}`; structScopes.push(resolveScope(dep.id,nodes,animV)); }
        else if(dep.type==="equation"){ const q=dep.props; eqSig=`eq|${q.dims||"2d"}|${q.lhs}|${q.rhs}|${q.varA}|${q.varB}|${q.varC}`; structScopes.push(resolveScope(dep.id,nodes,animV)); }
        else if(dep.type==="paramSpace"){ const q=dep.props; paramSig=`${q.degree}|${q.exprX}|${q.exprY}|${q.exprZ}|${q.exprXu}|${q.exprYu}|${q.exprZu}|${q.tMin}|${q.tMax}|${q.res}|${q.uMin}|${q.uMax}|${q.vMin}|${q.vMax}|${q.uRes}|${q.vRes}`; structScopes.push(resolveScope(dep.id,nodes,animV)); }
        else if(dep.type==="points"){ paramSig=`pts|${dep.props.space}|${dep.props.data}`; structScopes.push(resolveScope(dep.id,nodes,animV)); }
      }
      pSig={...p,__fnSig:fnSig,__paramSig:paramSig,__eqSig:eqSig};
      // Fold each structural node's own scope into the scope used for the
      // signature, so a slider wired into the fnMap/equation/paramSpace (not the
      // transformer itself) still invalidates the cache when it changes.
      sigScope={...scope}; for(const s of structScopes) Object.assign(sigScope,s);
    }
    const sig=geomSignature({...node,props:pSig},sigScope);
    const prev=objMap.get(childId);

    // ── Cache hit ───────────────────────────────────────────────────────────
    // If nothing geometry-affecting changed, reuse the existing objects. For
    // GPU objects we still refresh uniforms (sliders animate for free); for CPU
    // objects we skip the rebuild entirely.
    if(prev && sig!=null && prev._sig===sig){
      // For GPU objects, push fresh uniform values (sliders/animators animate for
      // free). Use sigScope so transformers pick up scalars attached to the wired
      // fnMap/equation/paramSpace, not just the transformer's own scope.
      if(prev._gpu) updateGpuUniforms(prev,sigScope);
      // sequencing reveal is cheap and may change every frame — apply it live
      if(prev._sequenced) applySequence(prev,node,scope);
      return;
    }

    // ── GPU fast path for analytic surfaces / curves / quivers ──────────────
    if(node.type==="surf3d"||node.type==="fn1d"||node.type==="paramsurf"||node.type==="quiver3d"||node.type==="glyphField"){
      let gpu=null;
      if(node.type==="surf3d") gpu=buildSurfGPU("surf3d",p,scope,node.color||"#5b9cf6");
      else if(node.type==="paramsurf") gpu=buildSurfGPU("paramsurf",p,scope,node.color||"#c761f7");
      else if(node.type==="fn1d") gpu=buildFn1dGPU(p,scope,node.color||"#f7cc4f");
      else if(node.type==="quiver3d") gpu=buildQuiver3dGPU(p,scope,node.color||"#5b9cf6");
      else if(node.type==="glyphField"){
        const pairs=parseGlyphField(p.pairs,scope);
        gpu=buildGlyphFieldGPU(pairs,node.color||"#5be0c0",{
          arrowLen:resolveNum(p.arrowLen,scope,0.5),
          lenMode:p.lenMode||(p.normalize===false?"scaled":"uniform"),
          anim:p.anim||"crest", speed:resolveNum(p.speed,scope,1), crestColor:p.crestColor||"#ffffff",
        });
      }
      if(gpu&&gpu.length){
        disposeObjs(scene,objMap.get(childId)||[]);
        gpu.forEach(o=>scene.add(o));
        gpu._gpu=true; gpu._sig=sig;
        // mark animated glyph sets so the scene keeps redrawing & advancing time
        if(node.type==="glyphField" && gpu[0]?._glyphAnim) gpu._glyphAnim=true;
        objMap.set(childId,gpu);
        return;
      }
      // else fall through to CPU build
    }

    disposeObjs(scene,objMap.get(childId)||[]);
    let objs=[];
    if(node.type==="curve3d"){const ts=linspace(resolveNum(p.tMin,scope,0),resolveNum(p.tMax,scope,Math.PI*2),Math.max(2,resolveNum(p.res,scope,300)));objs=buildCurve3d(ts.map(t=>{const x=safeEval(p.exprX,{...scope,t}),y=safeEval(p.exprY,{...scope,t}),z=safeEval(p.exprZ,{...scope,t});return x!=null&&y!=null&&z!=null?[x,y,z]:[NaN,NaN,NaN];}),node.color||"#5b9cf6");}
    if(node.type==="fn1d"){const xs=linspace(resolveNum(p.xMin,scope,-5),resolveNum(p.xMax,scope,5),Math.max(2,resolveNum(p.res,scope,300)));objs=buildCurve3d(xs.map(x=>{const y=safeEval(p.expr,{...scope,x});return y!=null?[x,y,0]:[NaN,NaN,NaN];}),node.color||"#f7cc4f");}
    if(node.type==="surf3d"){const res=Math.max(2,Math.min(80,resolveNum(p.res,scope,40)));const xs=linspace(resolveNum(p.xMin,scope,-4),resolveNum(p.xMax,scope,4),res),ys=linspace(resolveNum(p.yMin,scope,-4),resolveNum(p.yMax,scope,4),res);objs=buildSurf(ys.map(y=>xs.map(x=>{const z=safeEval(p.expr,{...scope,x,y});return z!=null?[x,y,z]:null;})),node.color||"#5b9cf6",null,p.showWire!==false);}
    if(node.type==="paramsurf"){const ur=Math.max(2,Math.min(80,resolveNum(p.uRes,scope,40))),vr=Math.max(2,Math.min(80,resolveNum(p.vRes,scope,30)));const us=linspace(resolveNum(p.uMin,scope,0),resolveNum(p.uMax,scope,Math.PI*2),ur),vs=linspace(resolveNum(p.vMin,scope,0),resolveNum(p.vMax,scope,Math.PI),vr);objs=buildSurf(vs.map(v=>us.map(u=>{const x=safeEval(p.exprX,{...scope,u,v}),y=safeEval(p.exprY,{...scope,u,v}),z=safeEval(p.exprZ,{...scope,u,v});return x!=null&&y!=null&&z!=null?[x,y,z]:null;})),node.color||"#c761f7",null,p.showWire!==false);}
    if(node.type==="paramvol"){
      // A degree-3 parametric manifold: sample a (u,v,w) grid and map each node
      // into 3-D space, drawn as a point cloud (optionally gradient-colored).
      const ur=Math.max(2,Math.min(40,resolveNum(p.uRes,scope,14))),
            vr=Math.max(2,Math.min(40,resolveNum(p.vRes,scope,14))),
            wr=Math.max(2,Math.min(40,resolveNum(p.wRes,scope,14)));
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
    if(node.type==="__scalarVol"){
      objs=buildScalarVolume(p,scope,node.color||"#6df");
    }
    if(node.type==="transformer"){
      let fnNode=null, paramNode=null, eqNode=null;
      for(const depId of (node.attachments||[])){
        const dep=nodes[depId]; if(!dep) continue;
        if(dep.type==="fnMap" && !fnNode) fnNode=dep;
        else if(dep.type==="equation" && !eqNode) eqNode=dep;
        else if(dep.type==="paramSpace" && !paramNode) paramNode=dep;
      }
      // Each structural input (fnMap / equation / paramSpace) owns its own
      // expressions, which may reference scalars/functions wired directly into
      // THAT node. Under strict scoping those aren't in the transformer's scope,
      // so evaluate against a scope that layers each structural node's own direct
      // scope over the transformer's. (Transformer props still use `scope`.)
      const animV=animVals||{};
      const fnSc    = fnNode    ? resolveScope(fnNode.id, nodes, animV)    : null;
      const eqSc    = eqNode    ? resolveScope(eqNode.id, nodes, animV)    : null;
      const paramSc = paramNode ? resolveScope(paramNode.id, nodes, animV) : null;
      const tScope={...scope,
        ...(paramSc||{}), ...(eqSc||{}), ...(fnSc||{})};
      objs=buildTransformer(node,fnNode,paramNode,tScope,node.color||"#ffb454",eqNode);
    }
    if(node.type==="pointSeq"){
      const pts=parsePointSeq(p.points,scope);
      const cols=pointGradientColors(pts,p,scope);
      objs=buildPointSeqGPU(pts,node.color||"#ff70bb",resolveNum(p.radius,scope,0.07),p.drawLines!==false,cols);
      if(!objs.length) objs=buildPointSeq3d(pts,node.color||"#ff70bb",resolveNum(p.radius,scope,0.07),p.drawLines!==false);
      if(p.sequenced){ objs._sequenced=true; applySequence(objs,node,scope); }
    }
    if(node.type==="quiver3d"){const gridN=Math.max(2,Math.min(12,resolveNum(p.gridN,scope,5)));objs=buildQuiver3d(p,p.exprX,p.exprY,p.exprZ,gridN,resolveNum(p.xMin,scope,-3),resolveNum(p.xMax,scope,3),resolveNum(p.yMin,scope,-3),resolveNum(p.yMax,scope,3),resolveNum(p.zMin,scope,-3),resolveNum(p.zMax,scope,3),node.color||"#5b9cf6",scope,p.normalize!==false);}
    if(node.type==="flow"){
      const steps=Math.max(2,Math.min(2000,resolveNum(p.steps,scope,500)));
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
          ? { pts: parsePointSeq(seedNode.props.data, seedSc), grid:false }
          : sampleParamSpace(seedNode, seedSc);
        objs=buildFlowFromSeeds(field, seedInfo, steps, stepSize, fieldSc, node.color||"#f7cc4f", {
          // discrete point seeds always render as individual stream curves;
          // a continuous seed space honours the output mode.
          lines: fromPoints || p.output==="lines",
          gradient: !!p.gradient, gradA:p.gradA, gradB:p.gradB,
          slices: resolveNum(p.volSlices,scope,6),
        });
      } else {
        objs=[]; // unwired flow renders nothing (panel shows guidance)
      }
    }
    if(sig!=null) objs._sig=sig;
    objs.forEach(o=>scene.add(o));objMap.set(childId,objs);
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
  rebuildScene, applyDomain, rebuildOnePlot, applySequence, pointGradientColors
};
