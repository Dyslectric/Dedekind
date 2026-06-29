import * as THREE from "three";
import { resolveNum, safeEval, makeFastEval, makeFastComplexEval, linspace } from "../core/math.js";
import { catOf } from "../core/taxonomy.js";
import { resolveScope, plotDomain, plotSignature } from "../core/scope.js";
import { applyDomain, pointGradientColors, rampColors } from "../geometry/rebuild.js";
import { parsePointSeq, parseGlyphField, parsePointsExplicit, parseGlyphsExplicit } from "../geometry/parse.js";
import { parseRawRows, sampleRawGeom } from "../geometry/builders.js";
import { integrateFlow, getTrajectories } from "../geometry/flow.js";
import { normalizedNode } from "../nodes/normalize.js";
import { sampleParamSpace } from "../geometry/transformer.js";
import { marchingSquares } from "../geometry/implicit.js";
import { hexToThree } from "../geometry/three-helpers.js";
import { exprToGLSL, GLSL_UNIFORM_PREFIX, fnTableFromScope, augmentScopeForGPU, complexExprToGLSL, _COMPLEX_HELPERS_GLSL, resolveUniformValue, setComplexScopeSyms } from "../geometry/glsl.js";
import { planeFrame, projectPt, projectPts } from "./project2d.js";
import { advectSeeds } from "../geometry/flow.js";

// ── helpers ──────────────────────────────────────────────────────────────────
function nicestep(r){ if(!r||!isFinite(r))return 1; const m=Math.pow(10,Math.floor(Math.log10(Math.abs(r)))); const f=r/m; return m*(f<2?1:f<5?2:5); }
// HSL→RGB (h in [0,1)); used for complex domain colouring in the 2-D viewport.
function hsl2rgb2d(h,s,l){ h=((h%1)+1)%1; const a=s*Math.min(l,1-l); const f=(n)=>{const k=(n+h*12)%12; return l-a*Math.max(-1,Math.min(k-3,9-k,1));}; return [f(0),f(8),f(4)]; }
// Domain colour of a complex value w, matching the GPU shader and _glowColorExprs.
// glow=true: white core at zeros, R/G/B halo by phase, fading with |w|.
// glow=false: classic hue=arg, lightness rising with |w| (zeros dark).
function domainColor2d(re, im, glow){
  if(glow){
    const M=Math.hypot(re,im), A=Math.atan2(im,re);
    const wR=Math.pow(0.5+0.5*Math.cos(A),3), wG=Math.pow(0.5+0.5*Math.cos(A-2.0944),3), wB=Math.pow(0.5+0.5*Math.cos(A-4.18879),3);
    const den=wR+wG+wB+1e-6, hR=wR/den,hG=wG/den,hB=wB/den;
    const b=0.6/(0.6+M), s=M/(M+0.14);
    return [b*(1-s*(1-hR)), b*(1-s*(1-hG)), b*(1-s*(1-hB))];
  }
  const mod=Math.hypot(re,im), hue=Math.atan2(im,re)/(2*Math.PI), l=1-1/(1+mod*0.5);
  return hsl2rgb2d(hue,0.95,0.12+0.76*l);
}
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
// Build the triangle ribbon for ONE polyline into the shared `pos` array. No new
// mesh/material per line — the caller merges every run into a single geometry.
// Round-join fans are emitted ONLY where the direction turns sharply; for the
// near-collinear vertices of a smooth streamline (the overwhelmingly common case)
// the segment quads alone read as a clean continuous line, which removes the bulk
// of the triangles the old per-vertex fan produced.
const JOIN_ANGLE_MIN = 0.35; // radians (~20°); below this, skip the join fan
function appendRibbon(pos, run, half){
  const n=run.length; if(n<2) return;
  const pushTri=(a,b,c)=>{ pos.push(a[0],a[1],0, b[0],b[1],0, c[0],c[1],0); };
  const JOIN_SEGS=4;
  const fan=(c,a0,a1)=>{
    let d=a1-a0; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI;
    const steps=Math.max(1,Math.ceil(Math.abs(d)/(Math.PI/JOIN_SEGS)));
    let prev=[c[0]+Math.cos(a0)*half, c[1]+Math.sin(a0)*half];
    for(let k=1;k<=steps;k++){
      const a=a0+d*(k/steps);
      const cur=[c[0]+Math.cos(a)*half, c[1]+Math.sin(a)*half];
      pushTri(c, prev, cur); prev=cur;
    }
  };
  let prevAngN=null, prevValid=false;
  for(let i=0;i<n-1;i++){
    const p=run[i], q=run[i+1];
    const dx=q[0]-p[0], dy=q[1]-p[1];
    const l=Math.hypot(dx,dy);
    if(l<1e-12) continue;
    const ux=dx/l, uy=dy/l, nx=-uy, ny=ux;
    const hx=nx*half, hy=ny*half;
    const p1=[p[0]+hx,p[1]+hy], p2=[p[0]-hx,p[1]-hy];
    const q1=[q[0]+hx,q[1]+hy], q2=[q[0]-hx,q[1]-hy];
    pushTri(p1,q1,q2); pushTri(p1,q2,p2);
    const angN=Math.atan2(ny,nx);
    if(prevValid){
      // only fan the joint when the turn is sharp enough to leave a visible notch
      let d=angN-prevAngN; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI;
      if(Math.abs(d) > JOIN_ANGLE_MIN){
        fan(p, prevAngN, angN);
        fan(p, prevAngN+Math.PI, angN+Math.PI);
      }
    }
    prevAngN=angN; prevValid=true;
  }
}

// Build a SINGLE merged mesh for all polylines (split on NaN gaps). One geometry,
// one material, one draw call — instead of one mesh per trajectory.
function buildThickLine2D(pts2d, color, half, opacity=1){
  const pos=[]; let cur=[];
  const flush=()=>{ if(cur.length>1) appendRibbon(pos, cur, half); cur=[]; };
  for(const p of pts2d){
    if(p&&isFinite(p[0])&&isFinite(p[1])) cur.push(p);
    else flush();
  }
  flush();
  if(!pos.length) return [];
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  const mat=new THREE.MeshBasicMaterial({color:hexToThree(color),depthTest:false,side:THREE.DoubleSide,transparent:opacity<1,opacity});
  return [new THREE.Mesh(g,mat)];
}

// Build many trajectories into ONE merged mesh. Used by the flow renderer so a
// 64-streamline plot is a single draw call, not 64. Each trajectory is a separate
// run (no connecting segment between them).
function buildMergedStreamlines2D(trajs2d, color, half, opacity=1){
  const pos=[];
  for(const run of trajs2d){
    const clean=run.filter(p=>p&&isFinite(p[0])&&isFinite(p[1]));
    if(clean.length>1) appendRibbon(pos, clean, half);
  }
  if(!pos.length) return [];
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  const mat=new THREE.MeshBasicMaterial({color:hexToThree(color),depthTest:false,side:THREE.DoubleSide,transparent:opacity<1,opacity});
  return [new THREE.Mesh(g,mat)];
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
  // Compile once, reuse across all samples (mutate one scope) — see makeFastEval.
  const sc={}; for(const k in pscope){ if(k!=="pi"&&k!=="e"&&k!=="i") sc[k]=pscope[k]; }
  const fn=makeFastEval(np.expr,{...sc,x:0});
  const xs=linspace(xMin,xMax,res); const pts=new Array(res);
  for(let i=0;i<res;i++){ sc.x=xs[i]; const y=fn?fn(sc):null; pts[i]=(y!=null&&isFinite(y))?[xs[i],y,0]:null; }
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

// Position cache for point sequences. Parsing a sequence (especially a long
// recurrence) is O(count) mathjs evaluations; the result depends on the formula
// and scope but NOT on zoom. We key a cache on the position-relevant fields so a
// zoom (which only changes on-screen radius) reuses the parsed positions/colors
// and rebuilds just the disk sprites. Without this, zooming a 4000-point orbit
// re-ran the whole recurrence every wheel tick.
const _ptPosCache = new Map();
function _ptPosSig(np, pscope){
  // only the fields that affect positions/colors, plus the scope values they read
  const f = [np.__explicit?JSON.stringify(np.__explicit):"", np.points||np.data||"",
    np.radius, np.drawLines, np.__useColor, np.colorMode, np.colorExpr, np.colorLo, np.colorHi,
    np.colorMin, np.colorMax].join("|");
  // include any scope scalars the formulas reference (cheap: stringify the scope's
  // numeric entries; scopes here are small)
  let sc=""; for(const k in pscope){ const v=pscope[k]; if(typeof v==="number") sc+=k+"="+v+";"; }
  return f+"#"+sc;
}
function build2DPointSeq(np, pscope, color, px, fr, cacheKey){
  const posSig=_ptPosSig(np, pscope);
  let cachedPos = cacheKey!=null ? _ptPosCache.get(cacheKey) : null;
  let pts, cols;
  if(cachedPos && cachedPos.sig===posSig){
    pts=cachedPos.pts; cols=cachedPos.cols;
  } else {
    // Parse positions (and the per-point color slot) the same way the 3-D renderer
    // does: prefer the explicit dropdown-authored parse so the recursible color
    // slot is honoured; fall back to the legacy text parse for old projects.
    if(np.__explicit){
      const r=parsePointsExplicit(np.__explicit, pscope);
      pts=r.pts;
      cols = np.__useColor ? rampColors(r.cols, np, pscope) : pointGradientColors(pts, np, pscope);
    } else {
      pts=parsePointSeq(np.points||np.data, pscope);
      cols=pointGradientColors(pts, np, pscope);
    }
    if(cacheKey!=null){
      _ptPosCache.set(cacheKey, {sig:posSig, pts, cols});
      if(_ptPosCache.size>64){ const first=_ptPosCache.keys().next().value; _ptPosCache.delete(first); }
    }
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
  // All point disks render as ONE InstancedMesh of a shared unit-circle geometry,
  // scaled to the on-screen radius and placed per point. This collapses what used
  // to be one THREE.Mesh per point (thousands of draw calls + geometries on a big
  // orbit) into a single draw call, so zoom/pan stay smooth even at 4000+ points.
  const nPts=proj.length;
  if(nPts>0){
    const unit=_unitDiskGeo();
    const useCol = !!cols;
    const mat=new THREE.MeshBasicMaterial({color: useCol?0xffffff:hexToThree(color), depthTest:false});
    const inst=new THREE.InstancedMesh(unit, mat, nPts);
    const m=new THREE.Matrix4();
    for(let i=0;i<nPts;i++){
      const [u,v]=proj[i];
      m.makeScale(r,r,1); m.setPosition(u,v,0);
      inst.setMatrixAt(i,m);
      if(useCol){
        const c=cols[i];
        const col = c==null ? new THREE.Color(hexToThree(color))
          : Array.isArray(c) ? new THREE.Color(c[0],c[1],c[2])
          : new THREE.Color(hexToThree(c));
        inst.setColorAt(i, col);
      }
    }
    inst.instanceMatrix.needsUpdate=true;
    if(inst.instanceColor) inst.instanceColor.needsUpdate=true;
    inst.frustumCulled=false;
    objs.push(inst);
  }
  return objs;
}

// Shared unit-radius disk geometry for instanced 2D points (built once, reused).
let _unitDisk=null;
function _unitDiskGeo(){
  if(_unitDisk) return _unitDisk;
  const N=12, pts=[];
  for(let i=0;i<=N;i++){ const a=i/N*Math.PI*2; pts.push(new THREE.Vector2(Math.cos(a),Math.sin(a))); }
  _unitDisk=new THREE.ShapeGeometry(new THREE.Shape(pts));
  return _unitDisk;
}

function build2DPoint(np, pscope, color, px, fr){
  const x=resolveNum(np.x,pscope,0), y=resolveNum(np.y,pscope,0), z=resolveNum(np.z,pscope,0);
  const [u,v]=projectPt(fr,x,y,z);
  return [buildDisk2D(u,v,px(5),color)];
}

// rawGeom in 2D: sample the primitives (list or index mode) and project each onto
// the camera plane, with optional per-vertex colors. Points → disks, segments →
// thick segments, glyphs → arrow segments, triangles → filled projected tris.
function build2DRawGeom(np, pscope, color, px, fr){
  const prim=np.prim||"points";
  const { verts, cols, rgb, alpha } = sampleRawGeom(np, prim, pscope);
  if(!verts.length) return [];
  // Per-vertex color groups as hex. From rgb three-parameter mode directly, or by
  // ramping the scalar groups.
  let rampGroups=null;
  const toHexRGB=(c)=>{const h=k=>{const x=Math.round(Math.max(0,Math.min(1,c[k]))*255);return(x<16?"0":"")+x.toString(16);};return`#${h(0)}${h(1)}${h(2)}`;};
  if(rgb){
    rampGroups=rgb.map(g=>g.map(toHexRGB));
  } else if(cols){
    const flat=[]; for(const g of cols) for(const cv of g) flat.push(cv);
    let mn=(np.colorMin!==""&&np.colorMin!=null)?resolveNum(np.colorMin,pscope,0):Math.min(...flat);
    let mx=(np.colorMax!==""&&np.colorMax!=null)?resolveNum(np.colorMax,pscope,1):Math.max(...flat);
    if(!isFinite(mn))mn=0; if(!isFinite(mx))mx=1; const span=(mx-mn)||1;
    const lo=hexRGB(np.colorLo||"#3a6aff"), hi=hexRGB(np.colorHi||"#ff5ea8");
    const toHex=(cv)=>{let t=(cv-mn)/span;t=t<0?0:t>1?1:t;const h=k=>{const x=Math.round((lo[k]+(hi[k]-lo[k])*t)*255);return(x<16?"0":"")+x.toString(16);};return`#${h(0)}${h(1)}${h(2)}`;};
    rampGroups=cols.map(g=>g.map(toHex));
  }
  // mean alpha → applied as material opacity on the 2D meshes
  let meanAlpha=1;
  if(alpha){ let s=0,c=0; for(const g of alpha) for(const a of g){ s+=a; c++; } meanAlpha=c?s/c:1; }
  const applyA=(objs)=>{ if(alpha) for(const o of objs){ if(o&&o.material){ o.material.transparent=true; o.material.opacity=(o.material.opacity??1)*meanAlpha; } } return objs; };

  if(prim==="points"){
    // radius is in PIXELS (constant on-screen size), matching the points node this
    // primitive replaced — px() maps it to world units at the current zoom. (The
    // old build2DPointSeq used radius directly as px with default 4.)
    const r=px(resolveNum(np.radius,pscope,4));
    const objs=verts.map((v,i)=>{ const [u,vv]=projectPt(fr,v[0][0],v[0][1],v[0][2]); return buildDisk2D(u,vv,r,rampGroups?rampGroups[i][0]:color); });
    if(np.drawLines===true){ const proj=verts.map(v=>projectPt(fr,v[0][0],v[0][1],v[0][2])); objs.unshift(...buildThickLine2D(proj,color,px(LINE_PX)/2)); }
    return applyA(objs);
  }
  if(prim==="segments"){
    const segs=verts.map(([a,b])=>[projectPt(fr,a[0],a[1],a[2]), projectPt(fr,b[0],b[1],b[2])]);
    // width as pixels (constant on screen) or world units (scales with zoom)
    const half = np.lineMode==="world"
      ? resolveNum(np.lineWidth,pscope,0.04)/2
      : px(resolveNum(np.lineWidth,pscope,LINE_PX))/2;
    // per-endpoint colors → Gouraud quad strip per segment when colored
    if(rampGroups) return applyA(buildGouraudSegments2D(segs, rampGroups, half));
    return applyA(buildThickSegments2D(segs, color, half));
  }
  if(prim==="glyphs"){
    const norm=np.normalize===true, scale=resolveNum(np.arrowLen,pscope,0.5);
    const segs=[];
    for(const [pos,vec] of verts){
      const mag=Math.hypot(vec[0],vec[1],vec[2])||1;
      const s = norm ? scale/mag : 1;
      const tip=[pos[0]+vec[0]*s, pos[1]+vec[1]*s, pos[2]+vec[2]*s];
      segs.push([projectPt(fr,pos[0],pos[1],pos[2]), projectPt(fr,tip[0],tip[1],tip[2])]);
    }
    if(rampGroups) return applyA(buildGouraudSegments2D(segs, rampGroups, px(LINE_PX)/2));
    return applyA(buildThickSegments2D(segs, color, px(LINE_PX)/2));
  }
  // triangles → filled projected tris, with optional per-vertex vertex colors
  const tpos=[], tcol=rampGroups?[]:null;
  for(let t=0;t<verts.length;t++){
    const [a,b,c]=verts[t];
    const pa=projectPt(fr,a[0],a[1],a[2]), pb=projectPt(fr,b[0],b[1],b[2]), pc=projectPt(fr,c[0],c[1],c[2]);
    if(!pa||!pb||!pc) continue;
    tpos.push(pa[0],pa[1],0, pb[0],pb[1],0, pc[0],pc[1],0);
    if(rampGroups){ for(let m=0;m<3;m++){ const rgbv=hexRGB(rampGroups[t][m]); tcol.push(rgbv[0],rgbv[1],rgbv[2]); } }
  }
  if(!tpos.length) return [];
  const g=new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tpos,3));
  let mat;
  if(tcol){ g.setAttribute("color", new THREE.Float32BufferAttribute(tcol,3)); mat=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,depthTest:false,depthWrite:false,transparent:true,opacity:0.82}); }
  else mat=new THREE.MeshBasicMaterial({color:hexToThree(color),side:THREE.DoubleSide,depthTest:false,depthWrite:false,transparent:true,opacity:0.82});
  return applyA([new THREE.Mesh(g,mat)]);
}

// A set of thick 2D segments with per-endpoint colors, built as colored quads so
// the color interpolates along each segment (Gouraud). cols is [ [hexA,hexB], … ].
function buildGouraudSegments2D(segs, cols, half){
  const pos=[], col=[];
  for(let s=0;s<segs.length;s++){
    const [a,b]=segs[s]; if(!a||!b) continue;
    const dx=b[0]-a[0], dy=b[1]-a[1]; const len=Math.hypot(dx,dy); if(len<1e-9) continue;
    const nx=-dy/len*half, ny=dx/len*half;
    const a1=[a[0]+nx,a[1]+ny], a2=[a[0]-nx,a[1]-ny], b1=[b[0]+nx,b[1]+ny], b2=[b[0]-nx,b[1]-ny];
    const ca=hexRGB(cols[s][0]||"#ffffff"), cb=hexRGB(cols[s][1]||"#ffffff");
    const push=(p,c)=>{ pos.push(p[0],p[1],0); col.push(c[0],c[1],c[2]); };
    push(a1,ca); push(b1,cb); push(b2,cb);
    push(a1,ca); push(b2,cb); push(a2,ca);
  }
  if(!pos.length) return [];
  const g=new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col,3));
  const mat=new THREE.MeshBasicMaterial({vertexColors:true,depthTest:false,side:THREE.DoubleSide});
  return [new THREE.Mesh(g,mat)];
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


// GPU 2D implicit curve. Instead of marching squares on the CPU (which re-runs
// every frame a slider moves), we draw a quad covering the domain and let a
// fragment shader evaluate F(a,b) = lhs − rhs per pixel, shading an antialiased
// band where F crosses zero. The curve width is kept constant in screen space
// via fwidth (screen-space derivative of F), which also naturally fades the line
// where the gradient is steep. Slider-driven coefficients are uniforms, so a drag
// updates a uniform rather than rebuilding geometry. Returns null when the
// expression can't be transpiled to GLSL (caller falls back to marching squares).
function build2DImplicitGPU(tNode, eqNode, pscope, color, fr){
  const p=eqNode.props||{};
  const varA=(p.varA||"x").trim()||"x", varB=(p.varB||"y").trim()||"y";
  const fExpr=`(${p.lhs??"0"}) - (${p.rhs??"0"})`;
  const uniforms=new Set();
  // fnDefs wired into the equation are inlined, so a composed 2D implicit curve
  // renders on the GPU too.
  const fnTable=fnTableFromScope(pscope);
  const ascope=fnTable?augmentScopeForGPU(pscope):pscope;
  // map the equation's two plane variables to the shader's a,b coords
  const g=exprToGLSL(fExpr, new Set([varA,varB]), uniforms, GLSL_UNIFORM_PREFIX, fnTable);
  if(g==null) return null;
  // composed curve: bail to marching squares if an inlined scalar can't resolve
  if(fnTable){ for(const u of uniforms){ if(!(varA===u||varB===u) && !Number.isFinite(Number(ascope[u]))) return null; } }
  // rename varA/varB to the shader locals a,b (exprToGLSL emits them verbatim)
  // We declare them as the function params below, so just guard reserved names.
  const tp=tNode.props||{};
  const aMin=resolveNum(tp.aMin,pscope,-5), aMax=resolveNum(tp.aMax,pscope,5);
  const bMin=resolveNum(tp.bMin,pscope,-5), bMax=resolveNum(tp.bMax,pscope,5);

  // quad geometry in the camera plane: 4 corners at the domain box, world-placed
  // through the same projectPt the rest of the 2D renderer uses.
  const corners=[[aMin,bMin],[aMax,bMin],[aMax,bMax],[aMin,bMax]];
  const wpos=[]; const apos=[];
  for(const [a,b] of corners){ const [u,v]=projectPt(fr,a,b,0); wpos.push(u,v,0); apos.push(a,b); }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(wpos,3));
  geo.setAttribute("ab", new THREE.Float32BufferAttribute(apos,2));
  geo.setIndex([0,1,2, 0,2,3]);

  const uobj={ uColor:{value:new THREE.Color(hexToThree(color))} };
  // exclude the two plane variables (they're function params, not uniforms)
  const planeVars=new Set([varA,varB]);
  for(const u of uniforms){ if(!planeVars.has(u)) uobj[GLSL_UNIFORM_PREFIX+u]={value:Number(ascope[u])||0}; }
  const decls=[...uniforms].filter(u=>!planeVars.has(u)).map(u=>`uniform float ${GLSL_UNIFORM_PREFIX}${u};`).join("\n");
  const vert=`
    attribute vec2 ab; varying vec2 vAb;
    void main(){ vAb=ab; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  // Declare the field function's parameters with the equation's OWN variable names
  // (varA/varB, e.g. x and y) so the transpiled expression's identifiers resolve.
  const frag=`precision highp float;
    ${decls}
    uniform vec3 uColor; varying vec2 vAb;
    float _dedekind_field_(float ${varA}, float ${varB}){ return ${g}; }
    void main(){
      float f=_dedekind_field_(vAb.x, vAb.y);
      // screen-space gradient magnitude of f → constant-width line
      float w=fwidth(f);
      if(w<1e-12){ discard; }
      float d=abs(f)/w;            // distance to the zero set in pixels
      float alpha=1.0 - smoothstep(0.75, 1.75, d);  // ~1.5px line, antialiased
      if(alpha<=0.003) discard;
      gl_FragColor=vec4(uColor, alpha);
    }`;
  const mat=new THREE.ShaderMaterial({uniforms:uobj,vertexShader:vert,fragmentShader:frag,
    transparent:true,depthTest:false,side:THREE.DoubleSide,extensions:{derivatives:true}});
  mat._uniformNames=[...uniforms].filter(u=>!planeVars.has(u));
  const mesh=new THREE.Mesh(geo,mat);
  mesh.frustumCulled=false;
  mesh.renderOrder=2;
  return [mesh];
}

function build2DImplicit(tNode, eqNode, pscope, color, px, fr){
  // 3D implicit surfaces require a 3D camera; nothing meaningful to draw in 2D.
  if((eqNode.props.dims||"2d")==="3d") return [];
  // Prefer the GPU shader path; fall back to CPU marching squares if the
  // expression can't be transpiled to GLSL.
  const gpu=build2DImplicitGPU(tNode, eqNode, pscope, color, fr);
  if(gpu) return gpu;
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

  // ── ℂ→ℂ map in the 2-D viewport → domain colouring over the VISIBLE plane.
  // The 2-D plane is exactly the complex input plane, so we paint the window
  // (camera-follow): hue = arg f, brightness = |f|. Other complex sub-modes are
  // surfaces (3-D) and fall through to the flat domain picture here.
  if((fnNode.props.field||"real")==="complex" && inDim===1 && outDim===1){
    // ── GPU fast path: evaluate f(z) per fragment over a window-covering quad ──
    // The whole picture is one quad with a fragment shader that computes f(z) and
    // maps it to the domain colour, so pan/zoom is free (no CPU re-sampling).
    // Falls back to the CPU grid below if f can't transpile to complex GLSL.
    {
      const fnTable=fnTableFromScope(pscope);             // (no fnDef inlining in complex GLSL yet)
      const uniforms=new Set();
      setComplexScopeSyms(pscope);                          // complex sliders → re_/im_ uniforms
      const gz=fnTable? null : complexExprToGLSL(outs[0], uniforms, GLSL_UNIFORM_PREFIX);
      const ascope=pscope;
      const uniResolvable = gz!=null && [...uniforms].every(u=>Number.isFinite(resolveUniformValue(u,ascope)));
      if(gz!=null && uniResolvable){
        // quad spanning the visible window, placed directly in plane (u,v) space.
        const wpos=[wxMin,wyMin,0, wxMax,wyMin,0, wxMax,wyMax,0, wxMin,wyMax,0];
        const ab=[wxMin,wyMin, wxMax,wyMin, wxMax,wyMax, wxMin,wyMax];
        const geo=new THREE.BufferGeometry();
        geo.setAttribute("position",new THREE.Float32BufferAttribute(wpos,3));
        geo.setAttribute("ab",new THREE.Float32BufferAttribute(ab,2));
        geo.setIndex([0,1,2, 0,2,3]);
        const uobj={};
        for(const u of uniforms) uobj[GLSL_UNIFORM_PREFIX+u]={value:resolveUniformValue(u,ascope)};
        const decls=[...uniforms].map(u=>`uniform float ${GLSL_UNIFORM_PREFIX}${u};`).join("\n");
        const glow = (tp.domainStyle||"standard")==="glow";
        const vert=`attribute vec2 ab; varying vec2 vAb;
          void main(){ vAb=ab; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
        const colorBody = glow
          // Glow scheme (matches _glowColorExprs): white core at each zero, a
          // saturated R/G/B halo by phase, brightness fading as |f| grows.
          ? `float M=length(w); float A=atan(w.y,w.x);
             float wR=pow(0.5+0.5*cos(A),3.0);
             float wG=pow(0.5+0.5*cos(A-2.0944),3.0);
             float wB=pow(0.5+0.5*cos(A-4.18879),3.0);
             float den=wR+wG+wB+1e-6;
             vec3 hue=vec3(wR,wG,wB)/den;
             float b=0.6/(0.6+M);
             float s=M/(M+0.14);
             gl_FragColor=vec4(b*(vec3(1.0)-s*(vec3(1.0)-hue)),1.0);`
          // Standard scheme: hue = arg f, lightness rising with |f| (zeros dark).
          : `float mod=length(w);
             float hue=atan(w.y,w.x)/6.283185307179586;
             float l=1.0-1.0/(1.0+mod*0.5);
             gl_FragColor=vec4(_hsl(hue,0.95,0.12+0.76*l),1.0);`;
        const frag=`precision highp float;
          ${decls}
          varying vec2 vAb;
          ${_COMPLEX_HELPERS_GLSL}
          vec3 _hsl(float h,float s,float l){ h=fract(h); float a=s*min(l,1.0-l);
            vec3 k=mod(vec3(0.0,8.0,4.0)+h*12.0,12.0);
            return vec3(l)-a*max(-vec3(1.0),min(min(k-3.0,9.0-k),vec3(1.0))); }
          vec2 _f(vec2 _z){ return ${gz}; }
          void main(){
            vec2 w=_f(vAb);
            ${colorBody}
          }`;
        const mat=new THREE.ShaderMaterial({uniforms:uobj,vertexShader:vert,fragmentShader:frag,
          side:THREE.DoubleSide,depthTest:false,depthWrite:false});
        mat._uniformNames=[...uniforms];
        const mesh=new THREE.Mesh(geo,mat); mesh.frustumCulled=false;
        mesh._domainQuad=true;   // hit path moves the 4 corners on pan/zoom; no rebuild
        return [mesh];
      }
    }
    // ── CPU fallback: sample f(z) on a grid (kept for non-transpilable maps) ──
    const sc={}; for(const k in pscope){ if(k!=="pi"&&k!=="e"&&k!=="i") sc[k]=pscope[k]; }
    const fn=makeFastComplexEval(outs[0], {...sc, re:0, im:0});
    if(!fn) return [];
    // resolution across the visible window; keep affordable
    const N=Math.max(16, Math.min(180, Math.round(resolveNum(tp.res,pscope,120))));
    const reVals=linspace(wxMin,wxMax,N), imVals=linspace(wyMin,wyMax,N);
    const pos=[], col=[], idx=[];
    for(let j=0;j<N;j++){
      sc.im=imVals[j];
      for(let i=0;i<N;i++){
        sc.re=reVals[i];
        const w=fn(sc);
        // reVals/imVals already span the visible window in the camera PLANE's own
        // (u,v) coordinates, so they ARE the screen-plane position — projecting
        // them back through the frame as a world (re,0,im) point dropped the
        // imaginary axis under the default +Z camera (v collapsed to 0, the whole
        // picture flattened to a line). Place them directly.
        pos.push(reVals[i], imVals[j], 0);
        if(w){ const c=domainColor2d(w.re, w.im, (tp.domainStyle||"standard")==="glow"); col.push(c[0],c[1],c[2]); }
        else col.push(0.12,0.12,0.15);
      }
    }
    for(let j=0;j<N-1;j++)for(let i=0;i<N-1;i++){ const a=j*N+i,b=j*N+i+1,c=(j+1)*N+i,d=(j+1)*N+i+1; idx.push(a,b,c,b,d,c); }
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute("color",new THREE.Float32BufferAttribute(col,3));
    g.setIndex(idx);
    const mat=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,depthTest:false,depthWrite:false});
    return [new THREE.Mesh(g,mat)];
  }

  const AX={x:0,y:1,z:2,none:-1};
  const inAx=[tp.inAxis0,tp.inAxis1,tp.inAxis2].map(a=>AX[a??"none"]);
  const outAx=[tp.outAxis0,tp.outAxis1,tp.outAxis2,tp.outAxis3].map(a=>AX[a??"none"]);
  // Hot-path evaluation: compile each output expression ONCE and reuse it across
  // every sample, mutating a single shared scope object instead of building a
  // fresh {...pscope,x,y,z,w} per point and re-compiling per point (safeEval).
  // For a 2000-sample camera-follow graph this is ~15x faster — the difference
  // between dropping frames while panning and staying smooth. The reusable scope
  // is pre-stripped of pi/e/i so a user binding can't shadow the constants (the
  // shield safeEval would otherwise run per call).
  const _evalScope = {};
  for(const k in pscope){ if(k!=="pi"&&k!=="e"&&k!=="i") _evalScope[k]=pscope[k]; }
  const _field = fnNode.props.field || "real";
  const _compiledOuts = outs.map(e=>makeFastEval(e, {..._evalScope, x:0, y:0, z:0, w:0}, false, _field));
  const evalOut=(inVec)=>{
    _evalScope.x=inVec[0]??0; _evalScope.y=inVec[1]??0; _evalScope.z=inVec[2]??0; _evalScope.w=inVec[3]??0;
    const r=new Array(outDim);
    for(let k=0;k<outDim;k++){ const fn=_compiledOuts[k]; const v=fn?fn(_evalScope):null; r[k]=(v==null||!isFinite(v))?0:v; }
    return r;
  };
  // Resolve the colour source (new colorSource model, legacy outAxis="color"
  // fallback). colorVal(outVec) → scalar | null when colouring is off.
  const _cs=(()=>{
    const cs=tp.colorSource;
    if(cs==null||cs===""){
      for(let k=0;k<outDim;k++){ if((tp[`outAxis${k}`]||"")==="color") return {kind:"out",idx:k}; }
      // legacy colorMode="gradient": colorExpr scalar, or last output
      if((tp.colorMode||"")==="gradient"){
        if(tp.colorExpr!=null && String(tp.colorExpr).trim()!=="") return {kind:"expr"};
        return {kind:"out",idx:Math.max(0,outDim-1)};
      }
      return {kind:"none"};
    }
    if(cs==="none") return {kind:"none"};
    if(cs==="magnitude") return {kind:"magnitude"};
    if(cs==="expr") return {kind:"expr"};
    const m=/^out(\d+)$/.exec(cs); if(m) return {kind:"out",idx:Math.min(outDim-1,Math.max(0,+m[1]))};
    return {kind:"none"};
  })();
  const useColor=_cs.kind!=="none";
  const _colorExprFn = _cs.kind==="expr" ? makeFastEval(tp.colorExpr||"0", {..._evalScope,x:0,y:0,z:0,w:0,out0:0,out1:0,out2:0,out3:0,n:0}, true) : null;
  const colorVal=(inVec,outVec,n)=>{
    if(_cs.kind==="out"){ const v=outVec[_cs.idx]; return (v==null||!isFinite(v))?0:v; }
    if(_cs.kind==="magnitude"){ let s=0; for(const v of outVec){ if(isFinite(v)) s+=v*v; } return Math.sqrt(s); }
    if(_cs.kind==="expr" && _colorExprFn){ const sc={..._evalScope}; const inN=["x","y","z","w"]; for(let k=0;k<inVec.length;k++) sc[inN[k]]=inVec[k]; for(let k=0;k<outVec.length;k++) sc[`out${k}`]=outVec[k]; sc.n=n; const v=_colorExprFn(sc); return (v==null||!isFinite(v))?0:v; }
    return 0;
  };
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
      if(useColor){ cval=colorVal(inVec,outVec,raw.length); if(!isFinite(cval))cval=0; if(cval<cMin)cMin=cval; if(cval>cMax)cMax=cval; }
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

  // ── POLAR mode ──
  // Input is read as angle θ, the first output as radius r; plot (r cosθ, r sinθ)
  // in the ground plane, then project. Without this, a polar transformer fell
  // through to the graph path and drew (θ, r) — i.e. looked just like a function.
  if(tp.mode==="polar" && inDim===1){
    const samples=transformerSamples(tp,paramNode,pscope,1);
    const pts2d=samples.map(inVec=>{
      const th=inVec[0]??0, r=evalOut(inVec)[0]??0;
      const w=projectPt(fr, r*Math.cos(th), r*Math.sin(th), 0);
      return isFinite(w[0])&&isFinite(w[1])?w:null;
    });
    return buildThickLine2D(pts2d, color, px(LINE_PX)/2);
  }

  // ── SPHERICAL mode ──
  // Two inputs are angles θ,φ, the first output a radius r → spherical point,
  // projected onto the plane. (Spherical is naturally 3-D; in a 2-D view this is
  // its orthographic shadow.)
  if(tp.mode==="spherical" && inDim===2){
    const res=Math.max(2,Math.min(160,Math.round(resolveNum(tp.res,pscope,40))));
    const aMin=resolveNum(tp.aMin,pscope,0),aMax=resolveNum(tp.aMax,pscope,6.2832);
    const bMin=resolveNum(tp.bMin,pscope,0),bMax=resolveNum(tp.bMax,pscope,3.14159);
    const xs=linspace(aMin,aMax,res), ys=linspace(bMin,bMax,res);
    const rows2=[];
    for(const ph of ys){ const row=[]; const sp=Math.sin(ph),cp=Math.cos(ph);
      for(const th of xs){ const r=evalOut([th,ph,0])[0]??0;
        const w=projectPt(fr, r*sp*Math.cos(th), r*sp*Math.sin(th), r*cp);
        row.push(isFinite(w[0])&&isFinite(w[1])?w:null); }
      rows2.push(row); }
    return buildFilledGrid2D(rows2, color);
  }

  // ── GRAPH mode ──
  // 1-input → a projected curve. By default this FOLLOWS THE CAMERA: it samples
  // over the visible x-range (wxMin..wxMax) so the curve re-fits and re-samples to
  // whatever's framed — pan/zoom give resolution on demand. domainSrc:"inline"
  // pins a fixed aMin/aMax instead.
  if(inDim===1){
    const samples=transformerSamples(tp,paramNode,pscope,1,{xMin:wxMin,xMax:wxMax});
    // Robust placement for the "just wire it in" case. A y=f(x) graph wants the
    // input along screen-horizontal and the output along screen-vertical. The
    // transformer's default outAxis0 is "z" (correct for a 3-D graph that rises
    // along world-Z), but in a 2-D view whose plane normal is ~Z that output would
    // project onto the plane normal and collapse to a flat line. Detect that: if
    // the output axis direction is nearly parallel to the camera-plane normal,
    // place the curve directly in plane coordinates (input->U, output->V) so it
    // reads as a proper graph regardless of the z-vs-y default. An explicit,
    // non-degenerate outAxis0 (e.g. "y") still flows through the normal path.
    const outAxisVec=[[1,0,0],[0,1,0],[0,0,1]][outAx[0]] || [0,0,1];
    const N=fr.N||[0,0,1];
    const parallelToNormal=Math.abs(outAxisVec[0]*N[0]+outAxisVec[1]*N[1]+outAxisVec[2]*N[2])>0.9;
    let pts2d;
    if(parallelToNormal){
      pts2d=samples.map(inVec=>{
        const xv=inVec[0]??0, yv=evalOut(inVec)[0]??0;
        const w=[fr.O[0]+fr.U[0]*xv+fr.V[0]*yv, fr.O[1]+fr.U[1]*xv+fr.V[1]*yv, fr.O[2]+fr.U[2]*xv+fr.V[2]*yv];
        const p=projectPt(fr,w[0],w[1],w[2]);
        return isFinite(p[0])&&isFinite(p[1])?p:null;
      });
    } else {
      pts2d=samples.map(inVec=>{const w=place(inVec,evalOut(inVec)); return isFinite(w[0])&&isFinite(w[1])?w:null;});
    }
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
function transformerSamples(tp,paramNode,pscope,inDim,view){
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
  } else if(inDim===1 && _followsCamera(tp) && view){
    // CAMERA-FOLLOW (default for 1→1 graphs): sample over the visible x-range at a
    // fixed high count, so the curve re-fits and re-samples to whatever the 2-D
    // camera frames. Panning shifts the interval; zooming shrinks it and packs the
    // same sample budget into a smaller window — effectively unlimited resolution
    // on demand. A small margin past each edge keeps the line meeting the viewport
    // border cleanly while panning. Opt out with domainSrc:"inline".
    const res=Math.max(2,Math.min(8000,Math.round(resolveNum(tp.camRes,pscope,2000))));
    const span=view.xMax-view.xMin, m=span*0.02;
    for(const x of linspace(view.xMin-m,view.xMax+m,res)) samples.push([x,0,0]);
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
// A 1→1 graph transformer follows the camera by DEFAULT. It only uses a fixed
// inline domain when explicitly opted out (domainSrc:"inline") or when driven by
// a wired paramSpace (domainSrc:"param"). Empty/absent domainSrc → follow.
function _followsCamera(tp){
  const s=tp.domainSrc;
  return s!=="inline" && s!=="param";
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
  // Integrate all seeds, then build EVERY streamline into one merged mesh (a
  // single draw call for the whole flow) instead of one mesh per trajectory.
  const trajs=getTrajectories(field, seeds, steps, stepSize, fieldSc);
  const proj=trajs.map(traj=>projectPts(fr,traj));
  objs.push(...buildMergedStreamlines2D(proj, color, half));
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
  // Point sets carry many instances, so rebuilding them on every small zoom step
  // is the dominant cost on big orbits. They keep constant on-screen size, but a
  // coarse bucket (≈3 steps per power of two) lets a scroll reuse the instanced
  // geometry across most of a zoom gesture and only re-fit at wide intervals — a
  // barely-perceptible size discretisation in exchange for smooth scrolling.
  const zoomBucketCoarse = Math.round(Math.log2(ppw)*3);
  // Coarse view key for view-filling plots (fn1d/quiver) — rounded so a 1px pan
  // doesn't rebuild, but a real domain shift does.
  const round=(v)=>{ const s=Math.max(1e-6,(wxMax-wxMin)); return Math.round(v/s*64); };
  const viewSig = `${round(wxMin)},${round(wxMax)},${round(wyMin)},${round(wyMax)}`;

  const plotObjs=[];
  const live=new Set();
  let dirty=false;

  const VIEW_FILLING=new Set(["fn1d","quiver2d"]);
  // Types whose element size is constant-on-screen (so zoom changes geometry).
  // rawGeom is included so its pixel-width segments/points/glyphs (and disk radii)
  // re-fit on zoom instead of going stale until an unrelated slider forces a rebuild.
  const ZOOM_SIZED=new Set(["fn1d","curve3d","pointSeq","points","point","quiver2d","quiver3d","glyphField","transformer","flow","rawGeom"]);

  for(const childId of (camNode.attachments||[])){
    const rawNode=nodes[childId]; if(!rawNode) continue;
    if(catOf(rawNode.type)!=="plot") continue;
    const node=normalizedNode(rawNode);
    const pscope=resolveScope(childId,nodes,animVals||{});
    const dom=plotDomain(childId,nodes);
    const np=dom?applyDomain(node.props,node.type,dom):node.props;
    const color=rawNode.color||"#5b9cf6";

    // Build the per-plot signature: geometry + frame + (zoom?) + (view?).
    // For the GPU domain quad the wired slider/scalar VALUES become live uniforms
    // (updated in the hit path), so they must NOT be in the cache key — otherwise
    // dragging a coefficient recompiles the shader every frame. Compute its
    // signature against a value-neutralised scope (keys preserved, numbers/complex
    // flattened) so only STRUCTURAL changes (which exprs, how many) invalidate it.
    let sigScope=pscope, isComplexDomainEarly=false;
    if(rawNode.type==="transformer"){
      const fnDep=(rawNode.attachments||[]).map(id=>nodes[id]).find(d=>d&&d.type==="fnMap");
      if(fnDep && (fnDep.props.field||"real")==="complex"
         && Math.round(Number(fnDep.props.inDim||"1"))===1
         && Math.round(Number(fnDep.props.outDim||"1"))===1){
        isComplexDomainEarly=true;
        sigScope={}; for(const k in pscope){ const v=pscope[k];
          sigScope[k]=(typeof v==="number"||v&&typeof v.re==="number") ? 0 : v; }
      }
    }
    const gsig=plotSignature(node,np,sigScope,nodes,animVals||{}) ?? `${node.type}|raw`;
    const t=rawNode.type==="transformer"||rawNode.type==="flow"?rawNode.type:node.type;
    // Point sets and flows carry heavy geometry (instances / integrated trajectories)
    // and keep constant on-screen size, so they use the COARSE zoom bucket: they
    // re-fit their pixel width at wide zoom intervals instead of rebuilding on every
    // fine scroll step. Other zoom-sized line plots use the fine bucket.
    const COARSE_ZOOM=new Set(["pointSeq","points","point","flow","rawGeom"]);
    const zPart=ZOOM_SIZED.has(t)?`|z${COARSE_ZOOM.has(t)?zoomBucketCoarse:zoomBucket}`:"";
    // A transformer in graph mode wired to a 1→1 map follows the camera by default
    // (samples the visible x-range), so it must re-fit on pan/zoom just like fn1d.
    // Detect that case and fold the view signature in.
    let camFollowGraph=false;
    if(rawNode.type==="transformer" && (np.mode==="graph"||!np.mode) && _followsCamera(np)){
      const fnDep=(rawNode.attachments||[]).map(id=>nodes[id]).find(d=>d&&d.type==="fnMap");
      const inD=fnDep?Math.round(Number(fnDep.props.inDim||"1")):1;
      camFollowGraph = inD===1;
    }
    // A ℂ→ℂ map domain-colours the VISIBLE plane. On the GPU path it's ONE quad
    // with a fragment shader, so pan/zoom only needs the quad's corners moved (done
    // in the hit path) — NOT a rebuild + shader recompile every frame. So we keep
    // it out of the view-keyed set; isComplexDomain marks it for the in-place
    // window update below.
    let isComplexDomain=false;
    if(rawNode.type==="transformer"){
      const fnDep=(rawNode.attachments||[]).map(id=>nodes[id]).find(d=>d&&d.type==="fnMap");
      if(fnDep && (fnDep.props.field||"real")==="complex"
         && Math.round(Number(fnDep.props.inDim||"1"))===1
         && Math.round(Number(fnDep.props.outDim||"1"))===1) isComplexDomain=true;
    }
    // The GPU domain quad moves its corners in place on pan/zoom (handled in the
    // hit path), so it must NOT be view-keyed — override the graph follow flag.
    if(isComplexDomain) camFollowGraph=false;
    const vPart=(VIEW_FILLING.has(t)||camFollowGraph)?`|v${viewSig}`:"";
    // complex domain quad: drop the zoom bucket too (the shader is resolution-free)
    const zPartEff = isComplexDomain ? "" : zPart;
    const sig=`${gsig}|fr${frameSig}${zPartEff}${vPart}|c${color}`;

    live.add(childId);
    const cached=cache.get(childId);
    // A complex domain plot is kept out of the view-keyed cache (sig has no
    // viewSig), so on pan/zoom it stays a HIT. For the GPU quad we just move its 4
    // corners in place — no rebuild, no shader recompile. If it fell back to the
    // CPU grid (rare; non-transpilable map), the samples genuinely depend on the
    // window, so force a rebuild when the window changed.
    let cpuFallbackStale=false;
    if(cached && cached.sig===sig && isComplexDomain && !cached.objs.some(o=>o._domainQuad)
       && cached._viewSig!==undefined && cached._viewSig!==viewSig){
      cpuFallbackStale=true;
    }
    if(cached && cached.sig===sig && !cpuFallbackStale){
      // cache hit — reuse existing objects.
      let uScope=null;
      for(const o of cached.objs){
        if(o._domainQuad){
          const g=o.geometry, pos=g.attributes.position, ab=g.attributes.ab;
          pos.setXYZ(0,wxMin,wyMin,0); pos.setXYZ(1,wxMax,wyMin,0); pos.setXYZ(2,wxMax,wyMax,0); pos.setXYZ(3,wxMin,wyMax,0);
          ab.setXY(0,wxMin,wyMin); ab.setXY(1,wxMax,wyMin); ab.setXY(2,wxMax,wyMax); ab.setXY(3,wxMin,wyMax);
          pos.needsUpdate=true; ab.needsUpdate=true;
        }
        const names=o.material&&o.material._uniformNames;
        if(names&&names.length){
          if(!uScope){
            uScope=resolveScope(childId,nodes,animVals||{});
            // Sliders driving the shader may be wired to the structural child
            // (the fnMap whose expression uses them, or an equation/paramSpace),
            // not to the transformer itself — merge those scopes so the live
            // uniform refresh sees the current coefficient values.
            for(const depId of (rawNode.attachments||[])){ const d=nodes[depId];
              if(d&&(d.type==="equation"||d.type==="fnMap"||d.type==="paramSpace"||d.type==="points")) Object.assign(uScope, resolveScope(d.id,nodes,animVals||{})); }
            uScope=augmentScopeForGPU(uScope);
          }
          for(const nm of names){ const u=o.material.uniforms[GLSL_UNIFORM_PREFIX+nm]; if(u) u.value=resolveUniformValue(nm, uScope); }
        }
        plotObjs.push(o);
      }
      continue;
    }
    // miss — dispose old objects (if any) and rebuild this one plot
    if(cached){ for(const o of cached.objs){ o.geometry?.dispose?.(); (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m?.dispose?.()); } }
    dirty=true;

    let built=[];
    if(node.type==="fn1d") built=build2DFn1d(np,pscope,color,wxMin,wxMax,px,fr);
    else if(node.type==="curve3d") built=build2DCurve3d(np,pscope,color,px,fr);
    else if(node.type==="pointSeq"||node.type==="points") built=build2DPointSeq(np,pscope,color,px,fr,childId);
    else if(node.type==="point") built=build2DPoint(np,pscope,color,px,fr);
    else if(node.type==="rawGeom") built=build2DRawGeom(np,pscope,color,px,fr);
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
    cache.set(childId,{sig,objs:built,_viewSig:viewSig});
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
