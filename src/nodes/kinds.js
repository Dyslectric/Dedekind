

// ── Node-kind enablement ─────────────────────────────────────────────────────
// Every addable node type, grouped, so the project can enable/disable kinds to
// ship a simplified version of the app (e.g. a share that only exposes scalarFn).
// The unified plot kinds (scalarFn / paramSpace / points) replace the older
// granular kinds (fn1d, surf3d, curve3d, paramsurf, point, pointSeq, glyphField)
// in the add menu; the legacy kinds still render for older projects but are no
// longer offered as new nodes. plane / quiver2d / quiver3d / flow remain as-is.
const ADDABLE_KINDS = [
  ["constant","expr","slider","animator","fnDef"],             // inputs
  ["fnMap","transformer"],                                     // functions + how to plot them
  ["paramSpace","points"],                                     // manifolds / point sets
  ["flow"],                                                    // flows
  ["camera3d","camera2d"],                                     // viewports
];
const ALL_KINDS = ADDABLE_KINDS.flat();
const KIND_GROUP_LABELS = ["Inputs","Functions","Geometry","Flows","Cameras"];
// A kind is enabled unless the project explicitly lists it in disabledKinds.
function kindEnabled(projectNode, type){
  const dis=projectNode?.props?.disabledKinds;
  if(!dis||!Array.isArray(dis)) return true;
  return !dis.includes(type);
}

export {
  ADDABLE_KINDS, ALL_KINDS, KIND_GROUP_LABELS, kindEnabled
};
