import { resolveNum, safeEval, linspace } from "../core/math.js";
import { catOf } from "../core/taxonomy.js";
import { resolveScope, plotDomain } from "../core/scope.js";
import { applyDomain } from "../geometry/rebuild.js";
import { parsePointSeq, parseGlyphField } from "../geometry/parse.js";
import { integrateFlow } from "../geometry/flow.js";
import { normalizedNode } from "../nodes/normalize.js";
import { sampleParamSpace } from "../geometry/transformer.js";

// ── 2D grid helpers ──────────────────────────────────────────────────────────
function nicestep(r){if(!r||!isFinite(r))return 1;const mag=Math.pow(10,Math.floor(Math.log10(Math.abs(r))));const f=r/mag;return mag*(f<2?1:f<5?2:5);}
function fmt(v){if(Math.abs(v)<1e-9)return"0";if(Math.abs(v)>=1000||Math.abs(v)<0.01)return v.toExponential(1);return parseFloat(v.toPrecision(3)).toString();}
function project3Dto2DPlane(px,py,pz,origin,uVec,vVec,threshold=0.15){
  const dx=px-origin[0],dy=py-origin[1],dz=pz-origin[2];
  const nx=uVec[1]*vVec[2]-uVec[2]*vVec[1],ny=uVec[2]*vVec[0]-uVec[0]*vVec[2],nz=uVec[0]*vVec[1]-uVec[1]*vVec[0];
  const nl=Math.sqrt(nx*nx+ny*ny+nz*nz);
  if(Math.abs((dx*nx+dy*ny+dz*nz)/(nl||1))>threshold)return null;
  return[dx*uVec[0]+dy*uVec[1]+dz*uVec[2],dx*vVec[0]+dy*vVec[1]+dz*vVec[2]];
}
function getPlane2DBasis(props,scope){
  const ox=resolveNum(props.planeOx,scope,0),oy=resolveNum(props.planeOy,scope,0),oz=resolveNum(props.planeOz,scope,0);
  const ux=resolveNum(props.planeUx,scope,1),uy=resolveNum(props.planeUy,scope,0),uz=resolveNum(props.planeUz,scope,0);
  const vx=resolveNum(props.planeVx,scope,0),vy=resolveNum(props.planeVy,scope,1),vz=resolveNum(props.planeVz,scope,0);
  const ul=Math.sqrt(ux*ux+uy*uy+uz*uz)||1,vl=Math.sqrt(vx*vx+vy*vy+vz*vz)||1;
  return{origin:[ox,oy,oz],uVec:[ux/ul,uy/ul,uz/ul],vVec:[vx/vl,vy/vl,vz/vl]};
}

function refineUV(px,py,pz,exprX,exprY,exprZ,u0,v0,uMin,uMax,vMin,vMax,scope,iters=8){
  let u=Math.max(uMin,Math.min(uMax,u0)),v=Math.max(vMin,Math.min(vMax,v0));
  const du=(uMax-uMin)*0.001,dv=(vMax-vMin)*0.001;
  for(let i=0;i<iters;i++){
    const sc={...scope,u,v};
    const x=safeEval(exprX,sc)??0,y=safeEval(exprY,sc)??0,z=safeEval(exprZ,sc)??0;
    const xu=safeEval(exprX,{...sc,u:u+du})??0,yu=safeEval(exprY,{...sc,u:u+du})??0,zu=safeEval(exprZ,{...sc,u:u+du})??0;
    const xv=safeEval(exprX,{...sc,v:v+dv})??0,yv=safeEval(exprY,{...sc,v:v+dv})??0,zv=safeEval(exprZ,{...sc,v:v+dv})??0;
    const gx=x-px,gy=y-py,gz=z-pz;
    const dFdu=(gx*(xu-x)+gy*(yu-y)+gz*(zu-z))/du;
    const dFdv=(gx*(xv-x)+gy*(yv-y)+gz*(zv-z))/dv;
    u=Math.max(uMin,Math.min(uMax,u-0.1*dFdu));
    v=Math.max(vMin,Math.min(vMax,v-0.1*dFdv));
  }
  const sc={...scope,u,v};
  const fx=safeEval(exprX,sc)??0,fy=safeEval(exprY,sc)??0,fz=safeEval(exprZ,sc)??0;
  return[u,v,Math.sqrt((fx-px)**2+(fy-py)**2+(fz-pz)**2)];
}
function projectToParamSurf(px,py,pz,exprX,exprY,exprZ,uMin,uMax,vMin,vMax,scope,coarseN=10){
  let bu=(uMin+uMax)/2,bv=(vMin+vMax)/2,bd2=Infinity;
  for(let i=0;i<=coarseN;i++)for(let j=0;j<=coarseN;j++){
    const u=uMin+(uMax-uMin)*i/coarseN,v=vMin+(vMax-vMin)*j/coarseN;
    const sc={...scope,u,v};
    const sx=safeEval(exprX,sc)??0,sy=safeEval(exprY,sc)??0,sz=safeEval(exprZ,sc)??0;
    const d2=(sx-px)**2+(sy-py)**2+(sz-pz)**2;
    if(d2<bd2){bd2=d2;bu=u;bv=v;}
  }
  return refineUV(px,py,pz,exprX,exprY,exprZ,bu,bv,uMin,uMax,vMin,vMax,scope);
}

// ── 2D quiver renderer ───────────────────────────────────────────────────────
function render2DQuiver(ctx,node,scope,toS,wxMin,wxMax,wyMin,wyMax){
  const np=node.props,color=node.color||"#5b9cf6";
  const gridN=Math.max(3,Math.min(30,resolveNum(np.gridN,scope,12)));
  const xMin=resolveNum(np.xMin,scope,wxMin),xMax=resolveNum(np.xMax,scope,wxMax);
  const yMin=resolveNum(np.yMin,scope,wyMin),yMax=resolveNum(np.yMax,scope,wyMax);
  const xs=linspace(xMin,xMax,gridN),ys=linspace(yMin,yMax,gridN);
  let maxMag=0;const raw=[];
  for(const x of xs)for(const y of ys){
    const sc={...scope,x,y};const vx=safeEval(np.exprX,sc)??0,vy=safeEval(np.exprY,sc)??0;
    const mag=Math.sqrt(vx*vx+vy*vy);raw.push({x,y,vx,vy,mag});if(mag>maxMag)maxMag=mag;
  }
  if(maxMag===0)return;
  const spacing=Math.min((xMax-xMin)/(gridN-1||1),(yMax-yMin)/(gridN-1||1));
  const[s0x]=toS(0,0),[s1x]=toS(spacing,0);
  const pxPerUnit=Math.abs(s1x-s0x),arrowLenPx=pxPerUnit*0.42;
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.5;
  for(const{x,y,vx,vy,mag}of raw){
    if(mag<1e-10)continue;
    const scale=(np.normalize!==false)?arrowLenPx:arrowLenPx*(mag/maxMag);
    const nx=vx/mag,ny=vy/mag;
    const[sx,sy]=toS(x,y);const ex=sx+nx*scale,ey=sy-ny*scale;
    ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);ctx.stroke();
    const angle=Math.atan2(sy-ey,ex-sx),hs=scale*0.28;
    ctx.beginPath();ctx.moveTo(ex,ey);
    ctx.lineTo(ex-hs*Math.cos(angle-0.45),ey+hs*Math.sin(angle-0.45));
    ctx.lineTo(ex-hs*Math.cos(angle+0.45),ey+hs*Math.sin(angle+0.45));
    ctx.closePath();ctx.fill();
  }
}

// 2D rendering of a transformer (function map over a domain). Honors the X/Y
// axis assignments (the Z axis is ignored in 2D). Graph mode with 1 input draws
// a curve; field mode draws arrows. 3-input domains are sampled coarsely.
function render2DTransformer(ctx,tNode,fnNode,paramNode,scope,toS,color){
  if(!fnNode) return;
  const tp=tNode.props||{};
  const inDim=Math.max(1,Math.min(3,Math.round(Number(fnNode.props.inDim||"1"))));
  const outDim=Math.max(1,Math.min(3,Math.round(Number(fnNode.props.outDim||"1"))));
  const outs=[fnNode.props.out0,fnNode.props.out1,fnNode.props.out2].slice(0,outDim).map(e=>e||"0");
  const AX={x:0,y:1,z:2,none:-1};
  const inAx=[tp.inAxis0,tp.inAxis1,tp.inAxis2].map(a=>AX[a??"none"]);
  const outAx=[tp.outAxis0,tp.outAxis1,tp.outAxis2].map(a=>AX[a??"none"]);
  const evalOut=(inVec)=>{const sc={...scope,x:inVec[0]??0,y:inVec[1]??0,z:inVec[2]??0};return outs.map(e=>{const v=safeEval(e,sc);return v==null||!isFinite(v)?0:v;});};
  // build sample inputs
  let samples=[];
  if(tp.domainSrc==="param" && paramNode){
    const pp=paramNode.props||{};
    const deg=Math.max(1,Math.min(2,Math.round(Number(pp.degree||"1"))));
    if(deg>=2){
      const ur=Math.max(2,Math.min(60,resolveNum(pp.uRes,scope,30))),vr=Math.max(2,Math.min(60,resolveNum(pp.vRes,scope,20)));
      const us=linspace(resolveNum(pp.uMin,scope,0),resolveNum(pp.uMax,scope,Math.PI*2),ur),vs=linspace(resolveNum(pp.vMin,scope,0),resolveNum(pp.vMax,scope,Math.PI),vr);
      for(const v of vs)for(const u of us)samples.push([safeEval(pp.exprXu,{...scope,u,v})??0,safeEval(pp.exprYu,{...scope,u,v})??0,safeEval(pp.exprZu,{...scope,u,v})??0]);
    } else {
      const res=Math.max(2,Math.min(600,resolveNum(pp.res,scope,200)));
      for(const t of linspace(resolveNum(pp.tMin,scope,0),resolveNum(pp.tMax,scope,Math.PI*2),res))
        samples.push([safeEval(pp.exprX,{...scope,t})??0,safeEval(pp.exprY,{...scope,t})??0,safeEval(pp.exprZ,{...scope,t})??0]);
    }
  } else {
    const res=Math.max(2,Math.min(inDim===1?600:(inDim===2?30:8),Math.round(resolveNum(tp.res,scope,inDim===1?200:14))));
    const aMin=resolveNum(tp.aMin,scope,-5),aMax=resolveNum(tp.aMax,scope,5);
    if(inDim===1){ for(const x of linspace(aMin,aMax,res)) samples.push([x,0,0]); }
    else {
      const bMin=resolveNum(tp.bMin,scope,-5),bMax=resolveNum(tp.bMax,scope,5);
      const xs=linspace(aMin,aMax,res),ys=linspace(bMin,bMax,res);
      if(inDim===2){ for(const y of ys)for(const x of xs)samples.push([x,y,0]); }
      else { const cMin=resolveNum(tp.cMin,scope,-3),cMax=resolveNum(tp.cMax,scope,3),zs=linspace(cMin,cMax,Math.min(res,8)); for(const x of xs)for(const y of ys)for(const z of zs)samples.push([x,y,z]); }
    }
  }
  // world [X,Y,Z] from in/out assignment
  const place=(inVec,outVec)=>{const w=[0,0,0];for(let k=0;k<inDim;k++){if(inAx[k]>=0)w[inAx[k]]=inVec[k]??0;}for(let k=0;k<outDim;k++){if(outAx[k]>=0)w[outAx[k]]=outVec[k]??0;}return w;};

  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;
  if(tp.mode==="field"){
    // arrows: base at input position (X,Y), vector from output (X,Y)
    let maxMag=0;const raw=[];
    for(const inVec of samples){
      const outVec=evalOut(inVec);
      const base=[0,0,0];for(let k=0;k<inDim;k++){if(inAx[k]>=0)base[inAx[k]]=inVec[k]??0;}
      const vec=[0,0,0];for(let k=0;k<outDim;k++){if(outAx[k]>=0)vec[outAx[k]]=outVec[k]??0;}
      const m=Math.hypot(vec[0],vec[1]);if(m>maxMag)maxMag=m;raw.push({base,vec,m});
    }
    maxMag=maxMag||1;const alen=resolveNum(tp.arrowLen,scope,0.5);
    for(const{base,vec,m}of raw){ if(m<1e-9)continue;
      const L=alen*(tp.normalize!==false?1:Math.min(1,m/maxMag));
      const dx=vec[0]/m*L,dy=vec[1]/m*L;
      const[sx,sy]=toS(base[0],base[1]);const[ex,ey]=toS(base[0]+dx,base[1]+dy);
      ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);ctx.stroke();
      const ang=Math.atan2(ey-sy,ex-sx),hl=8;
      ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-hl*Math.cos(ang-0.4),ey-hl*Math.sin(ang-0.4));ctx.moveTo(ex,ey);ctx.lineTo(ex-hl*Math.cos(ang+0.4),ey-hl*Math.sin(ang+0.4));ctx.stroke();
    }
    return;
  }
  // graph mode
  if(inDim===1){
    ctx.beginPath();let started=false;
    for(const inVec of samples){const w=place(inVec,evalOut(inVec));const[sx,sy]=toS(w[0],w[1]);if(!isFinite(sx)||!isFinite(sy)){started=false;continue;}started?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy);started=true;}
    ctx.stroke();
  } else {
    // 2+ inputs: scatter the graphed points
    for(const inVec of samples){const w=place(inVec,evalOut(inVec));const[sx,sy]=toS(w[0],w[1]);if(!isFinite(sx)||!isFinite(sy))continue;ctx.beginPath();ctx.arc(sx,sy,1.5,0,Math.PI*2);ctx.fill();}
  }
}

// ── 2D canvas renderer ───────────────────────────────────────────────────────
function render2D(canvas, camNode, nodes, scope, theme, animVals) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d"); const W = canvas.width, H = canvas.height; if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = camNode.props.bgOverride ? camNode.props.bgColor : theme.bg2d;
  ctx.fillRect(0, 0, W, H);
  const p2d = camNode.props;
  const isParamSurf = p2d.planeMode === "paramsurf";
  const isPlane = p2d.planeMode === "plane";
  if (canvas._view === undefined) canvas._view = { panX:0, panY:0, zoom:1 };
  const view = canvas._view; const scale = view.zoom * (Math.min(W,H)/10);
  const cx = W/2 + view.panX, cy = H/2 + view.panY;
  const toS = (wx,wy) => [cx + wx*scale, cy - wy*scale];
  const toW = (sx,sy) => [(sx-cx)/scale, (cy-sy)/scale];
  const [wxMin] = toW(0,0), [wxMax] = toW(W,H); const [,wyMin] = toW(W,H), [,wyMax] = toW(0,0);
  if (p2d.showGrid !== false) {
    const span = Math.max(Math.abs(wxMax-wxMin), Math.abs(wyMax-wyMin)), gStep = nicestep(span/10);
    ctx.strokeStyle = theme.grid2d; ctx.lineWidth = 1;
    for (let gx = Math.ceil(wxMin/gStep)*gStep; gx <= wxMax+gStep; gx += gStep) { const [sx] = toS(gx,0); ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx,H); ctx.stroke(); }
    for (let gy = Math.ceil(wyMin/gStep)*gStep; gy <= wyMax+gStep; gy += gStep) { const [,sy] = toS(0,gy); ctx.beginPath(); ctx.moveTo(0,sy); ctx.lineTo(W,sy); ctx.stroke(); }
    ctx.fillStyle = theme.grid2d; ctx.font = "9px monospace";
    for (let gx = Math.ceil(wxMin/gStep)*gStep; gx <= wxMax+gStep; gx += gStep) { const [sx] = toS(gx,0); if (sx>20&&sx<W-20) ctx.fillText(fmt(gx),sx+2,H-4); }
    for (let gy = Math.ceil(wyMin/gStep)*gStep; gy <= wyMax+gStep; gy += gStep) { const [,sy] = toS(0,gy); if (sy>12&&sy<H-4) ctx.fillText(fmt(gy),4,sy-2); }
  }
  if (p2d.showAxes !== false) {
    const [ax] = toS(0,0), [,ay] = toS(0,0); ctx.strokeStyle = theme.axes2d; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ax,0); ctx.lineTo(ax,H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,ay); ctx.lineTo(W,ay); ctx.stroke();
  }

  if (isParamSurf) {
    const psx=p2d.psExprX||"cos(u)*sin(v)",psy=p2d.psExprY||"sin(u)*sin(v)",psz=p2d.psExprZ||"cos(v)";
    const uMin=resolveNum(p2d.psUMin,scope,0),uMax=resolveNum(p2d.psUMax,scope,Math.PI*2);
    const vMin=resolveNum(p2d.psVMin,scope,0),vMax=resolveNum(p2d.psVMax,scope,Math.PI);
    const res=Math.max(4,Math.min(24,resolveNum(p2d.psRes,scope,16)));
    ctx.strokeStyle="rgba(80,110,180,0.35)";ctx.lineWidth=0.7;ctx.setLineDash([3,4]);
    const us=linspace(uMin,uMax,res),vs=linspace(vMin,vMax,res);
    for(let j=0;j<vs.length;j+=3){ctx.beginPath();let st=false;for(const u of us){const[sx,sy]=toS(u,vs[j]);st?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy);st=true;}ctx.stroke();}
    for(let i=0;i<us.length;i+=3){ctx.beginPath();let st=false;for(const v of vs){const[sx,sy]=toS(us[i],v);st?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy);st=true;}ctx.stroke();}
    ctx.setLineDash([]);
    ctx.fillStyle="rgba(80,130,210,0.6)";ctx.font="bold 11px monospace";
    const[lux,luy]=toS((uMin+uMax)/2,vMin-0.08*(vMax-vMin));ctx.fillText("u",lux,luy);
    const[lvx,lvy]=toS(uMin-0.06*(uMax-uMin),(vMin+vMax)/2);ctx.fillText("v",lvx,lvy);
  }

  const basis = isPlane ? getPlane2DBasis(p2d, scope) : null;
  const threshold = resolveNum(p2d.planeThreshold, scope, 0.15);

  for (const childId of (camNode.attachments||[])) {
    const rawNode = nodes[childId]; if (!rawNode) continue;
    if (catOf(rawNode.type)!=="plot") continue;
    const node = normalizedNode(rawNode);
    const own = animVals ? resolveScope(childId, nodes, animVals) : null;
    const pscope = own && Object.keys(own).length ? {...scope, ...own} : scope;
    const dom = plotDomain(childId, nodes);
    const np = dom ? applyDomain(node.props, node.type, dom) : node.props;
    const color = rawNode.color||"#5b9cf6";
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 1;

    if (isParamSurf) {
      const psx=p2d.psExprX||"cos(u)*sin(v)",psy=p2d.psExprY||"sin(u)*sin(v)",psz=p2d.psExprZ||"cos(v)";
      const uMin=resolveNum(p2d.psUMin,pscope,0),uMax=resolveNum(p2d.psUMax,pscope,Math.PI*2);
      const vMin=resolveNum(p2d.psVMin,pscope,0),vMax=resolveNum(p2d.psVMax,pscope,Math.PI);
      const distThr=resolveNum(p2d.psDistThreshold,pscope,0.35);
      ctx.fillStyle=color;
      if(node.type==="curve3d"){
        const ts=linspace(resolveNum(np.tMin,pscope,0),resolveNum(np.tMax,pscope,Math.PI*2),64);
        ctx.beginPath();let started=false,lu=null,lv=null;
        for(const t of ts){const x3=safeEval(np.exprX,{...pscope,t}),y3=safeEval(np.exprY,{...pscope,t}),z3=safeEval(np.exprZ,{...pscope,t});if(x3==null||y3==null||z3==null){started=false;lu=null;continue;}let u2,v2,d;if(lu!=null){[u2,v2,d]=refineUV(x3,y3,z3,psx,psy,psz,lu,lv,uMin,uMax,vMin,vMax,pscope,10);}else{[u2,v2,d]=projectToParamSurf(x3,y3,z3,psx,psy,psz,uMin,uMax,vMin,vMax,pscope,8);}if(d>distThr){started=false;lu=null;continue;}lu=u2;lv=v2;const[sx,sy]=toS(u2,v2);started?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy);started=true;}ctx.stroke();
      }
      if(node.type==="point"){const[u2,v2,d]=projectToParamSurf(resolveNum(np.x,pscope,0),resolveNum(np.y,pscope,0),resolveNum(np.z,pscope,0),psx,psy,psz,uMin,uMax,vMin,vMax,pscope);if(d<=distThr){const[sx,sy]=toS(u2,v2);ctx.beginPath();ctx.arc(sx,sy,6,0,Math.PI*2);ctx.fill();}}
      if(node.type==="pointSeq"){
        const pts=parsePointSeq(np.points,pscope);
        for(const[x,y,z]of pts){const[u2,v2,d]=projectToParamSurf(x,y,z,psx,psy,psz,uMin,uMax,vMin,vMax,pscope);if(d<=distThr){const[sx,sy]=toS(u2,v2);ctx.beginPath();ctx.arc(sx,sy,4,0,Math.PI*2);ctx.fill();}}
      }
      continue;
    }

    if (isPlane) {
      if(node.type==="curve3d"){const ts=linspace(resolveNum(np.tMin,pscope,0),resolveNum(np.tMax,pscope,Math.PI*2),resolveNum(np.res,pscope,300));ctx.fillStyle=color;for(const t of ts){const x3=safeEval(np.exprX,{...pscope,t}),y3=safeEval(np.exprY,{...pscope,t}),z3=safeEval(np.exprZ,{...pscope,t});if(x3==null||y3==null||z3==null)continue;const uv=project3Dto2DPlane(x3,y3,z3,basis.origin,basis.uVec,basis.vVec,threshold);if(!uv)continue;const[sx,sy]=toS(uv[0],uv[1]);ctx.beginPath();ctx.arc(sx,sy,2.5,0,Math.PI*2);ctx.fill();}}
      if(node.type==="point"){const x3=resolveNum(np.x,pscope,0),y3=resolveNum(np.y,pscope,0),z3=resolveNum(np.z,pscope,0);const uv=project3Dto2DPlane(x3,y3,z3,basis.origin,basis.uVec,basis.vVec,threshold);if(uv){ctx.fillStyle=color;const[sx,sy]=toS(uv[0],uv[1]);ctx.beginPath();ctx.arc(sx,sy,6,0,Math.PI*2);ctx.fill();}}
      if(node.type==="pointSeq"){
        const pts=parsePointSeq(np.points,pscope);ctx.fillStyle=color;
        for(const[x,y,z]of pts){const uv=project3Dto2DPlane(x,y,z,basis.origin,basis.uVec,basis.vVec,threshold);if(!uv)continue;const[sx,sy]=toS(uv[0],uv[1]);ctx.beginPath();ctx.arc(sx,sy,4,0,Math.PI*2);ctx.fill();}
      }
      continue;
    }

    // Default XY mode
    if(node.type==="fn1d"){
      const xMin=resolveNum(np.xMin,pscope,wxMin),xMax=resolveNum(np.xMax,pscope,wxMax);
      const xs=linspace(xMin,xMax,Math.max(2,resolveNum(np.res,pscope,400)));
      ctx.beginPath();let started=false;
      for(const x of xs){const y=safeEval(np.expr,{...pscope,x});if(y==null||!isFinite(y)){started=false;continue;}const[sx,sy]=toS(x,y);started?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy);started=true;}
      ctx.stroke();
    }
    if(node.type==="quiver2d")render2DQuiver(ctx,node,pscope,toS,wxMin,wxMax,wyMin,wyMax);
    if(rawNode.type==="transformer"){
      let fnNode=null,paramNode=null;
      for(const depId of (rawNode.attachments||[])){ const d=nodes[depId]; if(!d)continue; if(d.type==="fnMap"&&!fnNode)fnNode=d; else if(d.type==="paramSpace"&&!paramNode)paramNode=d; }
      render2DTransformer(ctx,rawNode,fnNode,paramNode,pscope,toS,color);
    }
    if(node.type==="glyphField"){
      const pairs=parseGlyphField(np.pairs,pscope);
      const norm=np.normalize!==false; const alen=resolveNum(np.arrowLen,pscope,0.5);
      let maxMag=0; for(const g of pairs){const m=Math.hypot(g.vec[0],g.vec[1]);if(m>maxMag)maxMag=m;} maxMag=maxMag||1;
      ctx.lineWidth=2;
      for(const {pos,vec} of pairs){
        const m=Math.hypot(vec[0],vec[1]); if(m<1e-9) continue;
        const L=alen*(norm?1:Math.min(1,m/maxMag));
        const dx=vec[0]/m*L, dy=vec[1]/m*L;
        const [sx,sy]=toS(pos[0],pos[1]); const [ex,ey]=toS(pos[0]+dx,pos[1]+dy);
        ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);ctx.stroke();
        // arrow head
        const ang=Math.atan2(ey-sy,ex-sx),hl=8;
        ctx.beginPath();ctx.moveTo(ex,ey);
        ctx.lineTo(ex-hl*Math.cos(ang-0.4),ey-hl*Math.sin(ang-0.4));
        ctx.moveTo(ex,ey);ctx.lineTo(ex-hl*Math.cos(ang+0.4),ey-hl*Math.sin(ang+0.4));
        ctx.stroke();
      }
    }
    if(rawNode.type==="flow"){
      let fnNode=null,seedNode=null;
      for(const depId of (rawNode.attachments||[])){ const d=nodes[depId]; if(!d)continue; if(d.type==="fnMap"&&!fnNode)fnNode=d; else if((d.type==="paramSpace"||d.type==="points")&&!seedNode)seedNode=d; }
      if(fnNode&&seedNode){
        const steps=Math.max(2,Math.min(2000,resolveNum(np.steps,pscope,500)));const stepSize=resolveNum(np.stepSize,pscope,0.02);
        const field={exprX:fnNode.props.out0||"0",exprY:fnNode.props.out1||"0",exprZ:fnNode.props.out2||"0"};
        const seedInfo = seedNode.type==="points"
          ? { pts: parsePointSeq(seedNode.props.data, pscope), grid:false }
          : sampleParamSpace(seedNode,pscope);
        // A degree-1 param-space seed in the XY plane fills as a solid area; all
        // other cases (points, surfaces) draw stream curves.
        const seedDeg = seedNode.type==="paramSpace" ? Math.max(1,Math.min(2,Math.round(Number(seedNode.props.degree||"1")))) : 0;
        const trajs=(seedInfo.pts||[]).map(s=>integrateFlow(s,field.exprX,field.exprY,field.exprZ,steps,stepSize,pscope));
        const fillArea = !isPlane && !isParamSurf && seedDeg===1 && np.output!=="lines" && trajs.length>=2;
        if(fillArea){
          // Stitch a filled quad between each pair of adjacent trajectories so
          // the swept stream surface reads as a solid coloured area in the plane.
          ctx.fillStyle=color; ctx.globalAlpha=0.5;
          for(let i=0;i<trajs.length-1;i++){
            const a=trajs[i], b=trajs[i+1]; const m=Math.min(a.length,b.length); if(m<2) continue;
            ctx.beginPath(); let started=false;
            for(let s=0;s<m;s++){ const q=a[s]; if(!q||!isFinite(q[0])||!isFinite(q[1])){started=false;continue;} const[sx,sy]=toS(q[0],q[1]); started?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy); started=true; }
            for(let s=m-1;s>=0;s--){ const q=b[s]; if(!q||!isFinite(q[0])||!isFinite(q[1]))continue; const[sx,sy]=toS(q[0],q[1]); ctx.lineTo(sx,sy); }
            ctx.closePath(); ctx.fill();
          }
          ctx.globalAlpha=1;
        } else {
          ctx.strokeStyle=color;ctx.lineWidth=2;
          for(const pts of trajs){
            ctx.beginPath();let started=false;for(const q of pts){if(!q||!isFinite(q[0])||!isFinite(q[1])){started=false;continue;}const[sx,sy]=toS(q[0],q[1]);started?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy);started=true;}ctx.stroke();
          }
        }
      }
    }
    if(node.type==="curve3d"){
      const ts=linspace(resolveNum(np.tMin,pscope,0),resolveNum(np.tMax,pscope,Math.PI*2),resolveNum(np.res,pscope,300));
      ctx.beginPath();let started=false;for(const t of ts){const x=safeEval(np.exprX,{...pscope,t}),y=safeEval(np.exprY,{...pscope,t});if(x==null||y==null){started=false;continue;}const[sx,sy]=toS(x,y);started?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy);started=true;}ctx.stroke();
    }
    if(node.type==="surf3d"){
      const res=Math.max(2,Math.min(60,resolveNum(np.res,pscope,40)));const xs=linspace(resolveNum(np.xMin,pscope,-4),resolveNum(np.xMax,pscope,4),res),ys=linspace(resolveNum(np.yMin,pscope,-4),resolveNum(np.yMax,pscope,4),res);
      ctx.globalAlpha=0.55;
      for(const x of xs.filter((_,i)=>i%4===0)){ctx.beginPath();let st=false;for(const y of ys){const[sx,sy]=toS(x,y);st?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy);st=true;}ctx.stroke();}
      for(const y of ys.filter((_,i)=>i%4===0)){ctx.beginPath();let st=false;for(const x of xs){const[sx,sy]=toS(x,y);st?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy);st=true;}ctx.stroke();}
      ctx.globalAlpha=1;
    }
    if(node.type==="paramsurf"){
      const ur=Math.max(2,Math.min(60,resolveNum(np.uRes,pscope,30))),vr=Math.max(2,Math.min(60,resolveNum(np.vRes,pscope,20)));
      const us=linspace(resolveNum(np.uMin,pscope,0),resolveNum(np.uMax,pscope,Math.PI*2),ur),vs=linspace(resolveNum(np.vMin,pscope,0),resolveNum(np.vMax,pscope,Math.PI),vr);
      ctx.globalAlpha=0.55;
      for(const v of vs.filter((_,i)=>i%3===0)){ctx.beginPath();let st=false;for(const u of us){const x=safeEval(np.exprX,{...pscope,u,v}),y=safeEval(np.exprY,{...pscope,u,v});if(x==null||y==null){st=false;continue;}const[sx,sy]=toS(x,y);st?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy);st=true;}ctx.stroke();}
      ctx.globalAlpha=1;
    }
    if(node.type==="plane"){
      const nx=resolveNum(np.normalX,pscope,0),ny=resolveNum(np.normalY,pscope,1);const cx2=resolveNum(np.centerX,pscope,0),cy2=resolveNum(np.centerY,pscope,0);
      ctx.setLineDash([6,4]);const[sx1,sy1]=toS(wxMin,cy2-(nx!==0?(wxMin-cx2)*ny/nx:0));const[sx2,sy2]=toS(wxMax,cy2-(nx!==0?(wxMax-cx2)*ny/nx:0));
      ctx.beginPath();ctx.moveTo(sx1,sy1);ctx.lineTo(sx2,sy2);ctx.stroke();ctx.setLineDash([]);
    }
    if(node.type==="point"){
      const x3=resolveNum(np.x,pscope,0),y3=resolveNum(np.y,pscope,0);
      ctx.fillStyle=color;const[sx,sy]=toS(x3,y3);ctx.beginPath();ctx.arc(sx,sy,5,0,Math.PI*2);ctx.fill();
    }
    if(node.type==="pointSeq"){
      const pts=parsePointSeq(np.points,pscope);
      ctx.fillStyle=color;
      const r2d=resolveNum(np.radius,pscope,4);
      if(np.drawLines!==false&&pts.length>1){
        ctx.beginPath();let st=false;
        for(const[x,y]of pts){const[sx,sy]=toS(x,y);st?ctx.lineTo(sx,sy):ctx.moveTo(sx,sy);st=true;}
        ctx.stroke();
      }
      for(const[x,y]of pts){const[sx,sy]=toS(x,y);ctx.beginPath();ctx.arc(sx,sy,r2d,0,Math.PI*2);ctx.fill();}
    }
  }
}

export {
  render2D, render2DQuiver, nicestep, fmt, project3Dto2DPlane, getPlane2DBasis, refineUV, projectToParamSurf
};
