import { useUI } from "../../theme/tokens.jsx";
import { NodeAddGrid, PanelTopBar } from "../primitives.jsx";

// Shown when nothing is selected: a short intro plus the add-node grid.
export function EmptyPanel({ nodes, onAddNode, onPopOut, popped }){
  const{ui}=useUI();
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PanelTopBar onPopOut={onPopOut} popped={popped}/>
      <div style={{padding:18,fontFamily:"monospace",fontSize:16,color:ui.uiFaint,overflowY:"auto"}}>
        <div style={{color:ui.uiAccent,fontSize:17,fontWeight:"bold",marginBottom:8}}>Dedekind</div>
        <div style={{lineHeight:2.1,color:ui.uiMuted,fontSize:15}}>Click a node · drag port to connect · Del to remove<br/>Scalar nodes (CST/SLD/ANM/FN) connect to specific cameras via their right port.</div>
        <div style={{marginTop:16,borderTop:`1px solid ${ui.uiInputBorder}`,paddingTop:12}}><NodeAddGrid onAddNode={onAddNode} projectNode={Object.values(nodes).find(n=>n.type==="project")}/></div>
      </div>
    </div>
  );
}
