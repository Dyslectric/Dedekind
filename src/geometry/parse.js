import { safeEval } from "../core/math.js";

// ── Point sequence parser ────────────────────────────────────────────────────
// Four input modes, auto-detected from the text:
//
//   Plain:      "x, y"  or  "x, y, z"   (one point per line)
//
//   Recursive:  "x[n] = expr_using_x[n-1], …"  — each point depends on the prev
//               Line 0: initial values   e.g.  "1, 0"
//               Line 1: recurrence        e.g.  "x[n-1]*0.99, y[n-1]+0.1"
//               Line 2 (optional): count  e.g.  "50"
//               The recurrence may reference x_prev/y_prev/z_prev OR
//               x[n-1]/y[n-1]/z[n-1].
//
//   Index:      closed-form per index i (no dependence on the previous point)
//               Line 0: expressions in i  e.g.  "cos(i*0.3), sin(i*0.3)"
//               Line 1 (optional): count  e.g.  "64"   (default 64)
//               Detected by an "[i]" reference that is NOT a "[n…]" recurrence.
//
//   Matrix:     multidimensional index (i, j) → a grid of points
//               Line 0: expressions in i and j  e.g.  "i, j, sin(i*j)"
//               Line 1 (optional): counts        e.g.  "8, 8"  (rows, cols)
//               Detected by an "[i,j]" reference. Points are emitted row-major
//               (i outer, j inner) so drawn lines trace each row.
//
// Detection order: recurrence ("[n") wins first (back-compat), then matrix
// ("[i,j]"), then index ("[i]").

function parsePointSeq(text, scope) {
  if (!text) return [];
  const trimmed = text.trim();

  if (trimmed.includes("[n")) return parseRecursiveSeq(trimmed, scope);
  if (hasMatrixIndex(trimmed)) return parseMatrixSeq(trimmed, scope);
  if (hasIndexRef(trimmed)) return parseIndexSeq(trimmed, scope);

  // Plain mode: one "x, y[, z]" per line.
  return trimmed.split("\n").map(line => {
    const parts = line.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const x = safeEval(parts[0], scope);
    const y = safeEval(parts[1], scope);
    const z = parts[2] ? (safeEval(parts[2], scope) ?? 0) : 0;
    if (x == null || y == null) return null;
    return [x, y, z];
  }).filter(Boolean);
}

function parseRecursiveSeq(text, scope) {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//"));
  if (lines.length < 2) return [];

  const initParts = lines[0].split(",").map(s => s.trim());
  const x0 = safeEval(initParts[0], scope);
  const y0 = safeEval(initParts[1] || "0", scope);
  const z0 = safeEval(initParts[2] || "0", scope);
  if (x0 == null || y0 == null) return [];

  const recParts = splitRecurrenceParts(lines[1]);
  if (recParts.length < 2) return [[x0, y0, z0 ?? 0]];

  const xExpr = substituteRecVars(recParts[0]);
  const yExpr = substituteRecVars(recParts[1]);
  const zExpr = recParts[2] ? substituteRecVars(recParts[2]) : null;

  let count = 64;
  if (lines[2]) {
    const c = safeEval(lines[2], scope);
    if (c != null && isFinite(c)) count = Math.max(1, Math.min(4096, Math.round(c)));
  }

  const pts = [[x0, y0, z0 ?? 0]];
  let xp = x0, yp = y0, zp = z0 ?? 0;

  for (let n = 1; n < count; n++) {
    const sc = { ...scope, __xp: xp, __yp: yp, __zp: zp, n };
    const nx = safeEval(xExpr, sc);
    const ny = safeEval(yExpr, sc);
    const nz = zExpr ? (safeEval(zExpr, sc) ?? 0) : 0;
    if (nx == null || ny == null || !isFinite(nx) || !isFinite(ny)) break;
    pts.push([nx, ny, nz]);
    xp = nx; yp = ny; zp = nz;
  }
  return pts;
}

// ── Index mode ───────────────────────────────────────────────────────────────
// Each point is a closed-form function of its index i (0-based). Order-free.
function parseIndexSeq(text, scope) {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//"));
  if (!lines.length) return [];

  const parts = splitRecurrenceParts(lines[0]);
  if (parts.length < 2) return [];
  const xExpr = stripIndexRefs(parts[0]);
  const yExpr = stripIndexRefs(parts[1]);
  const zExpr = parts[2] != null ? stripIndexRefs(parts[2]) : null;

  let count = 64;
  if (lines[1]) {
    const c = safeEval(lines[1], scope);
    if (c != null && isFinite(c)) count = Math.max(1, Math.min(8192, Math.round(c)));
  }

  const pts = [];
  for (let i = 0; i < count; i++) {
    const sc = { ...scope, i, n: i };
    const x = safeEval(xExpr, sc);
    const y = safeEval(yExpr, sc);
    const z = zExpr ? (safeEval(zExpr, sc) ?? 0) : 0;
    if (x == null || y == null || !isFinite(x) || !isFinite(y)) continue;
    pts.push([x, y, z]);
  }
  return pts;
}

// ── Matrix (multidimensional index) mode ─────────────────────────────────────
// Each point is a closed-form function of two indices (i, j). Emits an
// rows×cols grid in row-major order (i outer, j inner).
function parseMatrixSeq(text, scope) {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//"));
  if (!lines.length) return [];

  const parts = splitRecurrenceParts(lines[0]);
  if (parts.length < 2) return [];
  const xExpr = stripIndexRefs(parts[0]);
  const yExpr = stripIndexRefs(parts[1]);
  const zExpr = parts[2] != null ? stripIndexRefs(parts[2]) : null;

  // How many index dimensions? If `k` appears, it's a 3-D index grid (i,j,k);
  // otherwise 2-D (i,j). Sizes come from the count line ("rows, cols[, deep]");
  // a single number means a cube/square.
  const dims = hasBareIndex(lines[0], "k") ? 3 : 2;
  let ni = 8, nj = 8, nk = 1;
  if (lines[1]) {
    const cnts = lines[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const a = safeEval(cnts[0], scope);
    const b = cnts[1] != null ? safeEval(cnts[1], scope) : a;
    const c = cnts[2] != null ? safeEval(cnts[2], scope) : (dims === 3 ? a : 1);
    const clamp = v => Math.max(1, Math.min(256, Math.round(v)));
    if (a != null && isFinite(a)) ni = clamp(a);
    if (b != null && isFinite(b)) nj = clamp(b);
    if (dims === 3 && c != null && isFinite(c)) nk = clamp(c);
  } else if (dims === 3) {
    nk = 8;
  }

  const pts = [];
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      for (let k = 0; k < nk; k++) {
        const sc = { ...scope, i, j, k, n: (i * nj + j) * nk + k };
        const x = safeEval(xExpr, sc);
        const y = safeEval(yExpr, sc);
        const z = zExpr ? (safeEval(zExpr, sc) ?? 0) : 0;
        if (x == null || y == null || !isFinite(x) || !isFinite(y)) continue;
        pts.push([x, y, z]);
      }
    }
  }
  return pts;
}

// Split a line by top-level commas (not inside parentheses/brackets)
function splitRecurrenceParts(line) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of line) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Replace x[n-1] -> __xp, etc. (depth-1 history only)
function substituteRecVars(expr) {
  return expr
    .replace(/\bx\s*\[\s*n\s*-\s*\d+\s*\]/g, "__xp")
    .replace(/\by\s*\[\s*n\s*-\s*\d+\s*\]/g, "__yp")
    .replace(/\bz\s*\[\s*n\s*-\s*\d+\s*\]/g, "__zp")
    .replace(/\bx_prev\b/g, "__xp")
    .replace(/\by_prev\b/g, "__yp")
    .replace(/\bz_prev\b/g, "__zp");
}

// ── Index-mode detection & rewriting ─────────────────────────────────────────
// Index mode is driven by the free symbols i / j / k. Detection works on either
//   • bare symbols:   "cos(i*0.3), sin(i*0.3)"   /   "i, j, sin(i*j)"
//   • bracket alias:  "x[i]"  /  "x[i,j]"   (a convenience that resolves to the
//     bare index — "x"/"y"/"z" are just labels).
// Matrix mode is chosen when the SECOND index (j or k) appears; otherwise it is
// single-index mode. Recurrence ("[n…]") is detected earlier and takes priority.
const IDX_NAMES = "ijk";
// A free index symbol i/j/k at a word boundary (so it doesn't match inside
// identifiers like "min" or a scalar named "ice").
function hasBareIndex(text, sym){
  return new RegExp(`(^|[^A-Za-z0-9_])${sym}([^A-Za-z0-9_]|$)`).test(text);
}
function hasBracketIndex(text){
  return new RegExp(`\\[\\s*[${IDX_NAMES}]`).test(text);
}
function hasIndexRef(text){
  // any single index in use (bare i/j/k or a bracket alias) and NOT a
  // multi-index (matrix) usage.
  const anyBare = hasBareIndex(text,"i") || hasBareIndex(text,"j") || hasBareIndex(text,"k");
  return (anyBare || hasBracketIndex(text)) && !hasMatrixIndex(text);
}
function hasMatrixIndex(text){
  // bracket form x[i,j] / x[i;j], OR two or more DISTINCT bare index symbols.
  if(new RegExp(`\\[\\s*[${IDX_NAMES}][^\\]]*[,;][^\\]]*\\]`).test(text)) return true;
  const n=(hasBareIndex(text,"i")?1:0)+(hasBareIndex(text,"j")?1:0)+(hasBareIndex(text,"k")?1:0);
  return n>=2;
}
// Rewrite bracket index aliases into plain index arithmetic so mathjs can
// evaluate them against {i, j, k} in scope. A bracket ref is a convenience
// alias for its index symbol: x[i] -> (i), x[i+2] -> (i+2), x[i,j] -> (i).
// Bare i/j/k are already valid symbols and pass through untouched.
function stripIndexRefs(expr) {
  if (!expr) return expr;
  let out = expr;
  out = out.replace(
    new RegExp(`\\b[A-Za-z_]\\w*\\s*\\[\\s*([${IDX_NAMES}](?:\\s*[-+]\\s*\\d+)?)\\s*[,;]\\s*([${IDX_NAMES}](?:\\s*[-+]\\s*\\d+)?)\\s*\\]`, "g"),
    (_m, a) => `(${a})`
  );
  out = out.replace(
    new RegExp(`\\b[A-Za-z_]\\w*\\s*\\[\\s*([${IDX_NAMES}](?:\\s*[-+]\\s*\\d+)?)\\s*\\]`, "g"),
    (_m, a) => `(${a})`
  );
  return out;
}

// ── Glyph field: collections of (seed, vector) pairs ─────────────────────────
// Input formats:
//   Plain:    "x, y, z | vx, vy, vz"  (one pair per line; z and vz optional)
//   Recursive: 3 lines where each pair may depend on the previous via x[n-1] etc.
//   Index:    closed-form per i —  "x,… | vx,…"  then a count line.
//   Matrix:   closed-form per (i,j) — "x,… | …"  then "rows, cols".
// Returns [{pos:[x,y,z], vec:[vx,vy,vz]}].
function parseGlyphField(text, scope){
  if(!text) return [];
  const trimmed=text.trim();
  if(trimmed.includes("[n")) return parseGlyphSeq(trimmed, scope);
  if(hasMatrixIndex(trimmed)) return parseGlyphMatrix(trimmed, scope);
  if(hasIndexRef(trimmed)) return parseGlyphIndex(trimmed, scope);
  return trimmed.split("\n").map(line=>{
    if(!line.trim()||line.trim().startsWith("//")) return null;
    const [posPart, vecPart] = line.split("|");
    if(!posPart||!vecPart) return null;
    const p=posPart.split(",").map(s=>s.trim());
    const v=vecPart.split(",").map(s=>s.trim());
    const x=safeEval(p[0],scope), y=safeEval(p[1]||"0",scope), z=safeEval(p[2]||"0",scope);
    const vx=safeEval(v[0],scope), vy=safeEval(v[1]||"0",scope), vz=safeEval(v[2]||"0",scope);
    if([x,y,z,vx,vy,vz].some(n=>n==null||!isFinite(n))) return null;
    return {pos:[x,y,z], vec:[vx,vy,vz]};
  }).filter(Boolean);
}
function parseGlyphSeq(text, scope){
  const lines=text.split("\n").map(l=>l.trim()).filter(l=>l&&!l.startsWith("//"));
  if(lines.length<2) return [];
  const init=lines[0].split("|");
  const ip=(init[0]||"").split(",").map(s=>s.trim());
  const iv=(init[1]||"").split(",").map(s=>s.trim());
  const x0=safeEval(ip[0],scope), y0=safeEval(ip[1]||"0",scope), z0=safeEval(ip[2]||"0",scope);
  const vx0=safeEval(iv[0],scope), vy0=safeEval(iv[1]||"0",scope), vz0=safeEval(iv[2]||"0",scope);
  if([x0,y0,z0,vx0,vy0,vz0].some(n=>n==null)) return [];
  const rec=lines[1].split("|");
  const recPos=splitRecurrenceParts(rec[0]||"");
  const recVec=splitRecurrenceParts(rec[1]||"");
  const sub=subGlyphVars;
  const ex={ x:sub(recPos[0]), y:sub(recPos[1]), z:sub(recPos[2]||"__zp"),
             vx:sub(recVec[0]), vy:sub(recVec[1]), vz:sub(recVec[2]||"__vzp") };
  let count=48;
  if(lines[2]){ const c=safeEval(lines[2],scope); if(c!=null&&isFinite(c)) count=Math.max(1,Math.min(8192,Math.round(c))); }
  const out=[{pos:[x0,y0,z0],vec:[vx0,vy0,vz0]}];
  let xp=x0,yp=y0,zp=z0,vxp=vx0,vyp=vy0,vzp=vz0;
  for(let n=1;n<count;n++){
    const sc={...scope,__xp:xp,__yp:yp,__zp:zp,__vxp:vxp,__vyp:vyp,__vzp:vzp,n};
    const nx=safeEval(ex.x,sc), ny=safeEval(ex.y,sc), nz=ex.z?safeEval(ex.z,sc)??0:0;
    const nvx=ex.vx?safeEval(ex.vx,sc)??0:0, nvy=ex.vy?safeEval(ex.vy,sc)??0:0, nvz=ex.vz?safeEval(ex.vz,sc)??0:0;
    if([nx,ny,nz,nvx,nvy,nvz].some(v=>v==null||!isFinite(v))) break;
    out.push({pos:[nx,ny,nz],vec:[nvx,nvy,nvz]});
    xp=nx;yp=ny;zp=nz;vxp=nvx;vyp=nvy;vzp=nvz;
  }
  return out;
}
// Glyph index mode: line 0 = "posX,posY,posZ | vecX,vecY,vecZ" in i, line 1 = count.
function parseGlyphIndex(text, scope){
  const lines=text.split("\n").map(l=>l.trim()).filter(l=>l&&!l.startsWith("//"));
  if(!lines.length) return [];
  const [posPart, vecPart] = lines[0].split("|");
  const p=splitRecurrenceParts(posPart||"").map(stripIndexRefs);
  const v=splitRecurrenceParts(vecPart||"").map(stripIndexRefs);
  let count=48;
  if(lines[1]){ const c=safeEval(lines[1],scope); if(c!=null&&isFinite(c)) count=Math.max(1,Math.min(8192,Math.round(c))); }
  const out=[];
  for(let i=0;i<count;i++){
    const sc={...scope,i,n:i};
    const x=safeEval(p[0],sc), y=safeEval(p[1]||"0",sc), z=safeEval(p[2]||"0",sc);
    const vx=safeEval(v[0],sc), vy=safeEval(v[1]||"0",sc), vz=safeEval(v[2]||"0",sc);
    if([x,y,z,vx,vy,vz].some(n=>n==null||!isFinite(n))) continue;
    out.push({pos:[x,y,z],vec:[vx,vy,vz]});
  }
  return out;
}
// Glyph matrix mode: line 0 = "pos | vec" in i,j(,k); line 1 = sizes.
function parseGlyphMatrix(text, scope){
  const lines=text.split("\n").map(l=>l.trim()).filter(l=>l&&!l.startsWith("//"));
  if(!lines.length) return [];
  const [posPart, vecPart] = lines[0].split("|");
  const p=splitRecurrenceParts(posPart||"").map(stripIndexRefs);
  const v=splitRecurrenceParts(vecPart||"").map(stripIndexRefs);
  const dims = hasBareIndex(lines[0],"k") ? 3 : 2;
  let ni=8, nj=8, nk=dims===3?8:1;
  if(lines[1]){
    const cnts=lines[1].split(/[,;]/).map(s=>s.trim()).filter(Boolean);
    const a=safeEval(cnts[0],scope), b=cnts[1]!=null?safeEval(cnts[1],scope):a, c=cnts[2]!=null?safeEval(cnts[2],scope):(dims===3?a:1);
    const clamp=x=>Math.max(1,Math.min(256,Math.round(x)));
    if(a!=null&&isFinite(a)) ni=clamp(a);
    if(b!=null&&isFinite(b)) nj=clamp(b);
    if(dims===3&&c!=null&&isFinite(c)) nk=clamp(c);
  }
  const out=[];
  for(let i=0;i<ni;i++) for(let j=0;j<nj;j++) for(let k=0;k<nk;k++){
    const sc={...scope,i,j,k,n:(i*nj+j)*nk+k};
    const x=safeEval(p[0],sc), y=safeEval(p[1]||"0",sc), z=safeEval(p[2]||"0",sc);
    const vx=safeEval(v[0],sc), vy=safeEval(v[1]||"0",sc), vz=safeEval(v[2]||"0",sc);
    if([x,y,z,vx,vy,vz].some(n=>n==null||!isFinite(n))) continue;
    out.push({pos:[x,y,z],vec:[vx,vy,vz]});
  }
  return out;
}
// Map x[n-1]→__xp, vx[n-1]→__vxp, etc. (vx before x so the prefix matches).
function subGlyphVars(expr){
  if(!expr) return null;
  return expr
    .replace(/\bvx\s*\[\s*n\s*-\s*\d+\s*\]/g,"__vxp")
    .replace(/\bvy\s*\[\s*n\s*-\s*\d+\s*\]/g,"__vyp")
    .replace(/\bvz\s*\[\s*n\s*-\s*\d+\s*\]/g,"__vzp")
    .replace(/\bx\s*\[\s*n\s*-\s*\d+\s*\]/g,"__xp")
    .replace(/\by\s*\[\s*n\s*-\s*\d+\s*\]/g,"__yp")
    .replace(/\bz\s*\[\s*n\s*-\s*\d+\s*\]/g,"__zp");
}

export {
  parsePointSeq, parseRecursiveSeq, parseIndexSeq, parseMatrixSeq,
  splitRecurrenceParts, substituteRecVars, stripIndexRefs,
  hasIndexRef, hasMatrixIndex,
  parseGlyphField, parseGlyphSeq, parseGlyphIndex, parseGlyphMatrix, subGlyphVars
};
