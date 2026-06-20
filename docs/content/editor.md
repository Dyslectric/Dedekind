---
title: Editor & shortcuts
order: 11
group: Reference
---

# Editor & shortcuts

## Building a scene

1. **Add nodes** from the top bar, grouped into Inputs, Functions, Geometry, Flows, and Cameras.
2. **Wire** them by dragging from a node's output port to another node's input. Scalars feed functions/plots/cameras; functions feed transformers and flows; plots feed cameras.
3. **Select** a node to edit it in the properties panel.
4. **Drag a plot into a camera** to see it. Press **R** or use *reset view* to frame the content.

## Selecting and reusing nodes

Click selects a single node; **Shift-click** toggles nodes in and out of a multi-selection. **Ctrl-drag** a rectangle on empty canvas to add the nodes it touches (**Ctrl+Alt-drag** to remove them), and **Ctrl+A** selects everything. With several nodes selected, dragging any of them moves the whole group.

The properties panel's *Selection* section can grow a selection to everything it **depends on** or to its full **connected component**, then **copy** it to the clipboard as a self-contained JSON snippet, with internal wiring preserved and dangling edges dropped. **Paste** drops it back in, as fresh nodes centered under the cursor. See [Demos & sharing](sharing.html).

## Keyboard reference

### Editor

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

### 3D viewport

| Action | Keys |
| --- | --- |
| Pan | **W A S D** / arrows |
| Up / down | **Q** / **E** |
| Orbit | **I J K L** |
| Zoom | **R** / **F** |

### Typeset expression editor

| Action | Keys |
| --- | --- |
| Move through operator fields | **←** / **→** (visual order: variable → bounds → body) |
| Next field | **Tab** |
| Commit edit | **Enter** or click away |
| Insert Greek glyph | type `\name` (e.g. `\pi`) |
| Insert operator | type `summation`, `integrate`, `product`, `sqrt`, `d/d`, `\partial` |

## Settings

The properties panel and project node expose display preferences:

- **Math input mode**: live typeset (default) or plain text.
- **Theme**: UI palette presets, including Catppuccin.
- **Node-kind visibility**: hide kinds you don't use to simplify the toolbar.
