import * as THREE from "three";

// ── THREE helpers ────────────────────────────────────────────────────────────
function disposeObjs(scene,objs){for(const o of objs){scene.remove(o);if(o.geometry)o.geometry.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else if(o.material)o.material.dispose();}}
function hexToThree(hex){return parseInt((hex||"#4f8ef7").replace("#",""),16);}

// Build a ShaderMaterial that displaces a grid in the vertex shader. `body`
// computes vec3 P (world-space x,y,z in math coords). uniforms are wired live.
function makeSurfaceShader(body, uniformNames, scope, color, wireframe){
  const uniforms = { uColor:{value:new THREE.Color(hexToThree(color))} };
  for(const u of uniformNames) uniforms[u] = { value: Number(scope[u]) || 0 };
  const decls = uniformNames.map(u=>`uniform float ${u};`).join("\n");
  // Map math (x,y,z) → three (x,z,y) to match the rest of the app's convention.
  const vert = `
    ${decls}
    varying vec3 vNormalW; varying float vOk;
    vec3 mathPos(vec2 d){ float x=d.x; float y=d.y; ${body} return vec3(P.x, P.z, P.y); }
    void main(){
      vec2 d = position.xy;
      vec3 p = mathPos(d);
      // finite-difference normal for shading
      float e = 0.01;
      vec3 pu = mathPos(d+vec2(e,0.0));
      vec3 pv = mathPos(d+vec2(0.0,e));
      vec3 nrm = normalize(cross(pu-p, pv-p));
      vOk = (abs(p.x)<1e6 && abs(p.y)<1e6 && abs(p.z)<1e6) ? 1.0 : 0.0;
      vNormalW = nrm;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
    }`;
  const frag = `
    precision highp float;
    uniform vec3 uColor; varying vec3 vNormalW; varying float vOk;
    void main(){
      if(vOk<0.5) discard;
      vec3 L = normalize(vec3(0.4,0.9,0.5));
      float diff = 0.55 + 0.45*abs(dot(normalize(vNormalW), L));
      gl_FragColor = vec4(uColor*diff, ${wireframe?"0.9":"0.82"});
    }`;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader:vert, fragmentShader:frag,
    side:THREE.DoubleSide, transparent:true, wireframe:!!wireframe });
  mat._uniformNames = uniformNames;
  return mat;
}


// Update live uniforms on a GPU object set from the current scope.
function updateGpuUniforms(objs, scope){
  for(const o of objs){
    const info=o._gpuSurface; if(!info) continue;
    const mat=o.material; if(!mat||!mat.uniforms) continue;
    for(const u of info.uNames){ if(mat.uniforms[u]) mat.uniforms[u].value = Number(scope[u])||0; }
  }
}

export {
  disposeObjs, hexToThree, makeSurfaceShader, updateGpuUniforms
};
