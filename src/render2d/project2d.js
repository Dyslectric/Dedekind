// ── 2D viewport plane projection ─────────────────────────────────────────────
// The 2D camera is now a single "flat plane" defined by a point in space (the
// origin O) and a gradient / normal vector N. Every plot — whether it is a
// native 2-D plot living in the world XY plane or a full 3-D surface/curve — is
// orthographically projected onto this plane. Orthographic means there is NO
// notion of distance: a world point P maps to plane coordinates
//
//     u = (P − O) · Û ,   v = (P − O) · V̂
//
// where (Û, V̂, N̂) is a right-handed orthonormal frame built from the normal.
// The component along N̂ (the "depth") is simply discarded — points in front of
// and behind the plane land in the same place, exactly like an orthographic
// projection with the camera looking straight down N̂.
//
// The default plane (O = origin, N = +Z) reproduces the classic top-down XY
// view: Û = +X, V̂ = +Y, so a native 2-D plot's (x,y) is unchanged.

import { resolveNum } from "../core/math.js";

const EPS = 1e-9;

// Build an orthonormal {u,v,n} frame from a camera node's origin + normal props.
// Returns { O:[ox,oy,oz], U:[..], V:[..], N:[..] }, all in MATH coordinates
// (x right, y up/forward, z up) — the same space plot geometry is generated in.
//
// We pick V̂ to be "as up as possible": project world +Z (math up axis is z in
// this codebase's surfaces, but the canonical world up for the plane framing is
// +Z) onto the plane and normalize. If N̂ is parallel to +Z we fall back to +Y.
// Û = V̂ × N̂ completes a right-handed frame so that looking along −N̂ the u axis
// runs to the right and v runs up.
function planeFrame(camNode, scope){
  const p = camNode?.props || {};
  const sc = scope || {};
  const O = [
    resolveNum(p.planeOx, sc, 0),
    resolveNum(p.planeOy, sc, 0),
    resolveNum(p.planeOz, sc, 0),
  ];
  let N = [
    resolveNum(p.normalX, sc, 0),
    resolveNum(p.normalY, sc, 0),
    resolveNum(p.normalZ, sc, 1),
  ];
  let nl = Math.hypot(N[0], N[1], N[2]);
  if (nl < EPS) { N = [0, 0, 1]; nl = 1; }
  N = [N[0]/nl, N[1]/nl, N[2]/nl];

  // reference "up" = world +Z; if N is ~parallel to it, use +Y instead.
  let up = [0, 0, 1];
  if (Math.abs(N[0]*up[0] + N[1]*up[1] + N[2]*up[2]) > 0.999) up = [0, 1, 0];

  // V = up projected onto the plane (remove the N component), normalized.
  const dotUN = up[0]*N[0] + up[1]*N[1] + up[2]*N[2];
  let V = [up[0]-dotUN*N[0], up[1]-dotUN*N[1], up[2]-dotUN*N[2]];
  let vl = Math.hypot(V[0], V[1], V[2]);
  if (vl < EPS) { V = [0, 1, 0]; vl = 1; }
  V = [V[0]/vl, V[1]/vl, V[2]/vl];

  // U = V × N  (right-handed: with the camera looking along −N, U→right, V→up)
  const U = [
    V[1]*N[2] - V[2]*N[1],
    V[2]*N[0] - V[0]*N[2],
    V[0]*N[1] - V[1]*N[0],
  ];
  const ul = Math.hypot(U[0], U[1], U[2]) || 1;
  return { O, U:[U[0]/ul,U[1]/ul,U[2]/ul], V, N };
}

// Is this frame the trivial identity plane (O=origin, axes = world XY)? Native
// 2-D plot builders already emit [x,y] in this frame, so we can skip the
// per-point projection entirely and feed their output straight through.
function isIdentityFrame(fr){
  const near=(a,b)=>Math.abs(a-b)<1e-7;
  return near(fr.O[0],0)&&near(fr.O[1],0)&&near(fr.O[2],0)
      && near(fr.U[0],1)&&near(fr.U[1],0)&&near(fr.U[2],0)
      && near(fr.V[0],0)&&near(fr.V[1],1)&&near(fr.V[2],0);
}

// Project a single MATH-space point [x,y,z] (z optional) → plane [u,v].
function projectPt(fr, x, y, z){
  const dx=x-fr.O[0], dy=y-fr.O[1], dz=(z||0)-fr.O[2];
  return [dx*fr.U[0]+dy*fr.U[1]+dz*fr.U[2],
          dx*fr.V[0]+dy*fr.V[1]+dz*fr.V[2]];
}

// Project an array of [x,y,z]|null points → array of [u,v]|null (nulls/NaN kept
// so polyline builders can break runs at gaps).
function projectPts(fr, pts){
  const out=new Array(pts.length);
  for(let i=0;i<pts.length;i++){
    const q=pts[i];
    if(!q||!isFinite(q[0])||!isFinite(q[1])||(q[2]!=null&&!isFinite(q[2]))){ out[i]=null; continue; }
    out[i]=projectPt(fr,q[0],q[1],q[2]||0);
  }
  return out;
}

export { planeFrame, isIdentityFrame, projectPt, projectPts };
