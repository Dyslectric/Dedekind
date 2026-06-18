import { useUI } from "../../theme/tokens.jsx";
import { resolveNum } from "../../core/math.js";
import { parsePointsExplicit, parseGlyphsExplicit } from "../../geometry/parse.js";
import { EI, XF, MathInput, NameField } from "../MathInput.jsx";
import { Sec, PR, Toggle, ColorRow } from "../primitives.jsx";

// points — unified points / glyphs / sequences node. Three source modes (list,
// index, recursive), an optional per-entry color slot, point or glyph styling,
// and (for points) a sequencing reveal.
export function PointsEditor({ node, scope, onChange, meta }){
  const{ui,S}=useUI();
  const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
  const kind = node.props.kind || (node.props.hasVectors ? "glyphs" : "points");
  const mode = node.props.mode || "list";
  const useColor = !!node.props.useColor;
  const isGlyph = kind==="glyphs";
  // live count for the footer
  let count=0;
  try{
    count = isGlyph ? parseGlyphsExplicit(node.props,scope).pairs.length
                    : parsePointsExplicit(node.props,scope).pts.length;
  }catch(e){ count=0; }
  // tuple shape hint
  const tupleHint = isGlyph
    ? "(x, y[, z]) | (vx, vy[, vz])"
    : "(x, y[, z])";
  const colorSlotHint = useColor
    ? (isGlyph ? " | color" : ", color")
    : "";
  return <>
    <Sec title="Kind">
      <PR label="type">
        <select value={kind} onChange={e=>set("kind",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="points">points</option>
          <option value="glyphs">glyphs (point + vector)</option>
        </select>
      </PR>
      <PR label="source">
        <select value={mode} onChange={e=>set("mode",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="list">list (explicit entries)</option>
          <option value="index">by index (i, j, k, n)</option>
          <option value="recursive">recursive (x[n-k]…)</option>
        </select>
      </PR>
      <PR label="color slot"><Toggle v={useColor} onChange={v=>set("useColor",v)}/></PR>
      <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        Each entry is <em>{tupleHint}{colorSlotHint}</em>.{" "}
        {useColor && <>The color slot is a scalar mapped onto the ramp below{mode==="recursive"?", and may reference c[n-1]":""}.</>}
      </div>
    </Sec>

    {/* ── LIST ── */}
    {mode==="list" && !isGlyph && <Sec title="Points (list)">
      <div style={{fontSize:13,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
        One ordered pair or triple per line (commas inside, lines or <em>;</em> between).{" "}
        {useColor && <>Append a trailing value for color: <span style={{fontFamily:"monospace"}}>x, y, z, c</span>.</>}
      </div>
      <MathInput v={node.props.listPoints||""} sc={scope} multiline onChange={v=>set("listPoints",v)}
        placeholder={useColor?"0, 0, 0\n1, 1, 2\n2, 0, 4":"0, 0\n1, 1\n2, 0\n3, 1"}/>
    </Sec>}
    {mode==="list" && isGlyph && <Sec title="Glyphs (list)">
      <div style={{fontSize:13,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
        One glyph per line as <em>seed | vector</em>, each an ordered pair or triple.{" "}
        {useColor && <>Add a third <em>| color</em> segment for the color scalar.</>}
      </div>
      <MathInput v={node.props.listGlyphs||""} sc={scope} multiline onChange={v=>set("listGlyphs",v)}
        placeholder={useColor?"0, 0 | 1, 0 | 0\n1, 1 | 0, 1 | 1":"0, 0 | 1, 0\n1, 1 | 0, 1\n2, 0 | 1, 0"}/>
    </Sec>}

    {/* ── INDEX ── */}
    {mode==="index" && <Sec title={isGlyph?"Glyph by index":"Point by index"}>
      <div style={{fontSize:13,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
        A closed form in <em>i</em> (also <em>j, k</em> for a grid, and <em>n</em> = flat index).{" "}
        {isGlyph?<>Written as <em>seed | vector</em>.</>:null}
      </div>
      <PR label={isGlyph?"seed | vector":"tuple"}>
        <EI v={(isGlyph?node.props.idxGlyph:node.props.idxPoint)||""} sc={scope}
          onChange={v=>set(isGlyph?"idxGlyph":"idxPoint",v)}
          placeholder={isGlyph?"cos(i), sin(i) | -sin(i), cos(i)":"cos(i*0.3), sin(i*0.3)"}/>
      </PR>
      {useColor && <PR label="color">
        <EI v={node.props.colExpr??"i"} sc={scope} onChange={v=>set("colExpr",v)} placeholder="i"/>
      </PR>}
      <PR label="count">
        <EI v={(isGlyph?node.props.idxGlyphCount:node.props.idxCount)||""} sc={scope}
          onChange={v=>set(isGlyph?"idxGlyphCount":"idxCount",v)} placeholder="64"/>
      </PR>
      <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        Count applies in all directions: <em>a</em> → a row of a; <em>a, b</em> → an a×b grid (i, j); <em>a, b, c</em> → a×b×c (i, j, k).
      </div>
    </Sec>}

    {/* ── RECURSIVE ── */}
    {mode==="recursive" && <Sec title={isGlyph?"Recursive glyphs":"Recursive points"}>
      <div style={{fontSize:13,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
        Each entry depends on the previous via <em>x[n-1], y[n-1]{isGlyph?", vx[n-1], vy[n-1]":""}</em> (any depth k).
      </div>
      <PR label="initial">
        <EI v={(isGlyph?node.props.recGlyphInit:node.props.recInit)||""} sc={scope}
          onChange={v=>set(isGlyph?"recGlyphInit":"recInit",v)}
          placeholder={isGlyph?"4, 4 | 0, 1":"1, 0"}/>
      </PR>
      <PR label="next">
        <MathInput v={(isGlyph?node.props.recGlyphStep:node.props.recStep)||""} sc={scope} multiline
          onChange={v=>set(isGlyph?"recGlyphStep":"recStep",v)}
          placeholder={isGlyph?"x[n-1]*0.97 - y[n-1]*0.12, y[n-1]*0.97 + x[n-1]*0.12 | vx[n-1], vy[n-1]":"x[n-1]*0.99, y[n-1]+0.1"}/>
      </PR>
      {useColor && <>
        <PR label="color init"><EI v={node.props.colRecInit??"0"} sc={scope} onChange={v=>set("colRecInit",v)} placeholder="0"/></PR>
        <PR label="color next"><EI v={node.props.colRecStep??"c[n-1]+1"} sc={scope} onChange={v=>set("colRecStep",v)} placeholder="c[n-1]+1"/></PR>
      </>}
      <PR label="count">
        <EI v={(isGlyph?node.props.recGlyphCount:node.props.recCount)||""} sc={scope}
          onChange={v=>set(isGlyph?"recGlyphCount":"recCount",v)} placeholder="80"/>
      </PR>
    </Sec>}

    <div style={{margin:"4px 0 2px",color:ui.uiFaint,fontSize:14,paddingLeft:2}}>
      {count} {isGlyph?`glyph${count!==1?"s":""}`:`valid point${count!==1?"s":""}`}
    </div>

    {!isGlyph&&<Sec title="Point style">
      <PR label="radius"><EI v={node.props.radius||"4"} sc={scope} onChange={v=>set("radius",v)}/></PR>
      <PR label="lines"><Toggle v={node.props.drawLines!==false} onChange={v=>set("drawLines",v)}/></PR>
    </Sec>}

    {/* Color ramp — endpoints for the color slot (or legacy gradient). */}
    {useColor ? <Sec title="Color ramp">
      <PR label="ramp">
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <input type="color" value={node.props.colorLo||"#3a6aff"} onChange={e=>set("colorLo",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
          <div style={{flex:1,height:12,borderRadius:3,background:`linear-gradient(90deg, ${node.props.colorLo||"#3a6aff"}, ${node.props.colorHi||"#ff5ea8"})`}}/>
          <input type="color" value={node.props.colorHi||"#ff5ea8"} onChange={e=>set("colorHi",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
        </div>
      </PR>
      <PR label="min"><EI v={node.props.colorMin??""} sc={scope} onChange={v=>set("colorMin",v)} placeholder="auto"/></PR>
      <PR label="max"><EI v={node.props.colorMax??""} sc={scope} onChange={v=>set("colorMax",v)} placeholder="auto"/></PR>
      <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        Each entry's color scalar maps across the range (blank = auto-fit) onto this ramp.
      </div>
    </Sec> : (!isGlyph && <Sec title="Coloring">
      <PR label="mode">
        <select value={node.props.colorMode||"off"} onChange={e=>set("colorMode",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="off">single color</option>
          <option value="gradient">gradient by value</option>
        </select>
      </PR>
      {(node.props.colorMode||"off")==="gradient"&&<>
        <PR label="value"><XF v={node.props.colorExpr??"i"} sc={scope} onChange={v=>set("colorExpr",v)}/></PR>
        <PR label="ramp">
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <input type="color" value={node.props.colorLo||"#3a6aff"} onChange={e=>set("colorLo",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
            <div style={{flex:1,height:12,borderRadius:3,background:`linear-gradient(90deg, ${node.props.colorLo||"#3a6aff"}, ${node.props.colorHi||"#ff5ea8"})`}}/>
            <input type="color" value={node.props.colorHi||"#ff5ea8"} onChange={e=>set("colorHi",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
          </div>
        </PR>
        <PR label="min"><EI v={node.props.colorMin??""} sc={scope} onChange={v=>set("colorMin",v)} placeholder="auto"/></PR>
        <PR label="max"><EI v={node.props.colorMax??""} sc={scope} onChange={v=>set("colorMax",v)} placeholder="auto"/></PR>
        <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
          Each point's <em>value</em> (vars: <em>i</em> index, <em>n</em> count, <em>x, y, z</em>, wired scalars) maps across the range — leave min/max blank to auto-fit — onto the ramp.
        </div>
      </>}
    </Sec>)}

    {isGlyph&&(()=>{
      const lenMode=node.props.lenMode||(node.props.normalize===false?"scaled":"uniform");
      const showLen=lenMode!=="raw";
      return <><Sec title="Glyph style">
      <PR label="length mode">
        <select value={lenMode} onChange={e=>set("lenMode",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="uniform">uniform (all same length)</option>
          <option value="scaled">scaled (relative to max)</option>
          <option value="raw">raw magnitude (|vec|)</option>
        </select>
      </PR>
      {showLen&&<PR label="length">
        <EI v={node.props.arrowLen??"0.5"} sc={scope} onChange={v=>set("arrowLen",v)}/>
        <input type="range" min="0.05" max="3" step="0.05"
          value={resolveNum(node.props.arrowLen,scope,0.5)}
          onChange={e=>set("arrowLen",String(+e.target.value))}
          style={{width:"100%",accentColor:meta.tc,marginTop:4}}/>
      </PR>}
      <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        {lenMode==="raw"
          ? <>Arrow length equals the vector magnitude <em>|vec|</em> directly — length ignored.</>
          : lenMode==="scaled"
          ? <>Each arrow scales by <em>|vec| / max(|vec|)</em>, longest arrow = length.</>
          : <>Every arrow drawn at the fixed length above.</>}
      </div>
    </Sec><Sec title="Flow animation">
      <PR label="mode">
        <select value={node.props.anim||"crest"} onChange={e=>set("anim",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="none">none (static)</option>
          <option value="pulse">pulse (breathe)</option>
          <option value="crest">crest (travelling highlight)</option>
          <option value="advect">advect (slide & loop)</option>
        </select>
      </PR>
      {node.props.anim!=="none"&&<>
        <PR label="speed"><EI v={node.props.speed??"1"} sc={scope} onChange={v=>set("speed",v)}/></PR>
        {(node.props.anim==="crest"||!node.props.anim)&&<PR label="crest"><ColorRow v={node.props.crestColor||"#ffffff"} onChange={v=>set("crestColor",v)}/></PR>}
      </>}
    </Sec></>;
    })()}
    {!isGlyph&&<Sec title="Sequencing">
      <div style={{fontSize:14,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
        Reveal points in order. Drive the fraction (0–1) with a literal or a connected scalar (e.g. an animator).
      </div>
      <PR label="reveal"><Toggle v={!!node.props.sequenced} onChange={v=>set("sequenced",v)}/></PR>
      {node.props.sequenced&&<>
        <PR label="frac"><EI v={node.props.seqFrac??"1"} sc={scope} onChange={v=>set("seqFrac",v)}/></PR>
        <PR label="var"><NameField v={node.props.seqVar||""} placeholder="scalar name (optional)" onChange={val=>set("seqVar",val)}/></PR>
      </>}
    </Sec>}
  </>;
}
