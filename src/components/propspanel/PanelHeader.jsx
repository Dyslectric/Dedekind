import { useUI } from "../../theme/tokens.jsx";
import { isCameraType, SCALAR_TYPES } from "../../core/taxonomy.js";
import { Btn2 } from "../primitives.jsx";
import { NameField } from "../MathInput.jsx";

// Render an identifier name as JSX with the part after the first underscore as
// an HTML subscript (x_0 → x₀); greek chars already display literally. Used in
// the panel header readout. Returns a string when there's no subscript.
function nameJSX(name){
  if(!name) return "";
  const us=name.indexOf("_");
  if(us>0 && us<name.length-1){
    return <>{name.slice(0,us)}<sub style={{fontSize:"0.72em"}}>{name.slice(us+1)}</sub></>;
  }
  return name;
}

// The fixed header at the top of the panel body: color swatch, label + type,
// camera window/share/enable controls, color picker, delete, and the editable
// label / variable-name inputs.
export function PanelHeader({ node, onChange, onDelete, onToggleEnabled, onDetach, onOpenWindow, onDockCamera, isWindowed, onShareUrl }){
  const{ui,S}=useUI();
  const isCamera=isCameraType(node.type);
  const isProject=node.type==="project";
  const isScalar=SCALAR_TYPES.has(node.type);
  return <div style={{padding:"8px 12px",borderBottom:`1px solid ${ui.uiInputBorder}`,background:ui.uiPanelBar,flexShrink:0}}>
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      {node.color&&<div style={{width:10,height:10,borderRadius:3,background:node.color,flexShrink:0}}/>}
      <div style={{flex:1}}>
        <div style={{fontSize:16,fontWeight:"bold",color:ui.uiHeading}}>{node.label}{node.name?<> ({nameJSX(node.name)})</>:""}</div>
        <div style={{fontSize:14,color:ui.uiFaint}}>{node.type}</div>
      </div>
      {isCamera&&<><Btn2 color={node.enabled?ui.uiGood:ui.uiDanger} onClick={()=>onToggleEnabled(node.id)}>{node.enabled?"●":"○"}</Btn2>{isWindowed?<Btn2 color={ui.uiAccent} onClick={()=>onDockCamera&&onDockCamera(node.id)} title="Dock">⊟</Btn2>:<Btn2 color={ui.uiAccent} onClick={()=>onOpenWindow?onOpenWindow(node.id):onDetach(node.id)} title="Open in window">⊞</Btn2>}<Btn2 color={ui.uiAccent} onClick={onShareUrl}>⎘</Btn2></>}
      {node.color&&<input type="color" value={node.color} onChange={e=>onChange({color:e.target.value})} style={{width:20,height:20,border:"none",background:"none",cursor:"pointer",padding:0}}/>}
      {!isProject&&<Btn2 color={ui.uiDanger} onClick={()=>onDelete(node.id)}>del</Btn2>}
    </div>
    <div style={{marginTop:6,display:"flex",gap:5}}>
      <input value={node.label} onChange={e=>onChange({label:e.target.value})} style={{...S.inp,flex:1}} placeholder="label"/>
      {(isScalar||node.type==="fnDef"||node.type==="list")&&<NameField v={node.name||""} width={80}
        onChange={val=>onChange({name:val})}
        placeholder={node.type==="fnDef"?"name":"var"}/>}
    </div>
  </div>;
}
