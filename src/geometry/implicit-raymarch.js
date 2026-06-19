import * as THREE from "three";
import { exprToGLSL } from "./glsl.js";
import { hexToThree } from "./three-helpers.js";

// ── Ray-marched implicit surface ──────────────────────────────────────────────
// Renders the level set F(x,y,z)=0 directly in a fragment shader instead of
// extracting a triangle mesh with marching cubes. A unit box covering the math
// sampling domain is drawn; for each fragment we reconstruct the world-space view
// ray, clip it to the domain box, then march F along the ray. At the first sign
// change we bisect a few times to localize the crossing and shade it with a
// finite-difference gradient normal.
//
// Why ray marching: it sidesteps the whole CPU/GPU field-readback + mesh-build
// pipeline (and its driver-dependent failure modes). The field is evaluated
// entirely on the GPU at native fragment resolution, so the surface is crisp at
// any zoom and there is no triangle budget. Returns null (→ caller falls back to
// the marching-cubes mesh) when the expression can't be transpiled to GLSL.
//
// Coordinate convention: the rest of the renderer maps math (x,y,z) → three
// (x, z, y). The box is built in three-space accordingly; inside the shader we
// map the sampled three-space point back to math coords before evaluating F.
//
//   tp    : transformer props (sampling box aMin..cMax, res, showWire)
//   eqNode: the equation node (lhs, rhs, varA/varB/varC, dims)
//   scope : resolved scope (slider/animator values become live uniforms)
//   color : surface base color (hex)
//   resolveNum: numeric prop resolver (passed in to avoid an import cycle)
function buildImplicitRaymarch(tp, eqNode, scope, color, resolveNum){
  const p = eqNode.props || {};
  const vA = (p.varA || "x").trim() || "x";
  const vB = (p.varB || "y").trim() || "y";
  const vC = (p.varC || "z").trim() || "z";
  const fExpr = `(${p.lhs ?? "0"}) - (${p.rhs ?? "0"})`;

  // Transpile F to GLSL. The three field variables are the axis vars; everything
  // else (sliders/animators/constants) becomes a uniform.
  const uniforms = new Set();
  const axisVars = new Set([vA, vB, vC]);
  const glslF = exprToGLSL(fExpr, axisVars, uniforms);
  if (glslF == null) return null;               // untranspilable → caller uses mesh path
  const freeUniforms = [...uniforms].filter(n => !axisVars.has(n));

  // Math-space sampling box.
  const aMin=resolveNum(tp.aMin,scope,-5), aMax=resolveNum(tp.aMax,scope,5);
  const bMin=resolveNum(tp.bMin,scope,-5), bMax=resolveNum(tp.bMax,scope,5);
  const cMin=resolveNum(tp.cMin,scope,-3), cMax=resolveNum(tp.cMax,scope,3);
  // March step count scales with the requested resolution (capped — this is the
  // per-ray sample count, the dominant cost). Default mirrors the mesh res.
  const steps = Math.max(16, Math.min(1024, Math.round(resolveNum(tp.res,scope,96))));

  // Box geometry in THREE space: math (x,y,z)→three (x,z,y), so:
  //   three.x ∈ [aMin,aMax]   (math x)
  //   three.y ∈ [cMin,cMax]   (math z, up)
  //   three.z ∈ [bMin,bMax]   (math y)
  const tx0=aMin, tx1=aMax, ty0=cMin, ty1=cMax, tz0=bMin, tz1=bMax;
  const cx=(tx0+tx1)/2, cy=(ty0+ty1)/2, cz=(tz0+tz1)/2;
  const sxw=Math.max(1e-6,tx1-tx0), syw=Math.max(1e-6,ty1-ty0), szw=Math.max(1e-6,tz1-tz0);
  const geo=new THREE.BoxGeometry(sxw,syw,szw);
  geo.translate(cx,cy,cz);

  // Uniform declarations + map. Box bounds in math coords are baked as constants.
  const uniDecls = freeUniforms.map(n=>`uniform float ${n};`).join("\n");
  const uniformsObj = {
    uColor:{value:new THREE.Color(hexToThree(color))},
    uMinM:{value:new THREE.Vector3(aMin,bMin,cMin)},   // math-space box min (x,y,z)
    uMaxM:{value:new THREE.Vector3(aMax,bMax,cMax)},   // math-space box max
    uSteps:{value:steps},
    // three injects projectionMatrix/modelMatrix only into the VERTEX shader; the
    // fragment shader gets viewMatrix + cameraPosition. We need the projection in
    // the fragment shader for the per-hit depth write, so supply it ourselves and
    // keep it current via onBeforeRender (it changes on zoom/resize/projection swap).
    uProj:{value:new THREE.Matrix4()},
    // adaptive-march tuning defaults (see fragment shader for meaning)
    uSafety:{value:0.7},     // damped Newton: step 70% of the distance estimate
    uGrazeK:{value:1.2},     // accept |F| within ~1.2·baseDt·|∇F| as a surface graze
    uGradEps:{value:0.08},   // |∇F| below this is treated as singular (normal hardening)
    uSeamLo:{value:0.15},    // seam darkening onset (normal disagreement)
    uSeamHi:{value:0.6},     // seam darkening saturates here
    // meaningful coloring: encode depth / gradient / normal as hue.
    uColorMode:{value:
      tp.colorMode==="depth" ? 1.0 :
      tp.colorMode==="gradient" ? 2.0 :
      tp.colorMode==="normal" ? 3.0 :
      tp.colorMode==="iridescent" ? 4.0 : 0.0 },
    uColorShift:{value: resolveNum(tp.colorShift, scope, 0)},
    uGradScale:{value: 0.5},
  };
  for(const n of freeUniforms) uniformsObj[n]={value:Number(scope[n])||0};

  const vert = `
    varying vec3 vWorld;
    void main(){
      vec4 wp = modelMatrix * vec4(position,1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;

  // The field, written as a GLSL function of math coords (the axis vars are the
  // function's locals). We substitute the user's var names directly.
  const fieldFn = `
    float fieldF(vec3 m){
      float ${vA} = m.x; float ${vB} = m.y; float ${vC} = m.z;
      return (${glslF});
    }`;

  const frag = `
    precision highp float;
    // three injects the EXT_frag_depth #extension for us (material.extensions.
    // fragDepth=true). Pick the right write symbol per GLSL version; if depth
    // writes aren't available the macro is a no-op (surface still draws, just
    // uses the box depth).
    #if __VERSION__ >= 300
    #define WRITE_DEPTH(v) gl_FragDepth = (v)
    #elif defined(GL_EXT_frag_depth)
    #define WRITE_DEPTH(v) gl_FragDepthEXT = (v)
    #else
    #define WRITE_DEPTH(v)
    #endif
    varying vec3 vWorld;
    uniform vec3 uColor;
    uniform vec3 uMinM, uMaxM;
    uniform float uSteps;
    uniform mat4 uProj;
    // ── adaptive-march tuning (all exposed so the look can be dialed in) ──
    uniform float uSafety;   // Newton step damping (<1; lower = safer, slower)
    uniform float uGrazeK;   // tangency/seam |F| sensitivity (higher = catch more grazes)
    uniform float uGradEps;  // gradient magnitude below this = "singular" (normal hardening)
    uniform float uSeamLo;   // seam: normal-disagreement where darkening starts
    uniform float uSeamHi;   // seam: disagreement where darkening saturates
    uniform float uColorMode;  // 0 flat|1 depth|2 gradient|3 normal|4 iridescent
    uniform float uColorShift; // hue offset (animated over time in iridescent mode)
    uniform float uGradScale;  // gradient-mode: log-compression scale
    ${uniDecls}
    ${fieldFn}
    // Plotted content lives in a group oriented so WORLD relates to MATH as:
    //   world = (math.x, math.z, −math.y)  ⇒  math = (world.x, −world.z, world.y)
    // (math X→right, Z→up, Y→away; right-handed.)
    vec3 threeToMath(vec3 t){ return vec3(t.x, -t.z, t.y); }
    // sample F at a world-space point
    float sampleF(vec3 t){ return fieldF(threeToMath(t)); }
    // Raw central-difference gradient in MATH space at world point t. Used both
    // for the adaptive (Newton) distance estimate and for shading. The h vector
    // controls the finite-difference radius; smaller near the surface for accuracy.
    vec3 gradM(vec3 t, vec3 h){
      vec3 m = threeToMath(t);
      float fx = fieldF(m+vec3(h.x,0.0,0.0)) - fieldF(m-vec3(h.x,0.0,0.0));
      float fy = fieldF(m+vec3(0.0,h.y,0.0)) - fieldF(m-vec3(0.0,h.y,0.0));
      float fz = fieldF(m+vec3(0.0,0.0,h.z)) - fieldF(m-vec3(0.0,0.0,h.z));
      return vec3(fx,fy,fz) / (2.0*max(h.x,max(h.y,h.z)));
    }
    // Shading normal, mapped MATH grad (x,y,z) → WORLD (x, z, −y). At singular
    // points ∇F → 0, so a plain normalize turns finite-difference noise into a
    // random direction (the "torn" look at nodes/cusps). HARDENING: when the
    // gradient magnitude is tiny relative to the field's local scale, blend toward
    // the view direction so the singular point shades as a smooth silhouette
    // instead of sparkling. uGradEps sets the "this gradient is degenerate"
    // threshold (a tunable; larger = more aggressive smoothing of singularities).
    vec3 normalAt(vec3 t, vec3 viewDir){
      vec3 e = (uMaxM - uMinM) * 0.0015 + 1e-4;
      vec3 gM = gradM(t, e);
      vec3 gW = vec3(gM.x, gM.z, -gM.y);
      float gLen = length(gW);
      vec3 n = gW / max(gLen, 1e-8);
      // degeneracy factor: 0 = healthy gradient, 1 = fully singular
      float deg = 1.0 - smoothstep(0.0, uGradEps, gLen);
      // toward singularity, fall back to a view-facing normal (silhouette-stable)
      n = normalize(mix(n, -viewDir, deg*0.85) + 1e-6);
      return n;
    }
    // ray vs axis-aligned box (world bounds derived from the math sampling box)
    bool boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax, out float t0, out float t1){
      vec3 inv = 1.0/rd;
      vec3 a = (bmin-ro)*inv, b=(bmax-ro)*inv;
      vec3 lo=min(a,b), hi=max(a,b);
      t0 = max(max(lo.x,lo.y),lo.z);
      t1 = min(min(hi.x,hi.y),hi.z);
      return t1>=max(t0,0.0);
    }
    // cosine palette (Inigo Quilez style) → smooth, saturated iridescence. The h
    // argument is a scalar phase; the surface drives it from position + normal so
    // hue sweeps across the geometry like an oil-slick / kaleidoscope.
    vec3 iridescence(float h){
      vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(1.0), d = vec3(0.00,0.33,0.67);
      return a + b*cos(6.28318*(c*h + d));
    }
    void main(){
      vec3 ro = cameraPosition;
      vec3 rd = normalize(vWorld - cameraPosition);
      // world box bounds: world.x = math.x, world.y = math.z, world.z = −math.y
      vec3 bmin = vec3(uMinM.x, uMinM.z, -uMaxM.y);
      vec3 bmax = vec3(uMaxM.x, uMaxM.z, -uMinM.y);
      float t0,t1;
      if(!boxHit(ro,rd,bmin,bmax,t0,t1)) discard;
      t0 = max(t0, 0.0);

      // Adaptive (damped-Newton / sphere-trace hybrid) march.
      //   • Step by clamp(|F|/|∇F|, minStep, maxStep) * SAFETY — adaptively slow
      //     near the surface (catches thin sheets and tangencies that fixed steps
      //     skip) and fast through empty space. SAFETY<1 prevents the overshoot a
      //     pure |F|/|∇F| estimate suffers on non-SDF polynomial fields.
      //   • Sign change between consecutive samples → bisect for the exact crossing.
      //   • Near-zero magnitude (a graze that never flips sign — common at self-
      //     intersection seams and tangent points) also counts as a hit.
      float span = (t1 - t0);
      float baseDt = span / uSteps;            // nominal sampling scale
      float minStep = baseDt * 0.25;
      float maxStep = baseDt * 4.0;
      float dEps    = baseDt * 0.5;            // forward-diff radius along the ray

      float t = t0;
      float prev = sampleF(ro + rd*t);
      float tHit = -1.0;
      bool  grazeHit = false;
      float lastStep = minStep;     // length of the step taken to reach current t
      // PERF: the adaptive step only needs the slope of F ALONG THE RAY, not the
      // full 3-D gradient. So instead of a 6-tap gradient every step (the old hot
      // spot — 6 field evals per iteration), estimate dF/dt with a single extra
      // sample a hair ahead. This cuts the inner loop from ~7 field evals to ~2,
      // a big win on heavy polynomials (and the main reason Firefox stuttered).
      // The full-quality gradient is computed ONCE at the hit point for shading.
      for(int i=0;i<1024;i++){
        if(t >= t1) break;
        vec3 pos = ro + rd*t;
        float f = sampleF(pos);

        // sign-change crossing → bisect between the previous sample and this one
        if(prev * f < 0.0){
          float ta = t - lastStep;   // previous sample position (where F = prev)
          float tb = t;              // current sample position (where F = f)
          float pa = prev;
          for(int b=0;b<10;b++){
            float tm = 0.5*(ta+tb);
            float fm = sampleF(ro+rd*tm);
            if(pa*fm <= 0.0){ tb = tm; } else { ta = tm; pa = fm; }
          }
          tHit = 0.5*(ta+tb);
          break;
        }

        // directional slope |dF/dt| along the ray (1 extra eval, not 6)
        float fAhead = sampleF(pos + rd*dEps);
        float slope = max(abs(fAhead - f) / dEps, 1e-6);

        // near-zero graze (tangency / seam) → accept this point as a hit
        float graze = uGrazeK * baseDt * slope;   // |F| considered "on surface"
        if(abs(f) < graze){
          tHit = t; grazeHit = true; break;
        }

        // adaptive step: Newton distance estimate (along-ray), damped + clamped
        float dist = abs(f) / slope;              // ~distance to surface along ray
        float step = clamp(dist * uSafety, minStep, maxStep);
        lastStep = step;
        prev = f;
        t += step;
      }
      if(tHit < 0.0) discard;
      vec3 pHit = ro + rd*tHit;

      // ── singularity supersampling ────────────────────────────────────────────
      // Near a singular point the gradient is small and the normal is unstable, so
      // shade from several jittered samples and average — this softens the node/
      // cusp from a sparkling artifact into a coherent point. The number of extra
      // samples ramps up with how degenerate the gradient is.
      vec3 viewDir = rd;
      vec3 hgrad = (uMaxM - uMinM) * 0.0015 + 1e-4;  // gradient FD radius (hit-point shading)
      vec3 nrm = normalAt(pHit, viewDir);
      {
        vec3 gM = gradM(pHit, hgrad);
        vec3 gW = vec3(gM.x, gM.z, -gM.y);
        float deg = 1.0 - smoothstep(0.0, uGradEps, length(gW));
        if(deg > 0.05){
          vec3 acc = nrm;
          float wsum = 1.0;
          vec3 jr = (uMaxM - uMinM) * 0.004 * deg;   // jitter radius grows with degeneracy
          // fixed small set of offsets (GLSL ES2 needs constant loop bounds)
          for(int s=0;s<6;s++){
            float fs = float(s);
            vec3 off = jr * vec3(
              sin(fs*1.7+0.3), cos(fs*2.3+1.1), sin(fs*3.1+2.0));
            vec3 nn = normalAt(pHit + off, viewDir);
            acc += nn; wsum += 1.0;
          }
          nrm = normalize(acc / wsum + 1e-6);
        }
      }

      // ── visible crossing seam ────────────────────────────────────────────────
      // At a self-intersection two sheets cross; right at the seam the gradient
      // direction changes rapidly, so neighbouring samples disagree on the normal.
      // Detect that disagreement and darken a thin band → the seam reads as an
      // intentional crossing line where the sheets pass through each other.
      float seam = 0.0;
      {
        vec3 a = normalAt(pHit + rd*baseDt*0.5, viewDir);
        vec3 b = normalAt(pHit - rd*baseDt*0.5, viewDir);
        float disagree = 1.0 - abs(dot(a,b));     // 0 smooth, →1 at a crossing
        seam = smoothstep(uSeamLo, uSeamHi, disagree);
      }

      // ── color: encode a meaningful scalar as hue ─────────────────────────────
      // uColorMode selects what the palette encodes (helps the eye read 3D structure):
      //   0 flat       — solid uColor (lambert only)
      //   1 depth      — distance from the camera (near→far sweep); best for
      //                  parsing tangled / self-intersecting geometry
      //   2 gradient   — |∇F|: lights up where the surface is steep vs flat, and
      //                  paints the SINGULAR points (|∇F|→0) a distinct band
      //   3 normal     — surface orientation (a normal-map rainbow; reads curvature)
      // The chosen scalar is mapped to [0,1] and run through the iridescence palette
      // (uColorShift offsets the hue so the user can rotate the ramp).
      vec3 base = uColor;
      if(uColorMode > 0.5){
        float s01 = 0.0;
        if(uColorMode < 1.5){
          // depth: camera distance normalized by the sampling-box diagonal so the
          // ramp is stable regardless of zoom.
          float dist = length(pHit - cameraPosition);
          float diag = length(uMaxM - uMinM);
          // center the useful range around the box: map [near, near+diag] → [0,1]
          float near = length(0.5*(uMinM+uMaxM) - cameraPosition) - 0.5*diag;
          s01 = clamp((dist - near) / max(diag, 1e-4), 0.0, 1.0);
        } else if(uColorMode < 2.5){
          // gradient magnitude → singularities (small |∇F|) at one end of the ramp.
          vec3 gM = gradM(pHit, (uMaxM-uMinM)*0.0015 + 1e-4);
          float gMag = length(gM);
          // log-compress so the huge dynamic range of polynomial gradients reads well
          s01 = clamp(log(1.0 + gMag) * uGradScale, 0.0, 1.0);
        } else if(uColorMode < 3.5){
          // normal direction → orientation. Pack the unit normal into a hue phase.
          s01 = fract(0.5 + 0.5*atan(nrm.y, nrm.x)/3.14159 + 0.25*nrm.z);
        } else {
          // iridescent: decorative oil-slick from position + normal (not a measured
          // quantity — purely aesthetic). Animated phase comes from uColorShift,
          // which the host advances over time for this mode.
          vec3 mp = threeToMath(pHit);
          s01 = fract(0.18*(mp.x+mp.y+mp.z) + 0.35*length(mp)
                    + 0.25*(nrm.x*1.3 + nrm.y*0.7 + nrm.z*1.1));
          // layer a second higher-frequency band for shimmer
          vec3 ir = mix(iridescence(s01+uColorShift), iridescence(s01*2.7+0.3+uColorShift), 0.35);
          base = ir;
          // skip the generic palette mapping below for this branch
          s01 = -1.0;
        }
        if(s01 >= 0.0) base = iridescence(s01 + uColorShift);
      }
      // two-sided lambert + key light, matching the mesh shaders' look
      vec3 L = normalize(vec3(0.4,0.9,0.5));
      float diff = 0.5 + 0.5*abs(dot(nrm, L));
      vec3 col = base*diff;
      col = mix(col, col*0.35, seam);            // seam darkening
      gl_FragColor = vec4(col, 1.0);
      // write correct scene depth so the surface composits with other geometry
      vec4 clip = uProj * viewMatrix * vec4(pHit,1.0);
      WRITE_DEPTH(0.5*(clip.z/clip.w) + 0.5);
    }`;

  const mat=new THREE.ShaderMaterial({
    uniforms:uniformsObj, vertexShader:vert, fragmentShader:frag,
    side:THREE.BackSide,   // render box back faces so the camera can be outside or inside the box
    transparent:false,
  });
  mat.extensions = { fragDepth:true };
  const mesh=new THREE.Mesh(geo, mat);
  mesh.frustumCulled=false;
  mesh._gpuSurface = { uNames: freeUniforms };  // lets updateGpuUniforms animate sliders live
  mesh._raymarch = true;
  // The fragment shader needs the live projection matrix (which three doesn't pass
  // to fragment shaders). Refresh it from whatever camera renders this mesh, every
  // frame, so zoom / resize / perspective↔ortho stay correct.
  mesh.onBeforeRender = (renderer, scene, camera) => {
    mat.uniforms.uProj.value.copy(camera.projectionMatrix);
    // iridescent (mode 4) shimmers over wall-clock time; the measured modes
    // (depth/gradient/normal) are view-driven and need no time phase.
    if(mat.uniforms.uColorMode.value > 3.5){
      mat.uniforms.uColorShift.value = (performance.now()*0.00006) % 1000.0;
    }
  };
  return [mesh];
}

export { buildImplicitRaymarch };
