import { useState, useRef, useEffect, useCallback } from "react";
import { LivePreview } from "../landing/previews.jsx";
import { RAWGEOM_GALLERY } from "../landing/rawgeom-showcase.jsx";
import { safeEval } from "../core/math.js";
import { parsePointSeq } from "../geometry/parse.js";
import { exprToGLSL, GLSL_UNIFORM_PREFIX } from "../geometry/glsl.js";

// ── In-app benchmark harness ─────────────────────────────────────────────────
// Reachable at #bench. Measures the things that need a real browser + WebGL +
// React running, which a headless/node environment cannot: page-load timing,
// live render frame rate, WebGL context lifecycle across mount/unmount (validates
// the dispose+forceContextLoss fix), and the React re-render rate of an animated
// node graph. Also re-runs the CPU microbenchmarks live so you can confirm the
// derivative-memoization and comma-split numbers on your own hardware.
//
// Nothing here ships on the normal routes; it's only constructed when the hash is
// #bench, and it imports only already-bundled modules.


function fmt(n, unit="ms", dp=1){ return (n==null||!isFinite(n)) ? "—" : `${n.toFixed(dp)} ${unit}`; }

// ── 1. Page load metrics (Performance API) ───────────────────────────────────
function LoadMetrics(){
  const [m, setM] = useState(null);
  useEffect(()=>{
    // PerformanceNavigationTiming + resource transfer sizes.
    try{
      const nav = performance.getEntriesByType("navigation")[0];
      const res = performance.getEntriesByType("resource")
        .filter(r => /\.(js|css|woff2?)(\?|$)/.test(r.name));
      let transfer=0, decoded=0; const js=[];
      for(const r of res){
        transfer += r.transferSize||0; decoded += r.decodedBodySize||0;
        if(/\.js(\?|$)/.test(r.name)) js.push({ name:r.name.split("/").pop().split("?")[0],
          transfer:r.transferSize||0, decoded:r.decodedBodySize||0, dur:r.duration });
      }
      js.sort((a,b)=>b.transfer-a.transfer);
      setM({
        dcl: nav ? nav.domContentLoadedEventEnd - nav.startTime : null,
        load: nav ? nav.loadEventEnd - nav.startTime : null,
        domInteractive: nav ? nav.domInteractive - nav.startTime : null,
        transferKB: transfer/1024, decodedKB: decoded/1024,
        js,
      });
    }catch(e){ setM({error:String(e)}); }
  },[]);
  if(!m) return <div style={S.muted}>measuring…</div>;
  if(m.error) return <div style={S.muted}>navigation timing unavailable: {m.error}</div>;
  return <div>
    <Row k="DOM interactive" v={fmt(m.domInteractive)}/>
    <Row k="DOMContentLoaded" v={fmt(m.dcl)}/>
    <Row k="load event" v={fmt(m.load)}/>
    <Row k="JS+CSS+font transfer (over the wire)" v={fmt(m.transferKB,"KB",0)}/>
    <Row k="…decoded (uncompressed)" v={fmt(m.decodedKB,"KB",0)}/>
    <div style={{marginTop:8, ...S.muted}}>JS chunks by transfer size:</div>
    <table style={{width:"100%", fontSize:13, borderCollapse:"collapse"}}>
      <tbody>{m.js.map((j,i)=>(<tr key={i}>
        <td style={S.td}>{j.name}</td>
        <td style={{...S.td, textAlign:"right"}}>{fmt(j.transfer/1024,"KB",0)} wire</td>
        <td style={{...S.td, textAlign:"right", color:"#7a8aa8"}}>{fmt(j.decoded/1024,"KB",0)} raw</td>
      </tr>))}</tbody>
    </table>
    <Note>Transfer size is what actually downloads (gzip/brotli). After the dead-worker
      removal the duplicate-mathjs chunk should be absent — confirm there's no
      <code> worker-thread</code> chunk above.</Note>
  </div>;
}

// ── 2. CPU microbenchmarks (live, on your hardware) ──────────────────────────
function ComputeBench(){
  const [r, setR] = useState(null);
  const run = useCallback(()=>{
    const out={};
    // (a) symbolic derivative over a 300-pt curve x 10 rebuilds — memoization path
    {
      const FR=10, N=300; const t0=performance.now();
      for(let f=0;f<FR;f++)for(let i=0;i<N;i++) safeEval("differentiate(sin(x^2), x, t)",{t:i/N*6.28});
      const dt=performance.now()-t0; out.deriv={ total:dt, per:dt/(FR*N)*1000, evals:FR*N };
    }
    // (b) point parsing with function-call coordinates — comma-split correctness
    {
      const text=Array.from({length:200},(_,i)=>`hypot(${i},${i+1}), ${i}`).join("\n");
      const t0=performance.now(); let valid=0;
      for(let k=0;k<50;k++) valid=parsePointSeq(text,{}).length;
      out.parse={ total:performance.now()-t0, valid, expected:200 };
    }
    // (c) GLSL transpile throughput + uniform-namespacing sanity
    {
      const t0=performance.now(); let ok=true;
      for(let k=0;k<2000;k++){ const u=new Set(); const g=exprToGLSL("a*sin(x)+f*cos(y)-h", new Set(["x","y"]), u, GLSL_UNIFORM_PREFIX); if(!g||!g.includes("usr_a")) ok=false; }
      out.glsl={ total:performance.now()-t0, per:(performance.now()-t0)/2000*1000, prefixed:ok };
    }
    setR(out);
  },[]);
  return <div>
    <button style={S.btn} onClick={run}>Run compute benchmarks</button>
    {r && <div style={{marginTop:10}}>
      <Row k="d/dx over 300pts ×10 (memoized)" v={`${fmt(r.deriv.total)} · ${fmt(r.deriv.per,"µs",1)}/eval`}/>
      <Row k="parse 200 fn-coord points ×50" v={`${fmt(r.parse.total)} · ${r.parse.valid}/${r.parse.expected} valid`}
           bad={r.parse.valid!==r.parse.expected}/>
      <Row k="GLSL transpile ×2000" v={`${fmt(r.glsl.total)} · ${fmt(r.glsl.per,"µs",2)}/expr · prefix ${r.glsl.prefixed?"ok":"BROKEN"}`}
           bad={!r.glsl.prefixed}/>
      <Note>Derivative: pre-fix this was ~2000 µs/eval (re-derived symbolically every
        sample); memoized it should be tens of µs. Parse: pre-fix this returned 0
        valid (every fn-coordinate point silently dropped).</Note>
    </div>}
  </div>;
}

// ── 3. WebGL context lifecycle stress (validates dispose + forceContextLoss) ──
function ContextStress(){
  const [n, setN] = useState(0);          // how many previews currently mounted
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const memSample = ()=> (performance.memory ? (performance.memory.usedJSHeapSize/1048576) : null);

  // Cycle: mount K previews, wait, unmount, repeat — watching JS heap. If WebGL
  // resources leaked, the heap (and GPU memory, visible in the browser task
  // manager) would climb cycle over cycle. With the dispose+forceContextLoss fix
  // it should plateau.
  const runCycles = useCallback(async ()=>{
    setRunning(true); setLog([]);
    const K=6, CYCLES=8; const rows=[];
    for(let c=0;c<CYCLES;c++){
      setN(K); await sleep(450);            // mount K live WebGL viewports
      const mem=memSample();
      setN(0); await sleep(250);            // unmount → cleanup should fire
      rows.push({ c:c+1, mem });
      setLog([...rows]);
    }
    setRunning(false);
  },[]);

  return <div>
    <button style={S.btn} disabled={running} onClick={runCycles}>
      {running ? "running…" : "Run 8 mount/unmount cycles (6 viewports each)"}
    </button>
    <Note>Open your browser's task manager (Chrome: Shift+Esc) and watch the GPU
      memory column while this runs. Pre-fix, contexts/buffers leaked each cycle
      and could exhaust the ~16-context cap; with the fix, GPU memory should
      return to baseline after each unmount.</Note>
    {performance.memory && log.length>0 && <table style={{width:"100%", fontSize:13, marginTop:8, borderCollapse:"collapse"}}>
      <thead><tr><th style={S.th}>cycle</th><th style={{...S.th,textAlign:"right"}}>JS heap at peak mount</th></tr></thead>
      <tbody>{log.map(r=>(<tr key={r.c}><td style={S.td}>{r.c}</td>
        <td style={{...S.td,textAlign:"right"}}>{fmt(r.mem,"MB",1)}</td></tr>))}</tbody>
    </table>}
    {!performance.memory && <div style={S.muted}>(JS-heap readout needs Chrome with
      <code> --enable-precise-memory-info</code>; GPU memory is visible in the task
      manager regardless.)</div>}
    {/* the live viewports being mounted/unmounted */}
    <div style={{display:"flex", gap:8, flexWrap:"wrap", marginTop:12}}>
      {Array.from({length:n}).map((_,i)=>(
        <div key={i} style={{width:150, height:110, borderRadius:8, overflow:"hidden", border:"1px solid #1a1e38"}}>
          <LivePreview kind={["gyroid","barth","whitney","clebsch","wavytorus","spheretorus"][i%6]}/>
        </div>
      ))}
    </div>
  </div>;
}

// ── 4. Live render FPS (heavy animated scene) ────────────────────────────────
function FpsBench(){
  const [fps, setFps] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const [show, setShow] = useState(false);
  const measure = useCallback(()=>{
    setShow(true); setMeasuring(true); setFps(null);
    let frames=0; const t0=performance.now(); let raf;
    const tick=()=>{ frames++; if(performance.now()-t0 < 3000){ raf=requestAnimationFrame(tick); }
      else { setFps(frames/((performance.now()-t0)/1000)); setMeasuring(false); } };
    raf=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[]);
  return <div>
    <button style={S.btn} disabled={measuring} onClick={measure}>
      {measuring ? "measuring 3s…" : "Measure render FPS (gyroid, animated)"}
    </button>
    {fps!=null && <Row k="sustained frame rate" v={fmt(fps,"fps",0)} good={fps>=55} bad={fps<30}/>}
    <Note>This is the app's own rAF cadence under a live raymarched scene; compare
      against your display refresh (usually 60). Low numbers here point to GPU
      fill cost, not the React-side fixes.</Note>
    {show && <div style={{width:"100%", height:240, marginTop:10, borderRadius:8, overflow:"hidden", border:"1px solid #1a1e38"}}>
      <LivePreview kind="gyroid"/>
    </div>}
  </div>;
}

// ── 5. Raw-geometry showcase gallery ─────────────────────────────────────────
// A live gallery of the rawGeom benchmark scenes. Each tile is a real WebGL
// viewport rendering a high-poly, fully RGB-colored raw-geometry surface, the
// rawGeom JIT + Gouraud path under load. Click one to expand it large.
function RawGeomGallery(){
  const [big, setBig] = useState(null);   // expanded kind, or null
  const cats = [...new Set(RAWGEOM_GALLERY.map(g=>g.cat))];
  return <div>
    <Note>Each tile is a live, animated, high-resolution raw-geometry surface with
      full per-vertex RGB (and alpha) coloring — the rawGeom JIT + Gouraud path
      under real load. Click a tile to blow it up. Open any full-screen via its
      demo hash, e.g. <code>#demo=raw-trefoil</code>. These are the heaviest scenes
      the app builds from raw primitives; if anything stutters, this is where it
      shows.</Note>
    {big && <div style={{margin:"12px 0"}}>
      <button style={S.btn} onClick={()=>setBig(null)}>← back to gallery</button>
      <div style={{width:"100%", height:380, marginTop:10, borderRadius:10, overflow:"hidden", border:"1px solid #1a1e38"}}>
        <LivePreview kind={big}/>
      </div>
    </div>}
    {!big && cats.map(cat=>(
      <div key={cat} style={{marginTop:14}}>
        <div style={{...S.muted, textTransform:"uppercase", letterSpacing:0.5, fontSize:11, marginBottom:6}}>{cat}</div>
        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:10}}>
          {RAWGEOM_GALLERY.filter(g=>g.cat===cat).map(g=>(
            <button key={g.kind} onClick={()=>setBig(g.kind)}
              style={{padding:0, border:"1px solid #1a1e38", borderRadius:10, overflow:"hidden", background:"#0a0c18", cursor:"pointer", textAlign:"left"}}>
              <div style={{width:"100%", height:130}}><LivePreview kind={g.kind}/></div>
              <div style={{padding:"6px 9px", fontSize:12.5, color:"#aab6d4"}}>{g.name}</div>
            </button>
          ))}
        </div>
      </div>
    ))}
  </div>;
}

// ── shell ────────────────────────────────────────────────────────────────────
function Benchmarks(){
  return <div style={S.page}>
    <div style={S.wrap}>
      <h1 style={S.h1}>Dedekind — benchmarks</h1>
      <p style={S.sub}>Browser-side measurements that a headless environment can't take.
        Run each section; some need your browser's task manager open alongside.</p>
      <Section title="1 · Page load">{<LoadMetrics/>}</Section>
      <Section title="2 · Compute (CPU)">{<ComputeBench/>}</Section>
      <Section title="3 · WebGL context lifecycle">{<ContextStress/>}</Section>
      <Section title="4 · Live render FPS">{<FpsBench/>}</Section>
      <Section title="5 · Raw-geometry showcase">{<RawGeomGallery/>}</Section>
      <p style={S.foot}>Leave with the back button or by clearing the <code>#bench</code> hash.</p>
    </div>
  </div>;
}

// ── tiny presentational helpers (self-contained, no app theme dependency) ─────
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const S = {
  page:{ minHeight:"100vh", background:"#070810", color:"#cdd6ee", fontFamily:"Inter, system-ui, sans-serif", padding:"32px 16px" },
  wrap:{ maxWidth:760, margin:"0 auto" },
  h1:{ fontSize:26, fontWeight:700, margin:"0 0 4px", color:"#dde6f8" },
  sub:{ color:"#8c98b8", margin:"0 0 24px", fontSize:14, lineHeight:1.5 },
  sec:{ background:"#0c0e1c", border:"1px solid #1a1e38", borderRadius:12, padding:"16px 18px", marginBottom:16 },
  secTitle:{ fontSize:15, fontWeight:600, color:"#b5c2e0", margin:"0 0 12px" },
  btn:{ background:"#16203c", color:"#cfe0ff", border:"1px solid #2a3a66", borderRadius:8, padding:"8px 14px", fontSize:14, cursor:"pointer" },
  muted:{ color:"#7a8aa8", fontSize:13 },
  th:{ textAlign:"left", color:"#7a8aa8", fontSize:12, fontWeight:500, padding:"4px 0", borderBottom:"1px solid #1a1e38" },
  td:{ padding:"4px 0", borderBottom:"1px solid #12152a" },
  foot:{ color:"#5a6788", fontSize:12, marginTop:24, textAlign:"center" },
};
function Section({title,children}){ return <div style={S.sec}><div style={S.secTitle}>{title}</div>{children}</div>; }
function Row({k,v,good,bad}){ return <div style={{display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid #12152a", fontSize:14}}>
  <span style={{color:"#aab6d4"}}>{k}</span>
  <span style={{fontVariantNumeric:"tabular-nums", color: bad?"#ff7a7a":good?"#5fe39a":"#dde6f8", fontWeight:600}}>{v}</span>
</div>; }
function Note({children}){ return <div style={{marginTop:10, fontSize:12.5, color:"#6f7ea0", lineHeight:1.55, borderLeft:"2px solid #232a48", paddingLeft:10}}>{children}</div>; }

export { Benchmarks };
