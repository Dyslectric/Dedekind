import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { catOf, canAttach, canBeDependency, canConsume, SCALAR_TYPES, isFunctionType, isDomainType, isCameraType } from "../core/taxonomy.js";
import { NW, getOutPort, getInPort, TYPE_META } from "../nodes/model.js";
import { buildNodePalette, NODE_DARK } from "../theme/tokens.jsx";
import { resolveNum } from "../core/math.js";
import { resolveScope } from "../core/scope.js";

// Card height for a node, matching CanvasNode's own calc. Cameras grow with the
// number of plots they show; sliders/animators are taller to fit an interactive
// control (a drag track / a play button); expr cards show a value line.
// Everything else is a compact single-line card. Used both for rendering and
// for marquee hit-testing.
function nodeHeight(node, nodes){
  if(isCameraType(node.type)) return Math.max(56,40+(node.attachments?.filter(a=>catOf(nodes[a]?.type)==="plot").length||0)*18+8);
  if(node.type==="slider") return 54;
  if(node.type==="animator") return 60;
  return node.type==="expr"?58:40;
}

function NodeCanvas({ nodes, selected, selectionSet, onSelect, onMove, onMoveMany, onConnect, onDisconnect, onDelete, onMarqueeSelect, onPasteAtWorld, onToggleEnabled, onDetach, onUpdateNode, animValsRef, theme, projectNode }) {
  const selSet = selectionSet || (selected?new Set([selected]):new Set());
  const svgRef=useRef(null),gRef=useRef(null),edgesRef=useRef(null);
  const viewRef=useRef({panX:50,panY:50,zoom:1});
  const[viewVer,setViewVer]=useState(0);
  const dragRef=useRef(null),wireRef=useRef(null);
  const[wireKey,setWireKey]=useState(0);
  // Rubber-band rectangular selection overlay, in SCREEN coords {x0,y0,x1,y1}.
  // null when no marquee is in progress. mode is "add" or "subtract".
  const[marquee,setMarquee]=useState(null);
  // Live cursor position in SVG-client coords, kept for paste-under-cursor.
  const mouseRef=useRef({x:0,y:0,inside:false});
  const[tick,setTick]=useState(0);
  useEffect(()=>{let raf;const loop=()=>{if(Object.values(nodes).some(n=>n.type==="animator"&&n.playing))setTick(t=>t+1);raf=requestAnimationFrame(loop);};raf=requestAnimationFrame(loop);return()=>cancelAnimationFrame(raf);},[nodes,theme]);

  const applyTransform=useCallback(()=>{const{panX,panY,zoom}=viewRef.current;if(gRef.current)gRef.current.setAttribute("transform",`translate(${panX},${panY}) scale(${zoom})`);},[]);
  const redrawEdges=useCallback((ns)=>{
    const n=ns||nodes;const eg=edgesRef.current;if(!eg)return;
    const pm={};
    if(svgRef.current)svgRef.current.querySelectorAll("[data-id]").forEach(el=>{const id=el.getAttribute("data-id");const t=el.getAttribute("transform")||"";const m=t.match(/translate\(([^,]+),([^)]+)\)/);if(m)pm[id]={x:parseFloat(m[1]),y:parseFloat(m[2])};});
    eg.querySelectorAll("[data-edge]").forEach(el=>{
      const eid=el.getAttribute("data-edge");const[depId,consId]=eid.split("--");
      const dep=n[depId], cons=n[consId];
      const cp=pm[depId]||(dep?.pos)||{x:0,y:0};
      const chp=pm[consId]||(cons?.pos)||{x:0,y:0};
      const depCat=catOf(dep?.type);
      const op={x:cp.x+NW, y:cp.y+(depCat==="scalar"?20:34)};
      const ip={x:chp.x, y:chp.y+(isCameraType(cons?.type)?18:28)};
      const cpx=(op.x+ip.x)/2;
      const path=el.querySelector("path.edge-path");if(path)path.setAttribute("d",`M${op.x},${op.y} C${cpx},${op.y} ${cpx},${ip.y} ${ip.x},${ip.y}`);
      const mid=el.querySelector("circle.edge-mid");const mt=el.querySelector("text.edge-mid-txt");
      if(mid){mid.setAttribute("cx",(op.x+ip.x)/2);mid.setAttribute("cy",(op.y+ip.y)/2);}
      if(mt){mt.setAttribute("x",(op.x+ip.x)/2);mt.setAttribute("y",(op.y+ip.y)/2+4/viewRef.current.zoom);}
    });
  },[nodes]);

  useEffect(()=>{
    const svg=svgRef.current;if(!svg)return;
    const onMM=e=>{
      // Keep the live cursor position (SVG-client coords) for paste-under-cursor.
      // The `inside` flag is owned by the svg's mouseenter/leave handlers.
      const rr=svg.getBoundingClientRect();
      mouseRef.current.x=e.clientX-rr.left; mouseRef.current.y=e.clientY-rr.top;
      const d=dragRef.current;
      if(d){const{zoom}=viewRef.current;
        if(d.type==="slider"){
          // Map pointer X along the card-local track to a value in [min,max],
          // snapped to step. Track geometry was captured (in world units) at
          // pointer-down; convert the pointer to world X the same way.
          const r=svg.getBoundingClientRect();const{panX}=viewRef.current;
          const worldX=(e.clientX-r.left-panX)/zoom;
          let f=(worldX-d.trackX0)/(d.trackW||1);
          f=f<0?0:f>1?1:f;
          let val=d.min+f*(d.max-d.min);
          if(d.step>0) val=Math.round(val/d.step)*d.step;
          // avoid fp noise from the snap
          val=Math.round(val*1e6)/1e6;
          if(val!==d.lastVal){ d.lastVal=val; d.onUpdate(d.id,{value:val}); }
          return;
        }
        if(d.type==="marquee"){
          d.x1=e.clientX; d.y1=e.clientY;
          // Render as screen-space rect relative to the svg element.
          const r=svg.getBoundingClientRect();
          setMarquee({x0:d.x0-r.left,y0:d.y0-r.top,x1:e.clientX-r.left,y1:e.clientY-r.top,mode:d.mode});
        }
        else if(d.type==="pan"){viewRef.current.panX=d.spx+(e.clientX-d.sx);viewRef.current.panY=d.spy+(e.clientY-d.sy);applyTransform();redrawEdges();}
        else if(d.type==="node"){
          const dx=(e.clientX-d.sx)/zoom, dy=(e.clientY-d.sy)/zoom;
          if(Math.abs(e.clientX-d.sx)+Math.abs(e.clientY-d.sy)>2) d.moved=true;
          const members=d.group||[{id:d.id,spx:d.spx,spy:d.spy}];
          for(const m of members){
            const nx=m.spx+dx, ny=m.spy+dy;
            const el=svg.querySelector(`[data-id="${m.id}"]`);
            if(el)el.setAttribute("transform",`translate(${nx},${ny})`);
            m.curX=nx; m.curY=ny;
          }
          // primary's live position (used as a fallback on commit)
          d.curX=d.spx+dx; d.curY=d.spy+dy;
          redrawEdges();
        }
      }
      if(wireRef.current){
        const r=svg.getBoundingClientRect();const{panX,panY,zoom}=viewRef.current;
        wireRef.current.curX=(e.clientX-r.left-panX)/zoom;wireRef.current.curY=(e.clientY-r.top-panY)/zoom;
        const wl=svg.querySelector("#wire-line");if(wl){const w=wireRef.current;const fn=nodes[w.fromId];if(fn){const fp=w.portType==="out"?getOutPort(fn):getInPort(fn);const cpx=(fp.x+w.curX)/2;wl.setAttribute("d",`M${fp.x},${fp.y} C${cpx},${fp.y} ${cpx},${w.curY} ${w.curX},${w.curY}`);}}
      }
    };
    const onMU=e=>{
      const d=dragRef.current;
      if(d?.type==="marquee"){
        // Convert the screen-space marquee to world coords and hit-test node
        // bounding boxes (intersection test, so partially-covered nodes count).
        const r=svg.getBoundingClientRect();
        const{panX,panY,zoom}=viewRef.current;
        const toWorld=(cx,cy)=>({x:(cx-r.left-panX)/zoom, y:(cy-r.top-panY)/zoom});
        const a=toWorld(d.x0,d.y0), b=toWorld(d.x1??d.x0,d.y1??d.y0);
        const minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x);
        const minY=Math.min(a.y,b.y),maxY=Math.max(a.y,b.y);
        const dragged=Math.abs((d.x1??d.x0)-d.x0)+Math.abs((d.y1??d.y0)-d.y0)>3;
        if(dragged){
          const hit=[];
          for(const n of Object.values(nodes)){
            if(n.type==="project") continue;
            const nx=n.pos.x, ny=n.pos.y, nw=NW, nh=nodeHeight(n,nodes);
            // AABB intersection between marquee and node card.
            if(nx<=maxX && nx+nw>=minX && ny<=maxY && ny+nh>=minY) hit.push(n.id);
          }
          if(hit.length && onMarqueeSelect) onMarqueeSelect(hit, d.mode);
        }
        dragRef.current=null; setMarquee(null);
        return;
      }
      if(d?.type==="node"){
        const members=d.group||[{id:d.id,spx:d.spx,spy:d.spy,curX:d.curX,curY:d.curY}];
        if(d.moved){
          // Commit every moved member. Use a batch update when more than one.
          if(members.length>1 && onMoveMany){
            const posById={};
            for(const m of members) posById[m.id]={x:m.curX??m.spx,y:m.curY??m.spy};
            onMoveMany(posById);
          } else {
            onMove(d.id,{x:d.curX??d.spx,y:d.curY??d.spy});
          }
        } else if(d.collapseTo){
          // A click (no drag) on an already-grouped node collapses the selection
          // to just that node.
          onSelect(d.collapseTo,false);
        }
      }
      dragRef.current=null;
      if(wireRef.current){
        const r=svg.getBoundingClientRect();const{panX,panY,zoom}=viewRef.current;
        const wx=(e.clientX-r.left-panX)/zoom,wy=(e.clientY-r.top-panY)/zoom;const w=wireRef.current;
        const fn=nodes[w.fromId];
        // Hit-test: a drop counts if it lands near the target's port OR anywhere
        // over the target node's body. The body test makes wiring forgiving —
        // you don't have to land precisely on the small port dot.
        const overBody=(node)=>{
          const x=node.pos.x, y=node.pos.y;
          return wx>=x-10 && wx<=x+NW+10 && wy>=y-6 && wy<=y+64;
        };
        for(const node of Object.values(nodes)){
          if(node.id===w.fromId)continue;
          // A wire goes dependency(out) → consumer(in). Depending on which port
          // the user grabbed, fn is either the dependency or the consumer.
          if(w.portType==="out"){
            // fn is a dependency; drop on a consumer's input port (or its body)
            if(canAttach(fn.type,node.type)){
              const ip=getInPort(node);
              if(Math.hypot(ip.x-wx,ip.y-wy)<16 || overBody(node)){ onConnect("dep",fn.id,node.id); break; }
            }
          } else {
            // fn is a consumer (grabbed its input port); drop on a dependency's output port (or its body)
            if(canAttach(node.type,fn.type)){
              const op=getOutPort(node);
              if(Math.hypot(op.x-wx,op.y-wy)<16 || overBody(node)){ onConnect("dep",node.id,fn.id); break; }
            }
          }
        }
        wireRef.current=null;setWireKey(k=>k+1);
      }
    };
    const onWheel=e=>{
      e.preventDefault();const r=svg.getBoundingClientRect();const cx=e.clientX-r.left,cy=e.clientY-r.top;
      const f=e.deltaY<0?1.1:0.91;const oz=viewRef.current.zoom,nz=Math.max(0.1,Math.min(4,oz*f));
      viewRef.current.panX=cx-(cx-viewRef.current.panX)*(nz/oz);viewRef.current.panY=cy-(cy-viewRef.current.panY)*(nz/oz);viewRef.current.zoom=nz;
      applyTransform();redrawEdges();setViewVer(v=>v+1);
    };
    window.addEventListener("mousemove",onMM);window.addEventListener("mouseup",onMU);svg.addEventListener("wheel",onWheel,{passive:false});
    return()=>{window.removeEventListener("mousemove",onMM);window.removeEventListener("mouseup",onMU);svg.removeEventListener("wheel",onWheel);};
  },[nodes,onMove,onMoveMany,onSelect,onConnect,applyTransform,redrawEdges]);

  useEffect(()=>{const onKey=e=>{if((e.key==="Delete")&&!["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)){const ids=selSet.size?[...selSet]:(selected?[selected]:[]);ids.forEach(id=>onDelete(id));}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);},[selSet,selected,onDelete]);

  // Ctrl/⌘+V pastes a Dedekind selection from the clipboard, centered under the
  // cursor (in graph world coords). Suppressed while editing a text field so the
  // browser's normal paste still works there. The actual clipboard read happens
  // in the App handler (async clipboard API, with a prompt fallback).
  useEffect(()=>{
    const isEditing=()=>{const el=document.activeElement;if(!el)return false;const t=el.tagName;return t==="INPUT"||t==="TEXTAREA"||t==="SELECT"||el.isContentEditable;};
    const worldUnderCursor=()=>{
      const m=mouseRef.current;const{panX,panY,zoom}=viewRef.current;
      // If the cursor isn't over the canvas, fall back to the visible center.
      if(!m.inside){const r=svgRef.current?.getBoundingClientRect();const cx=(r?.width||800)/2,cy=(r?.height||600)/2;return{x:(cx-panX)/zoom,y:(cy-panY)/zoom};}
      return{x:(m.x-panX)/zoom, y:(m.y-panY)/zoom};
    };
    const onKey=e=>{
      const mod=e.ctrlKey||e.metaKey;
      if(!mod||e.shiftKey||e.altKey) return;
      if((e.key||"").toLowerCase()!=="v" && e.code!=="KeyV") return;
      if(isEditing()) return;
      onPasteAtWorld&&onPasteAtWorld(worldUnderCursor());
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[onPasteAtWorld]);
  useEffect(()=>{redrawEdges(nodes);},[nodes,redrawEdges]);

  const onBgDown=useCallback(e=>{
    if(e.button!==0)return;
    const ctrl=e.ctrlKey||e.metaKey;
    if(ctrl){
      // Ctrl-drag = rectangular select (add); Ctrl+Alt-drag = rectangular
      // deselect (subtract). Start a marquee instead of panning.
      e.preventDefault();
      dragRef.current={type:"marquee",x0:e.clientX,y0:e.clientY,x1:e.clientX,y1:e.clientY,mode:e.altKey?"subtract":"add"};
      const r=svgRef.current.getBoundingClientRect();
      setMarquee({x0:e.clientX-r.left,y0:e.clientY-r.top,x1:e.clientX-r.left,y1:e.clientY-r.top,mode:e.altKey?"subtract":"add"});
      return;
    }
    dragRef.current={type:"pan",sx:e.clientX,sy:e.clientY,spx:viewRef.current.panX,spy:viewRef.current.panY};
    if(!e.shiftKey)onSelect(null);
  },[onSelect]);
  const onNodeDown=useCallback((e,id)=>{
    if(e.button!==0)return;e.stopPropagation();
    if(e.shiftKey){
      // Shift+click toggles membership; don't begin a drag so the toggle reads
      // cleanly (a tiny accidental drag would otherwise move the node).
      onSelect(id,true);
      dragRef.current=null;
      return;
    }
    // Plain mousedown. Two cases:
    //  (a) the node is already part of a multi-selection → keep the selection so
    //      the whole group can be dragged; if the press turns out to be a click
    //      with no drag, we collapse to just this node on mouseup.
    //  (b) otherwise → select just this node now.
    const alreadyGrouped = selSet.has(id) && selSet.size>1;
    if(!alreadyGrouped) onSelect(id,false);
    const groupIds = alreadyGrouped ? [...selSet].filter(g=>nodes[g]) : [id];
    const group = groupIds.map(g=>({id:g, spx:nodes[g].pos.x, spy:nodes[g].pos.y}));
    dragRef.current={type:"node",id,sx:e.clientX,sy:e.clientY,spx:nodes[id].pos.x,spy:nodes[id].pos.y,group,moved:false,collapseTo:alreadyGrouped?id:null};
  },[nodes,onSelect,selSet]);
  const onPortDown=useCallback((e,id,pt)=>{e.stopPropagation();const r=svgRef.current.getBoundingClientRect();const{panX,panY,zoom}=viewRef.current;wireRef.current={fromId:id,portType:pt,curX:(e.clientX-r.left-panX)/zoom,curY:(e.clientY-r.top-panY)/zoom};setWireKey(k=>k+1);},[]);

  // Begin dragging a slider card's thumb. trackLocalX0 / trackLocalW are the
  // track's geometry in card-local (world) units; we precompute the world-space
  // track start so onMM can map the pointer straight to a value. We do NOT
  // select the node — adjusting a slider shouldn't steal selection from whatever
  // the user currently has focused — and we DON'T start a node-move drag.
  const onSliderDown=useCallback((e,id,trackLocalX0,trackLocalW,min,max,step)=>{
    if(e.button!==0)return; e.stopPropagation();
    const node=nodes[id]; if(!node)return;
    dragRef.current={ type:"slider", id, onUpdate:onUpdateNode,
      trackX0:node.pos.x+trackLocalX0, trackW:trackLocalW, min, max, step, lastVal:undefined };
    // commit immediately so a click (no move) also jumps the thumb to the point
    const r=svgRef.current.getBoundingClientRect();const{panX,zoom}=viewRef.current;
    const worldX=(e.clientX-r.left-panX)/zoom;
    let f=(worldX-(node.pos.x+trackLocalX0))/(trackLocalW||1); f=f<0?0:f>1?1:f;
    let val=min+f*(max-min); if(step>0) val=Math.round(val/step)*step; val=Math.round(val*1e6)/1e6;
    dragRef.current.lastVal=val; onUpdateNode && onUpdateNode(id,{value:val});
  },[nodes,onSelect,onUpdateNode]);

  // Toggle an animator's play state. We do NOT select the node — hitting play
  // shouldn't steal selection from whatever the user currently has focused.
  const onTogglePlay=useCallback((e,id)=>{
    e.stopPropagation();
    const node=nodes[id]; if(!node)return;
    onUpdateNode && onUpdateNode(id,{playing:!node.playing});
  },[nodes,onUpdateNode]);

  const{panX,panY,zoom}=viewRef.current;

  const edges=useMemo(()=>{
    const r=[];
    // Every node stores its upstream deps in `attachments`. Draw an edge from
    // each dep's OUT port to this consumer's IN port. Style by dep category.
    for(const consumer of Object.values(nodes)){
      for(const depId of (consumer.attachments||[])){
        const dep=nodes[depId]; if(!dep) continue;
        const cat=catOf(dep.type);
        const isAux = cat==="scalar"||cat==="function"||cat==="domain"||cat==="map";
        const op = {x:dep.pos.x+NW, y:dep.pos.y+(cat==="scalar"?20:34)};
        const ip = {x:consumer.pos.x, y:consumer.pos.y+(isCameraType(consumer.type)?18:28)};
        const col = cat==="plot" ? (dep.color||"#3a5888")
                  : cat==="domain" ? "#3a6a9a"
                  : cat==="function" ? "#5a9a6a"
                  : cat==="map" ? "#5a9ad8"   // fnMap → transformer
                  : "#7a6aa8"; // scalar
        r.push({id:`${depId}--${consumer.id}`, op, ip, fromId:depId, toId:consumer.id, color:col, isAux});
      }
    }
    return r;
  },[nodes]);

  const wireNow=wireRef.current;
  const nodePal=useMemo(()=>buildNodePalette(projectNode||{props:theme}),[projectNode,theme]);
  // expr-node card readouts are evaluated per-node against each expr's OWN direct
  // scope (see exprVal below), matching the strict rule that a node may only use
  // variables wired directly to it. `tick` is referenced there so the readout
  // still tracks live animator values.
  void tick;

  return(
    <svg ref={svgRef} style={{width:"100%",height:"100%",userSelect:"none",background:(theme.nodeBg||"#0a0c18")}} onMouseDown={onBgDown}
      onMouseEnter={()=>{mouseRef.current.inside=true;}}
      onMouseLeave={()=>{mouseRef.current.inside=false;}}>
      <g ref={gRef} transform={`translate(${panX},${panY}) scale(${zoom})`}>
        <g ref={edgesRef}>
          {edges.map(e=>(
            <g key={e.id} data-edge={e.id}>
              <path className="edge-path" d={`M${e.op.x},${e.op.y} C${(e.op.x+e.ip.x)/2},${e.op.y} ${(e.op.x+e.ip.x)/2},${e.ip.y} ${e.ip.x},${e.ip.y}`}
                fill="none" stroke={e.color} strokeWidth={e.isAux?1.5/zoom:2/zoom} strokeOpacity={e.isAux?0.5:0.6}
                strokeDasharray={e.isAux?`${5/zoom},${3/zoom}`:undefined}/>
              <circle className="edge-mid" cx={(e.op.x+e.ip.x)/2} cy={(e.op.y+e.ip.y)/2} r={7/zoom}
                fill={nodePal.nodeHdrBg} stroke={nodePal.nodeBorder} strokeWidth={1/zoom} style={{cursor:"pointer"}}
                onClick={()=>onDisconnect("dep",e.fromId,e.toId)}/>
              <text className="edge-mid-txt" x={(e.op.x+e.ip.x)/2} y={(e.op.y+e.ip.y)/2+4/zoom}
                textAnchor="middle" fontSize={14/zoom} fill={nodePal.accent?nodePal.accent("#ee6666"):"#ee6666"} fontFamily="monospace" style={{pointerEvents:"none"}}>×</text>
            </g>
          ))}
        </g>
        {wireNow&&(()=>{const fn=nodes[wireNow.fromId];if(!fn)return null;const fp=wireNow.portType==="out"?getOutPort(fn):getInPort(fn);const cpx=(fp.x+wireNow.curX)/2;return<path id="wire-line" d={`M${fp.x},${fp.y} C${cpx},${fp.y} ${cpx},${wireNow.curY} ${wireNow.curX},${wireNow.curY}`} fill="none" stroke={nodePal.nodeSel} strokeWidth={2/zoom} strokeDasharray={`${6/zoom},${4/zoom}`} opacity={0.8}/>;})()}
        {Object.values(nodes).map(n=>(
          <CanvasNode key={n.id} node={n} selected={selected===n.id} inSelection={selSet.has(n.id)} zoom={zoom} nodes={nodes} pal={nodePal}
            onMouseDown={e=>onNodeDown(e,n.id)} onPortDown={onPortDown}
            onDelete={onDelete} onToggleEnabled={onToggleEnabled} onDetach={onDetach}
            onSliderDown={onSliderDown} onTogglePlay={onTogglePlay}
            exprVal={n.type==="expr"?(()=>{ const es=resolveScope(n.id,nodes,animValsRef.current); return n.name&&typeof es[n.name]==="number"?es[n.name]:resolveNum(n.props?.expr,es,NaN); })():undefined}
            liveVal={n.type==="animator"?(animValsRef.current[n.id]??n.value):undefined}/>
        ))}
      </g>
      {marquee&&(()=>{
        const x=Math.min(marquee.x0,marquee.x1), y=Math.min(marquee.y0,marquee.y1);
        const w=Math.abs(marquee.x1-marquee.x0), h=Math.abs(marquee.y1-marquee.y0);
        const sub=marquee.mode==="subtract";
        const stroke=sub?(nodePal.accent?nodePal.accent("#f7716b"):"#f7716b"):nodePal.nodeSel;
        return <rect x={x} y={y} width={w} height={h}
          fill={stroke} fillOpacity={0.10} stroke={stroke} strokeOpacity={0.9}
          strokeWidth={1.5} strokeDasharray="5,3" style={{pointerEvents:"none"}}/>;
      })()}
    </svg>
  );
}

function CanvasNode({ node, selected, inSelection, zoom, nodes, pal, onMouseDown, onPortDown, onDelete, onToggleEnabled, onDetach, onSliderDown, onTogglePlay, exprVal, liveVal }) {
  pal = pal || NODE_DARK;
  const isCamera=isCameraType(node.type),isProject=node.type==="project",isScalar=SCALAR_TYPES.has(node.type);
  const meta=TYPE_META[node.type]||{tag:"?",tc:"#888"};
  // Card height: cameras grow with their plot list; scalars/animators are short
  // (they show a live value); everything else is a compact single-line card —
  // no property dump (that lives in the properties panel).
  const showsVal = node.type==="slider"||node.type==="animator";
  const h=nodeHeight(node,nodes);
  const dimmed=isCamera&&node.enabled===false;
  const displayVal=liveVal!=null?liveVal:(node.value??0);
  const rawTint=node.color||meta.tc;
  // On light themes the light-pastel identity colors wash out; tcFor darkens
  // them to a readable level (identity on dark themes passes through unchanged).
  const tint=(pal.tcFor?pal.tcFor(rawTint):rawTint);

  const connectedCamCount = (isScalar||isFunctionType(node.type)||isDomainType(node.type))
    ? Object.values(nodes).filter(c=>(c.attachments||[]).includes(node.id)).length
    : 0;

  return(
    <g data-id={node.id} transform={`translate(${node.pos.x},${node.pos.y})`} opacity={dimmed?0.4:1}>
      <rect x={3/zoom} y={3/zoom} width={NW} height={h} rx={8} fill={pal.nodeShadow} opacity={0.35}/>
      {/* selection ring: a soft halo around any node that's part of a multi-
          selection (drawn behind the card). The primary node additionally gets
          the strong stroke below. */}
      {inSelection&&!selected&&<rect x={-3/zoom} y={-3/zoom} width={NW+6/zoom} height={h+6/zoom} rx={10} fill="none" stroke={pal.nodeSel} strokeWidth={2/zoom} opacity={0.55} strokeDasharray={`${5/zoom},${3/zoom}`}/>}
      <rect width={NW} height={h} rx={8} fill={pal.nodeCardBg} stroke={selected?pal.nodeSel:(inSelection?pal.nodeSel:pal.nodeBorder)} strokeWidth={selected?2/zoom:(inSelection?1.5/zoom:1/zoom)} opacity={selected||!inSelection?1:0.9}/>
      {/* header bar tinted faintly by the node's identity color */}
      <rect width={NW} height={26} rx={8} fill={pal.nodeHdrBg}/><rect y={13} width={NW} height={13} fill={pal.nodeHdrBg}/>
      <rect width={4} height={26} rx={2} fill={tint} opacity={0.9}/>
      <rect width={NW} height={h} rx={8} fill="transparent" onMouseDown={onMouseDown} style={{cursor:"grab"}}/>
      <rect x={9} y={6} width={32} height={14} rx={3} fill={tint} opacity={0.16}/>
      <text x={25} y={16.5} textAnchor="middle" fontSize={13} fill={tint} fontFamily="monospace" fontWeight="bold" style={{pointerEvents:"none"}}>{meta.tag}</text>
      <text x={47} y={17} fontSize={14.5} fill={pal.nodeLabel} fontFamily="monospace" fontWeight="bold" style={{pointerEvents:"none"}}>{node.label}{node.name?` (${node.name})`:""}</text>
      {node.color&&<circle cx={NW-14} cy={13} r={5} fill={node.color} stroke={pal.nodeBorder} strokeWidth={0.5} style={{pointerEvents:"none"}}/>}
      {isCamera&&<>
        {(()=>{const en=pal.chip("#43d088"),off=pal.chip("#e06a6a");const c=node.enabled?en:off;return(
        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();onToggleEnabled(node.id);}}>
          <rect x={NW-40} y={5} width={15} height={15} rx={3} fill={c.bg} stroke={c.border} strokeWidth={0.8}/>
          <text x={NW-32.5} y={16} textAnchor="middle" fontSize={13} fill={c.fg} fontFamily="monospace" style={{pointerEvents:"none"}}>{node.enabled?"●":"○"}</text>
        </g>);})()}
        {(()=>{const c=pal.chip("#4a90d8");return(
        <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();onDetach(node.id);}}>
          <rect x={NW-22} y={5} width={15} height={15} rx={3} fill={c.bg} stroke={c.border} strokeWidth={0.8}/>
          <text x={NW-14.5} y={16} textAnchor="middle" fontSize={13} fill={c.fg} fontFamily="monospace" style={{pointerEvents:"none"}}>⊞</text>
        </g>);})()}
      </>}
      {!isProject&&!isCamera&&(()=>{const c=pal.chip("#e85555");return(
      <g style={{cursor:"pointer"}} onClick={e=>{e.stopPropagation();onDelete(node.id);}}>
        <rect x={NW-9} y={-3} width={13} height={13} rx={3} fill={c.bg} stroke={c.border} strokeWidth={0.8}/>
        <text x={NW-2.5} y={7} textAnchor="middle" fontSize={13} fill={c.fg} fontFamily="monospace" style={{pointerEvents:"none"}}>×</text>
      </g>);})()}
      <line x1={8} y1={28} x2={NW-8} y2={28} stroke={pal.nodeBorder} strokeWidth={0.7} opacity={0.6} style={{pointerEvents:"none"}}/>
      {/* Camera shows its plot list (the one genuinely useful body content). */}
      {isCamera&&(node.attachments||[]).filter(a=>catOf(nodes[a]?.type)==="plot").map((cid,i)=>{const child=nodes[cid];if(!child)return null;const m=TYPE_META[child.type]||{};const dotC=(pal.tcFor?pal.tcFor(child.color||m.tc||"#556"):(child.color||m.tc||"#556"));return<g key={cid} style={{pointerEvents:"none"}}><rect x={11} y={35+i*18} width={6} height={6} rx={1.5} fill={dotC} opacity={0.9}/><text x={23} y={43+i*18} fontSize={13.5} fill={pal.nodeSub} fontFamily="monospace">{child.label}</text></g>;})}
      {/* Slider: live value readout + an interactive drag track. */}
      {node.type==="slider"&&(()=>{
        const min=resolveNum(node.props?.min,{}, -5), max=resolveNum(node.props?.max,{},5);
        const step=resolveNum(node.props?.step,{},0);
        const val=Number(node.value||0);
        const tx0=12, tw=NW-24, ty=46;
        let f=(val-min)/((max-min)||1); f=f<0?0:f>1?1:f;
        const thumbX=tx0+f*tw;
        return <g>
          <text x={12} y={40} fontSize={13.5} fill={pal.nodeSub} fontFamily="monospace" style={{pointerEvents:"none"}}>{val.toFixed(3)}</text>
          {/* hit area + track + filled portion + thumb */}
          <rect x={tx0-3} y={ty-7} width={tw+6} height={14} fill="transparent"
            style={{cursor:"pointer"}}
            onMouseDown={e=>onSliderDown(e,node.id,tx0,tw,min,max,step)}/>
          <rect x={tx0} y={ty-1.5} width={tw} height={3} rx={1.5} fill={pal.nodeBorder} style={{pointerEvents:"none"}}/>
          <rect x={tx0} y={ty-1.5} width={Math.max(0,thumbX-tx0)} height={3} rx={1.5} fill={tint} opacity={0.85} style={{pointerEvents:"none"}}/>
          <circle cx={thumbX} cy={ty} r={5.5} fill={tint} stroke={pal.nodeCardBg} strokeWidth={1.5} style={{pointerEvents:"none"}}/>
        </g>;
      })()}
      {node.type==="expr"&&(()=>{
        const exprStr=node.props?.expr||"";
        const shown=exprStr.slice(0,20)+(exprStr.length>20?"…":"");
        const out = (typeof exprVal==="number" && isFinite(exprVal))
          ? (Math.abs(exprVal)>=1e5||(Math.abs(exprVal)<1e-4&&exprVal!==0) ? exprVal.toExponential(3) : Number(exprVal.toPrecision(6)).toString())
          : null;
        return <g style={{pointerEvents:"none"}}>
          <text x={12} y={39} fontSize={12.5} fill={pal.accent?pal.accent("#7fd8ff"):"#7fd8ff"} fontFamily="monospace" opacity={0.85}>{shown||" "}</text>
          <text x={12} y={52} fontSize={12.5} fontFamily="monospace" fill={out!=null?tint:pal.nodeSub} opacity={out!=null?0.95:0.5}>
            {out!=null ? `= ${out}` : "= …"}
          </text>
        </g>;
      })()}
      {/* Animator: play/pause button + live value readout. */}
      {node.type==="animator"&&(()=>{
        const playing=!!node.playing;
        const by=46;          // button center y — lowered for more bottom room
        return <g>
          <g style={{cursor:"pointer"}} onMouseDown={e=>onTogglePlay(e,node.id)}>
            <circle cx={20} cy={by} r={9} fill={playing?tint:pal.nodeHdrBg} stroke={playing?tint:pal.nodeBorder} strokeWidth={1.2} opacity={playing?0.9:1}/>
            {playing
              // pause glyph (two bars), centered on the button
              ? <g style={{pointerEvents:"none"}}><rect x={16.5} y={by-4} width={2.5} height={8} rx={0.6} fill={pal.nodeCardBg}/><rect x={21} y={by-4} width={2.5} height={8} rx={0.6} fill={pal.nodeCardBg}/></g>
              // play glyph (triangle)
              : <path d={`M17.5,${by-4.5} L24,${by} L17.5,${by+4.5} Z`} fill={tint} style={{pointerEvents:"none"}}/>}
          </g>
          <text x={36} y={by+4.5} fontSize={13.5} fill={playing?(pal.accent?pal.accent("#ff8844"):"#ff8844"):pal.nodeSub} fontFamily="monospace" style={{pointerEvents:"none"}}>{Number(displayVal).toFixed(3)}</text>
        </g>;
      })()}
      {isScalar&&connectedCamCount>0&&<text x={NW-16} y={40} fontSize={13} fill={pal.nodeSub} fontFamily="monospace" textAnchor="end" style={{pointerEvents:"none"}}>→{connectedCamCount}</text>}
      {/* Ports */}
      {canBeDependency(node.type)&&<g style={{cursor:"crosshair"}} onMouseDown={e=>onPortDown(e,node.id,"out")}>
        <circle cx={NW} cy={isScalar?20:34} r={7} fill={pal.nodeHdrBg} stroke={tint} strokeWidth={1.4} opacity={0.95}/><circle cx={NW} cy={isScalar?20:34} r={3} fill={tint} opacity={0.9}/>
      </g>}
      {canConsume(node.type)&&<g style={{cursor:"crosshair"}} onMouseDown={e=>onPortDown(e,node.id,"in")}>
        <circle cx={0} cy={isCamera?18:28} r={7} fill={pal.nodeHdrBg} stroke={pal.nodeBorder} strokeWidth={1.4}/><circle cx={0} cy={isCamera?18:28} r={3} fill={tint} opacity={0.8}/>
      </g>}
    </g>
  );
}

export {
  NodeCanvas, CanvasNode
};
