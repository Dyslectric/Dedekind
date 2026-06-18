// ── Math glyphs as SVG paths ─────────────────────────────────────────────────
//
// Real typeset-looking glyphs for the operators that the unicode font renders
// clunkily (∑ ∏ ∫ √). Each glyph is authored on a 0..100 x 0..100 viewBox with
// the baseline conventions noted per-glyph; the renderer scales the viewBox to
// the box's pixel size. Using SVG (a) makes them scale to any size crisply, (b)
// gives them consistent weight independent of the UI font, and (c) lets them be
// tinted via `fill="currentColor"`.
//
// All paths use `currentColor` so the caller sets color via the wrapping
// element. The big-operator glyphs are drawn to roughly fill their viewBox
// vertically (the renderer sizes the box to the desired glyph height).

// ∑ — summation. Drawn as a bold sigma: top bar, diagonal down to the middle
// vertex, diagonal back down to the bottom bar. Stroked-as-filled outline.
const SUM_PATH =
  "M14 4 H86 V22 H79 C77 14 73 11 62 11 H34 L57 47 L31 89 H63 C74 89 79 85 82 76 H89 L84 96 H12 V80 L40 47 L14 14 Z";

// ∏ — product. Two thick verticals joined by a top bar, with small serif feet.
const PROD_PATH =
  "M8 4 H92 V20 H84 V84 H92 V96 H58 V84 H66 V20 H34 V84 H42 V96 H8 V84 H16 V20 H8 Z";

// ∫ — integral. A tall slim S-curve with top and bottom bulbs, drawn as a
// filled stroke. Thicker and more slanted than a plain S for a proper integral
// look: the spine leans right going up, with heavier weight in the middle.
const INT_PATH =
  "M64 4 C64 -3 58 -4 51 0 C40 5 37 16 37 30 V66 C37 80 35 87 27 90 C22 92 19 89 22 85 C25 80 24 75 18 75 C11 75 7 80 7 88 C7 97 14 101 24 99 C39 96 45 83 45 67 V32 C45 19 47 12 55 9 C61 7 64 10 61 15 C58 20 60 26 67 26 C74 26 78 20 78 11 C78 2 71 1 64 4 Z";

// √ — radical sign (just the tick + the kick-up; the overline is drawn
// separately by the renderer so it can span the radicand width). Authored so
// the long diagonal rises to the top-right where the overline begins. The
// viewBox here is the LEAD area only (the bit before the radicand).
const SQRT_PATH =
  "M2 60 H14 L26 92 L44 8 H100 V18 H52 L30 100 H22 L8 70 H2 Z";

const GLYPHS = {
  sum:  { path:SUM_PATH,  vb:"0 0 100 100", aspect:1.0 },
  prod: { path:PROD_PATH, vb:"0 0 100 100", aspect:1.0 },
  int:  { path:INT_PATH,  vb:"0 0 100 100", aspect:0.55 },  // integral is slim
};

export { GLYPHS, SQRT_PATH };
