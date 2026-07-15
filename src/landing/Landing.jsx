import { useEffect, useRef } from "react";
import { LivePreview } from "./previews.jsx";
import { useIsMobile } from "../components/Viewport.jsx";

// ── Landing page ─────────────────────────────────────────────────────────────
// Full-screen marketing overlay shown at root. "Open the editor" triggers a
// fade-slide-down (handled by the parent via the `closing` class) to reveal the
// editor beneath it. The three feature visuals are real LivePreview viewports.
function Landing({ onOpen, closing }){
  const isMobile = useIsMobile();
  const stageRef = useRef(null);
  const svgRef = useRef(null);

  // Draw the hero node-graph wires between card ports (dashed, app-style).
  useEffect(()=>{
    const stage = stageRef.current, svg = svgRef.current;
    if(!stage || !svg) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const VB=[620,430];
    const links=[[0,1,"#3a5a8a"],[1,3,"#3a5a8a"],[2,3,"#6a5a9a"],[2,4,"#6a5a9a"],[3,5,"#3a6a6a"],[4,5,"#3a6a6a"]];
    const draw=()=>{
      const cards=[...stage.querySelectorAll(".dk-node")];
      const sb=stage.getBoundingClientRect();
      const sx=VB[0]/sb.width, sy=VB[1]/sb.height;
      const port=(n,sel)=>{const p=n.querySelector(sel); if(!p) return null; const r=p.getBoundingClientRect();
        return [(r.left+r.width/2-sb.left)*sx,(r.top+r.height/2-sb.top)*sy];};
      const P=cards.map(n=>({out:port(n,".dk-out"),in:port(n,".dk-in")}));
      let h="";
      links.forEach((l,idx)=>{
        const a=P[l[0]]?.out, b=P[l[1]]?.in; if(!a||!b) return;
        const dx=Math.max(50,(b[0]-a[0])*0.5);
        const d=`M${a[0]},${a[1]} C${a[0]+dx},${a[1]} ${b[0]-dx},${b[1]} ${b[0]},${b[1]}`;
        h+=`<path d="${d}" fill="none" stroke="${l[2]}" stroke-width="1.6" stroke-dasharray="5 4" opacity="0.85"/>`;
        const mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2;
        h+=`<g opacity="0.55"><line x1="${mx-3}" y1="${my-3}" x2="${mx+3}" y2="${my+3}" stroke="#7a6aa8" stroke-width="1.2"/><line x1="${mx-3}" y1="${my+3}" x2="${mx+3}" y2="${my-3}" stroke="#7a6aa8" stroke-width="1.2"/></g>`;
        if(!reduce) h+=`<circle r="2.4" fill="${l[2]}" opacity="0.9"><animateMotion dur="${2.8+idx*0.4}s" repeatCount="indefinite" path="${d}"/></circle>`;
      });
      svg.innerHTML=h;
    };
    draw();
    const ro=new ResizeObserver(draw); ro.observe(stage);
    const t=setTimeout(draw,300);
    return ()=>{ro.disconnect();clearTimeout(t);};
  },[]);

  const open=(e)=>{ e&&e.preventDefault(); onOpen&&onOpen(); };

  return (
    <div className={"dk-land"+(closing?" dk-closing":"")}>
      <style>{CSS}</style>

      <header className="dk-hd">
        <div className="dk-wrap dk-bar">
          <div className="dk-logo"><span className="dk-cut"></span>
            <span className="dk-logo-stack"><span className="dk-motto">Everything's in</span>Dedekind</span>
          </div>
          <nav className="dk-nav">
            <a href="#dk-model">How it works</a>
            <a href="#dk-render">Rendering</a>
            <a href="#dk-features">Features</a>
            <a href="#tutorials">Tutorials</a>
            <a href="https://mm.davig01.net">Community</a>
            <a href="https://github.com/Dyslectric/Dedekind">Source</a>
          </nav>
          {!isMobile && <button className="dk-btn" onClick={open}>Open the editor →</button>}
        </div>
      </header>

      <div className="dk-scroll">
        {/* HERO */}
        <section className="dk-hero">
          <div className="dk-wrap dk-hero-grid">
            <div>
              <div className="dk-eyebrow">Node-graph math visualizer · 2D &amp; 3D</div>
              <h1 className="dk-h1">Build a graph.<br/>See the <span className="dk-frac">math</span>.</h1>
              <p className="dk-lede">Dedekind plots math in 2D and 3D from a node graph. Wire scalars into
                functions, run those through transformers and flows, and point a camera at the result.
                Edit anything and the view updates right away. Most of the rendering runs on the GPU.</p>
              <div className="dk-cta">
                {!isMobile && <button className="dk-btn dk-btn-lg dk-btn-primary" onClick={open}>Open the editor →</button>}
                <a className="dk-btn dk-btn-lg" href="#dk-model">How it works</a>
              </div>
              <div className="dk-meta">
                <div>Runs fully in the browser</div>
                <div>Projects encode to a <b>shareable URL</b></div>
                <div>React · three.js · mathjs</div>
              </div>
            </div>

            <div className="dk-stage" ref={stageRef}>
              <div className="dk-glabel">Showcase · node graph</div>
              <svg ref={svgRef} viewBox="0 0 620 430" preserveAspectRatio="none" aria-hidden="true"></svg>
              <Node x={16} y={54} tag="SLD" col="var(--dk-cyan)" name="a" expr="0.80" out/>
              <Node x={16} y={158} tag="ƒ→" col="var(--dk-cyan)" name="ripple ƒ" expr="a·sin(√(x²+y²)−t)" inp out/>
              <Node x={16} y={286} tag="ANM" col="var(--dk-amber)" name="t ▶" expr="loop · 0 → 2π" out/>
              <Node x={236} y={100} tag="TRN" col="var(--dk-amber)" name="Ripple Surface" expr="graph · z = f(x,y)" inp out/>
              <Node x={236} y={236} tag="PRM" col="var(--dk-violet)" name="Torus Knot" expr="degree 1 · t" inp out/>
              <Node x={430} y={168} tag="3D" col="var(--dk-mint)" name="Cam3D" expr="perspective" inp cam/>
            </div>
          </div>
        </section>

        {/* MODEL */}
        <section id="dk-model" className="dk-sec">
          <div className="dk-wrap">
            <div className="dk-shead">
              <div className="dk-eyebrow">How it works</div>
              <h2>Functions on one side, geometry on the other.</h2>
              <p>A function in Dedekind is just a map — say <span className="dk-mono dk-cy">f(x,y)=sin(x)·cos(y)</span>
                — with no shape of its own. To draw it, you wire it into a node that decides how: which
                axes it uses, over what domain, at what resolution, and which camera shows it. Splitting
                the two means you can reuse one function as a surface, a curve, or a field.</p>
            </div>
            <div className="dk-pipe">
              <div className="dk-side dk-left">
                <h3>The math</h3>
                {[["var(--dk-cyan)","scalar · slider"],["var(--dk-amber)","animator"],["var(--dk-cyan)","function map ƒ: ℝᵐ→ℝⁿ"],["var(--dk-violet)","parametric space"],["var(--dk-cyan)","named function"]].map((c,i)=>(
                  <span className="dk-chip" key={i}><i style={{background:c[0]}}></i> {c[1]}</span>
                ))}
                <p className="dk-side-p">Values and maps. No coordinates or resolution yet — just the relationships between them.</p>
              </div>
              <div className="dk-cutcol"><span>→</span></div>
              <div className="dk-side dk-right">
                <h3>The geometry</h3>
                {[["var(--dk-amber)","transformer · graph / field"],["var(--dk-mint)","flow · stream surface"],["var(--dk-pink)","points · glyphs"],["var(--dk-mint)","camera 2D / 3D"]].map((c,i)=>(
                  <span className="dk-chip" key={i}><i style={{background:c[0]}}></i> {c[1]}</span>
                ))}
                <p className="dk-side-p">Where you set how a map turns into geometry: the axes, the domain, the resolution, and the camera that draws it.</p>
              </div>
            </div>
          </div>
        </section>

        {/* RENDERING — live previews (the new showcase demos) */}
        <section id="dk-render" className="dk-sec">
          <div className="dk-wrap">
            <div className="dk-shead">
              <div className="dk-eyebrow">Rendering</div>
              <h2>Many ways to turn a function into geometry.</h2>
              <p>The same function can become an implicit surface, a slider-driven morph, an animated
                level set, or a sequence of glyphs, depending on the nodes you wire it into. Every panel
                below is the actual renderer, running live — and each one opens straight into the editor.</p>
            </div>

            <Feat num="01 — Implicit morph" title="Sphere ↔ torus on a slider"
              body={<>A single equation blends two level sets — a sphere
                <span className="dk-mono"> x²+y²+z²=r²</span> and a torus — as the slider
                <span className="dk-mono"> m</span> runs 0→1 (eased through <span className="dk-mono">t=m²</span>).
                Two more sliders set the tube radius <span className="dk-mono">r</span> and major radius
                <span className="dk-mono"> R</span>. Wire an equation into a graph-mode transformer and it
                becomes a solid surface you can reshape live.</>}
              chips={[["var(--dk-amber)","graph transformer"],["var(--dk-violet)","blended level sets"],["var(--dk-mint)","slider-driven"]]}
              kind="spheretorus" cap="sphere → torus · drag m" />

            <Feat flip num="02 — Animated implicit surfaces" title="A wavy torus, phase-drifting"
              body={<>The level set <span className="dk-mono">(√(x²+y²)−2)²+z² = 1 + 0.2·sin(8x+p)·sin(8y)·sin(8z)</span>
                is a torus whose tube is rippled by a three-axis sine product. An animator drifts the phase
                <span className="dk-mono"> p</span> from 0 to 2π on a loop, so the bumps crawl around the
                surface — geometry that updates every frame with no mesh rebuild.</>}
              chips={[["var(--dk-mint)","implicit surface"],["var(--dk-amber)","animated phase"],["var(--dk-pink)","sine ripple"]]}
              kind="wavytorus" cap="wavy torus · animated" />

            <Feat num="03 — Points, glyphs & recurrence" title="A self-similar glyph sequence"
              body={<>A Points node in glyph mode can be a true recurrence: each step rotates and scales the
                previous point and its attached vector by the slider <span className="dk-mono">a</span>,
                starting from <span className="dk-mono">(4,4)</span>. An expression sets the count
                (<span className="dk-mono">b=256</span>), so 256 glyphs sweep out a logarithmic spiral, drawn
                in a single instanced pass with a crest highlight running along the sequence.</>}
              chips={[["var(--dk-pink)","GPU instanced glyphs"],["var(--dk-pink)","x[n−1] recurrence"],["var(--dk-amber)","slider-driven"]]}
              kind="glyphspiral" cap="recursive glyphs · drag a" />

            <Feat flip num="04 — Flows" title="A stream surface over a 3D field"
              body={<>A flow integrates a vector field from a set of seeds. Here a seed segment from
                <span className="dk-mono"> (0,0,0)</span> to <span className="dk-mono">(1,0,0)</span> is
                integrated through a 3D field with constant vertical lift, sweeping out a helical stream
                surface. The same field is drawn as a quiver on the x-y plane so you can see what's being
                integrated.</>}
              chips={[["var(--dk-mint)","RK4 stream surface"],["var(--dk-amber)","field quiver"],["var(--dk-mint)","seed line"]]}
              kind="flowsurface" cap="stream surface + field · live" />

            <Feat num="05 — Camera-follow domain" title="A self-similar curve you can zoom into forever"
              body={<>The graph <span className="dk-mono">y = s·x·sin(2π·log_b|x|)</span> is discretely
                self-similar: scaling <span className="dk-mono">x</span> by <span className="dk-mono">b</span>
                shifts the log-sine by exactly one period, so <span className="dk-mono">f(b·x)=b·f(x)</span> and
                the curve maps onto itself. The transformer's domain <em>follows the 2-D camera</em> — it
                re-samples the visible x-range every frame as you pan and zoom, so the curve stays at full
                resolution at any magnification. Scroll to zoom in and the same structure repeats endlessly.</>}
              chips={[["var(--dk-cyan)","camera-follow domain"],["var(--dk-violet)","self-similar"],["var(--dk-amber)","resolution on demand"]]}
              kind="self-similar-zoom" cap="self-similar zoom · R/F or scroll to zoom" />
          </div>
        </section>

        {/* ACCELERATION BANNER — one implicit surface + copy (condensed) */}
        <section className="dk-accel">
          <div className="dk-wrap">
            <div className="dk-accel-grid">
              <div className="dk-accel-art-stack">
                <div className="dk-accel-tile">
                  <LivePreview kind="gyroid"/>
                  <div className="dk-cap">gyroid · ray-marched</div>
                </div>
                <div className="dk-accel-tile">
                  <LivePreview kind="barth"/>
                  <div className="dk-cap">Barth sextic · 65 nodes</div>
                </div>
                <div className="dk-accel-tile">
                  <LivePreview kind="whitney"/>
                  <div className="dk-cap">Whitney umbrella · pinch point</div>
                </div>
              </div>
              <div className="dk-accel-copy">
                <div className="dk-eyebrow">Acceleration</div>
                <h2>Implicit surfaces, marched on the GPU.</h2>
                <p>Level sets <span className="dk-mono">F(x,y,z)=0</span> render by ray marching the field
                  directly in a fragment shader — no mesh extraction, no readback. The surface stays crisp at
                  any zoom, with no triangle budget, so even dense periodic surfaces draw smoothly.</p>
                <div className="dk-kv">
                  <span className="dk-chip"><i style={{background:"var(--dk-mint)"}}></i> fragment ray-march</span>
                  <span className="dk-chip"><i style={{background:"var(--dk-violet)"}}></i> no mesh extraction</span>
                  <span className="dk-chip"><i style={{background:"var(--dk-amber)"}}></i> crisp at any zoom</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SHOWCASE — the parametric ribbon (the one demo not shown elsewhere) */}
        <section className="dk-sec">
          <div className="dk-wrap">
            <div className="dk-shead">
              <div className="dk-eyebrow">Showcase</div>
              <h2>One more worked example, one click into the editor.</h2>
              <p>The panel below is the live renderer. Every preview carries its own button to open it as a
                full, editable project — wires, sliders, animators and all.</p>
            </div>

            <Feat num="A — Parametric ribbons" title="A section flying through a lissajous knot"
              body={<>A degree-2 parametric surface sweeps a ribbon along a lissajous knot. A travelling
                width-window animates a lit section of the ribbon around the loop.</>}
              chips={[["var(--dk-violet)","parametric surface"],["var(--dk-pink)","animated section"],["var(--dk-mint)","lissajous knot"]]}
              kind="ribbon" cap="lissajous ribbon · live" />
          </div>
        </section>

        {/* EXPRESSIONS */}
        <div className="dk-band">
          <div className="dk-wrap">
            <div className="dk-eyebrow">Expressions</div>
            <h2 className="dk-band-h">Type math into any field.</h2>
            <p className="dk-band-p">Fields take expressions, not just numbers. Refer to any scalar by its
              name, call functions you've defined (recursion included), and see the formatted version as
              you type. The indices <span className="dk-mono dk-vi">i, j, k</span> and the step counter
              <span className="dk-mono dk-vi"> n</span> are available where they apply.</p>
            <div className="dk-exprs">
              {["a·sin(√(x²+y²) − t)","cos(3t)·(2 + cos(2t))","x[n−1]·0.97 − y[n−1]·0.12","i·0.6 − 3, j·0.6 − 3, sin(i+j+t)","fib(n) = n≤1 ? n : fib(n−1)+fib(n−2)"].map((e,i)=>(
                <div className="dk-expr" key={i}>{e}</div>
              ))}
            </div>
          </div>
        </div>

        {/* FEATURES */}
        <section id="dk-features" className="dk-sec">
          <div className="dk-wrap">
            <div className="dk-shead"><div className="dk-eyebrow">In the editor</div><h2>The rest of the editor.</h2></div>
            <div className="dk-cards">
              {[
                ["var(--dk-amber)","▶","Animators","Drive any value with an animator that loops, bounces, or plays once. You can keep editing nodes the animation doesn't affect while it runs."],
                ["var(--dk-cyan)","↶","Undo and redo","Full history with Ctrl+Z and Ctrl+Shift+Z. A drag is one step and a run of typing is one step; playback doesn't add steps."],
                ["var(--dk-mint)","⎘","Share by link","The whole project is stored in the page URL. Copy the link to send a scene, or share a single camera on its own."],
                ["var(--dk-violet)","⊞","2D and 3D cameras","Add as many cameras as you want. Pop any one into its own window, and on a 2D camera the wheel zooms toward the cursor."],
                ["var(--dk-pink)","◑","Themes","Change the colors of the canvas, grids, node cards, and controls with built-in presets or your own values."],
                ["var(--dk-cyan)","ƒ","Reusable functions","Define a function once, with recursion if you need it, and call it from any expression in the graph."],
              ].map((c,i)=>(
                <div className="dk-card" key={i}>
                  <div className="dk-ic" style={{color:c[0],borderColor:c[0]+"55"}}>{c[1]}</div>
                  <h4>{c[2]}</h4><p>{c[3]}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="dk-final">
          <div className="dk-wrap">
            <div className="dk-eyebrow" style={{textAlign:"center"}}>Runs in your browser · nothing to install</div>
            {isMobile ? (
              <>
                <h2>Open it on a desktop to plot something.</h2>
                <p>The full node-graph editor is built for a larger screen and a pointer. Visit Dedekind on a
                  desktop browser to start from a blank canvas or take the demos apart. The demos above stay
                  fully interactive here — drag the sliders and pan or pinch the graphs.</p>
              </>
            ) : (
              <>
                <h2>Open it and plot something.</h2>
                <p>Start from a blank 2D canvas, or load the demo project and take it apart to see how it's put together.</p>
                <div className="dk-cta dk-cta-center">
                  <button className="dk-btn dk-btn-lg dk-btn-primary" onClick={open}>Open the editor →</button>
                </div>
              </>
            )}
          </div>
        </section>

        {/* AI disclosure */}
        <div className="dk-disclosure">
          <div className="dk-wrap">
            <p>Specification written by <a href="https://github.com/Dyslectric">David Green</a> and vibe-coded with the help of Claude, an LLM by Anthropic.</p>
          </div>
        </div>

        <footer className="dk-foot-wrap">
          <div className="dk-wrap dk-foot">
            <div className="dk-logo" style={{fontSize:16}}><span className="dk-cut" style={{width:12,height:18}}></span> Dedekind</div>
            <span style={{color:"var(--dk-faint)",fontStyle:"italic"}}>"Everything's in Dedekind."</span>
            <span style={{color:"var(--dk-faint)",marginLeft:"auto"}}>— after Emmy Noether</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

// hero node card
function Node({x,y,tag,col,name,expr,inp,out,cam}){
  return (
    <div className="dk-node" style={{left:x,top:y}}>
      <div className="dk-nhdr"><span className="dk-nbar" style={{background:col}}></span>
        <span className="dk-ntag" style={{color:col}}>{tag}</span>
        <span className="dk-nname">{name}</span>
        {cam ? <span style={{marginLeft:"auto",width:7,height:7,borderRadius:"50%",background:col}}></span>
             : <span className="dk-nx">×</span>}
      </div>
      <div className="dk-nbody"><div className="dk-nexpr">{expr}</div></div>
      {inp && <span className="dk-port dk-in" style={{borderColor:col,color:col}}></span>}
      {out && <span className="dk-port dk-out" style={{borderColor:col,color:col}}></span>}
    </div>
  );
}

// feature row with a live preview panel. The preview screen carries its own
// "Open project" button by default (see LivePreview / camera showOpenBtn), so
// the row no longer renders a separate one.
function Feat({num,title,body,chips,kind,cap,flip}){
  return (
    <div className={"dk-feat"+(flip?" dk-flip":"")}>
      <div>
        <div className="dk-fnum">{num}</div>
        <h3 className="dk-fh">{title}</h3>
        <p className="dk-fp">{body}</p>
        <div className="dk-kv">{chips.map((c,i)=><span className="dk-chip" key={i}><i style={{background:c[0]}}></i> {c[1]}</span>)}</div>
      </div>
      <div className="dk-art">
        <LivePreview kind={kind}/>
        <div className="dk-cap">{cap}</div>
      </div>
    </div>
  );
}

const CSS = `
.dk-land{position:fixed;inset:0;z-index:1000;background:var(--dk-ink,#0d0f18);color:var(--dk-text,#c8d1e6);
  font-family:Inter,system-ui,sans-serif;overflow:hidden;
  transition:transform .8s cubic-bezier(.7,0,.2,1), opacity .8s ease;}
.dk-land.dk-closing{transform:translateY(-100%);opacity:0;pointer-events:none;}
.dk-land{
  --dk-ink:#0d0f18;--dk-panel:#141828;--dk-line:#222747;--dk-line2:#2c344e;
  --dk-text:#c8d1e6;--dk-muted:#7a87aa;--dk-faint:#4d597a;
  --dk-cyan:#7ec8ff;--dk-violet:#b48cff;--dk-amber:#ffb454;--dk-mint:#5be0c0;--dk-pink:#f99ab4;
  --dk-disp:"Space Grotesk",Inter,sans-serif;--dk-mono:"Space Mono",ui-monospace,monospace;}
.dk-scroll{position:absolute;inset:60px 0 0 0;overflow-y:auto;overflow-x:hidden;}
.dk-scroll::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
  background-image:linear-gradient(var(--dk-line) 1px,transparent 1px),linear-gradient(90deg,var(--dk-line) 1px,transparent 1px);
  background-size:46px 46px;opacity:.13;-webkit-mask-image:radial-gradient(circle at 60% 25%,#000,transparent 75%);mask-image:radial-gradient(circle at 60% 25%,#000,transparent 75%);}
.dk-wrap{max-width:1180px;margin:0 auto;padding:0 28px;position:relative;z-index:1;}
.dk-mono{font-family:var(--dk-mono);}
.dk-cy{color:var(--dk-cyan);} .dk-vi{color:var(--dk-violet);}
.dk-eyebrow{font-family:var(--dk-mono);font-size:12.5px;letter-spacing:.26em;text-transform:uppercase;color:var(--dk-faint);}
.dk-hd{position:absolute;top:0;left:0;right:0;height:60px;z-index:60;backdrop-filter:blur(10px);
  background:rgba(13,15,24,.72);border-bottom:1px solid var(--dk-line);}
.dk-bar{display:flex;align-items:center;gap:14px;height:60px;}
.dk-logo{display:flex;align-items:center;gap:11px;font-family:var(--dk-disp);font-weight:700;font-size:19px;letter-spacing:-.01em;}
.dk-logo-stack{display:flex;flex-direction:column;line-height:1;}
.dk-motto{font-family:var(--dk-mono);font-weight:400;font-style:italic;font-size:9px;letter-spacing:.06em;color:var(--dk-faint);margin-bottom:1px;}
.dk-cut{display:inline-block;width:15px;height:22px;position:relative;}
.dk-cut::before,.dk-cut::after{content:"";position:absolute;top:0;bottom:0;width:6px;border-radius:1px;}
.dk-cut::before{left:0;background:linear-gradient(180deg,var(--dk-cyan),var(--dk-violet));}
.dk-cut::after{right:0;background:linear-gradient(180deg,var(--dk-amber),var(--dk-pink));opacity:.9;}
.dk-nav{margin-left:auto;display:flex;gap:26px;align-items:center;}
.dk-nav a{font-size:14.5px;color:var(--dk-muted);text-decoration:none;}
.dk-nav a:hover{color:var(--dk-text);}
.dk-btn{font-family:var(--dk-mono);font-size:13.5px;padding:9px 16px;border:1px solid var(--dk-line2);border-radius:7px;
  background:var(--dk-panel);color:var(--dk-text);cursor:pointer;transition:.18s;display:inline-flex;align-items:center;gap:7px;text-decoration:none;}
.dk-btn:hover{border-color:var(--dk-cyan);color:#fff;box-shadow:0 0 0 1px rgba(126,200,255,.25);}
.dk-btn-lg{padding:13px 22px;font-size:14.5px;}
.dk-btn-primary{background:linear-gradient(180deg,#13203c,#0e1730);border-color:var(--dk-cyan);color:#eaf4ff;box-shadow:0 0 24px -8px rgba(126,200,255,.5);}
.dk-btn-primary:hover{box-shadow:0 0 30px -6px rgba(126,200,255,.7);}
.dk-hero{padding:74px 0 40px;}
.dk-hero-grid{display:grid;grid-template-columns:1.04fr 1fr;gap:54px;align-items:center;}
.dk-h1{font-family:var(--dk-disp);font-weight:600;letter-spacing:-.025em;font-size:clamp(40px,6vw,68px);line-height:1.02;margin:18px 0 0;}
.dk-frac{background:linear-gradient(180deg,#fff,var(--dk-cyan));-webkit-background-clip:text;background-clip:text;color:transparent;padding:0 .08em;}
.dk-h1::after{content:"";display:block;width:64px;height:2px;margin-top:26px;background:linear-gradient(90deg,var(--dk-cyan),var(--dk-violet),var(--dk-amber));}
.dk-lede{margin:24px 0 0;font-size:19px;color:var(--dk-muted);max-width:31em;line-height:1.6;}
.dk-lede b{color:var(--dk-text);font-weight:600;}
.dk-cta{display:flex;gap:13px;margin-top:34px;flex-wrap:wrap;}
.dk-cta-center{justify-content:center;margin-top:30px;}
.dk-meta{display:flex;gap:22px;margin-top:30px;flex-wrap:wrap;}
.dk-meta div{font-family:var(--dk-mono);font-size:12.5px;color:var(--dk-faint);}
.dk-meta b{color:var(--dk-mint);font-weight:400;}
.dk-stage{position:relative;border:1px solid var(--dk-line);border-radius:14px;height:430px;overflow:hidden;
  background:radial-gradient(120% 90% at 70% 10%,rgba(126,200,255,.06),transparent 60%),linear-gradient(180deg,#10131e,#0d0f18);box-shadow:0 30px 80px -40px #000;}
.dk-glabel{position:absolute;top:11px;left:14px;font-family:var(--dk-mono);font-size:11px;letter-spacing:.2em;color:var(--dk-faint);text-transform:uppercase;}
.dk-stage svg{position:absolute;inset:0;width:100%;height:100%;}
.dk-node{position:absolute;width:150px;border-radius:7px;background:#0e1018;border:1px solid #262a40;box-shadow:0 8px 24px -14px #000;}
.dk-nhdr{display:flex;align-items:center;gap:7px;padding:6px 8px 6px 11px;background:#161a28;border-bottom:1px solid #21263c;border-radius:7px 7px 0 0;position:relative;}
.dk-nbar{position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:7px 0 0 0;}
.dk-ntag{font-family:var(--dk-mono);font-size:10px;font-weight:700;}
.dk-nname{font-family:var(--dk-mono);font-weight:700;font-size:12px;color:#c8d4f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dk-nx{margin-left:auto;color:#5a3a4a;font-size:11px;}
.dk-nbody{padding:8px 10px 10px;}
.dk-nexpr{font-family:var(--dk-mono);font-size:10.5px;color:#5a6480;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dk-port{position:absolute;width:13px;height:13px;border-radius:50%;top:13px;background:#0a0e1c;border:1.5px solid;display:grid;place-items:center;}
.dk-port::after{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;}
.dk-in{left:-7px;} .dk-out{right:-7px;}
.dk-sec{padding:84px 0;}
.dk-shead{max-width:50em;}
.dk-shead h2{font-family:var(--dk-disp);font-weight:600;letter-spacing:-.02em;font-size:clamp(27px,3.4vw,38px);line-height:1.1;margin:12px 0 0;}
.dk-shead p{color:var(--dk-muted);margin:16px 0 0;font-size:18px;line-height:1.6;}
.dk-pipe{display:grid;grid-template-columns:1fr auto 1fr;margin-top:54px;border:1px solid var(--dk-line);border-radius:14px;overflow:hidden;}
.dk-side{padding:30px;}
.dk-left{background:linear-gradient(180deg,rgba(126,200,255,.05),transparent);}
.dk-right{background:linear-gradient(180deg,rgba(255,180,84,.05),transparent);}
.dk-cutcol{width:1px;background:linear-gradient(180deg,var(--dk-cyan),var(--dk-violet),var(--dk-amber));position:relative;}
.dk-cutcol span{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:30px;height:30px;border-radius:50%;background:var(--dk-ink);border:1px solid var(--dk-line2);display:grid;place-items:center;font-family:var(--dk-mono);font-size:14px;color:var(--dk-text);}
.dk-side h3{font-family:var(--dk-mono);font-size:12.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--dk-faint);margin:0 0 16px;}
.dk-side-p{color:var(--dk-muted);margin:14px 0 0;font-size:15.5px;line-height:1.55;}
.dk-chip{display:inline-flex;align-items:center;gap:8px;font-family:var(--dk-mono);font-size:12.5px;padding:6px 11px;border:1px solid var(--dk-line2);border-radius:999px;margin:0 7px 9px 0;color:var(--dk-text);background:rgba(255,255,255,.015);}
.dk-chip i{width:8px;height:8px;border-radius:2px;display:inline-block;}
.dk-feat{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;margin-top:30px;}
.dk-feat + .dk-feat{margin-top:84px;}
.dk-flip .dk-art{order:-1;}
.dk-fnum{font-family:var(--dk-mono);font-size:13px;color:var(--dk-faint);letter-spacing:.1em;}
.dk-fh{font-family:var(--dk-disp);font-weight:600;font-size:25px;letter-spacing:-.01em;margin:10px 0 0;line-height:1.12;}
.dk-fp{color:var(--dk-muted);margin:14px 0 0;line-height:1.6;}
.dk-kv{margin-top:18px;display:flex;flex-wrap:wrap;gap:8px;}
.dk-art{border:1px solid var(--dk-line);border-radius:13px;overflow:hidden;background:linear-gradient(180deg,#10131e,#0d0f18);aspect-ratio:4/3;position:relative;box-shadow:0 24px 60px -38px #000;}
.dk-cap{position:absolute;left:12px;bottom:10px;font-family:var(--dk-mono);font-size:10.5px;letter-spacing:.16em;color:var(--dk-faint);text-transform:uppercase;pointer-events:none;z-index:2;}
.dk-openproj{margin-top:18px;display:inline-flex;align-items:center;gap:8px;font-family:var(--dk-mono);font-size:13px;letter-spacing:.02em;color:var(--dk-ink);background:linear-gradient(180deg,#7fc8ff,#5b9cf6);border:none;border-radius:9px;padding:10px 16px;cursor:pointer;font-weight:600;box-shadow:0 10px 28px -16px #5b9cf6;transition:.16s;}
.dk-openproj:hover{filter:brightness(1.08);transform:translateY(-1px);}
.dk-openproj-float{position:absolute;right:12px;bottom:10px;z-index:3;margin-top:0;padding:8px 13px;font-size:12px;}
.dk-accel{padding:72px 0;border-top:1px solid var(--dk-line);border-bottom:1px solid var(--dk-line);background:radial-gradient(1200px 400px at 50% -10%,rgba(91,156,246,.07),transparent),linear-gradient(180deg,#10131e,#0d0f18);}
.dk-accel-grid{display:grid;grid-template-columns:1fr 1.2fr;gap:34px;align-items:center;}
.dk-accel-art{border:1px solid var(--dk-line);border-radius:13px;overflow:hidden;background:linear-gradient(180deg,#10131e,#0d0f18);aspect-ratio:3/4;position:relative;box-shadow:0 24px 60px -38px #000;}
.dk-accel-art-stack{display:flex;flex-direction:column;gap:14px;}
.dk-accel-tile{border:1px solid var(--dk-line);border-radius:13px;overflow:hidden;background:linear-gradient(180deg,#10131e,#0d0f18);aspect-ratio:16/10;position:relative;box-shadow:0 24px 60px -38px #000;}
.dk-accel-art2{aspect-ratio:3/4;}
.dk-accel-copy{padding:0 6px;}
.dk-accel-copy h2{font-family:var(--dk-disp);font-weight:600;font-size:clamp(22px,2.6vw,30px);letter-spacing:-.02em;margin:10px 0 0;}
.dk-accel-copy p{color:var(--dk-muted);margin:13px 0 0;line-height:1.6;}
.dk-accel-copy .dk-kv{margin-top:18px;}
.dk-band{border-top:1px solid var(--dk-line);border-bottom:1px solid var(--dk-line);background:linear-gradient(180deg,#10131e,#0d0f18);padding:64px 0;}
.dk-band-h{font-family:var(--dk-disp);font-weight:600;font-size:clamp(24px,3vw,32px);letter-spacing:-.02em;margin:12px 0 0;}
.dk-band-p{color:var(--dk-muted);margin:14px 0 0;max-width:42em;line-height:1.6;}
.dk-exprs{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px;}
.dk-expr{font-family:var(--dk-mono);font-size:14px;color:var(--dk-text);padding:10px 15px;border:1px solid var(--dk-line2);border-radius:9px;background:rgba(255,255,255,.012);}
.dk-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:42px;}
.dk-card{border:1px solid var(--dk-line);border-radius:12px;padding:24px 22px;background:linear-gradient(180deg,var(--dk-panel),#080a14);transition:.18s;}
.dk-card:hover{border-color:var(--dk-line2);transform:translateY(-2px);}
.dk-ic{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-family:var(--dk-mono);font-size:14px;margin-bottom:15px;border:1px solid;}
.dk-card h4{font-family:var(--dk-disp);font-weight:600;font-size:18px;margin:0;letter-spacing:-.01em;}
.dk-card p{color:var(--dk-muted);font-size:15px;margin:9px 0 0;line-height:1.55;}
.dk-final{padding:104px 0;text-align:center;}
.dk-final h2{font-family:var(--dk-disp);font-weight:600;font-size:clamp(30px,4.4vw,52px);letter-spacing:-.025em;line-height:1.04;margin:0;}
.dk-final p{color:var(--dk-muted);max-width:34em;margin:18px auto 0;font-size:18px;line-height:1.6;}
.dk-disclosure{border-top:1px solid var(--dk-line);padding:22px 0;}
.dk-disclosure p{margin:0;text-align:center;font-family:var(--dk-mono);font-size:12px;letter-spacing:.02em;color:var(--dk-faint);}
.dk-foot-wrap{border-top:1px solid var(--dk-line);padding:34px 0;color:var(--dk-faint);}.dk-foot{display:flex;align-items:center;gap:20px;font-family:var(--dk-mono);font-size:12.5px;}
@media (max-width:920px){
  .dk-hero-grid{grid-template-columns:1fr;gap:36px;}
  .dk-feat{grid-template-columns:1fr;gap:26px;}
  .dk-accel-grid{grid-template-columns:1fr;gap:22px;}
  .dk-accel-art,.dk-accel-art2{aspect-ratio:4/3;}
  .dk-flip .dk-art{order:0;}
  .dk-cards{grid-template-columns:1fr;}
  .dk-pipe{grid-template-columns:1fr;}
  .dk-cutcol{height:1px;width:auto;}
  .dk-cutcol span{display:none;}
  .dk-nav{display:none;}
}
@media (max-width:640px){
  /* The scalar overlay drops to a bar UNDER the canvas inside each preview
     panel on phones. Width is clamped to the column first — using min-height
     with an aspect-ratio let the browser resolve WIDTH from the height
     (440 * 3/4 = 330px) and overflow narrow screens. So: full column width up to
     a cap, a fixed tall HEIGHT (not min-height), and min-width:0 so the grid
     item is allowed to shrink. box-sizing keeps the border inside the width. */
  .dk-feat{grid-template-columns:minmax(0,1fr);}
  .dk-art,.dk-accel-art,.dk-accel-art2{
    aspect-ratio:auto; min-height:0; height:440px;
    width:100%; max-width:320px; min-width:0;
    margin-left:auto; margin-right:auto; box-sizing:border-box;
  }
}
@media (prefers-reduced-motion:reduce){ .dk-land{transition:opacity .3s ease;} .dk-land.dk-closing{transform:none;} }
`;

export { Landing };
