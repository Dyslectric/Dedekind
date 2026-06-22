import { useUI } from "../../theme/tokens.jsx";
import { resolveNum, evalArray } from "../../core/math.js";
import { resolveScope } from "../../core/scope.js";
import { EI, XF } from "../MathInput.jsx";
import { Sec, PR } from "../primitives.jsx";

// Compact preview of a resolved array value: shape + first elements. Vector rows
// ([x,y,z]) render as tuples; deep/huge arrays are summarised.
function fmtList(v){
  if(!Array.isArray(v)) return "—";
  const n=v.length;
  const isVec=n>0 && Array.isArray(v[0]);
  const head=v.slice(0,6).map(e=>Array.isArray(e)
    ? "("+e.slice(0,3).map(x=>typeof x==="number"?(+x.toPrecision(4)):x).join(", ")+")"
    : (typeof e==="number"?(+e.toPrecision(5)):String(e))).join(", ");
  const shape=isVec?`${n}×${v[0].length}`:`${n}`;
  return `[${shape}]  ${head}${n>6?", …":""}`;
}

// Scalar-family editors: constant, expr, slider, animator, and the function
// definition (fnDef). Each takes the selected node plus the shared scope and an
// onChange that patches the node. `metaTc`/`liveAnimVal` are derived in the
// parent (they depend on panel lightness / the animation tick) and passed down.

export function ConstantEditor({ node, scope, onChange }){
  return <Sec title="Value"><PR label="val"><EI v={node.props.value} sc={scope} onChange={v=>onChange({props:{...node.props,value:v}})}/></PR></Sec>;
}

export function ExprEditor({ node, scope, onChange }){
  const{ui}=useUI();
  return <Sec title="Expression">
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
  </Sec>;
}

// list — a named array value. The expression yields an array: a literal, a range
// (1:n), or a built table. Vector lists ([x,y,z] rows) feed points/edges by index.
export function ListEditor({ node, nodes, scope, onChange }){
  const{ui}=useUI();
  // Resolve against the list's OWN direct deps so the preview matches what
  // consumers see (it may reference attached sliders/animators).
  const own=nodes?resolveScope(node.id,nodes,{}):scope;
  const val=evalArray(node.props.expr, {...scope,...own});
  return <Sec title="List">
    <PR label={`${node.name||"L"} =`}><XF v={node.props.expr||""} sc={scope} onChange={v=>onChange({props:{...node.props,expr:v}})}/></PR>
    <div style={{marginTop:6,padding:"6px 9px",background:ui.uiInputBg,borderRadius:4,border:`1px solid ${ui.uiInputBorder}`,fontSize:13.5,color:ui.uiAccent,fontFamily:"monospace",lineHeight:1.7,wordBreak:"break-word"}}>
      {val ? fmtList(val) : <span style={{color:ui.uiMuted}}>not an array — use [a, b, …], a range 1:n, or a list-valued expression</span>}
    </div>
    <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:5,lineHeight:1.5}}>
      A named array. Examples: <code>[1, 2, 3, 5, 8]</code>, a range <code>0:10</code>, evenly spaced <code>flatten(linspace(0, 2pi, 24))</code>, or a vertex table <code>[[0,0,0], [1,0,0], [1,1,0]]</code>. Reference it elsewhere by name — <code>{node.name||"L"}[k]</code> indexes it (1-based), <code>sum({node.name||"L"})</code> folds it. Wire it into a Points node to place points from it without copying.
    </div>
  </Sec>;
}

export function SliderEditor({ node, scope, onChange, meta, metaTc }){
  return <Sec title="Slider">
    <PR label="min"><EI v={node.props.min} sc={scope} onChange={v=>onChange({props:{...node.props,min:v}})}/></PR>
    <PR label="max"><EI v={node.props.max} sc={scope} onChange={v=>onChange({props:{...node.props,max:v}})}/></PR>
    <PR label="step"><EI v={node.props.step} sc={scope} onChange={v=>onChange({props:{...node.props,step:v}})}/></PR>
    <input type="range" min={resolveNum(node.props.min,scope,-5)} max={resolveNum(node.props.max,scope,5)} step={resolveNum(node.props.step,scope,0.01)} value={node.value||0} onChange={e=>onChange({value:+e.target.value})} style={{width:"100%",accentColor:meta.tc,marginTop:6}}/>
    <div style={{textAlign:"center",color:metaTc,fontWeight:"bold",fontSize:17,marginTop:2}}>{node.name} = {Number(node.value||0).toFixed(4)}</div>
  </Sec>;
}

export function AnimatorEditor({ node, scope, onChange, meta, metaTc, liveAnimVal }){
  const{ui,S}=useUI();
  return <Sec title="Animator">
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
  </Sec>;
}

export function FnDefEditor({ node, scope, onChange }){
  const{ui}=useUI();
  return <Sec title="Definition">
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
  </Sec>;
}
