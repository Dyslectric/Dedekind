// ── Unified-node normalization ───────────────────────────────────────────────
// The three unified plot kinds (scalarFn, paramSpace, points) are authoring
// conveniences that fold several legacy kinds behind one node with a selector.
// To avoid duplicating all of the geometry builders, 2D renderers, geometry
// signatures and serialization logic, we normalize a unified node to an
// equivalent legacy node ({type, props}) at the point of use. Everything
// downstream (rebuild.js, render2d.js, scope.geomSignature) keeps operating on
// the legacy vocabulary it already understands.
//
// The mapping:
//   scalarFn   dims 1 → fn1d         (y = f(x))
//              dims 2 → surf3d       (z = f(x,y))
//              dims 3 → __scalarVol  (f(x,y,z) → value-coloured point cloud)
//   paramSpace degree 1 → curve3d    (parametric curve; z optional)
//              degree 2 → paramsurf  (parametric surface)
//   points     hasVectors=false → pointSeq  (points/sequences; `points` text)
//              hasVectors=true  → glyphField (glyphs; `pairs` text)
//              space "xy" zeroes the third component / projects to the plane.

import { splitTopLevel } from "../core/math.js";

function normDims(v, d){ const n=Math.round(Number(v)); return isFinite(n)?Math.max(1,Math.min(3,n)):d; }

// Map a unified node → { type, props } in the legacy vocabulary. Non-unified
// nodes are returned unchanged (so callers can blindly normalize everything).
function normalizeNode(node){
  if(!node) return node;
  const p=node.props||{};
  switch(node.type){
    case "paramSpace": {
      const degree=normDims(p.degree,1);
      if(degree>=3){
        return { type:"paramvol", props:{
          exprX:p.exprXw, exprY:p.exprYw, exprZ:p.exprZw,
          uMin:p.uMin, uMax:p.uMax, vMin:p.vMin, vMax:p.vMax, wMin:p.wMin, wMax:p.wMax,
          uRes:p.uRes3, vRes:p.vRes3, wRes:p.wRes3,
          colorMode:p.volColorMode, colorExpr:p.volColorExpr, colorLo:p.volColorLo, colorHi:p.volColorHi, colorMin:p.volColorMin, colorMax:p.volColorMax,
        }};
      }
      if(degree>=2){
        return { type:"paramsurf", props:{
          exprX:p.exprXu, exprY:p.exprYu, exprZ:p.exprZu,
          uMin:p.uMin, uMax:p.uMax, vMin:p.vMin, vMax:p.vMax, uRes:p.uRes, vRes:p.vRes,
          showWire:p.showWire, shading:p.shading,
          matColorMode:p.matColorMode, matNormalStrength:p.matNormalStrength,
          uvScaleU:p.uvScaleU, uvScaleV:p.uvScaleV, uvOffU:p.uvOffU, uvOffV:p.uvOffV, uvRot:p.uvRot,
        }};
      }
      return { type:"curve3d", props:{
        exprX:p.exprX, exprY:p.exprY, exprZ:p.exprZ||"0",
        tMin:p.tMin, tMax:p.tMax, res:p.res,
        colorMode:p.colorMode, colorR:p.colorR, colorG:p.colorG, colorB:p.colorB,
      }};
    }
    case "points": {
      // The points node is authored with explicit dropdowns (kind / mode /
      // color). Assemble the canonical text the legacy parsers consume so every
      // downstream consumer (2D/3D renderers, flow seeds, signatures) keeps
      // working unchanged. The recursible color channel is carried through as
      // structured props (__colMode/__colInit/…) and resolved by rebuild.js.
      const kind = p.kind || (p.hasVectors ? "glyphs" : "points");  // back-compat
      const mode = p.mode || "list";
      const useColor = !!p.useColor;
      // Legacy unified node: only `data` present, no explicit fields. Use it
      // verbatim (the auto-detecting parsers downstream still understand it).
      const legacy = p.data!=null && p.kind==null && p.mode==null
        && p.listPoints==null && p.idxPoint==null && p.recInit==null
        && p.listGlyphs==null && p.idxGlyph==null && p.recGlyphInit==null;
      const colorCarry = {
        __ptKind:kind, __ptMode:mode, __useColor:useColor,
        __colExpr:p.colExpr, __colRecInit:p.colRecInit, __colRecStep:p.colRecStep,
        // raw explicit props so rebuild can re-parse with per-element color:
        __explicit:{ kind, mode, useColor,
          ptsList:p.ptsList, edgeList:p.edgeList,
          listPoints:p.listPoints, idxPoint:p.idxPoint, idxCount:p.idxCount,
          recInit:p.recInit, recStep:p.recStep, recCount:p.recCount,
          listGlyphs:p.listGlyphs, idxGlyph:p.idxGlyph, idxGlyphCount:p.idxGlyphCount,
          recGlyphInit:p.recGlyphInit, recGlyphStep:p.recGlyphStep, recGlyphCount:p.recGlyphCount,
          colExpr:p.colExpr, colRecInit:p.colRecInit, colRecStep:p.colRecStep },
      };
      if(kind==="glyphs"){
        return { type:"glyphField", props:{
          pairs: legacy ? p.data : assembleGlyphText(p, mode),
          arrowLen:p.arrowLen, lenMode:p.lenMode, normalize:p.normalize, anim:p.anim, speed:p.speed, crestColor:p.crestColor,
          colorLo:p.colorLo, colorHi:p.colorHi, colorMin:p.colorMin, colorMax:p.colorMax,
          ...(legacy?{}:colorCarry),
        }};
      }
      return { type:"pointSeq", props:{
        points: legacy ? p.data : assemblePointText(p, mode), radius:p.radius, drawLines:p.drawLines,
        // names of wired lists (vertices / edge index-pairs) for fromlist mode —
        // carried so the signature folds the list contents and rebuilds on change.
        ptsList:p.ptsList, edgeList:p.edgeList,
        // legacy gradient still available; when useColor we drive it from the slot
        colorMode: useColor ? "gradient" : (p.colorMode||"off"),
        colorExpr:p.colorExpr, colorLo:p.colorLo, colorHi:p.colorHi, colorMin:p.colorMin, colorMax:p.colorMax,
        sequenced:p.sequenced, seqFrac:p.seqFrac, seqVar:p.seqVar,
        ...(legacy?{}:colorCarry),
      }};
    }
    default:
      return { type:node.type, props:p };
  }
}

// Return a shallow clone of the node whose .type/.props are the normalized
// (legacy) equivalents, preserving id/color/attachments/etc. Used where code
// needs a full node object (rebuild, signature).
function normalizedNode(node){
  const n=normalizeNode(node);
  if(n.type===node.type && n.props===node.props) return node;
  return { ...node, type:n.type, props:n.props, _origType:node.type };
}

// In xy "plane" mode for glyphs, force the z and vz components to 0 so the
// field lies in the XY plane regardless of what the user typed. We rewrite the
// text rather than the parsed pairs so all input modes (plain/recursive/index/
// matrix) still flow through the normal parser.
function projectGlyphTextToPlane(text){
  if(!text) return text;
  // Only a light touch: leave expressions intact but, for plain "x,y,z | vx,vy,vz"
  // rows, drop to "x,y | vx,vy". For sequence/index/matrix forms we leave the
  // text as-is (the user controls components explicitly there). Detect plain by
  // the absence of bracket/index markers.
  if(/\[/.test(text) || /\bi\b|\bj\b|\bk\b/.test(text)) return text;
  return text.split("\n").map(line=>{
    if(!line.trim()||line.trim().startsWith("//")) return line;
    const [pos,vec]=line.split("|");
    if(pos==null||vec==null) return line;
    const pc=splitTopLevel(pos);
    const vc=splitTopLevel(vec);
    const p2=[pc[0]??"0", pc[1]??"0"].join(", ");
    const v2=[vc[0]??"0", vc[1]??"0"].join(", ");
    return `${p2} | ${v2}`;
  }).join("\n");
}

// ── Explicit-props → canonical parser text ───────────────────────────────────
// The legacy parsers (parsePointSeq / parseGlyphField) accept position-only
// text and auto-detect mode from syntax. We build that text from the explicit
// dropdown props so positions/flow-seeds/2D all keep working; the recursible
// color slot is resolved separately by rebuild.js from the carried props.
//
// Color slots are STRIPPED here (the trailing comma-slot for list/the colExpr
// for index/recursive is not part of the position text), because the legacy
// parsers would otherwise treat the color expression as a coordinate.

// strip a trailing color slot from a "x, y[, z], color" row when useColor.
function stripRowColor(row, useColor){
  if(!useColor) return row;
  // split top-level commas, drop the last if there are >2 coordinate slots.
  const parts=[]; let depth=0, cur="";
  for(const ch of row){
    if(ch==="("||ch==="[") depth++;
    else if(ch===")"||ch==="]") depth--;
    if(ch===","&&depth===0){ parts.push(cur); cur=""; } else cur+=ch;
  }
  if(cur!=="") parts.push(cur);
  if(parts.length>=3) parts.pop();      // drop trailing color slot
  return parts.join(",");
}
function stripGlyphRowColor(row, useColor){
  if(!useColor) return row;
  const segs=row.split("|").map(s=>s.trim());
  // a glyph row is "seed | vector [| color]" → keep first two segments
  if(segs.length>=3) return segs.slice(0,2).join(" | ");
  return row;
}

function assemblePointText(p, mode){
  const useColor=!!p.useColor;
  // fromlist: positions live in a wired list, resolved from scope at build time
  // (the 3D path reads __explicit). No static text to assemble.
  if(mode==="fromlist") return "";
  if(mode==="index"){
    const tuple=p.idxPoint||"";
    const count=p.idxCount||"64";
    // force index detection: ensure an i reference exists (idxPoint authored in i)
    return `${tuple}\n${count}`;
  }
  if(mode==="recursive"){
    const init=p.recInit||"0,0";
    const step=p.recStep||"x[n-1], y[n-1]";
    const count=p.recCount||"64";
    return `${init}\n${step}\n${count}`;
  }
  // list
  const rows=(p.listPoints||"").split(/[\n;]/).map(s=>s.trim()).filter(Boolean);
  return rows.map(r=>stripRowColor(r,useColor)).join("\n");
}

function assembleGlyphText(p, mode){
  const useColor=!!p.useColor;
  if(mode==="index"){
    return `${p.idxGlyph||""}\n${p.idxGlyphCount||"48"}`;
  }
  if(mode==="recursive"){
    return `${p.recGlyphInit||""}\n${p.recGlyphStep||""}\n${p.recGlyphCount||"48"}`;
  }
  const rows=(p.listGlyphs||"").split(/[\n;]/).map(s=>s.trim()).filter(Boolean);
  return rows.map(r=>stripGlyphRowColor(r,useColor)).join("\n");
}

// Is this one of the unified authoring kinds?
function isUnifiedKind(type){ return type==="paramSpace"||type==="points"; }

export { normalizeNode, normalizedNode, isUnifiedKind, projectGlyphTextToPlane };
