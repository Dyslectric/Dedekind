import { useEffect, useRef } from "react";
import { resolveNum } from "../core/math.js";

// ── Animator RAF hook ────────────────────────────────────────────────────────
function useAnimators(nodes,setNodes,animValsRef){
  const frameRef=useRef({});const startRef=useRef({});
  const nodesRef=useRef(nodes);useEffect(()=>{nodesRef.current=nodes;});
  useEffect(()=>{
    for(const n of Object.values(nodes)){
      if(n.type!=="animator"||!n.playing)continue;
      if(frameRef.current[n.id])continue;
      const lo=resolveNum(n.props.min,{},0),hi=resolveNum(n.props.max,{},1);
      const period=resolveNum(n.props.period,{},4)*1000;
      const prog=((animValsRef.current[n.id]??n.value)-lo)/((hi-lo)||1);
      startRef.current[n.id]=performance.now()-prog*period;
      const tick=()=>{
        const node=nodesRef.current[n.id];if(!node||!node.playing){frameRef.current[n.id]=null;return;}
        const lo2=resolveNum(node.props.min,{},0),hi2=resolveNum(node.props.max,{},1);
        const per=resolveNum(node.props.period,{},4)*1000;
        // ── step size support ──────────────────────────────────────────────
        const stepSize=node.props.step?resolveNum(node.props.step,{},0):0;
        const t=((performance.now()-startRef.current[node.id])%per)/per;
        let val;
        if(node.props.loop==="bounce") val=lo2+(hi2-lo2)*(t<0.5?2*t:2-2*t);
        else if(node.props.loop==="once"){val=lo2+(hi2-lo2)*Math.min(t,1);if(t>=1){animValsRef.current[node.id]=val;frameRef.current[node.id]=null;setNodes(ns=>({...ns,[node.id]:{...ns[node.id],value:val,playing:false}}));return;}}
        else val=lo2+(hi2-lo2)*t;
        // Quantize to step if set
        if(stepSize>0){val=lo2+Math.round((val-lo2)/stepSize)*stepSize;}
        animValsRef.current[n.id]=val;frameRef.current[n.id]=requestAnimationFrame(tick);
      };
      frameRef.current[n.id]=requestAnimationFrame(tick);
    }
    for(const[id,f]of Object.entries(frameRef.current)){if(!f)continue;const node=nodes[id];if(!node||!node.playing){cancelAnimationFrame(f);frameRef.current[id]=null;}}
  });
  useEffect(()=>()=>{Object.values(frameRef.current).forEach(f=>f&&cancelAnimationFrame(f));},[]);
}

export {
  useAnimators
};
