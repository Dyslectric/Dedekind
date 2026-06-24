// ── Math measure & position (pure, no DOM) ───────────────────────────────────
//
// Takes the layout tree from mathlayout.js and produces a flat list of
// POSITIONED BOXES (absolute x/y/w/h + font scale + what to draw) plus a list
// of CARET ANCHORS (one per reachable source offset, with a screen x/y/height).
//
// COORDINATE SYSTEM
//   • Units are "em" relative to the field's base font size; the DOM layer
//     multiplies by the pixel font size. Keeping it unitless makes the metrics
//     testable and resolution-independent.
//   • +x is right, +y is DOWN (screen convention). Each measured node reports a
//     box with width `w`, ascent `a` (above baseline) and descent `d` (below).
//     Height = a + d. We position by baseline, then flatten to absolute y.
//
// TWO PASSES
//   1. measure(node, scale) → { w, a, d, ...intrinsic } recursively. No absolute
//      positions yet, just sizes and the relative arrangement of sub-parts.
//   2. place(node, x, baselineY) → walks again, emitting absolute boxes and
//      caret anchors. Splitting measure/place keeps each simple and lets a
//      parent know a child's size before deciding where to put it.
//
// CARET ANCHORS are the bridge back to the text model: each is { offset, x, y,
// h } meaning "if the caret index === offset, draw the caret at (x,y) with
// height h". The DOM layer never thinks about structure — it just looks up the
// anchor for the current offset. Hit-testing a click picks the nearest anchor.

import { parseLayout } from "./mathlayout.js";

// ── Metric constants (em units), TeX-inspired but tuned for a UI input ────────
const M = {
  charW: 0.55,        // nominal advance width for a monospace-ish glyph
  digitW: 0.55,
  opW: 0.62,          // binary operators get a touch more room (we add side gaps)
  opGap: 0.16,        // gap on each side of a binary operator (+ - * / etc.)
  ascent: 0.72,       // ascent of normal text above baseline
  descent: 0.22,      // descent below baseline
  supScale: 0.72,     // exponent shrink factor
  supShift: 0.42,     // how far up the exponent baseline rises (in base em)
  subScale: 0.7,      // subscript shrink factor (x_0 → x with small low 0)
  subShift: 0.16,     // how far DOWN the subscript baseline drops (in base em)
  fracGap: 0.18,      // vertical gap between fraction bar and num/den
  fracBar: 0.06,      // fraction rule thickness
  fracPad: 0.12,      // horizontal padding inside a fraction
  fracAxis: 0.30,     // height of the fraction bar above baseline (math axis)
  derivOpScale: 0.8,  // the d/d{var} operator fraction is smaller than the body
  derivBracketScale: 1.15, // medium brackets around the differentiated body
  derivBracketInset: 0.08, // padding between bracket and body (stops body spill)
  derivParenScale: 1.0,    // parens around the evaluation point
  derivGap: 0.12,     // gap between operator, brackets, and point
  bigGlyphScale: 1.05, // ∑ ∏ vertical metric-box (reserves room; hugs the glyph)
  intGlyphScale: 1.25, // ∫ metric box (taller)
  sumFontEm: 0.85,     // ∑/∏ rendered from Size1 (already a display glyph), so a
                       // sub-1 font-size keeps them inline-sized, not oversized
  intFontEm: 1.05,     // ∫ a touch larger (it's a slim tall glyph)
  bigBoundScale: 0.7, // sub/super bound size on a big operator
  bigBoundGap: 0.08,
  bigBodyGap: 0.14,
  sqrtLead: 0.62,     // width of the √ tick before the radicand
  sqrtTop: 0.26,      // clearance between the overline and the radicand top
  sqrtTrail: 0.34,    // overhang past radicand (also holds the right guide-paren)
  sqrtBottom: 0.06,   // a little room below so the tick's base isn't clipped
  sqrtParenRoom: 0.34,// extra lead/trail (× radicand height) for guide-parens
  parenW: 0.4,
  gapW: 0.32,         // a whitespace atom renders as this much gap
  slotW: 0.62,        // width of an empty placeholder slot (fillable field box)
};

// Width of an atom's text at a given scale. `wf` is an optional measured-width
// function (chars→em at scale 1) supplied by the DOM layer for proportional
// fonts; when absent (pure tests) we fall back to the nominal monospace metrics.
// wf(str, kind) returns the em-width of `str` rendered in the font for `kind`
// ("var"|"num"|"op"|"main") at scale 1.
function atomWidth(node, wf){
  if(node.t==="ws") return M.gapW * node.v.length;
  if(node.t==="op"){
    // operators that are truly binary get side gaps; parens/commas don't. The
    // rendered glyph differs from the source for "*" (→ "·") and "-" (→ "−"),
    // so measure the GLYPH that's actually drawn to keep caret/layout aligned.
    const glyph = node.v==="*" ? "·" : (node.v==="-" ? "\u2212" : node.v);
    const base = wf ? wf(glyph, "main") : (node.v==="," ? M.charW*0.6 : (node.v==="("||node.v===")") ? M.parenW : M.charW);
    // Binary infix operators get a gap on each side so they breathe — including
    // "/" (division) which was previously tight. "(" / ")" / "," are not infix
    // and keep their natural advance.
    if("+-*/=<>".includes(node.v)) return base + M.opGap*2;
    if(node.v===",") return base + M.opGap;
    return base;
  }
  // ident / num / other: measured width, or nominal per-char
  if(wf) return wf(node.v, node.t==="num"?"num":"var");
  return node.v.length * M.charW;
}

// ── Pass 1: measure ──────────────────────────────────────────────────────────
// Returns an augmented copy-ish structure with w/a/d and any layout sub-metrics
// attached. We attach to a fresh object (`mz`) so the source tree stays pure.
// Caret position for the current layout pass (set by layoutMath). Used only by
// the sqrt measure to reserve room for guide-parens when the caret is inside the
// radicand, so the radical grows to fit them. Module-level is safe because layout
// is synchronous and single-threaded.
let _caret = -1;

function measure(node, scale, wf){
  switch(node.kind){
    case "atom": {
      // An identifier containing "_" displays as base + subscript (x_0 → x with
      // a small lowered 0). The whole "x_0" is still ONE identifier for
      // classification/scope; only the DISPLAY splits, on the first underscore.
      if(node.t==="ident"){
        const us = node.v.indexOf("_");
        if(us>0 && us<node.v.length-1){
          const baseStr = node.v.slice(0,us);
          const subStr  = node.v.slice(us+1);
          const baseW = (wf ? wf(baseStr,"var") : baseStr.length*M.charW) * scale;
          const subW  = (wf ? wf(subStr,"var")  : subStr.length*M.charW) * scale * M.subScale;
          const subShift = M.subShift*scale;
          return { node, scale, w: baseW + subW, a:M.ascent*scale, d:M.descent*scale + subShift,
                   sub:{ baseStr, subStr, baseW, subW, subShift, us } };
        }
      }
      const w = atomWidth(node, wf) * scale;
      return { node, scale, w, a:M.ascent*scale, d:M.descent*scale };
    }
    case "row": {
      let w=0, a=0, d=0;
      const kids = node.children.map(c=>measure(c,scale,wf));
      for(const k of kids){ w+=k.w; a=Math.max(a,k.a); d=Math.max(d,k.d); }
      if(kids.length===0){
        // an empty row is a fillable placeholder slot — give it a visible box so
        // it can be seen, clicked, and typed into (used by bigop arg fields,
        // empty fraction parts, empty exponents, etc.)
        a=M.ascent*scale; d=M.descent*scale; w=M.slotW*scale;
        return { node, scale, w, a, d, kids, placeholder:true };
      }
      return { node, scale, w, a, d, kids };
    }
    case "group": {
      // render literal parens around inner row
      const inner = measure(node.inner, scale, wf);
      const pw = (wf ? wf("(","main") : M.parenW)*scale;
      return { node, scale, inner, w: inner.w + pw*2, a:Math.max(inner.a,M.ascent*scale), d:Math.max(inner.d,M.descent*scale), pw };
    }
    case "sup": {
      const base = measure(node.base, scale, wf);
      const exp  = measure(node.exp, scale*M.supScale, wf);
      const shift = M.supShift*scale;
      // ascent must cover the raised exponent
      const a = Math.max(base.a, shift + exp.a);
      const d = base.d;
      return { node, scale, base, exp, shift, w: base.w + exp.w, a, d };
    }
    case "pderiv": {
      // ∂/∂{dvar} [freelist] [expr] (values)
      const dchar = "∂";
      const dscale = scale * M.derivOpScale;
      const dvar = measure(node.dvar, dscale, wf);
      const dW = (wf ? wf(dchar,"var") : M.charW) * dscale;
      const numW = dW;
      const denW = dW + dvar.w;
      const pad = M.fracPad*dscale;
      const opW = Math.max(numW, denW) + pad*2;
      const bar = M.fracBar*dscale;
      const gap = M.fracGap*dscale;
      const axis = M.fracAxis*scale;
      const opA = axis + bar/2 + gap + (M.ascent*dscale + M.descent*dscale);
      const opD = (M.ascent*dscale + M.descent*dscale) + gap + bar/2 - axis;
      const brW = (wf ? wf("[","main") : M.parenW) * scale * M.derivBracketScale;
      const brInset = M.derivBracketInset*scale;
      const pw = (wf ? wf("(","main") : M.parenW) * scale * M.derivParenScale;
      const g = M.derivGap*scale;
      const freelist = measure(node.freelist, scale, wf);  // [free vars]
      const expr = measure(node.expr, scale, wf);          // [expression]
      const values = measure(node.values, scale, wf);      // (point tuple)
      const w = opW + g
        + brW + brInset + freelist.w + brInset + brW + g
        + brW + brInset + expr.w + brInset + brW + g
        + pw + values.w + pw;
      const a = Math.max(opA, freelist.a, expr.a, values.a);
      const d = Math.max(opD, freelist.d, expr.d, values.d);
      return { node, scale, dscale, dvar, dW, numW, denW, opW, bar, gap, axis, pad,
               brW, brInset, pw, g, freelist, expr, values, w, a, d };
    }
    case "deriv": {
      // d/d{var} [ body ] ( point )
      const dchar = "d";
      const dscale = scale * M.derivOpScale;
      const dvar = measure(node.dvar, dscale, wf);
      const dW = (wf ? wf(dchar,"var") : M.charW) * dscale;
      const numW = dW;                       // numerator: "d"
      const denW = dW + dvar.w;              // denominator: "d" + var slot
      const pad = M.fracPad*dscale;
      const opW = Math.max(numW, denW) + pad*2;
      const bar = M.fracBar*dscale;
      const gap = M.fracGap*dscale;
      const axis = M.fracAxis*scale;
      const opA = axis + bar/2 + gap + (M.ascent*dscale + M.descent*dscale);
      const opD = (M.ascent*dscale + M.descent*dscale) + gap + bar/2 - axis;
      // [ body ] — brInset keeps the body from kissing the closing bracket.
      const body = measure(node.body, scale, wf);
      const brW = (wf ? wf("[","main") : M.parenW) * scale * M.derivBracketScale;
      const brInset = M.derivBracketInset*scale;
      // ( point )
      const point = measure(node.point, scale, wf);
      const pw = (wf ? wf("(","main") : M.parenW) * scale * M.derivParenScale;
      const g = M.derivGap*scale;
      const w = opW + g + brW + brInset + body.w + brInset + brW + g + pw + point.w + pw;
      const a = Math.max(opA, body.a, point.a);
      const d = Math.max(opD, body.d, point.d);
      return { node, scale, dscale, dvar, dW, numW, denW, opW, bar, gap, axis, pad,
               body, brW, brInset, point, pw, g, w, a, d };
    }
    case "frac": {
      const num = measure(node.num, scale, wf);
      const den = measure(node.den, scale, wf);
      const pad = M.fracPad*scale;
      const w = Math.max(num.w, den.w) + pad*2;
      const bar = M.fracBar*scale;
      const gap = M.fracGap*scale;
      const axis = M.fracAxis*scale;        // bar sits this far above baseline
      // ascent = bar height above baseline + gap + numerator height
      const a = axis + bar/2 + gap + (num.a + num.d);
      const d = (den.a + den.d) + gap + bar/2 - axis;
      return { node, scale, num, den, w, bar, gap, axis, pad, a, d };
    }
    case "sqrt": {
      const rad = measure(node.radicand, scale, wf);
      const top  = M.sqrtTop*scale;
      const bottom = M.sqrtBottom*scale;
      // When the caret is inside this radicand, the guide-parens are shown — so
      // grow the lead (room for the left paren after the tick) and the trail
      // (room for the right paren) and the overline spans the wider radical.
      const radStart = node.open ? node.open.e : node.s;
      const radEnd = node.close ? node.close.s : node.e;
      const showParens = _caret>=radStart && _caret<=radEnd;
      const parenRoom = (rad.a + rad.d) * M.sqrtParenRoom;   // ~paren advance
      const lead  = M.sqrtLead*scale + (showParens ? parenRoom : 0);
      const trail = M.sqrtTrail*scale + (showParens ? parenRoom : 0);
      return { node, scale, rad, lead, top, trail, bottom, showParens,
        w: lead + rad.w + trail, a: rad.a + top, d: rad.d + bottom };
    }
    case "call": {
      // name '(' args... ')'  — laid out inline, args separated by commas. The
      // name width is subscript-aware (f_0 narrower than the raw char count).
      const nameW = nameVisualWidth(node.name, scale, wf);
      const pw = (wf ? wf("(","main") : M.parenW)*scale;
      const argMs = node.args.map(a=>measure(a,scale,wf));
      const commaW = ((wf ? wf(",","main") : M.charW*0.6) + M.opGap)*scale;
      let inner=0, a=M.ascent*scale, d=M.descent*scale;
      argMs.forEach((am,i)=>{ inner+=am.w; if(i>0) inner+=commaW; a=Math.max(a,am.a); d=Math.max(d,am.d); });
      return { node, scale, nameW, pw, argMs, commaW, w: nameW + pw*2 + inner, a, d };
    }
    case "bigop": {
      const isInt = node.op==="int";
      const gscale = scale*(isInt ? M.intGlyphScale : M.bigGlyphScale);
      const glyphFontEm = (isInt ? M.intFontEm : M.sumFontEm) * scale;
      const glyphW = M.opW*gscale*1.1;
      const glyphA = M.ascent*gscale, glyphD = M.descent*gscale;
      const lo = node.lo ? measure(node.lo, scale*M.bigBoundScale, wf) : null;
      const hi = node.hi ? measure(node.hi, scale*M.bigBoundScale, wf) : null;
      const idx = node.idx ? measure(node.idx, scale*M.bigBoundScale, wf) : null;
      // for sum/prod the lower bound is "idx = lo"; we render idx and lo stacked
      // under the glyph (idx=lo as one row visually). For integrate, lo/hi only.
      // lower group: sum/prod => idx "=" lo ; int => lo
      const lowerW = isInt ? (lo?lo.w:0)
        : ((idx?idx.w:0) + (idx&&lo? M.charW*scale*M.bigBoundScale : 0) + (lo?lo.w:0));
      const upperW = hi?hi.w:0;
      const colW = Math.max(glyphW, lowerW, upperW);
      const body = measure(node.body, scale, wf);
      const bodyGap = M.bigBodyGap*scale;
      const gap = M.bigBoundGap*scale;
      const aGlyph = glyphA + (hi? gap + hi.a + hi.d : 0);
      const dGlyph = glyphD + ((lo||idx)? gap + Math.max(lo?lo.a+lo.d:0, idx?idx.a+idx.d:0) : 0);
      // integrate appends " d{var}" after the body
      let dvarW=0, dvarM=null;
      if(isInt && idx){ dvarM = idx; dvarW = M.charW*scale /*the 'd'*/ + idx.w + M.opGap*scale; }
      const a = Math.max(aGlyph, body.a, dvarM?dvarM.a:0);
      const d = Math.max(dGlyph, body.d, dvarM?dvarM.d:0);
      return { node, scale, gscale, glyphFontEm, glyphW, glyphA, glyphD, lo, hi, idx, isInt,
               lowerW, upperW, colW, body, bodyGap, gap, dvarW, dvarM, w: colW + bodyGap + body.w + dvarW, a, d };
    }
    default:
      return { node, scale, w:0, a:M.ascent*scale, d:M.descent*scale };
  }
}

// ── Subscript-aware identifier rendering (shared by atom and call) ────────────
// An identifier with an underscore (x_0, v_max, f_0) displays as base + small
// lowered subscript. These helpers compute its visual width and emit its boxes +
// caret anchors, used both for a bare identifier atom and for a function-call
// NAME so that f_0(x) keeps its subscript instead of flattening after the paren.
// `srcStart` is the source offset of the first character of `name`.
function nameVisualWidth(name, scale, wf){
  const us = name.indexOf("_");
  if(us>0 && us<name.length-1){
    const baseW = (wf ? wf(name.slice(0,us),"var") : us*M.charW) * scale;
    const subW  = (wf ? wf(name.slice(us+1),"var") : (name.length-us-1)*M.charW) * scale * M.subScale;
    return baseW + subW;
  }
  return (wf ? wf(name,"var") : name.length*M.charW) * scale;
}
function emitName(out, name, x, baselineY, scale, srcStart, tk, classifyV, wf){
  const us = name.indexOf("_");
  if(us>0 && us<name.length-1){
    const baseStr=name.slice(0,us), subStr=name.slice(us+1);
    const baseW = (wf ? wf(baseStr,"var") : us*M.charW) * scale;
    const subW  = (wf ? wf(subStr,"var") : subStr.length*M.charW) * scale * M.subScale;
    const subShift = M.subShift*scale;
    out.boxes.push({ type:"text", text:baseStr, x, y:baselineY, scale, tk, v:classifyV, s:srcStart, e:srcStart+us });
    out.boxes.push({ type:"text", text:subStr, x:x+baseW, y:baselineY+subShift, scale:scale*M.subScale, tk, v:classifyV, s:srcStart+us+1, e:srcStart+name.length });
    const baseCw = baseW/baseStr.length;
    for(let c=0;c<=baseStr.length;c++) out.anchors.push({ offset:srcStart+c, x:x+baseCw*c, y:baselineY-M.ascent*scale, h:(M.ascent+M.descent)*scale, baselineY });
    const subCw = subW/subStr.length;
    for(let c=0;c<=subStr.length;c++) out.anchors.push({ offset:srcStart+us+1+c, x:x+baseW+subCw*c, y:baselineY+subShift-M.ascent*scale*M.subScale, h:(M.ascent+M.descent)*scale, baselineY:baselineY+subShift });
    return baseW+subW;
  }
  out.boxes.push({ type:"text", text:name, x, y:baselineY, scale, tk, v:classifyV, s:srcStart, e:srcStart+name.length });
  const w = (wf ? wf(name,"var") : name.length*M.charW) * scale;
  const cw = w/name.length;
  for(let c=0;c<=name.length;c++) out.anchors.push({ offset:srcStart+c, x:x+cw*c, y:baselineY-M.ascent*scale, h:(M.ascent+M.descent)*scale, baselineY });
  return w;
}

// ── Pass 2: place ─────────────────────────────────────────────────────────────
// Emits boxes (things to draw) and caret anchors (offset → screen pos).
// `out` = { boxes:[], anchors:[] }. baselineY is the y of this node's baseline.
function place(mz, x, baselineY, out){
  const n = mz.node;
  switch(n.kind){
    case "atom": {
      // subscripted identifier (x_0): base at baseline, subscript smaller+lower
      if(mz.sub){
        const { baseStr, subStr, baseW, subShift, us } = mz.sub;
        out.boxes.push({ type:"text", text:baseStr, x, y:baselineY, scale:mz.scale, tk:"ident", v:n.v, s:n.s, e:n.s+us });
        const subBaseline = baselineY + subShift;
        out.boxes.push({ type:"text", text:subStr, x:x+baseW, y:subBaseline, scale:mz.scale*M.subScale, tk:"ident", v:n.v, s:n.s+us+1, e:n.e });
        // anchors: left edge, each base char, the underscore (between base&sub),
        // each subscript char, and the right edge.
        const baseCw = baseW / baseStr.length;
        for(let c=0;c<=baseStr.length;c++) pushAnchor(out, n.s+c, x+baseCw*c, baselineY, mz);
        const subCw = mz.sub.subW / subStr.length;
        for(let c=0;c<=subStr.length;c++) pushAnchor(out, n.s+us+1+c, x+baseW+subCw*c, subBaseline, mz);
        return;
      }
      // a whitespace atom draws nothing but still advances + anchors
      if(n.t!=="ws"){
        // Display substitutions: multiplication "*" → centered dot "·", and the
        // ASCII hyphen "-" → the typographic minus "−" (U+2212), which is wider
        // and vertically centered on the math axis so it reads as an operator
        // rather than a thin hyphen. The canonical text and source range stay the
        // original ASCII (so mathjs still parses, and caret/editing are
        // unaffected) — only the rendered glyph changes.
        let disp = n.v;
        let drawX = x;
        if(n.t==="op"){
          if(n.v==="*") disp = "·";
          else if(n.v==="-") disp = "\u2212";
          // Binary infix operators reserve a gap on BOTH sides (see atomWidth).
          // The glyph is drawn at the atom's left edge by default, which would
          // put the whole gap on the right and let the operator hug whatever
          // precedes it (e.g. a closing paren). Shift the glyph right by one gap
          // so the space is split evenly — left and right both breathe.
          if("+-*/=<>".includes(n.v)) drawX = x + M.opGap*mz.scale;
          else if(n.v===",") { /* comma keeps its single trailing gap */ }
        }
        out.boxes.push({ type:"text", text:disp, x:drawX, y:baselineY, scale:mz.scale, tk:n.t, v:n.v, s:n.s, e:n.e });
      }
      // anchor at the LEFT edge for offset n.s, and (handled by row) right edge
      pushAnchor(out, n.s, x, baselineY, mz);
      // per-character anchors for multi-char atoms so caret can sit mid-token
      if(n.v.length>1 && n.t!=="ws"){
        const cw = mz.w / n.v.length;
        for(let c=1;c<n.v.length;c++) pushAnchor(out, n.s+c, x+cw*c, baselineY, mz);
      }
      return;
    }
    case "row": {
      let cx = x;
      if(mz.kids.length===0){
        if(mz.placeholder){
          out.boxes.push({ type:"slot", x, y:baselineY-mz.a, w:mz.w, h:mz.a+mz.d, scale:mz.scale, s:n.s, e:n.e });
        }
        pushAnchor(out, n.s, x + (mz.placeholder?mz.w/2:0), baselineY, mz);
        return;
      }
      for(const k of mz.kids){ place(k, cx, baselineY, out); cx += k.w; }
      // right-edge anchor of the last child (offset = row end)
      pushAnchor(out, n.e, cx, baselineY, mz);
      return;
    }
    case "group": {
      out.boxes.push({ type:"paren", which:"(", x, y:baselineY, scale:mz.scale, h:mz.a+mz.d, s:n.open.s, e:n.open.e });
      pushAnchor(out, n.open.s, x, baselineY, mz);
      const innerX = x + mz.pw;
      place(mz.inner, innerX, baselineY, out);
      const closeX = innerX + mz.inner.w;
      if(n.close){
        out.boxes.push({ type:"paren", which:")", x:closeX, y:baselineY, scale:mz.scale, h:mz.a+mz.d, s:n.close.s, e:n.close.e });
        pushAnchor(out, n.close.s, closeX, baselineY, mz);
        pushAnchor(out, n.close.e, closeX+mz.pw, baselineY, mz);
      }
      return;
    }
    case "sup": {
      place(mz.base, x, baselineY, out);
      const expX = x + mz.base.w;
      const expBaseline = baselineY - mz.shift;
      // caret offset for the '^' sits between base and exp
      if(n.caret) pushAnchor(out, n.caret.s, expX, baselineY, mz);
      place(mz.exp, expX, expBaseline, out);
      return;
    }
    case "frac": {
      const barY = baselineY - mz.axis;          // y of the bar centerline
      const w = mz.w;
      out.boxes.push({ type:"rule", x, y:barY - mz.bar/2, w, h:mz.bar, s:n.slash?n.slash.s:n.s, e:n.slash?n.slash.e:n.e });
      // numerator centered above the bar
      const numX = x + (w - mz.num.w)/2;
      const numBaseline = barY - mz.gap - mz.bar/2 - mz.num.d;
      place(mz.num, numX, numBaseline, out);
      // denominator centered below
      const denX = x + (w - mz.den.w)/2;
      const denBaseline = barY + mz.gap + mz.bar/2 + mz.den.a;
      place(mz.den, denX, denBaseline, out);
      // caret anchor for the slash offset sits at the bar's left
      if(n.slash) pushAnchor(out, n.slash.s, x, barY, mz);
      return;
    }
    case "pderiv": {
      // ∂/∂{dvar} [freelist] [expr] (values).
      const barY = baselineY - mz.axis;
      const opW = mz.opW;
      out.boxes.push({ type:"rule", x, y:barY - mz.bar/2, w:opW, h:mz.bar, s:n.nameRange.s, e:n.nameRange.e });
      const numBaseline = barY - mz.gap - mz.bar/2 - M.descent*mz.dscale;
      out.boxes.push({ type:"text", text:"∂", x:x+(opW-mz.numW)/2, y:numBaseline, scale:mz.dscale, tk:"ident", v:"∂" });
      const denBaseline = barY + mz.gap + mz.bar/2 + M.ascent*mz.dscale;
      const denX = x + (opW - mz.denW)/2;
      out.boxes.push({ type:"text", text:"∂", x:denX, y:denBaseline, scale:mz.dscale, tk:"ident", v:"∂" });
      pushAnchor(out, n.s, x, baselineY, mz);
      place(mz.dvar, denX + mz.dW, denBaseline, out);
      const brScale = mz.scale*M.derivBracketScale;
      const parScale = mz.scale*M.derivParenScale;
      let cx = x + opW + mz.g;
      // helper to render a [ slot ] with inset
      const bracket = (slotMz)=>{
        out.boxes.push({ type:"paren", which:"[", x:cx, y:baselineY, scale:brScale, h:mz.a+mz.d });
        cx += mz.brW + mz.brInset;
        place(slotMz, cx, baselineY, out);
        cx += slotMz.w + mz.brInset;
        out.boxes.push({ type:"paren", which:"]", x:cx, y:baselineY, scale:brScale, h:mz.a+mz.d });
        cx += mz.brW;
      };
      // [ free-var list ]
      bracket(mz.freelist);
      cx += mz.g;
      // [ expression ]
      bracket(mz.expr);
      cx += mz.g;
      // ( value tuple )
      out.boxes.push({ type:"paren", which:"(", x:cx, y:baselineY, scale:parScale, h:mz.a+mz.d });
      cx += mz.pw;
      place(mz.values, cx, baselineY, out);
      cx += mz.values.w;
      // The value/free-var slots come from array tokens "[...]"; the hidden "]"
      // sits between the editable inner content and the operator's close. Without
      // help, the offset just after "]" is a caret stop at the same screen x as the
      // inner-end, so typing there inserts OUTSIDE the array (e.g. "[8,4]8"). Record
      // each array's interior-end so the snap map routes the post-"]" position back
      // inside, keeping edits within the brackets.
      if(n.values && n.values.arrEnd!=null) out.arrayEnds.push(n.values.arrEnd);
      if(n.freelist && n.freelist.arrEnd!=null) out.arrayEnds.push(n.freelist.arrEnd);
      out.boxes.push({ type:"paren", which:")", x:cx, y:baselineY, scale:parScale, h:mz.a+mz.d, s:n.close?n.close.s:n.e, e:n.close?n.close.e:n.e });
      if(n.close){ pushAnchor(out, n.close.s, cx, baselineY, mz); pushAnchor(out, n.close.e, cx+mz.pw, baselineY, mz); }
      cx += mz.pw;
      pushAnchor(out, n.e, cx, baselineY, mz);
      // visual order ∂/∂{var}[freelist][expr](values): var under ∂/∂, then the two
      // brackets, then the value parens — left to right.
      const pF = [];
      for(const node of [n.dvar, n.freelist, n.expr, n.values]) if(node && node.s!=null) pF.push({ s:node.s, e:node.e });
      out.spans.push({ s:n.s, e:n.e, kind:"pderiv", fields:pF });
      return;
    }
    case "deriv": {
      // d/d{var} [ body ] ( point ).
      const dchar = "d";
      const barY = baselineY - mz.axis;
      const opW = mz.opW;
      // operator fraction: bar + "d"/"∂" over "d{var}"
      out.boxes.push({ type:"rule", x, y:barY - mz.bar/2, w:opW, h:mz.bar, s:n.nameRange.s, e:n.nameRange.e });
      const numBaseline = barY - mz.gap - mz.bar/2 - M.descent*mz.dscale;
      out.boxes.push({ type:"text", text:dchar, x:x+(opW-mz.numW)/2, y:numBaseline, scale:mz.dscale, tk:"ident", v:dchar });
      const denBaseline = barY + mz.gap + mz.bar/2 + M.ascent*mz.dscale;
      const denX = x + (opW - mz.denW)/2;
      out.boxes.push({ type:"text", text:dchar, x:denX, y:denBaseline, scale:mz.dscale, tk:"ident", v:dchar });
      pushAnchor(out, n.s, x, baselineY, mz);
      place(mz.dvar, denX + mz.dW, denBaseline, out);
      // NOTE: do NOT anchor commas[0].s here — its offset coincides with the body
      // slot's start, and anchoring it at the denominator would steal the body
      // slot's caret position (putting the cursor under the fraction). The body
      // and var slots emit their own correct anchors when placed.
      const brScale = mz.scale*M.derivBracketScale;
      const parScale = mz.scale*M.derivParenScale;
      // [ body ]  — inset so the body never touches the brackets
      let cx = x + opW + mz.g;
      out.boxes.push({ type:"paren", which:"[", x:cx, y:baselineY, scale:brScale, h:mz.a+mz.d, s:n.open?n.open.s:n.s, e:n.open?n.open.e:n.s });
      if(n.open) pushAnchor(out, n.open.s, cx, baselineY, mz);
      cx += mz.brW;
      if(n.open) pushAnchor(out, n.open.e, cx, baselineY, mz);
      cx += mz.brInset;
      place(mz.body, cx, baselineY, out);
      cx += mz.body.w + mz.brInset;
      out.boxes.push({ type:"paren", which:"]", x:cx, y:baselineY, scale:brScale, h:mz.a+mz.d });
      cx += mz.brW;
      // ( point )
      cx += mz.g;
      out.boxes.push({ type:"paren", which:"(", x:cx, y:baselineY, scale:parScale, h:mz.a+mz.d });
      cx += mz.pw;
      // (point slot emits its own anchor; commas[1].s coincides with the var slot
      // offset, so anchoring it here would steal the var's caret position.)
      place(mz.point, cx, baselineY, out);
      cx += mz.point.w;
      out.boxes.push({ type:"paren", which:")", x:cx, y:baselineY, scale:parScale, h:mz.a+mz.d, s:n.close?n.close.s:n.e, e:n.close?n.close.e:n.e });
      if(n.close){ pushAnchor(out, n.close.s, cx, baselineY, mz); pushAnchor(out, n.close.e, cx+mz.pw, baselineY, mz); }
      cx += mz.pw;
      pushAnchor(out, n.e, cx, baselineY, mz);
      // visual order for d/d{var}[body](point): the var sits under the d/d (left),
      // then the bracketed body, then the point parens — left to right.
      const dF = [];
      for(const node of [n.dvar, n.body, n.point]) if(node && node.s!=null) dF.push({ s:node.s, e:node.e });
      out.spans.push({ s:n.s, e:n.e, kind:"deriv", fields:dF });
      return;
    }
    case "sqrt": {
      // The radicand content span (between the parens) lets the renderer show
      // faint guide-parens around it while the caret is inside. radL/radR are the
      // x of the radicand's left and right edges. tickLead is the lead used by the
      // radical tick itself (excludes any extra room reserved for the left paren).
      const radL = x + mz.lead;
      const radR = radL + mz.rad.w;
      const tickLead = M.sqrtLead*mz.scale;
      const radStart = n.open ? n.open.e : n.s;
      const radEnd = n.close ? n.close.s : n.e;
      out.boxes.push({ type:"sqrt", x, y:baselineY - mz.rad.a - mz.top, w:mz.w,
        h:mz.rad.a+mz.rad.d+mz.top+mz.bottom, lead:mz.lead, tickLead, top:mz.top, trail:mz.trail, scale:mz.scale,
        showParens:!!mz.showParens, radL, radR, radBaselineY:baselineY, radA:mz.rad.a, radD:mz.rad.d, radStart, radEnd, s:n.s, e:n.e });
      if(n.nameRange) pushAnchor(out, n.nameRange.s, x, baselineY, mz);
      place(mz.rad, radL, baselineY, out);
      if(n.open) pushAnchor(out, n.open.s, radL, baselineY, mz);
      if(n.close){ pushAnchor(out, n.close.s, x+mz.w, baselineY, mz); pushAnchor(out, n.close.e, x+mz.w, baselineY, mz); }
      out.spans.push({ s:n.s, e:n.e, kind:"sqrt" });
      return;
    }
    case "call": {
      // Emit the function NAME (subscript-aware, like a bare identifier) so it
      // classifies/highlights as a scope function AND keeps its subscript even
      // when called — f_0(x) renders f₀(x), not flat f_0(x). The "(" is separate.
      const nameW = nameVisualWidth(n.name, mz.scale);
      emitName(out, n.name, x, baselineY, mz.scale, n.nameRange.s, "ident", n.name, out.wf);
      out.boxes.push({ type:"text", text:"(", x:x+nameW, y:baselineY, scale:mz.scale, tk:"op", v:"(", s:n.open.s, e:n.open.e });
      let cx = x + nameW + mz.pw;
      pushAnchor(out, n.open.s, x+nameW, baselineY, mz);          // before '('
      pushAnchor(out, n.open.e, cx, baselineY, mz);              // after '('
      mz.argMs.forEach((am,i)=>{
        if(i>0){
          const comma = n.commas[i-1];
          out.boxes.push({ type:"text", text:",", x:cx, y:baselineY, scale:mz.scale, tk:"op", s:comma.s, e:comma.e });
          if(comma) pushAnchor(out, comma.s, cx, baselineY, mz);
          cx += mz.commaW;
        }
        place(am, cx, baselineY, out);
        cx += am.w;
      });
      if(n.close){
        out.boxes.push({ type:"text", text:")", x:cx, y:baselineY, scale:mz.scale, tk:"op", s:n.close.s, e:n.close.e });
        pushAnchor(out, n.close.s, cx, baselineY, mz);
        pushAnchor(out, n.close.e, cx+mz.pw, baselineY, mz);
      }
      return;
    }
    case "bigop": {
      // glyph column centered at x..x+colW
      const colCx = x + mz.colW/2;
      const glyphX = colCx - mz.glyphW/2;
      out.boxes.push({ type:"bigglyph", op:n.op, glyph:n.glyph, x:glyphX, y:baselineY, scale:mz.gscale,
        gw:mz.glyphW, ga:mz.glyphA, gd:mz.glyphD, glyphFontEm:mz.glyphFontEm,
        s:n.nameRange.s, e:n.open?n.open.e:n.nameRange.e });
      pushAnchor(out, n.nameRange.s, x, baselineY, mz);
      // upper bound centered above glyph
      if(mz.hi){
        const hiX = colCx - mz.hi.w/2;
        const hiBaseline = baselineY - mz.glyphA - mz.gap - mz.hi.d;
        place(mz.hi, hiX, hiBaseline, out);
      }
      // lower group centered below glyph
      const lowerBaseline = baselineY + mz.glyphD + mz.gap + (mz.idx?mz.idx.a:(mz.lo?mz.lo.a:0));
      if(mz.isInt){
        if(mz.lo){ const loX=colCx-mz.lo.w/2; place(mz.lo, loX, lowerBaseline, out); }
      } else {
        // idx "=" lo  centered as a group
        const eqW = (mz.idx&&mz.lo)? M.charW*mz.scale*M.bigBoundScale : 0;
        const grpW = (mz.idx?mz.idx.w:0)+eqW+(mz.lo?mz.lo.w:0);
        let lx = colCx - grpW/2;
        if(mz.idx){ place(mz.idx, lx, lowerBaseline, out); lx+=mz.idx.w; }
        if(mz.idx&&mz.lo){ out.boxes.push({ type:"text", text:"=", x:lx, y:lowerBaseline, scale:mz.scale*M.bigBoundScale, tk:"op" }); lx+=eqW; }
        if(mz.lo){ place(mz.lo, lx, lowerBaseline, out); }
      }
      // body to the right of the column
      const bodyX = x + mz.colW + mz.bodyGap;
      place(mz.body, bodyX, baselineY, out);
      // integrate: append " d{var}"
      if(mz.isInt && mz.dvarM){
        const dx = bodyX + mz.body.w + M.opGap*mz.scale;
        out.boxes.push({ type:"text", text:"d", x:dx, y:baselineY, scale:mz.scale, tk:"ident" });
        place(mz.dvarM, dx + M.charW*mz.scale, baselineY, out);
      }
      // end anchor
      pushAnchor(out, n.e, x+mz.w, baselineY, mz);
      // record this operator's full span so the editor can treat it as an atomic
      // unit: arrows skip its hidden syntax, backspace-after deletes it whole,
      // shift-arrow from outside selects it whole. `fields` lists the editable
      // sub-regions in VISUAL traversal order — index/lower (bottom) → upper
      // (top) → body (right) — so left/right arrows move through the stacked
      // pieces coherently instead of jumping by raw source offset.
      const F = [];
      const pushField = (node)=>{ if(node && node.s!=null) F.push({ s:node.s, e:node.e }); };
      pushField(n.idx);   // bottom: index var (sum/prod) or integration var
      pushField(n.lo);    // bottom: lower bound
      pushField(n.hi);    // top: upper bound
      pushField(n.body);  // right: summand / integrand
      out.spans.push({ s:n.s, e:n.e, kind:"bigop", fields:F });
      return;
    }
  }
}

function pushAnchor(out, offset, x, baselineY, mz){
  if(offset==null) return;
  out.anchors.push({ offset, x, y: baselineY - mz.a, h: mz.a + mz.d, baselineY });
}

// ── Public entry ──────────────────────────────────────────────────────────────
// text → { boxes, anchors, snap, width, ascent, descent }. The DOM layer scales
// by px font size and offsets by the field's padding.
//   anchors : sorted [{offset,x,y,h,baselineY}] for offsets that have a visible
//             caret position.
//   snap    : Int array length text.length+1; snap[i] = the offset whose anchor
//             the caret should use when the text index is i. For a visible
//             offset that's i itself; for an offset hidden inside collapsed
//             syntax (e.g. the "ummation(" of a ∑) it's the nearest visible
//             offset, so caret motion glides over hidden characters instead of
//             stalling on an un-drawable position.
function layoutMath(text, opts={}){
  text = text||"";
  const scale = opts.scale!=null ? opts.scale : 1;
  const wrapWidth = opts.wrapWidth!=null ? opts.wrapWidth : Infinity;  // in em units
  const wf = opts.widthOf || null;   // measured per-glyph width fn (proportional fonts)
  _caret = opts.caret!=null ? opts.caret : -1;  // for caret-aware sqrt paren room
  const tree = parseLayout(text);
  const mz = measure(tree, scale, wf);
  const out = { boxes:[], anchors:[], spans:[], arrayEnds:[], wf };

  // Place the top-level row with auto-wrapping. Only the TOP LEVEL breaks: each
  // top-level child (an atom, fraction, group, bigop, sup, sqrt, call…) is an
  // atomic unit that stays on one line. We greedily fill a line until the next
  // child would exceed wrapWidth, then start a new line stacked below. Nested
  // structure placement is unchanged (each child is placed via `place` relative
  // to its line's baseline), so fractions/parens/bigops never split internally.
  let totalH;
  if(mz.kids && mz.kids.length && wrapWidth<Infinity){
    const lineGap = 0.28*scale;            // extra space between wrapped lines
    // group children into lines
    const lines = [];
    let cur = [], curW = 0;
    for(const k of mz.kids){
      // a single child wider than the whole width still goes on its own line
      if(cur.length && curW + k.w > wrapWidth){ lines.push(cur); cur=[]; curW=0; }
      cur.push(k); curW += k.w;
    }
    if(cur.length) lines.push(cur);
    // place each line, tracking vertical position by per-line ascent/descent
    let y = 0;
    for(let li=0; li<lines.length; li++){
      const line = lines[li];
      let la=0, ld=0; for(const k of line){ la=Math.max(la,k.a); ld=Math.max(ld,k.d); }
      if(line.length===0){ la=mz.a; ld=mz.d; }
      const baselineY = y + la;
      let cx = 0;
      for(const k of line){ place(k, cx, baselineY, out); cx += k.w; }
      // right-edge anchor at the end of this line (so caret after the last child
      // on a line sits at the line end, not jumping to the next line's start)
      const lastChild = line[line.length-1];
      if(lastChild) pushAnchor(out, lastChild.node.e, cx, baselineY, mz);
      y = baselineY + ld + lineGap;
    }
    totalH = y - lineGap;   // drop the trailing gap
    // recompute width as the widest line
    let ww=0, lx=0; // not strictly needed; the host sizes to wrapWidth
    ensureAnchor(out, 0, 0, lines[0] ? (()=>{let a=0;for(const k of lines[0])a=Math.max(a,k.a);return a;})() : mz.a, mz);
  } else {
    // no wrapping: single baseline at ascent
    place(mz, 0, mz.a, out);
    totalH = mz.a + mz.d;
    ensureAnchor(out, 0, 0, mz.a, mz);
  }
  ensureAnchor(out, text.length, mz.w, mz.a, mz);
  // De-dup anchors per offset, preferring the first (leftmost) for a given
  // offset; sort by offset for binary search downstream.
  const byOff = new Map();
  for(const an of out.anchors){ if(!byOff.has(an.offset)) byOff.set(an.offset, an); }
  const anchors = [...byOff.values()].sort((a,b)=>a.offset-b.offset);

  // Build the snap map: for every text index 0..len, the anchored offset it
  // resolves to. Indices that already have an anchor map to themselves. Hidden
  // indices snap to whichever neighboring anchored offset is closer in text
  // distance (ties go forward, toward the content the syntax introduces).
  const snap = new Int32Array(text.length+1);
  const anchoredOffsets = anchors.map(a=>a.offset);
  let ai=0;
  for(let i=0;i<=text.length;i++){
    while(ai+1<anchoredOffsets.length && anchoredOffsets[ai+1]<=i) ai++;
    const lo = anchoredOffsets[ai];
    const hi = ai+1<anchoredOffsets.length ? anchoredOffsets[ai+1] : lo;
    if(lo===i || hi===i){ snap[i]=i; }
    else { snap[i] = (i-lo) <= (hi-i) ? lo : hi; }   // tie → lo (forward boundary of hidden span)
  }

  const spans = out.spans.slice().sort((a,b)=>a.s-b.s);
  // Keep the caret inside array slots: the offset just past a hidden "]" (which
  // renders at the same x as the last inside position) is forced to snap back to
  // the interior end, so typing at the end of a [..] tuple inserts INSIDE it.
  for(const ae of out.arrayEnds){
    if(ae+1>=0 && ae+1<=text.length) snap[ae+1] = ae;
  }
  return { boxes: out.boxes, anchors, snap, spans, width: mz.w, ascent: mz.a, descent: mz.d, height: totalH };
}
function ensureAnchor(out, offset, x, baselineY, mz){
  if(!out.anchors.some(a=>a.offset===offset)) out.anchors.push({ offset, x, y:baselineY-mz.a, h:mz.a+mz.d, baselineY });
}

export { layoutMath, M };
