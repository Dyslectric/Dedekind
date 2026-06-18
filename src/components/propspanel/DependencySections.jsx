import { useUI } from "../../theme/tokens.jsx";
import { catOf, SCALAR_TYPES } from "../../core/taxonomy.js";
import { TYPE_META } from "../../nodes/model.js";
import { Sec, PR } from "../primitives.jsx";
import { ThemeEditor } from "../ThemeEditor.jsx";

// Project layout controls (panel side / span) plus the theme editor.
export function ProjectSection({ node, onChange, layout }){
  const{ui,S}=useUI();
  return <>
    {layout&&<Sec title="Layout">
      <div style={{fontSize:13,color:ui.uiFaint,marginBottom:8,lineHeight:1.5}}>
        Where the properties panel sits, and whether it spans the full window height or only the area beside the node canvas.
      </div>
      <PR label="panel side">
        <div style={{display:"flex",gap:6}}>
          {[["left","◧ Left"],["right","Right ◨"]].map(([v,l])=>(
            <button key={v} onClick={()=>layout.setSide(v)}
              style={{...S.btn,flex:1,color:layout.side===v?ui.uiAccent:ui.uiMuted,borderColor:(layout.side===v?ui.uiAccent:ui.uiInputBorder),background:layout.side===v?ui.uiAccent+"18":ui.uiBtnBg}}>{l}</button>
          ))}
        </div>
      </PR>
      <PR label="panel height">
        <div style={{display:"flex",gap:6}}>
          {[["full","Full"],["main","Beside canvas"]].map(([v,l])=>(
            <button key={v} onClick={()=>layout.setSpan(v)}
              style={{...S.btn,flex:1,fontSize:13,color:layout.span===v?ui.uiAccent:ui.uiMuted,borderColor:(layout.span===v?ui.uiAccent:ui.uiInputBorder),background:layout.span===v?ui.uiAccent+"18":ui.uiBtnBg}}>{l}</button>
          ))}
        </div>
      </PR>
      <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:4,lineHeight:1.5}}>
        {layout.span==="full"
          ? "Full: the panel runs the whole window height; the viewport dock sits under the canvas only."
          : "Beside canvas: the panel stops above the viewport dock, which spans the full width."}
        {" "}Drag the panel's inner edge to resize it.
      </div>
    </Sec>}
    <ThemeEditor node={node} onChange={onChange}/>
  </>;
}

// "Used by" — the downstream consumers that depend on this node.
export function UsedBySection({ node, usedBy, onDisconnect }){
  const{ui,S}=useUI();
  return <Sec title="Used by">
    <div style={{fontSize:14,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
      This {catOf(node.type)} feeds the nodes below. {SCALAR_TYPES.has(node.type)?"Its variable is only in scope for these.":""}
    </div>
    {usedBy.map(c=>(
      <div key={c.id} style={{display:"flex",alignItems:"center",gap:5,marginBottom:3,padding:"2px 5px",background:ui.uiPanelBar,borderRadius:4,border:`1px solid ${ui.uiInputBorder}`}}>
        <span style={{width:6,height:6,borderRadius:1.5,background:TYPE_META[c.type]?.tc||"#556",flexShrink:0}}/>
        <span style={{flex:1,color:ui.uiMuted,fontSize:15}}>{c.label} <span style={{color:ui.uiFaint}}>({c.type})</span></span>
        <button onClick={()=>onDisconnect("dep",node.id,c.id)} style={{...S.btnSm,color:ui.uiDanger}}>×</button>
      </div>
    ))}
  </Sec>;
}

// "Inputs" — the upstream dependencies this node consumes, plus the attachable
// candidates.
export function InputsSection({ node, myDeps, attachableDeps, onDisconnect, onConnectScalar }){
  const{ui,S}=useUI();
  return <Sec title="Inputs">
    <div style={{fontSize:14,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
      {catOf(node.type)==="plot"?"Attach functions, a domain, or scalars this plot uses.":catOf(node.type)==="function"?"Attach scalars this function depends on.":"Attach scalars that drive this domain."}
    </div>
    {myDeps.map(d=>(
      <div key={d.id} style={{display:"flex",alignItems:"center",gap:5,marginBottom:3,padding:"2px 5px",background:ui.uiPanelBar,borderRadius:4,border:`1px solid ${ui.uiInputBorder}`}}>
        <span style={{width:6,height:6,borderRadius:1.5,background:TYPE_META[d.type]?.tc||"#556",flexShrink:0}}/>
        <span style={{flex:1,color:ui.uiMuted,fontSize:15}}>{d.label}{d.name?` (${d.name})`:""} <span style={{color:ui.uiFaint}}>· {d.type}</span></span>
        <button onClick={()=>onDisconnect("dep",d.id,node.id)} style={{...S.btnSm,color:ui.uiDanger}}>×</button>
      </div>
    ))}
    {attachableDeps.length>0&&<>
      <div style={{color:ui.uiFaint,fontSize:14,marginTop:5,marginBottom:3}}>Attach input:</div>
      {attachableDeps.map(n=><button key={n.id} onClick={()=>onConnectScalar(n.id,node.id)} style={{...S.btnSm,display:"block",width:"100%",textAlign:"left",marginBottom:2,color:ui.uiBtnText}}>+ {n.label}{n.name?` (${n.name})`:""} · {n.type}</button>)}
    </>}
  </Sec>;
}
