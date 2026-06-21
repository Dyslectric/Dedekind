import { useState, useEffect, memo } from "react";
import { useUI, darken, relLum } from "../theme/tokens.jsx";
import { SCALAR_TYPES, isFunctionType, isDomainType, isCameraType, canAttach, canBeDependency, canConsume } from "../core/taxonomy.js";
import { TYPE_META } from "../nodes/model.js";
import { NodeAddGrid, PanelTopBar } from "./primitives.jsx";

import { EmptyPanel } from "./propspanel/EmptyPanel.jsx";
import { PanelHeader } from "./propspanel/PanelHeader.jsx";
import { SelectionActions } from "./propspanel/SelectionActions.jsx";
import { ProjectSection, UsedBySection, InputsSection } from "./propspanel/DependencySections.jsx";
import { ConstantEditor, ExprEditor, SliderEditor, AnimatorEditor, FnDefEditor } from "./propspanel/ScalarEditors.jsx";
import { FnMapEditor, EquationEditor, ScalarFnEditor, ParamSpaceEditor } from "./propspanel/FunctionEditors.jsx";
import { TransformerEditor } from "./propspanel/TransformerEditor.jsx";
import { PointsEditor } from "./propspanel/PointsEditor.jsx";
import { RawGeomEditor } from "./propspanel/RawGeomEditor.jsx";
import { FlowEditor } from "./propspanel/FlowEditor.jsx";
import { CameraEditor } from "./propspanel/CameraEditor.jsx";
import {
  PointEditor, PointSeqEditor, GlyphFieldEditor, Quiver2dEditor, Quiver3dEditor,
  Fn1dEditor, Curve3dEditor, Surf3dEditor, ParamSurfEditor,
} from "./propspanel/LegacyEditors.jsx";

// ── Properties panel ─────────────────────────────────────────────────────────
//
// This is the thin orchestrator: it derives the shared values every editor
// needs (the node's dependency lists, identity color adjusted for panel
// lightness, the live animation value), renders the common header and
// dependency sections, then dispatches to the per-type editor module under
// ./propspanel for the node's body. Each editor is a self-contained component;
// adding a new node type means adding one editor file and one branch below.

function PropsPanelImpl({ node, nodes, scope, onChange, onAttach, onAddNode, onDelete, onToggleEnabled, onDetach, onOpenWindow, onDockCamera, isWindowed, onShareUrl, animValsRef, onConnectScalar, onDisconnectScalar, onDisconnect, onPopOut, popped, selectionSet, onCopySelection, onSelectDependencies, onSelectConnected, layout }) {
  const{ui}=useUI();
  const selCount=selectionSet?selectionSet.size:0;
  const[,forceUpdate]=useState(0);
  useEffect(()=>{
    if(node?.type!=="animator"||!node.playing)return;
    let raf;const loop=()=>{forceUpdate(x=>x+1);raf=requestAnimationFrame(loop);};raf=requestAnimationFrame(loop);return()=>cancelAnimationFrame(raf);
  },[node?.id,node?.playing]);

  if(!node)return <EmptyPanel nodes={nodes} onAddNode={onAddNode} onPopOut={onPopOut} popped={popped}/>;

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

  // Shared bag passed to the simpler editors.
  const ed = { node, nodes, scope, onChange, meta, metaTc, liveAnimVal };

  return(
    <div style={{fontFamily:"monospace",fontSize:16,color:ui.uiText,display:"flex",flexDirection:"column",height:"100%"}}>
      <PanelTopBar onPopOut={onPopOut} popped={popped}/>
      <PanelHeader node={node} onChange={onChange} onDelete={onDelete} onToggleEnabled={onToggleEnabled}
        onDetach={onDetach} onOpenWindow={onOpenWindow} onDockCamera={onDockCamera}
        isWindowed={isWindowed} onShareUrl={onShareUrl}/>
      <div style={{flex:1,overflowY:"auto",padding:"10px 12px"}}>

        <SelectionActions count={selCount} onCopySelection={onCopySelection}
          onSelectDependencies={onSelectDependencies} onSelectConnected={onSelectConnected}/>

        {/* ── Project ── */}
        {isProject&&<ProjectSection node={node} onChange={onChange} layout={layout}/>}

        {/* ── Used by (downstream consumers) ── */}
        {usedBy.length>0 && (isScalar||isFunctionType(node.type)||isDomainType(node.type)) &&
          <UsedBySection node={node} usedBy={usedBy} onDisconnect={onDisconnect}/>}

        {/* ── Inputs (upstream dependencies) for functions / plots / domains ── */}
        {!isCamera && !isProject && (!isScalar || node.type==="expr" || node.type==="fnDef") && canConsume(node.type) &&
          <InputsSection node={node} myDeps={myDeps} attachableDeps={attachableDeps}
            onDisconnect={onDisconnect} onConnectScalar={onConnectScalar}/>}

        {/* ── Scalar node params ── */}
        {node.type==="constant"&&<ConstantEditor {...ed}/>}
        {node.type==="expr"&&<ExprEditor {...ed}/>}
        {node.type==="slider"&&<SliderEditor {...ed}/>}
        {node.type==="animator"&&<AnimatorEditor {...ed}/>}

        {/* ── Function definition ── */}
        {node.type==="fnDef"&&<FnDefEditor {...ed}/>}

        {/* ── Function map / equation / unified scalar fn / parameterized space ── */}
        {node.type==="fnMap"&&<FnMapEditor {...ed}/>}
        {node.type==="equation"&&<EquationEditor {...ed}/>}
        {node.type==="scalarFn"&&<ScalarFnEditor {...ed}/>}
        {node.type==="paramSpace"&&<ParamSpaceEditor {...ed}/>}

        {/* ── Transformer ── */}
        {node.type==="transformer"&&<TransformerEditor {...ed}/>}

        {/* ── Unified: points / glyphs / sequences ── */}
        {node.type==="points"&&<PointsEditor {...ed}/>}
        {node.type==="rawGeom"&&<RawGeomEditor {...ed}/>}

        {/* ── Flow ── */}
        {node.type==="flow"&&<FlowEditor {...ed}/>}

        {/* ── Geometry nodes (legacy, still rendered for older projects) ── */}
        {node.type==="point"&&<PointEditor {...ed}/>}
        {node.type==="pointSeq"&&<PointSeqEditor {...ed}/>}
        {node.type==="glyphField"&&<GlyphFieldEditor {...ed}/>}
        {node.type==="quiver2d"&&<Quiver2dEditor {...ed}/>}
        {node.type==="quiver3d"&&<Quiver3dEditor {...ed}/>}
        {node.type==="fn1d"&&<Fn1dEditor {...ed}/>}
        {node.type==="curve3d"&&<Curve3dEditor {...ed}/>}
        {node.type==="surf3d"&&<Surf3dEditor {...ed}/>}
        {node.type==="paramsurf"&&<ParamSurfEditor {...ed}/>}

        {/* ── Camera ── */}
        {isCamera&&<CameraEditor node={node} nodes={nodes} scope={scope} onChange={onChange}
          isWindowed={isWindowed} onOpenWindow={onOpenWindow} onDetach={onDetach} onDockCamera={onDockCamera}
          onAddNode={onAddNode} onAttach={onAttach} onDisconnect={onDisconnect}
          attachableDeps={attachableDeps} metaTc={metaTc}/>}

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
