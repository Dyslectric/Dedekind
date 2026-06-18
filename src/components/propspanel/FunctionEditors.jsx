import { useUI } from "../../theme/tokens.jsx";
import { TYPE_META } from "../../nodes/model.js";
import { EI, XF } from "../MathInput.jsx";
import { Sec, PR, Toggle, ColorRow } from "../primitives.jsx";

// fnMap — a pure map real^m → real^n. Does not plot on its own; it is wired
// into a Transformer.
export function FnMapEditor({ node, scope, onChange }){
  const{ui,S}=useUI();
  const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
  const inDim=Math.max(1,Math.min(3,Math.round(Number(node.props.inDim||"1"))));
  const outDim=Math.max(1,Math.min(4,Math.round(Number(node.props.outDim||"1"))));
  const inVars=["x","y","z"].slice(0,inDim).join(", ");
  return <>
    <Sec title="Signature">
      <PR label="inputs">
        <select value={String(inDim)} onChange={e=>set("inDim",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="1">1 — f(x)</option>
          <option value="2">2 — f(x, y)</option>
          <option value="3">3 — f(x, y, z)</option>
        </select>
      </PR>
      <PR label="outputs">
        <select value={String(outDim)} onChange={e=>set("outDim",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="1">1 — scalar</option>
          <option value="2">2 — vector (2D)</option>
          <option value="3">3 — vector (3D)</option>
          <option value="4">4 — four components</option>
        </select>
      </PR>
      <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        A pure map from {inDim} input{inDim>1?"s":""} to {outDim} output{outDim>1?"s":""}, in the variables <em>{inVars}</em>. It does not plot on its own — wire it into a <strong style={{color:TYPE_META.transformer.tc}}>Transformer</strong> to render it as a function plot or a vector field, where each output can be bound to a spatial axis or to color.
      </div>
    </Sec>
    <Sec title={`Components ( in ${inVars} )`}>
      {Array.from({length:outDim}).map((_,k)=>(
        <PR key={k} label={`out${k}`}><XF v={node.props["out"+k]} sc={scope} onChange={v=>set("out"+k,v)}/></PR>
      ))}
    </Sec>
  </>;
}

// equation — implicit relation lhs = rhs, in 2 or 3 variables.
export function EquationEditor({ node, scope, onChange }){
  const{ui,S}=useUI();
  const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
  const is3d=(node.props.dims||"2d")==="3d";
  const varA=(node.props.varA||"x").trim()||"x";
  const varB=(node.props.varB||"y").trim()||"y";
  const varC=(node.props.varC||"z").trim()||"z";
  return <>
    <Sec title="Type">
      <PR label="dims">
        <select value={node.props.dims||"2d"} onChange={e=>set("dims",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="2d">2D — curve in {varA},{varB} (marching squares)</option>
          <option value="3d">3D — surface in {varA},{varB},{varC} (marching cubes)</option>
        </select>
      </PR>
      <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        {is3d
          ? <>The surface where <em>lhs = rhs</em> in three variables, extracted as a triangle mesh. Wire into a <strong style={{color:TYPE_META.transformer.tc}}>Transformer</strong>; its three domain ranges set the sampling box.</>
          : <>The curve where <em>lhs = rhs</em> in two variables. Wire into a <strong style={{color:TYPE_META.transformer.tc}}>Transformer</strong>; its first two domain ranges set the sampling box.</>}
      </div>
    </Sec>
    <Sec title="Relation">
      <PR label="lhs"><XF v={node.props.lhs||""} sc={scope} onChange={v=>set("lhs",v)}/></PR>
      <div style={{textAlign:"center",color:TYPE_META.equation.tc,fontWeight:"bold",fontSize:16,margin:"2px 0"}}>=</div>
      <PR label="rhs"><XF v={node.props.rhs||""} sc={scope} onChange={v=>set("rhs",v)}/></PR>
    </Sec>
    <Sec title="Variables">
      <PR label="a (→X)"><input value={node.props.varA||"x"} onChange={e=>set("varA",e.target.value.replace(/[^a-zA-Z0-9_]/g,""))} style={{...S.inp,width:"100%"}}/></PR>
      <PR label="b (→Y)"><input value={node.props.varB||"y"} onChange={e=>set("varB",e.target.value.replace(/[^a-zA-Z0-9_]/g,""))} style={{...S.inp,width:"100%"}}/></PR>
      {is3d&&<PR label="c (→Z)"><input value={node.props.varC||"z"} onChange={e=>set("varC",e.target.value.replace(/[^a-zA-Z0-9_]/g,""))} style={{...S.inp,width:"100%"}}/></PR>}
      <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        Plotting <em>{node.props.lhs||"lhs"} = {node.props.rhs||"rhs"}</em> over the {is3d?<><em>{varA}</em>,<em>{varB}</em>,<em>{varC}</em> space</>:<><em>{varA}</em>–<em>{varB}</em> plane</>}.
      </div>
    </Sec>
  </>;
}

// scalarFn — unified scalar-valued function: y(x), z(x,y), or f(x,y,z).
export function ScalarFnEditor({ node, scope, onChange }){
  const{ui,S}=useUI();
  const dims=String(node.props.dims||"1");
  const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
  const label = dims==="1"?"y(x)":dims==="2"?"z(x,y)":"f(x,y,z)";
  return <>
    <Sec title="Dimensions">
      <PR label="inputs">
        <select value={dims} onChange={e=>set("dims",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="1">1 — curve  y(x)</option>
          <option value="2">2 — surface  z(x,y)</option>
          <option value="3">3 — volume  f(x,y,z)</option>
        </select>
      </PR>
      <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        How many spatial inputs the function takes. 1→a curve, 2→a surface, 3→a value-coloured point cloud.
      </div>
    </Sec>
    <Sec title="Expression">
      <PR label={label}><XF v={node.props.expr} sc={scope} onChange={v=>set("expr",v)}/></PR>
    </Sec>
    <Sec title="Domain">
      {[["x₀","xMin"],["x₁","xMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      {dims!=="1"&&[["y₀","yMin"],["y₁","yMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      {dims==="3"&&[["z₀","zMin"],["z₁","zMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      <PR label="res"><EI v={node.props.res} sc={scope} onChange={v=>set("res",v)}/></PR>
    </Sec>
    {dims==="3"&&<Sec title="Colour by value">
      <PR label="enable"><Toggle v={!!node.props.colorByValue} onChange={v=>set("colorByValue",v)}/></PR>
      {node.props.colorByValue&&<>
        <PR label="low"><ColorRow v={node.props.colorLo||"#3a6df0"} onChange={v=>set("colorLo",v)}/></PR>
        <PR label="high"><ColorRow v={node.props.colorHi||"#f0533a"} onChange={v=>set("colorHi",v)}/></PR>
      </>}
    </Sec>}
    {dims==="2"&&<Sec title="Display">
      <PR label="wireframe"><Toggle v={node.props.showWire!==false} onChange={v=>set("showWire",v)}/></PR>
      <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        Draws grid lines over the surface. Turning it off renders a single shaded mesh — faster for dense or animated surfaces.
      </div>
    </Sec>}
  </>;
}

// paramSpace — unified parameterized manifold: curve (t), surface (u,v), or
// volume (u,v,w).
export function ParamSpaceEditor({ node, scope, onChange }){
  const{ui,S}=useUI();
  const deg=String(node.props.degree||"1");
  const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
  return <>
    <Sec title="Manifold">
      <PR label="degree">
        <select value={deg} onChange={e=>set("degree",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="1">1 — curve (param t)</option>
          <option value="2">2 — surface (params u,v)</option>
          <option value="3">3 — volume (params u,v,w)</option>
        </select>
      </PR>
      <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        A curve is parameterized by one variable (t); a surface by two (u,v); a volume by three (u,v,w), all mapped into 3-D space. For a 2-D curve, set z(t)=0.
      </div>
    </Sec>
    {deg==="1"?<>
      <Sec title="Parametric x,y,z (t)">
        {[["x(t)","exprX"],["y(t)","exprY"],["z(t)","exprZ"]].map(([l,k])=><PR key={k} label={l}><XF v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      </Sec>
      <Sec title="Domain">
        {[["t₀","tMin"],["t₁","tMax"],["res","res"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      </Sec>
    </>:deg==="2"?<>
      <Sec title="Parametric x,y,z (u,v)">
        {[["x(u,v)","exprXu"],["y(u,v)","exprYu"],["z(u,v)","exprZu"]].map(([l,k])=><PR key={k} label={l}><XF v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      </Sec>
      <Sec title="Domain">
        {[["u₀","uMin"],["u₁","uMax"],["v₀","vMin"],["v₁","vMax"],["uRes","uRes"],["vRes","vRes"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      </Sec>
      <Sec title="Display">
        <PR label="wireframe"><Toggle v={node.props.showWire!==false} onChange={v=>set("showWire",v)}/></PR>
      </Sec>
    </>:<>
      <Sec title="Parametric x,y,z (u,v,w)">
        {[["x(u,v,w)","exprXw"],["y(u,v,w)","exprYw"],["z(u,v,w)","exprZw"]].map(([l,k])=><PR key={k} label={l}><XF v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
        <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
          Three parameters sweep a solid region, drawn as a point cloud filling the image. Keep the resolutions modest — the point count is uRes×vRes×wRes.
        </div>
      </Sec>
      <Sec title="Domain">
        {[["u₀","uMin"],["u₁","uMax"],["v₀","vMin"],["v₁","vMax"],["w₀","wMin"],["w₁","wMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
        {[["uRes","uRes3"],["vRes","vRes3"],["wRes","wRes3"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      </Sec>
      <Sec title="Coloring">
        <PR label="mode">
          <select value={node.props.volColorMode||"off"} onChange={e=>set("volColorMode",e.target.value)} style={{...S.inp,width:"100%"}}>
            <option value="off">single color</option>
            <option value="gradient">gradient by value</option>
          </select>
        </PR>
        {(node.props.volColorMode||"off")==="gradient"&&<>
          <PR label="value"><XF v={node.props.volColorExpr??"u"} sc={scope} onChange={v=>set("volColorExpr",v)}/></PR>
          <PR label="ramp">
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <input type="color" value={node.props.volColorLo||"#3a6aff"} onChange={e=>set("volColorLo",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
              <div style={{flex:1,height:12,borderRadius:3,background:`linear-gradient(90deg, ${node.props.volColorLo||"#3a6aff"}, ${node.props.volColorHi||"#ff5ea8"})`}}/>
              <input type="color" value={node.props.volColorHi||"#ff5ea8"} onChange={e=>set("volColorHi",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
            </div>
          </PR>
          <PR label="min"><EI v={node.props.volColorMin??""} sc={scope} onChange={v=>set("volColorMin",v)} placeholder="auto"/></PR>
          <PR label="max"><EI v={node.props.volColorMax??""} sc={scope} onChange={v=>set("volColorMax",v)} placeholder="auto"/></PR>
          <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
            Color each point by <em>value</em> (params <em>u, v, w</em>, plus wired scalars), across the range onto the ramp.
          </div>
        </>}
      </Sec>
    </>}
  </>;
}
