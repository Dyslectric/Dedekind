---
title: Implicit surfaces
order: 5
group: Nodes
---

# Implicit surfaces

An **equation** node expresses an implicit relation `lhs = rhs`. In three variables, wired into a transformer, it draws the surface where `lhs − rhs = 0`, the level set. This is the part of Dedekind built for algebraic and differential geometry, and it's rendered by a dedicated GPU raymarcher that handles the hard cases: singular points, self-intersections, and thin features that naive plotters smear or tear.

## The equation node

| Field | Meaning | Default |
| --- | --- | --- |
| dims | `2d` (curve) or `3d` (surface) | `2d` |
| lhs / rhs | the two sides of the relation | `x^2 + y^2` / `4` |
| varA / varB / varC | the variable names | `x`, `y`, `z` |

Wire the equation into a transformer; the transformer's domain box sets the sampling region. A 2D equation is drawn as a curve (marching squares); a 3D equation becomes a surface.

## How the 3D surface is rendered

When `lhs − rhs` transpiles to GLSL, the surface is **ray-marched directly in a fragment shader**, with no triangle mesh and no field readback. For each pixel the shader marches the field `F(x, y, z)` along the view ray and shades the first crossing. Sliders and animators in the equation become live uniforms, so a morphing surface updates without rebuilding. If the expression can't be transpiled, the renderer falls back to a marching-cubes mesh.

The marcher is built for robustness on real algebraic varieties:

- **Adaptive (damped-Newton) stepping** slows down near the surface and speeds through empty space, catching thin sheets and tangencies that fixed-step marching skips. The damping prevents the overshoot a pure distance estimate suffers on higher-degree polynomials.
- **Sign-change bisection** localizes each crossing precisely.
- **Near-zero detection** catches grazes and tangent points that never flip sign, which are common at self-intersections.
- **Gradient hardening** stabilizes the surface normal where ∇F vanishes (i.e. at singular points), so nodes and cusps shade as coherent points instead of sparkling.
- **Singularity supersampling** averages the normal over jittered samples near degenerate gradients, softening singular points further.
- **Visible crossing seams** darken a thin band where two sheets meet, so a self-intersection reads as an intentional crossing line.

The practical result: a Barth sextic resolves its 65 nodes cleanly, a Whitney umbrella keeps its pinch and self-intersection line intact, and a ring of intersecting tori shows its crossing curves crisply.

## Surface coloring

For a 3D implicit surface, the transformer's **Display** section offers a coloring dropdown. The modes encode something meaningful rather than being decorative, and they help the eye read tangled 3D structure.

| Mode | Encodes | Best for |
| --- | --- | --- |
| **Flat color** | nothing (solid color) | simple surfaces |
| **Depth** | distance from the camera | parsing tangled, self-intersecting geometry |
| **Gradient \|∇F\|** | the field's gradient magnitude | **highlighting singularities**: nodes and cusps light up as a distinct band, since ∇F → 0 there |
| **Normal direction** | surface orientation | reading curvature |
| **Iridescent** | an animated oil-slick palette | decorative motion |

A **hue shift** value rotates the palette for the measured modes. The gradient mode is the mathematically special one: because the gradient vanishes exactly on the singular set, coloring by `|∇F|` paints the singular points distinctly from the smooth regions, which is useful for *seeing* where a variety is singular.

## Worked examples

These are ready to paste in (see [Demos & sharing](sharing.html) for how). Each is a single equation whose surface stress-tests a different feature.

**Clebsch diagonal cubic.** The celebrated cubic carrying all 27 lines, with sharp ridges:

```text
81*(x^3+y^3+z^3) - 189*(x^2*y+x^2*z+y^2*x+y^2*z+z^2*x+z^2*y)
  + 54*x*y*z + 126*(x*y+y*z+z*x) - 9*(x^2+y^2+z^2) - 9*(x+y+z) + 1 = 0
```

**Whitney umbrella.** A self-intersection line terminating in a pinch point:

```text
x^2 - y^2*z = 0
```

**Barth sextic.** The maximally-singular sextic, 65 ordinary double points (φ is the golden ratio):

```text
4*(φ²x² − y²)(φ²y² − z²)(φ²z² − x²) − (1 + 2φ)(x² + y² + z² − 1)² = 0
```

**Ring of intersecting tori.** A *product* of torus factors, so the level set is their union with real self-intersections where they overlap. Multiplying the left-hand sides of several surfaces is a general trick: the product is zero wherever any factor is, so the combined surface is the union.
