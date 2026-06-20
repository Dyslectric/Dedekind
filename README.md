# [Dedekind](https://dedekind.app)

**Everything's in Dedekind** -- a node-graph editor for visualizing math in 2D and 3D.

Wire scalars into functions, run those through transformers and flows, and point a
camera at the result. Edit anything and the view updates immediately. It runs entirely
in your browser, and a whole project encodes into the page URL so you can share a scene
with a link. Built with React, three.js, and mathjs; much of the rendering is
GPU-accelerated.

It also renders **implicit surfaces and algebraic varieties** (the level set of
`F(x,y,z)=0`) directly on the GPU, with clean singularities, visible self-intersection
seams, and coloring that encodes depth or the gradient (so singular points light up).
That's the part built for people who think about 3D spaces and varieties, from
Blender-curious students to algebraic and differential geometers.

**Full documentation** lives in [`docs/`](docs/). Run `node docs/build.mjs` to generate
the static site, or read the markdown in `docs/content/`.

<!-- Add a screenshot or GIF here for the GitHub page, e.g.: -->
<!-- ![Dedekind](docs/screenshot.png) -->

## Highlights

- **Implicit surfaces on the GPU.** An `equation` node draws the level set of
  `F(x,y,z)=0` by ray-marching the field in a fragment shader -- no mesh. The marcher is
  built for real algebraic varieties: adaptive damped-Newton stepping catches thin sheets,
  gradient hardening and singularity supersampling make nodes and cusps shade as coherent
  points, and self-intersections render with a visible seam. A Barth sextic resolves its
  65 nodes; a Whitney umbrella keeps its pinch. Morph parameters animate as live uniforms.
- **Surface coloring that means something.** Depth, gradient `|∇F|` (singular points light
  up, since the gradient vanishes there), normal direction, or an animated iridescent
  palette -- chosen per surface, with a hue-shift control.
- **Functions separated from geometry.** An `fnMap` is a pure map Rm->Rn (up to four
  inputs `x, y, z, w` and four outputs). It has no shape of its own -- you wire it into a
  *transformer* that decides how to draw it.
- **Transformers: graphs and fields.**
  - *Graph mode* assigns inputs and outputs to spatial axes: a curve `y=f(x)`, a surface
    `z=f(x,y)`, or a 3-input solid point cloud. **Z is up.**
  - *Field mode* draws the output vector as an arrow at each sample (the generalized
    quiver). The render options adapt to the output count -- e.g. a 3-output map can be a
    3D vector field, or a 2D field colored by its third output; a 4-output map becomes a
    3D field with the fourth output driving the color.
- **Gradient coloring everywhere.** Curves, surfaces, solids, point clouds, and vector
  fields can be colored by a value expression mapped across a two-color ramp.
- **Flows.** Integrate a vector field from seed points (one streamline each) or a seed
  line (a stream surface). Degree-2 parametric seeds sweep a volume.
- **Points & glyphs.** Define points directly, by a recurrence (`x[n-1]`), by index
  (`[i]`), or on a 2D/3D lattice (`[i,j,k]`), with optional per-point arrows. Glyph arrow
  length has three modes -- *uniform* (every arrow the same length), *scaled* (relative to
  the largest vector in the set), and *raw magnitude* (length = ||vec|| directly) -- and the
  fixed length accepts an expression, so a slider can drive it live. Rendered in a single
  instanced GPU pass.
- **Multi-selection & clipboard.** Shift-click to build a selection, Ctrl-drag a marquee
  to add nodes (Ctrl+Alt-drag to subtract), or Ctrl+A to select all. Expand a selection to
  everything it depends on or its whole connected component, then copy it to the clipboard
  as JSON and paste it back (into the same project or another) under the cursor. Selected
  nodes drag together.
- **Animators & live expressions.** Drive any value with a looping/bouncing/once
  animator; type math into any field with `i, j, k, n, t, u, v` and your own recursive
  function definitions. Expression parameters *and domain bounds* on GPU surfaces animate
  as live shader uniforms -- sweeping a parametric surface's domain open, or windowing a
  moving section through it, runs at frame rate with no rebuild. The typeset live-math
  editor (real fractions, roots, ∑/∫/∏, Greek) is the default input mode.
- **2D & 3D cameras** you can dock in a strip or pop into floating windows, with a
  resizable, repositionable properties panel and theme presets.
- **Shareable.** The whole project lives in the URL; you can also share a single camera.
  Open the editor with `#demo` (or `#demo=clebsch`, `=gyroid`, `=ribbon`, ...) to boot
  straight into a live, animated showcase scene.

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

## Documentation

Full docs live in [`docs/`](docs/) as markdown, built into a static HTML site by a small
zero-dependency generator:

```bash
npm run docs     # node docs/build.mjs -> docs/dist/  (standalone)
```

`npm run build` also builds the docs and folds them into the app's output at `dist/docs/`,
so a single build produces a complete deployable site (the docs are served at `/docs/`).
Source pages are in `docs/content/` (overview, core concepts, every node type, the
implicit-surface renderer, the expression language, animation, sharing, keyboard
reference, and architecture).

## Using it, briefly

1. Add nodes from the top bar (scalars, function maps, param spaces, transformers, flows,
   points, cameras).
2. Drag from a node's output port to another node's input to wire them. Scalars feed
   functions/plots/cameras; functions feed transformers and flows; plots feed cameras.
3. Select a node to edit it in the properties panel.
4. Drag a plot's output into a camera to see it. Press **R** / use *reset view* to frame
   the content.

### Selecting & reusing nodes

Click selects a single node; **Shift-click** toggles nodes in and out of a multi-selection.
**Ctrl-drag** a rectangle on empty canvas to add the nodes it touches (**Ctrl+Alt-drag** to
remove them), and **Ctrl+A** selects everything. With several nodes selected, dragging any
of them moves the whole group, and **Del** removes them all.

The properties panel's *Selection* section (and the shortcuts below) can grow a selection
to everything it **depends on** or to its full **connected component**, then **copy** it to
the clipboard as a self-contained JSON snippet (internal wiring preserved, dangling edges
dropped). **Paste** drops it back in -- into the same project or a different one -- as fresh
nodes centered under the cursor. The top bar's **import sel** button does the same from a
pasted JSON string.

### Shortcuts

| Action | Keys |
| --- | --- |
| Undo / redo | **Ctrl+Z** / **Ctrl+Shift+Z** (or **Ctrl+Y**) |
| Select all nodes | **Ctrl+A** |
| Add to selection (marquee) | **Ctrl**-drag |
| Subtract from selection (marquee) | **Ctrl+Alt**-drag |
| Grow selection to its dependencies | **Ctrl+Shift+D** |
| Grow selection to connected component | **Ctrl+Shift+C** |
| Copy selection (JSON) | **Ctrl+C** |
| Paste selection under cursor | **Ctrl+V** |
| Delete selected node(s) | **Del** |

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
    graph.js             Selection-graph helpers: dependency/connected traversal, clipboard payload + import
    serialize.js         Project (de)serialization, share encoding, legacy migration
    worker.js            Web Worker source + ComputeWorker (RK4 flow offload)

  geometry/              three.js geometry generation (no React)
    three-helpers.js     dispose/colour helpers, shader material, uniform updates
    glsl.js              mathjs -> GLSL transpiler for GPU evaluation
    implicit-raymarch.js GPU fragment-shader raymarcher for implicit surfaces (singularities, seams, coloring)
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
    NodeCanvas.jsx       The node graph (pan/zoom/wire) + node cards; multi-select (shift-click, marquee), group drag, clipboard paste
    PropsPanel.jsx       The properties panel (per-node editors) + selection actions (copy/expand)
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
  per-consumer. Named scalars (sliders, constants, animators) are also folded into a global
  scope, so an expression field like a glyph's arrow length can reference a slider by name
  without an explicit wire and still update live.
- **Selection & clipboard.** Selection is a set of node ids with one *primary* node driving
  the properties editor. `core/graph.js` walks the dependency graph (upstream for
  *dependencies*, undirected for *connected component*) and builds a portable JSON payload
  containing the chosen nodes plus only the wiring internal to them. Import remaps every id
  to a fresh one, rewires internal edges, and can re-center the cluster on a world point
  (paste-under-cursor). Group moves commit as a single batched, undoable step.
- **Unified plot kinds.** Authoring uses consolidated kinds. `paramSpace` is a
  parameterized curve (degree 1) or surface (degree 2); `points` covers
  points/glyphs/sequences. Functions are separated from how they are drawn: an `fnMap` is
  a pure map Rm->Rn that feeds a `transformer`, which renders it as a *graph* (inputs and
  outputs assigned to spatial axes) or a *field* (an arrow per sample, optionally colored
  by a reserved output). A transformer's domain is an inline box + resolution, or a wired
  `paramSpace`. `nodes/normalize.js` maps the granular kinds to legacy geometry at render
  time. Legacy projects migrate automatically (`serialize.migrateModel`).
- **Coordinates.** The renderer maps math `(x, y, z)` to three.js `(x, z, y)`, so math-Z
  is the vertical/up axis; graph transformers default their scalar output to Z.
- **Cameras.** Two explicit kinds, `camera3d` and `camera2d`; the kind fixes the view
  mode. Legacy single `camera` nodes migrate by their stored mode.
- **Flows.** A `flow` consumes a vector-field `fnMap` and a seed source: a `paramSpace`
  (continuous -- degree 1 -> stream surface, degree 2 -> swept volume) or a `points` node
  (discrete seeds -- one stream curve per point). On a 2D camera viewing the XY plane, a
  degree-1 stream surface fills as a solid colored area.
- **GPU point clouds.** Point sequences render as a single `InstancedMesh`
  (`buildPointSeqGPU`), with per-point gradient colors via `instanceColor`; sequenced
  reveal animates via `instanceCount`.
- **Performance.** Analytic expressions are transpiled to GLSL and evaluated on the GPU
  where possible; geometry is cached by signature and only rebuilt when an input it
  depends on changes; flow integration can run in a Web Worker.

## Tech

React - three.js - mathjs - Vite. No backend -- everything runs client-side.

## Disclosure

Specification written by David Green and vibe-coded with the help of Claude, an LLM by
Anthropic.

## License

See [LICENSE](LICENSE).
