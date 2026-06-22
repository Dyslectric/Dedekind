// Cute, Dedekind-themed default texture: a dark Catppuccin ground, a faint grid,
// and the ◈ mark in the accent gradient. Embedded as an SVG data-URI so a fresh
// texture node — and any shared project — is self-contained, with no bundled
// external image. Pure string (no three import) so model.js can use it as a node
// default without dragging three into its dependency graph.
const DEDEKIND_SVG =
`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#8aadf4"/><stop offset="0.5" stop-color="#c6a0f6"/><stop offset="1" stop-color="#f5bde6"/>
</linearGradient></defs>
<rect width="256" height="256" fill="#1e2030"/>
<g stroke="#363a4f" stroke-width="2" fill="none"><path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256"/></g>
<path d="M128 36 L200 128 L128 220 L56 128 Z" fill="url(#g)"/>
<path d="M128 80 L168 128 L128 176 L88 128 Z" fill="#1e2030"/>
</svg>`;
const DEFAULT_TEXTURE_SRC = "data:image/svg+xml;utf8," + encodeURIComponent(DEDEKIND_SVG);

// Default NORMAL map: a tileable grid of four-sided pyramid bumps. Each pyramid is
// four flat facets, each painted with the constant tangent-space normal of a 45°
// slope — encoded the usual way (R=x, G=y, B=z, mapped 0..1 → 0..255). Sampling
// this as a normal map gives a crisp embossed-tile look under the light. Pure SVG
// so it's self-contained like the albedo default; flat facets survive the SVG→
// bitmap rasterize without colour bleeding at 45° edges.
const N_FACET = { up:"#8026da", down:"#80dada", east:"#da80da", west:"#2680da" }; // (0,∓.7,.7)/(±.7,0,.7), z=0.7→B=218
const NORMAL_SVG =
`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs><g id="p">
<polygon points="0,0 64,0 32,32" fill="${N_FACET.up}"/>
<polygon points="64,0 64,64 32,32" fill="${N_FACET.east}"/>
<polygon points="64,64 0,64 32,32" fill="${N_FACET.down}"/>
<polygon points="0,64 0,0 32,32" fill="${N_FACET.west}"/>
</g></defs>
<rect width="256" height="256" fill="#8080ff"/>
${[0,64,128,192].flatMap(y=>[0,64,128,192].map(x=>`<use href="#p" x="${x}" y="${y}"/>`)).join("")}
</svg>`;
const DEFAULT_NORMAL_SRC = "data:image/svg+xml;utf8," + encodeURIComponent(NORMAL_SVG);

// ── Brick assets (albedo + matching normal map) ──────────────────────────────
// A running-bond brick wall, generated so the albedo and the normal map share the
// exact same layout. The normal map gives each brick a bevelled edge (the four
// 45° facets) around a flat top, so under light the mortar lines read as grooves —
// the classic "brick sphere" shading test. 64×32 cells, alternate rows offset a
// half-brick; c from −1 lets the offset rows wrap seamlessly under repeat.
const _CW=64, _RH=32, _MG=5, _BV=6;                         // cell, mortar gap, bevel
const _BRICK_COLS=["#9e4b3a","#ab5240","#8f4233","#b35a45","#a04a38","#964539"];
function _brickCells(fn){
  const out=[];
  for(let r=0;r<8;r++){ const off=(r%2)?_CW/2:0;
    for(let c=-1;c<4;c++){ out.push(fn(c*_CW+off, r*_RH, _CW-_MG, _RH-_MG, r, c)); } }
  return out.join("");
}
const BRICK_SVG =
`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<rect width="256" height="256" fill="#2b2b2f"/>
${_brickCells((x,y,w,h,r,c)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${_BRICK_COLS[(r*5+c+1)%_BRICK_COLS.length]}"/>`)}
</svg>`;
const DEFAULT_BRICK_SRC = "data:image/svg+xml;utf8," + encodeURIComponent(BRICK_SVG);
const BRICK_NORMAL_SVG =
`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<rect width="256" height="256" fill="#8080ff"/>
${_brickCells((x,y,w,h)=>{ const b=_BV;
  return `<polygon points="${x},${y} ${x},${y+h} ${x+b},${y+h-b} ${x+b},${y+b}" fill="${N_FACET.west}"/>`
       + `<polygon points="${x+w},${y} ${x+w},${y+h} ${x+w-b},${y+h-b} ${x+w-b},${y+b}" fill="${N_FACET.east}"/>`
       + `<polygon points="${x},${y} ${x+w},${y} ${x+w-b},${y+b} ${x+b},${y+b}" fill="${N_FACET.up}"/>`
       + `<polygon points="${x},${y+h} ${x+w},${y+h} ${x+w-b},${y+h-b} ${x+b},${y+h-b}" fill="${N_FACET.down}"/>`; })}
</svg>`;
const DEFAULT_BRICK_NORMAL_SRC = "data:image/svg+xml;utf8," + encodeURIComponent(BRICK_NORMAL_SVG);

// Built-in texture library: a texture node can point at one of these by a short
// "builtin:<name>" id instead of an embedded data-URI. Unlike a data-URI, the id
// survives serialization (it isn't stripped as media), so a project that uses a
// built-in texture stays self-contained AND shareable. textures.js resolves the id.
const BUILTIN_TEXTURES = {
  dedekind: DEFAULT_TEXTURE_SRC,
  "pyramid-normal": DEFAULT_NORMAL_SRC,
  brick: DEFAULT_BRICK_SRC,
  "brick-normal": DEFAULT_BRICK_NORMAL_SRC,
};
function resolveBuiltinTexture(src){
  if(typeof src==="string" && src.startsWith("builtin:")) return BUILTIN_TEXTURES[src.slice(8)] || null;
  return null;
}

export {
  DEFAULT_TEXTURE_SRC, DEFAULT_NORMAL_SRC, DEFAULT_BRICK_SRC, DEFAULT_BRICK_NORMAL_SRC,
  BUILTIN_TEXTURES, resolveBuiltinTexture,
};
