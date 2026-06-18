import { useState } from "react";
import { useUI } from "../../theme/tokens.jsx";
import { Sec } from "../primitives.jsx";

// Selection actions: copy the current selection to the clipboard as JSON, and
// expand the selection to its dependencies or full connected component. Shown
// whenever at least one node is selected. `count` is the size of the current
// selection (so the copy button can label how many nodes it will copy).
export function SelectionActions({ count, onCopySelection, onSelectDependencies, onSelectConnected }){
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
