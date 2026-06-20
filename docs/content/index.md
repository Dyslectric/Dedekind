---
title: Overview
order: 1
group: Start
---

<div class="hero">
<div class="eyebrow">Documentation</div>

# Dedekind

<p class="lede">A node-graph editor for visualizing math in 2D and 3D. Wire scalars into functions, transform them into geometry, and point a camera at the result. It runs entirely in the browser, GPU-accelerated, and a whole project encodes into the page URL.</p>
</div>

Dedekind is built around one idea: **a function is separate from how you draw it.** You define a pure map (say `f(x, y) = sin(x)·cos(y)`) and then decide, independently, whether it becomes a surface, a heightfield, a vector field, or a colored point cloud. Change the function and every view that uses it updates live. Change the camera and nothing about the function moves.

That separation is what lets the same tool draw a parabola for a high-schooler and a Barth sextic for an algebraic geometer. The hard part is rendering implicit surfaces and algebraic varieties cleanly, singularities and all, and that happens on the GPU in real time as you edit the equation.

<div class="cards">
<a class="card" href="concepts.html">
  <div class="card-k">Start here</div>
  <div class="card-t">Core concepts</div>
  <div class="card-d">The node model: inputs, functions, transformers, cameras, and how scope flows.</div>
</a>
<a class="card" href="implicit-surfaces.html">
  <div class="card-k">The showcase</div>
  <div class="card-t">Implicit surfaces</div>
  <div class="card-d">Render F(x,y,z)=0 directly on the GPU, with clean singularities and meaningful coloring.</div>
</a>
<a class="card" href="expressions.html">
  <div class="card-k">Reference</div>
  <div class="card-t">The expression language</div>
  <div class="card-d">Functions, operators, big operators (∑ ∫ ∏), derivatives, and reserved variables.</div>
</a>
<a class="card" href="sharing.html">
  <div class="card-k">Try it</div>
  <div class="card-t">Demos &amp; sharing</div>
  <div class="card-d">Open a live demo from the URL, share a scene as a link, paste in ready-made surfaces.</div>
</a>
</div>

## What it does, in one minute

You build a scene by wiring nodes:

- **Inputs** are scalars: a constant, a slider, an animator, or an expression. They have names and feed into anything downstream.
- **Functions** are pure maps. An `fnMap` takes up to four inputs and produces up to four outputs. An `equation` is an implicit relation `lhs = rhs`.
- **Transformers** turn a function into geometry: a graph (assign inputs/outputs to spatial axes) or a field (an arrow per sample).
- **Manifolds and points** describe domains and discrete sets: parametric curves and surfaces, lattices, recurrences.
- **Flows** integrate a vector field from seed points into streamlines and stream surfaces.
- **Cameras** render what's wired into them, in 2D or 3D, dockable or floating.

Edit anything and the affected geometry rebuilds immediately; analytic expressions are transpiled to GLSL and evaluated on the GPU wherever possible, so animation and live editing stay smooth.

## Quick start

Requires Node.js 18+.

```bash
npm install
npm run dev      # start the dev server (Vite); open the URL it prints
npm run build    # production build → dist/
npm run preview  # preview the production build
```

The app opens on a landing page; click **Open the editor** to start. Or jump straight to a live showcase by opening the editor with `#demo` in the URL. See [Demos & sharing](sharing.html).

## A note on coordinates

The renderer maps math `(x, y, z)` onto three.js `(x, z, y)`, so **math-Z is the vertical (up) axis.** Graph transformers default their scalar output to Z, so `z = f(x, y)` rises vertically the way you'd expect on paper.
