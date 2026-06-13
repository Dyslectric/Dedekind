# Dedekind

[Go to the app](https://dedekind.app)

**Everything's in Dedekind** - a node-graph editor for visualizing math in 2D and 3D.

Wire scalars into functions, run those through transformers and flows, and point a
camera at the result. Edit anything and the view updates immediately. It runs entirely
in your browser, and a whole project encodes into the page URL so you can share a scene
with a link. Built with React, three.js, and mathjs; much of the rendering is
GPU-accelerated.

<!-- Add a screenshot or GIF here for the GitHub page, e.g.: -->
<!-- ![Dedekind](docs/screenshot.png) -->

## Highlights

- **Functions separated from geometry.** An `fnMap` is a pure map (up to four
  inputs `x, y, z, w` and four outputs). It has no shape of its own. You wire it into a
  *transformer* that decides how to draw it.
- **Transformers: graphs and fields.**
  - *Graph mode* assigns inputs and outputs to spatial axes: a curve `y=f(x)`, a surface
    `z=f(x,y)`, or a 3-input solid point cloud. **Z is up.**
  - *Field mode* draws the output vector as an arrow at each sample (the generalized
    quiver). The render options adapt to the output count - e.g. a 3-output map can be a
    3D vector field, or a 2D field colored by its third output; a 4-output map becomes a
    3D field with the fourth output driving the color.
- **Gradient coloring everywhere.** Curves, surfaces, solids, point clouds, and vector
  fields can be colored by a value expression mapped across a two-color ramp.
- **Flows.** Integrate a vector field from seed points (one streamline each) or a seed
  line (a stream surface). Degree-2 parametric seeds sweep a volume.
- **Points & glyphs.** Define points directly, by a recurrence (`x[n-1]`), by index
  (`[i]`), or on a 2D/3D lattice (`[i,j,k]`), with optional per-point arrows. Rendered in
  a single instanced GPU pass.
- **Animators & live expressions.** Drive any value with a looping/bouncing/once
  animator; type math into any field with `i, j, k, n, t, u, v` and your own recursive
  function definitions.
- **2D & 3D cameras** you can dock in a strip or pop into floating windows, with a
  resizable, repositionable properties panel and theme presets.
- **Shareable.** The whole project lives in the URL; you can also share a single camera.

## Quick start

Requires Node.js 18+.

```bash
npm install
npm run dev      # start the dev server (Vite); open the URL it prints
npm run build    # production build -> dist/
npm run preview  # preview the production build
```

The app opens on a landing page; click **Open the editor** to start. Load the **demo**
project from the top bar for a feature showcase (most plots are left disconnected for you
to wire into a camera and explore).

## Using it, briefly

1. Add nodes from the top bar (scalars, function maps, param spaces, transformers, flows,
   points, cameras).
2. Drag from a node's output port to another node's input to wire them. Scalars feed
   functions/plots/cameras; functions feed transformers and flows; plots feed cameras.
3. Select a node to edit it in the properties panel.
4. Drag a plot's output into a camera to see it. Press **R** / use *reset view* to frame
   the content.

3D viewport keys: **WASD / arrows** pan, **Q/E** up/down, **IJKL** orbit, **R/F** zoom.

## Project structure

```
src/
  index.jsx              Entry point (mounts <App/>)
  App.jsx                Top-level app: App, Root (landing/editor routing), Editor, SharePage

  core/                  Pure logic (no React, no DOM)
    math.js              Expression compile/eval cache, resolveNum/safeEval, makeFn, linspace, ids
    taxonomy.js          Node categories + attachment rules (canAttach, catOf, ...)
    scope.js             Dependency-based scope resolution + geometry signatures
    serialize.js         Project (de)serialization, share encoding, legacy migration
    worker.js            Web Worker source + ComputeWorker (RK4 flow offload)

  geometry/              three.js geometry generation (no React)
    three-helpers.js     dispose/colour helpers, shader material, uniform updates
    glsl.js              mathjs -> GLSL transpiler for GPU evaluation
    builders.js          CPU + GPU builders (surfaces, curves, quivers, glyph fields, instanced point clouds)
    transformer.js       Renders an fnMap over a domain (graph axis-mapping or vector field) + gradient coloring
    flow.js              Flow integration, stream surfaces & volumes
    parse.js             Point-sequence and glyph-field parsers (plain, recursive [n-1], index [i], matrix [i,j,k])
    rebuild.js           Scene rebuild + per-plot caching, domain application, sequencing, point gradient colors

  render2d/
    render2d.js          2D canvas renderer + projection helpers

  theme/
    tokens.jsx           UI palette tokens, node-card palette, S styles, UICtx/useUI
    presets.js           Theme presets (incl. Catppuccin), buildTheme

  nodes/
    model.js             TYPE_META, ports, node factory, blank default scene + feature-showcase demo scene
    normalize.js         Maps unified kinds (scalarFn/paramSpace/points) -> legacy type+props
    kinds.js             Addable-kind groups + enable/disable for simplified shares
    colors.js            Geometry default colours

  hooks/
    useAnimators.js      requestAnimationFrame loop driving animator values
    useHistory.js        Undo/redo history

  landing/
    Landing.jsx          Marketing landing page shown at the root
    previews.jsx         Live, self-contained preview viewports embedded on the landing

  components/            React UI
    NodeCanvas.jsx       The node graph (pan/zoom/wire) + node cards
    PropsPanel.jsx       The properties panel (per-node editors)
    ThemeEditor.jsx      Theme + node-kind controls (project node)
    MathInput.jsx        Syntax-highlighted, prettified expression input
    Viewport.jsx         3D/2D viewports, detached windows, viewport strip
    ScalarOverlay.jsx    Live scalar/slider HUD over a viewport
    FnDefRow.jsx         Function-definition editor row
    primitives.jsx       Small shared UI pieces (Sec, PR, Toggle, Swatch, ...)
```

## Architecture notes

- **One-way dependencies.** UI imports logic, never the reverse; `core/` and `geometry/`
  are React-free and independently testable.
- **Node model.** A node's `attachments` are its upstream dependencies. Scalars attach to
  the functions/plots/cameras that use them; plots attach to cameras. Scope is resolved
  per-consumer.
- **Unified plot kinds.** Authoring uses consolidated kinds. `paramSpace` is a
  parameterized curve (degree 1) or surface (degree 2); `points` covers
  points/glyphs/sequences. Functions are separated from how they are drawn: an `fnMap` is
  a pure map that feeds a `transformer`, which renders it as a *graph* (inputs and
  outputs assigned to spatial axes) or a *field* (an arrow per sample, optionally colored
  by a reserved output). A transformer's domain is an inline box + resolution, or a wired
  `paramSpace`. `nodes/normalize.js` maps the granular kinds to legacy geometry at render
  time. Legacy projects migrate automatically (`serialize.migrateModel`).
- **Coordinates.** The renderer maps math `(x, y, z)` to three.js `(x, z, y)`, so math-Z
  is the vertical/up axis; graph transformers default their scalar output to Z.
- **Cameras.** Two explicit kinds, `camera3d` and `camera2d`; the kind fixes the view
  mode. Legacy single `camera` nodes migrate by their stored mode.
- **Flows.** A `flow` consumes a vector-field `fnMap` and a seed source: a `paramSpace`
  (continuous: degree 1 stream surface, degree 2 swept volume) or a `points` node
  (discrete seeds - one stream curve per point). On a 2D camera viewing the XY plane, a
  degree-1 stream surface fills as a solid colored area.
- **GPU point clouds.** Point sequences render as a single `InstancedMesh`
  (`buildPointSeqGPU`), with per-point gradient colors via `instanceColor`; sequenced
  reveal animates via `instanceCount`.
- **Performance.** Analytic expressions are transpiled to GLSL and evaluated on the GPU
  where possible; geometry is cached by signature and only rebuilt when an input it
  depends on changes; flow integration can run in a Web Worker.

## Tech

React, three.js, mathjs, Vite. No backend. Everything runs client-side.

## Disclosure

Specification written by David Green and vibe-coded with the help of Claude, an LLM by
Anthropic.

## License

See [LICENSE](LICENSE).
