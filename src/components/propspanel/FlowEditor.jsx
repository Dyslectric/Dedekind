import { useUI } from "../../theme/tokens.jsx";
import { parsePointsExplicit } from "../../geometry/parse.js";
import { TYPE_META } from "../../nodes/model.js";
import { EI } from "../MathInput.jsx";
import { Sec, PR, Toggle } from "../primitives.jsx";

// flow — integrates a wired fnMap (vector field) from a seed source (a
// paramSpace or a points node), producing stream curves / surfaces / volumes.
export function FlowEditor({ node, nodes, scope, onChange }){
  const{ui,S}=useUI();
  const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
  const deps=(node.attachments||[]).map(id=>nodes[id]).filter(Boolean);
  const fnNode=deps.find(d=>d.type==="fnMap");
  const seedNode=deps.find(d=>d.type==="paramSpace"||d.type==="points");
  const seedIsPoints=seedNode?.type==="points";
  const seedDeg=(seedNode&&!seedIsPoints)?Math.max(1,Math.min(2,Math.round(Number(seedNode.props.degree||"1")))):0;
  const seedCount=seedIsPoints?parsePointsExplicit(seedNode.props,scope).pts.length:0;
  return <>
    {(!fnNode||!seedNode)&&<div style={{fontSize:14,color:ui.uiDanger,marginBottom:8,lineHeight:1.5,padding:"6px 8px",background:ui.uiDanger+"15",borderRadius:5,border:`1px solid ${ui.uiDanger}33`}}>
      A flow needs a wired <strong>fnMap</strong> (the vector field) and a seed source — a <strong>Param Space</strong> (continuous) or a <strong>Points</strong> node (discrete seeds).{!fnNode&&<> Missing the field.</>}{!seedNode&&<> Missing the seeds.</>}
    </div>}
    <Sec title="Inputs">
      <div style={{fontSize:13,color:ui.uiFaint,lineHeight:1.6}}>
        <div>field: {fnNode?<span style={{color:TYPE_META.fnMap.tc}}>{fnNode.label} (out dim {fnNode.props.outDim||"?"})</span>:<span style={{color:ui.uiDanger}}>none</span>}</div>
        <div>seeds: {seedNode
          ? (seedIsPoints
              ? <span style={{color:TYPE_META.points.tc}}>{seedNode.label} ({seedCount} point{seedCount!==1?"s":""})</span>
              : <span style={{color:TYPE_META.paramSpace.tc}}>{seedNode.label} (degree {seedDeg})</span>)
          : <span style={{color:ui.uiDanger}}>none</span>}</div>
        {seedIsPoints && <div style={{marginTop:3}}>Each seed point makes one stream <strong>curve</strong>.</div>}
        {seedDeg===2 && <div style={{marginTop:3}}>A degree-2 seed space sweeps a <strong>volume</strong>.</div>}
        {seedDeg===1 && <div style={{marginTop:3}}>A degree-1 seed space makes a stream <strong>surface</strong> (or lines).</div>}
      </div>
    </Sec>
    <Sec title="Integration">
      <PR label="steps"><EI v={node.props.steps} sc={scope} onChange={v=>set("steps",v)}/></PR>
      <PR label="h"><EI v={node.props.stepSize} sc={scope} onChange={v=>set("stepSize",v)}/></PR>
    </Sec>
    <Sec title="Output">
      {(!seedIsPoints && seedDeg!==2) && <PR label="form">
        <select value={node.props.output||"surface"} onChange={e=>set("output",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="surface">stream surface</option>
          <option value="lines">streamlines</option>
        </select>
      </PR>}
      {seedIsPoints && <div style={{fontSize:13,color:ui.uiFaint}}>Discrete seeds always render as stream curves.</div>}
      {seedDeg===2 && <PR label="slices"><EI v={node.props.volSlices??"6"} sc={scope} onChange={v=>set("volSlices",v)}/></PR>}
      {(!seedIsPoints && (node.props.output==="surface"||seedDeg===2))&&<>
        <PR label="wireframe"><Toggle v={!!node.props.showWire} onChange={v=>set("showWire",v)}/></PR>
        <PR label="gradient"><Toggle v={!!node.props.gradient} onChange={v=>set("gradient",v)}/></PR>
        {node.props.gradient&&<div style={{display:"flex",gap:6,alignItems:"center",marginTop:3}}>
          <input type="color" value={node.props.gradA||"#5b9cf6"} onChange={e=>set("gradA",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
          <div style={{flex:1,height:10,borderRadius:3,background:`linear-gradient(90deg, ${node.props.gradA||"#5b9cf6"}, ${node.props.gradB||"#f74fa0"})`}}/>
          <input type="color" value={node.props.gradB||"#f74fa0"} onChange={e=>set("gradB",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
        </div>}
      </>}
    </Sec>
  </>;
}
