import { useState, useRef, useEffect } from "react";
import { useUI, darken, relLum } from "../theme/tokens.jsx";
import { TYPE_META } from "../nodes/model.js";
import { ADDABLE_KINDS, ALL_KINDS, KIND_GROUP_LABELS, kindEnabled, HOTKEY_FOR_KIND } from "../nodes/kinds.js";

// ── Small UI helpers ─────────────────────────────────────────────────────────
function ColorRow({v,onChange}){const{S}=useUI();return<div style={{display:"flex",gap:5,alignItems:"center"}}><input type="color" value={v||"#000000"} onChange={e=>onChange(e.target.value)} style={{width:22,height:20,border:"none",background:"none",cursor:"pointer",padding:0,flexShrink:0}}/><input value={v||""} onChange={e=>onChange(e.target.value)} style={{...S.inp,flex:1}}/></div>;}

// Compact swatch + hex input used in the redesigned theme panel
function Swatch({label,v,def,onChange}){
  const{ui,S}=useUI();
  return(
    <label style={{display:"flex",alignItems:"center",gap:7,padding:"3px 4px",borderRadius:5,cursor:"pointer"}}
      onMouseEnter={e=>e.currentTarget.style.background=ui.uiPanelBar}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <span style={{position:"relative",flexShrink:0}}>
        <input type="color" value={(v||def||"#000000").slice(0,7)} onChange={e=>onChange(e.target.value)}
          style={{width:24,height:24,border:`1px solid ${ui.uiInputBorder}`,borderRadius:6,background:"none",cursor:"pointer",padding:0}}/>
      </span>
      <span style={{flex:1,color:ui.uiMuted,fontSize:14,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
      <input value={v||""} onChange={e=>onChange(e.target.value)} placeholder={def}
        style={{...S.inp,width:88,fontSize:13,padding:"3px 5px",flexShrink:0}}/>
    </label>
  );
}

function Toggle({v,onChange}){const{ui,S}=useUI();return<button onClick={()=>onChange(!v)} style={{...S.btnSm,color:v?ui.uiGood:ui.uiDanger,borderColor:(v?ui.uiGood:ui.uiDanger)+"44",minWidth:40}}>{v?"on":"off"}</button>;}
function NodeAddGrid({onAddNode, projectNode}){
  const{ui,S}=useUI();
  const labelOf={camera:"Camera",constant:"Constant",slider:"Slider",animator:"Animator",fnDef:"Function",domain:"Domain",fnMap:"Map ƒ",transformer:"Transformer",paramSpace:"Param space",points:"Points/Glyphs",plane:"Plane",quiver2d:"Quiver 2D",quiver3d:"Quiver 3D",flow:"Flow"};
  const rows=ADDABLE_KINDS.map(group=>group.filter(t=>kindEnabled(projectNode,t))).filter(g=>g.length);
  if(!rows.length) return null;
  return<div>
    <div style={{color:ui.uiFaint,fontSize:14,letterSpacing:1,marginBottom:6,fontWeight:"bold"}}>ADD NODE</div>
    {rows.map((row,i)=>(
      <div key={i} style={{display:"flex",gap:3,marginBottom:3,flexWrap:"wrap"}}>
        {row.map(t=>{const m=TYPE_META[t]||{tc:ui.uiAccent};const bl=relLum(ui.uiBtnBg||"#0c0e20");const amt=bl>0.6?0.7:bl>0.3?0.64:bl>0.12?0.42:0;const tcol=amt>0?darken(m.tc,amt):m.tc;const hk=HOTKEY_FOR_KIND[t];return<button key={t} onClick={()=>onAddNode(t)} title={hk?`Shortcut: ${hk} (in the node canvas)`:undefined} style={{...S.btnSm,flex:"1 1 22%",color:tcol,borderColor:tcol+"33",textAlign:"center",position:"relative"}}>{labelOf[t]||t}{hk&&<span style={{marginLeft:5,opacity:0.55,fontSize:11,textTransform:"uppercase"}}>{hk}</span>}</button>;})}
      </div>
    ))}
  </div>;
}
function Sec({title,children}){const{ui}=useUI();const[open,setOpen]=useState(true);return<div style={{marginBottom:9}}><div onClick={()=>setOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",color:ui.uiHeading,fontSize:14,fontWeight:"bold",letterSpacing:1,textTransform:"uppercase",marginBottom:open?4:0}}><span style={{fontSize:14,color:ui.uiMuted}}>{open?"▾":"▸"}</span>{title}</div>{open&&<div style={{paddingLeft:2}}>{children}</div>}</div>;}
function PR({label,children}){const{ui}=useUI();return<div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}><span style={{width:54,flexShrink:0,color:ui.uiText,fontSize:14,textAlign:"right"}}>{label}</span><div style={{flex:1}}>{children}</div></div>;}

function Btn2({color,onClick,children}){const{S}=useUI();return<button onClick={onClick} style={{...S.btnSm,color,borderColor:color+"44",padding:"2px 8px"}}>{children}</button>;}

function WBtn({color,onClick,children}){return<button onClick={e=>{e.stopPropagation();onClick();}} style={{width:16,height:16,borderRadius:8,border:"none",background:color+"22",color,fontSize:16,cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"monospace"}}>{children}</button>;}

// Thin toolbar at the very top of the properties panel, holds the pop-out toggle
function PanelTopBar({onPopOut,popped}){
  const{ui,S}=useUI();
  if(!onPopOut)return null;
  return(
    <div style={{display:"flex",alignItems:"center",gap:6,padding:"3px 8px",height:26,flexShrink:0,
      background:ui.uiPanelBar,borderBottom:`1px solid ${ui.uiInputBorder}`}}>
      <span style={{color:ui.uiFaint,fontSize:13,letterSpacing:1,fontWeight:"bold",flex:1}}>PROPERTIES</span>
      <button onClick={onPopOut} title={popped?"Dock panel":"Pop out panel"}
        style={{...S.btnSm,color:ui.uiAccent,borderColor:ui.uiAccent+"55",padding:"1px 7px",fontSize:14}}>
        {popped?"⇲ dock":"⇱ pop out"}
      </button>
    </div>
  );
}

// ── Floating window for the popped-out properties panel ──────────────────────
function PropsPanelWindow({children,initPos,onClose}){
  const{ui}=useUI();
  const[pos,setPos]=useState(initPos||{x:120,y:90});
  const[sz,setSz]=useState({w:380,h:560});
  const[min,setMin]=useState(false);
  const dr=useRef(false),rz=useRef(false);
  useEffect(()=>{
    const mm=e=>{if(dr.current)setPos(p=>({x:p.x+e.movementX,y:p.y+e.movementY}));if(rz.current)setSz(s=>({w:Math.max(300,s.w+e.movementX),h:Math.max(220,s.h+e.movementY)}));};
    const mu=()=>{dr.current=false;rz.current=false;};
    window.addEventListener("mousemove",mm);window.addEventListener("mouseup",mu);
    return()=>{window.removeEventListener("mousemove",mm);window.removeEventListener("mouseup",mu);};
  },[]);
  return(
    <div style={{position:"fixed",left:pos.x,top:pos.y,width:sz.w,height:min?32:sz.h,background:ui.uiPanelBar,border:`1px solid ${ui.uiBtnBorder}`,borderRadius:8,overflow:"hidden",zIndex:1100,boxShadow:"0 12px 48px #000d",display:"flex",flexDirection:"column",userSelect:"none"}}>
      <div onMouseDown={()=>{dr.current=true;}} style={{display:"flex",alignItems:"center",gap:8,padding:"0 8px",height:32,flexShrink:0,background:ui.uiBtnBg,borderBottom:min?"none":`1px solid ${ui.uiInputBorder}`,cursor:"grab"}}>
        <span style={{color:ui.uiAccent,fontSize:15}}>⚙</span>
        <span style={{color:ui.uiHeading,fontSize:15,fontFamily:"monospace",fontWeight:"bold",flex:1}}>Properties</span>
        <WBtn color={ui.uiAccent} onClick={()=>setMin(m=>!m)}>{min?"▼":"▲"}</WBtn>
        <WBtn color={ui.uiGood} onClick={onClose}>⇲</WBtn>
      </div>
      {!min&&<>
        <div style={{flex:1,minHeight:0,overflow:"hidden",userSelect:"text"}}>{children}</div>
        <div onMouseDown={()=>{rz.current=true;}} style={{position:"absolute",bottom:0,right:0,width:14,height:14,cursor:"nwse-resize",background:`linear-gradient(135deg,transparent 50%,${ui.uiBtnBorder} 50%)`,borderRadius:"0 0 8px 0"}}/>
      </>}
    </div>
  );
}

export {
  ColorRow, Swatch, Toggle, NodeAddGrid, Sec, PR, Btn2, WBtn, PanelTopBar, PropsPanelWindow
};
