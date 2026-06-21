import { compileExpr } from "../core/math.js";
import { EDGE_TABLE, TRI_TABLE } from "./mcTables.js";
import { evalFieldGPU2D, evalFieldGPU3D, getSharedGL, gpu3DAvailable } from "./implicit-gpu.js";

// A GPU field readback is trusted only if it's the right length and not degenerate.
// A failed/short read (driver quirks, oversized atlas, R32F readback rejection)
// can come back as all-zero or all-NaN, which would silently erase the surface —
// so we reject those and let the caller fall back to the CPU sampler.
function gpuFieldValid(arr, expectedLen){
  if(!arr || arr.length!==expectedLen) return false;
  let sawFinite=false, sawNonZero=false;
  for(let i=0;i<arr.length;i++){
    const v=arr[i];
    if(Number.isFinite(v)){ sawFinite=true; if(v!==0) sawNonZero=true; }
    if(sawFinite && sawNonZero) return true;
  }
  return false; // all-zero or all-NaN → treat as failed read
}

// ── Marching squares: extract the zero contour of f(a,b) over a rect grid ─────
// Given an equation node (lhs = rhs) and a sampling rectangle in the two free
// variables (varA spans the X world axis, varB the Y world axis), evaluate
// F = lhs - rhs on an (res+1)×(res+1) grid and emit the line segments where
// F crosses 0. Returns an array of segments [[ax,ay],[bx,by]] in world coords
// (varA → x, varB → y). Extra scope variables (sliders/constants/functions) are
// folded into `scope`.
//
// This is the standard marching-squares algorithm: for each cell we look at the
// sign of F at its four corners, linearly interpolate the crossing point on each
// edge that changes sign, and connect them. The 16 corner-sign cases reduce to a
// small set of edge-pair connections (with the two saddle cases split into two
// segments each).
function marchingSquares(eqNode, scope, aMin, aMax, bMin, bMax, res){
  const p = eqNode.props || {};
  const varA = (p.varA || "x").trim() || "x";
  const varB = (p.varB || "y").trim() || "y";
  const fExpr = `(${p.lhs ?? "0"}) - (${p.rhs ?? "0"})`;
  const compiled = compileExpr(fExpr);
  if (!compiled) return [];

  const N = Math.max(2, Math.min(1200, Math.round(res)));
  const nA = N, nB = N;
  const da = (aMax - aMin) / nA, db = (bMax - bMin) / nB;

  // Pre-evaluate F on the full grid. Try the GPU first (a single fragment-shader
  // pass + readPixels evaluates the whole (N+1)² lattice at once); fall back to the
  // CPU mathjs loop when WebGL2/float isn't available or the expression can't be
  // transpiled to GLSL. The case-table walk below is identical either way.
  let grid = null;
  {
    const gl = getSharedGL();
    if (gl){
      try {
        const g = evalFieldGPU2D(gl, fExpr, varA, varB, scope, aMin, aMax, bMin, bMax, N);
        if (gpuFieldValid(g, (nA+1)*(nB+1))) grid = g;
      } catch { grid = null; }
    }
  }
  if (!grid) {
    grid = new Float64Array((nA + 1) * (nB + 1));
    const sc = { ...scope };
    let idx = 0;
    for (let j = 0; j <= nB; j++) {
      const b = bMin + j * db;
      sc[varB] = b;
      for (let i = 0; i <= nA; i++) {
        sc[varA] = aMin + i * da;
        let v;
        try { v = compiled.evaluate(sc); } catch { v = NaN; }
        grid[idx++] = (typeof v === "number" && isFinite(v)) ? v : NaN;
      }
    }
  }

  const at = (i, j) => grid[j * (nA + 1) + i];
  const segs = [];

  // linear interpolation of the zero crossing between two corner samples
  const lerp = (v0, v1) => (Math.abs(v1 - v0) < 1e-12 ? 0.5 : v0 / (v0 - v1));

  for (let j = 0; j < nB; j++) {
    for (let i = 0; i < nA; i++) {
      const f00 = at(i, j), f10 = at(i + 1, j), f11 = at(i + 1, j + 1), f01 = at(i, j + 1);
      // skip cells touching NaN (discontinuities / out-of-domain)
      if (!(isFinite(f00) && isFinite(f10) && isFinite(f11) && isFinite(f01))) continue;

      let code = 0;
      if (f00 > 0) code |= 1;
      if (f10 > 0) code |= 2;
      if (f11 > 0) code |= 4;
      if (f01 > 0) code |= 8;
      if (code === 0 || code === 15) continue; // wholly inside / outside

      const x0 = aMin + i * da, x1 = x0 + da;
      const y0 = bMin + j * db, y1 = y0 + db;

      // edge crossing points (only computed for edges that change sign)
      // bottom edge (00–10): y = y0
      const eB = () => [x0 + lerp(f00, f10) * da, y0];
      // right edge (10–11): x = x1
      const eR = () => [x1, y0 + lerp(f10, f11) * db];
      // top edge (01–11): y = y1
      const eT = () => [x0 + lerp(f01, f11) * da, y1];
      // left edge (00–01): x = x0
      const eL = () => [x0, y0 + lerp(f00, f01) * db];

      // Connect edge crossings per marching-squares case table.
      switch (code) {
        case 1: case 14: segs.push([eL(), eB()]); break;
        case 2: case 13: segs.push([eB(), eR()]); break;
        case 3: case 12: segs.push([eL(), eR()]); break;
        case 4: case 11: segs.push([eR(), eT()]); break;
        case 6: case 9:  segs.push([eB(), eT()]); break;
        case 7: case 8:  segs.push([eL(), eT()]); break;
        case 5: { // saddle: ambiguous — split using the cell-centre sign
          const center = (f00 + f10 + f11 + f01) / 4;
          if (center > 0) { segs.push([eL(), eT()]); segs.push([eB(), eR()]); }
          else            { segs.push([eL(), eB()]); segs.push([eR(), eT()]); }
          break;
        }
        case 10: { // saddle (mirror of case 5)
          const center = (f00 + f10 + f11 + f01) / 4;
          if (center > 0) { segs.push([eL(), eB()]); segs.push([eR(), eT()]); }
          else            { segs.push([eL(), eT()]); segs.push([eB(), eR()]); }
          break;
        }
      }
    }
  }
  return segs;
}

export { marchingSquares, marchingCubes, intersectionCurve3d };

// ── Intersection curve of two implicit surfaces ──────────────────────────────
// Given two equation nodes F (lhs=rhs) and G (lhs=rhs), both in 3D, extract the
// curve {F=0} ∩ {G=0} over the sampling box. We first triangulate F=0 with
// marching cubes, then walk every triangle and find where G crosses zero on it:
// G sampled at the three vertices is treated as linear over the triangle, so it
// crosses on exactly 0 or 2 edges, giving one segment per crossed triangle. This
// is "marching squares on the F mesh" — the standard way to intersect two level
// sets without solving the coupled system directly.
//
// F is evaluated against scopeF (its own wired scalars), G against scopeG, so two
// equations that happen to reference same-named sliders don't collide. Returns
// segments [[ [x,y,z],[x,y,z] ], …] in math (varA,varB,varC) order, ready for
// buildSegments3d (which bakes the world swap).
function intersectionCurve3d(eqF, scopeF, eqG, scopeG, xMin,xMax, yMin,yMax, zMin,zMax, res){
  const { positions } = marchingCubes(eqF, scopeF, xMin,xMax, yMin,yMax, zMin,zMax, res);
  if(!positions.length) return [];

  const pg = eqG.props || {};
  const gA=(pg.varA||"x").trim()||"x";
  const gB=(pg.varB||"y").trim()||"y";
  const gC=(pg.varC||"z").trim()||"z";
  const gExpr=`(${pg.lhs ?? "0"}) - (${pg.rhs ?? "0"})`;
  const compiledG=compileExpr(gExpr);
  if(!compiledG) return [];

  // F's marched vertex carries math components (varA, varB, varC) = world axes
  // (a→X, b→Y, c→Z). Bind G's three variables to those same axis positions so
  // both surfaces live in one frame (consistent with the single-equation path).
  const sc={...scopeG};
  const evalG=(p)=>{
    sc[gA]=p[0]; sc[gB]=p[1]; sc[gC]=p[2];
    let v; try{ v=compiledG.evaluate(sc); }catch{ v=NaN; }
    return (typeof v==="number" && isFinite(v)) ? v : NaN;
  };
  const lerp=(a,b,t)=>[a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1]), a[2]+t*(b[2]-a[2])];

  const segs=[];
  for(let t=0; t+8<positions.length; t+=9){
    const v0=[positions[t],   positions[t+1], positions[t+2]];
    const v1=[positions[t+3], positions[t+4], positions[t+5]];
    const v2=[positions[t+6], positions[t+7], positions[t+8]];
    const g0=evalG(v0), g1=evalG(v1), g2=evalG(v2);
    if(!(isFinite(g0)&&isFinite(g1)&&isFinite(g2))) continue;
    const pts=[];
    const edge=(a,b,ga,gb)=>{
      if((ga>0)!==(gb>0)){
        const d=ga-gb;
        const tt=Math.abs(d)<1e-12?0.5:ga/d;
        pts.push(lerp(a,b,tt<0?0:tt>1?1:tt));
      }
    };
    edge(v0,v1,g0,g1); edge(v1,v2,g1,g2); edge(v2,v0,g2,g0);
    if(pts.length===2) segs.push([pts[0],pts[1]]);
  }
  return segs;
}

// ── Marching cubes: extract the implicit surface F(x,y,z)=0 ───────────────────
// Evaluates F = lhs - rhs over a 3D grid spanning [xMin..xMax]×[yMin..yMax]×
// [zMin..zMax] at `res` divisions per axis, and emits a triangle mesh
// approximating the zero level set. Returns { positions, normals } as flat
// Float32Arrays in math (x,y,z) order — callers apply the world axis swap.
// varA/varB/varC name the three free variables (default x,y,z). Extra scope
// variables are folded in.
//
// Standard marching cubes (Lorensen & Cline) using the canonical edge/triangle
// tables. Vertex positions are linearly interpolated along each crossed edge by
// the corner F-values; normals are estimated by central differences of F.
function marchingCubes(eqNode, scope, xMin, xMax, yMin, yMax, zMin, zMax, res){
  const p = eqNode.props || {};
  const vA = (p.varA || "x").trim() || "x";
  const vB = (p.varB || "y").trim() || "y";
  const vC = (p.varC || "z").trim() || "z";
  const fExpr = `(${p.lhs ?? "0"}) - (${p.rhs ?? "0"})`;
  const compiled = compileExpr(fExpr);
  if (!compiled) return { positions:new Float32Array(0), normals:new Float32Array(0) };

  const N = Math.max(2, Math.min(256, Math.round(res)));
  const nx=N, ny=N, nz=N;
  const dx=(xMax-xMin)/nx, dy=(yMax-yMin)/ny, dz=(zMax-zMin)/nz;

  // sample F on the full (N+1)^3 lattice. GPU path renders one z-slice per draw
  // into a float atlas and reads it back in a single call; CPU path is the mathjs
  // fallback. Both produce the identical index layout idx3(i,j,k)=(k*sy+j)*sx+i.
  const sc = { ...scope };
  const sx=nx+1, sy=ny+1, sz=nz+1;
  const idx3=(i,j,k)=> (k*sy + j)*sx + i;
  let F = null;
  {
    const gl = getSharedGL();
    if (gl && gpu3DAvailable()){
      try {
        const f = evalFieldGPU3D(gl, fExpr, vA, vB, vC, scope, xMin, xMax, yMin, yMax, zMin, zMax, N);
        if (gpuFieldValid(f, sx*sy*sz)) F = f;
      } catch { F = null; }
    }
  }
  if (!F) {
    F = new Float64Array(sx*sy*sz);
    for(let k=0;k<sz;k++){
      sc[vC]=zMin+k*dz;
      for(let j=0;j<sy;j++){
        sc[vB]=yMin+j*dy;
        for(let i=0;i<sx;i++){
          sc[vA]=xMin+i*dx;
          let v; try{ v=compiled.evaluate(sc); }catch{ v=NaN; }
          F[idx3(i,j,k)] = (typeof v==="number"&&isFinite(v)) ? v : NaN;
        }
      }
    }
  }

  const posAt=(i,j,k)=>[xMin+i*dx, yMin+j*dy, zMin+k*dz];
  // corner offsets for a cube (matches the standard table vertex numbering)
  const C=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  // each edge connects two corners
  const E=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];

  const positions=[]; const normals=[];
  const cornerV=new Array(8), cornerP=new Array(8);
  const edgeP=new Array(12);

  // central-difference gradient of F (for shading normals), sampled on lattice
  const gradAt=(i,j,k)=>{
    const c=(a,b,cc)=>{ const v=F[idx3(Math.max(0,Math.min(nx,a)),Math.max(0,Math.min(ny,b)),Math.max(0,Math.min(nz,cc)))]; return isFinite(v)?v:0; };
    return [
      (c(i+1,j,k)-c(i-1,j,k))/(2*dx),
      (c(i,j+1,k)-c(i,j-1,k))/(2*dy),
      (c(i,j,k+1)-c(i,j,k-1))/(2*dz),
    ];
  };

  for(let k=0;k<nz;k++) for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){
    let ok=true, cubeIndex=0;
    for(let c=0;c<8;c++){
      const [oi,oj,ok2]=C[c];
      const v=F[idx3(i+oi,j+oj,k+ok2)];
      if(!isFinite(v)){ ok=false; break; }
      cornerV[c]=v; cornerP[c]=posAt(i+oi,j+oj,k+ok2);
      if(v<0) cubeIndex|=(1<<c);
    }
    if(!ok) continue;
    const edges=EDGE_TABLE[cubeIndex];
    if(edges===0) continue;

    for(let e=0;e<12;e++){
      if(edges&(1<<e)){
        const [a,b]=E[e];
        const va=cornerV[a], vb=cornerV[b];
        let t=Math.abs(vb-va)<1e-12?0.5:va/(va-vb);
        if(t<0)t=0; else if(t>1)t=1;
        const pa=cornerP[a], pb=cornerP[b];
        edgeP[e]=[pa[0]+t*(pb[0]-pa[0]), pa[1]+t*(pb[1]-pa[1]), pa[2]+t*(pb[2]-pa[2])];
      }
    }
    const tri=TRI_TABLE[cubeIndex];
    for(let t=0; tri[t]!==-1 && t<tri.length; t+=3){
      for(let m=0;m<3;m++){
        const P=edgeP[tri[t+m]];
        positions.push(P[0],P[1],P[2]);
        // gradient-based normal at the nearest lattice corner of the cube
        const gi=Math.round((P[0]-xMin)/dx), gj=Math.round((P[1]-yMin)/dy), gk=Math.round((P[2]-zMin)/dz);
        const g=gradAt(gi,gj,gk);
        const gl=Math.hypot(g[0],g[1],g[2])||1;
        normals.push(g[0]/gl,g[1]/gl,g[2]/gl);
      }
    }
  }

  return { positions:new Float32Array(positions), normals:new Float32Array(normals) };
}
