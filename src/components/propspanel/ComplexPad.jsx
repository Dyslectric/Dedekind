import { useRef, useState, useCallback } from "react";
import { useUI } from "../../theme/tokens.jsx";

// ── Complex value control ─────────────────────────────────────────────────────
// A 2-D draggable pad that edits a complex number, stored as (re, im). Two
// interaction modes share the same stored value:
//   • "square"  — Cartesian: x = Re, y = Im, dragging anywhere in the box.
//   • "polar"   — a joystick: distance from centre = modulus, angle = argument.
// Both clamp to a box / disk of half-extent `range`. The control is square and
// sized to the panel width. onChange({re, im}) fires continuously while dragging.
//
// Rendered with an SVG: axes, unit grid, the current value as a vector + dot, and
// a live readout. Pointer events use setPointerCapture so a drag that leaves the
// box keeps tracking.
export function ComplexPad({ re, im, range, mode, color, onChange }){
  const { ui } = useUI();
  const R = Math.max(0.001, Number(range) || 5);
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const SIZE = 220;          // px, square
  const PAD = 14;            // inner padding so the dot/labels don't clip
  const span = SIZE - 2 * PAD;
  // world (re,im in [-R,R]) → svg px
  const toPx = (v) => PAD + ((v + R) / (2 * R)) * span;          // for re (x)
  const toPy = (v) => PAD + ((R - v) / (2 * R)) * span;          // for im (y, flipped)
  // svg px → world
  const fromPx = (px) => ((px - PAD) / span) * 2 * R - R;
  const fromPy = (py) => R - ((py - PAD) / span) * 2 * R;

  const apply = useCallback((clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * SIZE;
    const sy = ((clientY - rect.top) / rect.height) * SIZE;
    let nre = fromPx(sx), nim = fromPy(sy);
    if (mode === "polar") {
      // clamp to the disk of radius R (modulus capped); angle free
      const m = Math.hypot(nre, nim);
      if (m > R) { nre = nre / m * R; nim = nim / m * R; }
    } else {
      nre = Math.max(-R, Math.min(R, nre));
      nim = Math.max(-R, Math.min(R, nim));
    }
    onChange({ re: nre, im: nim });
  }, [mode, R, onChange]);

  const onDown = (e) => { e.target.setPointerCapture?.(e.pointerId); setDrag(true); apply(e.clientX, e.clientY); };
  const onMove = (e) => { if (drag) apply(e.clientX, e.clientY); };
  const onUp = (e) => { setDrag(false); e.target.releasePointerCapture?.(e.pointerId); };

  const cx = toPx(re), cy = toPy(im);
  const ox = toPx(0), oy = toPy(0);
  const modulus = Math.hypot(re, im);
  const argument = Math.atan2(im, re);
  // a few grid ticks at integer-ish fractions of R
  const ticks = [-1, -0.5, 0.5, 1].map((f) => f * R);

  return (
    <div style={{ marginTop: 6 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width="100%"
        style={{ display: "block", touchAction: "none", cursor: drag ? "grabbing" : "crosshair",
                 background: ui.uiInputBg, border: `1px solid ${ui.uiInputBorder}`, borderRadius: 6 }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      >
        {/* polar guide: unit-modulus circle(s) */}
        {mode === "polar" && ticks.filter(t => t > 0).map((t, k) => (
          <circle key={"c" + k} cx={ox} cy={oy} r={(t / R) * (span / 2)} fill="none"
                  stroke={ui.uiInputBorder} strokeWidth="1" opacity="0.7" />
        ))}
        {/* square guide: grid lines */}
        {mode === "square" && ticks.map((t, k) => (
          <g key={"g" + k}>
            <line x1={toPx(t)} y1={PAD} x2={toPx(t)} y2={SIZE - PAD} stroke={ui.uiInputBorder} strokeWidth="1" opacity="0.5" />
            <line x1={PAD} y1={toPy(t)} x2={SIZE - PAD} y2={toPy(t)} stroke={ui.uiInputBorder} strokeWidth="1" opacity="0.5" />
          </g>
        ))}
        {/* axes */}
        <line x1={PAD} y1={oy} x2={SIZE - PAD} y2={oy} stroke={ui.uiMuted} strokeWidth="1.25" />
        <line x1={ox} y1={PAD} x2={ox} y2={SIZE - PAD} stroke={ui.uiMuted} strokeWidth="1.25" />
        <text x={SIZE - PAD - 2} y={oy - 4} fontSize="11" fill={ui.uiMuted} textAnchor="end">Re</text>
        <text x={ox + 5} y={PAD + 9} fontSize="11" fill={ui.uiMuted}>Im</text>
        {/* value vector + handle */}
        <line x1={ox} y1={oy} x2={cx} y2={cy} stroke={color} strokeWidth="2" opacity="0.85" />
        <circle cx={cx} cy={cy} r="6.5" fill={color} stroke={ui.uiText} strokeWidth="1.5" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontFamily: "monospace", fontSize: 13, color: ui.uiText }}>
        <span>{re >= 0 ? "" : "−"}{Math.abs(re).toFixed(3)} {im >= 0 ? "+" : "−"} {Math.abs(im).toFixed(3)}i</span>
        <span style={{ color: ui.uiMuted }}>|z|={modulus.toFixed(3)} arg={argument.toFixed(3)}</span>
      </div>
    </div>
  );
}
