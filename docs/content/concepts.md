---
title: Core concepts
order: 2
group: Start
---

# Core concepts

Everything in Dedekind is a **node**, and nodes connect into a directed graph. Understanding five ideas (nodes, attachments, scope, the function/geometry split, and the rebuild cache) is enough to understand the whole tool.

## Nodes and attachments

A node's `attachments` are its **upstream dependencies**, the nodes it reads from. The direction is "consumer points at what it consumes":

- Scalars attach to the functions, plots, and cameras that use them.
- Functions attach to the transformers and flows that draw them.
- Plots attach to the cameras that show them.

You wire nodes by dragging from one node's port to another. A camera with a plot attached renders that plot; a transformer with an `fnMap` attached draws that map.

## Scope

**Scope is resolved per-consumer.** A node can only evaluate the scalars and functions that are *directly attached to it*, not variables reachable only transitively through another node. A plot attached to a function `f` sees `f`, but not the slider `a` that `f` internally depends on; `a` is visible only inside `f`'s own body.

There is one convenience exception: **named scalars** (sliders, constants, animators) are also folded into a global scope. So an expression field can reference a slider by name without an explicit wire and still update live. This is what lets a glyph field's arrow-length expression mention a slider `k` that isn't wired straight into it.

## Functions are separate from geometry

This is the central design choice. An `fnMap` is a **pure map** ℝᵐ → ℝⁿ, with up to four inputs (`x, y, z, w`) and four outputs. It has no shape of its own. You wire it into a **transformer**, which decides how to draw it:

- **Graph mode** assigns each input and output to a spatial axis. One input → a curve `y = f(x)`; two inputs → a surface `z = f(x, y)`; three inputs → a solid point cloud. Bind an output to *Color* to drive a gradient.
- **Field mode** draws the output vector as an arrow at each sample point, the generalized quiver.

The payoff: define `f` once, render it three different ways, and editing `f` updates all of them.

## Implicit relations

Alongside `fnMap`, an **equation** node expresses an implicit relation `lhs = rhs` in two or three variables. Wired into a transformer, a 2-variable equation becomes a curve and a 3-variable equation becomes a surface, the level set where `lhs − rhs = 0`. For 3D surfaces this is rendered by a dedicated GPU raymarcher; see [Implicit surfaces](implicit-surfaces.html).

## The rebuild cache

Every plot carries a **signature** derived from the things it depends on: its expressions, domain, resolution, and the values of the scalars it references. When anything affecting geometry changes, the signature changes and that plot rebuilds. When nothing relevant changes, the existing geometry is reused.

This matters for performance, and especially for animation. Where a value becomes a **live GPU uniform** (a slider inside a transpiled surface expression, or an animated domain bound on a GPU surface), changing it does *not* invalidate the cache. The new value is pushed straight to the shader, so the surface animates without a rebuild. Where a value is **baked into geometry** (a domain bound on a CPU-meshed fallback surface), the signature includes its value so an animated change correctly triggers a rebuild. The tool routes each case automatically.

## The node categories

The top bar groups addable nodes into five families:

| Group | Nodes | Purpose |
| --- | --- | --- |
| **Inputs** | constant, expression, slider, animator, function definition | Named scalars and helper functions |
| **Functions** | fnMap, equation, transformer | Pure maps, implicit relations, and how to draw them |
| **Geometry** | paramSpace, points | Parametric manifolds and discrete point sets |
| **Flows** | flow | Integrate a vector field from seeds |
| **Cameras** | camera3d, camera2d | Viewports |

The next pages walk through each family in turn.
