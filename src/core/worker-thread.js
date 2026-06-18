// ── Compute worker thread body ───────────────────────────────────────────────
// This file IS the worker: Vite bundles it (via `new Worker(new URL(...), {
// type: "module" })` in worker.js) into its own chunk in dist/, so mathjs is
// served from our own build output — no CDN, no importScripts. It shares the
// exact same configured mathjs instance (with the app's ∑ ∏ ∫ operators) as
// the main thread by importing core/math.js directly, so there's no second
// copy of that setup to keep in sync.
import { math, compileExpr } from "./math.js";

const _ready = !!(math && typeof math.compile === "function");

// Evaluate a compiled expression against `scope`, defaulting to 0 on any
// failure (mirrors the previous worker's `ev` helper — RK4 needs a numeric
// velocity component even when an expression momentarily errors, e.g. a
// division by zero mid-integration).
function evalOr0(compiled, scope) {
  if (!compiled) return 0;
  try { const v = compiled.evaluate(scope); return typeof v === "number" ? v : 0; }
  catch { return 0; }
}

function rk4(x, y, z, h, scope, cx, cy, cz) {
  function f(px, py, pz) {
    scope.x = px; scope.y = py; scope.z = pz;
    const vx = evalOr0(cx, scope), vy = evalOr0(cy, scope), vz = cz ? evalOr0(cz, scope) : 0;
    const m = Math.sqrt(vx*vx + vy*vy + vz*vz) || 1;
    return [vx/m, vy/m, vz/m];
  }
  const a = f(x, y, z);
  const b = f(x + h*a[0]/2, y + h*a[1]/2, z + h*a[2]/2);
  const c = f(x + h*b[0]/2, y + h*b[1]/2, z + h*b[2]/2);
  const d = f(x + h*c[0], y + h*c[1], z + h*c[2]);
  return [
    x + h*(a[0] + 2*b[0] + 2*c[0] + d[0])/6,
    y + h*(a[1] + 2*b[1] + 2*c[1] + d[1])/6,
    z + h*(a[2] + 2*b[2] + 2*c[2] + d[2])/6,
  ];
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "ping") { self.postMessage({ type: "pong", ready: _ready }); return; }
  if (!_ready) { self.postMessage({ type: "error", id: msg.id, reason: "mathjs unavailable" }); return; }
  if (msg.type === "flow") {
    const cx = compileExpr(msg.exprX), cy = compileExpr(msg.exprY), cz = msg.exprZ ? compileExpr(msg.exprZ) : null;
    const scope = Object.assign({}, msg.scope);
    const steps = msg.steps, h = msg.stepSize;
    let x = msg.x0, y = msg.y0, z = msg.z0;
    const out = new Float32Array((steps + 1) * 3);
    let n = 0; out[n++] = x; out[n++] = y; out[n++] = z;
    for (let i = 0; i < steps; i++) {
      const r = rk4(x, y, z, h, scope, cx, cy, cz);
      x = r[0]; y = r[1]; z = r[2];
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) break;
      out[n++] = x; out[n++] = y; out[n++] = z;
    }
    const trimmed = out.subarray(0, n);
    const copy = new Float32Array(trimmed); // own buffer for transfer
    self.postMessage({ type: "flow", id: msg.id, count: n/3, buf: copy.buffer }, [copy.buffer]);
  }
};
