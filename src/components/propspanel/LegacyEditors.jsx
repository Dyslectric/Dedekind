import { useUI } from "../../theme/tokens.jsx";
import { resolveNum } from "../../core/math.js";
import { parsePointSeq, parseGlyphField } from "../../geometry/parse.js";
import { EI, XF, MathInput } from "../MathInput.jsx";
import { Sec, PR, Toggle, ColorRow } from "../primitives.jsx";

// Legacy geometry nodes — kept so projects saved before the unified
// points / paramSpace / scalarFn nodes still load and render. New projects
// shouldn't create these, but the editors remain for back-compat.

export function PointEditor({ node, scope, onChange }){
  return <Sec title="Position">{[["x","x"],["y","y"],["z","z"],["r","radius"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec>;
}

export function PointSeqEditor({ node, scope, onChange }){
  const{ui,S}=useUI();
  return <>
    <Sec title="Points">
      <div style={{fontSize:14,color:ui.uiMuted,marginBottom:5,lineHeight:1.7}}>
        <strong style={{color:"#7fa0d8"}}>Plain:</strong> one point per line — <span style={{color:ui.uiText}}>x, y</span> or <span style={{color:ui.uiText}}>x, y, z</span><br/>
        <strong style={{color:"#7fcf9a"}}>Recursive:</strong> 3-line format:<br/>
        <span style={{color:ui.uiText,fontFamily:"monospace",fontSize:13}}>
          &nbsp;Line 1: initial point &nbsp;<em>x₀, y₀</em><br/>
          &nbsp;Line 2: recurrence &nbsp;<em>x[n-1]+1, y[n-1]*0.9</em><br/>
          &nbsp;Line 3: count &nbsp;<em>50</em>
        </span><br/>
        <strong style={{color:"#7fa0d8"}}>By index:</strong> closed-form in <em>i</em> (0-based):<br/>
        <span style={{color:ui.uiText,fontFamily:"monospace",fontSize:13}}>
          &nbsp;Line 1: <em>cos(i*0.3), sin(i*0.3)</em><br/>
          &nbsp;Line 2: count &nbsp;<em>64</em>
        </span><br/>
        <strong style={{color:"#7fa0d8"}}>Matrix:</strong> 2-D index <em>i, j</em> → a grid:<br/>
        <span style={{color:ui.uiText,fontFamily:"monospace",fontSize:13}}>
          &nbsp;Line 1: <em>i, j, sin(i*j)</em><br/>
          &nbsp;Line 2: rows, cols &nbsp;<em>8, 8</em>
        </span>
      </div>
      <textarea
        value={node.props.points||""}
        onChange={e=>onChange({props:{...node.props,points:e.target.value}})}
        rows={10}
        style={{...S.inp,width:"100%",resize:"vertical",lineHeight:1.7,fontFamily:"monospace",fontSize:15}}
        placeholder={"Plain:\n0, 0\n1, 1\n2, 0\n\nRecursive:\n1, 0\nx[n-1]*0.99, y[n-1]+0.1\n80\n\nBy index:\ncos(i*0.3), sin(i*0.3)\n64\n\nMatrix:\ni, j, sin(i*j)\n8, 8"}
      />
      <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
        <PR label="radius"><EI v={node.props.radius||"4"} sc={scope} onChange={v=>onChange({props:{...node.props,radius:v}})}/></PR>
        <PR label="lines"><Toggle v={node.props.drawLines!==false} onChange={v=>onChange({props:{...node.props,drawLines:v}})}/></PR>
      </div>
      <div style={{marginTop:5,color:ui.uiMuted,fontSize:14}}>
        {(()=>{const pts=parsePointSeq(node.props.points,scope);return`${pts.length} valid point${pts.length!==1?"s":""}`;})()}
      </div>
    </Sec>
    <Sec title="Sequencing">
      <div style={{fontSize:14,color:ui.uiMuted,marginBottom:5,lineHeight:1.6}}>
        Reveal points in order. Drive the fraction (0–1) with a literal or a connected scalar (e.g. an animator) to animate the build-up without rebuilding geometry.
      </div>
      <PR label="reveal"><Toggle v={!!node.props.sequenced} onChange={v=>onChange({props:{...node.props,sequenced:v}})}/></PR>
      {node.props.sequenced&&<>
        <PR label="frac"><EI v={node.props.seqFrac??"1"} sc={scope} onChange={v=>onChange({props:{...node.props,seqFrac:v}})}/></PR>
        <PR label="var"><input value={node.props.seqVar||""} placeholder="(scalar name, optional)" onChange={e=>onChange({props:{...node.props,seqVar:e.target.value}})} style={{...S.inp,width:"100%"}}/></PR>
      </>}
    </Sec>
  </>;
}

export function GlyphFieldEditor({ node, scope, onChange, meta }){
  const{ui,S}=useUI();
  return <><Sec title="Pairs (seed | vector)">
    <div style={{fontSize:14,color:ui.uiFaint,marginBottom:5,lineHeight:1.7}}>
      <strong style={{color:ui.uiMuted}}>Plain:</strong> one pair per line —<br/>
      <span style={{color:ui.uiMuted,fontFamily:"monospace",fontSize:13}}>x, y, z | vx, vy, vz</span><br/>
      <strong style={{color:ui.uiMuted}}>Sequence:</strong> 3 lines, each pair may depend on the previous:<br/>
      <span style={{color:ui.uiMuted,fontFamily:"monospace",fontSize:13}}>
        &nbsp;init: <em>x₀,y₀,z₀ | vx₀,vy₀,vz₀</em><br/>
        &nbsp;rec: <em>x[n-1]+vx[n-1]*0.1, … | -y[n-1], x[n-1], …</em><br/>
        &nbsp;count: <em>200</em>
      </span><br/>
      <strong style={{color:ui.uiMuted}}>By index:</strong> closed-form in <em>i</em>, then a count:<br/>
      <span style={{color:ui.uiMuted,fontFamily:"monospace",fontSize:13}}>
        &nbsp;<em>cos(i*0.5), sin(i*0.5), 0 | -sin(i*0.5), cos(i*0.5), 0</em><br/>
        &nbsp;<em>48</em>
      </span><br/>
      <strong style={{color:ui.uiMuted}}>Matrix:</strong> 2-D index <em>i, j</em>, then rows, cols:<br/>
      <span style={{color:ui.uiMuted,fontFamily:"monospace",fontSize:13}}>
        &nbsp;<em>i, j, 0 | sin(i), cos(j), 0</em><br/>
        &nbsp;<em>8, 8</em>
      </span><br/>
      Expressions may use any wired scalars/functions.
    </div>
    <MathInput v={node.props.pairs||""} sc={scope} multiline onChange={v=>onChange({props:{...node.props,pairs:v}})}
      placeholder={"Plain:\n0,0,0 | 1,0,0\n1,1,0 | 0,1,0\n\nSequence:\n2,0,0 | 0,1,0\nx[n-1]+vx[n-1]*0.1, y[n-1]+vy[n-1]*0.1, 0 | -y[n-1], x[n-1], 0\n200\n\nBy index:\ncos(i*0.5), sin(i*0.5), 0 | -sin(i*0.5), cos(i*0.5), 0\n48\n\nMatrix:\ni, j, 0 | sin(i), cos(j), 0\n8, 8"}/>
    <div style={{marginTop:5,color:ui.uiFaint,fontSize:14}}>
      {(()=>{const g=parseGlyphField(node.props.pairs,scope);return`${g.length} glyph${g.length!==1?"s":""}`;})()}
    </div>
  </Sec><Sec title="Glyph style">
    {(()=>{
      const lenMode=node.props.lenMode||(node.props.normalize===false?"scaled":"uniform");
      const showLen=lenMode!=="raw";
      return <>
      <PR label="length mode">
        <select value={lenMode} onChange={e=>onChange({props:{...node.props,lenMode:e.target.value}})} style={{...S.inp,width:"100%"}}>
          <option value="uniform">uniform (all same length)</option>
          <option value="scaled">scaled (relative to max)</option>
          <option value="raw">raw magnitude (|vec|)</option>
        </select>
      </PR>
      {showLen&&<PR label="length">
        <EI v={node.props.arrowLen??"0.5"} sc={scope} onChange={v=>onChange({props:{...node.props,arrowLen:v}})}/>
        <input type="range" min="0.05" max="3" step="0.05"
          value={resolveNum(node.props.arrowLen,scope,0.5)}
          onChange={e=>onChange({props:{...node.props,arrowLen:String(+e.target.value)}})}
          style={{width:"100%",accentColor:meta.tc,marginTop:4}}/>
      </PR>}
      <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        {lenMode==="raw"
          ? <>Arrow length equals the vector magnitude <em>|vec|</em> directly — length ignored.</>
          : lenMode==="scaled"
          ? <>Each arrow scales by <em>|vec| / max(|vec|)</em>, longest arrow = length.</>
          : <>Every arrow drawn at the fixed length above.</>}
      </div>
      </>;
    })()}
  </Sec><Sec title="Flow animation">
    <PR label="mode">
      <select value={node.props.anim||"crest"} onChange={e=>onChange({props:{...node.props,anim:e.target.value}})} style={{...S.inp,width:"100%"}}>
        <option value="none">none (static)</option>
        <option value="pulse">pulse (breathe)</option>
        <option value="crest">crest (travelling highlight)</option>
        <option value="advect">advect (slide & loop)</option>
      </select>
    </PR>
    {node.props.anim!=="none"&&<>
      <PR label="speed"><EI v={node.props.speed??"1"} sc={scope} onChange={v=>onChange({props:{...node.props,speed:v}})}/></PR>
      {(node.props.anim==="crest"||!node.props.anim)&&<PR label="crest"><ColorRow v={node.props.crestColor||"#ffffff"} onChange={v=>onChange({props:{...node.props,crestColor:v}})}/></PR>}
    </>}
  </Sec></>;
}

export function Quiver2dEditor({ node, scope, onChange }){
  return <><Sec title="Field">
    <PR label="vx(x,y)"><XF v={node.props.exprX} sc={scope} onChange={v=>onChange({props:{...node.props,exprX:v}})}/></PR>
    <PR label="vy(x,y)"><XF v={node.props.exprY} sc={scope} onChange={v=>onChange({props:{...node.props,exprY:v}})}/></PR>
  </Sec><Sec title="Grid">
    {[["n","gridN"],["x₀","xMin"],["x₁","xMax"],["y₀","yMin"],["y₁","yMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
    <PR label="norm"><Toggle v={node.props.normalize!==false} onChange={v=>onChange({props:{...node.props,normalize:v}})}/></PR>
  </Sec></>;
}

export function Quiver3dEditor({ node, scope, onChange }){
  return <><Sec title="Field">
    <PR label="vx(x,y,z)"><XF v={node.props.exprX} sc={scope} onChange={v=>onChange({props:{...node.props,exprX:v}})}/></PR>
    <PR label="vy(x,y,z)"><XF v={node.props.exprY} sc={scope} onChange={v=>onChange({props:{...node.props,exprY:v}})}/></PR>
    <PR label="vz(x,y,z)"><XF v={node.props.exprZ} sc={scope} onChange={v=>onChange({props:{...node.props,exprZ:v}})}/></PR>
  </Sec><Sec title="Grid">
    <PR label="n/axis"><EI v={node.props.gridN} sc={scope} onChange={v=>onChange({props:{...node.props,gridN:v}})}/></PR>
    {[["x₀","xMin"],["x₁","xMax"],["y₀","yMin"],["y₁","yMax"],["z₀","zMin"],["z₁","zMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
    <PR label="norm"><Toggle v={node.props.normalize!==false} onChange={v=>onChange({props:{...node.props,normalize:v}})}/></PR>
  </Sec></>;
}

export function Fn1dEditor({ node, scope, onChange }){
  return <><Sec title="Expression"><PR label="y(x)"><XF v={node.props.expr} sc={scope} onChange={v=>onChange({props:{...node.props,expr:v}})}/></PR></Sec><Sec title="Domain">{[["x₀","xMin"],["x₁","xMax"],["res","res"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec></>;
}

export function Curve3dEditor({ node, scope, onChange }){
  return <><Sec title="Parametric">{[["x(t)","exprX"],["y(t)","exprY"],["z(t)","exprZ"]].map(([l,k])=><PR key={k} label={l}><XF v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec><Sec title="Domain">{[["t₀","tMin"],["t₁","tMax"],["res","res"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec></>;
}

export function Surf3dEditor({ node, scope, onChange }){
  return <><Sec title="Expression"><PR label="z(x,y)"><XF v={node.props.expr} sc={scope} onChange={v=>onChange({props:{...node.props,expr:v}})}/></PR></Sec><Sec title="Domain">{[["x₀","xMin"],["x₁","xMax"],["y₀","yMin"],["y₁","yMax"],["res","res"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec><Sec title="Display"><PR label="wireframe"><Toggle v={node.props.showWire!==false} onChange={v=>onChange({props:{...node.props,showWire:v}})}/></PR></Sec></>;
}

export function ParamSurfEditor({ node, scope, onChange }){
  return <><Sec title="Parametric">{[["x(u,v)","exprX"],["y(u,v)","exprY"],["z(u,v)","exprZ"]].map(([l,k])=><PR key={k} label={l}><XF v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec><Sec title="Domain">{[["u₀","uMin"],["u₁","uMax"],["v₀","vMin"],["v₁","vMax"],["uRes","uRes"],["vRes","vRes"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec><Sec title="Display"><PR label="wireframe"><Toggle v={node.props.showWire!==false} onChange={v=>onChange({props:{...node.props,showWire:v}})}/></PR></Sec></>;
}
