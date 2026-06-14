import { catOf } from "./taxonomy.js";
import { resolveNum, safeEval, makeFn } from "./math.js";
import * as math from "mathjs";

// ── Scope resolution ─────────────────────────────────────────────────────────
// New model: `node.attachments` lists the node's UPSTREAM dependencies — the
// scalars, functions and domains it consumes (and, for a camera, the plots it
// shows). Scope for a consumer is built by walking its attached scalars and
// functions transitively, so a plot sees exactly the values wired into it (or
// into the functions wired into it).
function collectScalarDeps(nodeId, nodes, acc, guard){
  const n=nodes[nodeId]; if(!n) return;
  if(guard.has(nodeId)) return; guard.add(nodeId);
  for(const depId of (n.attachments||[])){
    const dep=nodes[depId]; if(!dep) continue;
    const cat=catOf(dep.type);
    if(cat==="scalar" || cat==="function"){
      acc.add(depId);
      // a function/scalar may itself depend on further scalars
      collectScalarDeps(depId, nodes, acc, guard);
    } else if(cat==="map" || cat==="plot" || cat==="domain"){
      // A transformer consumes an fnMap (map) and possibly a paramSpace (plot)
      // domain; those may carry their own scalar/function deps. Recurse through
      // them so the consumer's scope includes everything it transitively needs.
      collectScalarDeps(depId, nodes, acc, guard);
    }
  }
}
// Build a {name: value|fn} scope for a consumer node from its attached deps.
function resolveScope(consumerId, nodes, animVals){
  const sc={};
  const deps=new Set();
  collectScalarDeps(consumerId, nodes, deps, new Set());
  const list=[...deps].map(id=>nodes[id]).filter(Boolean);
  // scalars first
  for(const n of list){
    if(!n.name) continue;
    if(n.type==="constant") sc[n.name]=resolveNum(n.props.value,{},0);
    else if(n.type==="slider") sc[n.name]=typeof n.value==="number"?n.value:0;
    else if(n.type==="animator") sc[n.name]=animVals?.[n.id]??(typeof n.value==="number"?n.value:0);
  }
  // then functions (which close over the scalar scope)
  for(const n of list){
    if(n.type==="fnDef" && n.name && n.props?.expr){
      const params=(n.props.params||"x").split(",").map(s=>s.trim()).filter(Boolean);
      sc[n.name]=makeFn(n.name,params,n.props.expr,sc);
    }
  }
  return sc;
}
// A camera's own scope = union of the scopes of the plots it shows, plus any
// scalars attached directly to the camera (for camera props that depend on a
// scalar). Used for camera-prop evaluation and the scalar overlay.
function buildScopeForCamera(camId, nodes, animVals){
  const cam=nodes[camId]; if(!cam) return {};
  const sc=resolveScope(camId, nodes, animVals); // direct scalar deps on camera
  for(const plotId of (cam.attachments||[])){
    const plot=nodes[plotId]; if(!plot||catOf(plot.type)!=="plot") continue;
    Object.assign(sc, resolveScope(plotId, nodes, animVals));
  }
  return sc;
}
// Resolve a domain node's sampling parameters as a plain object.
function resolveDomain(domId, nodes){
  const d=nodes[domId]; if(!d||d.type!=="domain") return null;
  const p=d.props||{};
  return {
    kind: p.kind||"interval",  // interval | rect | box
    aMin:p.aMin, aMax:p.aMax, bMin:p.bMin, bMax:p.bMax, cMin:p.cMin, cMax:p.cMax,
    res:p.res, resB:p.resB, resC:p.resC, var:p.var||"",
  };
}
// Find the first domain attached to a plot (plots take at most one domain).
function plotDomain(plotId, nodes){
  const plot=nodes[plotId]; if(!plot) return null;
  for(const id of (plot.attachments||[])){
    if(nodes[id]?.type==="domain") return { id, ...resolveDomain(id, nodes) };
  }
  return null;
}

function buildGlobalScope(nodes, animVals) {
  const sc = {};
  for (const n of Object.values(nodes)) {
    if (!n.name) continue;
    if (n.type === "constant")  sc[n.name] = resolveNum(n.props.value, {}, 0);
    else if (n.type === "slider") sc[n.name] = typeof n.value === "number" ? n.value : 0;
    else if (n.type === "animator") sc[n.name] = animVals?.[n.id] ?? (typeof n.value === "number" ? n.value : 0);
  }
  for (const n of Object.values(nodes)) {
    if (n.type === "fnDef" && n.name && n.props?.expr) {
      const params = (n.props.params||"x").split(",").map(s=>s.trim()).filter(Boolean);
      sc[n.name] = makeFn(n.name, params, n.props.expr, sc);
    }
  }
  return sc;
}


// ── 3D scene rebuilder ───────────────────────────────────────────────────────
// Signature of the geometry-affecting props for a node. If only scalar
// (uniform) values changed between frames, the signature is unchanged and we
// can skip rebuilding GPU surfaces — just push new uniform values. This is what
// makes animated sliders on a GPU surface essentially free.
function geomSignature(node, scope){
  const p=node.props;
  const c=node.color||"";
  switch(node.type){
    case "surf3d": return `s|${c}|${p.expr}|${p.xMin}|${p.xMax}|${p.yMin}|${p.yMax}|${resolveNum(p.res,scope,40)}`;
    case "fn1d": return `f|${c}|${p.expr}|${p.xMin}|${p.xMax}|${resolveNum(p.res,scope,300)}`;
    case "paramsurf": return `p|${c}|${p.exprX}|${p.exprY}|${p.exprZ}|${p.uMin}|${p.uMax}|${p.vMin}|${p.vMax}|${resolveNum(p.uRes,scope,40)}|${resolveNum(p.vRes,scope,30)}`;
    case "paramvol": return `pv|${c}|${p.exprX}|${p.exprY}|${p.exprZ}|${p.uMin}|${p.uMax}|${p.vMin}|${p.vMax}|${p.wMin}|${p.wMax}|${resolveNum(p.uRes,scope,14)}|${resolveNum(p.vRes,scope,14)}|${resolveNum(p.wRes,scope,14)}|${p.colorMode||"off"}|${p.colorExpr||""}|${p.colorLo||""}|${p.colorHi||""}|${p.colorMin||""}|${p.colorMax||""}|${scopeSig(node,scope)}`;
    case "curve3d": return `c|${c}|${p.exprX}|${p.exprY}|${p.exprZ}|${resolveNum(p.tMin,scope,0)}|${resolveNum(p.tMax,scope,6.283)}|${resolveNum(p.res,scope,300)}|${scopeSig(node,scope)}`;
    case "plane": return `pl|${c}|${resolveNum(p.centerX,scope,0)}|${resolveNum(p.centerY,scope,0)}|${resolveNum(p.centerZ,scope,0)}|${resolveNum(p.normalX,scope,0)}|${resolveNum(p.normalY,scope,1)}|${resolveNum(p.normalZ,scope,0)}|${resolveNum(p.size,scope,8)}`;
    case "point": return `pt|${c}|${resolveNum(p.x,scope,0)}|${resolveNum(p.y,scope,0)}|${resolveNum(p.z,scope,0)}|${resolveNum(p.radius,scope,0.08)}`;
    case "__scalarVol": return `sv|${c}|${p.expr}|${p.xMin}|${p.xMax}|${p.yMin}|${p.yMax}|${p.zMin}|${p.zMax}|${resolveNum(p.res,scope,18)}|${p.colorByValue?1:0}|${p.colorLo}|${p.colorHi}|${scopeSig(node,scope)}`;
    case "transformer": return `tr|${c}|${p.mode}|${p.domainSrc}|${p.inAxis0}|${p.inAxis1}|${p.inAxis2}|${p.outAxis0}|${p.outAxis1}|${p.outAxis2}|${p.normalize?1:0}|${resolveNum(p.arrowLen,scope,0.5)}|${p.aMin}|${p.aMax}|${p.bMin}|${p.bMax}|${p.cMin}|${p.cMax}|${p.dMin}|${p.dMax}|${resolveNum(p.res,scope,60)}|${p.colorMode||"off"}|${p.colorExpr||""}|${p.colorLo||""}|${p.colorHi||""}|${p.colorMin||""}|${p.colorMax||""}|${p.__fnSig||""}|${p.__paramSig||""}|${scopeSig(node,scope)}`;
    case "pointSeq": return `ps|${c}|${p.points}|${resolveNum(p.radius,scope,0.07)}|${p.drawLines!==false}|${p.sequenced?1:0}|${p.colorMode||"off"}|${p.colorExpr||""}|${p.colorLo||""}|${p.colorHi||""}|${p.colorMin||""}|${p.colorMax||""}|${scopeSig(node,scope)}`;
    case "quiver3d": return `q3|${c}|${p.exprX}|${p.exprY}|${p.exprZ}|${resolveNum(p.gridN,scope,5)}|${p.xMin}|${p.xMax}|${p.yMin}|${p.yMax}|${p.zMin}|${p.zMax}|${p.normalize!==false}`;
    case "glyphField": return `gl|${c}|${p.pairs}|${resolveNum(p.arrowLen,scope,0.5)}|${p.lenMode||(p.normalize===false?"scaled":"uniform")}|${p.anim||"crest"}|${resolveNum(p.speed,scope,1)}|${p.crestColor||""}|${scopeSig(node,scope)}`;
    case "flow": return `fl|${c}|${resolveNum(p.steps,scope,500)}|${resolveNum(p.stepSize,scope,0.02)}|${p.output||"surface"}|${resolveNum(p.volSlices,scope,6)}|${p.gradient?1:0}|${p.gradA||""}|${p.gradB||""}|${p.__fnSig||""}|${p.__paramSig||""}|${scopeSig(node,scope)}`;
    default: return null;
  }
}
// Build a signature fragment from the scalar values this node actually depends
// on, so geometry rebuilds when a slider/animator it uses changes — but not when
// an unrelated scalar changes. We scan the node's raw expression text for each
// scope variable name (word-boundary match). This deliberately does NOT treat
// t/n/u/v/s/r as "builtin": in a glyph field driven by an animator named `t`,
// `t` is a real dependency, even though in a curve it's a bound parameter. If
// such a name is both a bound loop variable AND a scope scalar, including it is
// harmless (the value is constant within a frame) and guarantees correctness.
function scopeSig(node, scope){
  if(!scope) return "";
  const text=nodeExprText(node);
  if(!text) return "";
  const parts=[];
  for(const k in scope){
    const v=scope[k];
    if(typeof v!=="number") continue;            // skip functions
    // word-boundary match so "a" doesn't match inside "abs"
    if(new RegExp("(^|[^A-Za-z0-9_])"+escapeRe(k)+"([^A-Za-z0-9_]|$)").test(text)){
      parts.push(k+"="+v);
    }
  }
  parts.sort();
  return parts.join(",");
}
function escapeRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
// Concatenated raw expression text of a node (all expression-bearing props).
const _nodeTextCache=new Map();
function nodeExprText(node){
  const p=node.props||{};
  const fields=[p.expr,p.exprX,p.exprY,p.exprZ,p.points,p.pairs,p.x,p.y,p.z,p.x0,p.y0,p.z0,p.seedX,p.seedY,p.seedZ,p.tMin,p.tMax,p.xMin,p.xMax,p.yMin,p.yMax,p.zMin,p.zMax,p.uMin,p.uMax,p.vMin,p.vMax,p.res,p.gridN,p.steps,p.stepSize,p.radius,p.size,p.seedN,p.seedSpan,p.arrowLen,p.speed,
    p.out0,p.out1,p.out2,p.out3,p.data,p.colorExpr,p.colorMin,p.colorMax,p.aMin,p.aMax,p.bMin,p.bMax,p.cMin,p.cMax,p.dMin,p.dMax,
    p.exprXu,p.exprYu,p.exprZu,p.exprXw,p.exprYw,p.exprZw,p.wMin,p.wMax,p.volColorExpr,p.__fnSig,p.__paramSig];
  return fields.filter(e=>typeof e==="string"&&e.length).join("\u0001");
}
// Extract the set of free variable names appearing in a node's expressions
// (cached on the node by expression content).
const _refCache=new Map();
function referencedVars(node){
  const p=node.props||{};
  const exprs=[p.expr,p.exprX,p.exprY,p.exprZ,p.points,p.x,p.y,p.z,p.x0,p.y0,p.z0,p.seedX,p.seedY,p.seedZ].filter(e=>typeof e==="string"&&e.length);
  // glyphField pairs: split the multiline "pos | vec" text into atomic exprs
  if(typeof p.pairs==="string"&&p.pairs.length){
    for(const line of p.pairs.split("\n")){
      for(const half of line.split("|")) for(const cell of half.split(",")){
        const c=cell.trim(); if(c&&!/^\d+$/.test(c)) exprs.push(c);
      }
    }
  }
  const key=exprs.join("\u0001");
  if(_refCache.has(key)) return _refCache.get(key);
  const found=new Set();
  const builtin=new Set(["x","y","z","u","v","s","r","t","n","i","j","k","pi","e","tau","phi","sin","cos","tan","exp","log","sqrt","abs","atan","atan2","pow","min","max","floor","ceil","sign","fract","mod","asin","acos","sinh","cosh","tanh","round"]);
  for(const e of exprs){
    let tree; try{ tree=math.parse(e); }catch{ continue; }
    tree.traverse(nd=>{ if(nd.type==="SymbolNode"&&!builtin.has(nd.name)) found.add(nd.name); });
  }
  const arr=[...found];
  if(_refCache.size>500) _refCache.clear();
  _refCache.set(key,arr);
  return arr;
}
// Update live uniforms on a GPU object set from the current scope.
function updateGpuUniforms(objs, scope){
  for(const o of objs){
    const info=o._gpuSurface; if(!info) continue;
    const mat=o.material; if(!mat||!mat.uniforms) continue;
    for(const u of info.uNames){ if(mat.uniforms[u]) mat.uniforms[u].value = Number(scope[u])||0; }
  }
}

export {
  collectScalarDeps, resolveScope, buildScopeForCamera, resolveDomain, plotDomain, buildGlobalScope, referencedVars, geomSignature, scopeSig, nodeExprText, escapeRe
};
