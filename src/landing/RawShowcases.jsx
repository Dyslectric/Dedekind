import { useState } from "react";
import { LivePreview } from "../landing/previews.jsx";
import { RAWGEOM_GALLERY } from "./rawgeom-showcase.jsx";

// ── Raw-geometry showcase page (#raw-showcases) ──────────────────────────────
// A standalone gallery of the rawGeom showcase scenes — mathematical, organic,
// architectural, and fractal forms built entirely from raw primitives with full
// per-vertex RGB(+alpha) coloring.
//
// IMPORTANT: each live LivePreview holds its OWN WebGL context, and browsers cap
// live contexts (~8-16). Mounting all nine at once exhausts the cap, so most
// canvases fail and only one renders. To avoid that, tiles are CLICK/HOVER-TO-
// ACTIVATE: a lightweight static card by default, going live (one WebGL context)
// only when selected. At most one preview tile + the expanded stage are live.

const isRawShowcasesHash = (h) => (h||"").replace(/^#/,"").split("?")[0] === "raw-showcases";

const CAT_STYLE = {
  "mathematical":    { a:"#8a5cf0", e:"\u223f" },
  "human / organic": { a:"#e8366b", e:"\u2764" },
  "architecture":    { a:"#6cc4ff", e:"\u25a4" },
  "fractal":         { a:"#7ed957", e:"\u2756" },
};

function RawShowcases(){
  const [big, setBig] = useState(null);
  const [liveTile, setLiveTile] = useState(null);
  const cats = [...new Set(RAWGEOM_GALLERY.map(g=>g.cat))];
  const byKind = (k)=>RAWGEOM_GALLERY.find(g=>g.kind===k);

  return <div style={S.page}>
    <div style={S.wrap}>
      <h1 style={S.h1}>Raw-geometry showcases</h1>
      <p style={S.sub}>Demanding, pretty shapes built entirely from raw primitives:
        index-mode triangle and point lattices driven by composed functions, every
        vertex individually RGB-colored. Tap a card to bring it to life, then expand
        it full-size. (Cards stay static until selected so the page never spins up
        nine WebGL contexts at once.)</p>

      {big ? <div>
        <button style={S.btn} onClick={()=>{ setBig(null); setLiveTile(null); }}>{"\u2190 back to gallery"}</button>
        <div style={S.bigHead}>
          <span style={S.bigName}>{byKind(big)?.name}</span>
          <span style={{...S.bigCat, color:CAT_STYLE[byKind(big)?.cat]?.a}}>{byKind(big)?.cat}</span>
          <a style={S.bigLink} href={`#demo=${big}`}>{"open full-screen \u2197"}</a>
        </div>
        <div style={S.bigStage}><LivePreview key={big} kind={big}/></div>
        <div style={S.bigNav}>
          {RAWGEOM_GALLERY.map(g=>(
            <button key={g.kind} onClick={()=>setBig(g.kind)}
              style={{...S.chip, ...(g.kind===big?{borderColor:CAT_STYLE[g.cat]?.a, color:"#dde6f8"}:{})}}>
              {g.name}
            </button>
          ))}
        </div>
      </div> : cats.map(cat=>(
        <div key={cat} style={{marginTop:22}}>
          <div style={{...S.catLabel, color:CAT_STYLE[cat]?.a}}>{cat}</div>
          <div style={S.grid}>
            {RAWGEOM_GALLERY.filter(g=>g.cat===cat).map(g=>{
              const live = liveTile===g.kind;
              const accent = CAT_STYLE[g.cat]?.a || "#7aa2f7";
              return (
                <div key={g.kind}
                  onMouseEnter={()=>setLiveTile(g.kind)}
                  onFocus={()=>setLiveTile(g.kind)}
                  style={{...S.tile, borderColor: live?accent:"#1a1e38"}}
                  tabIndex={0}>
                  <div style={S.tileStage}>
                    {live
                      ? <LivePreview kind={g.kind}/>
                      : <button onClick={()=>setLiveTile(g.kind)} style={{...S.placeholder, color:accent}} aria-label={`activate ${g.name}`}>
                          <span style={{fontSize:34, opacity:0.85}}>{CAT_STYLE[g.cat]?.e}</span>
                          <span style={S.placeholderHint}>tap to preview</span>
                        </button>}
                  </div>
                  <div style={S.tileBar}>
                    <span style={S.tileName}>{g.name}</span>
                    {live && <button onClick={()=>setBig(g.kind)} style={{...S.expandBtn, color:accent, borderColor:accent}}>{"expand \u2197"}</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <p style={S.foot}>Open any scene full-screen directly at
        <code> #demo=raw-&lt;name&gt;</code>. Leave with the back button or by
        clearing the <code> #raw-showcases</code> hash.</p>
    </div>
  </div>;
}

const S = {
  page:{ minHeight:"100vh", background:"#070810", color:"#cdd6ee", fontFamily:"Inter, system-ui, sans-serif", padding:"32px 16px" },
  wrap:{ maxWidth:1080, margin:"0 auto" },
  h1:{ fontSize:28, fontWeight:700, margin:"0 0 6px", color:"#dde6f8" },
  sub:{ color:"#8c98b8", margin:"0 0 8px", fontSize:14.5, lineHeight:1.55, maxWidth:780 },
  catLabel:{ textTransform:"uppercase", letterSpacing:0.6, fontSize:11.5, fontWeight:700, margin:"0 0 10px" },
  grid:{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(232px, 1fr))", gap:14 },
  tile:{ border:"1px solid #1a1e38", borderRadius:12, overflow:"hidden", background:"#0a0c18", transition:"border-color .15s", outline:"none" },
  tileStage:{ width:"100%", height:170, position:"relative" },
  placeholder:{ width:"100%", height:"100%", border:"none", background:"radial-gradient(circle at 50% 40%, #11142400, #0a0c18)", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8 },
  placeholderHint:{ fontSize:11.5, color:"#5a6788", letterSpacing:0.3 },
  tileBar:{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px" },
  tileName:{ fontSize:13.5, color:"#b5c2e0", fontWeight:500 },
  expandBtn:{ fontSize:11.5, background:"transparent", border:"1px solid", borderRadius:6, padding:"2px 8px", cursor:"pointer" },
  btn:{ background:"#16203c", color:"#cfe0ff", border:"1px solid #2a3a66", borderRadius:8, padding:"8px 14px", fontSize:14, cursor:"pointer" },
  bigHead:{ display:"flex", alignItems:"baseline", gap:14, margin:"14px 0 8px" },
  bigName:{ fontSize:18, fontWeight:700, color:"#dde6f8" },
  bigCat:{ fontSize:12, textTransform:"uppercase", letterSpacing:0.5 },
  bigLink:{ marginLeft:"auto", fontSize:13, color:"#7fb0ff", textDecoration:"none" },
  bigStage:{ width:"100%", height:520, borderRadius:12, overflow:"hidden", border:"1px solid #1a1e38" },
  bigNav:{ display:"flex", flexWrap:"wrap", gap:8, marginTop:12 },
  chip:{ fontSize:12.5, background:"#0c0e1c", color:"#8c98b8", border:"1px solid #1a1e38", borderRadius:999, padding:"5px 12px", cursor:"pointer" },
  foot:{ color:"#5a6788", fontSize:12, marginTop:28, textAlign:"center" },
};

export { RawShowcases, isRawShowcasesHash };
