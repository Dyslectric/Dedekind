import { useState, useEffect, useRef } from "react";
import { useUI } from "../theme/tokens.jsx";
import { resolveNum, safeEval, makeFn } from "../core/math.js";

// ── Scalar overlay for camera viewports ─────────────────────────────────────
// Renders a small HUD showing scalars connected to this camera
// ── Inline fnDef editor for ScalarOverlay ───────────────────────────────────
function FnDefRow({ node, scope, onUpdateNode }) {
  const { ui, S } = useUI();
  const [editExpr, setEditExpr] = useState(node.props?.expr || "");
  const [editParams, setEditParams] = useState(node.props?.params || "x");
  const [exprFocused, setExprFocused] = useState(false);
  const [paramsFocused, setParamsFocused] = useState(false);

  // Keep local state in sync when node changes externally (but not while focused)
  useEffect(() => { if (!exprFocused) setEditExpr(node.props?.expr || ""); }, [node.props?.expr, exprFocused]);
  useEffect(() => { if (!paramsFocused) setEditParams(node.props?.params || "x"); }, [node.props?.params, paramsFocused]);

  const commitExpr = (val) => {
    onUpdateNode && onUpdateNode(node.id, { props: { ...node.props, expr: val } });
  };
  const commitParams = (val) => {
    onUpdateNode && onUpdateNode(node.id, { props: { ...node.props, params: val } });
  };

  // Live evaluation preview
  const fn = scope?.[node.name];
  let preview = "";
  if (fn && typeof fn === "function") {
    const params = editParams.split(",").map(s => s.trim()).filter(Boolean);
    const testArgs = params.map(() => 1);
    try { const r = fn(...testArgs); preview = isFinite(r) ? Number(r.toPrecision(4)).toString() : String(r); } catch { preview = "err"; }
  }

  return (
    <div style={{marginBottom:3}}>
      <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:1}}>
        <span style={{color:ui.uiFaint,fontSize:12}}>fn</span>
        <span style={{color:ui.uiText,flex:"0 0 auto"}}>{node.name}(</span>
        <input
          value={editParams}
          onChange={e => setEditParams(e.target.value)}
          onFocus={() => setParamsFocused(true)}
          onBlur={() => { setParamsFocused(false); commitParams(editParams); }}
          onKeyDown={e => { if (e.key === "Enter") { commitParams(editParams); e.target.blur(); } e.stopPropagation(); }}
          style={{
            ...S.inp, padding:"1px 4px", fontSize:12,
            width: Math.max(30, editParams.length * 7 + 10),
          }}
        />
        <span style={{color:ui.uiText,flex:"0 0 auto"}}>)</span>
        {preview && <span style={{color:ui.uiFaint,fontSize:11,marginLeft:"auto"}}>→{preview}</span>}
      </div>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        <span style={{color:ui.uiMuted,fontSize:11,flexShrink:0}}>=</span>
        <input
          value={editExpr}
          onChange={e => setEditExpr(e.target.value)}
          onFocus={() => setExprFocused(true)}
          onBlur={() => { setExprFocused(false); commitExpr(editExpr); }}
          onKeyDown={e => { if (e.key === "Enter") { commitExpr(editExpr); e.target.blur(); } e.stopPropagation(); }}
          style={{
            ...S.inp, padding:"1px 5px", fontSize:12, width:"100%",
          }}
        />
      </div>
    </div>
  );
}

export {
  FnDefRow
};
