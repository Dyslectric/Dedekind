import { useUI } from "../../theme/tokens.jsx";
import { resolveNum } from "../../core/math.js";
import { TYPE_META } from "../../nodes/model.js";
import { EI } from "../MathInput.jsx";
import { Sec, PR, Toggle } from "../primitives.jsx";

// transformer — renders a wired fnMap over a domain (function plot or vector
// field), or an implicit equation as a curve/surface. The bulk of the panel's
// per-output binding logic lives here.
export function TransformerEditor({ node, nodes, scope, onChange, meta }){
  const{ui,S}=useUI();
  const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
  const set2=(patch)=>onChange({props:{...node.props,...patch}});
  const mode=node.props.mode||"graph";
  const deps=(node.attachments||[]).map(id=>nodes[id]).filter(Boolean);
  const fnNode=deps.find(d=>d.type==="fnMap");
  const eqNodes=deps.filter(d=>d.type==="equation");
  const eqNode=eqNodes[0];
  const eqNode2=eqNodes[1];
  // ── Implicit transformer (equation wired) ──
  if(eqNode){
    const eq3d=(eqNode.props.dims||"2d")==="3d";
    const eq2_3d=eqNode2 && (eqNode2.props.dims||"2d")==="3d";
    const intersect = eq3d && eq2_3d;   // two 3D surfaces → intersection curve
    const va=(eqNode.props.varA||"x").trim()||"x";
    const vb=(eqNode.props.varB||"y").trim()||"y";
    const vc=(eqNode.props.varC||"z").trim()||"z";
    return <>
      <div style={{fontSize:14,color:TYPE_META.equation.tc,marginBottom:8,lineHeight:1.5,padding:"6px 8px",background:TYPE_META.equation.tc+"15",borderRadius:5,border:`1px solid ${TYPE_META.equation.tc}33`}}>
        {intersect
          ? <>Intersection curve of <strong>{eqNode.label}</strong> and <strong>{eqNode2.label}</strong>: drawing <em>{eqNode.props.lhs} = {eqNode.props.rhs}</em> ∩ <em>{eqNode2.props.lhs} = {eqNode2.props.rhs}</em> over the sampling box below.</>
          : <>Implicit {eq3d?"surface":"curve"} from <strong>{eqNode.label}</strong>: drawing <em>{eqNode.props.lhs} = {eqNode.props.rhs}</em> over the sampling box below ({va}→a, {vb}→b{eq3d?`, ${vc}→c`:""}).{eqNode2&&!intersect?<> (Wire a second <strong>3D</strong> equation to draw an intersection curve; the current second equation is 2D and is ignored.)</>:null}</>}
      </div>
      <Sec title="Sampling box">
        {[[`${va}₀`,"aMin"],[`${va}₁`,"aMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
        {[[`${vb}₀`,"bMin"],[`${vb}₁`,"bMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
        {eq3d&&[[`${vc}₀`,"cMin"],[`${vc}₁`,"cMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
        <PR label="res"><EI v={node.props.res} sc={scope} onChange={v=>set("res",v)}/></PR>
        <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
          Resolution is the grid divisions per axis; higher is smoother but slower{eq3d?" (cost grows cubically for surfaces — keep it modest)":""}. Updates live as you drag wired sliders.
        </div>
      </Sec>
      {eq3d&&!intersect&&<Sec title="Display">
        <PR label="wireframe"><Toggle v={node.props.showWire!==false} onChange={v=>set("showWire",v)}/></PR>
        <PR label="coloring">
          <select value={node.props.colorMode||"flat"} onChange={e=>set("colorMode",e.target.value)} style={{...S.inp,width:"100%"}}>
            <option value="flat">Flat color</option>
            <option value="depth">Depth (distance from camera)</option>
            <option value="gradient">Gradient |∇F| (highlights singularities)</option>
            <option value="normal">Normal direction (orientation)</option>
            <option value="iridescent">Iridescent (animated)</option>
          </select>
        </PR>
        {(node.props.colorMode||"flat")!=="flat" && (node.props.colorMode!=="iridescent") &&
          <PR label="hue shift"><EI v={node.props.colorShift??"0"} sc={scope} onChange={v=>set("colorShift",v)} placeholder="0"/></PR>}
        <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
          {(()=>{
            const m=node.props.colorMode||"flat";
            if(m==="depth") return "Hue encodes distance from the camera — near vs far reads instantly on tangled surfaces.";
            if(m==="gradient") return "Hue encodes |∇F|; singular points (nodes, cusps, where the gradient vanishes) stand out as a distinct band.";
            if(m==="normal") return "Hue encodes surface orientation — useful for reading curvature.";
            if(m==="iridescent") return "Decorative oil-slick palette that shimmers over time (not a measured quantity).";
            return "Surface drawn in its single flat color. Pick a mode to encode depth, gradient, or orientation as hue.";
          })()}
          {" Applies to GPU-rendered implicit surfaces."}
        </div>
      </Sec>}
    </>;
  }
  const inDim=fnNode?Math.max(1,Math.min(4,Math.round(Number(fnNode.props.inDim||"1")))):1;
  const outDim=fnNode?Math.max(1,Math.min(4,Math.round(Number(fnNode.props.outDim||"1")))):1;
  const axisOpts=[["x","X"],["y","Y"],["z","Z"],["none","—"]];
  const AxisSel=({k,kind})=>(
    <select value={node.props[`${kind}Axis${k}`]||"none"} onChange={e=>set(`${kind}Axis${k}`,e.target.value)} style={{...S.inp,width:"100%"}}>
      {axisOpts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select>
  );
  return <>
    {!fnNode&&<div style={{fontSize:14,color:ui.uiDanger,marginBottom:8,lineHeight:1.5,padding:"6px 8px",background:ui.uiDanger+"15",borderRadius:5,border:`1px solid ${ui.uiDanger}33`}}>
      No function wired. Connect an <strong>fnMap</strong> node's output port into this transformer.
    </div>}
    <Sec title="Mode">
      {(()=>{
        // Render style is a single explicit toggle for the whole map.
        //   function — outputs are POSITIONS (curve/surface graphed)
        //   vector   — outputs are arrow DIRECTIONS seeded at input points
        //   polar    — input is angle θ, output is radius r → (r cosθ, r sinθ)
        //   spherical— inputs are angles θ,φ, output is radius r → sphere point
        // Coloring is independent: bind any one output to the Color target
        // in the assignment section below.
        const cur = mode==="field" ? "vector" : (mode==="polar"||mode==="spherical") ? mode : "function";
        const pick=(v)=> set2({mode: v==="vector" ? "field" : v==="function" ? "graph" : v});
        // Polar reads ONE input as θ; spherical reads TWO inputs as θ,φ. Only offer
        // each when the wired map has the matching input dimension, so you can't
        // select a mode the map can't feed. (The render paths also guard on inDim,
        // so an out-of-spec combination simply draws nothing.)
        const polarOk = inDim===1, sphericalOk = inDim===2;
        return <>
          <PR label="render">
            <select value={cur} onChange={e=>pick(e.target.value)} style={{...S.inp,width:"100%"}}>
              <option value="function">function plot — outputs are positions</option>
              <option value="vector">vector field — outputs are arrow directions</option>
              {(polarOk||cur==="polar")&&<option value="polar" disabled={!polarOk}>polar — input θ, output radius r = f(θ){polarOk?"":" (needs 1 input)"}</option>}
              {(sphericalOk||cur==="spherical")&&<option value="spherical" disabled={!sphericalOk}>spherical — inputs θ,φ, output radius r = f(θ,φ){sphericalOk?"":" (needs 2 inputs)"}</option>}
            </select>
          </PR>
          <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
            {cur==="function"
              ? <>Each output bound to X/Y/Z places that coordinate; {inDim===1?"1 input → curve":inDim===2?"2 inputs → surface":"3 inputs → solid point cloud"}. Bind an output to <em>Color</em> for a gradient. {inDim===1&&<>Switch the map to polar to read the input as an angle instead.</>}{inDim===2&&<>Switch the map to spherical to read the two inputs as angles instead.</>}</>
              : cur==="polar"
              ? <>The input is read as an angle θ and the first output as a radius r, plotting r = f(θ) as a polar curve. Set the θ range below (e.g. 0 to 2π).{!polarOk&&<> <strong>This map has {inDim} inputs; polar needs exactly 1.</strong></>}</>
              : cur==="spherical"
              ? <>Two inputs are read as angles θ (azimuth) and φ (polar), the first output as a radius r, drawing the surface r = f(θ,φ). Set θ to 0…2π and φ to 0…π.{!sphericalOk&&<> <strong>This map has {inDim} inputs; spherical needs exactly 2.</strong></>}</>
              : <>Draws an arrow at each input sample; outputs bound to X/Y/Z form the arrow vector. Bind an output to <em>Color</em> for a gradient.</>}
          </div>
        </>;
      })()}
    </Sec>
    {fnNode&&(mode==="polar"||mode==="spherical")&&(
      <Sec title="Coordinate roles">
        <div style={{fontSize:13,color:ui.uiMuted,lineHeight:1.6}}>
          {mode==="polar"
            ? <>This mode fixes the roles, so there is nothing to bind: the <em>input</em> is the angle θ and <em>out0</em> is the radius r. The point is drawn at (r·cosθ, r·sinθ). Set the θ range in <em>Domain</em> below.</>
            : <>This mode fixes the roles: the two <em>inputs</em> are the angles θ (azimuth) and φ (polar), and <em>out0</em> is the radius r. The point is drawn at (r·sinφ·cosθ, r·sinφ·sinθ, r·cosφ). Set the θ and φ ranges in <em>Domain</em> below.</>}
        </div>
      </Sec>
    )}
    {fnNode&&mode!=="polar"&&mode!=="spherical"&&(()=>{
      // Per-output binding targets with STEAL semantics: choosing a target
      // already held by another output moves it (old holder → none). X/Y/Z
      // and Color are each unique across outputs; "—" is unbounded.
      const outTargets=[["x","X"],["y","Y"],["z","Z"],["color","Color"],["none","—"]];
      const inTargets=[["x","X"],["y","Y"],["z","Z"],["none","—"]];
      const setOutBind=(k,v)=>{
        const patch={};
        if(v!=="none"){
          // steal: any other output holding v reverts to none
          for(let j=0;j<outDim;j++){ if(j!==k && (node.props[`outAxis${j}`]||"")===v) patch[`outAxis${j}`]="none"; }
        }
        patch[`outAxis${k}`]=v;
        set2(patch);
      };
      const setInBind=(k,v)=>{
        const patch={};
        if(v!=="none"){ for(let j=0;j<inDim;j++){ if(j!==k && (node.props[`inAxis${j}`]||"")===v) patch[`inAxis${j}`]="none"; } }
        patch[`inAxis${k}`]=v;
        set2(patch);
      };
      const OutSel=({k})=>(
        <select value={node.props[`outAxis${k}`]||"none"} onChange={e=>setOutBind(k,e.target.value)} style={{...S.inp,width:"100%"}}>
          {outTargets.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
      );
      const InSel=({k})=>(
        <select value={node.props[`inAxis${k}`]||"none"} onChange={e=>setInBind(k,e.target.value)} style={{...S.inp,width:"100%"}}>
          {inTargets.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
      );
      return <Sec title="Bindings">
        <div style={{fontSize:13,color:ui.uiMuted,marginBottom:4}}>Inputs → spatial axis</div>
        {Array.from({length:inDim}).map((_,k)=>(
          <PR key={"i"+k} label={["x","y","z"][k]}><InSel k={k}/></PR>
        ))}
        <div style={{fontSize:13,color:ui.uiMuted,margin:"6px 0 4px"}}>Outputs → axis or color</div>
        {Array.from({length:outDim}).map((_,k)=>(
          <PR key={"o"+k} label={`out${k}`}><OutSel k={k}/></PR>
        ))}
        <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:5,lineHeight:1.5}}>
          Each of X, Y, Z and Color can hold one output; choosing a taken target moves it off the previous output. Bind an output to <em>Color</em> to drive the gradient (set its range below).
        </div>
      </Sec>;
    })()}
    {false&&<Sec title="Axis assignment">
      <div style={{fontSize:13,color:ui.uiMuted,marginBottom:4}}>Inputs to spatial axis</div>
      {Array.from({length:inDim}).map((_,k)=>(
        <PR key={"i"+k} label={["x","y","z","w"][k]}><AxisSel k={k} kind="in"/></PR>
      ))}
      <div style={{fontSize:13,color:ui.uiMuted,margin:"6px 0 4px"}}>Outputs to spatial axis</div>
      {Array.from({length:outDim}).map((_,k)=>(
        <PR key={"o"+k} label={`out${k}`}><AxisSel k={k} kind="out"/></PR>
      ))}
    </Sec>}
    {mode==="field"&&<Sec title="Field style">
      <PR label="arrow len">
          <EI v={node.props.arrowLen??"0.5"} sc={scope} onChange={v=>set("arrowLen",v)}/>
          <input type="range" min="0.05" max="3" step="0.05"
            value={resolveNum(node.props.arrowLen,scope,0.5)}
            onChange={e=>set("arrowLen",String(+e.target.value))}
            style={{width:"100%",accentColor:meta.tc,marginTop:4}}/>
        </PR>
      <PR label="normalize"><Toggle v={node.props.normalize!==false} onChange={v=>set("normalize",v)}/></PR>
    </Sec>}
    <Sec title="Domain">
      {[["x0","aMin"],["x1","aMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      {inDim>=2&&[["y0","bMin"],["y1","bMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      {inDim>=3&&[["z0","cMin"],["z1","cMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      {inDim>=4&&[["w0","dMin"],["w1","dMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>set(k,v)}/></PR>)}
      <PR label="res"><EI v={node.props.res} sc={scope} onChange={v=>set("res",v)}/></PR>
    </Sec>
    {((mode==="graph"&&inDim===2)||mode==="spherical")&&<Sec title="Display">
      <PR label="wireframe"><Toggle v={node.props.showWire!==false} onChange={v=>set("showWire",v)}/></PR>
      <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        {mode==="spherical"
          ? <>For the spherical surface. Off renders a single shaded mesh (GPU-accelerated) — faster for dense or animated maps.</>
          : <>For a 2-input graph surface. Off renders a single shaded mesh (GPU-accelerated) — faster for dense or animated maps.</>}
      </div>
    </Sec>}
    {(()=>{
      // Coloring is active when some output is bound to the Color target.
      const ci=(()=>{ for(let k=0;k<outDim;k++){ if((node.props[`outAxis${k}`]||"")==="color") return k; } return -1; })();
      if(ci<0) return null;
      const hasMin = node.props.colorMin!=="" && node.props.colorMin!=null;
      const hasMax = node.props.colorMax!=="" && node.props.colorMax!=null;
      const needRange = !(hasMin && hasMax);
      return <Sec title="Color ramp">
        <div style={{fontSize:13,color:ui.uiFaint,marginBottom:4,lineHeight:1.5}}>
          Gradient driven by <em>out{ci}</em> (bound to Color). Set the value range below.
        </div>
        <PR label="ramp">
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <input type="color" value={node.props.colorLo||"#3a6aff"} onChange={e=>set("colorLo",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
            <div style={{flex:1,height:12,borderRadius:3,background:`linear-gradient(90deg, ${node.props.colorLo||"#3a6aff"}, ${node.props.colorHi||"#ff5ea8"})`}}/>
            <input type="color" value={node.props.colorHi||"#ff5ea8"} onChange={e=>set("colorHi",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
          </div>
        </PR>
        <PR label="min"><EI v={node.props.colorMin??""} sc={scope} onChange={v=>set("colorMin",v)} placeholder="required"/></PR>
        <PR label="max"><EI v={node.props.colorMax??""} sc={scope} onChange={v=>set("colorMax",v)} placeholder="required"/></PR>
        {needRange&&<div style={{fontSize:12.5,color:ui.uiDanger,marginTop:3,lineHeight:1.5}}>
          Set both min and max — color binding needs an explicit range. {inDim===2
            ? "Until then the surface renders in its single flat color (no domain auto-fit)."
            : "(Until then a fitted range is used as a fallback.)"}
        </div>}
      </Sec>;
    })()}
  </>;
}
