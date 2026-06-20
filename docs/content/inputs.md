---
title: Inputs & scalars
order: 3
group: Nodes
---

# Inputs & scalars

Inputs are the named values that feed everything downstream. They all have a **name** (referenceable in any expression) and a **value** or definition.

## Constant

A fixed named number. Its `value` field accepts an expression, so a constant can be defined in terms of other scalars (`c = 2·pi`).

| Field | Meaning | Default |
| --- | --- | --- |
| name | identifier used in expressions | `c` |
| value | the value (expression allowed) | `1` |

## Expression

A named value computed from an expression. Where a constant is a fixed quantity, an expression node is meant to be *derived*; it re-evaluates whenever its inputs change. Use it to name an intermediate quantity (`t = m^2`) and feed it into several places.

| Field | Meaning | Default |
| --- | --- | --- |
| name | identifier | `e` |
| expr | the expression to evaluate | `0` |

## Slider

A scalar you drag. Bounds and step are configurable, and the current value is live, so every expression referencing the slider's name updates as you drag.

| Field | Meaning | Default |
| --- | --- | --- |
| name | identifier | `a` |
| min / max | drag range | `-5` / `5` |
| step | drag granularity | `0.01` |

When a slider is referenced inside a GPU-accelerated surface expression, it becomes a **live shader uniform**, so dragging it animates the surface with no rebuild.

## Animator

A slider that animates itself over time. It sweeps between `min` and `max` over `period` seconds, following a loop mode.

| Field | Meaning | Default |
| --- | --- | --- |
| name | identifier | `t` |
| min / max | sweep range | `0` / `1` |
| period | seconds per cycle | `4` |
| loop | `loop`, `bounce`, or `once` | `bounce` |
| step | optional quantization of the value | none |

**Loop modes:**

- **loop**: ramps `min → max`, then jumps back to `min` and repeats.
- **bounce**: ramps `min → max → min` smoothly (ping-pong).
- **once**: ramps `min → max` a single time, then stops and holds.

An animator drives anything a scalar can: a morph parameter in an equation, a phase inside an expression, a domain bound on a surface (which now sweeps on the GPU; see [Animation](animation.html)).

## Function definition

A reusable function `f(params) = body`. Define `f(x) = x^2` once and call `f` in any downstream expression. Parameters are comma-separated; the body is an expression in those parameters plus any scalars the definition is wired to.

| Field | Meaning | Default |
| --- | --- | --- |
| name | function name | `f` |
| params | comma-separated parameters | `x` |
| expr | the function body | `x^2` |

A function definition closes over its own attached scalars: if `f(x) = a·x` and slider `a` is wired into the definition, then any plot using `f` depends on `a` transitively, even without wiring `a` to the plot directly.
