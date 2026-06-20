---
title: Architecture
order: 12
group: Reference
---

# Architecture

Dedekind is a client-only React app over three.js and mathjs, built with Vite. There is no backend; everything runs in the browser, and the only persistence is the URL.

## One-way dependencies

UI imports logic, never the reverse. The `core/` and `geometry/` layers are React-free and independently testable; the React components in `components/` consume them. This is what makes the logic verifiable without a DOM.

## The node model

A node's `attachments` are its upstream dependencies. Scalars attach to the functions/plots/cameras that use them; plots attach to cameras. Scope is resolved per-consumer (a node sees only what's directly attached to it), with named scalars additionally folded into a global scope so an expression can reference a slider by name without an explicit wire.

## Unified plot kinds

Authoring uses a small set of consolidated kinds that normalize down to the rendering vocabulary at build time:

- `fnMap` is a pure map ℝᵐ → ℝⁿ; it feeds a `transformer` that renders it as a graph or a field.
- `equation` is an implicit relation, rendered by the GPU raymarcher (3D) or marching squares (2D), with a marching-cubes fallback.
- `paramSpace` is a parametric curve (degree 1) or surface (degree 2).
- `points` covers points, glyphs, and sequences.

`nodes/normalize.js` maps the granular kinds to legacy geometry types; legacy projects migrate automatically.

## Rendering and the cache

Each plot has a **signature** folding in its expressions, domain, resolution, and the values of scalars it depends on. The scene rebuild reuses cached geometry when the signature is unchanged and rebuilds when it changes.

The signature is computed so that GPU-uniform values are *excluded* (they animate without rebuilds) while baked-in values are *included* (an animated change rebuilds). A transpile check decides which path a surface takes: if its expression compiles to GLSL, it's GPU-evaluated and its parameters and domain bounds are uniforms; otherwise it's a CPU mesh and those values are part of the signature.

## GPU evaluation

`geometry/glsl.js` transpiles mathjs expressions to GLSL. Surfaces are evaluated in a vertex shader (a unit grid displaced to the domain); implicit surfaces are ray-marched in a fragment shader. Sliders and animators become live uniforms, refreshed each frame by `updateGpuUniforms` without touching geometry. Domain bounds are vec2 uniforms re-resolved from their expressions per frame.

## Coordinates

The renderer maps math `(x, y, z)` to three.js `(x, z, y)`, so math-Z is vertical. Graph transformers default their scalar output to Z.

## Project layout

```text
src/
  App.jsx                 Top-level routing (landing / editor / share), demo route
  core/                   Pure logic, no React, no DOM
    math.js               Expression compile/eval cache, resolveNum, makeFn
    taxonomy.js           Node categories + attachment rules
    scope.js              Per-consumer scope resolution + geometry signatures
    graph.js              Selection traversal, clipboard payload + import
    serialize.js          Project (de)serialization, share encoding, migration
    worker.js             Web Worker (RK4 flow offload)
  geometry/               three.js geometry generation, no React
    glsl.js               mathjs → GLSL transpiler
    builders.js           CPU + GPU builders (surfaces, curves, quivers, glyphs, point clouds)
    implicit-raymarch.js  GPU raymarcher for implicit surfaces (singularities, seams, coloring)
    transformer.js        Renders an fnMap/equation over a domain
    flow.js               Flow integration, stream surfaces and volumes
    three-helpers.js      Shader material, uniform updates, dispose/color helpers
    rebuild.js            Scene rebuild + per-plot signature cache
  render2d/               2D canvas renderer
  theme/                  UI palette tokens and presets
  nodes/                  Node model, normalization, addable kinds
  hooks/                  Animator RAF loop, undo/redo history
  landing/                Landing page + live preview scenes (and the demo registry)
  components/             React UI: node canvas, properties panel, viewports, math input
```

## Tech

React · three.js · mathjs · Vite. No backend; everything is client-side.
