---
title: Animation
order: 9
group: Reference
---

# Animation

Any scalar can be animated, and animation is designed to stay smooth. Wherever possible an animated value updates a GPU shader uniform instead of rebuilding geometry.

## Driving values

An **animator** sweeps between `min` and `max` over its `period`, in one of three loop modes (`loop`, `bounce`, `once`). Wire it, or reference its name, anywhere a scalar is used:

- A **morph parameter** inside an equation, sliding a surface through a family of shapes.
- A **phase** inside an expression, making a field churn.
- A **domain bound** on a surface, sweeping a section of it into view.

You can also just drag a **slider** to animate by hand; the same live-update behavior applies.

## What updates without a rebuild

The performance distinction matters for what feels smooth:

- **Expression parameters in a GPU surface** are live uniforms. Animating a phase in `z = sin(x·a − t)` or a morph term in an implicit equation updates a single uniform per frame, with no rebuild.
- **Domain bounds on a GPU surface** are also live uniforms. Animating `uMax` to sweep a parametric surface open, or windowing a section of a ribbon by moving `[uMin, uMax]`, runs at frame rate. The *resolution* (vertex count) still requires a rebuild when changed, but bounds do not.
- **Implicit surfaces** that transpile to GLSL animate their morph parameters as uniforms, so the surface deforms without re-meshing.

When a surface can't transpile (it uses a CPU-only function), its domain and parameters are baked into the mesh, so animating them correctly triggers a rebuild. The tool detects which case applies and routes automatically; you don't choose.

## Editing while animating

You can edit expressions, bounds, and other fields while an animation is playing; the view keeps animating and your edits take effect live. The properties panel's live value previews pause refreshing only on the field you're actively editing, so typing is never interrupted.

## A worked example: a section running through a ribbon

The landing page's lissajous ribbon shows the domain-animation technique. The ribbon is a parametric surface over `u ∈ [0, 2π]`, but only `u ∈ [uMin, uMax]` is drawn at any moment:

```text
uMin = max(0, s - 1.4)
uMax = min(6.283, s)
```

As the animator `s` sweeps, that 1.4-radian window slides around the knot: a lit section flying through the curve. Because the bounds are GPU uniforms, the whole sweep is one uniform write per frame, with no rebuild.
