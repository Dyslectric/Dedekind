import { useState, useEffect, useRef } from "react";
import { catOf, SCALAR_TYPES } from "../core/taxonomy.js";
import { collectScalarDeps, resolveScope } from "../core/scope.js";
import { resolveNum } from "../core/math.js";
import { FnDefRow } from "./FnDefRow.jsx";
import { useUI } from "../theme/tokens.jsx";

function ScalarOverlay({ camNode, nodes, scope, animValsRef, onUpdateNode, mobile }) {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    let raf;
    const loop = () => {
      const hasPlaying = Object.values(nodes).some(n =>
        n.type === "animator" && n.playing && (n.attachments||[]).includes(camNode.id)
      );
      if (hasPlaying) forceUpdate(x => x + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [nodes, camNode.id]);

  const hidden = new Set(camNode.props.hiddenScalars||[]);
  // scalars that are part of this camera's union scope: attached to the camera
  // directly, or to any plot the camera shows, or transitively via functions.
  const inScope = new Set();
  collectScalarDeps(camNode.id, nodes, inScope, new Set());
  for(const plotId of (camNode.attachments||[])){
    if(catOf(nodes[plotId]?.type)==="plot") collectScalarDeps(plotId, nodes, inScope, new Set());
  }
  const scalars = Object.values(nodes).filter(n =>
    SCALAR_TYPES.has(n.type) && inScope.has(n.id) && n.name && !hidden.has(n.id)
  );
  if (!scalars.length || camNode.props.showScalarOverlay === false) return null;

  const fmt4 = v => {
    if (!isFinite(v)) return String(v);
    if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(3);
    return Number(v.toPrecision(5)).toString();
  };

  // On mobile the overlay is placed UNDER the graph as a full-width bar (it
  // flows in the column layout the viewport sets up), instead of floating over
  // the plot where it would cover the geometry and be awkward to drag with a
  // thumb. On desktop it stays a compact floating panel in the lower-left.
  const containerStyle = mobile ? {
    position:"relative", width:"100%", zIndex:10,
    background:"#06081499", backdropFilter:"blur(6px)",
    borderTop:"1px solid #1a1e38",
    padding:"8px 12px", fontFamily:"monospace", fontSize:14,
    pointerEvents:"auto", lineHeight:1.8, boxSizing:"border-box",
    userSelect:"none",
  } : {
    position:"absolute", bottom:36, left:8, zIndex:10,
    background:"#06081499", backdropFilter:"blur(6px)",
    border:"1px solid #1a1e38", borderRadius:6,
    padding:"6px 10px", fontFamily:"monospace", fontSize:13,
    pointerEvents:"auto", lineHeight:1.7, maxWidth:240,
    userSelect:"none",
  };
  return (
    <div
      style={containerStyle}
      onMouseDown={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
      onTouchMove={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
    >
      {scalars.map(n => {
        // Each node's value is computed against ITS OWN direct scope (strict
        // scoping): an expr/constant/fnDef may reference only variables wired
        // directly into it, so the shared camera scope is not the right context.
        const ownSc = resolveScope(n.id, nodes, animValsRef?.current||{});
        if (n.type === "constant") {
          const val = resolveNum(n.props.value, ownSc, 0);
          return (
            <div key={n.id} style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{color:"#8a93b8",fontSize:12}}>=</span>
              <span style={{color:"#aab4cc",flex:1}}>{n.name}</span>
              <span style={{color:"#fba"}}>{fmt4(val)}</span>
            </div>
          );
        }
        if (n.type === "expr") {
          const val = resolveNum(n.props.expr, ownSc, NaN);
          return (
            <div key={n.id} style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{color:"#7fb8d8",fontSize:12}}>≈</span>
              <span style={{color:"#aab4cc",flex:1}}>{n.name}</span>
              <span style={{color:"#b5e8ff"}}>{isFinite(val)?fmt4(val):"…"}</span>
            </div>
          );
        }
        if (n.type === "fnDef") {
          return <FnDefRow key={n.id} node={n} scope={ownSc} onUpdateNode={onUpdateNode}/>;
        }
        if (n.type === "slider") {
          const min = resolveNum(n.props.min, ownSc, -5);
          const max = resolveNum(n.props.max, ownSc, 5);
          const step = resolveNum(n.props.step, ownSc, 0.01);
          const val = n.value ?? 0;
          return (
            <div key={n.id} style={{display:"flex",flexDirection:"column",gap:1,marginBottom:2}}>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <span style={{color:"#8a93b8",fontSize:12}}>⊟</span>
                <span style={{color:"#aab4cc",flex:1}}>{n.name}</span>
                <span style={{color:"#fd8",minWidth:52,textAlign:"right"}}>{fmt4(val)}</span>
              </div>
              <input
                type="range" min={min} max={max} step={step} value={val}
                onChange={e => onUpdateNode && onUpdateNode(n.id, {value: +e.target.value})}
                style={{width:"100%",accentColor:"#fd8",cursor:"pointer",height:14,margin:"1px 0 2px"}}
              />
            </div>
          );
        }
        if (n.type === "animator") {
          const val = animValsRef?.current?.[n.id] ?? n.value ?? 0;
          const min = resolveNum(n.props.min, ownSc, 0);
          const max = resolveNum(n.props.max, ownSc, 1);
          const pct = (max - min) > 0 ? (val - min) / (max - min) : 0;
          return (
            <div key={n.id} style={{display:"flex",flexDirection:"column",gap:1,marginBottom:2}}>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <button
                  onClick={() => onUpdateNode && onUpdateNode(n.id, {playing: !n.playing})}
                  style={{background:"none",border:"none",cursor:"pointer",color:n.playing?"#f84":"#aab4cc",padding:0,fontSize:13,lineHeight:1,fontFamily:"monospace"}}
                >
                  {n.playing ? "■" : "▶"}
                </button>
                <span style={{color:"#aab4cc",flex:1}}>{n.name}</span>
                <span style={{color:"#f76",minWidth:52,textAlign:"right"}}>{fmt4(val)}</span>
              </div>
              <div style={{height:3,background:"#0e0f1e",borderRadius:2,overflow:"hidden",margin:"1px 0 2px"}}>
                <div style={{height:"100%",background:"#f76",opacity:0.7,width:`${pct*100}%`}}/>
              </div>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

export {
  ScalarOverlay
};
