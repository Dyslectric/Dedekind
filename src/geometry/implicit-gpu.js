import { exprToGLSL } from "./glsl.js";

// ── GPU-accelerated field evaluation for marching squares / cubes ─────────────
// Replaces the CPU double/triple mathjs.evaluate() loops with a WebGL2 fragment
// shader pass + readPixels. The topology passes (case-table walks) stay on CPU
// since they're already fast — only field sampling is the bottleneck.
//
// Strategy: render F(vars) into an R32F texture via a full-screen triangle, then
// readPixels the float values back as a Float32Array. For 3D fields we render
// one z-slice per draw call into successive row-blocks of a 2D atlas texture,
// then do a single readPixels of the whole atlas at the end.
//
// Falls back gracefully (returns null) when:
//   - WebGL2 / EXT_color_buffer_float not available
//   - exprToGLSL can't transpile the expression (user functions, conditionals)
//   - Any WebGL error during setup

// ── Shared WebGL helpers ──────────────────────────────────────────────────────

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function linkProgram(gl, vertSrc, fragSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) { gl.deleteShader(vs); gl.deleteShader(fs); return null; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl.deleteProgram(prog); return null; }
  return prog;
}

// Full-screen triangle: 3 hard-coded vertices via gl_VertexID, no VBO needed.
const VERT_SRC = `#version 300 es
void main() {
  vec2 pos = vec2((gl_VertexID == 1) ? 3.0 : -1.0,
                  (gl_VertexID == 2) ? 3.0 : -1.0);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

// Check WebGL2 + float render target support.
function checkCapabilities(gl) {
  if (!gl) return false;
  if (typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) return false;
  if (!gl.getExtension("EXT_color_buffer_float")) return false;
  return true;
}

// Coordinate formula: FragCoord for pixel i (0-indexed) is i+0.5.
// We want pixel 0 → axisMin, pixel N → axisMax.
// So: axis = axisMin + (FragCoord - 0.5) * (axisMax - axisMin) / N
// where N = textureSize - 1.

// ── 2D field evaluation ───────────────────────────────────────────────────────
// Evaluates F = lhs-rhs on an (N+1)×(N+1) grid via a single fragment shader pass.
// Returns Float32Array of length (N+1)² in row-major order [j*(N+1)+i], or null.
// WebGL readPixels writes row 0 first (= bottom of framebuffer = j=0 = bMin),
// matching the CPU grid layout: grid[j*(nA+1)+i].
function evalFieldGPU2D(gl, fExpr, varA, varB, scope, aMin, aMax, bMin, bMax, N) {
  if (!checkCapabilities(gl)) return null;

  const uniforms = new Set();
  const axisVars = new Set([varA, varB]);
  const glslF = exprToGLSL(fExpr, axisVars, uniforms);
  if (!glslF) return null;

  const freeUniforms = [...uniforms].filter(n => !axisVars.has(n));
  const uniDecls = freeUniforms.map(n => `uniform highp float ${n};`).join("\n");

  const fragSrc = `#version 300 es
precision highp float;
uniform highp float u_aMin, u_aRange, u_bMin, u_bRange, u_N;
${uniDecls}
out highp float outVal;
void main() {
  float ${varA} = u_aMin + (gl_FragCoord.x - 0.5) * u_aRange / u_N;
  float ${varB} = u_bMin + (gl_FragCoord.y - 0.5) * u_bRange / u_N;
  outVal = ${glslF};
}`;

  const prog = linkProgram(gl, VERT_SRC, fragSrc);
  if (!prog) return null;

  const W = N + 1, H = N + 1;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, H, 0, gl.RED, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); gl.deleteProgram(prog);
    return null;
  }

  gl.useProgram(prog);
  gl.viewport(0, 0, W, H);

  gl.uniform1f(gl.getUniformLocation(prog, "u_aMin"), aMin);
  gl.uniform1f(gl.getUniformLocation(prog, "u_aRange"), aMax - aMin);
  gl.uniform1f(gl.getUniformLocation(prog, "u_bMin"), bMin);
  gl.uniform1f(gl.getUniformLocation(prog, "u_bRange"), bMax - bMin);
  gl.uniform1f(gl.getUniformLocation(prog, "u_N"), N);

  for (const name of freeUniforms) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc !== null) {
      const v = scope[name];
      gl.uniform1f(loc, typeof v === "number" && isFinite(v) ? v : 0);
    }
  }

  gl.drawArrays(gl.TRIANGLES, 0, 3);

  const result = new Float32Array(W * H);
  gl.readPixels(0, 0, W, H, gl.RED, gl.FLOAT, result);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  gl.deleteProgram(prog);

  return result;
}

// ── 3D field evaluation ───────────────────────────────────────────────────────
// Evaluates F on an (N+1)³ grid by rendering (N+1) z-slice passes, each into
// an S×S viewport at vertical offset k*S within a 2D atlas of size S×(S*(N+1)).
// Single readPixels at the end.
//
// Returns Float32Array in layout F[(k*(N+1) + j)*(N+1) + i] — same index
// formula as marchingCubes uses: idx3(i,j,k) = (k*sy + j)*sx + i, where sx=sy=N+1.
// This matches because the atlas row for slice k, row j is at atlas row (k*(N+1)+j),
// which readPixels writes to atlas[(k*(N+1)+j)*(N+1)+i] — identical layout.
function evalFieldGPU3D(gl, fExpr, varA, varB, varC, scope, xMin, xMax, yMin, yMax, zMin, zMax, N) {
  if (!checkCapabilities(gl)) return null;

  const uniforms = new Set();
  const axisVars = new Set([varA, varB, varC]);
  const glslF = exprToGLSL(fExpr, axisVars, uniforms);
  if (!glslF) return null;

  const freeUniforms = [...uniforms].filter(n => !axisVars.has(n));
  const uniDecls = freeUniforms.map(n => `uniform highp float ${n};`).join("\n");

  const fragSrc = `#version 300 es
precision highp float;
uniform highp float u_aMin, u_aRange, u_bMin, u_bRange, u_z, u_N;
${uniDecls}
out highp float outVal;
void main() {
  float ${varA} = u_aMin + (gl_FragCoord.x - 0.5) * u_aRange / u_N;
  float ${varB} = u_bMin + (gl_FragCoord.y - 0.5) * u_bRange / u_N;
  float ${varC} = u_z;
  outVal = ${glslF};
}`;

  const prog = linkProgram(gl, VERT_SRC, fragSrc);
  if (!prog) return null;

  const S = N + 1;
  const atlasW = S, atlasH = S * S;

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, atlasW, atlasH, 0, gl.RED, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); gl.deleteProgram(prog);
    return null;
  }

  gl.useProgram(prog);

  const uAMin   = gl.getUniformLocation(prog, "u_aMin");
  const uARange = gl.getUniformLocation(prog, "u_aRange");
  const uBMin   = gl.getUniformLocation(prog, "u_bMin");
  const uBRange = gl.getUniformLocation(prog, "u_bRange");
  const uZ      = gl.getUniformLocation(prog, "u_z");
  const uN      = gl.getUniformLocation(prog, "u_N");

  gl.uniform1f(uAMin,   xMin);
  gl.uniform1f(uARange, xMax - xMin);
  gl.uniform1f(uBMin,   yMin);
  gl.uniform1f(uBRange, yMax - yMin);
  gl.uniform1f(uN,      N);

  for (const name of freeUniforms) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc !== null) {
      const v = scope[name];
      gl.uniform1f(loc, typeof v === "number" && isFinite(v) ? v : 0);
    }
  }

  const dz = (zMax - zMin) / N;
  for (let k = 0; k < S; k++) {
    gl.viewport(0, k * S, S, S);
    gl.uniform1f(uZ, zMin + k * dz);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const atlas = new Float32Array(atlasW * atlasH);
  gl.readPixels(0, 0, atlasW, atlasH, gl.RED, gl.FLOAT, atlas);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  gl.deleteProgram(prog);

  // Atlas layout: atlas[(k*S + j)*S + i] = F at grid point (i, j, k).
  // marchingCubes expects: F[idx3(i,j,k)] = F[(k*sy + j)*sx + i] with sx=sy=sz=S.
  // These are identical, so return the atlas directly.
  return atlas;
}

export { evalFieldGPU2D, evalFieldGPU3D };

