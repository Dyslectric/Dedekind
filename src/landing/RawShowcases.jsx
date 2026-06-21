import { useState } from "react";
import { LivePreview } from "../landing/previews.jsx";
import { RAWGEOM_GALLERY } from "./rawgeom-showcase.jsx";

// ── Raw-geometry showcase page (#raw-showcases) ──────────────────────────────
// A standalone gallery of the rawGeom showcase scenes — mathematical, organic,
// architectural, and fractal forms built entirely from raw primitives with full
// per-vertex RGB(+alpha) coloring. Each tile is a live, animated WebGL viewport.
// Click a tile to expand it; open any full-screen at #demo=raw-<name>.
//
// Lives on its own route (not the #bench page): these are things to look at, not
// a performance instrument. Lazy-loaded into its own chunk via App.jsx.

const isRawShowcasesHash = (h) => (h||"").replace(/^#/,"").split("?")[0] === "raw-showcases";

function RawShowcases(){
  const [big, setBig] = useState(null);   // expanded kind, or null
  const cats = [...new Set(RAWGEOM_GALLERY.map(g=>g.cat))];
  const byKind = (k)=>RAWGEOM_GALLERY.find(g=>g.kind===k);

  return <div style={S.page}>
    <div style={S.wrap}>
      <h1 style={S.h1}>Raw-geometry showcases</h1>
      <p style={S.sub}>Demanding, pretty shapes built entirely from raw primitives —
        index-mode triangle and point lattices driven by composed functions, every
        vertex individually RGB-colored. Each tile is a live, animated viewport.
        Click one to expand it; open any full-screen at <code>#demo=raw-&lt;name&gt;</code>,
        or drop into the editor to crank its resolution sliders.</p>

      {big ? <div>
        <button style={S.btn} onClick={()=>setBig(null)}>← back to gallery</button>
        <div style={S.bigHead}>
          <span style={S.bigName}>{byKind(big)?.name}</span>
          <span style={S.bigCat}>{byKind(big)?.cat}</span>
          <a style={S.bigLink} href={`#demo=${big}`}>open full-screen ↗</a>
        </div>
        <div style={S.bigStage}><LivePreview kind={big}/></div>
      </div> : cats.map(cat=>(
        <div key={cat} style={{marginTop:22}}>
          <div style={S.catLabel}>{cat}</div>
          <div style={S.grid}>
            {RAWGEOM_GALLERY.filter(g=>g.cat===cat).map(g=>(
              <button key={g.kind} onClick={()=>setBig(g.kind)} style={S.tile}>
                <div style={S.tileStage}><LivePreview kind={g.kind}/></div>
                <div style={S.tileName}>{g.name}</div>
              </button>
            ))}
          </div>
        </div>
      ))}

      <p style={S.foot}>Leave with the back button or by clearing the
        <code> #raw-showcases</code> hash.</p>
    </div>
  </div>;
}

const S = {
  page:{ minHeight:"100vh", background:"#070810", color:"#cdd6ee", fontFamily:"Inter, system-ui, sans-serif", padding:"32px 16px" },
  wrap:{ maxWidth:1080, margin:"0 auto" },
  h1:{ fontSize:28, fontWeight:700, margin:"0 0 6px", color:"#dde6f8" },
  sub:{ color:"#8c98b8", margin:"0 0 8px", fontSize:14.5, lineHeight:1.55, maxWidth:760 },
  catLabel:{ textTransform:"uppercase", letterSpacing:0.6, fontSize:11.5, fontWeight:600, color:"#6f7ea0", margin:"0 0 10px" },
  grid:{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(232px, 1fr))", gap:14 },
  tile:{ padding:0, border:"1px solid #1a1e38", borderRadius:12, overflow:"hidden", background:"#0a0c18", cursor:"pointer", textAlign:"left", transition:"border-color .15s" },
  tileStage:{ width:"100%", height:170 },
  tileName:{ padding:"9px 12px", fontSize:13.5, color:"#b5c2e0", fontWeight:500 },
  btn:{ background:"#16203c", color:"#cfe0ff", border:"1px solid #2a3a66", borderRadius:8, padding:"8px 14px", fontSize:14, cursor:"pointer" },
  bigHead:{ display:"flex", alignItems:"baseline", gap:14, margin:"14px 0 8px" },
  bigName:{ fontSize:18, fontWeight:700, color:"#dde6f8" },
  bigCat:{ fontSize:12, textTransform:"uppercase", letterSpacing:0.5, color:"#6f7ea0" },
  bigLink:{ marginLeft:"auto", fontSize:13, color:"#7fb0ff", textDecoration:"none" },
  bigStage:{ width:"100%", height:520, borderRadius:12, overflow:"hidden", border:"1px solid #1a1e38" },
  foot:{ color:"#5a6788", fontSize:12, marginTop:28, textAlign:"center" },
};

export { RawShowcases, isRawShowcasesHash };
