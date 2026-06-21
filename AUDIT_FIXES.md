# Audit fixes applied

Git history on top of the pre-audit baseline (`f1a8cee`). Each commit was built
green and verified with a source-level test; rendering itself is unverifiable
headless, so shader-path changes are reasoned + tested structurally, not eyeballed.

## Tier 1 — correctness / high-impact
1. **Remove dead compute worker** (`c12fc79`) — was init'd but never called; it
   double-bundled mathjs. Removed the 631KB/182KBgz worker chunk.
2. **Memoize symbolic derivatives** (`e16c6c9`) — `differentiate`/`partial`
   re-derived + re-compiled per sample (~440x slow). Cached by (body,var);
   values exactly unchanged; 2000-sample loop 5466ms→110ms.
3. **Comma-split bug class** (`7988f7f`) — naive `split(",")` shredded
   `hypot(a,b)` coords, dropping points and stale-caching rawGeom. One shared
   `splitTopLevel()` used at every coordinate site.
4. **Scope tutorial** (`14af86f`) — `tut-named-scope` taught a nonexistent
   "global by name" model; rewritten to the real attachment-based rule.

## Tier 2 — high value
5. **Namespace user GLSL uniforms** (`038f0c7`) — `usr_` prefix retires the
   shader name-collision class (slider named `a`/`e`/`f`/`h`/`P` vs shader
   locals); generalizes the one-off conic fix. Threaded through every shader
   builder + live-uniform path.
6. **fnDef inlining capability** (`2e53cd4`) — `exprToGLSL` can inline user
   functions so composed surfaces could ride the GPU. Numerically verified
   (err<1e-12), recursion-guarded. **Dormant**: not wired into live dispatch,
   because flipping composed surfaces onto an unverifiable GPU shader needs a
   human eye. Default path unchanged.

## Tier 3 — polish / perf / hygiene
7. **makeNode color burn** (`5e017e8`) — built the full defs literal per call,
   burning ~14 palette colors; now stride-1, non-colored types consume none.
8. **RawGeomEditor recompute** (`2c24580`) — re-sampled full geometry every
   render for a count label; memoized.
9. **NodeCanvas tick** (`5e44b34`) — 60Hz full re-render during animation →
   throttled to ~10Hz.
10. **WebGL disposal** (`cf38a8a`) — dispose scene geometries/materials +
    forceContextLoss on unmount to avoid context-cap exhaustion.
11. **Cleanup** (`01418d0`) — deleted dead render2d.js + primitives.jsx.bak +
    dead _nodeTextCache; reconciled DEFAULT_GEOM_COLOR with newer plot types.

## Deliberately NOT done (risk > value for unattended/headless work)
- **Wiring fnDef inlining into live GPU dispatch** (see #6): needs the
  transpilability probes + cache signatures to become fnDef-aware AND visual
  confirmation of the resulting shaders.
- **SEO / code-split / lean-mathjs** (audit §1): build-config + app-architecture
  changes better validated with a browser and Lighthouse.
- **Two-equation intersection curves** (audit §4.1): a new feature, not a fix.
- **Highlighter function-set reconciliation**: the mismatch (`ln`/`fract` etc.)
  is cosmetic and some flagged names DO work in the GLSL path, so pruning them
  risks being wrong.
- **Serialized schema version field**: the codec already carries a `~1~` format
  tag and the decode path fails safe (try/catch→null); wrapping the node payload
  to add a second version axis would break every existing saved link for little
  gain.

All 108 tutorial plots build, 0 broken. Consolidated regression: 11/11 pass.
