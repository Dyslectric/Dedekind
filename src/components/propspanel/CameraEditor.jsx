import { useUI } from "../../theme/tokens.jsx";
import { catOf, SCALAR_TYPES } from "../../core/taxonomy.js";
import { collectScalarDeps } from "../../core/scope.js";
import { TYPE_META } from "../../nodes/model.js";
import { kindEnabled } from "../../nodes/kinds.js";
import { EI } from "../MathInput.jsx";
import { Sec, PR, Toggle, ColorRow } from "../primitives.jsx";

// camera2d / camera3d — viewport configuration: lens, target/orbit (3D) or
// plane (2D), display toggles, share-view controls, and the list of plots /
// HUD scalars shown. `attachableDeps`, `metaTc`, and the disconnect/attach/add
// handlers are supplied by the parent.
export function CameraEditor({
  node, nodes, scope, onChange, isWindowed,
  onOpenWindow, onDetach, onDockCamera, onAddNode, onAttach, onDisconnect,
  attachableDeps, metaTc,
}){
  const{ui,S}=useUI();
  return <>
    <Sec title="View">
      <div style={{fontSize:14,color:ui.uiMuted,lineHeight:1.6}}>
        {node.props.mode==="2d"
          ? <>This is a <strong style={{color:TYPE_META.camera2d.tc}}>2D camera</strong>. To switch to 3D, add a Camera 3D node.</>
          : <>This is a <strong style={{color:TYPE_META.camera3d.tc}}>3D camera</strong>. To switch to 2D, add a Camera 2D node.</>}
      </div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        {isWindowed
          ? <button onClick={()=>onDockCamera&&onDockCamera(node.id)} style={{...S.btn,flex:1,color:ui.uiAccent,borderColor:ui.uiAccent+"55"}}>⊟ Dock</button>
          : <button onClick={()=>onOpenWindow?onOpenWindow(node.id):onDetach(node.id)} style={{...S.btn,flex:1,color:ui.uiAccent,borderColor:ui.uiAccent+"55"}}>⊞ Open in window</button>}
      </div>
      <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:6,lineHeight:1.5}}>
        {isWindowed ? "Currently shown in a floating window." : "Docked in the bottom strip. Open it in its own movable window instead."}
      </div>
    </Sec>
    {node.props.mode==="2d"&&<Sec title="2D Plane">
      <div style={{color:ui.uiMuted,fontSize:13,marginBottom:6,lineHeight:1.5}}>
        A flat plane defined by a point and a normal (gradient) vector. 3D plots are projected orthographically onto it — no notion of distance.
      </div>
      <div style={{color:ui.uiMuted,fontSize:14,margin:"4px 0 2px"}}>Origin (point)</div>
      {[["x","planeOx"],["y","planeOy"],["z","planeOz"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]||"0"} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
      <div style={{color:ui.uiMuted,fontSize:14,margin:"4px 0 2px"}}>Normal (gradient)</div>
      {[["nx","normalX"],["ny","normalY"],["nz","normalZ"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]||"0"} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
    </Sec>}
    {node.props.mode!=="2d"&&<>
      <Sec title="Target">
        {[["X","targetX"],["Y","targetY"],["Z","targetZ"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
      </Sec>
      <Sec title="Orbit State">
        {[["θ","orbTheta"],["φ","orbPhi"],["r","orbRadius"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]||"…"} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
      </Sec>
      <Sec title="Lens">
        <PR label="proj">
          <select value={node.props.projection||"perspective"} onChange={e=>onChange({props:{...node.props,projection:e.target.value}})} style={{...S.inp,width:"100%"}}>
            <option value="perspective">Perspective</option><option value="orthographic">Orthographic</option>
          </select>
        </PR>
        {node.props.projection==="orthographic"?<PR label="size"><EI v={node.props.orthoSize||"10"} sc={scope} onChange={v=>onChange({props:{...node.props,orthoSize:v}})}/></PR>:<PR label="fov"><EI v={node.props.fov} sc={scope} onChange={v=>onChange({props:{...node.props,fov:v}})}/></PR>}
        <PR label="near"><EI v={node.props.near} sc={scope} onChange={v=>onChange({props:{...node.props,near:v}})}/></PR>
        <PR label="far"><EI v={node.props.far} sc={scope} onChange={v=>onChange({props:{...node.props,far:v}})}/></PR>
      </Sec>
    </>}
    <Sec title="Display">
      <PR label="grid"><Toggle v={node.props.showGrid!==false} onChange={v=>onChange({props:{...node.props,showGrid:v}})}/></PR>
      <PR label="axes"><Toggle v={node.props.showAxes!==false} onChange={v=>onChange({props:{...node.props,showAxes:v}})}/></PR>
      <PR label="scalar HUD"><Toggle v={node.props.showScalarOverlay!==false} onChange={v=>onChange({props:{...node.props,showScalarOverlay:v}})}/></PR>
      <PR label="custom bg"><Toggle v={!!node.props.bgOverride} onChange={v=>onChange({props:{...node.props,bgOverride:v}})}/></PR>
      {node.props.bgOverride&&<PR label="bg"><ColorRow v={node.props.bgColor||"#070810"} onChange={v=>onChange({props:{...node.props,bgColor:v}})}/></PR>}
    </Sec>
    <Sec title="Share controls">
      <div style={{fontSize:13,color:ui.uiMuted,marginBottom:5,lineHeight:1.6}}>
        Choose what's visible in shared & embedded views.
      </div>
      <PR label="cam label"><Toggle v={node.props.showCamLabel!==false} onChange={v=>onChange({props:{...node.props,showCamLabel:v}})}/></PR>
      <PR label="reset btn"><Toggle v={node.props.showResetBtn!==false} onChange={v=>onChange({props:{...node.props,showResetBtn:v}})}/></PR>
      <PR label="hints"><Toggle v={!!node.props.showHints} onChange={v=>onChange({props:{...node.props,showHints:v}})}/></PR>
      <PR label="share btn"><Toggle v={node.props.showShareBtn!==false} onChange={v=>onChange({props:{...node.props,showShareBtn:v}})}/></PR>
      <PR label="open-project btn"><Toggle v={node.props.showOpenBtn!==false} onChange={v=>onChange({props:{...node.props,showOpenBtn:v}})}/></PR>
      {(()=>{
        const inScope=new Set();
        collectScalarDeps(node.id,nodes,inScope,new Set());
        for(const plotId of (node.attachments||[])){ if(catOf(nodes[plotId]?.type)==="plot") collectScalarDeps(plotId,nodes,inScope,new Set()); }
        const wiredScalars = Object.values(nodes).filter(n =>
          SCALAR_TYPES.has(n.type) && inScope.has(n.id) && n.name
        );
        if (!wiredScalars.length) return null;
        const hidden = new Set(node.props.hiddenScalars||[]);
        const toggleScalar = (scId) => {
          const next = new Set(hidden);
          next.has(scId) ? next.delete(scId) : next.add(scId);
          onChange({props:{...node.props, hiddenScalars:[...next]}});
        };
        return <>
          <div style={{fontSize:13,color:ui.uiMuted,marginTop:7,marginBottom:3,borderTop:"1px solid #141628",paddingTop:5}}>
            HUD scalars:
          </div>
          {wiredScalars.map(sc => {
            const meta = TYPE_META[sc.type]||{tc:"#888"};
            return (
              <div key={sc.id} style={{display:"flex",alignItems:"center",gap:5,marginBottom:2}}>
                <div style={{width:6,height:6,borderRadius:2,flexShrink:0,background:metaTc}}/>
                <span style={{flex:1,color:ui.uiMuted,fontSize:14,fontFamily:"monospace"}}>{sc.name}</span>
                <span style={{color:ui.uiMuted,fontSize:13}}>{meta.tag}</span>
                <Toggle v={!hidden.has(sc.id)} onChange={()=>toggleScalar(sc.id)}/>
              </div>
            );
          })}
        </>;
      })()}
    </Sec>
    <Sec title="Plots shown">
      {(node.attachments||[]).map(cid=>{const child=nodes[cid];if(!child||catOf(child.type)!=="plot")return null;return<div key={cid} style={{display:"flex",alignItems:"center",gap:5,marginBottom:4,padding:"2px 5px",background:ui.uiPanelBar,borderRadius:4,border:`1px solid ${ui.uiInputBorder}`}}>
        {child.color&&<div style={{width:6,height:6,borderRadius:2,background:child.color,flexShrink:0}}/>}
        <span style={{flex:1,color:ui.uiMuted,fontSize:15}}>{child.label}</span>
        <span style={{color:ui.uiFaint,fontSize:14}}>{child.type}</span>
        <button onClick={()=>onDisconnect("dep",cid,node.id)} style={{...S.btnSm,color:ui.uiDanger}}>×</button>
      </div>;})}
      {attachableDeps.filter(n=>catOf(n.type)==="plot").length>0&&<><div style={{color:ui.uiFaint,fontSize:14,marginTop:5,marginBottom:3}}>Attach existing plot:</div>{attachableDeps.filter(n=>catOf(n.type)==="plot").map(n=><button key={n.id} onClick={()=>onAttach(node.id,n.id)} style={{...S.btnSm,display:"block",width:"100%",textAlign:"left",marginBottom:2,color:ui.uiBtnText}}>+ {n.label} ({n.type})</button>)}</>}
      <div style={{marginTop:7,display:"flex",gap:3,flexWrap:"wrap"}}>
        {["transformer","paramSpace","points","flow"].filter(t=>kindEnabled(Object.values(nodes).find(n=>n.type==="project"),t)).map(t=>(
          <button key={t} onClick={()=>onAddNode(t,node.id)} style={{...S.btnSm,color:TYPE_META[t]?.tc||"#888"}}>+{TYPE_META[t]?.tag}</button>
        ))}
      </div>
    </Sec>
  </>;
}
