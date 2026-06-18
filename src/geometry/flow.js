import { resolveNum, safeEval } from "../core/math.js";
import { buildCurve3d, buildSurfFromGridGPU } from "./builders.js";
import { hexToThree } from "../geometry/three-helpers.js";

// ── RK4 flow integrator ──────────────────────────────────────────────────────
function rk4Step(x,y,z,h,scope,exprX,exprY,exprZ) {
  const f=(px,py,pz)=>{
    const sc={...scope,x:px,y:py,z:pz};
    const vx=safeEval(exprX,sc)??0,vy=safeEval(exprY,sc)??0,vz=exprZ?(safeEval(exprZ,sc)??0):0;
    const mag=Math.sqrt(vx*vx+vy*vy+vz*vz)||1;
    return[vx/mag,vy/mag,vz/mag];
  };
  const[k1x,k1y,k1z]=f(x,y,z);
  const[k2x,k2y,k2z]=f(x+h*k1x/2,y+h*k1y/2,z+h*k1z/2);
  const[k3x,k3y,k3z]=f(x+h*k2x/2,y+h*k2y/2,z+h*k2z/2);
  const[k4x,k4y,k4z]=f(x+h*k3x,y+h*k3y,z+h*k3z);
  return[x+h*(k1x+2*k2x+2*k3x+k4x)/6,y+h*(k1y+2*k2y+2*k3y+k4y)/6,z+h*(k1z+2*k2z+2*k3z+k4z)/6];
}
function integrateFlow(p,exprX,exprY,exprZ,steps,stepSize,scope) {
  const pts=[[...p]]; let[x,y,z]=p;
  for(let i=0;i<steps;i++){[x,y,z]=rk4Step(x,y,z,stepSize,scope,exprX,exprY,exprZ);if(!isFinite(x)||!isFinite(y)||!isFinite(z))break;pts.push([x,y,z]);}
  return pts;
}

// Integrate a set of seeds through the field; stitch adjacent trajectories into
// a surface. Seeds can come from a straight segment ("line"), or from a
// parametric curve ("curve"). The integration is CPU/worker (inherently
// sequential) but the mesh is GPU-rendered like the analytic surfaces.
//
// seeds: array of [x,y,z]. Returns {rows} where rows[step][seedIndex] = pt|null.
function advectSeeds(p, seeds, steps, stepSize, scope){
  const trajs=seeds.map(s=>integrateFlow(s,p.exprX,p.exprY,p.exprZ,steps,stepSize,scope));
  const minLen=Math.min(...trajs.map(t=>t.length));
  if(minLen<2) return null;
  const rows=[];
  for(let s=0;s<minLen;s++){
    const row=[];
    for(let i=0;i<seeds.length;i++){ const q=trajs[i][s]; row.push(q&&q.every(isFinite)?q:null); }
    rows.push(row);
  }
  return rows;
}
// Generate seed points along a straight segment centred on (x0,y0,z0).
function lineSeeds(p,x0,y0,z0,seedN,span,scope){
  const vx=safeEval(p.exprX,{...scope,x:x0,y:y0,z:z0})??0;
  const vy=safeEval(p.exprY,{...scope,x:x0,y:y0,z:z0})??0;
  const spreadAxis = Math.abs(vx)>Math.abs(vy) ? [0,1,0] : [1,0,0];
  const seeds=[];
  for(let i=0;i<seedN;i++){
    const t=(seedN===1)?0:(i/(seedN-1)-0.5);
    seeds.push([x0+spreadAxis[0]*t*span, y0+spreadAxis[1]*t*span, z0+spreadAxis[2]*t*span]);
  }
  return seeds;
}
// Generate seed points by sampling a parametric curve seed(s) over [sMin,sMax].
function curveSeeds(p,seedN,scope){
  const sMin=resolveNum(p.seedSMin,scope,0), sMax=resolveNum(p.seedSMax,scope,1);
  const seeds=[];
  for(let i=0;i<seedN;i++){
    const s=(seedN===1)?sMin:(sMin+(sMax-sMin)*i/(seedN-1));
    const sc={...scope,s};
    const x=safeEval(p.seedX,sc), y=safeEval(p.seedY,sc), z=safeEval(p.seedZ,sc);
    seeds.push([x??0,y??0,z??0]);
  }
  return seeds;
}
function buildFlowSurface(p,x0,y0,z0,seedN,span,steps,stepSize,scope,color){
  const seeds = (p.seedMode==="curve")
    ? curveSeeds(p,seedN,scope)
    : lineSeeds(p,x0,y0,z0,seedN,span,scope);
  const rows=advectSeeds(p,seeds,steps,stepSize,scope);
  if(!rows) return [];
  // Gradient coloring runs across the seed parameter (the u/column direction):
  // column 0 → colorA, last column → colorB.
  if(p.gradient && p.seedMode==="curve"){
    return buildSurfFromGridGPU(rows, color, {
      a: p.gradA||"#5b9cf6", b: p.gradB||"#f74fa0", axis:"u",
    });
  }
  return buildSurfFromGridGPU(rows, color);
}

// ── Flow-volume (swept volume from a parametric seed surface) ─────────────────
// Seeds laid across a 2-parameter surface seed(s,r); advecting that sheet
// through the field sweeps out a volume parametrised by (s, r, time). We render
// it as a stack of translucent lofted sheets at sampled time-slices plus the
// outer shell, which reads as a solid swept volume while staying GPU-cheap.
function surfaceSeeds(p,sN,rN,scope){
  const sMin=resolveNum(p.seedSMin,scope,0), sMax=resolveNum(p.seedSMax,scope,1);
  const rMin=resolveNum(p.seedRMin,scope,0), rMax=resolveNum(p.seedRMax,scope,1);
  // returns 2D grid seeds[ri][si] = [x,y,z]
  const grid=[];
  for(let ri=0;ri<rN;ri++){
    const r=(rN===1)?rMin:(rMin+(rMax-rMin)*ri/(rN-1));
    const row=[];
    for(let si=0;si<sN;si++){
      const s=(sN===1)?sMin:(sMin+(sMax-sMin)*si/(sN-1));
      const sc={...scope,s,r};
      row.push([safeEval(p.seedX,sc)??0, safeEval(p.seedY,sc)??0, safeEval(p.seedZ,sc)??0]);
    }
    grid.push(row);
  }
  return grid;
}
function buildFlowVolume(p,steps,stepSize,scope,color){
  let sN=Math.max(2,Math.min(120,Math.round(resolveNum(p.seedN,scope,6))));
  let rN=Math.max(2,Math.min(120,Math.round(resolveNum(p.seedRN,scope,6))));
  // Cap total integration work (seeds × steps) so a big volume can't freeze the
  // UI thread. If over budget, scale the seed grid down proportionally; the
  // mesh stays correct, just coarser.
  const BUDGET=240000;
  if(sN*rN*steps>BUDGET){
    const k=Math.sqrt(BUDGET/(steps*sN*rN));
    sN=Math.max(2,Math.round(sN*k)); rN=Math.max(2,Math.round(rN*k));
  }
  const slices=Math.max(2,Math.min(64,Math.round(resolveNum(p.volSlices,scope,6))));
  const grid=surfaceSeeds(p,sN,rN,scope);             // grid[r][s]
  const flat=[]; for(const row of grid) for(const pt of row) flat.push(pt);
  // advect every seed; trajs laid out same order as flat
  const trajs=flat.map(s=>integrateFlow(s,p.exprX,p.exprY,p.exprZ,steps,stepSize,scope));
  const minLen=Math.min(...trajs.map(t=>t.length));
  if(minLen<2) return [];
  const at=(stepIdx,ri,si)=>{ const t=trajs[ri*sN+si]; const q=t[Math.min(stepIdx,t.length-1)]; return q&&q.every(isFinite)?q:null; };
  const objs=[];
  const c3=hexToThree(color);
  // (a) time-slice sheets: the seed surface advected to several times → shows
  //     internal structure of the volume.
  for(let k=0;k<slices;k++){
    const stepIdx=Math.round((minLen-1)*k/(slices-1));
    const rows=[];
    for(let ri=0;ri<rN;ri++){ const row=[]; for(let si=0;si<sN;si++) row.push(at(stepIdx,ri,si)); rows.push(row); }
    const sheet=buildSurfFromGridGPU(rows,color,{opacity:0.22,noWire:true});
    objs.push(...sheet);
  }
  // (b) outer shell: the four boundary stream-surfaces (s=min, s=max, r=min,
  //     r=max swept over all time) bound the volume.
  const wall=(fixed,which)=>{
    const rows=[];
    for(let st=0;st<minLen;st++){
      const row=[];
      if(which==="s"){ for(let ri=0;ri<rN;ri++) row.push(at(st,ri,fixed)); }
      else { for(let si=0;si<sN;si++) row.push(at(st,fixed,si)); }
      rows.push(row);
    }
    return buildSurfFromGridGPU(rows,color,{opacity:0.5});
  };
  objs.push(...wall(0,"s"), ...wall(sN-1,"s"), ...wall(0,"r"), ...wall(rN-1,"r"));
  return objs;
}

// ── Flow from an explicit field + seed set ───────────────────────────────────
// New model: a flow consumes a vector-field fnMap (its components become the
// field exprs) and a paramSpace whose sampled points are the seeds. The seed
// manifold's shape determines the output:
//   seeds as a 1-D list (paramSpace degree 1) → a stream SURFACE (adjacent
//     trajectories stitched), or individual streamlines if `lines` is set.
//   seeds as a 2-D grid (paramSpace degree 2) → a swept stream VOLUME.
// field: {exprX, exprY, exprZ}. seedInfo: { pts:[[x,y,z]...], grid, nu, nv }.
function buildFlowFromSeeds(field, seedInfo, steps, stepSize, scope, color, opts={}){
  const p={exprX:field.exprX, exprY:field.exprY, exprZ:field.exprZ};
  const seeds=seedInfo.pts;
  if(!seeds||!seeds.length) return [];

  // 2-D seed grid → swept volume.
  if(seedInfo.grid && seedInfo.nu>1 && seedInfo.nv>1){
    return buildSweptVolume(p, seedInfo, steps, stepSize, scope, color, opts);
  }

  // streamlines: one curve per seed (no stitching)
  if(opts.lines){
    const objs=[];
    for(const s of seeds){
      const pts=integrateFlow(s,p.exprX,p.exprY,p.exprZ,steps,stepSize,scope);
      objs.push(...buildCurve3d(pts.map(q=>q||[NaN,NaN,NaN]),color));
    }
    return objs;
  }

  // 1-D seed list → stream surface (stitch adjacent trajectories)
  const rows=advectSeeds(p, seeds, steps, stepSize, scope);
  if(!rows) {
    // fall back to streamlines if stitching failed (e.g. a single seed)
    const objs=[];
    for(const s of seeds){ const pts=integrateFlow(s,p.exprX,p.exprY,p.exprZ,steps,stepSize,scope); objs.push(...buildCurve3d(pts.map(q=>q||[NaN,NaN,NaN]),color)); }
    return objs;
  }
  // wireframe is opt-in (toggle on the flow node); default to a clean solid sheet.
  const noWire = !opts.showWire;
  if(opts.gradient){
    return buildSurfFromGridGPU(rows, color, { a:opts.gradA||"#5b9cf6", b:opts.gradB||"#f74fa0", axis:"u", noWire });
  }
  return buildSurfFromGridGPU(rows, color, { noWire });
}

// Swept volume from a 2-D seed grid advected through the field.
function buildSweptVolume(p, seedInfo, steps, stepSize, scope, color, opts){
  const sN=seedInfo.nu, rN=seedInfo.nv;
  const flat=seedInfo.pts;                 // row-major: r outer, s inner (nv×nu)
  const slices=Math.max(2,Math.min(24,Math.round(opts.slices||6)));
  const trajs=flat.map(s=>integrateFlow(s,p.exprX,p.exprY,p.exprZ,steps,stepSize,scope));
  const minLen=Math.min(...trajs.map(t=>t.length));
  if(minLen<2) return [];
  const at=(stepIdx,ri,si)=>{ const t=trajs[ri*sN+si]; const q=t[Math.min(stepIdx,t.length-1)]; return q&&q.every(isFinite)?q:null; };
  const objs=[];
  for(let k=0;k<slices;k++){
    const stepIdx=Math.round((minLen-1)*k/(slices-1));
    const rows=[];
    for(let ri=0;ri<rN;ri++){ const row=[]; for(let si=0;si<sN;si++) row.push(at(stepIdx,ri,si)); rows.push(row); }
    objs.push(...buildSurfFromGridGPU(rows,color,{opacity:0.22,noWire:true}));
  }
  const wall=(fixed,which)=>{
    const rows=[];
    for(let st=0;st<minLen;st++){
      const row=[];
      if(which==="s"){ for(let ri=0;ri<rN;ri++) row.push(at(st,ri,fixed)); }
      else { for(let si=0;si<sN;si++) row.push(at(st,fixed,si)); }
      rows.push(row);
    }
    return buildSurfFromGridGPU(rows,color,{opacity:0.5});
  };
  objs.push(...wall(0,"s"), ...wall(sN-1,"s"), ...wall(0,"r"), ...wall(rN-1,"r"));
  return objs;
}

export {
  integrateFlow, rk4Step, advectSeeds, lineSeeds, curveSeeds, buildFlowSurface, surfaceSeeds, buildFlowVolume, buildFlowFromSeeds
};
