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

export { DEFAULT_TEXTURE_SRC };
