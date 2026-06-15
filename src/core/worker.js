

// ── Threaded compute: Web Worker pool ────────────────────────────────────────
// Heavy, CPU-bound sampling (flow integration, large recursive sequences) is
// offloaded to a background worker so the UI thread stays at 60fps. The worker
// is created from an inlined Blob — no separate file needed — and pulls in the
// same mathjs build. Everything degrades gracefully: if a worker can't be
// created (CSP, no Worker support) or mathjs can't be loaded inside it, callers
// fall back to running the same computation synchronously on the main thread.
//
// The worker source is kept as a string. It compiles expressions once (same
// idea as the main-thread cache) and integrates entirely in-worker, posting
// back a transferable Float32Array so there's no structured-clone copy cost.
const WORKER_SRC = `
self.__ready = false;
function _tryLoad(urls){ for(var i=0;i<urls.length;i++){ try{ importScripts(urls[i]); if(self.math) return true; }catch(e){} } return false; }
self.__ready = _tryLoad([
  "https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.1/math.js",
  "https://unpkg.com/mathjs@12/lib/browser/math.js",
  "https://cdn.jsdelivr.net/npm/mathjs@12/lib/browser/math.js"
]);
var _cache = new Map();
// Register the app's bounded operators (∑ ∏ ∫) in the worker's mathjs so flow
// velocity fields can use them too. rawArgs functions get unevaluated arg nodes
// + scope, letting us bind the index/var and loop. Mirror of core/math.js.
(function(){
  if(!self.math || !self.math.import) return;
  // Bind name->val on a (possibly Map-like) scope, evaluate, then restore.
  // mathjs passes a PartitionedMap to rawArgs functions: Map-like but not a real
  // Map and not plain-object-copyable, so Object.assign loses all variables
  // (sliders/constants). Bind on the live scope + restore (mirror of math.js).
  function sHas(s,n){ return (s&&typeof s.has==="function")?s.has(n):Object.prototype.hasOwnProperty.call(s,n); }
  function sGet(s,n){ return (s&&typeof s.get==="function")?s.get(n):s[n]; }
  function sSet(s,n,v){ if(s&&typeof s.set==="function") s.set(n,v); else s[n]=v; }
  function sDel(s,n){ if(s&&typeof s.delete==="function") s.delete(n); else delete s[n]; }
  function evalWith(body,name,val,scope){
    var had=sHas(scope,name), prev=had?sGet(scope,name):undefined, v;
    sSet(scope,name,val);
    try{ v=body.evaluate(scope); }
    finally{ if(had) sSet(scope,name,prev); else sDel(scope,name); }
    return typeof v==="number"?v:NaN;
  }
  function summation(args,m,scope){
    if(args.length<4||!args[1].isSymbolNode) return NaN;
    var name=args[1].name;
    var lo=Math.round(args[2].compile().evaluate(scope));
    var hi=Math.round(args[3].compile().evaluate(scope));
    if(!isFinite(lo)||!isFinite(hi)||hi-lo>1e6) return NaN;
    var body=args[0].compile(), acc=0;
    for(var i=lo;i<=hi;i++) acc+=evalWith(body,name,i,scope);
    return acc;
  }
  summation.rawArgs=true;
  function product(args,m,scope){
    if(args.length<4||!args[1].isSymbolNode) return NaN;
    var name=args[1].name;
    var lo=Math.round(args[2].compile().evaluate(scope));
    var hi=Math.round(args[3].compile().evaluate(scope));
    if(!isFinite(lo)||!isFinite(hi)||hi-lo>1e6) return NaN;
    var body=args[0].compile(), acc=1;
    for(var i=lo;i<=hi;i++) acc*=evalWith(body,name,i,scope);
    return acc;
  }
  product.rawArgs=true;
  function integrate(args,m,scope){
    if(args.length<4||!args[1].isSymbolNode) return NaN;
    var name=args[1].name;
    var a=args[2].compile().evaluate(scope), b=args[3].compile().evaluate(scope);
    if(!isFinite(a)||!isFinite(b)) return NaN;
    if(a===b) return 0;
    var body=args[0].compile(), N=200, h=(b-a)/N;
    var s=evalWith(body,name,a,scope)+evalWith(body,name,b,scope);
    for(var k=1;k<N;k++) s+=(k%2?4:2)*evalWith(body,name,a+k*h,scope);
    return s*h/3;
  }
  integrate.rawArgs=true;
  try{ self.math.import({ summation:summation, product:product, integrate:integrate }, { override:true }); }catch(e){}
})();
function comp(expr){ if(expr==null) return null; var k=String(expr); if(_cache.has(k)) return _cache.get(k); var c=null; try{ c=self.math.compile(k);}catch(e){c=null;} _cache.set(k,c); return c; }
function ev(c, scope){ if(!c) return 0; try{ var v=c.evaluate(scope); return typeof v==="number"?v:0; }catch(e){ return 0; } }
function rk4(x,y,z,h,scope,cx,cy,cz){
  function f(px,py,pz){ scope.x=px; scope.y=py; scope.z=pz;
    var vx=ev(cx,scope), vy=ev(cy,scope), vz=cz?ev(cz,scope):0;
    var m=Math.sqrt(vx*vx+vy*vy+vz*vz)||1; return [vx/m,vy/m,vz/m]; }
  var a=f(x,y,z), b=f(x+h*a[0]/2,y+h*a[1]/2,z+h*a[2]/2),
      c=f(x+h*b[0]/2,y+h*b[1]/2,z+h*b[2]/2), d=f(x+h*c[0],y+h*c[1],z+h*c[2]);
  return [x+h*(a[0]+2*b[0]+2*c[0]+d[0])/6, y+h*(a[1]+2*b[1]+2*c[1]+d[1])/6, z+h*(a[2]+2*b[2]+2*c[2]+d[2])/6];
}
self.onmessage = function(e){
  var msg = e.data; if(msg.type==="ping"){ self.postMessage({type:"pong", ready:self.__ready}); return; }
  if(!self.__ready){ self.postMessage({type:"error", id:msg.id, reason:"mathjs unavailable"}); return; }
  if(msg.type==="flow"){
    var cx=comp(msg.exprX), cy=comp(msg.exprY), cz=msg.exprZ?comp(msg.exprZ):null;
    var scope=Object.assign({}, msg.scope);
    var steps=msg.steps, h=msg.stepSize, x=msg.x0, y=msg.y0, z=msg.z0;
    var out=new Float32Array((steps+1)*3); var n=0; out[n++]=x; out[n++]=y; out[n++]=z;
    for(var i=0;i<steps;i++){ var r=rk4(x,y,z,h,scope,cx,cy,cz); x=r[0];y=r[1];z=r[2];
      if(!isFinite(x)||!isFinite(y)||!isFinite(z)){ break; } out[n++]=x; out[n++]=y; out[n++]=z; }
    var trimmed = out.subarray(0,n);
    var copy = new Float32Array(trimmed); // own buffer for transfer
    self.postMessage({type:"flow", id:msg.id, count:n/3, buf:copy.buffer}, [copy.buffer]);
  }
};
`;

const ComputeWorker = (() => {
  let worker = null, ready = false, available = false, nextId = 1;
  const pending = new Map();
  function init(){
    if (worker || typeof Worker === "undefined") return;
    try {
      const blob = new Blob([WORKER_SRC], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      worker = new Worker(url);
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
  WORKER_SRC, ComputeWorker
};
