

// ── Node-kind enablement ─────────────────────────────────────────────────────
// Every addable node type, grouped, so the project can enable/disable kinds to
// ship a simplified version of the app (e.g. a share that only exposes scalarFn).
// The unified plot kinds (scalarFn / paramSpace / points) replace the older
// granular kinds (fn1d, surf3d, curve3d, paramsurf, point, pointSeq, glyphField)
// in the add menu; the legacy kinds still render for older projects but are no
// longer offered as new nodes. plane / quiver2d / quiver3d / flow remain as-is.
const ADDABLE_KINDS = [
  ["constant","expr","slider","animator","fnDef"],             // inputs
  ["fnMap","equation","transformer"],                          // functions + how to plot them
  ["paramSpace","points"],                                     // manifolds / point sets
  ["flow"],                                                    // flows
  ["camera3d","camera2d"],                                     // viewports
];
const ALL_KINDS = ADDABLE_KINDS.flat();
const KIND_GROUP_LABELS = ["Inputs","Functions","Geometry","Flows","Cameras"];

// Single-letter keyboard shortcuts for adding a node of each kind directly on
// the canvas (when nothing is being typed). Chosen to be mnemonic and unique;
// they map a lowercase key → node type. Used by the node-editor canvas both for
// "add at cursor" (no selection) and "add + auto-wire" (while a wire is being
// dragged or armed from selected nodes). Cameras intentionally use shifted /
// distinct letters so a stray keypress doesn't spawn a viewport.
const KIND_HOTKEYS = {
  c: "constant",
  e: "expr",
  s: "slider",
  a: "animator",
  d: "fnDef",        // function (d)efinition
  m: "fnMap",        // (m)ap
  q: "equation",     // e(q)uation
  t: "transformer",
  p: "paramSpace",   // (p)arametric space
  o: "points",       // p(o)ints
  w: "flow",         // (w) ~ flow
  k: "camera3d",     // camera (k)
  j: "camera2d",     // camera (j)
};
// Reverse lookup: node type → its hotkey letter (for surfacing hints in the UI).
const HOTKEY_FOR_KIND = Object.fromEntries(Object.entries(KIND_HOTKEYS).map(([k,v])=>[v,k]));

// A kind is enabled unless the project explicitly lists it in disabledKinds.
function kindEnabled(projectNode, type){
  const dis=projectNode?.props?.disabledKinds;
  if(!dis||!Array.isArray(dis)) return true;
  return !dis.includes(type);
}

export {
  ADDABLE_KINDS, ALL_KINDS, KIND_GROUP_LABELS, kindEnabled,
  KIND_HOTKEYS, HOTKEY_FOR_KIND
};
