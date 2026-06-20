---
title: Cameras & viewports
order: 7
group: Nodes
---

# Cameras & viewports

A camera renders whatever plots are wired into it. There are two explicit kinds, and the kind fixes the view mode.

## camera3d

A perspective or orthographic 3D viewport with orbit controls. Plots wired in are drawn in world space, with math-Z as the up axis.

| Field | Meaning | Default |
| --- | --- | --- |
| projection | `perspective` or `orthographic` | perspective |
| orbTheta / orbPhi / orbRadius | orbit angles and distance | none |
| fov | field of view (perspective) | `50` |
| orthoSize | view size (orthographic) | `10` |
| near / far | clip planes | `0.01` / `2000` |
| showGrid / showAxes | reference geometry | on |
| bgOverride / bgColor | per-camera background | off |
| spin / spinPeriod | auto-orbit and its period | off |

### Viewport controls

| Action | Keys |
| --- | --- |
| Pan | **W A S D** / arrow keys |
| Up / down | **Q** / **E** |
| Orbit | **I J K L** |
| Zoom | **R** / **F** |

Use **reset view** (or press **R** when not focused for keyboard nav) to frame the visible geometry.

## camera2d

A flat 2D viewport defined by a plane: an origin point and a normal vector. 3D plots are orthographically projected onto the plane. The default is the world XY plane (normal +Z).

| Field | Meaning |
| --- | --- |
| planeOx / planeOy / planeOz | plane origin |
| normalX / normalY / normalZ | plane normal |

## Docking and floating windows

Cameras can be **docked** in a strip along the viewport, or **popped out** into floating, resizable, repositionable windows. Each camera has its own controls and can be themed independently. This is how you build a multi-view scene, with several cameras pointed at the same geometry from different angles, or at different parts of the graph.

## Sharing a camera

Any single camera can be shared as a URL that opens straight into that one view, separate from sharing the whole project. See [Demos & sharing](sharing.html).
