

// ── Scope building ── now per-camera ────────────────────────────────────────
// ── Node taxonomy ────────────────────────────────────────────────────────────
// Every node belongs to a category. The category determines what it may attach
// to, how it participates in scope, and how it renders.
//   scalar   — constant / slider / animator: named numeric values.
//   function — fnDef: a named callable depending on scalars + its own params.
//   domain   — sampling ranges/resolution fed into plots.
//   plot     — the renderable geometry (curves, surfaces, fields, points…).
//   camera   — a viewport; plots attach to it.
//   project  — global theme/settings.
//
// Attachment is dependency-directed: a node attaches to the node that *uses*
// it. Scalars no longer attach straight to cameras — only to whatever relies on
// them (a function, plot, domain, or a camera prop that references the scalar).
const CATEGORY = {
  constant:"scalar", slider:"scalar", animator:"scalar", expr:"scalar",
  fnDef:"function",
  domain:"domain",
  curve3d:"plot", fn1d:"plot", surf3d:"plot", paramsurf:"plot", paramvol:"plot", plane:"plot",
  point:"plot", pointSeq:"plot", quiver2d:"plot", quiver3d:"plot", flow:"plot", glyphField:"plot",
  // Unified plot kinds (replace the granular legacy kinds above in the UI):
  //   scalarFn   — scalar-valued function of 1/2/3 spatial inputs
  //   paramSpace — parameterized manifold (curve=degree 1, surface=degree 2)
  //   points     — points / glyphs / sequences, plane or space, optional vectors
  paramSpace:"plot", points:"plot", rawGeom:"plot",
  // New function/transformer model:
  //   fnMap      — a pure map ℝᵐ→ℝⁿ (no spatial meaning on its own). Category
  //                "map": it attaches to a transformer (or domain source), never
  //                a camera.
  //   transformer— a plot that takes an fnMap + a domain and renders it as a
  //                graph (axis mapping) or a vector field (quiver/glyph).
  fnMap:"map", equation:"map", transformer:"plot",
  // Texture sources: an image or a video frame, sampled by a surface's shader.
  // Category "texture": attaches to a plot (the renderer that samples it).
  texture:"texture", video:"texture",
  // Cameras split into explicit 3D and 2D kinds (both category "camera").
  // Legacy single "camera" kind kept for migration of old projects.
  camera:"camera", camera3d:"camera", camera2d:"camera", project:"project",
};
const catOf = (t) => CATEGORY[t] || "plot";
// Legacy helpers kept as category checks so existing call-sites keep working.
const SCALAR_TYPES = new Set(["constant","slider","animator","expr"]);   // pure values
const isScalarType = (t) => catOf(t)==="scalar";
const isFunctionType = (t) => catOf(t)==="function";
const isDomainType = (t) => catOf(t)==="domain";
const isPlotType = (t) => catOf(t)==="plot";
const isCameraType = (t) => catOf(t)==="camera";
// Which source categories may attach to which destination category.
const ATTACH_RULES = {
  scalar:   new Set(["function","plot","domain","camera","scalar","map"]),
  function: new Set(["function","plot","map","scalar"]),
  domain:   new Set(["plot"]),
  // A map (fnMap) feeds a transformer (plot) or composes into another map.
  map:      new Set(["plot","map"]),
  // Plots normally attach to cameras. A paramSpace plot may ALSO feed a
  // transformer as a parametric domain source, so plot→plot is allowed; the
  // finer rule (only paramSpace→transformer) is enforced in canAttach below.
  plot:     new Set(["camera","plot"]),
  // A texture source attaches to a plot (the surface/transformer that samples it).
  texture:  new Set(["plot"]),
  camera:   new Set([]),
  project:  new Set([]),
};
function canAttach(srcType, dstType){
  const s=catOf(srcType), d=catOf(dstType);
  if(!ATTACH_RULES[s]) return false;
  if(!ATTACH_RULES[s].has(d)) return false;
  // Refine plot→plot: a paramSpace may attach to a transformer or flow (as a
  // parametric domain / seed manifold); a points node may attach to a flow (as
  // discrete seed points → one stream curve each). No other plot→plot edges.
  if(s==="plot" && d==="plot"){
    if(dstType==="transformer") return srcType==="paramSpace";
    if(dstType==="flow") return srcType==="paramSpace" || srcType==="points";
    return false;
  }
  return true;
}
// A node can emit a dependency edge (has an OUT port) if its category may
// attach to something. It can consume (has an IN port) if some category may
// attach to it.
function canBeDependency(type){ const s=catOf(type); return ATTACH_RULES[s] && ATTACH_RULES[s].size>0; }
function canConsume(type){ const d=catOf(type); return Object.values(ATTACH_RULES).some(set=>set.has(d)); }

export {
  CATEGORY, catOf, SCALAR_TYPES, isScalarType, isFunctionType, isDomainType, isPlotType, isCameraType, ATTACH_RULES, canAttach, canBeDependency, canConsume
};
