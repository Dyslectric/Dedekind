import { useMemo } from "react";
import { useUI } from "../theme/tokens.jsx";
import { ALL_THEME_KEYS, THEME_GROUPS, THEME_PRESETS, preset } from "../theme/presets.js";
import { NODE_DARK, NODE_KEYS } from "../theme/tokens.jsx";
import { ADDABLE_KINDS, KIND_GROUP_LABELS, kindEnabled } from "../nodes/kinds.js";
import { TYPE_META } from "../nodes/model.js";
import { PR, Sec, Swatch } from "./primitives.jsx";

function ThemePreview({props}){
  const g=(k,d)=>props[k]||d;
  return(
    <div style={{display:"flex",gap:6,marginBottom:10}}>
      {/* 2D mini */}
      <div style={{flex:1,height:54,borderRadius:6,border:`1px solid ${g("overlayBorder","#1a1e38")}`,background:g("bg2d","#070810"),position:"relative",overflow:"hidden"}}>
        <svg width="100%" height="100%" viewBox="0 0 100 54" preserveAspectRatio="none">
          {[14,34].map(y=><line key={"h"+y} x1="0" y1={y} x2="100" y2={y} stroke={g("grid2d","#181d32")} strokeWidth="0.6"/>)}
          {[25,50,75].map(x=><line key={"v"+x} x1={x} y1="0" x2={x} y2="54" stroke={g("grid2d","#181d32")} strokeWidth="0.6"/>)}
          <line x1="0" y1="27" x2="100" y2="27" stroke={g("axes2d","#283a6a")} strokeWidth="1"/>
          <line x1="50" y1="0" x2="50" y2="54" stroke={g("axes2d","#283a6a")} strokeWidth="1"/>
          <path d="M0,40 Q25,8 50,27 T100,14" fill="none" stroke="#5b9cf6" strokeWidth="1.4"/>
        </svg>
        <span style={{position:"absolute",top:3,left:4,fontSize:9,color:g("label2d","#283a6a"),fontFamily:"monospace"}}>2D</span>
      </div>
      {/* 3D mini */}
      <div style={{flex:1,height:54,borderRadius:6,border:`1px solid ${g("overlayBorder","#1a1e38")}`,background:g("bg3d","#070810"),position:"relative",overflow:"hidden"}}>
        <svg width="100%" height="100%" viewBox="0 0 100 54" preserveAspectRatio="none">
          {[0,1,2,3,4].map(i=><line key={"a"+i} x1={i*25} y1="54" x2={50} y2={20} stroke={g("grid3d","#151b2a")} strokeWidth="0.6"/>)}
          {[28,38,48].map((y,i)=><line key={"b"+i} x1={50-(54-y)} y1={y} x2={50+(54-y)} y2={y} stroke={g("grid3d2","#0e1320")} strokeWidth="0.5"/>)}
          <circle cx="58" cy="30" r="8" fill="#c761f7" opacity="0.85"/>
        </svg>
        <span style={{position:"absolute",top:3,left:4,fontSize:9,color:g("overlayText","#4a6888"),fontFamily:"monospace"}}>3D</span>
        <div style={{position:"absolute",bottom:3,left:4,right:24,height:11,borderRadius:3,background:g("overlayBg","#06081488"),border:`1px solid ${g("overlayBorder","#1a1e38")}`}}/>
      </div>
    </div>
  );
}

function ThemeEditor({node,onChange}){
  const{ui,S}=useUI();
  const p=node.props;
  const setProp=(k,v)=>onChange({props:{...node.props,[k]:v}});
  const applyPreset=(name)=>onChange({props:{...node.props,...THEME_PRESETS[name]}});
  // crude "active preset" detection: all theme keys match a preset
  const activePreset=useMemo(()=>{
    for(const[name,vals]of Object.entries(THEME_PRESETS)){
      if(ALL_THEME_KEYS.every(k=>vals[k]===undefined||(p[k]||"")===(vals[k]||"")))return name;
    }
    return null;
  },[p]);

  return<>
    <Sec title="Math input">
      <div style={{display:"flex",gap:5}}>
        {[["plain","Plain"],["live","Live typeset"]].map(([v2,l])=>{
          const on=(p.mathInputMode||"plain")===v2;
          return <button key={v2} onClick={()=>setProp("mathInputMode",v2)}
            style={{...S.btn,flex:1,fontSize:13,color:on?ui.uiAccent:ui.uiMuted,
              borderColor:on?ui.uiAccent:ui.uiInputBorder,background:on?ui.uiAccent+"18":ui.uiBtnBg}}>{l}</button>;
        })}
      </div>
      <div style={{fontSize:11.5,color:ui.uiFaint,marginTop:5,lineHeight:1.4}}>
        Live mode typesets expressions as you edit (fractions, exponents, ∑/∫/∏). Both edit the same text.
      </div>
    </Sec>
    <Sec title="Theme presets">
      <ThemePreview props={p}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
        {Object.entries(THEME_PRESETS).map(([name,vals])=>{
          const active=activePreset===name;
          return(
            <button key={name} onClick={()=>applyPreset(name)}
              style={{...S.btnSm,display:"flex",alignItems:"center",gap:6,padding:"5px 7px",
                borderColor:active?ui.uiAccent:ui.uiBtnBorder,color:active?ui.uiAccent:ui.uiMuted,
                background:active?ui.uiAccent+"18":ui.uiBtnBg,textAlign:"left"}}>
              <span style={{display:"flex",gap:1,flexShrink:0}}>
                {[vals.bg3d,vals.grid3d,vals.axes2d].map((c,i)=>
                  <span key={i} style={{width:7,height:14,borderRadius:i===0?"3px 0 0 3px":i===2?"0 3px 3px 0":0,background:c}}/>)}
              </span>
              <span style={{flex:1,fontSize:13}}>{name}</span>
              {active&&<span style={{color:ui.uiAccent,fontSize:13}}>✓</span>}
            </button>
          );
        })}
      </div>
    </Sec>
    {THEME_GROUPS.map(grp=>(
      <Sec key={grp.title} title={grp.title}>
        {grp.items.map(([k,label,def])=>
          <Swatch key={k} label={label} v={p[k]} def={def} onChange={v=>setProp(k,v)}/>)}
      </Sec>
    ))}
    <Sec title="Node kinds">
      <div style={{fontSize:13,color:ui.uiFaint,marginBottom:6,lineHeight:1.6}}>
        Disable kinds to share a simplified app — disabled kinds vanish from every "add" menu. Existing nodes still render.
      </div>
      {ADDABLE_KINDS.map((group,gi)=>(
        <div key={gi} style={{marginBottom:6}}>
          <div style={{fontSize:13,color:ui.uiMuted,opacity:0.7,marginBottom:3}}>{KIND_GROUP_LABELS[gi]}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
            {group.map(t=>{
              const on=kindEnabled(node,t);
              const m=TYPE_META[t]||{tc:"#888",tag:t};
              return<button key={t} onClick={()=>{
                const dis=new Set(node.props.disabledKinds||[]);
                if(on)dis.add(t);else dis.delete(t);
                setProp("disabledKinds",[...dis]);
              }} style={{...S.btnSm,padding:"2px 6px",opacity:on?1:0.4,
                color:on?m.tc:ui.uiFaint,borderColor:on?m.tc+"44":ui.uiBtnBorder,
                textDecoration:on?"none":"line-through"}}>{m.tag}</button>;
            })}
          </div>
        </div>
      ))}
      {(node.props.disabledKinds||[]).length>0&&<button onClick={()=>setProp("disabledKinds",[])} style={{...S.btnSm,marginTop:3,color:ui.uiAccent}}>enable all</button>}
    </Sec>
    <Sec title="Project info">
      <PR label="name"><input value={p.name||""} onChange={e=>setProp("name",e.target.value)} style={{...S.inp,width:"100%"}}/></PR>
      <PR label="author"><input value={p.author||""} onChange={e=>setProp("author",e.target.value)} style={{...S.inp,width:"100%"}}/></PR>
    </Sec>
  </>;
}

export {
  ThemePreview, ThemeEditor
};
