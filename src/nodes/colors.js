// Geometry node types and their default colors (must match the fallbacks used
// in the renderers). Used when baking colors into a shared view so that a node
// without a custom color still renders identically for the recipient.
const GEOM_TYPES = new Set(["curve3d","fn1d","surf3d","paramsurf","plane","point","pointSeq","quiver2d","quiver3d","flow","glyphField","paramSpace","points","rawGeom","mesh","transformer","equation"]);
const DEFAULT_GEOM_COLOR = {
  curve3d:"#5b9cf6", fn1d:"#f7cc4f", surf3d:"#5b9cf6", paramsurf:"#c761f7",
  plane:"#52d47e", point:"#ff70bb", pointSeq:"#ff70bb",
  quiver2d:"#5b9cf6", quiver3d:"#5b9cf6", flow:"#f7cc4f", glyphField:"#5be0c0",
  paramSpace:"#b4f", points:"#f9a",
  rawGeom:"#9fd6a0", mesh:"#cfd6e0", transformer:"#ffb454", equation:"#ffd479",
};

export { GEOM_TYPES, DEFAULT_GEOM_COLOR };
