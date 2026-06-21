import { useMemo } from "react";
import { useUI } from "../../theme/tokens.jsx";
import { sampleRawGeom } from "../../geometry/builders.js";
import { MathInput, EI, XF } from "../MathInput.jsx";
import { Sec, PR, Toggle, ColorRow } from "../primitives.jsx";

// rawGeom — explicit primitives typed in directly, in two source modes:
//   list  — literal data, one primitive per line
//   index — one template primitive whose coords are expressions over i / i,j,k / n
// Every vertex can be colored by a per-vertex scalar (Gouraud).
export function RawGeomEditor({ node, scope, onChange }){
  const{ui,S}=useUI();
  const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
  const p=node.props;
  const prim = p.prim || "segments";
  const src = p.src || "list";
  const isIdx = src==="index";

  const listField = prim==="points"?"rawPoints":prim==="segments"?"rawSegments":prim==="glyphs"?"rawGlyphs":"rawTris";
  const idxField  = prim==="points"?"idxPoints":prim==="segments"?"idxSegments":prim==="glyphs"?"idxGlyphs":"idxTris";

  // The vertex count requires sampling the whole geometry (JIT-compiling + running
  // the index lattice up to 20k verts/dim). Doing that on every render — including
  // the ~8Hz props-panel animation tick — is wasteful. Memoize on the inputs that
  // change it: the active data text, the count, and the scope's scalar values.
  const dataText = isIdx ? p[idxField] : p[listField];
  const scopeKey = useMemo(()=>Object.keys(scope||{}).sort().map(k=>{const v=scope[k];return typeof v==="number"?`${k}=${v}`:k;}).join(","), [scope]);
  const count = useMemo(()=>{
    try{ return sampleRawGeom(p, prim, scope).verts.length; }catch(e){ return 0; }
  }, [prim, src, dataText, p.idxCount, scopeKey]);

  const listHint = {
    points:    "one point per line:  x, y, z",
    segments:  "one segment per line:  x1,y1,z1 | x2,y2,z2",
    glyphs:    "one glyph per line:  px,py,pz | vx,vy,vz",
    triangles: "one triangle per line:  a | b | c  (each a,b,c is x,y,z)",
  }[prim];
  const idxHint = {
    points:    "x(i), y(i), z(i)",
    segments:  "start expr | end expr   (each x,y,z in i,j,k,n)",
    glyphs:    "position expr | vector expr   (in i,j,k,n)",
    triangles: "a | b | c   (each x,y,z in i,j,k,n)",
  }[prim];

  return <>
    <Sec title="Primitive">
      <PR label="kind">
        <select value={prim} onChange={e=>set("prim",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="points">points</option>
          <option value="segments">line segments (start to end)</option>
          <option value="glyphs">glyphs (point + vector)</option>
          <option value="triangles">triangles (filled)</option>
        </select>
      </PR>
      <PR label="source">
        <select value={src} onChange={e=>set("src",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="list">list (literal data)</option>
          <option value="index">index (expressions over i, j, k)</option>
        </select>
      </PR>
      <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        {isIdx
          ? <>One template primitive generated over a count. Coordinates are expressions in <em>i</em> (sequence) and <em>i, j, k</em> (lattice), plus <em>n</em> (flat index). Wired scalars and functions are in scope.</>
          : <>Type primitives directly, one per line. Numbers can reference wired sliders and constants.</>}
      </div>
    </Sec>

    {isIdx ? <Sec title="Template">
      <MathInput v={p[idxField]||""} sc={scope} multiline onChange={v=>set(idxField,v)} placeholder={idxHint}/>
      <PR label="count"><XF v={p.idxCount??"16"} sc={scope} onChange={v=>set("idxCount",v)}/></PR>
      <div style={{fontSize:12.5,color:ui.uiMuted,marginTop:4}}>
        {count} {prim}. Count "a" gives a along i; "a, b" or "a, b, c" gives an a x b (x c) lattice in i, j, k.
      </div>
    </Sec> : <Sec title="Data">
      <MathInput v={p[listField]||""} sc={scope} multiline onChange={v=>set(listField,v)} placeholder={listHint}/>
      <div style={{fontSize:12.5,color:ui.uiMuted,marginTop:4}}>{count} {prim}</div>
    </Sec>}

    <Sec title="Color">
      <PR label="per-vertex"><Toggle v={p.colorOn===true} onChange={v=>set("colorOn",v)}/></PR>
      {p.colorOn===true && <>
        <PR label="mode">
          <select value={p.colorMode||"ramp"} onChange={e=>set("colorMode",e.target.value)} style={{...S.inp,width:"100%"}}>
            <option value="ramp">ramp (scalar to gradient)</option>
            <option value="rgb">rgb (three channels)</option>
          </select>
        </PR>
        {(p.colorMode||"ramp")==="rgb" ? <>
          <PR label="R"><XF v={p.colorR??"512"} sc={scope} onChange={v=>set("colorR",v)} placeholder="0..1024"/></PR>
          <PR label="G"><XF v={p.colorG??"512"} sc={scope} onChange={v=>set("colorG",v)} placeholder="0..1024"/></PR>
          <PR label="B"><XF v={p.colorB??"512"} sc={scope} onChange={v=>set("colorB",v)} placeholder="0..1024"/></PR>
          <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
            Each channel is an expression in i,j,k,n,x,y,z,part valued 0 to 1024 (10-bit). Channels interpolate across the primitive.
          </div>
        </> : <>
          <PR label="value"><XF v={p.colorExpr??"i"} sc={scope} onChange={v=>set("colorExpr",v)} placeholder="scalar in i,j,k,n,x,y,z"/></PR>
          <PR label="low"><ColorRow v={p.colorLo||"#3a6aff"} onChange={v=>set("colorLo",v)}/></PR>
          <PR label="high"><ColorRow v={p.colorHi||"#ff5ea8"} onChange={v=>set("colorHi",v)}/></PR>
          <PR label="min"><XF v={p.colorMin??""} sc={scope} onChange={v=>set("colorMin",v)} placeholder="auto"/></PR>
          <PR label="max"><XF v={p.colorMax??""} sc={scope} onChange={v=>set("colorMax",v)} placeholder="auto"/></PR>
          <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
            Each vertex's scalar maps onto the low-to-high ramp and interpolates across the primitive. Leave min/max blank to auto-fit.
          </div>
        </>}
      </>}
    </Sec>

    <Sec title="Alpha">
      <PR label="per-vertex"><Toggle v={p.alphaOn===true} onChange={v=>set("alphaOn",v)}/></PR>
      {p.alphaOn===true && <>
        <PR label="value"><XF v={p.colorA??"1024"} sc={scope} onChange={v=>set("colorA",v)} placeholder="0..1024"/></PR>
        <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
          Opacity expression in i,j,k,n,x,y,z,part valued 0 to 1024 (10-bit). Triangles interpolate alpha per vertex; points, segments, and glyphs use the average.
        </div>
      </>}
    </Sec>

    {prim==="points" && <Sec title="Style">
      <PR label="radius"><EI v={p.radius??"0.08"} sc={scope} onChange={v=>set("radius",v)}/></PR>
      <PR label="connect"><Toggle v={p.drawLines===true} onChange={v=>set("drawLines",v)}/></PR>
    </Sec>}

    {prim==="glyphs" && <Sec title="Style">
      <PR label="arrow scale"><EI v={p.arrowLen??"0.5"} sc={scope} onChange={v=>set("arrowLen",v)}/></PR>
      <PR label="normalize"><Toggle v={p.normalize===true} onChange={v=>set("normalize",v)}/></PR>
      <div style={{fontSize:13,color:ui.uiFaint,marginTop:3}}>Off: length follows the vector magnitude. On: every arrow is the same length.</div>
    </Sec>}

    {prim==="triangles" && <Sec title="Display">
      <PR label="wireframe"><Toggle v={p.showWire!==false} onChange={v=>set("showWire",v)}/></PR>
    </Sec>}
  </>;
}
