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
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
  if (maxTex && (W > maxTex || H > maxTex)) return null;
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
// Evaluates F on an (N+1)³ grid by rendering one z-slice (S×S, S=N+1) per draw
// call into a 2D-tiled float atlas, then reading the whole atlas back once and
// de-tiling into the linear layout marchingCubes expects: F[(k*S + j)*S + i],
// i.e. idx3(i,j,k) = (k*sy + j)*sx + i with sx=sy=sz=S. Slices are tiled in a
// near-square grid (cols×rows of S×S tiles) rather than one tall column so the
// atlas stays within MAX_TEXTURE_SIZE even at high resolution. Returns null
// (→ CPU fallback) on any capability/transpile/size failure.
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
  // Tile the S z-slices into a near-square grid of S×S tiles instead of stacking
  // them in one tall column. A single column needs height S² (e.g. 65²=4225),
  // which exceeds the common 4096 MAX_TEXTURE_SIZE and makes the read fail. A
  // grid of cols×rows tiles keeps both atlas dimensions ≈ S·√S, well within range.
  const tilesPerRow = Math.max(1, Math.floor(Math.sqrt(S)));
  const tileRows = Math.ceil(S / tilesPerRow);
  const atlasW = tilesPerRow * S, atlasH = tileRows * S;

  // R32F atlas must fit the driver's texture limit; an oversized request would
  // give an incomplete framebuffer (and a silently wrong/empty read). Bail to CPU.
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
  if (maxTex && (atlasW > maxTex || atlasH > maxTex)) return null;

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
    const tx = (k % tilesPerRow) * S;       // tile origin x
    const ty = Math.floor(k / tilesPerRow) * S; // tile origin y
    gl.viewport(tx, ty, S, S);
    gl.uniform1f(uZ, zMin + k * dz);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const atlas = new Float32Array(atlasW * atlasH);
  gl.readPixels(0, 0, atlasW, atlasH, gl.RED, gl.FLOAT, atlas);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  gl.deleteProgram(prog);

  // De-tile the atlas into the linear layout marchingCubes expects:
  // F[(k*S + j)*S + i]. Atlas pixel for slice k, cell (i,j) sits at
  // ( tileCol*S + i, tileRow*S + j ) where tileCol=k%tilesPerRow, tileRow=k/…
  const F = new Float32Array(S * S * S);
  for (let k = 0; k < S; k++) {
    const tx = (k % tilesPerRow) * S;
    const ty = Math.floor(k / tilesPerRow) * S;
    for (let j = 0; j < S; j++) {
      const atlasRow = (ty + j) * atlasW + tx;
      const outRow = (k * S + j) * S;
      for (let i = 0; i < S; i++) F[outRow + i] = atlas[atlasRow + i];
    }
  }
  return F;
}

export { evalFieldGPU2D, evalFieldGPU3D, getSharedGL };

// ── Shared offscreen WebGL2 context ───────────────────────────────────────────
// Marching squares/cubes are pure compute (no on-screen output), so they evaluate
// their scalar field into an offscreen float framebuffer. One context is created
// lazily and reused across all calls; if WebGL2 + float-render isn't available the
// helpers fall back to CPU. Kept tiny (1×1 canvas) since the real work happens in
// off-screen textures sized per call.
let _sharedGL = null, _sharedTried = false;
function getSharedGL() {
  if (_sharedTried) return _sharedGL;
  _sharedTried = true;
  try {
    const cv = (typeof OffscreenCanvas !== "undefined")
      ? new OffscreenCanvas(1, 1)
      : (typeof document !== "undefined" ? document.createElement("canvas") : null);
    if (!cv) return (_sharedGL = null);
    const gl = cv.getContext("webgl2", { antialias:false, depth:false, stencil:false, preserveDrawingBuffer:false });
    if (!checkCapabilities(gl)) return (_sharedGL = null);
    // Self-test: evaluate a known field on a small grid and confirm the readback
    // matches the analytic value at the far corner. Some drivers report float-render
    // capability but return wrong/empty data from an R32F readPixels; if so we
    // permanently disable the GPU path so marching falls back to the (correct) CPU
    // sampler instead of silently dropping surfaces. The 3D probe uses N=8 (S=9 →
    // tilesPerRow=3) so the multi-column atlas tiling/de-tiling is actually tested,
    // not just the degenerate single-tile case.
    const probe2d = evalFieldGPU2D(gl, "x + y", "x", "y", {}, 0, 1, 0, 1, 4);
    const probe3d = evalFieldGPU3D(gl, "x + 2*y + 4*z", "x", "y", "z", {}, 0, 1, 0, 1, 0, 1, 8);
    // 2D corner (1,1) → 2 ; 3D corner (1,1,1) → 1+2+4 = 7
    const ok2 = probe2d && Math.abs(probe2d[probe2d.length-1] - 2) < 1e-3;
    const ok3 = probe3d && Math.abs(probe3d[probe3d.length-1] - 7) < 1e-3;
    _sharedGL = (ok2 && ok3) ? gl : null;
  } catch { _sharedGL = null; }
  return _sharedGL;
}

