import * as THREE from "three";
import { resolveNum } from "../core/math.js";
import { augmentScopeForGPU } from "./glsl.js";

// ── THREE helpers ────────────────────────────────────────────────────────────
function disposeObjs(scene,objs){for(const o of objs){ (o.parent||scene).remove(o); if(o.geometry&&!o._sharedGeometry)o.geometry.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else if(o.material)o.material.dispose();}}
// Add a freshly built plot object to the correct parent. Most geometry lives in
// the mirrored `world` group (scale.z = -1) that lands the on-screen frame.
// Screen-space fat-line curves (tagged `_unmirroredWorld`) break under that
// negative-determinant matrix, so they go to an unmirrored sibling group
// (world._unmirrored) and carry their own baked-in world coords.
function addPlotObj(world,o){ (o._unmirroredWorld && world._unmirrored ? world._unmirrored : world).add(o); }
function hexToThree(hex){return parseInt((hex||"#4f8ef7").replace("#",""),16);}

// Build a ShaderMaterial that displaces a grid in the vertex shader. `body`
// computes vec3 P (world-space x,y,z in math coords). uniforms are wired live.
//
// opts.colorBody : optional GLSL that, given the same x/y (and any uniforms),
//   computes `float cval` — a per-vertex scalar mapped through a lo→hi ramp over
//   [cmin,cmax]. When present the fill pass is gradient-colored instead of using
//   the flat uColor. opts.colorLo/colorHi are THREE.Color; cmin/cmax are numbers.
function makeSurfaceShader(body, uniformNames, scope, color, wireframe, opts, domain, uPrefix=""){
  const colored = !!(opts && opts.colorBody);
  // Opt-in per-fragment lighting (Blinn-Phong) with an analytic or screen-space
  // normal. `opts.shade` is the lit-mode descriptor; when absent the shader is
  // byte-identical to before (no regression). Never lit for the wireframe pass.
  const shade = (!wireframe && opts && opts.shade) ? opts.shade : null;
  const lit = !!shade;
  const uniforms = { uColor:{value:new THREE.Color(hexToThree(color))} };
  // User scalar uniforms are declared/keyed as prefix+name (the body references
  // them prefixed) but their values come from scope[name].
  for(const u of uniformNames) uniforms[uPrefix+u] = { value: Number(scope[u]) || 0 };
  // Domain bounds as uniforms (uDomU = [min,max] for the first param, uDomV for
  // the second). When the body references them, animating a bound is a uniform
  // write — no shader rebuild. Default to the unit range if not supplied.
  const hasDomain = !!domain;
  if(hasDomain){
    uniforms.uDomU = { value: new THREE.Vector2(domain.uDomU[0], domain.uDomU[1]) };
    uniforms.uDomV = { value: new THREE.Vector2(domain.uDomV[0], domain.uDomV[1]) };
  }
  if(colored){
    uniforms.uColorLo = { value: opts.colorLo.clone() };
    uniforms.uColorHi = { value: opts.colorHi.clone() };
    uniforms.uCMin = { value: Number(opts.cmin)||0 };
    uniforms.uCMax = { value: Number(opts.cmax)||1 };
  }
  if(lit){
    // uNormalMat is the object→view normal matrix; it's refreshed per frame from
    // the mesh in assembleSurfGPU's onBeforeRender (three doesn't expose
    // normalMatrix to the fragment stage, and computing it ourselves keeps the
    // mirror group's negative scale handled correctly). Light is a fixed key light
    // for now (Stage 6 will surface these as node props).
    uniforms.uNormalMat = { value: new THREE.Matrix3() };
    uniforms.uLightDir  = { value: new THREE.Vector3(0.4,0.9,0.5).normalize() };
    uniforms.uAmb   = { value: shade.ambient  ?? 0.18 };
    uniforms.uDif   = { value: shade.diffuse  ?? 0.85 };
    uniforms.uSpe   = { value: shade.specular ?? 0.35 };
    uniforms.uShine = { value: shade.shininess ?? 32.0 };
    if(shade.emitExpr) uniforms.uEmitColor = { value: new THREE.Color(hexToThree(shade.emitColor||"#ffffff")) };
    if(shade.texture) uniforms.uTex = { value: shade.texture };
    if(shade.normalTex){
      uniforms.uNormalTex = { value: shade.normalTex };
      uniforms.uNormalStrength = { value: shade.normalStrength ?? 1.0 };
    }
    if(shade.texture || shade.normalTex){     // UV transform shared by albedo + normal sampling
      const uv = shade.uv || {};
      uniforms.uUvScale  = { value: new THREE.Vector2(uv.scaleU ?? 1, uv.scaleV ?? 1) };
      uniforms.uUvOffset = { value: new THREE.Vector2(uv.offU ?? 0, uv.offV ?? 0) };
      uniforms.uUvRot    = { value: uv.rot ?? 0 };
    }
  }
  const domainDecls = hasDomain ? "uniform vec2 uDomU; uniform vec2 uDomV;" : "";
  const decls = domainDecls + "\n" + uniformNames.map(u=>`uniform float ${uPrefix}${u};`).join("\n");
  // Map math (x,y,z) → three (x,z,y) to match the rest of the app's convention.
  // The wireframe overlay is flat-shaded (no lighting), so it skips the two extra
  // mathPos() evaluations the fill pass needs for finite-difference normals —
  // cutting the wireframe vertex cost to ~1/3. Only the fill pass shades.
  // When colored, the fill vertex shader also computes a per-vertex scalar (vCval)
  // from the same grid coords, varied to the fragment shader for the ramp.
  const colorVaryV = colored ? "varying float vCval;" : "";
  // The color value expression references the DOMAIN x,y (and substituted output
  // expressions), not the raw [0,1] grid coords — so we run the same coordinate
  // mapping (`body` sets x,y) before evaluating it. mathColor mirrors mathPos's
  // coordinate setup and returns the scalar.
  // NOTE: the sampling parameter is named `_gd` (grid-domain), NOT `d`. A user
  // scalar can legitimately be named `d` (e.g. the ripple's decay slider →
  // uniform float d). If the function parameter were also `d`, that uniform would
  // be shadowed inside mathPos/mathColor, so `exp(-d*r)` would multiply by the
  // [0,1] grid vector instead of the decay scalar — silently corrupting the
  // surface (asymmetric taper along x) and, in the colored 2-output case, turning
  // the fill expression into a type error that fails to link (only the wireframe,
  // which has no color body, then renders). A `_`-prefixed name can't collide
  // with any user symbol.
  const colorFn = colored
    ? `float mathColor(vec2 _gd){ float x=_gd.x; float y=_gd.y; ${body} return (${opts.colorBody}); }`
    : "";
  const colorCompute = colored ? "vCval = mathColor(_gd);" : "";
  const vert = wireframe ? `
    ${decls}
    varying float vOk;
    vec3 mathPos(vec2 _gd){ float x=_gd.x; float y=_gd.y; ${body} return vec3(P.x, P.z, P.y); }
    void main(){
      vec3 p = mathPos(position.xy);
      vOk = (abs(p.x)<1e6 && abs(p.y)<1e6 && abs(p.z)<1e6) ? 1.0 : 0.0;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
    }` : `
    ${decls}
    varying vec3 vNormalW; varying float vOk; ${colorVaryV}
    vec3 mathPos(vec2 _gd){ float x=_gd.x; float y=_gd.y; ${body} return vec3(P.x, P.z, P.y); }
    ${colorFn}
    void main(){
      vec2 _gd = position.xy;
      vec3 p = mathPos(_gd);
      // finite-difference normal for shading (epsilon named _fdE so a user
      // scalar named e is never shadowed here)
      float _fdE = 0.01;
      vec3 pu = mathPos(_gd+vec2(_fdE,0.0));
      vec3 pv = mathPos(_gd+vec2(0.0,_fdE));
      vec3 nrm = normalize(cross(pu-p, pv-p));
      vOk = (abs(p.x)<1e6 && abs(p.y)<1e6 && abs(p.z)<1e6) ? 1.0 : 0.0;
      vNormalW = nrm;
      ${colorCompute}
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
    }`;
  const frag = wireframe ? `
    precision highp float;
    uniform vec3 uColor; varying float vOk;
    void main(){
      if(vOk<0.5) discard;
      gl_FragColor = vec4(uColor, 0.9);
    }` : (colored ? `
    precision highp float;
    uniform vec3 uColor; uniform vec3 uColorLo; uniform vec3 uColorHi;
    uniform float uCMin; uniform float uCMax;
    varying vec3 vNormalW; varying float vOk; varying float vCval;
    void main(){
      if(vOk<0.5) discard;
      vec3 L = normalize(vec3(0.4,0.9,0.5));
      float diff = 0.55 + 0.45*abs(dot(normalize(vNormalW), L));
      float span = (uCMax - uCMin);
      float t = (abs(span) < 1e-12) ? 0.0 : clamp((vCval - uCMin)/span, 0.0, 1.0);
      vec3 cc = mix(uColorLo, uColorHi, t);
      gl_FragColor = vec4(cc*diff, 0.82);
    }` : `
    precision highp float;
    uniform vec3 uColor; varying vec3 vNormalW; varying float vOk;
    void main(){
      if(vOk<0.5) discard;
      vec3 L = normalize(vec3(0.4,0.9,0.5));
      float diff = 0.55 + 0.45*abs(dot(normalize(vNormalW), L));
      gl_FragColor = vec4(uColor*diff, 0.82);
    }`);
  // ── Opt-in lit path: per-fragment Blinn-Phong with analytic-or-screen-space
  // normal, computed in VIEW space (so three's matrices handle the mirror group).
  // Stage 3 material channels (all per fragment, all optional): a color
  // expression ramped through uColorLo→uColorHi (opts.colorBody, evaluated at the
  // fragment's domain (x,y) so the pattern is crisp, not vertex-interpolated), a
  // specular-intensity multiplier (shade.specExpr), and an additive emission
  // (shade.emitExpr × uEmitColor). They read the domain varying + any wired
  // scalars/animators (an animator named t is just a live usr_t uniform).
  let litVert = null, litFrag = null;
  if(lit){
    const analytic = !!(shade.fx && shade.fy);   // both derivatives transpiled
    const specExpr = shade.specExpr || null;
    const emitExpr = shade.emitExpr || null;
    const rgb = (shade.rgb && shade.rgb.length===3) ? shade.rgb : null;   // [r,g,b] GLSL → albedo
    const texAlb = !!shade.texture;                                       // sample uTex at vUv → albedo
    const normalMap = !!shade.normalTex;                                  // perturb N from a normal texture
    const uvAny = texAlb || normalMap;
    const needXY = analytic || colored || !!rgb || !!specExpr || !!emitExpr;
    litVert = `
      ${decls}
      varying vec3 vViewPos; varying vec2 vDomain; varying vec2 vUv; varying float vOk;
      void main(){
        vec2 _gd = position.xy;
        vUv = _gd;                          // the unit grid coord IS the surface's UV
        float x=_gd.x; float y=_gd.y; ${body}
        vec3 p = vec3(P.x, P.z, P.y);
        vDomain = vec2(x,y);
        vOk = (abs(p.x)<1e6 && abs(p.y)<1e6 && abs(p.z)<1e6) ? 1.0 : 0.0;
        vec4 _vp = modelViewMatrix * vec4(p,1.0);
        vViewPos = _vp.xyz;
        gl_Position = projectionMatrix * _vp;
      }`;
    litFrag = `
      precision highp float;
      ${decls}
      uniform mat3 uNormalMat;
      uniform vec3 uColor; uniform vec3 uLightDir;
      uniform float uAmb; uniform float uDif; uniform float uSpe; uniform float uShine;
      ${colored ? "uniform vec3 uColorLo; uniform vec3 uColorHi; uniform float uCMin; uniform float uCMax;" : ""}
      ${emitExpr ? "uniform vec3 uEmitColor;" : ""}
      ${texAlb ? "uniform sampler2D uTex;" : ""}
      ${normalMap ? "uniform sampler2D uNormalTex; uniform float uNormalStrength;" : ""}
      ${uvAny ? "uniform vec2 uUvScale; uniform vec2 uUvOffset; uniform float uUvRot;" : ""}
      varying vec3 vViewPos; varying vec2 vDomain; varying vec2 vUv; varying float vOk;
      void main(){
        if(vOk<0.5) discard;
        ${needXY ? "float x=vDomain.x; float y=vDomain.y;" : ""}
        vec3 N;
        ${analytic ? `
        float fx = ${shade.fx};
        float fy = ${shade.fy};
        // math-space height-field normal (-f_x,-f_y,1) → three (x,z,y) → view via uNormalMat
        vec3 Nthree = vec3(-fx, 1.0, -fy);
        N = normalize(uNormalMat * Nthree);
        ` : `
        N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
        `}
        ${uvAny ? "vec2 _uv=vUv-0.5; float _cr=cos(uUvRot),_sr=sin(uUvRot); _uv=mat2(_cr,_sr,-_sr,_cr)*_uv; _uv=_uv*uUvScale+0.5+uUvOffset;" : ""}
        ${normalMap ? `
        // tangent-space normal map → perturb N, with a screen-space cotangent
        // frame (no precomputed tangents needed; works on any surface).
        vec3 _nm = texture2D(uNormalTex, _uv).xyz*2.0 - 1.0; _nm.xy *= uNormalStrength;
        vec3 _dp1=dFdx(vViewPos), _dp2=dFdy(vViewPos); vec2 _du1=dFdx(_uv), _du2=dFdy(_uv);
        vec3 _dp2p=cross(_dp2,N), _dp1p=cross(N,_dp1);
        vec3 _T=_dp2p*_du1.x+_dp1p*_du2.x; vec3 _Bt=_dp2p*_du1.y+_dp1p*_du2.y;
        float _im=inversesqrt(max(dot(_T,_T),dot(_Bt,_Bt)));
        N = normalize(mat3(_T*_im,_Bt*_im,N)*_nm);
        ` : ""}
        vec3 V = normalize(-vViewPos);
        if(dot(N,V) < 0.0) N = -N;                 // face the camera (DoubleSide)
        vec3 L = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
        float dif = max(dot(N,L), 0.0);
        vec3 H = normalize(L + V);
        float spe = pow(max(dot(N,H), 0.0), uShine);
        float specMul = ${specExpr ? `max(0.0, ${specExpr})` : "1.0"};
        ${texAlb
          ? `vec3 albedo = texture2D(uTex, _uv).rgb;`
          : rgb
          ? `vec3 albedo = clamp(vec3((${rgb[0]}),(${rgb[1]}),(${rgb[2]})), 0.0, 1.0);`
          : colored
          ? `float _cv = (${opts.colorBody}); float _sp=(uCMax-uCMin); float _t=(abs(_sp)<1e-12)?0.0:clamp((_cv-uCMin)/_sp,0.0,1.0); vec3 albedo=mix(uColorLo,uColorHi,_t);`
          : "vec3 albedo = uColor;"}
        vec3 col = uAmb*albedo + uDif*dif*albedo + uSpe*specMul*spe*vec3(1.0);
        ${emitExpr ? `col += clamp(${emitExpr}, 0.0, 8.0) * uEmitColor;` : ""}
        col = pow(clamp(col,0.0,1.0), vec3(1.0/2.2));
        gl_FragColor = vec4(col, 0.92);
      }`;
  }

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: lit ? litVert : vert,
    fragmentShader: lit ? litFrag : frag,
    side:THREE.DoubleSide, transparent:true, wireframe:!!wireframe });
  // The screen-space-derivative fallback (dFdx/dFdy) needs the derivatives
  // extension on WebGL1; harmless/ignored on WebGL2 where they're core.
  if(lit) mat.extensions = { derivatives: true };
  mat._uniformNames = uniformNames;
  mat._uPrefix = uPrefix;
  mat._lit = lit;   // assembleSurfGPU keys the per-frame normal-matrix update on this
  return mat;
}


// Update live uniforms on a GPU object set from the current scope. This covers
// (a) expression sliders/animators (info.uNames → float uniforms) and (b) domain
// bounds (info.domain → uDomU/uDomV vec2s), re-resolving the bound expressions so
// an animator wired into a domain edge sweeps the surface with no rebuild.
function updateGpuUniforms(objs, scope){
  // Composed surfaces inline user fnDefs; scalars inside those fnDef bodies became
  // uniforms by name but live in the fnDef's own scope, so resolve against the
  // augmented scope (a no-op for ordinary surfaces — returns the same object).
  const sc=augmentScopeForGPU(scope);
  for(const o of objs){
    const info=o._gpuSurface; if(!info) continue;
    const mat=o.material; if(!mat||!mat.uniforms) continue;
    // User scalar uniforms may be namespaced (info.uPrefix) so their names can't
    // collide with shader internals. The scope is keyed on the ORIGINAL name; the
    // shader uniform is keyed on prefix+name.
    const pfx=info.uPrefix||"";
    for(const u of info.uNames){ const k=pfx+u; if(mat.uniforms[k]) mat.uniforms[k].value = Number(sc[u])||0; }
    const dom=info.domain;
    if(dom && dom.expr && mat.uniforms.uDomU && mat.uniforms.uDomV){
      const d=dom.defs||{};
      const uMin=resolveNum(dom.expr.uMin,scope,d.uMin??0);
      const uMax=resolveNum(dom.expr.uMax,scope,d.uMax??1);
      const vMin=resolveNum(dom.expr.vMin,scope,d.vMin??0);
      const vMax=resolveNum(dom.expr.vMax,scope,d.vMax??1);
      mat.uniforms.uDomU.value.set(uMin,uMax);
      mat.uniforms.uDomV.value.set(vMin,vMax);
    }
  }
}

export {
  disposeObjs, addPlotObj, hexToThree, makeSurfaceShader, updateGpuUniforms
};
