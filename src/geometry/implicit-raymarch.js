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
  const steps = Math.max(16, Math.min(512, Math.round(resolveNum(tp.res,scope,96))));

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
    ${uniDecls}
    ${fieldFn}
    // Plotted content lives in a group oriented so WORLD relates to MATH as:
    //   world = (math.x, math.z, −math.y)  ⇒  math = (world.x, −world.z, world.y)
    // (math X→right, Z→up, Y→away; right-handed.)
    vec3 threeToMath(vec3 t){ return vec3(t.x, -t.z, t.y); }
    // sample F at a world-space point
    float sampleF(vec3 t){ return fieldF(threeToMath(t)); }
    // central-difference gradient in MATH space, mapped to WORLD for shading
    vec3 normalAt(vec3 t){
      vec3 m = threeToMath(t);
      vec3 e = (uMaxM - uMinM) * 0.002 + 1e-4;
      float fx = fieldF(m+vec3(e.x,0.0,0.0)) - fieldF(m-vec3(e.x,0.0,0.0));
      float fy = fieldF(m+vec3(0.0,e.y,0.0)) - fieldF(m-vec3(0.0,e.y,0.0));
      float fz = fieldF(m+vec3(0.0,0.0,e.z)) - fieldF(m-vec3(0.0,0.0,e.z));
      vec3 gM = vec3(fx,fy,fz);
      // math grad (x,y,z) → world (x, z, −y)
      return normalize(vec3(gM.x, gM.z, -gM.y) + 1e-6);
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
    void main(){
      vec3 ro = cameraPosition;
      vec3 rd = normalize(vWorld - cameraPosition);
      // world box bounds: world.x = math.x, world.y = math.z, world.z = −math.y
      vec3 bmin = vec3(uMinM.x, uMinM.z, -uMaxM.y);
      vec3 bmax = vec3(uMaxM.x, uMaxM.z, -uMinM.y);
      float t0,t1;
      if(!boxHit(ro,rd,bmin,bmax,t0,t1)) discard;
      t0 = max(t0, 0.0);
      int N = int(uSteps);
      float dt = (t1-t0)/float(N);
      float prev = sampleF(ro + rd*t0);
      float tHit = -1.0;
      vec3 pHit;
      for(int i=1;i<=512;i++){
        if(i>N) break;
        float t = t0 + dt*float(i);
        vec3 pos = ro + rd*t;
        float cur = sampleF(pos);
        if(prev*cur < 0.0){
          // bisection refine between (t-dt) and t
          float ta = t-dt, tb = t;
          for(int b=0;b<6;b++){
            float tm=0.5*(ta+tb);
            float fm=sampleF(ro+rd*tm);
            if(prev*fm<=0.0){ tb=tm; } else { ta=tm; prev=fm; }
          }
          tHit = 0.5*(ta+tb);
          pHit = ro + rd*tHit;
          break;
        }
        prev = cur;
      }
      if(tHit < 0.0) discard;
      vec3 nrm = normalAt(pHit);
      // two-sided lambert + key light, matching the mesh shaders' look
      vec3 L = normalize(vec3(0.4,0.9,0.5));
      float diff = 0.5 + 0.5*abs(dot(nrm, L));
      gl_FragColor = vec4(uColor*diff, 1.0);
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
  };
  return [mesh];
}

export { buildImplicitRaymarch };
