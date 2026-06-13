// ── Unified-node normalization ───────────────────────────────────────────────
// The three unified plot kinds (scalarFn, paramSpace, points) are authoring
// conveniences that fold several legacy kinds behind one node with a selector.
// To avoid duplicating all of the geometry builders, 2D renderers, geometry
// signatures and serialization logic, we normalize a unified node to an
// equivalent legacy node ({type, props}) at the point of use. Everything
// downstream (rebuild.js, render2d.js, scope.geomSignature) keeps operating on
// the legacy vocabulary it already understands.
//
// The mapping:
//   scalarFn   dims 1 → fn1d         (y = f(x))
//              dims 2 → surf3d       (z = f(x,y))
//              dims 3 → __scalarVol  (f(x,y,z) → value-coloured point cloud)
//   paramSpace degree 1 → curve3d    (parametric curve; z optional)
//              degree 2 → paramsurf  (parametric surface)
//   points     hasVectors=false → pointSeq  (points/sequences; `points` text)
//              hasVectors=true  → glyphField (glyphs; `pairs` text)
//              space "xy" zeroes the third component / projects to the plane.

function normDims(v, d){ const n=Math.round(Number(v)); return isFinite(n)?Math.max(1,Math.min(3,n)):d; }

// Map a unified node → { type, props } in the legacy vocabulary. Non-unified
// nodes are returned unchanged (so callers can blindly normalize everything).
function normalizeNode(node){
  if(!node) return node;
  const p=node.props||{};
  switch(node.type){
    case "scalarFn": {
      const dims=normDims(p.dims,1);
      if(dims===1){
        return { type:"fn1d", props:{
          expr:p.expr, xMin:p.xMin, xMax:p.xMax, res:p.res,
        }};
      }
      if(dims===2){
        return { type:"surf3d", props:{
          expr:p.expr, xMin:p.xMin, xMax:p.xMax, yMin:p.yMin, yMax:p.yMax, res:p.res,
        }};
      }
      // dims===3 → sampled scalar volume rendered as a value-coloured point cloud
      return { type:"__scalarVol", props:{
        expr:p.expr, xMin:p.xMin, xMax:p.xMax, yMin:p.yMin, yMax:p.yMax,
        zMin:p.zMin, zMax:p.zMax, res:p.res,
        colorByValue:p.colorByValue, colorLo:p.colorLo, colorHi:p.colorHi,
      }};
    }
    case "paramSpace": {
      const degree=normDims(p.degree,1);
      if(degree>=2){
        return { type:"paramsurf", props:{
          exprX:p.exprXu, exprY:p.exprYu, exprZ:p.exprZu,
          uMin:p.uMin, uMax:p.uMax, vMin:p.vMin, vMax:p.vMax, uRes:p.uRes, vRes:p.vRes,
        }};
      }
      return { type:"curve3d", props:{
        exprX:p.exprX, exprY:p.exprY, exprZ:p.exprZ||"0",
        tMin:p.tMin, tMax:p.tMax, res:p.res,
      }};
    }
    case "points": {
      const xy = (p.space||"xy")==="xy";
      if(p.hasVectors){
        // glyph field — project pairs to the plane when in xy space
        return { type:"glyphField", props:{
          pairs: xy ? projectGlyphTextToPlane(p.data) : p.data,
          arrowLen:p.arrowLen, normalize:p.normalize, anim:p.anim, speed:p.speed, crestColor:p.crestColor,
        }};
      }
      return { type:"pointSeq", props:{
        points:p.data, radius:p.radius, drawLines:p.drawLines,
        colorMode:p.colorMode, colorExpr:p.colorExpr, colorLo:p.colorLo, colorHi:p.colorHi, colorMin:p.colorMin, colorMax:p.colorMax,
        sequenced:p.sequenced, seqFrac:p.seqFrac, seqVar:p.seqVar,
      }};
    }
    default:
      return { type:node.type, props:p };
  }
}

// Return a shallow clone of the node whose .type/.props are the normalized
// (legacy) equivalents, preserving id/color/attachments/etc. Used where code
// needs a full node object (rebuild, signature).
function normalizedNode(node){
  const n=normalizeNode(node);
  if(n.type===node.type && n.props===node.props) return node;
  return { ...node, type:n.type, props:n.props, _origType:node.type };
}

// In xy "plane" mode for glyphs, force the z and vz components to 0 so the
// field lies in the XY plane regardless of what the user typed. We rewrite the
// text rather than the parsed pairs so all input modes (plain/recursive/index/
// matrix) still flow through the normal parser.
function projectGlyphTextToPlane(text){
  if(!text) return text;
  // Only a light touch: leave expressions intact but, for plain "x,y,z | vx,vy,vz"
  // rows, drop to "x,y | vx,vy". For sequence/index/matrix forms we leave the
  // text as-is (the user controls components explicitly there). Detect plain by
  // the absence of bracket/index markers.
  if(/\[/.test(text) || /\bi\b|\bj\b|\bk\b/.test(text)) return text;
  return text.split("\n").map(line=>{
    if(!line.trim()||line.trim().startsWith("//")) return line;
    const [pos,vec]=line.split("|");
    if(pos==null||vec==null) return line;
    const pc=pos.split(",").map(s=>s.trim());
    const vc=vec.split(",").map(s=>s.trim());
    const p2=[pc[0]??"0", pc[1]??"0"].join(", ");
    const v2=[vc[0]??"0", vc[1]??"0"].join(", ");
    return `${p2} | ${v2}`;
  }).join("\n");
}

// Is this one of the unified authoring kinds?
function isUnifiedKind(type){ return type==="scalarFn"||type==="paramSpace"||type==="points"; }

export { normalizeNode, normalizedNode, isUnifiedKind, projectGlyphTextToPlane };
