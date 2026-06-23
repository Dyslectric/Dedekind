import { deflateSync, inflateSync, strToU8, strFromU8 } from "fflate";
import { uid } from "./math.js";
import { catOf, isScalarType } from "./taxonomy.js";
import { DEFAULT_GEOM_COLOR } from "../nodes/colors.js";
import { makeNode, makeProjectNode } from "../nodes/model.js";

// ── Compact base64url ───────────────────────────────────────────────────────
// Plain base64url over the raw UTF-8 bytes — no encodeURIComponent detour.
// The old scheme (btoa(encodeURIComponent(json))) percent-encodes almost every
// punctuation character in JSON before base64 ever runs, which alone costs
// ~1.8x; stacked with base64's own 4/3 expansion that's a ~2.4x tax for no
// reason. Going straight from bytes to base64url removes the percent-encoding
// step entirely (-_  instead of +/, no padding, so it's hash-safe as-is).
const B64URL_CHARS="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function b64urlEncode(bytes){
  let out="";
  for(let i=0;i<bytes.length;i+=3){
    const b0=bytes[i], b1=bytes[i+1], b2=bytes[i+2];
    const has1=b1!==undefined, has2=b2!==undefined;
    const n=(b0<<16)|((has1?b1:0)<<8)|(has2?b2:0);
    out+=B64URL_CHARS[(n>>18)&63];
    out+=B64URL_CHARS[(n>>12)&63];
    out+=has1?B64URL_CHARS[(n>>6)&63]:"";
    out+=has2?B64URL_CHARS[n&63]:"";
  }
  return out;
}
function b64urlDecode(str){
  const rev=new Uint8Array(128);
  for(let i=0;i<B64URL_CHARS.length;i++) rev[B64URL_CHARS.charCodeAt(i)]=i;
  const clean=str.replace(/[^A-Za-z0-9\-_]/g,"");
  const bytes=[];
  for(let i=0;i<clean.length;i+=4){
    const c0=rev[clean.charCodeAt(i)]||0;
    const c1=i+1<clean.length?rev[clean.charCodeAt(i+1)]||0:0;
    const c2=i+2<clean.length?rev[clean.charCodeAt(i+2)]:undefined;
    const c3=i+3<clean.length?rev[clean.charCodeAt(i+3)]:undefined;
    const n=(c0<<18)|(c1<<12)|((c2||0)<<6)|(c3||0);
    bytes.push((n>>16)&255);
    if(c2!==undefined) bytes.push((n>>8)&255);
    if(c3!==undefined) bytes.push(n&255);
  }
  return new Uint8Array(bytes);
}

// ── Default-prop debloating ─────────────────────────────────────────────────
// Most nodes carry a lot of untouched defaults (camera lens/display settings,
// the full project theme palette, unused glyph/recursive fields on a `points`
// node, etc). Stripping any prop whose value exactly matches its type's fresh
// default — and restoring those defaults on load — roughly halves the JSON on
// its own, on top of (and largely independent from) compression. Defaults are
// derived from the real factories (makeNode/makeProjectNode) so this never
// drifts out of sync with the node model.
const _defaultPropsCache=new Map();
function defaultPropsFor(type){
  if(_defaultPropsCache.has(type)) return _defaultPropsCache.get(type);
  let props;
  try{
    props = type==="project" ? makeProjectNode().props : (makeNode(type,{x:0,y:0}).props||{});
  }catch{ props={}; }
  _defaultPropsCache.set(type,props);
  return props;
}
function debloatNodes(nodes){
  const out={};
  for(const[id,n]of Object.entries(nodes)){
    const defaults=defaultPropsFor(n.type);
    const props={};
    for(const[k,v]of Object.entries(n.props||{})){
      // JSON-stringify compare: cheap deep-equal for the plain values (strings/
      // numbers/booleans) every node prop actually holds.
      if(JSON.stringify(defaults[k])!==JSON.stringify(v)) props[k]=v;
    }
    // Media is never serialized into the project URL — an embedded image/video
    // data-URI (or a session blob: URL) is far too much data and wouldn't be
    // valid on reload anyway. Drop it; on load the texture falls back to its
    // default tile. A plain http(s) URL is a small reference and is kept.
    if((n.type==="texture"||n.type==="video") && typeof props.src==="string"
       && (props.src.startsWith("data:")||props.src.startsWith("blob:"))){
      delete props.src;
    }
    // Mesh geometry is likewise too big for a URL — a real import is easily
    // megabytes of vertex data. The durable home for meshes is a .ddk project
    // file (which carries the geometry as an archive asset); the hash drops the
    // payload (keeping only the lightweight props) so sharing a link never
    // produces a giant URL. __dataSig goes too — it only fingerprints `data`.
    if(n.type==="mesh"){
      if(typeof props.data==="string" && props.data) delete props.data;
      if("__dataSig" in props) delete props.__dataSig;
    }
    const copy={...n};
    if(Object.keys(props).length) copy.props=props; else delete copy.props;
    out[id]=copy;
  }
  return out;
}
function inflateNodeDefaults(nodes){
  const out={};
  for(const[id,n]of Object.entries(nodes)){
    const defaults=defaultPropsFor(n.type);
    out[id]={...n,props:{...defaults,...(n.props||{})}};
  }
  return out;
}

// ── Compressed payload envelope ─────────────────────────────────────────────
// New links are written as `~1~<base64url(deflate(JSON))>` — the leading `~`
// is outside the base64url alphabet, so it doubles as a format marker: any
// hash that does NOT start with `~` is the old plain
// btoa(encodeURIComponent(...)) scheme and is decoded that way for backward
// compatibility with links saved before this format existed.
const FORMAT_TAG="~1~";
function encodePayload(value){
  try{
    const json=JSON.stringify(value);
    const compressed=deflateSync(strToU8(json),{level:9});
    return FORMAT_TAG+b64urlEncode(compressed);
  }catch{ return null; }
}
function decodePayload(str){
  if(str.startsWith(FORMAT_TAG)){
    const body=str.slice(FORMAT_TAG.length);
    const json=strFromU8(inflateSync(b64urlDecode(body)));
    return JSON.parse(json);
  }
  // Legacy uncompressed format.
  return JSON.parse(decodeURIComponent(atob(str)));
}

// ── Serialization ────────────────────────────────────────────────────────────
function serializeProject(nodes) {
  // Working-session save (URL hash). Preserve `playing` so reloading restores a
  // running animation. (The *share* serializer strips playing so shared links
  // don't autoplay.) Debloat first (strip default-valued props), then compress
  // + base64url the result — see encodePayload above for the format.
  try { return encodePayload(debloatNodes(nodes)); } catch{return null;}
}
function deserializeProject(str) {
  try {
    const raw=str.startsWith("#")?str.slice(1):str;
    const data=inflateNodeDefaults(decodePayload(raw));
    const out={},o2n={};
    const oi=Object.keys(data),ni=oi.map(()=>uid());
    oi.forEach((o,i)=>{o2n[o]=ni[i];});
    oi.forEach((o,i)=>{const n=data[o];out[ni[i]]={...n,id:ni[i],attachments:(n.attachments||[]).map(a=>o2n[a]||a).filter(Boolean)};});
    return migrateModel(out);
  } catch{return null;}
}
// Convert legacy granular plot nodes (fn1d, surf3d, curve3d, paramsurf, point,
// pointSeq, glyphField) into the unified authoring kinds (scalarFn, paramSpace,
// points). Older projects keep working because the unified nodes carry the same
// expression/data props, and normalizeNode() maps them right back to the legacy
// vocabulary the renderers use. We mutate type+props in place; ids, colors,
// attachments and labels are preserved. quiver2d/quiver3d/flow/plane are left
// as-is (they remain first-class kinds).
// ── Remove the scalarFn kind: expand graph surfaces into fnMap + transformer ──
// scalarFn (and the very old fn1d/surf3d that used to migrate into it) bundled a
// pure map with its renderer, which isn't canonical — a graph z=f(x,y) is an
// fnMap (the map) wired into a transformer (the renderer that holds the plot +
// shading parameters). This expands each such node 1→2: the original id BECOMES
// the transformer (so anything attached to it — a camera — stays wired), and a
// fresh fnMap carries the expression and its scalar/function dependencies. A
// wired domain stays on the transformer. dims 1→curve, 2→surface, 3→value cloud.
function migrateGraphSurfaces(nodes){
  const out={};
  for(const [id,n] of Object.entries(nodes)){
    const t=n.type;
    if(t!=="scalarFn" && t!=="fn1d" && t!=="surf3d"){ out[id]=n; continue; }
    const p=n.props||{};
    let dims;
    if(t==="fn1d") dims=1;
    else if(t==="surf3d") dims=2;
    else { const d=parseInt(p.dims,10); dims=(d===2||d===3)?d:1; }
    const expr = p.expr ?? (dims===1?"sin(x)":"sin(x)*cos(y)");
    const xMin=p.xMin??(dims===1?"-5":"-4"), xMax=p.xMax??(dims===1?"5":"4");
    const yMin=p.yMin??"-4", yMax=p.yMax??"4", zMin=p.zMin??"-3", zMax=p.zMax??"3";
    const res=p.res??(dims===1?"300":"40");
    const mapId=uid();
    const px=(n.pos&&n.pos.x)||300, py=(n.pos&&n.pos.y)||160;
    // Expression deps (scalars/functions) go to the map; a domain is a plot
    // parameter, so it stays on the transformer.
    const mapDeps=[], trDeps=[mapId];
    for(const depId of (n.attachments||[])){
      if(nodes[depId] && nodes[depId].type==="domain") trDeps.push(depId);
      else mapDeps.push(depId);
    }
    out[mapId]={ id:mapId, type:"fnMap", name:"", label:(n.label?n.label+" ":"")+"map",
      color:n.color||"__AUTO__", pos:{x:px-200,y:py}, attachments:mapDeps,
      props:{ inDim:String(dims), outDim:"1", out0:expr, out1:"0", out2:"0", out3:"0" } };
    const trProps={ mode:"graph",
      inAxis0:"x", inAxis1: dims>=2?"y":"none", inAxis2: dims>=3?"z":"none",
      outAxis0: dims===1?"y" : dims===2?"z" : "color", outAxis1:"none", outAxis2:"none", outAxis3:"none",
      aMin:xMin, aMax:xMax, bMin:yMin, bMax:yMax, cMin:zMin, cMax:zMax, res };
    if(dims===3){ trProps.colorLo=p.colorLo||"#3a6df0"; trProps.colorHi=p.colorHi||"#f0533a"; trProps.colorMin=""; trProps.colorMax=""; }
    out[id]={ ...n, type:"transformer", props:trProps, attachments:trDeps };
  }
  return out;
}

function migrateUnifiedKinds(nodes){
  const out={};
  for(const[id,n]of Object.entries(nodes)){
    out[id]=migrateOneToUnified(n);
  }
  return out;
}
// ── Legacy points `data` → explicit dropdown props ──────────────────────────
// Older `points` nodes (and their pre-unified pointSeq/glyphField/point sources)
// stored a single auto-detected `data` text. The node now uses explicit
// kind/mode/* fields, so map the legacy text into the matching field by
// re-running the same detection the old parser used (recurrence "[n" → recursive,
// "[i,j]"/two bare indices → index grid, single index → index, else list).
function legacyDataToExplicit(data, isGlyph){
  const text=(data??"").trim();
  // base defaults for every field (so the node is fully formed post-migration)
  const base = isGlyph
    ? { listGlyphs:"0, 0 | 1, 0", idxGlyph:"cos(i), sin(i) | -sin(i), cos(i)", idxGlyphCount:"48",
        recGlyphInit:"4, 4 | 0, 1", recGlyphStep:"x[n-1], y[n-1] | vx[n-1], vy[n-1]", recGlyphCount:"120" }
    : { listPoints:"0, 0\n1, 1\n2, 0", idxPoint:"cos(i*0.3), sin(i*0.3)", idxCount:"64",
        recInit:"1, 0", recStep:"x[n-1]*0.99, y[n-1]+0.1", recCount:"80" };
  let mode="list";
  // Recurrence first (back-compat priority), then index forms, else list.
  const isRec = /\[\s*n/.test(text);
  const isMatrix = /\[\s*[ijk][^\]]*[,;][^\]]*\]/.test(text) ||
    ((/(^|[^A-Za-z0-9_])i([^A-Za-z0-9_]|$)/.test(text)?1:0)
      +(/(^|[^A-Za-z0-9_])j([^A-Za-z0-9_]|$)/.test(text)?1:0)
      +(/(^|[^A-Za-z0-9_])k([^A-Za-z0-9_]|$)/.test(text)?1:0))>=2;
  const isIndex = !isMatrix && (/\[\s*[ijk]/.test(text) ||
    /(^|[^A-Za-z0-9_])i([^A-Za-z0-9_]|$)/.test(text) ||
    /(^|[^A-Za-z0-9_])j([^A-Za-z0-9_]|$)/.test(text) ||
    /(^|[^A-Za-z0-9_])k([^A-Za-z0-9_]|$)/.test(text));
  const lines=text.split("\n").map(s=>s.trim()).filter(Boolean);
  if(isRec){
    mode="recursive";
    if(isGlyph){ base.recGlyphInit=lines[0]||base.recGlyphInit; base.recGlyphStep=lines[1]||base.recGlyphStep; base.recGlyphCount=lines[2]||base.recGlyphCount; }
    else { base.recInit=lines[0]||base.recInit; base.recStep=lines[1]||base.recStep; base.recCount=lines[2]||base.recCount; }
  } else if(isIndex || isMatrix){
    mode="index";
    if(isGlyph){ base.idxGlyph=lines[0]||base.idxGlyph; base.idxGlyphCount=lines[1]||base.idxGlyphCount; }
    else { base.idxPoint=lines[0]||base.idxPoint; base.idxCount=lines[1]||base.idxCount; }
  } else {
    mode="list";
    if(isGlyph) base.listGlyphs=text||base.listGlyphs;
    else base.listPoints=text||base.listPoints;
  }
  return { mode, ...base };
}

function migrateOneToUnified(n){
  const p=n.props||{};
  switch(n.type){
    case "curve3d":
      return {...n,type:"paramSpace",props:{
        degree:"1",exprX:p.exprX??"cos(t)",exprY:p.exprY??"sin(t)",exprZ:p.exprZ??"t/4",
        tMin:p.tMin??"0",tMax:p.tMax??"2*pi",res:p.res??"300",
        exprXu:"cos(u)*sin(v)",exprYu:"sin(u)*sin(v)",exprZu:"cos(v)",
        uMin:"0",uMax:"2*pi",vMin:"0",vMax:"pi",uRes:"40",vRes:"30",
      }};
    case "paramsurf":
      return {...n,type:"paramSpace",props:{
        degree:"2",
        exprX:"cos(t)",exprY:"sin(t)",exprZ:"t/4",tMin:"0",tMax:"2*pi",res:"300",
        exprXu:p.exprX??"cos(u)*sin(v)",exprYu:p.exprY??"sin(u)*sin(v)",exprZu:p.exprZ??"cos(v)",
        uMin:p.uMin??"0",uMax:p.uMax??"2*pi",vMin:p.vMin??"0",vMax:p.vMax??"pi",
        uRes:p.uRes??"40",vRes:p.vRes??"30",
      }};
    case "point": {
      const ex=legacyDataToExplicit(`${p.x??"0"}, ${p.y??"0"}, ${p.z??"0"}`, false);
      return {...n,type:"points",props:{
        kind:"points", useColor:false, ...ex,
        radius:p.radius!=null?String(Math.max(2,Number(p.radius)*50||4)):"4",
        drawLines:false,
        arrowLen:"0.5",normalize:true,lenMode:"uniform",anim:"crest",speed:"1",crestColor:"#ffffff",
        colExpr:"i",colRecInit:"0",colRecStep:"c[n-1]+1",
        colorMode:"off",colorExpr:"i",colorLo:"#3a6aff",colorHi:"#ff5ea8",colorMin:"",colorMax:"",
        sequenced:false,seqFrac:"1",seqVar:"",
      }};
    }
    case "pointSeq": {
      const ex=legacyDataToExplicit(p.points??"0, 0\n1, 1\n2, 0", false);
      return {...n,type:"points",props:{
        kind:"points", useColor:false, ...ex,
        radius:p.radius??"4",drawLines:p.drawLines!==false,
        arrowLen:"0.5",normalize:true,lenMode:"uniform",anim:"crest",speed:"1",crestColor:"#ffffff",
        colExpr:p.colorExpr??"i",colRecInit:"0",colRecStep:"c[n-1]+1",
        colorMode:p.colorMode??"off",colorExpr:p.colorExpr??"i",colorLo:p.colorLo??"#3a6aff",colorHi:p.colorHi??"#ff5ea8",colorMin:p.colorMin??"",colorMax:p.colorMax??"",
        sequenced:!!p.sequenced,seqFrac:p.seqFrac??"1",seqVar:p.seqVar??"",
      }};
    }
    case "glyphField": {
      const ex=legacyDataToExplicit(p.pairs??"0,0,0 | 1,0,0", true);
      return {...n,type:"points",props:{
        kind:"glyphs", useColor:false, ...ex,
        radius:"4",drawLines:true,
        arrowLen:p.arrowLen??"0.5",normalize:p.normalize!==false,
        lenMode:p.lenMode||(p.normalize===false?"scaled":"uniform"),
        anim:p.anim??"crest",speed:p.speed??"1",crestColor:p.crestColor??"#ffffff",
        colExpr:"i",colRecInit:"0",colRecStep:"c[n-1]+1",
        colorMode:"off",colorExpr:"i",colorLo:"#3a6aff",colorHi:"#ff5ea8",colorMin:"",colorMax:"",
        sequenced:false,seqFrac:"1",seqVar:"",
      }};
    }
    case "camera":
      // Split the legacy single camera into an explicit 3D or 2D kind by its
      // stored mode. All other props carry over unchanged.
      return {...n,type:(p.mode==="2d"?"camera2d":"camera3d")};
    default:
      return n;
  }
}

// attachments; cameras stored plot IDs) into the new dependency model where a
// consumer stores its upstream deps. Detected by: a scalar/function node whose
// attachments point at cameras. We move those scalars onto every plot under
// each referenced camera (and onto the camera itself, for camera-prop deps).
function migrateModel(nodes){
  // Step 0: expand graph surfaces (scalarFn / fn1d / surf3d) into fnMap +
  // transformer — the scalarFn kind is retired in favour of map + renderer.
  nodes = migrateGraphSurfaces(nodes);
  // Step 1: legacy granular plot kinds → unified authoring kinds (always).
  nodes = migrateUnifiedKinds(nodes);

  // Step 2: legacy camera-attachment model → dependency model (only if needed).
  const isCam=id=>nodes[id]?.type==="camera";
  let legacy=false;
  for(const n of Object.values(nodes)){
    if((catOf(n.type)==="scalar"||catOf(n.type)==="function") && (n.attachments||[]).some(isCam)){ legacy=true; break; }
  }
  if(!legacy) return nodes;
  const out={}; for(const[id,n]of Object.entries(nodes)) out[id]={...n,attachments:[...(n.attachments||[])]};
  for(const n of Object.values(out)){
    if(catOf(n.type)!=="scalar"&&catOf(n.type)!=="function") continue;
    const cams=(n.attachments||[]).filter(isCam);
    if(!cams.length) continue;
    n.attachments=(n.attachments||[]).filter(a=>!isCam(a)); // strip old cam links
    for(const camId of cams){
      const cam=out[camId]; if(!cam) continue;
      // attach this scalar/function to each plot the camera shows
      for(const plotId of (cam.attachments||[])){
        if(catOf(out[plotId]?.type)==="plot" && !out[plotId].attachments.includes(n.id))
          out[plotId].attachments.push(n.id);
      }
      // and to the camera itself (covers camera-prop dependencies)
      if(!cam.attachments.includes(n.id)) cam.attachments.push(n.id);
    }
  }
  return out;
}
// Decode a camera-share hash (the {share, camId, nodes} envelope produced by
// serializeCameraShare above) — same compressed/legacy format handling, with
// node defaults re-inflated. Returns null on any failure so callers can fall
// back cleanly (e.g. treat the hash as "not a share").
function deserializeCameraShare(str){
  try{
    const raw=str.startsWith("#")?str.slice(1):str;
    const parsed=decodePayload(raw);
    if(!parsed||!parsed.share) return null;
    return {...parsed, nodes:inflateNodeDefaults(parsed.nodes||{})};
  }catch{ return null; }
}
// Quick, cheap check for whether a hash is a camera-share link (used to decide
// the initial route before doing the fuller deserialize). Never throws.
function isShareHash(str){
  try{
    const raw=str.startsWith("#")?str.slice(1):str;
    return !!decodePayload(raw)?.share;
  }catch{ return false; }
}
function serializeCameraShare(camId,nodes) {
  try {
    const cam=nodes[camId]; const rel={};
    rel[camId]={...cam};
    // Walk the dependency graph from the camera: plots it shows, then each
    // plot's attached domains/functions/scalars, transitively.
    const visit=(id,guard)=>{
      const n=nodes[id]; if(!n||guard.has(id)) return; guard.add(id);
      const copy={...n};
      if(catOf(n.type)==="plot"&&!copy.color) copy.color=DEFAULT_GEOM_COLOR[n.type]||"#5b9cf6";
      rel[id]=copy;
      for(const dep of (n.attachments||[])) visit(dep,guard);
    };
    const guard=new Set([camId]);
    for(const cid of (cam.attachments||[])) visit(cid,guard);
    // also any scalars attached directly to the camera (camera-prop deps)
    for(const dep of (cam.attachments||[])) if(isScalarType(nodes[dep]?.type)) visit(dep,guard);
    const proj=Object.values(nodes).find(n=>n.type==="project");
    if(proj) rel[proj.id]={...proj};
    return encodePayload({share:true,camId,nodes:debloatNodes(rel)});
  } catch{return null;}
}

export {
  serializeProject, deserializeProject, migrateModel, serializeCameraShare,
  deserializeCameraShare, isShareHash
};
