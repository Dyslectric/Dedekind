import * as THREE from "three";
import { resolveNum, safeEval, makeFastComplexEval, linspace } from "../core/math.js";
import { hexToThree } from "./three-helpers.js";
import { buildCurve3d, buildSegments3d, buildSurf, buildGlyphFieldGPU, buildTransformerGraphGPU, buildTransformerSphericalGPU } from "./builders.js";
import { marchingSquares, complexEquationCurves, marchingCubes, intersectionCurve3d } from "./implicit.js";
import { buildImplicitRaymarch } from "./implicit-raymarch.js";

// ── Transformer: render a pure map (fnMap) over a domain ─────────────────────
// A transformer takes a function ℝ^inDim → ℝ^outDim and turns it into geometry
// in two ways:
//   graph  — assign each input component to a spatial axis and each output
//            component to a spatial axis; the (input→output) graph is drawn as a
//            curve (1 input) or surface (2 inputs).
//   field  — at each sampled input point (placed in world by the input-axis
//            assignment), draw the output vector as an arrow (quiver/glyph).
//
// The domain is either inline (a grid over the input box at `res`) or a wired
// paramSpace whose manifold points supply the input coordinates.

const AXIS_INDEX = { x:0, y:1, z:2, none:-1 };
// World axis order is (x, z, y) elsewhere in the renderer; we assemble a math
// triple [X,Y,Z] then swap when writing positions.

function fnSpec(fnNode){
  const p=fnNode?.props||{};
  const inDim=Math.max(1,Math.min(3,Math.round(Number(p.inDim))||1));
  const outDim=Math.max(1,Math.min(4,Math.round(Number(p.outDim))||1));
  const outs=[p.out0,p.out1,p.out2,p.out3].slice(0,outDim).map(e=>e||"0");
  const field=p.field||"real";
  return { inDim, outDim, outs, field };
}
function clampDim(v,d){ const n=Math.round(Number(v)); return isFinite(n)?Math.max(1,Math.min(4,n)):d; }

// Evaluate the map at an input vector [x,y,z,w] (only first inDim used). The
// canonical input symbols are x,y,z,w; outputs may be up to four scalars. The
// map's field (real/complex) controls how `i` reads and how results coerce.
function evalMap(outs, scope, inVec, field){
  const sc={...scope, x:inVec[0]??0, y:inVec[1]??0, z:inVec[2]??0, w:inVec[3]??0};
  const r=[]; for(const e of outs){ const v=safeEval(e,sc,false,field); r.push(v==null||!isFinite(v)?0:v); }
  return r;
}

// Is gradient coloring active? Driven by colorSource (the new model): any value
// other than "none"/"" turns colouring on. For LEGACY projects with no
// colorSource set, fall back to the old outAxisK==="color" binding.
function colorOutIndex(tp, outDim){
  for(let k=0;k<outDim;k++){ if((tp[`outAxis${k}`]||"")==="color") return k; }
  return -1;
}
// Resolve the effective colour source for a transformer, honouring the new
// colorSource and falling back to the legacy color-axis binding. Returns one of:
//   {kind:"none"} | {kind:"out", idx} | {kind:"magnitude"} | {kind:"expr"}
function colorSourceOf(tp, outDim){
  const cs=tp.colorSource;
  if(cs==null || cs===""){
    // Legacy fallbacks for projects that predate colorSource:
    //   1) an output bound to the old color axis (outAxisK="color")
    //   2) the old gradient mode: colorMode="gradient" coloured by colorExpr (a
    //      scalar over the outputs/inputs), or — when no expr — by the last output
    //      (field mode reserved the 4th component for colour). Without this, the
    //      refactor would silently un-colour every pre-existing gradient plot.
    const ci=colorOutIndex(tp, outDim);
    if(ci>=0) return {kind:"out", idx:ci};
    if((tp.colorMode||"")==="gradient"){
      if(tp.colorExpr!=null && String(tp.colorExpr).trim()!=="") return {kind:"expr"};
      return {kind:"out", idx:Math.max(0, outDim-1)};
    }
    return {kind:"none"};
  }
  if(cs==="none") return {kind:"none"};
  if(cs==="magnitude") return {kind:"magnitude"};
  if(cs==="expr") return {kind:"expr"};
  const m=/^out(\d+)$/.exec(cs);
  if(m){ const idx=Math.min(outDim-1, Math.max(0, +m[1])); return {kind:"out", idx}; }
  return {kind:"none"};
}
function colorOn(tp, outDim){
  // direct styles always colour (rgb/hsl carry their own expressions); otherwise
  // colour is on when the resolved scalar/2-D source isn't "none".
  if(styleIsDirect(tp)){
    // huemag still needs a real 2-D source; rgb/hsl/cyclic are self-sufficient
    if((tp.colorStyle)==="huemag"){ const cs=tp.colorSource||""; return cs==="outPair"||cs==="complexOut"||/^out\d+$/.test(cs); }
    return true;
  }
  return colorSourceOf(tp, outDim).kind !== "none";
}
// True only when BOTH ends of the color range are pinned by the user. An
// explicitly-defined surface (2-input graph with an output bound to color) must
// not auto-fit its ramp across the sampling domain — that "auto coloring domain"
// makes the surface re-tint itself every time the box or a wired scalar moves,
// which reads as the colors sliding around for no reason. Without an explicit
// range we fall back to the flat single color instead. Curves, point clouds and
// fields keep their auto-fit (they're discrete sets, not a swept domain).
function hasExplicitColorRange(tp){
  return tp.colorMin!=="" && tp.colorMin!=null && tp.colorMax!=="" && tp.colorMax!=null;
}
// Per-sample color scalar from the resolved color source. For "expr" the caller
// supplies a precomputed value (we can't compile here); otherwise it's an output
// value or the output-vector magnitude. Falls back to defaultVal when off.
function colorScalar(tp, scope, inVec, outVec, param, i, defaultVal){
  const outDim=outVec.length;
  const src=colorSourceOf(tp, outDim);
  if(src.kind==="none") return isFinite(defaultVal)?(defaultVal||0):0;
  if(src.kind==="magnitude"){
    let s=0; for(const v of outVec){ if(isFinite(v)) s+=v*v; } return Math.sqrt(s);
  }
  if(src.kind==="out"){
    const v=outVec[src.idx];
    return (v==null||!isFinite(v))?0:v;
  }
  if(src.kind==="expr"){
    // custom scalar over inputs (x,y,z,w), outputs (out0..), domain param, index n
    const sc={...scope};
    const inN=["x","y","z","w"]; for(let k=0;k<inVec.length;k++) sc[inN[k]]=inVec[k];
    for(let k=0;k<outVec.length;k++) sc[`out${k}`]=outVec[k];
    sc.t=param; sc.u=param; sc.v=param; sc.n=i;
    const v=safeEval(tp.colorExpr||"0", sc, true);
    return (v==null||!isFinite(v))?0:v;
  }
  return isFinite(defaultVal)?(defaultVal||0):0;
}
// Map an array of scalars onto the lo→hi ramp across [min,max] (auto when blank).
function rampColors(vals, tp, scope){
  const lo=new THREE.Color(tp.colorLo||"#3a6aff"), hi=new THREE.Color(tp.colorHi||"#ff5ea8");
  let mn=(tp.colorMin!==""&&tp.colorMin!=null)?resolveNum(tp.colorMin,scope,0):Math.min(...vals);
  let mx=(tp.colorMax!==""&&tp.colorMax!=null)?resolveNum(tp.colorMax,scope,1):Math.max(...vals);
  if(!isFinite(mn))mn=0; if(!isFinite(mx))mx=1;
  const span=(mx-mn)||1, c=new THREE.Color();
  return vals.map(v=>{let t=(v-mn)/span;t=t<0?0:t>1?1:t;c.copy(lo).lerp(hi,t);return [c.r,c.g,c.b];});
}

// The colour STYLE (how data → colour). Defaults to "ramp". Styles that produce
// colour DIRECTLY (per-sample RGB, no ramp pass) are rgb / hsl / huemag / cyclic;
// "ramp" produces a scalar that rampColors maps afterwards.
function colorStyleOf(tp){
  const s=tp.colorStyle;
  if(s==="cyclic"||s==="rgb"||s==="hsl"||s==="huemag") return s;
  return "ramp";
}
// Does the active style produce RGB directly (bypassing the scalar→ramp pass)?
function styleIsDirect(tp){ const s=colorStyleOf(tp); return s==="rgb"||s==="hsl"||s==="huemag"||s==="cyclic"; }

// Build a scope with the sample's inputs/outputs bound for a colour expression.
function _colorScope(scope, inVec, outVec, param, i){
  const sc={...scope};
  const inN=["x","y","z","w"]; for(let k=0;k<inVec.length;k++) sc[inN[k]]=inVec[k];
  for(let k=0;k<outVec.length;k++) sc[`out${k}`]=outVec[k];
  sc.t=param; sc.u=param; sc.v=param; sc.n=i;
  return sc;
}
// Direct per-sample RGB for the rgb / hsl / huemag / cyclic styles. Returns
// [r,g,b] in 0..1. (ramp is handled by colorScalar + rampColors instead.)
function directColorRGB(tp, scope, inVec, outVec, param, i){
  const style=colorStyleOf(tp);
  const sc=_colorScope(scope, inVec, outVec, param, i);
  const ev=(e,d)=>{ const v=safeEval(e,sc,true); return (v==null||!isFinite(v))?d:v; };
  if(style==="rgb"){
    const cl=(v)=>v<0?0:v>1?1:v;
    return [cl(ev(tp.colorR,0)), cl(ev(tp.colorG,0)), cl(ev(tp.colorB,0))];
  }
  if(style==="hsl"){
    return hsl2rgb(ev(tp.colorH,0), Math.max(0,Math.min(1,ev(tp.colorS,0.9))), Math.max(0,Math.min(1,ev(tp.colorL,0.5))));
  }
  if(style==="cyclic"){
    // an angle-like scalar (the source) → hue wheel; full sat, mid lightness
    const a=colorScalar(tp, scope, inVec, outVec, param, i, 0);
    return hsl2rgb(a/(2*Math.PI), 0.9, 0.5);
  }
  if(style==="huemag"){
    // a 2-D source → (angle, magnitude): hue=angle, brightness rises with |·|
    const src=tp.colorSource||"";
    let re, im;
    if(src==="complexOut"){ const w=outVec.__cplx; if(w){re=w.re;im=w.im;} else {re=outVec[0]||0;im=0;} }
    else { re=outVec[0]||0; im=outVec[1]||0; }     // outPair / default: out0,out1
    return complexColorRGB(re, im);
  }
  return [1,1,1];
}


//   inline 1D → [[a],[a..],...]  (res points)
//   inline 2D → res×res grid (row-major, returns {pts, nu, nv})
//   inline 3D → res×res×res
function sampleDomain(tp, scope, inDim, paramNode){
  const res=Math.max(2,Math.min(inDim>=3?80:(inDim===2?300:8000),Math.round(resolveNum(tp.res,scope,inDim===1?300:40))));
  const aMin=resolveNum(tp.aMin,scope,-5),aMax=resolveNum(tp.aMax,scope,5);
  if(inDim===1){
    const xs=linspace(aMin,aMax,res);
    return { pts:xs.map(x=>[x,0,0]), grid:false, n:res };
  }
  const bMin=resolveNum(tp.bMin,scope,-5),bMax=resolveNum(tp.bMax,scope,5);
  if(inDim===2){
    const xs=linspace(aMin,aMax,res), ys=linspace(bMin,bMax,res);
    const pts=[]; for(const y of ys) for(const x of xs) pts.push([x,y,0]);
    return { pts, grid:true, nu:res, nv:res };
  }
  const cMin=resolveNum(tp.cMin,scope,-3),cMax=resolveNum(tp.cMax,scope,3);
  const r3=Math.min(res,80);
  const xs=linspace(aMin,aMax,r3), ys=linspace(bMin,bMax,r3), zs=linspace(cMin,cMax,r3);
  if(inDim===3){
    const pts=[]; for(const x of xs) for(const y of ys) for(const z of zs) pts.push([x,y,z]);
    return { pts, grid:false, n:pts.length };
  }
  // inDim===4: a 4D box is impractical to grid densely, so we sample a coarse
  // (x,y,z) volume across a few w-slices. The 4th input is most often a
  // parameter; for finer control, drive the domain from a paramSpace instead.
  const dMin=resolveNum(tp.dMin,scope,-3),dMax=resolveNum(tp.dMax,scope,3);
  const r4=Math.min(r3,16), ws=linspace(dMin,dMax,Math.min(r4,8));
  const xs4=linspace(aMin,aMax,r4), ys4=linspace(bMin,bMax,r4), zs4=linspace(cMin,cMax,r4);
  const pts=[]; for(const w of ws) for(const x of xs4) for(const y of ys4) for(const z of zs4) pts.push([x,y,z,w]);
  return { pts, grid:false, n:pts.length };
}

// Sample a paramSpace node's manifold → input vectors. degree 1 → a line of
// points (t); degree 2 → a grid of points (u,v). The manifold's (x,y,z) become
// the function input coordinates.
function sampleParamSpace(node, scope){
  const p=node.props||{};
  const degree=clampDim(p.degree,1);
  if(degree>=2){
    const ur=Math.max(2,Math.min(200,resolveNum(p.uRes,scope,40))), vr=Math.max(2,Math.min(200,resolveNum(p.vRes,scope,30)));
    const us=linspace(resolveNum(p.uMin,scope,0),resolveNum(p.uMax,scope,Math.PI*2),ur);
    const vs=linspace(resolveNum(p.vMin,scope,0),resolveNum(p.vMax,scope,Math.PI),vr);
    const pts=[];
    for(const v of vs) for(const u of us){
      const x=safeEval(p.exprXu,{...scope,u,v})??0, y=safeEval(p.exprYu,{...scope,u,v})??0, z=safeEval(p.exprZu,{...scope,u,v})??0;
      pts.push([x,y,z]);
    }
    return { pts, grid:true, nu:ur, nv:vr };
  }
  const res=Math.max(2,Math.min(8000,resolveNum(p.res,scope,300)));
  const ts=linspace(resolveNum(p.tMin,scope,0),resolveNum(p.tMax,scope,Math.PI*2),res);
  const pts=ts.map(t=>{
    const x=safeEval(p.exprX,{...scope,t})??0, y=safeEval(p.exprY,{...scope,t})??0, z=safeEval(p.exprZ,{...scope,t})??0;
    return [x,y,z];
  });
  return { pts, grid:false, n:res };
}

// Assemble a world-space math triple [X,Y,Z] from input + output components,
// using the transformer's axis assignments. Inputs fill their assigned axes;
// outputs fill theirs (outputs win if both assign the same axis).
function placeGraph(tp, inVec, outVec, inDim, outDim){
  const world=[0,0,0];
  const inAx=[tp.inAxis0,tp.inAxis1,tp.inAxis2];
  const outAx=[tp.outAxis0,tp.outAxis1,tp.outAxis2];
  for(let k=0;k<inDim;k++){ const ax=AXIS_INDEX[inAx[k]??"none"]; if(ax>=0) world[ax]=inVec[k]??0; }
  for(let k=0;k<outDim;k++){ const ax=AXIS_INDEX[outAx[k]??"none"]; if(ax>=0) world[ax]=outVec[k]??0; }
  return world;
}

// Map a math triple [X,Y,Z] → three.js position (x, z, y).
function toWorld(m){ return [m[0], m[2], m[1]]; }

// HSL→RGB (h in [0,1)). Used for complex domain colouring: hue encodes argument.
function hsl2rgb(h, s, l){
  h=((h%1)+1)%1;
  const a=s*Math.min(l,1-l);
  const f=(n)=>{const k=(n+h*12)%12; return l-a*Math.max(-1,Math.min(k-3,9-k,1));};
  return [f(0), f(8), f(4)];
}
// Colour for a complex value w: hue = arg(w)/2π, brightness rises with |w| (soft
// knee so zeros are dark and growth compresses, the standard domain-colouring
// lightness ramp), saturation near 1. Returns [r,g,b] in 0..1.
function complexColorRGB(re, im){
  const mod=Math.hypot(re,im);
  const hue=Math.atan2(im,re)/(2*Math.PI);
  const l=1 - 1/(1 + mod*0.5);
  return hsl2rgb(hue, 0.95, 0.12 + 0.76*l);
}
// A complex 1→1 map (one complex input, one complex output) — gets the dedicated
// ℂ→ℂ visualizations instead of the usual real graph/field modes.
function isComplexMap(field, inDim, outDim){
  return field==="complex" && inDim===1 && outDim===1;
}

function buildTransformer(tNode, fnNode, paramNode, scope, color, eqNode, eqNode2=null, scopeF=null, scopeG=null, tex=null, ntex=null, nstr=1, lights=null){
  const tp=tNode.props||{};

  // ── Implicit equation node ──
  // 2D: draw the curve lhs=rhs over the inline domain box (marching squares).
  // 3D: draw the surface lhs=rhs over the inline 3D box (marching cubes).
  // Two 3D equations wired together: draw their intersection CURVE {F=0}∩{G=0}.
  if(eqNode){
    const is3d = (eqNode.props.dims||"2d")==="3d";
    const eq2is3d = eqNode2 && (eqNode2.props.dims||"2d")==="3d";
    const aMin=resolveNum(tp.aMin,scope,-5), aMax=resolveNum(tp.aMax,scope,5);
    const bMin=resolveNum(tp.bMin,scope,-5), bMax=resolveNum(tp.bMax,scope,5);

    // ── Complex equation F(z)=0, done properly ──
    // F is complex over the plane (varA=Re z, varB=Im z, i imaginary). The solution
    // is {Re F=0} ∩ {Im F=0}: draw both zero-contours as curves (Re in one hue, Im
    // in another) and mark their intersections — the actual roots — as points.
    // Always planar (a complex equation has no 3-D form), regardless of `dims`.
    if((eqNode.props.field||"real")==="complex"){
      const res=Math.max(2,Math.min(600,Math.round(resolveNum(tp.res,scope,200))));
      const { reSegs, imSegs, roots } = complexEquationCurves(eqNode, scopeF||scope, aMin,aMax, bMin,bMax, res);
      const out=[];
      // contours live in the ground plane at (a,0,b); buildSegments3d bakes math
      // (x,y,z)→world(x,z,−y), so feed math (a,−b,0) like the real 2-D curve does.
      const toWorld=(segs)=>segs.map(([p0,p1])=>[[p0[0],-p0[1],0],[p1[0],-p1[1],0]]);
      const reColor="#5ec8ff", imColor="#ff7eb6", rootColor="#ffe066";
      if(reSegs.length) out.push(...buildSegments3d(toWorld(reSegs), reColor));
      if(imSegs.length) out.push(...buildSegments3d(toWorld(imSegs), imColor));
      // root markers: small spheres at each intersection
      if(roots.length){
        const g=new THREE.SphereGeometry(1,12,12);
        const m=new THREE.MeshBasicMaterial({color:hexToThree(rootColor),depthTest:false});
        const inst=new THREE.InstancedMesh(g,m,roots.length);
        const span=Math.max(aMax-aMin,bMax-bMin); const r=span*0.012;
        const mtx=new THREE.Matrix4();
        roots.forEach(([a,b],k)=>{ mtx.makeScale(r,r,r); mtx.setPosition(a,0,-b); inst.setMatrixAt(k,mtx); });
        inst.instanceMatrix.needsUpdate=true;
        out.push(inst);
      }
      return out;
    }

    if(is3d){
      const cMin=resolveNum(tp.cMin,scope,-3), cMax=resolveNum(tp.cMax,scope,3);

      // Intersection curve of two surfaces. Resolution drives the marching-cubes
      // grid the curve is carved from, so the same box/res controls cost (O(res³)
      // field eval); keep it modest. This is a CPU mesh-derived curve — animated
      // sliders rebuild it (no GPU uniform path).
      if(eq2is3d){
        const ir=Math.max(8,Math.min(160,Math.round(resolveNum(tp.res,scope,64))));
        const segs=intersectionCurve3d(eqNode, scopeF||scope, eqNode2, scopeG||scope,
          aMin,aMax, bMin,bMax, cMin,cMax, ir);
        if(!segs.length) return [];
        return buildSegments3d(segs, color);
      }
      // Prefer GPU ray marching: it renders the level set directly in a fragment
      // shader (no mesh extraction, no field readback), crisp at any zoom. Falls
      // back to the marching-cubes mesh when the expression can't transpile to GLSL.
      const rm = buildImplicitRaymarch(tp, eqNode, scope, color, resolveNum, tex, ntex, lights);
      if(rm){
        // Mark the array as a GPU surface so the rebuild cache-hit path runs
        // updateGpuUniforms on it — this is what animates the morph parameter
        // (a live shader uniform) without rebuilding. Without this tag an animated
        // implicit surface freezes once its signature is stable across frames.
        rm._gpu = true;
        return rm;
      }

      const res=Math.max(2,Math.min(300,Math.round(resolveNum(tp.res,scope,48))));
      const { positions, normals } = marchingCubes(eqNode, scope,
        aMin,aMax, bMin,bMax, cMin,cMax, res);
      if(!positions.length) return [];
      // marching cubes returns math (x,y,z); swap to three world order (x,z,y).
      const wpos=new Float32Array(positions.length);
      const wnrm=new Float32Array(normals.length);
      for(let i=0;i<positions.length;i+=3){
        wpos[i]=positions[i]; wpos[i+1]=positions[i+2]; wpos[i+2]=positions[i+1];
        wnrm[i]=normals[i];   wnrm[i+1]=normals[i+2];   wnrm[i+2]=normals[i+1];
      }
      const g=new THREE.BufferGeometry();
      g.setAttribute("position",new THREE.BufferAttribute(wpos,3));
      g.setAttribute("normal",new THREE.BufferAttribute(wnrm,3));
      const c3=hexToThree(color);
      const mat=new THREE.MeshPhongMaterial({color:c3,side:THREE.DoubleSide,transparent:true,opacity:0.85,shininess:40,flatShading:false});
      const mesh=new THREE.Mesh(g,mat);
      // Wireframe overlay is toggleable (transformer's showWire prop, default on),
      // matching analytic surfaces.
      if(tp.showWire===false) return [mesh];
      const wire=new THREE.LineSegments(new THREE.WireframeGeometry(g),new THREE.LineBasicMaterial({color:c3,transparent:true,opacity:0.12}));
      return [mesh, wire];
    }

    // 2D implicit curve — marching squares over the (a,b) box, drawn in the
    // world ground plane via (a, 0, b).
    const res=Math.max(2,Math.min(1200,Math.round(resolveNum(tp.res,scope,120))));
    const segs=marchingSquares(eqNode, scope, aMin, aMax, bMin, bMax, res);
    if(!segs.length) return [];
    // Render as a screen-space fat line (CSS-pixel width) instead of a 1px
    // hairline so the implicit curve stays clearly visible at all angles/zoom.
    // The curve lives in the world ground plane at (a, 0, b). buildSegments3d
    // bakes math (x,y,z)→world (x, z, −y), so feed math (a, −b, 0) to land there.
    return buildSegments3d(segs.map(([p0,p1])=>[[p0[0],-p0[1],0],[p1[0],-p1[1],0]]), color);
  }

  if(!fnNode) return [];
  const { inDim, outDim, outs, field } = fnSpec(fnNode);

  // ── ℂ→ℂ map visualizations ──
  // A complex 1→1 map samples the complex INPUT plane (re, im) over the domain
  // box and evaluates w = f(re + i·im), keeping the complex result. The output is
  // shown one of four ways (cplxMode): a flat domain-coloured plane, or a surface
  // whose height is |f|, Re f, or Im f — with hue = arg f on the modulus surface.
  if(isComplexMap(field, inDim, outDim)){
    const cm = tp.cplxMode || "domain";
    const reMin=resolveNum(tp.aMin,scope,-3), reMax=resolveNum(tp.aMax,scope,3);
    const imMin=resolveNum(tp.bMin,scope,-3), imMax=resolveNum(tp.bMax,scope,3);
    // square-ish resolution; clamp so a dense plane stays affordable on CPU
    const res=Math.max(8, Math.min(220, Math.round(resolveNum(tp.res,scope,90))));
    const reN=res, imN=res;
    const reVals=linspace(reMin,reMax,reN), imVals=linspace(imMin,imMax,imN);
    // compile once; mutate {re,im} per sample
    const sc={}; for(const k in scope){ if(k!=="pi"&&k!=="e"&&k!=="i") sc[k]=scope[k]; }
    const fn=makeFastComplexEval(outs[0], {...sc, re:0, im:0});
    if(!fn) return [];
    // height scale for surfaces: keep the surface in a comfortable world range by
    // normalizing the height channel to the plane's extent.
    const planeSpan=Math.max(1e-6, Math.max(reMax-reMin, imMax-imMin));
    const heightOf=(w)=> cm==="modulus" ? Math.hypot(w.re,w.im) : cm==="re" ? w.re : cm==="im" ? w.im : 0;
    // first pass: sample w over the grid, track height range for normalization
    const W=new Array(imN);
    let hMin=Infinity, hMax=-Infinity;
    for(let j=0;j<imN;j++){
      const row=new Array(reN);
      sc.im=imVals[j];
      for(let i=0;i<reN;i++){
        sc.re=reVals[i];
        const w=fn(sc);
        row[i]=w;
        if(w && cm!=="domain"){ const h=heightOf(w); if(isFinite(h)){ if(h<hMin)hMin=h; if(h>hMax)hMax=h; } }
      }
      W[j]=row;
    }
    if(cm!=="domain" && !isFinite(hMin)) return [];
    const hSpan=Math.max(1e-6, hMax-hMin);
    // normalize height into ~[0, planeSpan*0.6] so surfaces sit nicely over the plane
    const hNorm=(h)=> cm==="domain" ? 0 : (h-hMin)/hSpan*planeSpan*0.6 + ((cm==="re"||cm==="im")? -planeSpan*0.3 : 0);
    // build rows of math-space [x,y,z] = [re, height, im] (buildSurf swaps to world)
    // and matching colour rows (hue = arg f; brightness = |f| for domain mode,
    // or constant-ish for the explicit-height surfaces, still hued by arg).
    const rows=new Array(imN), cols=new Array(imN);
    for(let j=0;j<imN;j++){
      const pr=new Array(reN), cr=new Array(reN);
      for(let i=0;i<reN;i++){
        const w=W[j][i];
        if(!w){ pr[i]=null; cr[i]=[0.15,0.15,0.18]; continue; }
        const h=cm==="domain"?0:hNorm(heightOf(w));
        pr[i]=[reVals[i], h, imVals[j]];                 // math (x,y,z); y is height
        cr[i]=complexColorRGB(w.re, w.im);               // hue = arg, value = |w|
      }
      rows[j]=pr; cols[j]=cr;
    }
    return buildSurf(rows, color, cols, tp.showWire!==false && cm!=="domain");
  }

  const dom = sampleDomain(tp, scope, inDim, paramNode);
  if(!dom.pts.length) return [];

  if(tp.mode==="field"){
    // Vector field: arrow at each input point (placed by input axes), output as
    // the vector (placed by output axes). Reuses the instanced glyph builder.
    //
    // fieldColor: when on, the LAST output component drives a color gradient and
    // the remaining outputs form the vector. So a 3-output map becomes a 2D
    // vector field colored by out2; a 4-output map becomes a 3D vector field
    // colored by out3; a 2-output map becomes a 1D vector field colored by out1.
    // When off, all outputs form the vector with a single static color (valid for
    // 2- or 3-output maps; a 4-output map always colors, since there's no 4th axis).
    // Color comes from the resolved colour source (colorSource, with legacy
    // color-axis fallback). Outputs bound to a spatial axis form the vector.
    const useColor = colorOn(tp, outDim);
    const directF = useColor && styleIsDirect(tp);
    const inAx=[tp.inAxis0,tp.inAxis1,tp.inAxis2];
    const outAx=[tp.outAxis0,tp.outAxis1,tp.outAxis2,tp.outAxis3];
    const pairs=[]; const cvals=useColor?[]:null;
    for(let s=0;s<dom.pts.length;s++){
      const inVec=dom.pts[s];
      const outVec=evalMap(outs,scope,inVec,field);
      const posM=[0,0,0], vecM=[0,0,0];
      for(let k=0;k<inDim;k++){ const ax=AXIS_INDEX[inAx[k]??"none"]; if(ax>=0) posM[ax]=inVec[k]??0; }
      for(let k=0;k<outDim;k++){ const ax=AXIS_INDEX[outAx[k]??"none"]; if(ax>=0) vecM[ax]=outVec[k]??0; }
      pairs.push({ pos:posM, vec:vecM });   // glyph builder applies its own axis swap
      if(useColor){ const p=s/Math.max(1,dom.pts.length-1); cvals.push(directF ? directColorRGB(tp,scope,inVec,outVec,p,s) : colorScalar(tp,scope,inVec,outVec,p,s)); }
    }
    const opts={ arrowLen:resolveNum(tp.arrowLen,scope,0.5), normalize:tp.normalize!==false, anim:"none", speed:1 };
    if(useColor) opts.cols = directF ? cvals : rampColors(cvals,tp,scope);
    return buildGlyphFieldGPU(pairs, color, opts);
  }

  // polar mode — interpret the input as an angle θ and the (first) output as a
  // radius r, placing each sample at (r·cosθ, r·sinθ). A 1-input map draws the
  // polar curve r = f(θ); coloring works as in graph mode.
  if(tp.mode==="polar" && inDim===1){
    const gradientP=colorOn(tp, outDim);
    const n=dom.pts.length;
    const pts=new Array(n); const vals=gradientP?new Array(n):null;
    for(let i=0;i<n;i++){
      const inVec=dom.pts[i];
      const outVec=evalMap(outs,scope,inVec,field);
      const th=inVec[0]??0, r=outVec[0]??0;
      // math order [X,Y,Z]; buildCurve3d applies the world swap itself
      pts[i]=[r*Math.cos(th), r*Math.sin(th), 0];
      if(gradientP) vals[i]=colorScalar(tp,scope,inVec,outVec,n>1?i/(n-1):0,i);
    }
    return buildCurve3d(pts, color, gradientP?rampColors(vals,tp,scope):null);
  }

  // spherical mode — interpret two inputs as angles (θ azimuth, φ polar) and the
  // first output as a radius r, placing each sample at the spherical point
  // (r·sinφ·cosθ, r·sinφ·sinθ, r·cosφ). A 2-input map draws the surface r = f(θ,φ).
  if(tp.mode==="spherical" && inDim===2 && dom.grid){
    const gradientS=colorOn(tp, outDim) && hasExplicitColorRange(tp);
    // GPU fast path: the inline (θ,φ) grid is analytic, so evaluate every vertex
    // in a shader. Only when the domain is the inline grid (a wired paramSpace
    // supplies arbitrary points the shader can't reproduce) and no gradient is
    // requested (the GPU spherical path renders flat-colored; gradient stays CPU).
    if(!paramNode && !gradientS){
      const gpu=buildTransformerSphericalGPU(tp, outs, scope, color);
      if(gpu && gpu.length){ gpu._gpu=true; return gpu; }
    }
    const nu=dom.nu, nv=dom.nv, rows=[], colRows=gradientS?[]:null, flatVals=gradientS?[]:null;
    let idx=0;
    for(let j=0;j<nv;j++){
      const row=[], crow=gradientS?[]:null;
      for(let i=0;i<nu;i++){
        const inVec=dom.pts[idx++];
        const outVec=evalMap(outs,scope,inVec,field);
        const th=inVec[0]??0, ph=inVec[1]??0, r=outVec[0]??0;
        const sp=Math.sin(ph);
        row.push([r*sp*Math.cos(th), r*sp*Math.sin(th), r*Math.cos(ph)]);
        if(gradientS){ const s=colorScalar(tp,scope,inVec,outVec, nu>1?i/(nu-1):0, idx-1); crow.push(s); flatVals.push(s); }
      }
      rows.push(row); if(gradientS) colRows.push(crow);
    }
    if(gradientS){
      const flat=rampColors(flatVals,tp,scope);
      let k=0; for(let j=0;j<nv;j++) for(let i=0;i<nu;i++) colRows[j][i]=flat[k++];
    }
    return buildSurf(rows, color, gradientS?colRows:null, tp.showWire!==false);
  }

  // graph mode
  const gradient=colorOn(tp, outDim);
  const direct1=gradient && styleIsDirect(tp);
  if(inDim===1){
    const n=dom.pts.length;
    const pts=new Array(n); const vals=gradient?new Array(n):null;
    for(let i=0;i<n;i++){
      const inVec=dom.pts[i];
      const outVec=evalMap(outs,scope,inVec,field);
      pts[i]=placeGraph(tp,inVec,outVec,inDim,outDim);
      if(gradient){ vals[i]= direct1 ? directColorRGB(tp,scope,inVec,outVec,n>1?i/(n-1):0,i) : colorScalar(tp,scope,inVec,outVec,n>1?i/(n-1):0,i); }
    }
    return buildCurve3d(pts, color, gradient?(direct1?vals:rampColors(vals,tp,scope)):null);
  }
  if(inDim===2 && dom.grid){
    const direct = colorOn(tp, outDim) && styleIsDirect(tp);
    // An explicitly-defined surface (z = out bound to an axis) only gradient-
    // colors when an output is bound to color AND the user pinned the range.
    // A color-bound output with no range no longer auto-fits across the domain;
    // it renders in the flat single color instead (see hasExplicitColorRange).
    const surfGradient = !direct && gradient && hasExplicitColorRange(tp);
    // GPU fast path handles flat, ramp, AND the direct styles (rgb/hsl/huemag/
    // cyclic) — the colour is emitted as a per-fragment albedo in the shader.
    // Falls back to CPU per-vertex only when an expression can't transpile.
    if(!paramNode){
      let colorInfo=null;
      if(surfGradient){
        colorInfo={ lo:new THREE.Color(tp.colorLo||"#3a6aff"), hi:new THREE.Color(tp.colorHi||"#ff5ea8"),
                    cmin:resolveNum(tp.colorMin,scope,0), cmax:resolveNum(tp.colorMax,scope,1) };
      }
      const directSpec = direct ? { style:colorStyleOf(tp), source:tp.colorSource||"",
        colorR:tp.colorR, colorG:tp.colorG, colorB:tp.colorB, colorH:tp.colorH, colorS:tp.colorS, colorL:tp.colorL, colorExpr:tp.colorExpr } : null;
      const gpu=buildTransformerGraphGPU(tp, outs, inDim, outDim, scope, color, colorInfo, tex, ntex, nstr, lights, directSpec);
      if(gpu && gpu.length){ gpu._gpu=true; return gpu; }
    }
    const useCol = surfGradient || direct;
    const nu=dom.nu, nv=dom.nv, rows=[], colRows=useCol?[]:null, flatVals=surfGradient?[]:null;
    let idx=0;
    for(let j=0;j<nv;j++){
      const row=[], crow=useCol?[]:null;
      for(let i=0;i<nu;i++){
        const inVec=dom.pts[idx++];
        const outVec=evalMap(outs,scope,inVec,field);
        row.push(placeGraph(tp,inVec,outVec,inDim,outDim));
        if(direct){ crow.push(directColorRGB(tp,scope,inVec,outVec, nu>1?i/(nu-1):0, idx-1)); }
        else if(surfGradient){ const s=colorScalar(tp,scope,inVec,outVec, nu>1?i/(nu-1):0, idx-1); crow.push(s); flatVals.push(s); }
      }
      rows.push(row); if(useCol) colRows.push(crow);
    }
    if(surfGradient){
      const flat=rampColors(flatVals,tp,scope);
      let k=0; for(let j=0;j<nv;j++) for(let i=0;i<nu;i++) colRows[j][i]=flat[k++];
    }
    return buildSurf(rows, color, useCol?colRows:null, tp.showWire!==false, direct);
  }
  // 3 inputs in graph mode: render as a value-coloured point cloud at the
  // graphed positions (no single surface to draw).
  const positions=[]; const svals=gradient?[]:null;
  for(let i=0;i<dom.pts.length;i++){
    const inVec=dom.pts[i];
    const outVec=evalMap(outs,scope,inVec,field);
    positions.push(toWorld(placeGraph(tp,inVec,outVec,inDim,outDim)));
    if(gradient) svals.push(colorScalar(tp,scope,inVec,outVec,0,i));
  }
  const arr=new Float32Array(positions.length*3);
  for(let i=0;i<positions.length;i++){ arr[i*3]=positions[i][0]; arr[i*3+1]=positions[i][1]; arr[i*3+2]=positions[i][2]; }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.BufferAttribute(arr,3));
  let mat;
  if(gradient){
    const cols=rampColors(svals,tp,scope);
    const ca=new Float32Array(positions.length*3);
    for(let i=0;i<cols.length;i++){ ca[i*3]=cols[i][0]; ca[i*3+1]=cols[i][1]; ca[i*3+2]=cols[i][2]; }
    geo.setAttribute("color",new THREE.BufferAttribute(ca,3));
    mat=new THREE.PointsMaterial({size:0.06,vertexColors:true,transparent:true,opacity:0.85});
  }else{
    mat=new THREE.PointsMaterial({size:0.06,color:hexToThree(color),transparent:true,opacity:0.85});
  }
  return [new THREE.Points(geo,mat)];
}

export { buildTransformer, fnSpec, sampleParamSpace };
