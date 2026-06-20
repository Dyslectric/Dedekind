---
title: Manifolds, points & flows
order: 6
group: Nodes
---

# Manifolds, points & flows

Beyond function graphs and implicit surfaces, Dedekind has nodes for parametric manifolds, discrete point sets, and integrated flows.

## paramSpace: parametric manifolds

A `paramSpace` is a parameterized curve or surface, defined by expressions in its parameters.

- **Degree 1**: a curve `(x(t), y(t), z(t))` over a `t` interval.
- **Degree 2**: a surface `(x(u,v), y(u,v), z(u,v))` over a `(u, v)` domain.

It can be rendered directly, used as a transformer's domain (supplying sample points instead of an inline box), or used as a **seed manifold for a flow**.

| Field | Meaning |
| --- | --- |
| degree | `1` (curve) or `2` (surface) |
| exprX / exprY / exprZ | coordinates in the first parameter |
| exprXu / exprYu / exprZu | coordinates in the second parameter (degree 2) |
| tMin / tMax, res | curve domain and resolution |
| uMin…vMax, uRes / vRes | surface domain and resolution |

A standalone parametric **surface** node is also available directly, GPU-accelerated, with animatable expressions and domain bounds. Sweeping a surface's domain open is a one-uniform-per-frame operation.

## points: discrete sets

A `points` node defines a set of points (optionally with per-point arrows, making it a glyph field). Points can be specified four ways:

- **List**: literal coordinates, one point per line.
- **Index `[i]`**: a formula evaluated at `i = 0, 1, 2, …`, generating a point per index.
- **Recurrence `x[n-1]`**: each point defined in terms of the previous (orbit/iteration plots).
- **Lattice `[i,j,k]`**: a formula over a 1D/2D/3D grid of indices.

Per-point arrows turn the set into a **glyph field**. Arrow length has three modes:

- **uniform**: every arrow the same length.
- **scaled**: length relative to the largest vector in the set.
- **raw magnitude**: length equals ‖vec‖ directly.

The fixed length accepts an expression, so a slider can drive it live. Point sets render as a single instanced GPU pass, with per-point gradient colors and an optional **sequenced reveal** that animates points appearing one at a time.

## flow: integrated vector fields

A `flow` integrates a vector-field `fnMap` from a seed source, tracing trajectories (RK4 integration, optionally offloaded to a Web Worker).

The seed source determines the output:

- **Seed points** (a `points` node) → one streamline per point.
- **Degree-1 seed manifold** (a curve) → a **stream surface**.
- **Degree-2 seed manifold** (a surface) → a swept **volume**.

On a 2D camera viewing the XY plane, a degree-1 stream surface fills as a solid colored area.

| Field | Meaning | Default |
| --- | --- | --- |
| steps | integration steps per trajectory | `500` |
| stepSize | integration step size | `0.02` |
| output | `surface` or `lines` (degree-1 seeds) | `surface` |
| volSlices | slices for a swept volume | `6` |
| gradient, gradA, gradB | optional along-flow gradient coloring | off |

Wire both a vector-field `fnMap` and a seed source (`paramSpace` or `points`) into the flow.
