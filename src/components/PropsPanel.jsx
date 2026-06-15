import { useState, useEffect, useRef, useMemo, memo } from "react";
import { useUI } from "../theme/tokens.jsx";
import { catOf, SCALAR_TYPES, isFunctionType, isDomainType, isCameraType, canAttach, canBeDependency, canConsume } from "../core/taxonomy.js";
import { collectScalarDeps, resolveScope } from "../core/scope.js";
import { resolveNum, safeEval } from "../core/math.js";
import { TYPE_META, makeNode } from "../nodes/model.js";
import { ADDABLE_KINDS, kindEnabled } from "../nodes/kinds.js";
import { parsePointSeq, parseGlyphField } from "../geometry/parse.js";
import { EI, MathInput } from "./MathInput.jsx";
import { XF } from "./MathField.jsx";
import { Sec, PR, Toggle, ColorRow, Btn2, NodeAddGrid, PanelTopBar } from "./primitives.jsx";
import { ThemeEditor } from "./ThemeEditor.jsx";
import { FnDefRow } from "./FnDefRow.jsx";

// ── Properties panel ─────────────────────────────────────────────────────────

// Selection actions: copy the current selection to the clipboard as JSON, and
// expand the selection to its dependencies or full connected component. Shown
// whenever at least one node is selected. `count` is the size of the current
// selection (so the copy button can label how many nodes it will copy).
function SelectionActions({ count, onCopySelection, onSelectDependencies, onSelectConnected }){
  const{ui,S}=useUI();
  const[did,setDid]=useState(null);
  const flash=(label)=>{ setDid(label); setTimeout(()=>setDid(null),1200); };
  const btn={...S.btnSm,color:ui.uiAccent,borderColor:ui.uiAccent+"44",display:"block",width:"100%",textAlign:"left",marginBottom:3};
  return <Sec title={`Selection${count>1?` · ${count} nodes`:""}`}>
    <button style={btn} title="Copy the selected node(s) to the clipboard as JSON (Ctrl+C)"
      onClick={async()=>{ await onCopySelection?.(); flash("copy"); }}>
      {did==="copy"?"✓ copied to clipboard":"⎘ copy selection (JSON)"}
      <span style={{color:ui.uiFaint,float:"right"}}>⌃C</span>
    </button>
    <button style={btn} title="Add every node the selection depends on (Ctrl+Shift+D)"
      onClick={()=>{ onSelectDependencies?.(); flash("dep"); }}>
      {did==="dep"?"✓ expanded":"⊕ select dependencies"}
      <span style={{color:ui.uiFaint,float:"right"}}>⌃⇧D</span>
    </button>
    <button style={btn} title="Add every node transitively connected to the selection (Ctrl+Shift+C)"
      onClick={()=>{ onSelectConnected?.(); flash("conn"); }}>
      {did==="conn"?"✓ expanded":"⊕ select connected"}
      <span style={{color:ui.uiFaint,float:"right"}}>⌃⇧C</span>
    </button>
  </Sec>;
}

function PropsPanelImpl({ node, nodes, scope, onChange, onAttach, onAddNode, onDelete, onToggleEnabled, onDetach, onOpenWindow, onDockCamera, isWindowed, onShareUrl, animValsRef, onConnectScalar, onDisconnectScalar, onPopOut, popped, selectionSet, onCopySelection, onSelectDependencies, onSelectConnected, layout }) {
  const{ui,S}=useUI();
  const selCount=selectionSet?selectionSet.size:0;
  const[,forceUpdate]=useState(0);
  useEffect(()=>{
    if(node?.type!=="animator"||!node.playing)return;
    let raf;const loop=()=>{forceUpdate(x=>x+1);raf=requestAnimationFrame(loop);};raf=requestAnimationFrame(loop);return()=>cancelAnimationFrame(raf);
  },[node?.id,node?.playing]);
  if(!node)return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PanelTopBar onPopOut={onPopOut} popped={popped}/>
      <div style={{padding:18,fontFamily:"monospace",fontSize:16,color:ui.uiFaint,overflowY:"auto"}}>
        <div style={{color:ui.uiAccent,fontSize:17,fontWeight:"bold",marginBottom:8}}>Dedekind</div>
        <div style={{lineHeight:2.1,color:ui.uiMuted,fontSize:15}}>Click a node · drag port to connect · Del to remove<br/>Scalar nodes (CST/SLD/ANM/FN) connect to specific cameras via their right port.</div>
        <div style={{marginTop:16,borderTop:`1px solid ${ui.uiInputBorder}`,paddingTop:12}}><NodeAddGrid onAddNode={onAddNode} projectNode={Object.values(nodes).find(n=>n.type==="project")}/></div>
      </div>
    </div>
  );
  const isCamera=isCameraType(node.type),isProject=node.type==="project",isScalar=SCALAR_TYPES.has(node.type);
  const meta=TYPE_META[node.type]||{tc:"#888"};
  const liveAnimVal=node.type==="animator"?(animValsRef.current[node.id]??node.value):null;

  // Generic dependency model:
  //  - what this node consumes (its attachments), grouped, removable
  //  - what this node could additionally consume (canAttach-filtered)
  //  - what consumes this node ("used by")
  const myDeps = (node.attachments||[]).map(id=>nodes[id]).filter(Boolean);
  const attachableDeps = canConsume(node.type)
    ? Object.values(nodes).filter(n=>n.id!==node.id && canAttach(n.type,node.type) && !(node.attachments||[]).includes(n.id))
    : [];
  const usedBy = canBeDependency(node.type)
    ? Object.values(nodes).filter(c=>(c.attachments||[]).includes(node.id))
    : [];

  return(
    <div style={{fontFamily:"monospace",fontSize:16,color:ui.uiText,display:"flex",flexDirection:"column",height:"100%"}}>
      <PanelTopBar onPopOut={onPopOut} popped={popped}/>
      <div style={{padding:"8px 12px",borderBottom:`1px solid ${ui.uiInputBorder}`,background:ui.uiPanelBar,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {node.color&&<div style={{width:10,height:10,borderRadius:3,background:node.color,flexShrink:0}}/>}
          <div style={{flex:1}}>
            <div style={{fontSize:16,fontWeight:"bold",color:ui.uiHeading}}>{node.label}{node.name?` (${node.name})`:""}</div>
            <div style={{fontSize:14,color:ui.uiFaint}}>{node.type}</div>
          </div>
          {isCamera&&<><Btn2 color={node.enabled?ui.uiGood:ui.uiDanger} onClick={()=>onToggleEnabled(node.id)}>{node.enabled?"●":"○"}</Btn2>{isWindowed?<Btn2 color={ui.uiAccent} onClick={()=>onDockCamera&&onDockCamera(node.id)} title="Dock">⊟</Btn2>:<Btn2 color={ui.uiAccent} onClick={()=>onOpenWindow?onOpenWindow(node.id):onDetach(node.id)} title="Open in window">⊞</Btn2>}<Btn2 color={ui.uiAccent} onClick={onShareUrl}>⎘</Btn2></>}
          {node.color&&<input type="color" value={node.color} onChange={e=>onChange({color:e.target.value})} style={{width:20,height:20,border:"none",background:"none",cursor:"pointer",padding:0}}/>}
          {!isProject&&<Btn2 color={ui.uiDanger} onClick={()=>onDelete(node.id)}>del</Btn2>}
        </div>
        <div style={{marginTop:6,display:"flex",gap:5}}>
          <input value={node.label} onChange={e=>onChange({label:e.target.value})} style={{...S.inp,flex:1}} placeholder="label"/>
          {(isScalar||node.type==="fnDef")&&<input value={node.name||""} onChange={e=>{const v=e.target.value.replace(/[^a-zA-Z0-9_]/g,"");if(!v||/^[a-zA-Z]/.test(v))onChange({name:v});}} style={{...S.inp,width:60}} placeholder={node.type==="fnDef"?"name":"var"}/>}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"10px 12px"}}>

        <SelectionActions count={selCount} onCopySelection={onCopySelection}
          onSelectDependencies={onSelectDependencies} onSelectConnected={onSelectConnected}/>

        {/* ── Project ── */}
        {isProject&&layout&&<Sec title="Layout">
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
        {isProject&&<ThemeEditor node={node} onChange={onChange}/>}

        {/* ── Used by (downstream consumers) ── */}
        {usedBy.length>0 && (isScalar||isFunctionType(node.type)||isDomainType(node.type)) &&<Sec title="Used by">
          <div style={{fontSize:14,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
            This {catOf(node.type)} feeds the nodes below. {isScalar?"Its variable is only in scope for these.":""}
          </div>
          {usedBy.map(c=>(
            <div key={c.id} style={{display:"flex",alignItems:"center",gap:5,marginBottom:3,padding:"2px 5px",background:ui.uiPanelBar,borderRadius:4,border:`1px solid ${ui.uiInputBorder}`}}>
              <span style={{width:6,height:6,borderRadius:1.5,background:TYPE_META[c.type]?.tc||"#556",flexShrink:0}}/>
              <span style={{flex:1,color:ui.uiMuted,fontSize:15}}>{c.label} <span style={{color:ui.uiFaint}}>({c.type})</span></span>
              <button onClick={()=>onDisconnect("dep",node.id,c.id)} style={{...S.btnSm,color:ui.uiDanger}}>×</button>
            </div>
          ))}
        </Sec>}

        {/* ── Inputs (upstream dependencies) for functions / plots / domains ── */}
        {!isCamera && !isProject && (!isScalar || node.type==="expr" || node.type==="fnDef") && canConsume(node.type) &&<Sec title="Inputs">
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
        </Sec>}

        {/* ── Scalar node params ── */}
        {node.type==="constant"&&<Sec title="Value"><PR label="val"><EI v={node.props.value} sc={scope} onChange={v=>onChange({props:{...node.props,value:v}})}/></PR></Sec>}
        {node.type==="expr"&&<Sec title="Expression">
          <PR label={`${node.name||"e"} =`}><XF v={node.props.expr||""} sc={scope} onChange={v=>onChange({props:{...node.props,expr:v}})}/></PR>
          <div style={{marginTop:6,padding:"6px 9px",background:"#050e18",borderRadius:4,border:"1px solid #0c1e2e",fontSize:14,color:"#7ac0d8",fontFamily:"monospace",lineHeight:1.9}}>
            {(()=>{
              const val=resolveNum(node.props.expr,scope,NaN);
              if(!node.name)return<span style={{color:"#1a3040"}}>set a variable name above</span>;
              if(!isFinite(val))return<span style={{color:"#1a3040"}}>…</span>;
              const fmtd=Math.abs(val)>=1000||(Math.abs(val)<0.001&&val!==0)?val.toExponential(4):Number(val.toPrecision(6)).toString();
              return<span><span style={{color:"#3a7090"}}>{node.name} =</span> <span style={{color:"#8fd8f8"}}>{fmtd}</span></span>;
            })()}
          </div>
          <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:5,lineHeight:1.5}}>
            A named scalar computed from an expression — can reference attached sliders, animators, constants, other expressions, and functions. Wire scalar/function nodes in via the Inputs section.
          </div>
        </Sec>}
        {node.type==="slider"&&<Sec title="Slider">
          <PR label="min"><EI v={node.props.min} sc={scope} onChange={v=>onChange({props:{...node.props,min:v}})}/></PR>
          <PR label="max"><EI v={node.props.max} sc={scope} onChange={v=>onChange({props:{...node.props,max:v}})}/></PR>
          <PR label="step"><EI v={node.props.step} sc={scope} onChange={v=>onChange({props:{...node.props,step:v}})}/></PR>
          <input type="range" min={resolveNum(node.props.min,scope,-5)} max={resolveNum(node.props.max,scope,5)} step={resolveNum(node.props.step,scope,0.01)} value={node.value||0} onChange={e=>onChange({value:+e.target.value})} style={{width:"100%",accentColor:meta.tc,marginTop:6}}/>
          <div style={{textAlign:"center",color:meta.tc,fontWeight:"bold",fontSize:17,marginTop:2}}>{node.name} = {Number(node.value||0).toFixed(4)}</div>
        </Sec>}
        {node.type==="animator"&&<Sec title="Animator">
          <PR label="min"><EI v={node.props.min} sc={scope} onChange={v=>onChange({props:{...node.props,min:v}})}/></PR>
          <PR label="max"><EI v={node.props.max} sc={scope} onChange={v=>onChange({props:{...node.props,max:v}})}/></PR>
          <PR label="period"><EI v={node.props.period} sc={scope} onChange={v=>onChange({props:{...node.props,period:v}})}/></PR>
          <PR label="step"><EI v={node.props.step||""} sc={scope} onChange={v=>onChange({props:{...node.props,step:v}})} placeholder="auto"/></PR>
          <PR label="loop">
            <select value={node.props.loop} onChange={e=>onChange({props:{...node.props,loop:e.target.value}})} style={{...S.inp,width:"100%"}}>
              <option value="loop">loop</option><option value="bounce">bounce</option><option value="once">once</option>
            </select>
          </PR>
          <div style={{display:"flex",gap:6,marginTop:8}}>
            <button onClick={()=>onChange({playing:!node.playing})} style={{...S.btn,color:node.playing?"#f94":"#4f7",flex:1}}>{node.playing?"■ Pause":"▶ Play"}</button>
            <button onClick={()=>onChange({value:resolveNum(node.props.min,scope,0),playing:false})} style={S.btn}>↩</button>
          </div>
          <div style={{height:4,background:"#0e0f1e",borderRadius:2,overflow:"hidden",marginTop:6}}>
            <div style={{height:"100%",background:meta.tc,opacity:0.7,width:`${100*((liveAnimVal??node.value)-resolveNum(node.props.min,scope,0))/((resolveNum(node.props.max,scope,1)-resolveNum(node.props.min,scope,0))||1)}%`}}/>
          </div>
          <div style={{textAlign:"center",color:meta.tc,fontWeight:"bold",fontSize:16,marginTop:3}}>{node.name} = {Number((liveAnimVal??node.value)||0).toFixed(4)}</div>
          <div style={{fontSize:13,color:"#1e2840",marginTop:4}}>
            step: sets discrete tick amount — leave blank for smooth (continuous)
          </div>
        </Sec>}

        {/* ── Function definition ── */}
        {node.type==="fnDef"&&<Sec title="Definition">
          <PR label="params"><EI v={node.props.params||"x"} sc={scope} onChange={v=>onChange({props:{...node.props,params:v}})}/></PR>
          <PR label={`${node.name||"f"}(…) =`}><XF v={node.props.expr||""} sc={scope} onChange={v=>onChange({props:{...node.props,expr:v}})}/></PR>
          <div style={{marginTop:8,padding:"7px 9px",background:"#08100a",borderRadius:4,border:"1px solid #162010",fontSize:14,color:"#7a9a70",fontFamily:"monospace",lineHeight:1.9}}>
            {(()=>{
              const params=(node.props.params||"x").split(",").map(s=>s.trim()).filter(Boolean);
              const fn=scope[node.name];
              if(!fn||typeof fn!=="function")return<span style={{color:"#2a3a28"}}>set a variable name above</span>;
              const samples=params.length<=1?[[0],[1],[2],[5],[10]]:[[0,0],[1,1],[2,3],[3,4]];
              return samples.map(args=>{
                let result;try{result=fn(...args);}catch{result=NaN;}
                const fmtd=isFinite(result)?Number(result.toPrecision(6)).toString():String(result);
                return<div key={args.join(",")}><span style={{color:"#4a6a40"}}>{node.name}({args.join(",")}) =</span> <span style={{color:"#8adb80"}}>{fmtd}</span></div>;
              });
            })()}
          </div>
        </Sec>}

        {/* ── Function map (real^m to real^n) ── */}
        {node.type==="fnMap"&&(()=>{
          const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
          const inDim=Math.max(1,Math.min(4,Math.round(Number(node.props.inDim||"1"))));
          const outDim=Math.max(1,Math.min(4,Math.round(Number(node.props.outDim||"1"))));
          const inVars=["x","y","z","w"].slice(0,inDim).join(", ");
          return <>
            <Sec title="Signature">
              <PR label="inputs">
                <select value={String(inDim)} onChange={e=>set("inDim",e.target.value)} style={{...S.inp,width:"100%"}}>
                  <option value="1">1 — f(x)</option>
                  <option value="2">2 — f(x, y)</option>
                  <option value="3">3 — f(x, y, z)</option>
                  <option value="4">4 — f(x, y, z, w)</option>
                </select>
              </PR>
              <PR label="outputs">
                <select value={String(outDim)} onChange={e=>set("outDim",e.target.value)} style={{...S.inp,width:"100%"}}>
                  <option value="1">1 — scalar</option>
                  <option value="2">2 — vector (2D)</option>
                  <option value="3">3 — vector (3D)</option>
                  <option value="4">4 — vector (4D)</option>
                </select>
              </PR>
              <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
                A pure map from {inDim} input{inDim>1?"s":""} to {outDim} output{outDim>1?"s":""}, in the variables <em>{inVars}</em>. It does not plot on its own — wire it into a <strong style={{color:TYPE_META.transformer.tc}}>Transformer</strong> to render it as a graph or a vector field. Only three outputs can map to spatial axes; a 4th is available as a scalar (e.g. for coloring).
              </div>
            </Sec>
            <Sec title={`Components ( in ${inVars} )`}>
              {Array.from({length:outDim}).map((_,k)=>(
                <PR key={k} label={`out${k}`}><XF v={node.props["out"+k]} sc={scope} onChange={v=>set("out"+k,v)}/></PR>
              ))}
            </Sec>
          </>;
        })()}

        {/* ── Equation: implicit relation lhs = rhs ── */}
        {node.type==="equation"&&(()=>{
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
        })()}

        {/* ── Transformer: renders a function map over a domain ── */}
        {node.type==="transformer"&&(()=>{
          const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
          const set2=(patch)=>onChange({props:{...node.props,...patch}});
          const mode=node.props.mode||"graph";
          const deps=(node.attachments||[]).map(id=>nodes[id]).filter(Boolean);
          const fnNode=deps.find(d=>d.type==="fnMap");
          const eqNode=deps.find(d=>d.type==="equation");
          // ── Implicit transformer (equation wired) ──
          if(eqNode){
            const eq3d=(eqNode.props.dims||"2d")==="3d";
            const va=(eqNode.props.varA||"x").trim()||"x";
            const vb=(eqNode.props.varB||"y").trim()||"y";
            const vc=(eqNode.props.varC||"z").trim()||"z";
            return <>
              <div style={{fontSize:14,color:TYPE_META.equation.tc,marginBottom:8,lineHeight:1.5,padding:"6px 8px",background:TYPE_META.equation.tc+"15",borderRadius:5,border:`1px solid ${TYPE_META.equation.tc}33`}}>
                Implicit {eq3d?"surface":"curve"} from <strong>{eqNode.label}</strong>: drawing <em>{eqNode.props.lhs} = {eqNode.props.rhs}</em> over the sampling box below ({va}→a, {vb}→b{eq3d?`, ${vc}→c`:""}).
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
                // Available render styles depend on the function's output dim.
                //   field+color : (outDim-1)-D vector field, last output → gradient
                //   field       : outDim-D vector field, single static color
                //   graph       : place each output on a spatial axis (curve/surface/solid)
                // 4-output maps can ONLY be a 3D vector field colored by the 4th output.
                const colored=(node.props.colorMode||"off")==="gradient";
                const cur = mode==="field" ? (colored||outDim>=4?"fieldcol":"field") : "graph";
                const opts=[];
                if(outDim>=4){
                  opts.push(["fieldcol","3D vector field + color (out3 → gradient)"]);
                }else{
                  // graph: curve(1)/surface(2)/solid(3) of the outputs as axes
                  if(outDim===1) opts.push(["graph","graph — curve y = f(x)"]);
                  else if(outDim===2) opts.push(["graph",`${inDim>=2?"surface":"graph"} (2 outputs → axes, static color)`]);
                  else if(outDim===3) opts.push(["graph","3D (3 outputs → axes, static color)"]);
                  // field variants
                  if(outDim>=2){
                    opts.push(["fieldcol",`${outDim-1}D vector field + color (out${outDim-1} → gradient)`]);
                    opts.push(["field",`${outDim}D vector field (static color)`]);
                  }
                }
                const pick=(v)=>{
                  if(v==="graph") set2({mode:"graph",colorMode:node.props.colorMode==="gradient"?"gradient":"off"});
                  else if(v==="field") set2({mode:"field",colorMode:"off"});
                  else if(v==="fieldcol") set2({mode:"field",colorMode:"gradient"});
                };
                return <>
                  <PR label="render">
                    <select value={cur} onChange={e=>pick(e.target.value)} style={{...S.inp,width:"100%"}}>
                      {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                    </select>
                  </PR>
                  <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
                    {cur==="graph"
                      ? <>Places each input and output component on a spatial axis. 1 input → curve, 2 inputs → surface, 3 inputs → solid point cloud.</>
                      : cur==="fieldcol"
                      ? <>Draws a {Math.max(1,Math.min(3,outDim-1))}D arrow at each sample, with the last output (<em>out{outDim-1}</em>) driving the color gradient below.</>
                      : <>Draws the full {Math.min(3,outDim)}D output vector as an arrow at each sample, in a single color.</>}
                  </div>
                </>;
              })()}
            </Sec>
            {fnNode&&<Sec title="Axis assignment">
              <div style={{fontSize:13,color:ui.uiMuted,marginBottom:4}}>Inputs to spatial axis</div>
              {Array.from({length:inDim}).map((_,k)=>(
                <PR key={"i"+k} label={["x","y","z","w"][k]}><AxisSel k={k} kind="in"/></PR>
              ))}
              <div style={{fontSize:13,color:ui.uiMuted,margin:"6px 0 4px"}}>Outputs to spatial axis</div>
              {Array.from({length:outDim}).map((_,k)=>(
                <PR key={"o"+k} label={`out${k}`}><AxisSel k={k} kind="out"/></PR>
              ))}
              {(inDim>3||outDim>3)&&<div style={{fontSize:12.5,color:ui.uiFaint,marginTop:5,lineHeight:1.5}}>Only three spatial axes exist; assign the 4th component to “—” or reuse it elsewhere.</div>}
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
            {(node.props.colorMode||"off")==="gradient"&&<Sec title="Coloring">
              {mode==="graph"&&<PR label="value"><XF v={node.props.colorExpr??"out0"} sc={scope} onChange={v=>set("colorExpr",v)}/></PR>}
              {mode==="field"&&<div style={{fontSize:12.5,color:ui.uiFaint,marginBottom:6,lineHeight:1.5}}>
                The reserved last output drives the gradient. Override with a custom <em>value</em> expression if you like (blank = last output).
              </div>}
              {mode==="field"&&<PR label="value"><XF v={node.props.colorExpr??""} sc={scope} onChange={v=>set("colorExpr",v)} placeholder={`out${outDim-1} (last output)`}/></PR>}
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
                {mode==="graph"
                  ? <>Color each vertex by <em>value</em> (inputs <em>x,y,z,w</em>; outputs <em>out0…out3</em>; param <em>t/u/v</em>), across the range onto the ramp. Applies to curves, surfaces, and solids.</>
                  : <>Each arrow is colored by its value across the range onto the ramp.</>}
              </div>
            </Sec>}
          </>;
        })()}

        {/* ── Unified: scalar-valued function ── */}
        {node.type==="scalarFn"&&(()=>{
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
          </>;
        })()}

        {/* ── Unified: parameterized space ── */}
        {node.type==="paramSpace"&&(()=>{
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
        })()}

        {/* ── Unified: points / glyphs / sequences ── */}
        {node.type==="points"&&(()=>{
          const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
          const hasVec=!!node.props.hasVectors;
          const xy=(node.props.space||"xy")==="xy";
          const normForCount = hasVec
            ? {type:"glyphField",props:{pairs:node.props.data}}
            : {type:"pointSeq",props:{points:node.props.data}};
          const count = hasVec ? parseGlyphField(node.props.data,scope).length : parsePointSeq(node.props.data,scope).length;
          return <>
            <Sec title="Layout">
              <PR label="space">
                <select value={node.props.space||"xy"} onChange={e=>set("space",e.target.value)} style={{...S.inp,width:"100%"}}>
                  <option value="xy">XY plane (2-D)</option>
                  <option value="xyz">XYZ space (3-D)</option>
                </select>
              </PR>
              <PR label="vectors"><Toggle v={hasVec} onChange={v=>set("hasVectors",v)}/></PR>
              <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
                {hasVec
                  ? <>Each entry is <em>position | vector</em>. {xy?"In XY mode the third component is dropped.":""}</>
                  : <>Each entry is a point. Turn on <em>vectors</em> to attach an arrow to each.</>}
              </div>
            </Sec>
            <Sec title={hasVec?"Data (position | vector)":"Data (points)"}>
              <div style={{fontSize:13,color:ui.uiFaint,marginBottom:5,lineHeight:1.7}}>
                <strong style={{color:ui.uiMuted}}>Plain:</strong> one per line —{" "}
                <span style={{fontFamily:"monospace",fontSize:13}}>{hasVec? (xy?"x, y | vx, vy":"x, y, z | vx, vy, vz") : (xy?"x, y":"x, y, z")}</span><br/>
                <strong style={{color:ui.uiMuted}}>Recursive:</strong> initial line, then a line using <em>{hasVec?"x[n-1], vx[n-1]…":"x[n-1], y[n-1]…"}</em>, then a count.<br/>
                <strong style={{color:ui.uiMuted}}>By index:</strong> closed-form in <em>i</em> (also j, k), then a count.<br/>
                <strong style={{color:ui.uiMuted}}>Matrix:</strong> 2-D/3-D index <em>i, j(, k)</em>, then sizes (e.g. <em>8, 8</em>).
              </div>
              <MathInput v={node.props.data||""} sc={scope} multiline onChange={v=>set("data",v)}
                placeholder={hasVec
                  ? "Plain:\n0,0,0 | 1,0,0\n1,1,0 | 0,1,0\n\nBy index:\ncos(i), sin(i), 0 | -sin(i), cos(i), 0\n48\n\nMatrix:\ni, j, 0 | sin(i), cos(j), 0\n8, 8"
                  : "Plain:\n0, 0\n1, 1\n2, 0\n\nRecursive:\n1, 0\nx[n-1]*0.99, y[n-1]+0.1\n80\n\nBy index:\ncos(i*0.3), sin(i*0.3)\n64\n\nMatrix:\ni, j, sin(i*j)\n8, 8"}/>
              <div style={{marginTop:5,color:ui.uiFaint,fontSize:14}}>
                {count} {hasVec?`glyph${count!==1?"s":""}`:`valid point${count!==1?"s":""}`}
              </div>
            </Sec>
            {!hasVec&&<Sec title="Point style">
              <PR label="radius"><EI v={node.props.radius||"4"} sc={scope} onChange={v=>set("radius",v)}/></PR>
              <PR label="lines"><Toggle v={node.props.drawLines!==false} onChange={v=>set("drawLines",v)}/></PR>
            </Sec>}
            {!hasVec&&<Sec title="Coloring">
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
            </Sec>}
            {hasVec&&(()=>{
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
            {!hasVec&&<Sec title="Sequencing">
              <div style={{fontSize:14,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
                Reveal points in order. Drive the fraction (0–1) with a literal or a connected scalar (e.g. an animator).
              </div>
              <PR label="reveal"><Toggle v={!!node.props.sequenced} onChange={v=>set("sequenced",v)}/></PR>
              {node.props.sequenced&&<>
                <PR label="frac"><EI v={node.props.seqFrac??"1"} sc={scope} onChange={v=>set("seqFrac",v)}/></PR>
                <PR label="var"><input value={node.props.seqVar||""} placeholder="(scalar name, optional)" onChange={e=>set("seqVar",e.target.value)} style={{...S.inp,width:"100%"}}/></PR>
              </>}
            </Sec>}
          </>;
        })()}

        {/* ── Geometry nodes (legacy, still rendered for older projects) ── */}
        {node.type==="point"&&<Sec title="Position">{[["x","x"],["y","y"],["z","z"],["r","radius"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec>}

        {node.type==="pointSeq"&&<Sec title="Points">
          <div style={{fontSize:14,color:"#2a3040",marginBottom:5,lineHeight:1.7}}>
            <strong style={{color:"#3a4a60"}}>Plain:</strong> one point per line — <span style={{color:"#4a5870"}}>x, y</span> or <span style={{color:"#4a5870"}}>x, y, z</span><br/>
            <strong style={{color:"#3a5040"}}>Recursive:</strong> 3-line format:<br/>
            <span style={{color:"#2a4030",fontFamily:"monospace",fontSize:13}}>
              &nbsp;Line 1: initial point &nbsp;<em>x₀, y₀</em><br/>
              &nbsp;Line 2: recurrence &nbsp;<em>x[n-1]+1, y[n-1]*0.9</em><br/>
              &nbsp;Line 3: count &nbsp;<em>50</em>
            </span><br/>
            <strong style={{color:"#3a4a60"}}>By index:</strong> closed-form in <em>i</em> (0-based):<br/>
            <span style={{color:"#2a4030",fontFamily:"monospace",fontSize:13}}>
              &nbsp;Line 1: <em>cos(i*0.3), sin(i*0.3)</em><br/>
              &nbsp;Line 2: count &nbsp;<em>64</em>
            </span><br/>
            <strong style={{color:"#3a4a60"}}>Matrix:</strong> 2-D index <em>i, j</em> → a grid:<br/>
            <span style={{color:"#2a4030",fontFamily:"monospace",fontSize:13}}>
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
          <div style={{marginTop:5,color:"#1e2a40",fontSize:14}}>
            {(()=>{const pts=parsePointSeq(node.props.points,scope);return`${pts.length} valid point${pts.length!==1?"s":""}`;})()}
          </div>
        </Sec>}
        {node.type==="pointSeq"&&<Sec title="Sequencing">
          <div style={{fontSize:14,color:"#2a3040",marginBottom:5,lineHeight:1.6}}>
            Reveal points in order. Drive the fraction (0–1) with a literal or a connected scalar (e.g. an animator) to animate the build-up without rebuilding geometry.
          </div>
          <PR label="reveal"><Toggle v={!!node.props.sequenced} onChange={v=>onChange({props:{...node.props,sequenced:v}})}/></PR>
          {node.props.sequenced&&<>
            <PR label="frac"><EI v={node.props.seqFrac??"1"} sc={scope} onChange={v=>onChange({props:{...node.props,seqFrac:v}})}/></PR>
            <PR label="var"><input value={node.props.seqVar||""} placeholder="(scalar name, optional)" onChange={e=>onChange({props:{...node.props,seqVar:e.target.value}})} style={{...S.inp,width:"100%"}}/></PR>
          </>}
        </Sec>}

        {node.type==="glyphField"&&<><Sec title="Pairs (seed | vector)">
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
        </Sec></>}
        {node.type==="quiver2d"&&<><Sec title="Field">
          <PR label="vx(x,y)"><XF v={node.props.exprX} sc={scope} onChange={v=>onChange({props:{...node.props,exprX:v}})}/></PR>
          <PR label="vy(x,y)"><XF v={node.props.exprY} sc={scope} onChange={v=>onChange({props:{...node.props,exprY:v}})}/></PR>
        </Sec><Sec title="Grid">
          {[["n","gridN"],["x₀","xMin"],["x₁","xMax"],["y₀","yMin"],["y₁","yMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
          <PR label="norm"><Toggle v={node.props.normalize!==false} onChange={v=>onChange({props:{...node.props,normalize:v}})}/></PR>
        </Sec></>}
        {node.type==="quiver3d"&&<><Sec title="Field">
          <PR label="vx(x,y,z)"><XF v={node.props.exprX} sc={scope} onChange={v=>onChange({props:{...node.props,exprX:v}})}/></PR>
          <PR label="vy(x,y,z)"><XF v={node.props.exprY} sc={scope} onChange={v=>onChange({props:{...node.props,exprY:v}})}/></PR>
          <PR label="vz(x,y,z)"><XF v={node.props.exprZ} sc={scope} onChange={v=>onChange({props:{...node.props,exprZ:v}})}/></PR>
        </Sec><Sec title="Grid">
          <PR label="n/axis"><EI v={node.props.gridN} sc={scope} onChange={v=>onChange({props:{...node.props,gridN:v}})}/></PR>
          {[["x₀","xMin"],["x₁","xMax"],["y₀","yMin"],["y₁","yMax"],["z₀","zMin"],["z₁","zMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
          <PR label="norm"><Toggle v={node.props.normalize!==false} onChange={v=>onChange({props:{...node.props,normalize:v}})}/></PR>
        </Sec></>}
        {node.type==="flow"&&(()=>{
          const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
          const deps=(node.attachments||[]).map(id=>nodes[id]).filter(Boolean);
          const fnNode=deps.find(d=>d.type==="fnMap");
          const seedNode=deps.find(d=>d.type==="paramSpace"||d.type==="points");
          const seedIsPoints=seedNode?.type==="points";
          const seedDeg=(seedNode&&!seedIsPoints)?Math.max(1,Math.min(2,Math.round(Number(seedNode.props.degree||"1")))):0;
          const seedCount=seedIsPoints?parsePointSeq(seedNode.props.data,scope).length:0;
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
                <PR label="gradient"><Toggle v={!!node.props.gradient} onChange={v=>set("gradient",v)}/></PR>
                {node.props.gradient&&<div style={{display:"flex",gap:6,alignItems:"center",marginTop:3}}>
                  <input type="color" value={node.props.gradA||"#5b9cf6"} onChange={e=>set("gradA",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
                  <div style={{flex:1,height:10,borderRadius:3,background:`linear-gradient(90deg, ${node.props.gradA||"#5b9cf6"}, ${node.props.gradB||"#f74fa0"})`}}/>
                  <input type="color" value={node.props.gradB||"#f74fa0"} onChange={e=>set("gradB",e.target.value)} style={{width:28,height:22,border:"none",background:"none",cursor:"pointer",padding:0}}/>
                </div>}
              </>}
            </Sec>
          </>;
        })()}
        {node.type==="fn1d"&&<><Sec title="Expression"><PR label="y(x)"><XF v={node.props.expr} sc={scope} onChange={v=>onChange({props:{...node.props,expr:v}})}/></PR></Sec><Sec title="Domain">{[["x₀","xMin"],["x₁","xMax"],["res","res"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec></>}
        {node.type==="curve3d"&&<><Sec title="Parametric">{[["x(t)","exprX"],["y(t)","exprY"],["z(t)","exprZ"]].map(([l,k])=><PR key={k} label={l}><XF v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec><Sec title="Domain">{[["t₀","tMin"],["t₁","tMax"],["res","res"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec></>}
        {node.type==="surf3d"&&<><Sec title="Expression"><PR label="z(x,y)"><XF v={node.props.expr} sc={scope} onChange={v=>onChange({props:{...node.props,expr:v}})}/></PR></Sec><Sec title="Domain">{[["x₀","xMin"],["x₁","xMax"],["y₀","yMin"],["y₁","yMax"],["res","res"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec></>}
        {node.type==="paramsurf"&&<><Sec title="Parametric">{[["x(u,v)","exprX"],["y(u,v)","exprY"],["z(u,v)","exprZ"]].map(([l,k])=><PR key={k} label={l}><XF v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec><Sec title="Domain">{[["u₀","uMin"],["u₁","uMax"],["v₀","vMin"],["v₁","vMax"],["uRes","uRes"],["vRes","vRes"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec></>}

        {/* ── Camera ── */}
        {isCamera&&<>
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
            <PR label="type">
              <select value={node.props.planeMode||"xy"} onChange={e=>onChange({props:{...node.props,planeMode:e.target.value}})} style={{...S.inp,width:"100%"}}>
                <option value="xy">XY (default)</option>
                <option value="plane">Flat plane</option>
                <option value="paramsurf">Parametric surface ↗</option>
              </select>
            </PR>
            {node.props.planeMode==="plane"&&<>
              <div style={{color:"#252a40",fontSize:14,margin:"4px 0 2px"}}>Origin</div>
              {[["ox","planeOx"],["oy","planeOy"],["oz","planeOz"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]||"0"} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
              <div style={{color:"#252a40",fontSize:14,margin:"4px 0 2px"}}>U axis</div>
              {[["ux","planeUx"],["uy","planeUy"],["uz","planeUz"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]||"0"} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
              <div style={{color:"#252a40",fontSize:14,margin:"4px 0 2px"}}>V axis</div>
              {[["vx","planeVx"],["vy","planeVy"],["vz","planeVz"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]||"0"} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
              <PR label="thr."><EI v={node.props.planeThreshold||"0.15"} sc={scope} onChange={v=>onChange({props:{...node.props,planeThreshold:v}})}/></PR>
            </>}
            {node.props.planeMode==="paramsurf"&&<>
              <div style={{color:"#3a5040",fontSize:14,margin:"4px 0 2px"}}>Surface (axes = u,v param domain)</div>
              <PR label="x(u,v)"><XF v={node.props.psExprX||"cos(u)*sin(v)"} sc={scope} onChange={v=>onChange({props:{...node.props,psExprX:v}})}/></PR>
              <PR label="y(u,v)"><XF v={node.props.psExprY||"sin(u)*sin(v)"} sc={scope} onChange={v=>onChange({props:{...node.props,psExprY:v}})}/></PR>
              <PR label="z(u,v)"><XF v={node.props.psExprZ||"cos(v)"} sc={scope} onChange={v=>onChange({props:{...node.props,psExprZ:v}})}/></PR>
              <div style={{color:"#252a40",fontSize:14,margin:"4px 0 2px"}}>Domain</div>
              {[["u₀","psUMin"],["u₁","psUMax"],["v₀","psVMin"],["v₁","psVMax"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]||"0"} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}
              <PR label="res"><EI v={node.props.psRes||"16"} sc={scope} onChange={v=>onChange({props:{...node.props,psRes:v}})}/></PR>
              <PR label="dist thr."><EI v={node.props.psDistThreshold||"0.35"} sc={scope} onChange={v=>onChange({props:{...node.props,psDistThreshold:v}})}/></PR>
            </>}
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
            <div style={{fontSize:13,color:"#1e2840",marginBottom:5,lineHeight:1.6}}>
              Choose what's visible in shared & embedded views.
            </div>
            <PR label="cam label"><Toggle v={node.props.showCamLabel!==false} onChange={v=>onChange({props:{...node.props,showCamLabel:v}})}/></PR>
            <PR label="reset btn"><Toggle v={node.props.showResetBtn!==false} onChange={v=>onChange({props:{...node.props,showResetBtn:v}})}/></PR>
            <PR label="hints"><Toggle v={!!node.props.showHints} onChange={v=>onChange({props:{...node.props,showHints:v}})}/></PR>
            <PR label="share btn"><Toggle v={node.props.showShareBtn!==false} onChange={v=>onChange({props:{...node.props,showShareBtn:v}})}/></PR>
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
                <div style={{fontSize:13,color:"#1e2840",marginTop:7,marginBottom:3,borderTop:"1px solid #141628",paddingTop:5}}>
                  HUD scalars:
                </div>
                {wiredScalars.map(sc => {
                  const meta = TYPE_META[sc.type]||{tc:"#888"};
                  return (
                    <div key={sc.id} style={{display:"flex",alignItems:"center",gap:5,marginBottom:2}}>
                      <div style={{width:6,height:6,borderRadius:2,flexShrink:0,background:meta.tc}}/>
                      <span style={{flex:1,color:"#4a5870",fontSize:14,fontFamily:"monospace"}}>{sc.name}</span>
                      <span style={{color:"#232540",fontSize:13}}>{meta.tag}</span>
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
        </>}

        <div style={{marginTop:14,paddingTop:12,borderTop:"1px solid #141628"}}><NodeAddGrid onAddNode={onAddNode} projectNode={Object.values(nodes).find(n=>n.type==="project")}/></div>
      </div>
    </div>
  );
}

// Memoized so the throttled animation preview tick in <Editor> doesn't re-render
// the entire panel — and every MathInput in it — on every frame. With stable
// handler props and a frame-stable `scope` (see App.jsx panelScope), an
// animation that doesn't affect the selected node produces no panel re-render.
const PropsPanel = memo(PropsPanelImpl);

export {
  PropsPanel
};
