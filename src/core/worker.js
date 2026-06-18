// ── Threaded compute: Web Worker pool ────────────────────────────────────────
// Heavy, CPU-bound sampling (flow integration, large recursive sequences) is
// offloaded to a background worker so the UI thread stays at 60fps. The worker
// body lives in worker-thread.js, a real ES module that imports mathjs (via
// core/math.js) the same way every other module in the app does — Vite bundles
// it into its own chunk in dist/, so it's served from our own build output,
// not a CDN. Everything degrades gracefully: if a worker can't be created (CSP,
// no Worker support, no module-worker support) or mathjs fails to load inside
// it, callers fall back to running the same computation synchronously on the
// main thread (see flow.js).
const ComputeWorker = (() => {
  let worker = null, ready = false, available = false, nextId = 1;
  const pending = new Map();
  function init(){
    if (worker || typeof Worker === "undefined") return;
    try {
      worker = new Worker(new URL("./worker-thread.js", import.meta.url), { type: "module" });
      available = true;
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === "pong") { ready = m.ready; return; }
        const cb = pending.get(m.id); if (!cb) return; pending.delete(m.id);
        if (m.type === "error") cb.reject(new Error(m.reason));
        else cb.resolve(m);
      };
      worker.onerror = () => { available = false; ready = false; };
      worker.postMessage({ type: "ping" });
    } catch { worker = null; available = false; }
  }
  return {
    init,
    get usable(){ return available && ready; },
    // returns a Promise<{points:Array<[x,y,z]>}> or rejects → caller falls back
    flow(req){
      return new Promise((resolve, reject) => {
        if (!worker || !available) { reject(new Error("no worker")); return; }
        const id = nextId++;
        pending.set(id, {
          resolve: (m) => {
            const a = new Float32Array(m.buf); const pts = [];
            for (let i = 0; i < m.count; i++) pts.push([a[i*3], a[i*3+1], a[i*3+2]]);
            resolve({ points: pts });
          },
          reject,
        });
        worker.postMessage({ type: "flow", id, ...req });
        // safety timeout so a stuck worker never blocks the fallback forever
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout")); } }, 4000);
      });
    },
  };
})();

export {
  ComputeWorker
};
