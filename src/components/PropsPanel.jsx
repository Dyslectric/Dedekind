import { useState, useEffect, useRef, useMemo, memo } from "react";
import { useUI, darken, relLum } from "../theme/tokens.jsx";
import { catOf, SCALAR_TYPES, isFunctionType, isDomainType, isCameraType, canAttach, canBeDependency, canConsume } from "../core/taxonomy.js";
import { collectScalarDeps, resolveScope } from "../core/scope.js";
import { resolveNum, safeEval } from "../core/math.js";
import { TYPE_META, makeNode } from "../nodes/model.js";
import { ADDABLE_KINDS, kindEnabled } from "../nodes/kinds.js";
import { parsePointSeq, parseGlyphField, parsePointsExplicit, parseGlyphsExplicit } from "../geometry/parse.js";
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
  // The panel may be light (e.g. Paper / Catppuccin Latte); the identity colors
  // are light pastels, so darken them for value readouts on a light panel.
  const panelLight = relLum(ui.uiPanelBar||"#0b0c1c") > 0.45;
  const metaTc = panelLight ? darken(meta.tc, 0.5) : meta.tc;
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
          <div style={{marginTop:6,padding:"6px 9px",background:ui.uiInputBg,borderRadius:4,border:`1px solid ${ui.uiInputBorder}`,fontSize:14,color:ui.uiAccent,fontFamily:"monospace",lineHeight:1.9}}>
            {(()=>{
              if(!node.name)return<span style={{color:ui.uiMuted}}>set a variable name above</span>;
              // Prefer the value already resolved into scope (computed from the
              // node's full transitive deps, same path the plot output uses); fall
              // back to re-evaluating the raw expression if it's not present.
              let val=typeof scope[node.name]==="number"?scope[node.name]:NaN;
              if(!isFinite(val)) val=resolveNum(node.props.expr,scope,NaN);
              if(!isFinite(val))return<span style={{color:ui.uiMuted}}>…</span>;
              const fmtd=Math.abs(val)>=1000||(Math.abs(val)<0.001&&val!==0)?val.toExponential(4):Number(val.toPrecision(6)).toString();
              return<span><span style={{color:ui.uiMuted}}>{node.name} =</span> <span style={{color:ui.uiAccent,fontWeight:"bold"}}>{fmtd}</span></span>;
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
          <div style={{textAlign:"center",color:metaTc,fontWeight:"bold",fontSize:17,marginTop:2}}>{node.name} = {Number(node.value||0).toFixed(4)}</div>
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
            <button onClick={()=>onChange({playing:!node.playing})} style={{...S.btn,color:node.playing?ui.uiDanger:ui.uiGood,flex:1}}>{node.playing?"■ Pause":"▶ Play"}</button>
            <button onClick={()=>onChange({value:resolveNum(node.props.min,scope,0),playing:false})} style={S.btn}>↩</button>
          </div>
          <div style={{height:4,background:ui.uiInputBg,border:`1px solid ${ui.uiInputBorder}`,borderRadius:2,overflow:"hidden",marginTop:6}}>
            <div style={{height:"100%",background:meta.tc,opacity:0.7,width:`${100*((liveAnimVal??node.value)-resolveNum(node.props.min,scope,0))/((resolveNum(node.props.max,scope,1)-resolveNum(node.props.min,scope,0))||1)}%`}}/>
          </div>
          <div style={{textAlign:"center",color:metaTc,fontWeight:"bold",fontSize:16,marginTop:3}}>{node.name} = {Number((liveAnimVal??node.value)||0).toFixed(4)}</div>
          <div style={{fontSize:13,color:ui.uiMuted,marginTop:4}}>
            step: sets discrete tick amount — leave blank for smooth (continuous)
          </div>
        </Sec>}

        {/* ── Function definition ── */}
        {node.type==="fnDef"&&<Sec title="Definition">
          <PR label="params"><EI v={node.props.params||"x"} sc={scope} onChange={v=>onChange({props:{...node.props,params:v}})}/></PR>
          <PR label={`${node.name||"f"}(…) =`}><XF v={node.props.expr||""} sc={scope} onChange={v=>onChange({props:{...node.props,expr:v}})}/></PR>
          <div style={{marginTop:8,padding:"7px 9px",background:ui.uiInputBg,borderRadius:4,border:`1px solid ${ui.uiInputBorder}`,fontSize:14,color:ui.uiGood,fontFamily:"monospace",lineHeight:1.9}}>
            {(()=>{
              const params=(node.props.params||"x").split(",").map(s=>s.trim()).filter(Boolean);
              const fn=scope[node.name];
              if(!fn||typeof fn!=="function")return<span style={{color:ui.uiMuted}}>set a variable name above</span>;
              const samples=params.length<=1?[[0],[1],[2],[5],[10]]:[[0,0],[1,1],[2,3],[3,4]];
              return samples.map(args=>{
                let result;try{result=fn(...args);}catch{result=NaN;}
                const fmtd=isFinite(result)?Number(result.toPrecision(6)).toString():String(result);
                return<div key={args.join(",")}><span style={{color:ui.uiMuted}}>{node.name}({args.join(",")}) =</span> <span style={{color:ui.uiText,fontWeight:"bold"}}>{fmtd}</span></div>;
              });
            })()}
          </div>
        </Sec>}

        {/* ── Function map (real^m to real^n) ── */}
        {node.type==="fnMap"&&(()=>{
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
              {eq3d&&<Sec title="Display">
                <PR label="wireframe"><Toggle v={node.props.showWire!==false} onChange={v=>set("showWire",v)}/></PR>
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
                // Coloring is independent: bind any one output to the Color target
                // in the assignment section below.
                const cur = mode==="field" ? "vector" : "function";
                const pick=(v)=> set2({mode: v==="vector" ? "field" : "graph"});
                return <>
                  <PR label="render">
                    <select value={cur} onChange={e=>pick(e.target.value)} style={{...S.inp,width:"100%"}}>
                      <option value="function">function plot — outputs are positions</option>
                      <option value="vector">vector field — outputs are arrow directions</option>
                    </select>
                  </PR>
                  <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
                    {cur==="function"
                      ? <>Each output bound to X/Y/Z places that coordinate; {inDim===1?"1 input → curve":inDim===2?"2 inputs → surface":"3 inputs → solid point cloud"}. Bind an output to <em>Color</em> for a gradient.</>
                      : <>Draws an arrow at each input sample; outputs bound to X/Y/Z form the arrow vector. Bind an output to <em>Color</em> for a gradient.</>}
                  </div>
                </>;
              })()}
            </Sec>
            {fnNode&&(()=>{
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
            {mode==="graph"&&inDim===2&&<Sec title="Display">
              <PR label="wireframe"><Toggle v={node.props.showWire!==false} onChange={v=>set("showWire",v)}/></PR>
              <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
                For a 2-input graph surface. Off renders a single shaded mesh (GPU-accelerated) — faster for dense or animated maps.
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
            {dims==="2"&&<Sec title="Display">
              <PR label="wireframe"><Toggle v={node.props.showWire!==false} onChange={v=>set("showWire",v)}/></PR>
              <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
                Draws grid lines over the surface. Turning it off renders a single shaded mesh — faster for dense or animated surfaces.
              </div>
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
        })()}

        {/* ── Unified: points / glyphs / sequences ── */}
        {node.type==="points"&&(()=>{
          const set=(k,v)=>onChange({props:{...node.props,[k]:v}});
          const kind = node.props.kind || (node.props.hasVectors ? "glyphs" : "points");
          const mode = node.props.mode || "list";
          const useColor = !!node.props.useColor;
          const isGlyph = kind==="glyphs";
          // live count for the footer
          let count=0;
          try{
            count = isGlyph ? parseGlyphsExplicit(node.props,scope).pairs.length
                            : parsePointsExplicit(node.props,scope).pts.length;
          }catch(e){ count=0; }
          // tuple shape hint
          const tupleHint = isGlyph
            ? "(x, y[, z]) | (vx, vy[, vz])"
            : "(x, y[, z])";
          const colorSlotHint = useColor
            ? (isGlyph ? " | color" : ", color")
            : "";
          return <>
            <Sec title="Kind">
              <PR label="type">
                <select value={kind} onChange={e=>set("kind",e.target.value)} style={{...S.inp,width:"100%"}}>
                  <option value="points">points</option>
                  <option value="glyphs">glyphs (point + vector)</option>
                </select>
              </PR>
              <PR label="source">
                <select value={mode} onChange={e=>set("mode",e.target.value)} style={{...S.inp,width:"100%"}}>
                  <option value="list">list (explicit entries)</option>
                  <option value="index">by index (i, j, k, n)</option>
                  <option value="recursive">recursive (x[n-k]…)</option>
                </select>
              </PR>
              <PR label="color slot"><Toggle v={useColor} onChange={v=>set("useColor",v)}/></PR>
              <div style={{fontSize:13,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
                Each entry is <em>{tupleHint}{colorSlotHint}</em>.{" "}
                {useColor && <>The color slot is a scalar mapped onto the ramp below{mode==="recursive"?", and may reference c[n-1]":""}.</>}
              </div>
            </Sec>

            {/* ── LIST ── */}
            {mode==="list" && !isGlyph && <Sec title="Points (list)">
              <div style={{fontSize:13,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
                One ordered pair or triple per line (commas inside, lines or <em>;</em> between).{" "}
                {useColor && <>Append a trailing value for color: <span style={{fontFamily:"monospace"}}>x, y, z, c</span>.</>}
              </div>
              <MathInput v={node.props.listPoints||""} sc={scope} multiline onChange={v=>set("listPoints",v)}
                placeholder={useColor?"0, 0, 0\n1, 1, 2\n2, 0, 4":"0, 0\n1, 1\n2, 0\n3, 1"}/>
            </Sec>}
            {mode==="list" && isGlyph && <Sec title="Glyphs (list)">
              <div style={{fontSize:13,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
                One glyph per line as <em>seed | vector</em>, each an ordered pair or triple.{" "}
                {useColor && <>Add a third <em>| color</em> segment for the color scalar.</>}
              </div>
              <MathInput v={node.props.listGlyphs||""} sc={scope} multiline onChange={v=>set("listGlyphs",v)}
                placeholder={useColor?"0, 0 | 1, 0 | 0\n1, 1 | 0, 1 | 1":"0, 0 | 1, 0\n1, 1 | 0, 1\n2, 0 | 1, 0"}/>
            </Sec>}

            {/* ── INDEX ── */}
            {mode==="index" && <Sec title={isGlyph?"Glyph by index":"Point by index"}>
              <div style={{fontSize:13,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
                A closed form in <em>i</em> (also <em>j, k</em> for a grid, and <em>n</em> = flat index).{" "}
                {isGlyph?<>Written as <em>seed | vector</em>.</>:null}
              </div>
              <PR label={isGlyph?"seed | vector":"tuple"}>
                <MathInput v={(isGlyph?node.props.idxGlyph:node.props.idxPoint)||""} sc={scope}
                  onChange={v=>set(isGlyph?"idxGlyph":"idxPoint",v)}
                  placeholder={isGlyph?"cos(i), sin(i) | -sin(i), cos(i)":"cos(i*0.3), sin(i*0.3)"}/>
              </PR>
              {useColor && <PR label="color">
                <MathInput v={node.props.colExpr??"i"} sc={scope} onChange={v=>set("colExpr",v)} placeholder="i"/>
              </PR>}
              <PR label="count">
                <MathInput v={(isGlyph?node.props.idxGlyphCount:node.props.idxCount)||""} sc={scope}
                  onChange={v=>set(isGlyph?"idxGlyphCount":"idxCount",v)} placeholder="64"/>
              </PR>
              <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
                Count applies in all directions: <em>a</em> → a row of a; <em>a, b</em> → an a×b grid (i, j); <em>a, b, c</em> → a×b×c (i, j, k).
              </div>
            </Sec>}

            {/* ── RECURSIVE ── */}
            {mode==="recursive" && <Sec title={isGlyph?"Recursive glyphs":"Recursive points"}>
              <div style={{fontSize:13,color:ui.uiFaint,marginBottom:5,lineHeight:1.6}}>
                Each entry depends on the previous via <em>x[n-1], y[n-1]{isGlyph?", vx[n-1], vy[n-1]":""}</em> (any depth k).
              </div>
              <PR label="initial">
                <MathInput v={(isGlyph?node.props.recGlyphInit:node.props.recInit)||""} sc={scope}
                  onChange={v=>set(isGlyph?"recGlyphInit":"recInit",v)}
                  placeholder={isGlyph?"4, 4 | 0, 1":"1, 0"}/>
              </PR>
              <PR label="next">
                <MathInput v={(isGlyph?node.props.recGlyphStep:node.props.recStep)||""} sc={scope} multiline
                  onChange={v=>set(isGlyph?"recGlyphStep":"recStep",v)}
                  placeholder={isGlyph?"x[n-1]*0.97 - y[n-1]*0.12, y[n-1]*0.97 + x[n-1]*0.12 | vx[n-1], vy[n-1]":"x[n-1]*0.99, y[n-1]+0.1"}/>
              </PR>
              {useColor && <>
                <PR label="color init"><MathInput v={node.props.colRecInit??"0"} sc={scope} onChange={v=>set("colRecInit",v)} placeholder="0"/></PR>
                <PR label="color next"><MathInput v={node.props.colRecStep??"c[n-1]+1"} sc={scope} onChange={v=>set("colRecStep",v)} placeholder="c[n-1]+1"/></PR>
              </>}
              <PR label="count">
                <MathInput v={(isGlyph?node.props.recGlyphCount:node.props.recCount)||""} sc={scope}
                  onChange={v=>set(isGlyph?"recGlyphCount":"recCount",v)} placeholder="80"/>
              </PR>
            </Sec>}

            <div style={{margin:"4px 0 2px",color:ui.uiFaint,fontSize:14,paddingLeft:2}}>
              {count} {isGlyph?`glyph${count!==1?"s":""}`:`valid point${count!==1?"s":""}`}
            </div>

            {!isGlyph&&<Sec title="Point style">
              <PR label="radius"><EI v={node.props.radius||"4"} sc={scope} onChange={v=>set("radius",v)}/></PR>
              <PR label="lines"><Toggle v={node.props.drawLines!==false} onChange={v=>set("drawLines",v)}/></PR>
            </Sec>}

            {/* Color ramp — endpoints for the color slot (or legacy gradient). */}
            {useColor ? <Sec title="Color ramp">
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
                Each entry's color scalar maps across the range (blank = auto-fit) onto this ramp.
              </div>
            </Sec> : (!isGlyph && <Sec title="Coloring">
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
            </Sec>)}

            {isGlyph&&(()=>{
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
            {!isGlyph&&<Sec title="Sequencing">
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
        </Sec>}
        {node.type==="pointSeq"&&<Sec title="Sequencing">
          <div style={{fontSize:14,color:ui.uiMuted,marginBottom:5,lineHeight:1.6}}>
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
        })()}
        {node.type==="fn1d"&&<><Sec title="Expression"><PR label="y(x)"><XF v={node.props.expr} sc={scope} onChange={v=>onChange({props:{...node.props,expr:v}})}/></PR></Sec><Sec title="Domain">{[["x₀","xMin"],["x₁","xMax"],["res","res"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec></>}
        {node.type==="curve3d"&&<><Sec title="Parametric">{[["x(t)","exprX"],["y(t)","exprY"],["z(t)","exprZ"]].map(([l,k])=><PR key={k} label={l}><XF v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec><Sec title="Domain">{[["t₀","tMin"],["t₁","tMax"],["res","res"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec></>}
        {node.type==="surf3d"&&<><Sec title="Expression"><PR label="z(x,y)"><XF v={node.props.expr} sc={scope} onChange={v=>onChange({props:{...node.props,expr:v}})}/></PR></Sec><Sec title="Domain">{[["x₀","xMin"],["x₁","xMax"],["y₀","yMin"],["y₁","yMax"],["res","res"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec><Sec title="Display"><PR label="wireframe"><Toggle v={node.props.showWire!==false} onChange={v=>onChange({props:{...node.props,showWire:v}})}/></PR></Sec></>}
        {node.type==="paramsurf"&&<><Sec title="Parametric">{[["x(u,v)","exprX"],["y(u,v)","exprY"],["z(u,v)","exprZ"]].map(([l,k])=><PR key={k} label={l}><XF v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec><Sec title="Domain">{[["u₀","uMin"],["u₁","uMax"],["v₀","vMin"],["v₁","vMax"],["uRes","uRes"],["vRes","vRes"]].map(([l,k])=><PR key={k} label={l}><EI v={node.props[k]} sc={scope} onChange={v=>onChange({props:{...node.props,[k]:v}})}/></PR>)}</Sec><Sec title="Display"><PR label="wireframe"><Toggle v={node.props.showWire!==false} onChange={v=>onChange({props:{...node.props,showWire:v}})}/></PR></Sec></>}

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
