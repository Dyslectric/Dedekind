import * as THREE from "three";
import { resolveNum, safeEval, linspace } from "../core/math.js";
import { catOf } from "../core/taxonomy.js";
import { resolveScope, plotDomain, plotSignature } from "../core/scope.js";
import { applyDomain, pointGradientColors, rampColors } from "../geometry/rebuild.js";
import { parsePointSeq, parseGlyphField, parsePointsExplicit, parseGlyphsExplicit } from "../geometry/parse.js";
import { integrateFlow } from "../geometry/flow.js";
import { normalizedNode } from "../nodes/normalize.js";
import { sampleParamSpace } from "../geometry/transformer.js";
import { marchingSquares } from "../geometry/implicit.js";
import { hexToThree } from "../geometry/three-helpers.js";
import { planeFrame, projectPt, projectPts } from "./project2d.js";
import { advectSeeds } from "../geometry/flow.js";

// ── helpers ──────────────────────────────────────────────────────────────────
function nicestep(r){ if(!r||!isFinite(r))return 1; const m=Math.pow(10,Math.floor(Math.log10(Math.abs(r)))); const f=r/m; return m*(f<2?1:f<5?2:5); }
function fmt(v){ if(Math.abs(v)<1e-9)return"0"; if(Math.abs(v)>=1000||Math.abs(v)<0.01)return v.toExponential(1); return parseFloat(v.toPrecision(3)).toString(); }

function hexRGB(hex){
  hex=(hex||"#888").replace("#","");
  if(hex.length===3)hex=hex.split("").map(c=>c+c).join("");
  return[parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255];
}
function hexColor(hex){ const[r,g,b]=hexRGB(hex); return new THREE.Color(r,g,b); }

// Build a THICK polyline as a triangle-strip ribbon. `half` is the half-width
// in WORLD units (callers pass px(2.6)/2 so it renders ~2.6px on screen at any
// zoom). WebGL caps LineBasicMaterial.linewidth at 1px, so genuine thickness
// requires filled geometry. Joints use a simple averaged-normal miter, which is
// fine for smooth curves; very sharp corners fall back gracefully (clamped).
// Returns one Mesh per contiguous run (NaN/null breaks the run).
function buildThickLine2D(pts2d, color, half, opacity=1){
  const runs=[]; let cur=[];
  for(const p of pts2d){
    if(p&&isFinite(p[0])&&isFinite(p[1])) cur.push(p);
    else{ if(cur.length>1)runs.push(cur); cur=[]; }
  }
  if(cur.length>1) runs.push(cur);
  const meshes=[];
  for(const run of runs){
    const m=ribbonMesh(run, half, color, opacity);
    if(m) meshes.push(m);
  }
  return meshes;
}

// Build thick DISCONNECTED segments (for implicit/marching-squares output where
// each [a,b] pair is independent). `segs` is [[ [x,y],[x,y] ], ...].
function buildThickSegments2D(segs, color, half){
  const pos=[];
  for(const [a,b] of segs){
    if(!a||!b) continue;
    const dx=b[0]-a[0], dy=b[1]-a[1];
    const len=Math.hypot(dx,dy); if(len<1e-12) continue;
    const nx=-dy/len*half, ny=dx/len*half;
    const a1=[a[0]+nx,a[1]+ny], a2=[a[0]-nx,a[1]-ny];
    const b1=[b[0]+nx,b[1]+ny], b2=[b[0]-nx,b[1]-ny];
    pos.push(a1[0],a1[1],0, b1[0],b1[1],0, b2[0],b2[1],0);
    pos.push(a1[0],a1[1],0, b2[0],b2[1],0, a2[0],a2[1],0);
  }
  if(!pos.length) return [];
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  const mat=new THREE.MeshBasicMaterial({color:hexToThree(color),depthTest:false,side:THREE.DoubleSide});
  return [new THREE.Mesh(g,mat)];
}

// Internal: build one ribbon mesh from a contiguous point run.
//
// Each segment is thickened INDEPENDENTLY into its own full-width quad using
// that segment's own normal, then a round join (triangle fan) is dropped at
// every interior vertex. This deliberately avoids shared mitered vertices: a
// miter collapses to zero width at sharp turns, which is exactly what made
// fast-moving / steep curves (near-vertical y=f(x), tight parametric loops) go
// skinny and hard to see. Per-segment quads keep the full half-width through any
// angle; the round joints fill the outer corner so the stroke reads continuous.
function ribbonMesh(run, half, color, opacity=1){
  const n=run.length; if(n<2) return null;
  const pos=[];
  const pushTri=(a,b,c)=>{ pos.push(a[0],a[1],0, b[0],b[1],0, c[0],c[1],0); };
  // Round-join fan: sweep a disc wedge of radius `half` around centre `c`, from
  // angle a0 to a1 along the shorter arc. A few wedges is plenty at ~2.6px.
  const JOIN_SEGS=6;
  const fan=(c,a0,a1)=>{
    let d=a1-a0;
    while(d> Math.PI) d-=2*Math.PI;
    while(d<-Math.PI) d+=2*Math.PI;
    const steps=Math.max(1,Math.ceil(Math.abs(d)/(Math.PI/JOIN_SEGS)));
    let prev=[c[0]+Math.cos(a0)*half, c[1]+Math.sin(a0)*half];
    for(let k=1;k<=steps;k++){
      const a=a0+d*(k/steps);
      const cur=[c[0]+Math.cos(a)*half, c[1]+Math.sin(a)*half];
      pushTri(c, prev, cur);
      prev=cur;
    }
  };
  let prev=null; // {q1,q2, angN} of the previous segment's END
  for(let i=0;i<n-1;i++){
    const p=run[i], q=run[i+1];
    const dx=q[0]-p[0], dy=q[1]-p[1];
    const l=Math.hypot(dx,dy);
    if(l<1e-12) continue;
    const ux=dx/l, uy=dy/l;          // unit direction
    const nx=-uy, ny=ux;             // unit left normal
    const hx=nx*half, hy=ny*half;
    const p1=[p[0]+hx,p[1]+hy], p2=[p[0]-hx,p[1]-hy];
    const q1=[q[0]+hx,q[1]+hy], q2=[q[0]-hx,q[1]-hy];
    // Full-width quad for this segment (its own normal → never pinches).
    pushTri(p1,q1,q2);
    pushTri(p1,q2,p2);
    // Round join at the shared vertex p between the previous segment and this one.
    if(prev){
      const angN=Math.atan2(ny,nx);          // this segment's +normal angle
      fan(p, prev.angN, angN);               // outer side
      fan(p, prev.angN+Math.PI, angN+Math.PI); // inner side
    }
    prev={angN:Math.atan2(ny,nx)};
  }
  if(!pos.length) return null;
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  const mat=new THREE.MeshBasicMaterial({color:hexToThree(color),depthTest:false,side:THREE.DoubleSide,transparent:opacity<1,opacity});
  return new THREE.Mesh(g,mat);
}

// Build a SOLID filled mesh from a grid of projected [u,v] points
// (rows[r][c] = [u,v] | null). Triangulates each quad cell directly into two
// triangles — it does NOT triangulate a boundary polygon, so a self-intersecting
// stream surface keeps every cell and never drops parts. Solid color, no alpha.
// A cell is emitted only when all four corners are finite; a missing/NaN corner
// just skips that one cell (the rest of the sheet stays intact).
function buildFilledGrid2D(rows, color){
  const pos=[];
  for(let r=0;r<rows.length-1;r++){
    const ra=rows[r], rb=rows[r+1];
    if(!ra||!rb) continue;
    const cols=Math.min(ra.length, rb.length);
    for(let c=0;c<cols-1;c++){
      const a=ra[c], b=ra[c+1], d=rb[c], e=rb[c+1];
      if(!a||!b||!d||!e) continue;
      // quad (a,b,e,d) → two triangles. DoubleSide so winding never hides it.
      pos.push(a[0],a[1],0, b[0],b[1],0, e[0],e[1],0);
      pos.push(a[0],a[1],0, e[0],e[1],0, d[0],d[1],0);
    }
  }
  if(!pos.length) return [];
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  // SOLID: opaque, no alpha. depthWrite off keeps it flat-composited with other
  // 2-D plot meshes (everything sits on z=0) without z-fighting artifacts.
  const mat=new THREE.MeshBasicMaterial({color:hexToThree(color),side:THREE.DoubleSide,depthTest:false,depthWrite:false});
  return [new THREE.Mesh(g,mat)];
}

// Build a thin-line WIREFRAME (both grid directions) from a projected grid.
// (Reserved helper — 2-D flow surfaces are solid-only and never wireframed, so
// this is intentionally unused by the 2-D pipeline.)


// triangular head. shaft `thickness` and `headLen` are in WORLD units; callers
// derive them from screen pixels (px(...)) so the arrow keeps a constant on-
// screen weight at any zoom. A filled mesh is used (not GL lines) because
// WebGL ignores LineBasicMaterial.linewidth, so lines can't be thickened.
function buildArrow2D(bx,by,dx,dy, color, headLen=0.15, thickness=null){
  const len=Math.hypot(dx,dy);
  if(len<1e-9) return null;
  const ux=dx/len, uy=dy/len;     // unit along
  const nx=-uy, ny=ux;            // unit normal
  const th=(thickness!=null?thickness:headLen*0.34);
  const half=th*0.5;
  const headW=th*3.4;             // head half-width relative to shaft (wider head)
  const hw=headW*0.5;
  // shaft runs from base to where the head begins
  const sLen=Math.max(0,len-headLen);
  const ex=bx+dx, ey=by+dy;           // tip
  const sx2=bx+ux*sLen, sy2=by+uy*sLen; // shaft end / head base
  const pos=[];
  const push=(x,y)=>pos.push(x,y,0);
  // shaft quad: (base±n) → (shaftEnd±n), two triangles
  const b1x=bx+nx*half, b1y=by+ny*half;
  const b2x=bx-nx*half, b2y=by-ny*half;
  const e1x=sx2+nx*half, e1y=sy2+ny*half;
  const e2x=sx2-nx*half, e2y=sy2-ny*half;
  push(b1x,b1y); push(e1x,e1y); push(e2x,e2y);
  push(b1x,b1y); push(e2x,e2y); push(b2x,b2y);
  // head triangle: tip + two base corners at the head base
  const h1x=sx2+nx*hw, h1y=sy2+ny*hw;
  const h2x=sx2-nx*hw, h2y=sy2-ny*hw;
  push(h1x,h1y); push(ex,ey); push(h2x,h2y);
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  const mat=new THREE.MeshBasicMaterial({color:hexToThree(color),depthTest:false,side:THREE.DoubleSide});
  return new THREE.Mesh(g,mat);
}

// Batched arrow builder. Quiver / field plots can emit hundreds–thousands of
// arrows; giving each its own Mesh+BufferGeometry+Material (as buildArrow2D does)
// means one draw call and one GC-tracked material per arrow, which bogged the 2-D
// viewport down badly and made a high grid resolution unusable. This accumulates
// every arrow's triangles into ONE position buffer (plus an optional per-vertex
// color buffer) and returns a single Mesh — one draw call for the whole field.
//
// Usage:
//   const ab=new ArrowBatch2D();
//   ab.add(bx,by,dx,dy,headLen,thickness, colorRGBorNull);
//   const mesh=ab.build(flatColorHex);   // null/empty → returns null
function ArrowBatch2D(){
  const pos=[];          // flat x,y,z triples
  const col=[];          // flat r,g,b triples (only used if any arrow has a color)
  let anyColor=false;
  return {
    add(bx,by,dx,dy, headLen=0.15, thickness=null, rgb=null){
      const len=Math.hypot(dx,dy);
      if(len<1e-9) return;
      const ux=dx/len, uy=dy/len;
      const nx=-uy, ny=ux;
      const th=(thickness!=null?thickness:headLen*0.34);
      const half=th*0.5;
      const hw=(th*3.4)*0.5;
      const sLen=Math.max(0,len-headLen);
      const ex=bx+dx, ey=by+dy;
      const sx2=bx+ux*sLen, sy2=by+uy*sLen;
      // 5 triangles' worth of vertices (4 shaft + … actually 2 shaft tris + 1 head)
      const verts=[];
      const v=(x,y)=>verts.push(x,y);
      const b1x=bx+nx*half, b1y=by+ny*half;
      const b2x=bx-nx*half, b2y=by-ny*half;
      const e1x=sx2+nx*half, e1y=sy2+ny*half;
      const e2x=sx2-nx*half, e2y=sy2-ny*half;
      v(b1x,b1y); v(e1x,e1y); v(e2x,e2y);
      v(b1x,b1y); v(e2x,e2y); v(b2x,b2y);
      const h1x=sx2+nx*hw, h1y=sy2+ny*hw;
      const h2x=sx2-nx*hw, h2y=sy2-ny*hw;
      v(h1x,h1y); v(ex,ey); v(h2x,h2y);
      for(let i=0;i<verts.length;i+=2){ pos.push(verts[i],verts[i+1],0); }
      if(rgb){ anyColor=true; }
      // always push a color slot per vertex so the color buffer (if used) stays
      // aligned with positions; defaults to white and is ignored when no material
      // vertexColors is set.
      const c=rgb||[1,1,1];
      for(let i=0;i<verts.length;i+=2){ col.push(c[0],c[1],c[2]); }
    },
    isEmpty(){ return pos.length===0; },
    // flatColor: hex string used when no per-arrow colors were supplied.
    build(flatColor){
      if(!pos.length) return null;
      const g=new THREE.BufferGeometry();
      g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
      let mat;
      if(anyColor){
        g.setAttribute("color",new THREE.Float32BufferAttribute(col,3));
        mat=new THREE.MeshBasicMaterial({vertexColors:true,depthTest:false,side:THREE.DoubleSide});
      } else {
        mat=new THREE.MeshBasicMaterial({color:hexToThree(flatColor),depthTest:false,side:THREE.DoubleSide});
      }
      return new THREE.Mesh(g,mat);
    }
  };
}

// Small circle sprite as a triangle-fan disk (good for points).
function buildDisk2D(cx,cy, r, color, opacity=1){
  const N=12; const pts=[];
  for(let i=0;i<=N;i++){
    const a=i/N*Math.PI*2;
    pts.push(new THREE.Vector2(cx+r*Math.cos(a),cy+r*Math.sin(a)));
  }
  const shape=new THREE.Shape(pts);
  const g=new THREE.ShapeGeometry(shape);
  const mat=new THREE.MeshBasicMaterial({color:hexToThree(color),transparent:opacity<1,opacity,depthTest:false});
  return new THREE.Mesh(g,mat);
}

// ── plot geometry builders ────────────────────────────────────────────────────

// On-screen line weight for 1-space (curve) plots, in CSS pixels.
const LINE_PX = 2.6;

function build2DFn1d(np, pscope, color, wxMin, wxMax, px, fr){
  const xMin=resolveNum(np.xMin,pscope,wxMin), xMax=resolveNum(np.xMax,pscope,wxMax);
  const res=Math.max(2, Math.min(8000, resolveNum(np.res,pscope,600)));
  const pts=linspace(xMin,xMax,res).map(x=>{
    const y=safeEval(np.expr,{...pscope,x});
    return (y!=null&&isFinite(y)) ? [x,y,0] : null;
  });
  return buildThickLine2D(projectPts(fr,pts), color, px(LINE_PX)/2);
}

function build2DCurve3d(np, pscope, color, px, fr){
  const tMin=resolveNum(np.tMin,pscope,0), tMax=resolveNum(np.tMax,pscope,Math.PI*2);
  const res=Math.max(2, Math.min(8000, resolveNum(np.res,pscope,400)));
  const pts=linspace(tMin,tMax,res).map(t=>{
    const x=safeEval(np.exprX,{...pscope,t}), y=safeEval(np.exprY,{...pscope,t}), z=safeEval(np.exprZ,{...pscope,t});
    return (x!=null&&y!=null&&isFinite(x)&&isFinite(y)) ? [x,y,(z!=null&&isFinite(z))?z:0] : null;
  });
  return buildThickLine2D(projectPts(fr,pts), color, px(LINE_PX)/2);
}

function build2DPointSeq(np, pscope, color, px, fr){
  // Parse positions (and the per-point color slot) the same way the 3-D renderer
  // does: prefer the explicit dropdown-authored parse so the recursible color
  // slot is honoured; fall back to the legacy text parse for old projects.
  let pts, cols=null;
  if(np.__explicit){
    const r=parsePointsExplicit(np.__explicit, pscope);
    pts=r.pts;
    cols = np.__useColor ? rampColors(r.cols, np, pscope) : pointGradientColors(pts, np, pscope);
  } else {
    pts=parsePointSeq(np.points||np.data, pscope);
    cols=pointGradientColors(pts, np, pscope);
  }
  const rPx=resolveNum(np.radius,pscope,4);
  const r=px(rPx); // constant on-screen radius
  const objs=[];
  const proj=pts.map(([x,y,z])=>projectPt(fr,x,y,z||0));
  // Per-point colors render as hex; connecting line stays the node color.
  const rgbHex=(c)=>"#"+[0,1,2].map(k=>Math.round(Math.max(0,Math.min(1,c[k]))*255).toString(16).padStart(2,"0")).join("");
  if(np.drawLines!==false && proj.length>1){
    objs.push(...buildThickLine2D(proj, color, px(LINE_PX)/2));
  }
  for(let i=0;i<proj.length;i++){
    const [u,v]=proj[i];
    objs.push(buildDisk2D(u,v,r, cols&&cols[i]?rgbHex(cols[i]):color));
  }
  return objs;
}

function build2DPoint(np, pscope, color, px, fr){
  const x=resolveNum(np.x,pscope,0), y=resolveNum(np.y,pscope,0), z=resolveNum(np.z,pscope,0);
  const [u,v]=projectPt(fr,x,y,z);
  return [buildDisk2D(u,v,px(5),color)];
}

function build2DQuiver(np, pscope, color, wxMin, wxMax, wyMin, wyMax, px, fr){
  const gridN=Math.max(3,Math.min(256,resolveNum(np.gridN,pscope,12)));
  const xMin=resolveNum(np.xMin,pscope,wxMin), xMax=resolveNum(np.xMax,pscope,wxMax);
  const yMin=resolveNum(np.yMin,pscope,wyMin), yMax=resolveNum(np.yMax,pscope,wyMax);
  const xs=linspace(xMin,xMax,gridN), ys=linspace(yMin,yMax,gridN);
  let maxMag=0; const raw=[];
  for(const x of xs) for(const y of ys){
    const sc={...pscope,x,y};
    const vx=safeEval(np.exprX,sc)??0, vy=safeEval(np.exprY,sc)??0;
    const mag=Math.sqrt(vx*vx+vy*vy); raw.push({x,y,vx,vy,mag}); if(mag>maxMag)maxMag=mag;
  }
  if(!maxMag) return [];
  const spacing=Math.min((xMax-xMin)/(gridN-1||1),(yMax-yMin)/(gridN-1||1));
  const L=spacing*0.42;
  const head=px(16); // constant on-screen arrowhead length
  const thick=px(2.6); // constant on-screen shaft thickness
  // Batch every arrow into a single mesh — at high gridN this is the difference
  // between one draw call and gridN² of them.
  const ab=ArrowBatch2D();
  for(const {x,y,vx,vy,mag} of raw){
    if(mag<1e-10) continue;
    const scale=np.normalize!==false ? L : L*(mag/maxMag);
    const nx=vx/mag, ny=vy/mag;
    // project base and tip onto the plane so a tilted view shears arrows correctly
    const b=projectPt(fr,x,y,0);
    const tip=projectPt(fr,x+nx*scale,y+ny*scale,0);
    ab.add(b[0],b[1], tip[0]-b[0], tip[1]-b[1], Math.min(head, scale*0.5), thick);
  }
  const m=ab.build(color);
  return m?[m]:[];
}

// 3-D quiver in a 2-D viewport: sample a 3-D grid, size each arrow in true 3-D,
// then project base→tip so out-of-plane arrows foreshorten correctly (same
// orthographic treatment as a 3-D vector field).
function build2DQuiver3d(np, pscope, color, px, fr){
  const gridN=Math.max(2,Math.min(48,resolveNum(np.gridN,pscope,5)));
  const xMin=resolveNum(np.xMin,pscope,-3),xMax=resolveNum(np.xMax,pscope,3);
  const yMin=resolveNum(np.yMin,pscope,-3),yMax=resolveNum(np.yMax,pscope,3);
  const zMin=resolveNum(np.zMin,pscope,-3),zMax=resolveNum(np.zMax,pscope,3);
  const xs=linspace(xMin,xMax,gridN),ys=linspace(yMin,yMax,gridN),zs=linspace(zMin,zMax,gridN);
  let maxMag=0; const raw=[];
  for(const x of xs)for(const y of ys)for(const z of zs){
    const sc={...pscope,x,y,z};
    const vx=safeEval(np.exprX,sc)??0,vy=safeEval(np.exprY,sc)??0,vz=safeEval(np.exprZ,sc)??0;
    const m=Math.hypot(vx,vy,vz); if(m>maxMag)maxMag=m;
    raw.push({x,y,z,vx,vy,vz,m});
  }
  if(!maxMag) return [];
  const spacing=Math.min((xMax-xMin)/(gridN-1||1),(yMax-yMin)/(gridN-1||1),(zMax-zMin)/(gridN-1||1));
  const L=spacing*0.5;
  const head=px(16), thick=px(2.6);
  const ab=ArrowBatch2D();
  for(const {x,y,z,vx,vy,vz,m} of raw){
    if(m<1e-10) continue;
    const len=(np.normalize!==false?L:L*(m/maxMag));
    const s=len/m;
    const b=projectPt(fr,x,y,z);
    const t=projectPt(fr,x+vx*s,y+vy*s,z+vz*s);
    const dx=t[0]-b[0],dy=t[1]-b[1];
    const sl=Math.hypot(dx,dy); if(sl<1e-9) continue;
    ab.add(b[0],b[1],dx,dy,Math.min(head,sl*0.5),thick);
  }
  const mesh=ab.build(color);
  return mesh?[mesh]:[];
}


function build2DImplicit(tNode, eqNode, pscope, color, px, fr){
  // 3D implicit surfaces require a 3D camera; nothing meaningful to draw in 2D.
  if((eqNode.props.dims||"2d")==="3d") return [];
  const tp=tNode.props||{};
  const aMin=resolveNum(tp.aMin,pscope,-5), aMax=resolveNum(tp.aMax,pscope,5);
  const bMin=resolveNum(tp.bMin,pscope,-5), bMax=resolveNum(tp.bMax,pscope,5);
  const res=Math.max(2,Math.min(1200,Math.round(resolveNum(tp.res,pscope,160))));
  const segs=marchingSquares(eqNode, pscope, aMin, aMax, bMin, bMax, res);
  if(!segs.length) return [];
  const proj=segs.map(([a,b])=>[projectPt(fr,a[0],a[1],0),projectPt(fr,b[0],b[1],0)]);
  return buildThickSegments2D(proj, color, px(LINE_PX)/2);
}

function build2DTransformer(tNode, fnNode, paramNode, pscope, color, wxMin, wxMax, wyMin, wyMax, px, fr){
  if(!fnNode) return [];
  const tp=tNode.props||{};
  const inDim=Math.max(1,Math.min(4,Math.round(Number(fnNode.props.inDim||"1"))));
  const outDim=Math.max(1,Math.min(4,Math.round(Number(fnNode.props.outDim||"1"))));
  const outs=[fnNode.props.out0,fnNode.props.out1,fnNode.props.out2,fnNode.props.out3].slice(0,outDim).map(e=>e||"0");
  const AX={x:0,y:1,z:2,none:-1};
  const inAx=[tp.inAxis0,tp.inAxis1,tp.inAxis2].map(a=>AX[a??"none"]);
  const outAx=[tp.outAxis0,tp.outAxis1,tp.outAxis2,tp.outAxis3].map(a=>AX[a??"none"]);
  const evalOut=(inVec)=>{const sc={...pscope,x:inVec[0]??0,y:inVec[1]??0,z:inVec[2]??0,w:inVec[3]??0};return outs.map(e=>{const v=safeEval(e,sc);return v==null||!isFinite(v)?0:v;});};
  let colorIdx=-1; for(let k=0;k<outDim;k++){ if((tp[`outAxis${k}`]||"")==="color"){ colorIdx=k; break; } }
  const useColor=colorIdx>=0;
  const loC=hexRGB(tp.colorLo||"#3a6aff"), hiC=hexRGB(tp.colorHi||"#ff5ea8");
  const ramp=(t)=>{t=t<0?0:t>1?1:t;const h=(v)=>{const x=Math.round(v*255);return(x<16?"0":"")+x.toString(16);};return`#${h(loC[0]+(hiC[0]-loC[0])*t)}${h(loC[1]+(hiC[1]-loC[1])*t)}${h(loC[2]+(hiC[2]-loC[2])*t)}`;}

  // Place an input/output pair into a MATH-space [x,y,z] triple using the
  // transformer's axis assignments, then project onto the camera plane. This is
  // the 3-D world position the 3-D viewport would draw, viewed orthographically.
  const world3=(inVec,outVec)=>{const w=[0,0,0];
    for(let k=0;k<inDim;k++){const a=inAx[k]; if(a>=0)w[a]=inVec[k]??0;}
    for(let k=0;k<outDim;k++){const a=outAx[k]; if(a>=0)w[a]=outVec[k]??0;}
    return w;};
  const place=(inVec,outVec)=>{const w=world3(inVec,outVec); return projectPt(fr,w[0],w[1],w[2]);};

  // ── FIELD mode ──
  // Orthographic projection of a vector field onto the camera plane. The arrow
  // is sized in TRUE 3-D first (so normalization and magnitude-scaling use the
  // real |v|, not the in-plane component), then base and tip are projected. This
  // makes a vector pointing out of the plane correctly foreshorten (it appears
  // short) instead of being stretched back to full length by 2-D normalization,
  // and keeps in-plane direction faithful. A vector lying exactly along the
  // plane normal projects to a point (zero on-screen length), which is the
  // correct orthographic result.
  if(tp.mode==="field"){
    const samples=transformerSamples(tp,paramNode,pscope,inDim);
    // First pass: true-3D magnitude (and color) per sample.
    let maxMag=0, cMin=Infinity, cMax=-Infinity; const raw=[];
    for(const inVec of samples){
      const outVec=evalOut(inVec);
      // base = sample position placed on the INPUT axes only. (world3 also
      // applies output axes, which in field mode are the vector's direction
      // axes — applying them with a zero vector would wrongly zero the base.)
      const base3=[0,0,0];
      for(let k=0;k<inDim;k++){const a=inAx[k]; if(a>=0)base3[a]=inVec[k]??0;}
      // the field vector placed on its output axes (3-D), relative to base
      const v3=[0,0,0];
      for(let k=0;k<outDim;k++){const a=outAx[k]; if(a>=0)v3[a]=outVec[k]??0;}
      const m3=Math.hypot(v3[0],v3[1],v3[2]); if(m3>maxMag)maxMag=m3;
      let cval=0;
      if(useColor){ cval=outVec[colorIdx]??0; if(!isFinite(cval))cval=0; if(cval<cMin)cMin=cval; if(cval>cMax)cMax=cval; }
      raw.push({base3,v3,m3,cval});
    }
    maxMag=maxMag||1;
    const alen=resolveNum(tp.arrowLen,pscope,0.5);
    if(useColor){ if(tp.colorMin!==""&&tp.colorMin!=null)cMin=resolveNum(tp.colorMin,pscope,cMin); if(tp.colorMax!==""&&tp.colorMax!=null)cMax=resolveNum(tp.colorMax,pscope,cMax); }
    const cspan=(cMax-cMin)||1;
    const head=px(16), thick=px(2.6);
    const ab=ArrowBatch2D();
    for(const {base3,v3,m3,cval} of raw){
      if(m3<1e-9) continue;
      // length in 3-D world units: normalized → constant |L|; else scaled by |v|.
      const L=alen*(tp.normalize!==false?1:Math.min(1,m3/maxMag));
      const s=L/m3; // scale the true 3-D vector to that length
      const tip3=[base3[0]+v3[0]*s, base3[1]+v3[1]*s, base3[2]+v3[2]*s];
      // project base and tip; the on-screen arrow is their 2-D difference, which
      // is automatically foreshortened by the out-of-plane component.
      const b=projectPt(fr,base3[0],base3[1],base3[2]);
      const t=projectPt(fr,tip3[0],tip3[1],tip3[2]);
      const dx=t[0]-b[0], dy=t[1]-b[1];
      const screenLen=Math.hypot(dx,dy);
      if(screenLen<1e-9) continue; // points straight along the normal → no glyph
      // head length scales with the (foreshortened) on-screen length so nearly
      // edge-on arrows don't become all-head.
      const rgb=useColor?hexRGB(ramp((cval-cMin)/cspan)):null;
      ab.add(b[0],b[1],dx,dy,Math.min(head,screenLen*0.5),thick, rgb);
    }
    const mesh=ab.build(color);
    return mesh?[mesh]:[];
  }

  // ── GRAPH mode ──
  // 1-input → a projected curve.
  if(inDim===1){
    const samples=transformerSamples(tp,paramNode,pscope,1);
    const pts2d=samples.map(inVec=>{const w=place(inVec,evalOut(inVec)); return isFinite(w[0])&&isFinite(w[1])?w:null;});
    return buildThickLine2D(pts2d, color, px(LINE_PX)/2);
  }

  // 2-input → a real SURFACE, built as a solid projected quad grid (NOT a cloud
  // of scatter dots, which was both slow and visually wrong). This is what makes
  // a ripple surface render cheaply and correctly in the 2-D plane.
  if(inDim===2 && tp.domainSrc!=="param"){
    const res=Math.max(2,Math.min(300,Math.round(resolveNum(tp.res,pscope,40))));
    const aMin=resolveNum(tp.aMin,pscope,-5),aMax=resolveNum(tp.aMax,pscope,5);
    const bMin=resolveNum(tp.bMin,pscope,-5),bMax=resolveNum(tp.bMax,pscope,5);
    const xs=linspace(aMin,aMax,res), ys=linspace(bMin,bMax,res);
    const rows2=[];
    for(const y of ys){ const row=[]; for(const x of xs){ const w=place([x,y,0],evalOut([x,y,0])); row.push(isFinite(w[0])&&isFinite(w[1])?w:null); } rows2.push(row); }
    return buildFilledGrid2D(rows2, color);
  }

  // 2-input from a param domain, or 3-input volumes: fall back to a light
  // projected point sampling (kept sparse so it stays cheap).
  const samples=transformerSamples(tp,paramNode,pscope,inDim);
  const objs=[]; const r=px(2.2);
  for(const inVec of samples){
    const w=place(inVec,evalOut(inVec));
    if(isFinite(w[0])&&isFinite(w[1])) objs.push(buildDisk2D(w[0],w[1],r,color));
  }
  return objs;
}

// Sample-point generator shared by the transformer field/graph paths. Mirrors
// the 3-D sampler but stays modest in 2-D (caps resolution) for performance.
function transformerSamples(tp,paramNode,pscope,inDim){
  const samples=[];
  if(tp.domainSrc==="param"&&paramNode){
    const pp=paramNode.props||{};
    const deg=Math.max(1,Math.min(2,Math.round(Number(pp.degree||"1"))));
    if(deg>=2){
      const ur=Math.max(2,Math.min(200,resolveNum(pp.uRes,pscope,30))),vr=Math.max(2,Math.min(200,resolveNum(pp.vRes,pscope,20)));
      for(const v of linspace(resolveNum(pp.vMin,pscope,0),resolveNum(pp.vMax,pscope,Math.PI),vr))
        for(const u of linspace(resolveNum(pp.uMin,pscope,0),resolveNum(pp.uMax,pscope,Math.PI*2),ur))
          samples.push([safeEval(pp.exprXu,{...pscope,u,v})??0,safeEval(pp.exprYu,{...pscope,u,v})??0,safeEval(pp.exprZu,{...pscope,u,v})??0]);
    } else {
      const res=Math.max(2,Math.min(1200,resolveNum(pp.res,pscope,200)));
      for(const t of linspace(resolveNum(pp.tMin,pscope,0),resolveNum(pp.tMax,pscope,Math.PI*2),res))
        samples.push([safeEval(pp.exprX,{...pscope,t})??0,safeEval(pp.exprY,{...pscope,t})??0,safeEval(pp.exprZ,{...pscope,t})??0]);
    }
  } else {
    const res=Math.max(2,Math.min(inDim===1?8000:(inDim===2?300:16), Math.round(resolveNum(tp.res,pscope,inDim===1?300:16))));
    const aMin=resolveNum(tp.aMin,pscope,-5),aMax=resolveNum(tp.aMax,pscope,5);
    if(inDim===1){ for(const x of linspace(aMin,aMax,res)) samples.push([x,0,0]); }
    else {
      const bMin=resolveNum(tp.bMin,pscope,-5),bMax=resolveNum(tp.bMax,pscope,5);
      const xs=linspace(aMin,aMax,res), ys=linspace(bMin,bMax,res);
      if(inDim===2){ for(const y of ys) for(const x of xs) samples.push([x,y,0]); }
      else { const cMin=resolveNum(tp.cMin,pscope,-3),cMax=resolveNum(tp.cMax,pscope,3); for(const z of linspace(cMin,cMax,Math.min(res,8))) for(const x of xs) for(const y of ys) samples.push([x,y,z]); }
    }
  }
  return samples;
}

function build2DGlyphField(np, pscope, color, px, fr){
  // Mirror the 3-D glyph path: explicit parse honours the recursible color slot;
  // legacy projects fall back to the plain text parse with no per-glyph color.
  let pairs, gcols=null;
  if(np.__explicit){
    const r=parseGlyphsExplicit(np.__explicit, pscope);
    pairs=r.pairs;
    if(np.__useColor) gcols=rampColors(r.cols, np, pscope);
  } else {
    pairs=parseGlyphField(np.pairs||np.data, pscope);
  }
  const lenMode=np.lenMode||(np.normalize===false?"scaled":"uniform");
  const alen=resolveNum(np.arrowLen,pscope,0.5);
  let maxMag=0; for(const g of pairs){const m=Math.hypot(g.vec[0],g.vec[1],g.vec[2]||0);if(m>maxMag)maxMag=m;} maxMag=maxMag||1;
  const head=px(16);
  const thick=px(2.6);
  const ab=ArrowBatch2D();
  for(let gi=0;gi<pairs.length;gi++){
    const {pos,vec}=pairs[gi];
    const m=Math.hypot(vec[0],vec[1],vec[2]||0); if(m<1e-9) continue;
    const L=lenMode==="raw"?m:lenMode==="scaled"?alen*Math.min(1,m/maxMag):alen;
    const b=projectPt(fr,pos[0],pos[1],pos[2]||0);
    const tip=projectPt(fr,pos[0]+vec[0]/m*L,pos[1]+vec[1]/m*L,(pos[2]||0)+(vec[2]||0)/m*L);
    ab.add(b[0],b[1],tip[0]-b[0],tip[1]-b[1],Math.min(head,L*0.5),thick, gcols?gcols[gi]:null);
  }
  const mesh=ab.build(color);
  return mesh?[mesh]:[];
}

// Flow surface in a 2-D viewport. The trajectories are integrated in full 3-D
// and then orthographically PROJECTED onto the camera plane (`fr`). The surface
// is built as a SOLID quad grid (buildFilledGrid2D) so it: (a) is a solid color
// with no alpha, (b) never loses parts on self-intersection (each cell is
// independent — no boundary-polygon triangulation), and (c) can carry an
// optional wireframe overlay toggled by `np.showWire`.
function build2DFlow(np, rawNode, nodes, pscope, color, px, animVals, fr){
  let fnNode=null, seedNode=null;
  for(const depId of (rawNode.attachments||[])){
    const d=nodes[depId]; if(!d)continue;
    if(d.type==="fnMap"&&!fnNode)fnNode=d;
    else if((d.type==="paramSpace"||d.type==="points")&&!seedNode)seedNode=d;
  }
  if(!fnNode||!seedNode) return [];
  // fnMap field exprs and the seed source reference scalars wired into THOSE
  // nodes; evaluate each against its own direct scope (strict scoping).
  const av=animVals||{};
  const fieldSc={...pscope, ...resolveScope(fnNode.id,nodes,av)};
  const seedSc={...pscope, ...resolveScope(seedNode.id,nodes,av)};
  const steps=Math.max(2,Math.min(8000,resolveNum(np.steps,pscope,500)));
  const stepSize=resolveNum(np.stepSize,pscope,0.02);
  const field={exprX:fnNode.props.out0||"0",exprY:fnNode.props.out1||"0",exprZ:fnNode.props.out2||"0"};
  const seedInfo=seedNode.type==="points"
    ?{pts:parsePointsExplicit(seedNode.props,seedSc).pts,grid:false}
    :sampleParamSpace(seedNode,seedSc);
  const seeds=seedInfo.pts||[];
  const seedDeg=seedNode.type==="paramSpace"?Math.max(1,Math.min(2,Math.round(Number(seedNode.props.degree||"1")))):0;
  const wantSurface = seedDeg===1 && np.output!=="lines" && seeds.length>=2;

  const objs=[];
  if(wantSurface){
    // Build the trajectory grid once (rows[step][seedIndex] = [x,y,z]|null),
    // project every vertex onto the plane, then fill solid quads.
    const rows3=advectSeeds(field,seeds,steps,stepSize,fieldSc);
    if(rows3){
      const rows2=rows3.map(row=>projectPts(fr,row));
      objs.push(...buildFilledGrid2D(rows2, color));
      // Note: 2-D flow surfaces are SOLID only — never a wireframe in 2-D. The
      // wireframe toggle (np.showWire) applies to the 3-D viewport.
      return objs;
    }
    // fall through to streamlines if the sheet couldn't be stitched
  }
  // streamlines: one projected polyline per seed
  const half=px(LINE_PX)/2;
  for(const s of seeds){
    const traj=integrateFlow(s,field.exprX,field.exprY,field.exprZ,steps,stepSize,fieldSc);
    objs.push(...buildThickLine2D(projectPts(fr,traj), color, half));
  }
  return objs;
}

// ── main scene builder ────────────────────────────────────────────────────────
// Builds ONLY the plot geometry (curves, fills, arrows, points) as GPU objects.
// Grid, axes, and tick labels are drawn separately on the 2D overlay so they
// stay crisp and constant-size. `pxPerWorld` is the current pixels-per-world-unit
// scale; arrow heads and point disks use it so they keep a constant on-screen
// size as you zoom. Returns { plotObjs }.
// Cached 2-D scene build. `cache` is a Map(childId → {sig, objs}) the caller
// persists across frames. A plot is rebuilt only when its signature changes;
// otherwise the existing GPU objects are reused untouched. This mirrors the 3-D
// rebuild cache and is what keeps the 2-D viewport cheap while animators play or
// the user pans/zooms — only the plots that actually changed are regenerated.
//
// The signature includes:
//   • the shared geometry signature (geomSignature, folding wired nodes),
//   • the plane frame (so re-orienting the camera plane rebuilds projections),
//   • a zoom bucket (px-per-world) ONLY for types whose on-screen element size
//     is zoom-dependent (points/arrows/curve thickness): they must re-fit when
//     zoom changes, but a flow surface or filled graph must NOT,
//   • the view extents ONLY for view-filling types (fn1d / quiver2d), which
//     sample across the visible window; everything else ignores pan/zoom.
//
// Returns { plotObjs, dirty } — dirty=true if the object SET changed (caller
// must re-sync the scene graph), false if every plot was a cache hit.
function build2DScene(camNode, nodes, scope, animVals, wxMin, wxMax, wyMin, wyMax, theme, pxPerWorld, cache){
  const ppw = pxPerWorld || 40;
  const px = (targetPx)=> targetPx/ppw;
  const fr = planeFrame(camNode, scope);
  const frameSig = `${fr.O.join(",")}|${fr.U.join(",")}|${fr.V.join(",")}`;
  // Quantise zoom so tiny float wiggle doesn't thrash the cache; ~12 buckets per
  // power of 2 is visually smooth while still reusing geometry across small pans.
  const zoomBucket = Math.round(Math.log2(ppw)*12);
  // Coarse view key for view-filling plots (fn1d/quiver) — rounded so a 1px pan
  // doesn't rebuild, but a real domain shift does.
  const round=(v)=>{ const s=Math.max(1e-6,(wxMax-wxMin)); return Math.round(v/s*64); };
  const viewSig = `${round(wxMin)},${round(wxMax)},${round(wyMin)},${round(wyMax)}`;

  const plotObjs=[];
  const live=new Set();
  let dirty=false;

  const VIEW_FILLING=new Set(["fn1d","quiver2d"]);
  // Types whose element size is constant-on-screen (so zoom changes geometry).
  const ZOOM_SIZED=new Set(["fn1d","curve3d","pointSeq","points","point","quiver2d","quiver3d","glyphField","transformer"]);

  for(const childId of (camNode.attachments||[])){
    const rawNode=nodes[childId]; if(!rawNode) continue;
    if(catOf(rawNode.type)!=="plot") continue;
    const node=normalizedNode(rawNode);
    const pscope=resolveScope(childId,nodes,animVals||{});
    const dom=plotDomain(childId,nodes);
    const np=dom?applyDomain(node.props,node.type,dom):node.props;
    const color=rawNode.color||"#5b9cf6";

    // Build the per-plot signature: geometry + frame + (zoom?) + (view?).
    const gsig=plotSignature(node,np,pscope,nodes,animVals||{}) ?? `${node.type}|raw`;
    const t=rawNode.type==="transformer"||rawNode.type==="flow"?rawNode.type:node.type;
    const zPart=ZOOM_SIZED.has(t)?`|z${zoomBucket}`:"";
    const vPart=VIEW_FILLING.has(t)?`|v${viewSig}`:"";
    const sig=`${gsig}|fr${frameSig}${zPart}${vPart}|c${color}`;

    live.add(childId);
    const cached=cache.get(childId);
    if(cached && cached.sig===sig){
      // cache hit — reuse existing objects untouched
      for(const o of cached.objs) plotObjs.push(o);
      continue;
    }
    // miss — dispose old objects (if any) and rebuild this one plot
    if(cached){ for(const o of cached.objs){ o.geometry?.dispose?.(); (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m?.dispose?.()); } }
    dirty=true;

    let built=[];
    if(node.type==="fn1d") built=build2DFn1d(np,pscope,color,wxMin,wxMax,px,fr);
    else if(node.type==="curve3d") built=build2DCurve3d(np,pscope,color,px,fr);
    else if(node.type==="pointSeq"||node.type==="points") built=build2DPointSeq(np,pscope,color,px,fr);
    else if(node.type==="point") built=build2DPoint(np,pscope,color,px,fr);
    else if(node.type==="quiver2d") built=build2DQuiver(np,pscope,color,wxMin,wxMax,wyMin,wyMax,px,fr);
    else if(node.type==="quiver3d") built=build2DQuiver3d(np,pscope,color,px,fr);
    else if(rawNode.type==="transformer"){
      let fnNode=null,paramNode=null,eqNode=null;
      for(const depId of (rawNode.attachments||[])){ const d=nodes[depId]; if(!d)continue; if(d.type==="fnMap"&&!fnNode)fnNode=d; else if(d.type==="equation"&&!eqNode)eqNode=d; else if(d.type==="paramSpace"&&!paramNode)paramNode=d; }
      const av=animVals||{};
      const tScope={...pscope, ...(paramNode?resolveScope(paramNode.id,nodes,av):{}), ...(eqNode?resolveScope(eqNode.id,nodes,av):{}), ...(fnNode?resolveScope(fnNode.id,nodes,av):{})};
      if(eqNode) built=build2DImplicit(rawNode,eqNode,tScope,color,px,fr);
      else built=build2DTransformer(rawNode,fnNode,paramNode,tScope,color,wxMin,wxMax,wyMin,wyMax,px,fr);
    }
    else if(node.type==="glyphField") built=build2DGlyphField(np,pscope,color,px,fr);
    else if(rawNode.type==="flow") built=build2DFlow(np,rawNode,nodes,pscope,color,px,animVals||{},fr);
    else if(node.type==="plane"){
      const cx2=resolveNum(np.centerX,pscope,0),cy2=resolveNum(np.centerY,pscope,0),cz2=resolveNum(np.centerZ,pscope,0);
      const c=projectPt(fr,cx2,cy2,cz2);
      built=[buildDisk2D(c[0],c[1],px(4),color)];
    }

    for(const o of built) o._plotId=childId;
    cache.set(childId,{sig,objs:built});
    for(const o of built) plotObjs.push(o);
  }

  // dispose any cached plots no longer attached
  for(const [id,entry] of cache){
    if(live.has(id)) continue;
    for(const o of entry.objs){ o.geometry?.dispose?.(); (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m?.dispose?.()); }
    cache.delete(id); dirty=true;
  }

  return {plotObjs, dirty};
}

// ── 2D chrome rendering (split into two layers) ──────────────────────────────
// The grid + axes + background are drawn on a canvas BEHIND the WebGL layer, so
// plot curves and arrows always sit on top of the grid (the grid never occludes
// them). Number labels are drawn on a separate canvas ON TOP so they stay
// readable over everything. Both redraw from the live view each frame, keeping
// lines a crisp 1px and labels a fixed pixel size regardless of zoom.
//   view = {cx, cy, hh}  (world centre + half-height in world units)
//   W,H  = canvas pixel (CSS) size

function _viewMap(view, W, H){
  const hh=view.hh, hw=hh*(W/H||1);
  const wxMin=view.cx-hw, wxMax=view.cx+hw;
  const wyMin=view.cy-hh, wyMax=view.cy+hh;
  const sx=W/(wxMax-wxMin), sy=H/(wyMax-wyMin);
  return {
    wxMin,wxMax,wyMin,wyMax,
    toSx:(wx)=>(wx-wxMin)*sx,
    toSy:(wy)=>H-(wy-wyMin)*sy,
    // major grid spacing — span/6 gives a calmer, less dense grid than span/10
    gStep:nicestep(Math.max(wxMax-wxMin,wyMax-wyMin)/6),
  };
}

// BACKGROUND layer: clears to the viewport bg, then draws grid + axes.
function drawGrid2D(ctx, view, W, H, theme){
  if(!W||!H) return;
  const dpr=ctx._dpr||1;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const bg=theme.bg2d||"#07091a";
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  const {wxMin,wxMax,wyMin,wyMax,toSx,toSy,gStep}=_viewMap(view,W,H);
  const subStep=gStep/4; // coarser subgrid (was /5)

  const gridColor=theme.grid2d||"#181d32";
  const axisColor=theme.axes2d||"#283a6a";

  if(theme.__showGrid!==false){
    // minor grid (fainter)
    ctx.lineWidth=1; ctx.strokeStyle=gridColor; ctx.globalAlpha=0.3;
    ctx.beginPath();
    for(let gx=Math.ceil(wxMin/subStep)*subStep; gx<=wxMax; gx+=subStep){
      const px=Math.round(toSx(gx))+0.5; ctx.moveTo(px,0); ctx.lineTo(px,H);
    }
    for(let gy=Math.ceil(wyMin/subStep)*subStep; gy<=wyMax; gy+=subStep){
      const py=Math.round(toSy(gy))+0.5; ctx.moveTo(0,py); ctx.lineTo(W,py);
    }
    ctx.stroke();
    // major grid (brighter)
    ctx.globalAlpha=0.8; ctx.beginPath();
    for(let gx=Math.ceil(wxMin/gStep)*gStep; gx<=wxMax; gx+=gStep){
      const px=Math.round(toSx(gx))+0.5; ctx.moveTo(px,0); ctx.lineTo(px,H);
    }
    for(let gy=Math.ceil(wyMin/gStep)*gStep; gy<=wyMax; gy+=gStep){
      const py=Math.round(toSy(gy))+0.5; ctx.moveTo(0,py); ctx.lineTo(W,py);
    }
    ctx.stroke();
    ctx.globalAlpha=1;
  }

  if(theme.__showAxes!==false){
    ctx.strokeStyle=axisColor; ctx.lineWidth=1.5;
    const ax=Math.round(toSx(0))+0.5, ay=Math.round(toSy(0))+0.5;
    ctx.beginPath();
    if(ax>=0&&ax<=W){ ctx.moveTo(ax,0); ctx.lineTo(ax,H); }
    if(ay>=0&&ay<=H){ ctx.moveTo(0,ay); ctx.lineTo(W,ay); }
    ctx.stroke();
  }
}

// TOP layer: transparent, draws only the number labels.
function drawLabels2D(ctx, view, W, H, theme){
  if(!W||!H) return;
  const dpr=ctx._dpr||1;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,W,H);

  const {wxMin,wxMax,wyMin,wyMax,toSx,toSy,gStep}=_viewMap(view,W,H);
  const labelColor=theme.label2d||theme.axes2d||"#46527a";

  ctx.fillStyle=labelColor;
  ctx.font="11px ui-monospace, monospace";
  ctx.textBaseline="top";
  const axOnScreen=toSx(0), ayOnScreen=toSy(0);
  const labelY=Math.min(H-14, Math.max(2, ayOnScreen+3));
  const labelX=Math.min(W-32, Math.max(4, axOnScreen+3));
  ctx.textAlign="left";
  for(let gx=Math.ceil(wxMin/gStep)*gStep; gx<=wxMax; gx+=gStep){
    if(Math.abs(gx)<gStep*0.001) continue;
    const px=toSx(gx);
    if(px<14||px>W-4) continue;
    ctx.fillText(fmt(gx), px+2, labelY);
  }
  for(let gy=Math.ceil(wyMin/gStep)*gStep; gy<=wyMax; gy+=gStep){
    if(Math.abs(gy)<gStep*0.001) continue;
    const py=toSy(gy);
    if(py<6||py>H-12) continue;
    ctx.fillText(fmt(gy), labelX, py+2);
  }
  if(axOnScreen>14 && axOnScreen<W && ayOnScreen>0 && ayOnScreen<H-12){
    ctx.fillText("0", axOnScreen+3, Math.min(H-14, ayOnScreen+3));
  }
}

export { build2DScene, drawGrid2D, drawLabels2D, hexColor, nicestep, fmt };
