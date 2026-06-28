import { catOf } from "./taxonomy.js";
import { resolveNum, safeEval, evalArray, makeFn, splitTopLevel } from "./math.js";
import * as math from "mathjs";
import { exprToGLSL, fnTableFromScope, fnTableSig, setComplexScopeSyms } from "../geometry/glsl.js";

// Memoized check: will an equation's lhs/rhs transpile to GLSL (→ GPU raymarch
// path)? If so, its sliders/animators become live shader uniforms and must NOT
// invalidate the geometry cache (changing them should push a uniform, not rebuild
// the surface). Cached by the expression text so the per-frame signature stays
// cheap. Returns true when BOTH sides transpile.
const _glslOkCache = new Map();
function eqTranspiles(eqNode, scope){
  if(!eqNode) return false;
  const q=eqNode.props||{};
  const is3d=(q.dims||"2d")==="3d";
  // fnDefs wired into the equation can be INLINED into the GLSL (see exprToGLSL's
  // fnTable arg), so a composed implicit surface rides the GPU too. Whether it
  // transpiles depends on the fnDef bodies, so fold their structure into the key.
  const fnTable=fnTableFromScope(scope);
  const key=`${q.dims}|${q.lhs}|${q.rhs}|${q.varA}|${q.varB}|${q.varC}|${fnTableSig(fnTable)}`;
  const hit=_glslOkCache.get(key);
  if(hit!==undefined) return hit;
  let ok=false;
  try{
    // 3D uses varA/varB/varC; 2D uses varA/varB. Both go through the GPU shader
    // path now (3D raymarch, 2D fragment-shaded contour), so both keep their
    // scalar coefficients as live uniforms rather than baking them into the
    // cache signature.
    const axis = is3d
      ? new Set([(q.varA||"x").trim()||"x",(q.varB||"y").trim()||"y",(q.varC||"z").trim()||"z"])
      : new Set([(q.varA||"x").trim()||"x",(q.varB||"y").trim()||"y"]);
    const f=`(${q.lhs ?? "0"}) - (${q.rhs ?? "0"})`;
    ok = exprToGLSL(f, axis, new Set(), "", fnTable) != null;
  }catch{ ok=false; }
  _glslOkCache.set(key, ok);
  return ok;
}

// Memoized check: will a surf3d / paramsurf transpile to GLSL (→ GPU surface
// path)? When it does, its DOMAIN BOUNDS are shader uniforms (animating a bound
// is a uniform write, no rebuild), so the bound VALUES must stay OUT of the cache
// signature. When it doesn't (CPU mesh fallback), the bounds are baked into the
// geometry and their values MUST be in the signature so an animated bound rebuilds.
const _surfGlslCache = new Map();
function surfTranspiles(node, scope){
  const p=node.props||{};
  let key, exprs, axis;
  // fnDefs wired into the surface inline into the GLSL, so a surface composed from
  // helper functions can ride the GPU. The fnDef bodies affect transpilability, so
  // they're part of the memo key.
  const fnTable=fnTableFromScope(scope);
  const fnSig=fnTableSig(fnTable);
  if(node.type==="surf3d"){ key=`s|${p.expr}|${fnSig}`; exprs=[p.expr]; axis=new Set(["x","y"]); }
  else if(node.type==="paramsurf"){ key=`p|${p.exprX}|${p.exprY}|${p.exprZ}|${fnSig}`; exprs=[p.exprX,p.exprY,p.exprZ]; axis=new Set(["u","v"]); }
  else return false;
  const hit=_surfGlslCache.get(key);
  if(hit!==undefined) return hit;
  let ok=true;
  try{ for(const e of exprs){ if(exprToGLSL(e ?? "0", axis, new Set(), "", fnTable)==null){ ok=false; break; } } }
  catch{ ok=false; }
  _surfGlslCache.set(key, ok);
  return ok;
}

// Memoized check: will a GRAPH transformer render on the GPU (buildTransformerGraphGPU)?
// It does when its wired fnMap output expressions AND its material colour expressions
// all transpile to GLSL. On that path the wired sliders/animators are live shader
// uniforms (position in the vertex shader, colour in the fragment shader), so their
// VALUES must stay out of the cache signature — only the baked domain bounds / colour
// ranges do. Dragging a colour slider then refreshes a uniform instead of forcing a
// full CPU re-transpile + rebuild every frame.
const _graphGlslCache = new Map();
function graphTranspiles(p, fnMapNode, scope){
  if((p.mode||"graph")!=="graph") return false;
  const fnTable=fnTableFromScope(scope), fnSig=fnTableSig(fnTable);
  const outs=[]; if(fnMapNode){ const od=Math.max(1,+(fnMapNode.props?.outDim||1)); for(let k=0;k<od;k++) outs.push(fnMapNode.props?.["out"+k] ?? ""); }
  const mats=[p.matColor,p.matR,p.matG,p.matB,p.matSpec,p.matEmit].filter(e=>e!=null&&e!=="");
  // re()/im() of a complex scope value transpile to re_/im_ uniforms, so the
  // SET of complex symbols affects transpilability — fold it into the cache key
  // and publish it to the transpiler before testing.
  setComplexScopeSyms(scope);
  const cplxSyms=[]; for(const k in scope){ const v=scope[k]; if(v&&typeof v==="object"&&typeof v.re==="number"&&typeof v.im==="number") cplxSyms.push(k); }
  const key=`${p.inAxis0}|${p.inAxis1}|${p.inAxis2}|${outs.join("~")}|${mats.join("~")}|${fnSig}|c:${cplxSyms.sort().join(",")}`;
  const hit=_graphGlslCache.get(key); if(hit!==undefined) return hit;
  let ok=true;
  try{
    const ain=new Set([(p.inAxis0||"x"),(p.inAxis1||"y"),(p.inAxis2||"z"),"x","y","z","u","v"].map(s=>String(s||"").trim()).filter(Boolean));
    for(const e of outs){ if(e!=null&&e!==""&&exprToGLSL(e,ain,new Set(),"",fnTable)==null){ ok=false; break; } }
    if(ok){ const amat=new Set(["x","y","z"]); for(const e of mats){ if(exprToGLSL(e,amat,new Set(),"",fnTable)==null){ ok=false; break; } } }
  }catch{ ok=false; }
  _graphGlslCache.set(key, ok);
  return ok;
}

// ── Scope resolution ─────────────────────────────────────────────────────────
// `node.attachments` lists the node's UPSTREAM dependencies. A node may only
// evaluate the scalars/functions/exprs that are DIRECTLY attached to it — not
// ones reachable only transitively through another node. So a plot attached to
// function f sees `f`, but NOT the slider `a` that f is attached to; `a` is
// visible only inside f's own body (because a is directly attached to f).
//
// To make that work, every function/expr is a closure over ITS OWN direct
// scope, built recursively. The consumer just receives the named closure and
// the scalars on its own attachment list.
//
// `collectScalarDeps` still walks transitively — it is used elsewhere for
// dirty-tracking ("is this node downstream of a playing animator?"), which is a
// different question from "what may this node's expressions reference".
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
    } else if(cat==="map" || cat==="plot" || cat==="domain" || cat==="light" || cat==="texture"){
      // A transformer consumes an fnMap (map) and possibly a paramSpace (plot)
      // domain; a camera consumes lights; a surface consumes textures. Those may
      // carry their own scalar/function deps (e.g. an animator wired into a light
      // to orbit it). Recurse so the consumer's transitive scalar set — used by
      // the per-frame dirty tracker — includes everything downstream.
      collectScalarDeps(depId, nodes, acc, guard);
    }
  }
}

// Build the value of a single named scalar/function node, resolved against its
// OWN direct-attachment scope. `building` guards against attachment cycles.
// `memo` (optional) is a per-traversal cache keyed by node id: a node always
// resolves against its own direct scope regardless of which consumer asked, and
// values are frame-stable within one resolveScope, so a node reached via many
// paths (e.g. a shared derivative in a Frenet chain) is resolved ONCE instead of
// refanning over the dependency DAG. Returns undefined for non-value node types.
function resolveNodeValue(node, nodes, animVals, building, memo){
  if(!node) return undefined;
  // Reuse an already-resolved value for this node in the current traversal. Not
  // applied while the node is mid-resolution (cycle path) — the guard handles that.
  if(memo && memo.has(node.id)) return memo.get(node.id);
  let out;
  switch(node.type){
    case "slider": {
      // Complex mode binds a Complex(re, im) so consuming expressions get a real
      // complex number; the 2-D control edits re/im (or modulus/arg → re/im). Real
      // mode binds the scalar `value` as before.
      if(node.props?.mode==="complex"){
        const re=Number(node.props.re)||0, im=Number(node.props.im)||0;
        out=math.complex(re, im); break;
      }
      out=typeof node.value==="number"?node.value:0; break;
    }
    case "animator": out=animVals?.[node.id] ?? (typeof node.value==="number"?node.value:0); break;
    case "constant": out=resolveNum(node.props?.value, ownScope(node.id,nodes,animVals,building,memo), 0, node.props?.field||"real"); break;
    case "expr":     out=resolveNum(node.props?.expr,  ownScope(node.id,nodes,animVals,building,memo), 0, node.props?.field||"real"); break;
    // A list binds its name to an ARRAY value (numbers, or rows like [x,y,z] for a
    // vector/point list). It's the one scope value that isn't a number; downstream
    // expressions index it (L[k]) or fold it (sum(L)). Empty/invalid → [].
    case "list": {
      // A list binds its name to an ARRAY value. Evaluating a big array literal
      // through mathjs is O(n) and would re-run every animated frame (via
      // buildScopeForCamera) even when the list is unchanged — so cache the result
      // on the node, keyed by the expr (reference-stable while unedited) and a
      // small fingerprint of its own-scope scalars. Invalidates when either changes.
      const expr=node.props?.expr;
      if(expr==null){ out=[]; break; }
      const field=node.props?.field||"real";
      const sc=ownScope(node.id,nodes,animVals,building,memo);
      let sk=field+"|"; for(const key in sc){ const val=sc[key]; if(typeof val==="number") sk+=key+":"+val+";"; }
      if(node._lcExpr===expr && node._lcKey===sk){ out=node._lcVal; break; }
      const v=evalArray(expr, sc, field) || [];
      node._lcExpr=expr; node._lcKey=sk; node._lcVal=v;
      out=v; break;
    }
    case "fnDef": {
      if(!node.name || !node.props?.expr) return undefined;
      const params=(node.props.params||"x").split(",").map(s=>s.trim()).filter(Boolean);
      // The function closes over its OWN direct scope (computed lazily at call
      // time via makeFn's captured scope object). We pass a snapshot built now;
      // makeFn keeps a reference, and the values are frame-stable within a build.
      const fnScope=ownScope(node.id,nodes,animVals,building,memo);
      out=makeFn(node.name, params, node.props.expr, fnScope, node.props.outField||"real"); break;
    }
    default: return undefined;
  }
  if(memo) memo.set(node.id, out);
  return out;
}

// Build a {name: value|fn} scope from a node's DIRECT attachments only. This is
// the scope a node's own expressions are evaluated against. Functions/exprs in
// the result are themselves resolved against their own direct scopes.
function ownScope(consumerId, nodes, animVals, building, memo){
  const consumer=nodes[consumerId]; if(!consumer) return {};
  // Cycle guard: if we're already resolving this node further up the stack,
  // stop — a node cannot directly depend on itself through a finite chain.
  if(building && building.has(consumerId)) return {};
  const guard = building ? building : new Set();
  guard.add(consumerId);
  const sc={};
  const direct=(consumer.attachments||[]).map(id=>nodes[id]).filter(Boolean);
  // Resolve each directly-attached named node to a value/closure. Order matters
  // only for same-scope expr→expr references; resolveNodeValue recurses into
  // each dep's own scope independently, so a flat pass over direct deps is
  // sufficient here (exprs attached to the SAME consumer that reference each
  // other are handled by the expr ordering pass below).
  // sliders / animators / constants / functions first.
  for(const dep of direct){
    if(!dep.name) continue;
    if(dep.type==="expr") continue; // handled below in dependency order
    const v=resolveNodeValue(dep,nodes,animVals,guard,memo);
    if(v!==undefined) sc[dep.name]=v;
  }
  // expr nodes attached directly to this consumer, evaluated in dependency
  // order so a directly-attached expr that references another directly-attached
  // expr resolves correctly. Each still resolves against its OWN direct scope.
  const exprNodes=direct.filter(n=>n.name && n.type==="expr");
  const exprById=new Map(exprNodes.map(n=>[n.id,n]));
  const done=new Set();
  function evalExpr(n){
    if(done.has(n.id)) return;
    done.add(n.id);
    for(const depId of (n.attachments||[])){
      const dep=exprById.get(depId);
      if(dep) evalExpr(dep);
    }
    const v=resolveNodeValue(n,nodes,animVals,guard,memo);
    if(v!==undefined) sc[n.name]=v;
  }
  for(const n of exprNodes) evalExpr(n);
  guard.delete(consumerId);
  return sc;
}

// Build a {name: value|fn} scope for a consumer node from its DIRECT deps only.
function resolveScope(consumerId, nodes, animVals){
  // A fresh per-traversal memo lets a node shared by many consumers (e.g. the
  // derivative fnDefs feeding T, N, B in a Frenet frame) resolve once instead of
  // refanning over the DAG every frame.
  return ownScope(consumerId, nodes, animVals, new Set(), new Map());
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

// NOTE: a previous `buildGlobalScope` helper that exposed every named scalar to
// every node regardless of wiring has been removed. Evaluation scope is now
// strictly per-node (see resolveScope/ownScope): a node may reference only the
// scalars/functions/exprs directly attached to it. Reintroducing an ambient
// global scope would silently break that guarantee.

// ── 3D scene rebuilder ───────────────────────────────────────────────────────
// Signature of the geometry-affecting props for a node. If only scalar
// (uniform) values changed between frames, the signature is unchanged and we
// can skip rebuilding GPU surfaces — just push new uniform values. This is what
// makes animated sliders on a GPU surface essentially free.
function geomSignature(node, scope){
  const p=node.props;
  const c=node.color||"";
  switch(node.type){
    case "surf3d": return `s|${c}|${p.expr}|${resolveNum(p.res,scope,40)}|${p.showWire!==false?1:0}|${p.shading||""}|${p.matColor||""}|${p.matColorLo||""}|${p.matColorHi||""}|${p.matColorMin||""}|${p.matColorMax||""}|${p.matSpec||""}|${p.matEmit||""}|${p.matEmitColor||""}|${
      surfTranspiles(node,scope) ? "" : `${resolveNum(p.xMin,scope,-4)}|${resolveNum(p.xMax,scope,4)}|${resolveNum(p.yMin,scope,-4)}|${resolveNum(p.yMax,scope,4)}|`
    }${scopeSigFns(node,scope)}`;
    case "fn1d": return `f|${c}|${p.expr}|${p.xMin}|${p.xMax}|${resolveNum(p.res,scope,300)}|${scopeSig(node,scope)}`;
    case "paramsurf": return `p|${c}|${p.exprX}|${p.exprY}|${p.exprZ}|${resolveNum(p.uRes,scope,40)}|${resolveNum(p.vRes,scope,30)}|${p.showWire!==false?1:0}|${p.wireOnly?1:0}|${p.shading||""}|${
      surfTranspiles(node,scope) ? "" : `${resolveNum(p.uMin,scope,0)}|${resolveNum(p.uMax,scope,6.283)}|${resolveNum(p.vMin,scope,0)}|${resolveNum(p.vMax,scope,3.1416)}|`
    }${scopeSigFns(node,scope)}`;
    case "paramvol": return `pv|${c}|${p.exprX}|${p.exprY}|${p.exprZ}|${p.uMin}|${p.uMax}|${p.vMin}|${p.vMax}|${p.wMin}|${p.wMax}|${resolveNum(p.uRes,scope,14)}|${resolveNum(p.vRes,scope,14)}|${resolveNum(p.wRes,scope,14)}|${p.colorMode||"off"}|${p.colorExpr||""}|${p.colorLo||""}|${p.colorHi||""}|${p.colorMin||""}|${p.colorMax||""}|${scopeSig(node,scope)}`;
    case "curve3d": return `c|${c}|${p.exprX}|${p.exprY}|${p.exprZ}|${resolveNum(p.tMin,scope,0)}|${resolveNum(p.tMax,scope,6.283)}|${resolveNum(p.res,scope,300)}|${p.colorMode||""}|${p.colorR||""}|${p.colorG||""}|${p.colorB||""}|${scopeSig(node,scope)}`;
    case "plane": return `pl|${c}|${resolveNum(p.centerX,scope,0)}|${resolveNum(p.centerY,scope,0)}|${resolveNum(p.centerZ,scope,0)}|${resolveNum(p.normalX,scope,0)}|${resolveNum(p.normalY,scope,1)}|${resolveNum(p.normalZ,scope,0)}|${resolveNum(p.size,scope,8)}`;
    case "point": return `pt|${c}|${resolveNum(p.x,scope,0)}|${resolveNum(p.y,scope,0)}|${resolveNum(p.z,scope,0)}|${resolveNum(p.radius,scope,0.08)}`;
    case "rawGeom": {
      // Resolve the active primitive's data against scope so a wired slider in any
      // coordinate (list or index template) triggers a rebuild.
      const isIdx=(p.src||"list")==="index";
      const f = isIdx
        ? (p.prim==="points"?p.idxPoints : p.prim==="segments"?p.idxSegments : p.prim==="glyphs"?p.idxGlyphs : p.idxTris)
        : (p.prim==="points"?p.rawPoints : p.prim==="segments"?p.rawSegments : p.prim==="glyphs"?p.rawGlyphs : p.rawTris);
      let resolved="";
      try{
        if(isIdx){
          // Resolve the COUNT against scope so a wired slider on the count (e.g.
          // idxCount="N") changes the signature when dragged. Hashing the raw
          // text alone would miss it. Also hash resolved lattice dims.
          const cnt=String(p.idxCount||"").split(/[,;]/).map(t=>resolveNum(t.trim(),scope,NaN)).join("x");
          resolved = String(f||"")+"|cnt:"+cnt;
        }
        else resolved = String(f||"").split(/\n+/).map(line=>line.split("|").map(part=>splitTopLevel(part).map(t=>resolveNum(t,scope,NaN)).join(",")).join("|")).join(";");
      }catch(e){ resolved=String(f||""); }
      const colSig = p.colorOn?`|col:${p.colorMode||"ramp"}:${p.colorExpr||""}|${p.colorR||""}|${p.colorG||""}|${p.colorB||""}|${p.colorLo||""}|${p.colorHi||""}|${p.colorMin||""}|${p.colorMax||""}`:"";
      const aSig = p.alphaOn?`|a:${p.colorA||""}`:"";
      // For index mode, scope-dependent expressions need scopeSig so wired
      // scalars/fnDefs in the templates trigger rebuilds.
      return `raw|${c}|${p.prim}|${p.src||"list"}|${resolved}${colSig}${aSig}|${resolveNum(p.radius,scope,0.08)}|${p.drawLines?1:0}|${resolveNum(p.arrowLen,scope,0.5)}|${p.normalize?1:0}|${p.lenMode||""}|${p.showWire!==false?1:0}|${isIdx?scopeSig(node,scope):""}`;
    }
    case "mesh": return `msh|${c}|${p.__dataSig||(p.data?p.data.length:0)}|${resolveNum(p.scale,scope,1)}|${p.lit!==false?1:0}|${resolveNum(p.opacity,scope,1)}|${resolveNum(p.shininess,scope,36)}|${p.flatShading?1:0}|${p.doubleSide===false?0:1}|${p.showWire?1:0}|${scopeSig(node,scope)}`;
    case "__scalarVol": return `sv|${c}|${p.expr}|${p.xMin}|${p.xMax}|${p.yMin}|${p.yMax}|${p.zMin}|${p.zMax}|${resolveNum(p.res,scope,18)}|${p.colorByValue?1:0}|${p.colorLo}|${p.colorHi}|${scopeSig(node,scope)}`;
    case "transformer": return `tr|${c}|${p.mode}|${p.domainSrc}|${p.camRes||""}|${p.inAxis0}|${p.inAxis1}|${p.inAxis2}|${p.outAxis0}|${p.outAxis1}|${p.outAxis2}|${p.outAxis3}|${p.normalize?1:0}|${resolveNum(p.arrowLen,scope,0.5)}|${p.aMin}|${p.aMax}|${p.bMin}|${p.bMax}|${p.cMin}|${p.cMax}|${p.dMin}|${p.dMax}|${resolveNum(p.res,scope,60)}|${p.cplxMode||""}|${p.colorSource||""}|${p.colorStyle||""}|${p.colorExpr||""}|${p.colorR||""}|${p.colorG||""}|${p.colorB||""}|${p.colorH||""}|${p.colorS||""}|${p.colorL||""}|${p.colorMode||""}|${p.colorShift||""}|${p.colorLo||""}|${p.colorHi||""}|${p.colorMin||""}|${p.colorMax||""}|${p.showWire!==false?1:0}|${p.wireOnly?1:0}|sh:${p.shading||""}|ul:${p.matUnlit?1:0}|${p.matColorMode||""}|${p.matColor||""}|${p.matR||""}|${p.matG||""}|${p.matB||""}|${p.matColorLo||""}|${p.matColorHi||""}|${p.matColorMin||""}|${p.matColorMax||""}|${p.matSpec||""}|${p.matEmit||""}|${p.matEmitColor||""}|uv:${p.uvScaleU||""},${p.uvScaleV||""},${p.uvOffU||""},${p.uvOffV||""},${p.uvRot||""}|ns:${p.matNormalStrength||""}|${p.__texSig||""}|${p.__fnSig||""}|fn:${p.__fnDefSig||""}|${p.__paramSig||""}|${p.__eqSig||""}|${
      // For a transpilable implicit equation (GPU raymarch), the wired sliders/
      // animators become live shader uniforms — they must NOT invalidate the
      // geometry cache, or every animated frame triggers a full CPU rebuild
      // (the Firefox-desktop stutter: GPU idle, main thread rebuilding). Use the
      // function-only signature so only structural/expression changes rebuild;
      // value changes flow through updateGpuUniforms. The mesh-fallback path
      // (non-transpilable) keeps the full scopeSig so it rebuilds on value change.
      // A GPU graph transformer (p.__graphGPU) is the same story: position and colour
      // scalars are live uniforms, so only the baked domain bounds / colour ranges
      // fold into the signature; the rest ride uniforms (no per-drag re-transpile).
      p.__eqRaymarch ? scopeSigFns(node,scope)
        : p.__graphGPU
          ? scopeSigFns(node,scope)+"|gb:"+[p.aMin,p.aMax,p.bMin,p.bMax,p.cMin,p.cMax,p.dMin,p.dMax,p.colorMin,p.colorMax,p.matColorMin,p.matColorMax].map(e=>resolveNum(e,scope,NaN)).join(",")
          : scopeSig(node,scope)
    }`;
    case "pointSeq": return `ps|${c}|${p.points}|${p.ptsList||""}|${p.edgeList||""}|${resolveNum(p.radius,scope,0.07)}|${p.drawLines!==false}|${p.sequenced?1:0}|${p.colorMode||"off"}|${p.colorExpr||""}|${p.colorLo||""}|${p.colorHi||""}|${p.colorMin||""}|${p.colorMax||""}|${p.__useColor?1:0}|${p.__colExpr||""}|${p.__colRecInit||""}|${p.__colRecStep||""}|${scopeSig(node,scope)}`;
    case "quiver2d": return `q2|${c}|${p.exprX}|${p.exprY}|${resolveNum(p.gridN,scope,12)}|${resolveNum(p.xMin,scope,-4)}|${resolveNum(p.xMax,scope,4)}|${resolveNum(p.yMin,scope,-4)}|${resolveNum(p.yMax,scope,4)}|${p.normalize!==false}|${scopeSigFns(node,scope)}`;
    case "quiver3d": return `q3|${c}|${p.exprX}|${p.exprY}|${p.exprZ}|${resolveNum(p.gridN,scope,5)}|${resolveNum(p.xMin,scope,-3)}|${resolveNum(p.xMax,scope,3)}|${resolveNum(p.yMin,scope,-3)}|${resolveNum(p.yMax,scope,3)}|${resolveNum(p.zMin,scope,-3)}|${resolveNum(p.zMax,scope,3)}|${p.normalize!==false}|${scopeSigFns(node,scope)}`;
    case "glyphField": return `gl|${c}|${p.pairs}|${resolveNum(p.arrowLen,scope,0.5)}|${p.lenMode||(p.normalize===false?"scaled":"uniform")}|${p.anim||"crest"}|${resolveNum(p.speed,scope,1)}|${p.crestColor||""}|${p.__useColor?1:0}|${p.__colExpr||""}|${p.__colRecInit||""}|${p.__colRecStep||""}|${p.colorLo||""}|${p.colorHi||""}|${p.colorMin||""}|${p.colorMax||""}|${scopeSig(node,scope)}`;
    case "flow": return `fl|${c}|${resolveNum(p.steps,scope,500)}|${resolveNum(p.stepSize,scope,0.02)}|${p.output||"surface"}|${resolveNum(p.volSlices,scope,6)}|${p.gradient?1:0}|${p.gradA||""}|${p.gradB||""}|${p.showWire?1:0}|${p.__fnSig||""}|fn:${p.__fnDefSig||""}|${p.__paramSig||""}|${scopeSig(node,scope)}`;
    default: return null;
  }
}

// Full geometry signature for a plot, folding in the expressions/scopes of any
// wired structural nodes (fnMap / equation / paramSpace / points) for
// transformers and flows. Shared by the 3-D rebuild cache (rebuild.js) and the
// 2-D scene cache (render2d-gpu.js) so both invalidate on exactly the same
// changes. Returns a string, or null for types with no signature.
function plotSignature(node, p, scope, nodes, animVals){
  let pSig=p, sigScope=scope;
  if(node.type==="transformer"||node.type==="flow"){
    let fnSig="",paramSig="",eqSig="",texSig="";
    let eqRaymarch=false;   // equation wired AND transpilable → GPU uniform path
    const structScopes=[];
    const animV=animVals||{};
    const eqDeps=[];
    let fnMapNode=null, hasParam=false, hasPoints=false;
    for(const depId of (node.attachments||[])){
      const dep=nodes[depId]; if(!dep) continue;
      if(dep.type==="texture"||dep.type==="video"){ texSig+=`${dep.type}|${dep.props?.role||"color"}|${dep.props?.src||""}|${dep.props?.filter||""}|${dep.props?.wrap||""};`; }
      else if(dep.type==="fnMap"){ fnMapNode=dep; fnSig=`${dep.props.inDim}|${dep.props.outDim}|${dep.props.field||"real"}|${dep.props.out0}|${dep.props.out1}|${dep.props.out2}|${dep.props.out3}`; structScopes.push(resolveScope(dep.id,nodes,animV)); }
      else if(dep.type==="equation"){ eqDeps.push(dep); structScopes.push(resolveScope(dep.id,nodes,animV)); }
      else if(dep.type==="paramSpace"){ hasParam=true; const q=dep.props; paramSig=`${q.degree}|${q.exprX}|${q.exprY}|${q.exprZ}|${q.exprXu}|${q.exprYu}|${q.exprZu}|${q.tMin}|${q.tMax}|${q.res}|${q.uMin}|${q.uMax}|${q.vMin}|${q.vMax}|${q.uRes}|${q.vRes}`; structScopes.push(resolveScope(dep.id,nodes,animV)); }
      else if(dep.type==="points"){ hasPoints=true; const q=dep.props; paramSig=`pts|${q.kind}|${q.mode}|${q.listPoints}|${q.idxPoint}|${q.idxCount}|${q.recInit}|${q.recStep}|${q.recCount}|${q.listGlyphs}|${q.idxGlyph}|${q.idxGlyphCount}|${q.recGlyphInit}|${q.recGlyphStep}|${q.recGlyphCount}`; structScopes.push(resolveScope(dep.id,nodes,animV)); }
    }
    if(eqDeps.length){
      // A single transpilable equation rides the GPU raymarch path: its scalars are
      // live uniforms and must NOT enter the signature. TWO equations are an
      // intersection curve (CPU mesh-derived), so values always fold in — an
      // animated slider must rebuild the curve.
      eqRaymarch = eqDeps.length===1 && eqTranspiles(eqDeps[0], resolveScope(eqDeps[0].id,nodes,animV));
      for(const dep of eqDeps){
        const q=dep.props;
        eqSig += `eq|${q.dims||"2d"}|${q.field||"real"}|${q.lhs}|${q.rhs}|${q.varA}|${q.varB}|${q.varC};`;
        if(!eqRaymarch){
          const eqScope=resolveScope(dep.id,nodes,animV);
          const eqNodeForSig={ props:{ expr:`${q.lhs} ${q.rhs}` }, type:"__eqvals" };
          eqSig += "vals:" + scopeSig(eqNodeForSig, eqScope) + ";";
        }
      }
    }
    sigScope={...scope}; for(const s of structScopes) Object.assign(sigScope,s);
    // A LIT graph transformer with per-fragment rgb material colour (the domain-
    // colouring pattern) renders via the GPU graph path when its expressions
    // transpile; then its position/colour scalars are live uniforms. Gated to this
    // pattern so the CPU-sampled 2-D graph transformers (curves) are untouched.
    // A complex (or any non-real) fnMap can't ride the GPU graph path — GLSL has
    // no complex numbers — so it stays on the CPU evaluator. (Complex SCOPE values
    // read via re()/im() ARE fine on the GPU now: they transpile to decomposed
    // re_/im_ float uniforms, so no scope-level guard is needed.)
    const fnFieldReal = !fnMapNode || (fnMapNode.props.field||"real")==="real";
    const graphGPU = node.type==="transformer" && !eqDeps.length && !hasParam && !hasPoints
      && p.shading==="lit" && p.matColorMode==="rgb" && fnFieldReal
      && graphTranspiles(p, fnMapNode, sigScope);
    pSig={...p,__fnSig:fnSig,__paramSig:paramSig,__eqSig:eqSig,__texSig:texSig,__eqRaymarch:eqRaymarch,__graphGPU:graphGPU,__fnDefSig:fnTableSig(fnTableFromScope(sigScope))};
  }
  return geomSignature({...node,props:pSig},sigScope);
}
// Cheap, change-sensitive fingerprint of a (possibly nested) numeric array: the
// element count plus an FNV-1a hash over each number's 64-bit pattern. Used so a
// plot referencing a large list can be cache-compared per frame without a full
// JSON encode. Distinct contents → distinct fingerprint with overwhelming odds.
const _fpBuf=new Float64Array(1), _fpInt=new Uint32Array(_fpBuf.buffer);
function listFingerprint(v){
  let h=0x811c9dc5>>>0, n=0;
  const walk=(a)=>{ for(let i=0;i<a.length;i++){ const e=a[i];
    if(Array.isArray(e)) walk(e);
    else { _fpBuf[0]=(typeof e==="number"?e:Number(e))||0;
      h=Math.imul(h^_fpInt[0],0x01000193)>>>0; h=Math.imul(h^_fpInt[1],0x01000193)>>>0; n++; } } };
  walk(v);
  return n+":"+(h>>>0);
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
  const seenFns=new Set();
  // Walk the names referenced by `text`. For numeric scope vars we record
  // name=value. For function vars we record the function's DEFINITION (so a body
  // edit invalidates the cache) and then recurse into the names the function
  // body references against the scope the function closed over — this pulls in
  // scalars a plot depends on only transitively (e.g. f(x)=a*x, slider `a`).
  function appearsIn(name, hay){
    return new RegExp("(^|[^A-Za-z0-9_])"+escapeRe(name)+"([^A-Za-z0-9_]|$)").test(hay);
  }
  function visit(hay, sc){
    if(!hay) return;
    for(const k in sc){
      const v=sc[k];
      if(!appearsIn(k, hay)) continue;
      if(typeof v==="number"){
        parts.push(k+"="+v);
      } else if(v && typeof v==="object" && typeof v.re==="number" && typeof v.im==="number"){
        // A complex scope value (e.g. a complex-mode slider): fold both parts so
        // dragging the joysquare/joystick invalidates dependent plots.
        parts.push(k+"="+v.re+"+"+v.im+"i");
      } else if(Array.isArray(v)){
        // A list value: fold a cheap, change-sensitive fingerprint (count + an
        // FNV-1a hash over the raw float bits) rather than JSON — so a plot that
        // references a big list (e.g. a 46k-vertex table) can be cache-checked
        // every animated frame without stringifying ~1MB each time.
        parts.push(k+"="+listFingerprint(v));
      } else if(typeof v==="function" && v._fnExpr!=null){
        // Guard against recursive/self-referential function definitions.
        const fnKey=k+":"+(v._fnName||"");
        if(seenFns.has(fnKey)) continue;
        seenFns.add(fnKey);
        // Definition signature: body change ⇒ different signature ⇒ rebuild.
        parts.push(k+"@="+(v._fnParams||[]).join(",")+"=>"+v._fnExpr+":"+(v._fnOutField||"real"));
        // Recurse into the function body using the scope it closed over, so the
        // scalars/functions IT depends on also enter the caller's signature.
        // A parameter shadows any same-named outer scalar inside the body, so
        // strip parameter names from the recursion scope to avoid folding in an
        // unrelated slider that merely shares a name with a bound parameter.
        const fnScope=v._fnScope||sc;
        const paramSet=new Set(v._fnParams||[]);
        const reduced={};
        for(const key in fnScope){ if(!paramSet.has(key)) reduced[key]=fnScope[key]; }
        visit(v._fnExpr, reduced);
      }
    }
  }
  visit(text, scope);
  // De-dupe (a var may be reached via several paths) and sort for stability.
  const uniq=[...new Set(parts)];
  uniq.sort();
  return uniq.join(",");
}
function escapeRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
// Function-only signature fragment. Used by the GPU-fast-path surface types
// (surf3d/paramsurf/quiver3d) whose direct slider variables become live shader
// uniforms and therefore must NOT force a geometry rebuild when they change.
// User-defined functions, however, cannot be expressed as uniforms — referencing
// one forces the CPU/baked path — so their DEFINITIONS and the scalars they
// transitively pull in DO need to invalidate the cache. This returns only the
// function-definition and through-function scalar parts, leaving direct sliders
// to the uniform path.
function scopeSigFns(node, scope){
  if(!scope) return "";
  const text=nodeExprText(node);
  if(!text) return "";
  const parts=[];
  const seenFns=new Set();
  const appearsIn=(name,hay)=>new RegExp("(^|[^A-Za-z0-9_])"+escapeRe(name)+"([^A-Za-z0-9_]|$)").test(hay);
  // top-level: only descend into FUNCTIONS named in the node text; direct numeric
  // vars are intentionally skipped (they're uniforms).
  function descend(hay, sc, topLevel){
    if(!hay) return;
    for(const k in sc){
      const v=sc[k];
      if(!appearsIn(k,hay)) continue;
      if(typeof v==="function" && v._fnExpr!=null){
        const fnKey=k+":"+(v._fnName||"");
        if(seenFns.has(fnKey)) continue;
        seenFns.add(fnKey);
        parts.push(k+"@="+(v._fnParams||[]).join(",")+"=>"+v._fnExpr+":"+(v._fnOutField||"real"));
        const fnScope=v._fnScope||sc;
        const paramSet=new Set(v._fnParams||[]);
        const reduced={};
        for(const key in fnScope){ if(!paramSet.has(key)) reduced[key]=fnScope[key]; }
        // inside a function body, numeric deps DO matter (they're baked, not uniforms)
        descend(v._fnExpr, reduced, false);
      } else if(typeof v==="number" && !topLevel){
        parts.push(k+"="+v);
      }
    }
  }
  descend(text, scope, true);
  const uniq=[...new Set(parts)];
  uniq.sort();
  return uniq.join(",");
}
// Concatenated raw expression text of a node (all expression-bearing props).
function nodeExprText(node){
  const p=node.props||{};
  const fields=[p.expr,p.exprX,p.exprY,p.exprZ,p.points,p.pairs,p.x,p.y,p.z,p.x0,p.y0,p.z0,p.seedX,p.seedY,p.seedZ,p.tMin,p.tMax,p.xMin,p.xMax,p.yMin,p.yMax,p.zMin,p.zMax,p.uMin,p.uMax,p.vMin,p.vMax,p.res,p.gridN,p.steps,p.stepSize,p.radius,p.size,p.seedN,p.seedSpan,p.arrowLen,p.speed,
    p.out0,p.out1,p.out2,p.out3,p.data,p.colorExpr,p.colorMin,p.colorMax,p.aMin,p.aMax,p.bMin,p.bMax,p.cMin,p.cMax,p.dMin,p.dMax,
    p.exprXu,p.exprYu,p.exprZu,p.exprXw,p.exprYw,p.exprZw,p.wMin,p.wMax,p.volColorExpr,p.__colExpr,p.__colRecInit,p.__colRecStep,p.__fnSig,p.__paramSig,p.__eqSig,
    p.idxPoints,p.idxSegments,p.idxGlyphs,p.idxTris,p.idxCount,p.rawPoints,p.rawSegments,p.rawGlyphs,p.rawTris,p.colorR,p.colorG,p.colorB,p.colorA,
    // Index/recursive authoring props are SINGULAR (idxPoint, idxGlyph, recInit…)
    // — without these, scopeSig can't see an animator/slider referenced only in a
    // point-index expression (e.g. a Frenet arrow's `cos(s)+i*TX(s)`), so the
    // plot's signature wouldn't change as `s` animates and it would wrongly cache.
    p.idxPoint,p.idxGlyph,p.recInit,p.recStep,p.recCount,p.recGlyphInit,p.recGlyphStep,p.recGlyphCount,p.listPoints,p.listGlyphs,p.colExpr,
    p.matColor,p.matSpec,p.matEmit,p.matR,p.matG,p.matB,p.colorR,p.colorG,p.colorB,
    p.ptsList,p.edgeList];
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
  collectScalarDeps, resolveScope, buildScopeForCamera, resolveDomain, plotDomain, referencedVars, geomSignature, plotSignature, scopeSig, scopeSigFns, nodeExprText, escapeRe
};
