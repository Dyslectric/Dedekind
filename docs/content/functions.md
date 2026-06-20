---
title: Functions & transformers
order: 4
group: Nodes
---

# Functions & transformers

A function describes a mapping; a transformer turns that mapping into geometry. Keeping them separate is what lets one function be drawn several ways.

## fnMap: a pure map

An `fnMap` is a map ℝᵐ → ℝⁿ with up to four inputs (`x, y, z, w`) and up to four outputs (`out0…out3`). You set the input and output dimensions, then write each output as an expression in the active inputs.

| Field | Meaning |
| --- | --- |
| inDim | number of inputs (1–4: `x, y, z, w`) |
| outDim | number of outputs (1–4) |
| out0…out3 | each output as an expression |

An `fnMap` draws nothing on its own. Wire it into a transformer.

## Transformer: how to draw it

A transformer reads a wired `fnMap` and renders it over a domain. It has two modes.

### Graph mode

Each input and output is assigned to a spatial axis (`X`, `Y`, `Z`, or *none*), or to *Color*. This produces the classic graphs:

- **1 input → a curve.** `y = f(x)` with the input on X and the output on Y.
- **2 inputs → a surface.** `z = f(x, y)` with inputs on X/Y and the output on Z (the default; Z is up).
- **3 inputs → a solid point cloud.** Three inputs placed in space, sampled over the domain box.

Bind any output to **Color** instead of an axis to drive a gradient: that output becomes a per-vertex scalar mapped across a two-color ramp (set its range in the *Color ramp* section).

### Field mode

The output vector is drawn as an **arrow at each sample point**, the generalized quiver. The options adapt to the output count: a 3-output map is a 3D vector field, while a 4-output map is a 3D field with the fourth output driving the arrow color.

### Domain

A transformer's domain is either:

- **inline**: a min/max box per input dimension (`aMin…dMax`) plus a resolution `res`, or
- **param**: sample points supplied by a wired `paramSpace`.

| Field | Meaning | Default |
| --- | --- | --- |
| mode | `graph` or `field` | `graph` |
| inAxis0–2 | where each input maps in space | `x`, `y`, `z` |
| outAxis0–3 | where each output maps (`x/y/z/color/none`) | `z`, `y`, … |
| domainSrc | `inline` or `param` | `inline` |
| aMin…dMax | inline domain box | `±5`, `±3` |
| res | samples per axis | `60` |
| colorLo / colorHi | gradient ramp endpoints | blue → pink |
| colorMin / colorMax | value range mapped onto the ramp | auto |

## Performance

When an `fnMap`'s output expressions transpile to GLSL, the surface is **evaluated on the GPU**: a unit grid is displaced in the vertex shader, with sliders and animators in the expressions becoming live uniforms. This is why animating an expression parameter is smooth: only a uniform changes, nothing rebuilds. Expressions that can't be transpiled (using functions GLSL doesn't support) fall back to a CPU-built mesh.

The **domain bounds are also GPU uniforms** for transpilable surfaces, so animating a domain edge (sweeping a surface open) runs at frame rate without rebuilding. See [Animation](animation.html).

## Convenience surface nodes

For the common cases there are direct nodes that skip the explicit `fnMap` + transformer wiring:

- **`z(x,y)` surface**: a heightfield `z = f(x, y)` over an x/y box.
- **`y(x)` curve**: a 1D function plot.
- **Parametric surface**: `(x(u,v), y(u,v), z(u,v))` over a `(u, v)` domain.

These are GPU-accelerated the same way and accept animated expressions and domain bounds.
