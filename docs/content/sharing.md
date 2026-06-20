---
title: Demos & sharing
order: 10
group: Reference
---

# Demos & sharing

Dedekind has no backend; a whole project lives in the page URL. That makes sharing a link, opening a demo, and pasting in ready-made geometry all work the same way: through encoded text.

## Open a demo from the URL

Add `#demo` to the editor URL to boot straight into a curated showcase scene, with no setup and no wiring. The default is the **Clebsch cubic**, animated and orbiting:

```text
https://your-host/#demo
```

You can name a specific scene with `#demo=<name>`:

```text
#demo=clebsch     the Clebsch diagonal cubic (default)
#demo=gyroid      a gyroid minimal surface
#demo=chmutov     a Chmutov quartic
#demo=ribbon      the lissajous ribbon (animated section sweep)
#demo=wavytorus   a morphing wavy torus
```

The demo route is the fastest way to show someone what the renderer does.

## Share a scene as a link

The entire project (every node, wire, and value) encodes into the URL hash. Saving produces a shareable link; opening it reconstructs the exact scene. You can also share a **single camera**, which opens straight into that one view instead of the full editor.

## Paste-in geometry

Selections export as a self-contained JSON snippet you can paste back in, into the same project or a different one. This is how the worked surfaces in [Implicit surfaces](implicit-surfaces.html) are distributed: the payload is

```json
{ "kind": "dedekind/selection", "version": 1, "nodes": [ ... ] }
```

where each node carries its `type`, `pos`, `attachments`, and properties. Paste it onto the canvas (**Ctrl+V**) and it materializes as fresh nodes, with internal wiring preserved, ids remapped, and the cluster centered under your cursor. The top bar's **import sel** button does the same from a pasted string.

A typical payload wires an `equation` into a `transformer` into a `camera3d`, optionally with an `animator` driving a morph parameter, giving a complete, self-contained surface ready to render.

## Building shareable moments

Because the renderer is the product for the geometry audience, a short clip (a Barth sextic in gradient-coloring mode slowly morphing and orbiting, or the torus ring catching light on its intersection seams) is the most direct way to show what the tool does. The `#demo` route and paste-in snippets are the seeds: a link or a JSON block someone can run themselves in seconds.
