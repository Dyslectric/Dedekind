---
title: The expression language
order: 8
group: Reference
---

# The expression language

Every value and coordinate field accepts a math expression, parsed by [mathjs](https://mathjs.org) with a few additions. Expressions can reference reserved variables, named scalars, your own function definitions, and a library of built-in functions.

## Input modes

Expression fields have two display modes, switchable in settings:

- **Live (typeset).** The default. A from-scratch typeset editor showing real fraction, root, sum, integral, and product layout, with `·` for multiplication, italic variables, and Greek glyphs. Type `\alpha` to get α, `\partial` for the partial-derivative operator, and trigger words (`summation`, `integrate`, `product`, `sqrt`, `d/d`) expand into their typeset forms with proper field-to-field caret navigation.
- **Plain.** A syntax-highlighted plain-text editor over the same underlying string.

Both edit the same plain mathjs text, so switching modes is non-destructive.

## Reserved variables

These names have meaning in the right context:

| Variable | Meaning |
| --- | --- |
| `x, y, z, w` | function-map inputs / spatial coordinates |
| `u, v` | parametric-surface parameters |
| `t` | curve parameter (and a common animator name) |
| `i, j, k` | lattice / index variables in point sets |
| `n` | sequence index in recurrences |

A name is only "reserved" where it's bound. In a glyph field driven by an animator named `t`, `t` is a real dependency, not a bound parameter, and the tool handles the distinction.

## Operators

Standard arithmetic `+ − · /`, exponent `^`, parentheses, and comparison. Multiplication is shown as a centered dot `·` in the typeset editor but written `*` in text.

## Built-in functions

```text
sin cos tan  asin acos atan atan2
sinh cosh tanh
exp log ln log10 log2
sqrt cbrt  abs sign  floor ceil round fract  mod pow
min max  hypot norm  gamma factorial
dot cross
```

Note: functions like `gamma` and `factorial` evaluate on the CPU. A surface expression using them falls back to a CPU mesh rather than the GPU path, which matters for animation performance, so prefer GLSL-expressible functions in surfaces you intend to animate.

## Big operators

Four higher-order operators are available, typed as ordinary function calls (and rendered typeset in live mode):

- **`summation(body, i, lo, hi)`**: ∑ of `body` as `i` runs `lo…hi`.
- **`product(body, i, lo, hi)`**: ∏ likewise.
- **`integrate(body, x, lo, hi)`**: definite integral.
- **`differentiate(body, x, point)`**: derivative of `body` with respect to `x`, evaluated at `point`. Symbolic differentiation under the hood.
- **`partial(expr, x, [freevars], [values])`**: partial derivative ∂/∂x of `expr`, with the free variables bound positionally to the given values. A convenience operator for when you want a partial derivative at the ready without defining it yourself.

In the typeset editor these expand from trigger words and lay out as real ∑, ∫, ∏ with stacked bounds. Arrow keys move through their fields in a sensible visual order: the index/variable first, then the bounds, then the body.

## Greek letters and constants

Type `\name` to insert a Greek glyph (`\pi`, `\phi`, `\theta`, …). Constants `pi` and `e` are recognized. The golden ratio appears in several classic surfaces; write it numerically (`1.6180339887`) or build it (`(1+sqrt(5))/2`).
