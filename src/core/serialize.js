import { uid } from "./math.js";
import { catOf, isScalarType } from "./taxonomy.js";
import { DEFAULT_GEOM_COLOR } from "../nodes/colors.js";

// ── Serialization ────────────────────────────────────────────────────────────
function serializeProject(nodes) {
  // Working-session save (URL hash). Preserve `playing` so reloading restores a
  // running animation. (The *share* serializer strips playing so shared links
  // don't autoplay.)
  try { return btoa(encodeURIComponent(JSON.stringify(nodes))); } catch{return null;}
}
function deserializeProject(str) {
  try {
    const raw=str.startsWith("#")?str.slice(1):str;
    const data=JSON.parse(decodeURIComponent(atob(raw)));
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
function migrateUnifiedKinds(nodes){
  const out={};
  for(const[id,n]of Object.entries(nodes)){
    out[id]=migrateOneToUnified(n);
  }
  return out;
}
function migrateOneToUnified(n){
  const p=n.props||{};
  switch(n.type){
    case "fn1d":
      return {...n,type:"scalarFn",props:{
        dims:"1",expr:p.expr??"sin(x)",
        xMin:p.xMin??"-5",xMax:p.xMax??"5",yMin:"-4",yMax:"4",zMin:"-3",zMax:"3",
        res:p.res??"300",colorByValue:false,colorLo:"#3a6df0",colorHi:"#f0533a",
      }};
    case "surf3d":
      return {...n,type:"scalarFn",props:{
        dims:"2",expr:p.expr??"sin(x)*cos(y)",
        xMin:p.xMin??"-4",xMax:p.xMax??"4",yMin:p.yMin??"-4",yMax:p.yMax??"4",
        zMin:"-3",zMax:"3",res:p.res??"40",colorByValue:false,colorLo:"#3a6df0",colorHi:"#f0533a",
      }};
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
    case "point":
      return {...n,type:"points",props:{
        space:"xyz",hasVectors:false,
        data:`${p.x??"0"}, ${p.y??"0"}, ${p.z??"0"}`,
        radius:p.radius!=null?String(Math.max(2,Number(p.radius)*50||4)):"4",
        drawLines:false,
        arrowLen:"0.5",normalize:true,anim:"crest",speed:"1",crestColor:"#ffffff",
        sequenced:false,seqFrac:"1",seqVar:"",
      }};
    case "pointSeq":
      return {...n,type:"points",props:{
        space:"xy",hasVectors:false,
        data:p.points??"0, 0\n1, 1\n2, 0",
        radius:p.radius??"4",drawLines:p.drawLines!==false,
        arrowLen:"0.5",normalize:true,anim:"crest",speed:"1",crestColor:"#ffffff",
        sequenced:!!p.sequenced,seqFrac:p.seqFrac??"1",seqVar:p.seqVar??"",
      }};
    case "glyphField":
      return {...n,type:"points",props:{
        space:"xyz",hasVectors:true,
        data:p.pairs??"0,0,0 | 1,0,0",
        radius:"4",drawLines:true,
        arrowLen:p.arrowLen??"0.5",normalize:p.normalize!==false,
        lenMode:p.lenMode||(p.normalize===false?"scaled":"uniform"),
        anim:p.anim??"crest",speed:p.speed??"1",crestColor:p.crestColor??"#ffffff",
        sequenced:false,seqFrac:"1",seqVar:"",
      }};
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
    return btoa(encodeURIComponent(JSON.stringify({share:true,camId,nodes:rel})));
  } catch{return null;}
}

export {
  serializeProject, deserializeProject, migrateModel, serializeCameraShare
};
