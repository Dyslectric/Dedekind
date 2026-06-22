import { useState, useEffect } from "react";
import { LivePreview, openDemoProject } from "./previews.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// In-app tutorials.
//
// Content model: SECTIONS -> PAGES -> STEPS. A section groups related pages
// (node-graph concepts in one, mathematical concepts in another). A page teaches
// one concept and holds an ordered list of steps that build a progression. A
// step is some prose plus an optional scene `kind`; steps with a scene show a
// live plot and an "open project" button that drops that exact graph into the
// editor. Steps without a scene are pure explanation.
//
// Scenes are registered in previews.jsx and referenced here by their kind string,
// so adding a tutorial is: write the teaching scene there, reference it here.
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    id: "node-graph",
    title: "The editor",
    blurb: "How the tool itself works: values, functions, and how a plot is wired together. Start here.",
    pages: [
      {
        slug: "inputs-and-scope",
        title: "Inputs, names, and scope",
        summary: "Where values come from and how they reach a plot: constants, sliders, and how a named value flows through the graph.",
        steps: [
          { heading: "A constant is a fixed named value", body: "Every plot is ultimately driven by named values. The simplest is a constant: here a = 1.5 feeds the amplitude of the curve y = a·sin(x). The constant is wired into the function, so the function can see it. Open the project and try editing the constant's value; the curve responds.", kind: "tut-const-curve" },
          { heading: "A slider is a value you can move", body: "Swap the constant for a slider and the amplitude becomes something you drag. The function did not change, only its source. A slider referenced inside a surface expression becomes a live shader value, so dragging it animates the plot with no rebuild. Here the slider is set to sweep on its own so you can see the effect.", kind: "tut-slider-curve" },
          { heading: "An animator moves on its own", body: "A slider waits for your hand; an animator is a value that advances with time by itself. Wire one in as a travelling phase t inside sin(x − t) and the wave marches sideways on its own, looping forever, with nothing for you to touch. An animator has a range and a period, how long one sweep takes, and a loop style: run once, restart, or bounce back and forth. This is the node behind every moving plot in these tutorials, and it is exactly a slider that drives itself. Anywhere a slider would work, an animator can take its place to make the effect play automatically.", kind: "tut-animator-curve" },
          { heading: "Reference a value by name once it is wired", body: "A plot evaluates only what is wired into it. Wire a slider into a function and its name becomes available inside that function's expression: here a value k is wired in and referenced as sin(k·x) to control frequency, so dragging the k slider tightens and loosens the wave. The name is how you reach the value, but the wire is what puts it in scope, there is no hidden global. This keeps each plot self-contained: a value affects exactly the nodes it is connected to, and nothing it isn't, so you can read a graph's behavior straight from its wires.", kind: "tut-named-scope" },
        ],
      },
      {
        slug: "functions-and-geometry",
        title: "Functions are separate from geometry",
        summary: "The core idea of the editor: a function is a pure map, and a transformer decides how to draw it.",
        steps: [
          { heading: "A function on its own draws nothing", body: "An fnMap is a pure map. It takes inputs and produces outputs, and that is all it is. The map below, f(x,y) = sin(x)·cos(y), has two inputs and one output, but the viewport is empty: a function has no shape until you say how to draw it. Open the project and you will see a single fnMap node with nothing downstream.", kind: "tut-fn-only" },
          { heading: "Wire it into a graph transformer and it becomes a surface", body: "Attach the same map to a transformer in graph mode, assign the inputs to the x and y axes and the output to z, and you get the surface z = f(x,y). Nothing about the function changed. The transformer is the part that turns the map into geometry over a domain box.", kind: "tut-fn-surface" },
          { heading: "The same function, drawn a different way", body: "Here is the identical kind of map, but sent through a transformer in field mode instead. Now each sample point carries an arrow, so the function reads as a vector field rather than a height. One function, two drawings. That separation is why you can define a map once and view it several ways at the same time.", kind: "tut-fn-field" },
        ],
      },
      {
        slug: "cameras-and-viewing",
        title: "Cameras decide how you look",
        summary: "A camera renders whatever is wired into it. The same geometry looks different through a 3D orbit camera and a flat 2D projection.",
        steps: [
          { heading: "A 3D camera orbits the scene", body: "A camera draws the plots attached to it. A 3D camera views the geometry in space with orbit controls, and can spin on its own. Here it circles a ripple surface. The camera holds no geometry of its own; move it freely and the surface stays put.", kind: "tut-cam-3d" },
          { heading: "A 2D camera flattens onto a plane", body: "A 2D camera is defined by a plane: an origin and a normal. It projects the geometry orthographically onto that plane, so the same ripple surface viewed from above reads like a contour map. Cameras are independent objects, so you can point several at the same geometry from different angles at once.", kind: "tut-cam-2d" },
        ],
      },
      {
        slug: "point-sets",
        title: "Point sets and sequences",
        summary: "Not everything is a continuous surface. A points node plots discrete sets: explicit lists, formulas over an index, and recurrences.",
        steps: [
          { heading: "A list of points", body: "The simplest discrete set is a literal list of coordinates, one point per line, optionally joined by line segments. This is the plot for data, marked positions, or any handful of points you want to place by hand.", kind: "tut-points-list" },
          { heading: "A formula over an index", body: "Instead of listing points, give a formula in an index i and a count, and the node generates a point for each i from zero up. Here a spiral places 360 points by i alone, with the divergence angle g on a slider. Drag g a hair off the golden value near 2.4 and the spiral reorganizes into sweeping arms or locks into spokes; this is the phyllotaxis seen in sunflowers and pinecones, which is why the golden angle is special. This is how you plot a sampled sequence without writing every coordinate.", kind: "tut-points-index" },
          { heading: "A recurrence", body: "A recurrence defines each point from the previous one, written with x[n-1] and y[n-1]. Here each point is rotated by w and scaled by a decay d at every step, and both are sliders. Drag d toward 1 and the orbit stops spiralling inward and traces a near-circle; drag w to set how far it turns per step. Recurrences are the natural way to plot orbits and iterated processes, where each state follows from the last.", kind: "tut-points-recursive" },
        ],
      },
      {
        slug: "combining-inputs",
        title: "Combining several inputs",
        summary: "One expression can read many named values at once. Build up from a single slider to several composing into one shape.",
        steps: [
          { heading: "Start with one knob", body: "A single slider feeding one expression is the simplest interactive plot. Here A scales the height of A·sin(x); drag it and the wave grows and shrinks. Everything that follows is this same idea with more values in play.", kind: "tut-combine-one" },
          { heading: "Two values that interact", body: "Add a second slider and the two can combine in ways neither does alone. Summing two sine waves of different frequencies, sin(k₁x) + sin(k₂x), produces interference: drag k₁ and k₂ close together and slow beats appear; pull them apart and the pattern turns jagged. The interesting behavior lives in the relationship between the two, not in either one.", kind: "tut-combine-two" },
          { heading: "Amplitude, frequency, phase", body: "A wave A·sin(k·x + φ) has three independent knobs. Drag A for height, k for how tight the oscillation is, and φ to slide it left and right. Each slider has a clear, separate job, which is what keeps a multi-input plot readable even as the number of controls grows.", kind: "tut-combine-inputs" },
          { heading: "Sliders that shape a surface", body: "The same composition works in two inputs. The surface sin(kx·x)·cos(ky·y) has a slider for the wave count along each axis; drag them to go from a gentle ripple to a fine egg-carton grid. Two numbers control the whole texture of the surface.", kind: "tut-combine-surface" },
          { heading: "Composing a path", body: "For a capstone, drive a parametric curve with sliders. A Lissajous figure sets x and y each to a sine with its own frequency, sin(a·t + φ) and sin(b·t). Drag the integer frequencies a and b to change how many lobes the figure has in each direction; the phase φ loops on its own so the figure continuously weaves through its shapes. Two sliders and an animator compose into a large family of closed curves.", kind: "tut-combine-lissajous" },
        ],
      },
      {
        slug: "transformer-modes",
        title: "Ways to read a map",
        summary: "The transformer node takes a map and turns it into geometry, and it can read the same numbers several ways: as a height graph, a traced path, a field of arrows, or polar and spherical coordinates.",
        steps: [
          { heading: "As a graph", body: "The default reading is a graph: each input becomes a horizontal coordinate and each output a height, so a two-input map f(x,y) becomes the surface z = f(x,y). This is the picture you reach for first, a landscape whose height is the function's value. Everything else on this page is the same machinery pointed at a different geometry.", kind: "tut-mode-graph" },
          { heading: "As a path", body: "Feed the transformer a one-parameter map and it traces a path instead, evaluating the map as the parameter sweeps and connecting the results. Here a helix climbs as its parameter advances. The same node that drew a surface now draws a curve, because the input is a single parameter rather than a pair of coordinates.", kind: "tut-mode-param" },
          { heading: "As a field of arrows", body: "Switch to field mode and the outputs become directions rather than positions: the transformer draws an arrow at each sample point, pointing the way the map sends it. This is how a two-output map becomes a vector field, the raw material of the flows in the dynamics section. The arrows are normalized here so only direction shows.", kind: "tut-mode-field" },
          { heading: "In polar coordinates", body: "Polar mode reads the input as an angle θ and the output as a radius, plotting r = f(θ). Here r = θ/(2π) grows steadily as the angle sweeps, winding into an Archimedean spiral; a slider sets how many full turns it makes before stopping. The same one-input map that draws a graph in graph mode becomes a curve wound around the origin in polar mode, the mode decides how the numbers are read.", kind: "tut-mode-polar" },
          { heading: "In spherical coordinates", body: "Spherical mode takes the idea into three dimensions: two inputs are read as the angles θ and φ, the output as a radius, drawing the surface r = f(θ,φ). Here a low-order term pinches the sphere into lobes along its axis, a peanut at order one, more beads as the order climbs. Drag the lobe count and watch the surface re-form. A constant radius would give a plain sphere; letting the angles drive the radius is what sculpts it.", kind: "tut-mode-spherical" },
        ],
      },
      {
        slug: "raw-geometry",
        title: "Raw geometry",
        summary: "Sometimes you want to place primitives directly rather than derive them from a map. The raw geometry node builds points, line segments, glyphs, and triangles from explicit data or from expressions over index variables, with every vertex colorable by three channels and an alpha. It ends with a full mesh: a twisted, rippled torus assembled entirely from raw triangles.",
        steps: [
          { heading: "Building by hand", body: "The raw geometry node draws four kinds of primitive: points, line segments (a start and an end), glyphs (a point and a vector), and filled triangles. In list mode you type the data in directly, one primitive per line. Here three separate raw nodes share the same four corners to draw one tetrahedron three ways at once: its triangular faces, its edges, and its vertices. Open the project and edit any of the three coordinate lists to reshape it.", kind: "tut-raw-list" },
          { heading: "One template, many primitives", body: "Typing every primitive by hand does not scale. Index mode instead takes a single template primitive whose coordinates are expressions in an index i, and stamps it out over a count. This sunburst is one segment, written once as running from a small radius to a large one at angle 2πi/N, repeated N times. Drag N and the whole fan redraws. The index i is the sequence position; n is the same when the lattice is one-dimensional.", kind: "tut-raw-sequence" },
          { heading: "Lattices and dependency functions", body: "A count of two numbers makes a lattice, sweeping i and j over a grid. That is enough to build a real surface: each cell of a 12×12 grid emits two triangles, so the whole node tree is just two raw nodes plus a wired height function h(x,y) that both call. Because index expressions see wired functions and sliders, your primitives can reference any dependency in the graph, not only constants. The surface is colored by height.", kind: "tut-raw-lattice" },
          { heading: "Sampling a field", body: "The same idea makes a discrete vector field. Two functions fx and fy are defined as nodes, and a glyph raw node walks a 13×13 lattice, placing an arrow at each point whose direction comes from calling fx and fy there. Each arrow is colored by the field's magnitude at its base. This is a vector field assembled from primitives, reading its directions straight out of the wired functions.", kind: "tut-raw-glyphs" },
          { heading: "Color every vertex", body: "Every vertex of every primitive can carry its own color value, which interpolates smoothly across the primitive, true Gouraud shading. This color wheel is thirty-six triangles fanning out from the center, each rim vertex colored by its angle, so the hue sweeps continuously around the disk even though the geometry is just flat triangles. The same per-vertex coloring shades segments end to end and triangle faces across their interiors.", kind: "tut-raw-gouraud" },
          { heading: "Putting it together", body: "This twisted torus is everything at once. Six sliders feed a small stack of functions: RR ripples the major radius, W twists the tube as it goes around, and SX, SY, SZ turn the two angles into a surface point. Four more functions, CR, CG, CB, and CA, give each vertex a red, green, blue, and alpha value, so the color is set by three independent channels rather than a single ramp, with transparency breathing around the tube. Two raw nodes tile the whole M×M lattice into triangles, each one calling those functions through the index expressions. Open it and drag q to rebraid the tube, p to change the lobes, or rewrite any colour function to repaint the surface. The whole pipeline, lattices, dependency functions, three-channel colour, and alpha, lives in one readable graph.", kind: "tut-raw-torus" },
        ],
      },
      {
        slug: "live-parameters",
        title: "Live parameters",
        summary: "A slider is just a number you can grab. Wire several into one expression and the whole curve becomes something you steer by hand.",
        steps: [
          { heading: "A panel of sliders, one curve", body: "Every name in an expression that is not a built-in can come from a slider. Here a single cubic, y = a·x³ + b·x² + c·x + d, draws its four coefficients from four sliders. Grab any of them in the plot and pull: a bends the tails in opposite directions, b tilts the symmetry, c sets the slope through the middle, d lifts the whole curve. Nothing is recomputed by hand, the curve is the live image of the four numbers. Put the parts of a formula on sliders and you can explore the formula by moving them.", kind: "tut-live-params" },
        ],
      },
    ],
  },
  {
    id: "rendering",
    title: "Rendering: light, material, texture",
    blurb: "How the renderer shades what the graph produces: lit surfaces with normals from the function, material channels set by expressions, textures and normal maps, scene lights, and texturing surfaces that have no UV.",
    pages: [
      {
        slug: "shading-and-materials",
        title: "Shading and materials",
        summary: "A surface kept as a function can be shaded from that function: a normal from its derivative, and colour, specular, and glow set by per-pixel expressions.",
        steps: [
          { heading: "Lit shading from the function's normal", body: "Shading is a plot parameter, so it lives on the transformer that renders a map, not on the map. Render z = f(x,y) through a graph transformer and set its Shading to Lit: it is shaded per pixel with a key light and a specular highlight. The normal is taken from the symbolic derivative of the mapped output, so the highlight tracks the surface rather than the mesh facets, and stays smooth at low grid resolution and as the surface animates. When a derivative can't be taken it falls back to screen-space normals.", kind: "lit-ripple" },
          { heading: "Colour from an expression", body: "A material channel is an expression evaluated per fragment over the domain (x, y). In ramp mode a scalar is mapped across two colours; here sign(sin(2.4x))·sign(sin(2.4y)) draws a checkerboard. Because it is evaluated per pixel rather than interpolated between vertices, the squares stay crisp at any mesh resolution.", kind: "mat-checker" },
          { heading: "A full RGB colour field", body: "For colour that isn't a single gradient, switch to RGB and give three expressions for red, green, and blue. Here R = ½+½sin(x), G = ½+½cos(y), B = ½+½sin(x+y) set the colour as a function of position across the surface.", kind: "mat-rgb" },
          { heading: "Emission", body: "Emission is added after the lighting, so it shows regardless of the light. Here glow bands pow(max(0, sin(2.5(x+y) − t)), 3) sweep a dark dome, driven by an animator t the material reads as a live value. Colour, specular, and emission are the same operation: evaluate an expression per fragment and feed it into the shading.", kind: "mat-glow" },
          { heading: "A texture as the colour", body: "A texture is another colour source. Wire a Texture node into the transformer and set its Material colour to Texture: the image is sampled at the surface's UV, which is its grid coordinates, already present because the surface is parameterized, so no unwrapping is needed. A Video node works the same way, uploading its current frame each tick.", kind: "tex-surface" },
          { heading: "Normal maps for surface detail", body: "A normal map adds surface detail without adding polygons. Wire a second Texture node and set its role to Normal map, and the lit normal is perturbed per pixel by the texture; here a flat dome reads as a field of embossed pyramids. The tangent frame is reconstructed in screen space, so no precomputed tangents are needed, and a strength control on the surface scales the bumps. It uses the same UV transform as the colour texture.", kind: "normal-map" },
          { heading: "Lighting the scene", body: "A light is a scene entity, not a material setting: add a Light node and wire it into the camera, and every lit surface in that view is shaded by it. A directional light is a sun (only its direction matters); a point light has a position and inverse-square falloff. Each carries a colour and intensity, and every field is an expression, so wiring an animator in moves or dims it over time. Here a warm point light orbits the surface and a cool directional light fills from the side. With no light wired, a default key light is used.", kind: "lights" },
          { heading: "Putting it together: a brick sphere", body: "A parametric sphere carries a brick albedo texture and a matching brick normal map (both built-ins), lit by an orbiting point light and a directional fill. The geometry is a smooth sphere; every brick edge and mortar groove is the normal map perturbing the lit normal, sampled at the sphere's (u, v). The albedo and the normal map share one layout, so colour and relief line up.", kind: "brick-sphere" },
        ],
      },
      {
        slug: "texturing-implicit",
        title: "Texturing an implicit surface",
        summary: "A ray-marched implicit surface has no UV coordinates, so a texture has nowhere to land. Triplanar projection maps an image onto it anyway, and the same surface can take a normal map and scene lights.",
        steps: [
          { heading: "The bare level set", body: "Start with the surface alone: the gyroid, sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) = 0, ray-marched from its equation with no mesh. Because it is an implicit surface, the zero set of a function, it has no (u,v) grid, so there is no built-in place to attach an image.", kind: "gyroid" },
          { heading: "Map an image with no UV", body: "Triplanar mapping supplies coordinates where there are none: sample the image three times, projected from the x, y, and z planes using the hit point's position, and blend the three by the surface normal so the best-aligned projection dominates. Here a plasma is mapped onto the gyroid as flat colour. It needs no unwrapping and works on any level set. Drag the tile scale to zoom the pattern.", kind: "tut-tex-flat" },
          { heading: "Add relief and moving light", body: "The same projection can carry a normal map, which perturbs the shading normal for bump relief without changing the geometry, and the surface responds to the scene's Light nodes, evaluated per pixel at the ray hit. The colour is the same plasma as the previous step, but now the surface has raised detail and a light sweeping across it.", kind: "implicit-tex" },
          { heading: "Any equation, any image", body: "The technique isn't tied to one surface or one image. Here the Schwarz P surface, cos x + cos y + cos z = 0, is clad in brick (an albedo and a matching normal map) and lit by a moving lamp, so it reads as a stone lattice. Swap the equation or the texture and the rest follows.", kind: "tut-tex-schwarz" },
        ],
      },
    ],
  },
  {
    id: "algebraic",
    title: "Algebraic geometry",
    blurb: "Zero sets of polynomials: varieties, their level sets, and the singular points that make them interesting.",
    pages: [
      {
        slug: "implicit-surfaces",
        title: "Implicit surfaces and level sets",
        summary: "An equation lhs = rhs draws the level set where the two sides agree. Start with a sphere and build toward a real surface.",
        steps: [
          { heading: "The simplest level set: a sphere", body: "An equation node draws the set of points where its two sides are equal. The most familiar case is x²+y²+z² = 1, the unit sphere: every point at distance one from the origin. Wire the equation into a transformer and the level set is rendered directly, with no mesh, by marching the field on the GPU.", kind: "tut-sphere" },
          { heading: "Put the radius on a slider", body: "Change the right-hand side to r² and feed r from a slider, and the level set resizes as you drag. Grab the r slider in the plot and pull: the sphere grows and shrinks, recomputed every frame from the equation. This is the same move that powers every animated surface, a value in the equation becoming something you can drive.", kind: "tut-sphere-slider" },
          { heading: "A level set with real structure", body: "A sphere is one level set; a torus is the next step. The equation (√(x²+y²) − R)² + z² = ρ² is the set of points at a fixed distance from a circle, which is a torus. It is still one readable equation, but the geometry now has a hole and curvature that vary across the surface. From here the same idea scales up to genuine algebraic varieties.", kind: "tut-torus-level" },
          { heading: "Where two surfaces meet", body: "One equation draws a surface; two equations wired into the same transformer draw the curve where their surfaces cross. Here a sphere and a cylinder of half its radius meet in Viviani's curve, a figure-eight that winds over the sphere. No single lhs = rhs produces it, because it is the intersection of two level sets, not one. The curve is carved from the first surface's mesh by tracking where the second equation changes sign, so the sampling box and resolution control it just as they would a surface.", kind: "tut-intersection-curve" },
        ],
      },
      {
        slug: "singular-points",
        title: "Singular points and nodes",
        summary: "Most algebraic surfaces are smooth, but the interesting ones have singular points. Here is what a node is and how to see it.",
        steps: [
          { heading: "A smooth cubic", body: "A cubic surface of degree three is generically smooth: at every point it has a well-defined tangent plane and a clean normal. Colored by normal direction, the orientation varies continuously across the whole surface. There is no special point anywhere on it.", kind: "tut-cubic-smooth" },
          { heading: "A cubic with nodes", body: "Special members of a family develop singular points. The Cayley cubic has four ordinary double points, places where the surface crosses itself and the tangent plane is undefined. Watch how the surface pinches to sharp points rather than rounding smoothly. These nodes are exactly where the classical theory lives.", kind: "tut-cubic-nodal" },
          { heading: "Light up the singularities", body: "At a node the gradient of the defining function vanishes, because the surface has no single direction of steepest change there. Coloring by gradient magnitude paints those points distinctly: the smooth regions take one band of color and the singular points stand out where the gradient drops to zero. The coloring is reading the singular set directly.", kind: "tut-node-gradient" },
        ],
      },
      {
        slug: "combining-surfaces",
        title: "Combining surfaces",
        summary: "Build compound shapes from simpler ones by multiplying and combining their defining functions.",
        steps: [
          { heading: "A union by multiplication", body: "A product of two defining functions is zero exactly where either factor is zero, so multiplying the left-hand sides of two equations gives their union. Here two spheres combine into one surface; drag the separation slider d to pull them apart and watch them split from a single blob into two, meeting in between. This is the cleanest way to draw several surfaces as a single equation.", kind: "tut-combine-union" },
          { heading: "A product of many", body: "The same trick scales. Multiplying three cylinder equations, one along each axis, gives their union: a single level set that contains all three, intersecting in the curves where they cross. The torus ring in the gallery is this idea with five tori.", kind: "tut-combine-product" },
          { heading: "An intersection", body: "Where a product gives a union, a maximum gives an intersection: max(F, G) is negative only where both F and G are, so its zero set is the boundary of the overlap. Here a sphere is intersected with a box, clipping each surface against the other and leaving sharp edges where they meet. Combining functions this way is constructive solid geometry.", kind: "tut-combine-intersect" },
        ],
      },
      {
        slug: "families-of-curves",
        title: "Families of curves",
        summary: "A parameter turns one equation into a whole family. Sliding it shows how a curve reshapes, splits, and passes through singular cases.",
        steps: [
          { heading: "Slide through a family", body: "The equation y² = x³ + a·x is not one curve but a family, one for each value of a. Drag a and watch the curve change shape: for some values it is a single connected piece, for others it splits into an oval plus a branch, and at a = 0 it pinches into a singular point at the origin. The slider walks you through the whole family, including the special value where the smooth curve degenerates. This family is the elliptic curves, which are studied in number theory.", kind: "tut-curve-family" },
          { heading: "When a family changes type", body: "Some families pass between entirely different kinds of curve. The conic x² + c·y² = 1 is an ellipse when c is positive, a pair of lines as c approaches zero, and a hyperbola when c is negative. Drag c down through zero and watch the closed ellipse stretch, break open, and fly apart into the two branches of a hyperbola. The single parameter c carries you across the classical conic sections.", kind: "tut-conic-family" },
          { heading: "Families of surfaces", body: "The same idea lifts to surfaces. A cubic surface with a parameter t in its constant term deforms as you drag, and at certain values of t the smooth surface develops nodes, the singular points from the earlier page. A family is the natural setting for singularities: they appear at isolated parameter values as the family passes through them. Watch the surface pinch as t crosses those values.", kind: "tut-surface-family" },
        ],
      },
      {
        slug: "quadric-surfaces",
        title: "Quadric surfaces",
        summary: "The degree-2 surfaces are the next step up from the plane: ellipsoids, hyperboloids, paraboloids, and cones. A handful of equations, classified by their signs, cover them all.",
        steps: [
          { heading: "One equation, three surfaces", body: "The central quadrics are all variations of x² + y² + s·z² = 1. When s is positive the surface closes up into an ellipsoid; at s = 0 the z-term vanishes and it becomes an infinite cylinder; when s is negative it opens into a one-sheet hyperboloid, the cooling-tower shape. Drag s through zero and watch one equation pass through all three. The sign of a single coefficient decides the entire character of the surface.", kind: "tut-quadric-morph" },
          { heading: "The saddle", body: "Not every quadric is closed or symmetric. The hyperbolic paraboloid z = x² − y² curves upward in one direction and downward in the perpendicular one, making the saddle, or Pringle, shape. It is the standard example of a surface with no global maximum or minimum, and despite its curvature it is doubly ruled: through every point run two straight lines lying entirely on the surface.", kind: "tut-quadric-saddle" },
          { heading: "The cone", body: "Between the one-sheet and two-sheet hyperboloids sits the cone x² + y² = z², the degenerate quadric where the surface pinches to a single point at the origin. It is the boundary case of the family, the moment a hyperboloid's waist closes to nothing. Slicing a cone with planes, incidentally, is exactly how the ancient Greeks first defined the ellipse, parabola, and hyperbola.", kind: "tut-quadric-cone" },
        ],
      },
      {
        slug: "the-conic-zoo",
        title: "The conic zoo",
        summary: "Every ellipse, parabola, and hyperbola is one equation with six coefficients. Slide them and watch one curve become all of them.",
        steps: [
          { heading: "One equation, every conic", body: "The general conic is A·x² + B·xy + C·y² + D·x + E·y + F = 0. Those six numbers contain every ellipse, parabola, and hyperbola, plus their degenerate cases of crossed and parallel lines. With six sliders on the plot you can steer the whole family by hand. The type is decided by the discriminant B² − 4AC: negative gives an ellipse, zero a parabola, positive a hyperbola. Set A = C = 1 with everything else zero for a circle, then raise B past 2 and the closed curve splits open into a hyperbola as the discriminant crosses zero. The cross term B rotates the axes; D and E slide the center; F sets the size.", kind: "tut-conic-zoo" },
        ],
      },
    ],
  },
  {
    id: "analytic",
    title: "Analytic geometry",
    blurb: "Two senses of the word: the classical coordinate geometry of curves and surfaces, and the modern world of analytic functions beyond polynomials.",
    pages: [
      {
        slug: "function-graphs",
        title: "Function graphs, from a curve to a surface",
        summary: "The classical coordinate-geometry plot: y = f(x), then z = f(x,y), then a surface that moves.",
        steps: [
          { heading: "One input: a curve", body: "With a single input, a graph transformer draws the familiar curve y = f(x). Here f(x) = x·sin(x), with x on the horizontal axis and the output rising vertically. This is the standard y = f(x) plot, sampled and drawn over a domain.", kind: "tut-graph-1d" },
          { heading: "Two inputs: a surface", body: "Add a second input and the graph becomes a surface z = f(x,y), the height of the function above each point of the plane. Here z = sin(x)·cos(y), an egg-carton surface. The jump from curve to surface is just one more input mapped to an axis.", kind: "tut-graph-2d" },
          { heading: "Let it move", body: "Put time into the function and the surface animates. Here a phase t travels outward through sin(√(x²+y²)·1.6 − t), giving concentric ripples that move. Because the expression is evaluated on the GPU, the phase is a live value and the surface updates every frame without rebuilding.", kind: "tut-graph-anim" },
        ],
      },
      {
        slug: "transcendental-level-sets",
        title: "Beyond polynomials",
        summary: "The modern sense: analytic functions like eˣ and sin reach curves and surfaces no polynomial equation can describe.",
        steps: [
          { heading: "An algebraic curve", body: "A polynomial equation draws an algebraic curve. Here x³ − x = y, a cubic in the plane. Polynomial level sets are rigid: a polynomial vanishing along an arc must continue along the whole curve, so they cannot stop, and they meet any line a bounded number of times.", kind: "tut-poly-curve" },
          { heading: "A transcendental curve", body: "Bring in an analytic but non-polynomial function and you reach curves a polynomial cannot describe. Here y = e^(0.35x)·sin(3x), an oscillation whose amplitude grows without bound. It crosses the horizontal axis infinitely often, which no polynomial curve can do. Analytic functions sit strictly above polynomials in what they can draw.", kind: "tut-transcendental" },
          { heading: "An analytic surface", body: "The same freedom applies in 3D. Here z = e^(−0.15r²)·cos(2r), a decaying radial ripple, smooth and analytic everywhere but expressible by no polynomial. The Gaussian envelope flattens the surface toward the edges, a shape that needs the exponential.", kind: "tut-analytic-surface" },
        ],
      },
      {
        slug: "sums-and-series",
        title: "Sums, integrals, and series",
        summary: "Expressions can contain ∑, ∫, and ∏. A partial sum of sines builds a square wave; an integral accumulates area.",
        steps: [
          { heading: "One term", body: "Any expression field accepts the big operators. A Fourier series writes a square wave as a sum of odd sines, (4/π)·∑ sin((2k+1)x)/(2k+1). With a single term it is just one sine, a smooth approximation that misses the corners entirely.", kind: "tut-series-1" },
          { heading: "A few more terms", body: "Raise the upper limit of the sum and more sines join in. With six terms the curve already flattens between the jumps and steepens at them, taking on the shape of a square wave. The summation operator is evaluated as you would expect, recomputed whenever its bounds change.", kind: "tut-series-5" },
          { heading: "Toward the square wave", body: "With sixteen terms the approximation is unmistakably square, flat across each plateau and nearly vertical at the transitions. The small overshoot at each jump that never quite goes away is the Gibbs phenomenon, a genuine feature of the series visible directly in the plot.", kind: "tut-series-15" },
          { heading: "An integral accumulates area", body: "The integral operator takes a moving upper limit too. Plotting F(x) = ∫₀ˣ sin(t²) dt evaluates the accumulated area out to each x, tracing the winding Fresnel-type curve. The integrand sin(t²) oscillates faster as t grows, so the accumulated area wobbles toward a limit.", kind: "tut-integral-area" },
        ],
      },
      {
        slug: "approximating-functions",
        title: "Approximating a function",
        summary: "A power series builds a function out of polynomial terms. Drag the number of terms and watch polynomials grow into sines and exponentials, and see where the trick breaks down.",
        steps: [
          { heading: "Add terms one at a time", body: "The Taylor series of sin(x) adds odd powers with alternating signs: x, then minus x³/6, then plus x⁵/120, and so on. Drag N to add terms. With one term the approximation is a straight line that only matches near zero; as you add terms the polynomial bends to follow the sine further out in both directions, matching it over a wider and wider range. This is the analytic idea made visible: an infinite sum of polynomial pieces reconstructing a function.", kind: "tut-taylor" },
          { heading: "The same for eˣ", body: "The exponential has an even simpler series: 1 + x + x²/2 + x³/6 + ⋯, every power present, all signs positive. Drag N and the polynomial chases the exponential's steep climb, matching it over a widening interval. Like sine, eˣ is entire: its series converges to the function for every real x, no matter how far out you go.", kind: "tut-taylor-exp" },
          { heading: "Where it breaks down", body: "Not every series works everywhere. The geometric series 1 + x + x² + x³ + ⋯ sums exactly to 1/(1−x), but only when |x| < 1. Drag N: inside the interval the partial sums (gold) snap onto the true curve (blue), but past x = 1 they fly off to infinity no matter how many terms you add. This is the radius of convergence, the hard boundary beyond which a power series stops meaning anything, even when the function it came from is perfectly well behaved.", kind: "tut-taylor-radius" },
        ],
      },
      {
        slug: "polar-curves",
        title: "Polar curves",
        summary: "Some curves are clumsy in x and y but effortless in polar form, where a point is given by an angle and a distance. The transformer's polar mode plots r = f(θ) directly.",
        steps: [
          { heading: "Roses", body: "In polar coordinates a point is set by an angle θ and a radius r. The curve r = cos(k·θ) traces a rose: as the angle sweeps once around, the radius swells and shrinks, drawing petals. The count follows a simple rule, odd k gives k petals and even k gives 2k, so dragging the slider between, say, 3 and 4 jumps the flower from three petals to eight.", kind: "tut-polar-rose" },
          { heading: "Cardioids and limaçons", body: "Add a constant to the radius and you get the limaçon family, r = a + cos(θ). At a = 1 it is the cardioid, a heart-shaped curve with a single cusp. Drag a above 1 and the cusp smooths into a dimple; drag it below 1 and an inner loop appears, the curve crossing itself. The offset a tunes the whole family, which shows up wherever one circle rolls around another.", kind: "tut-polar-cardioid" },
          { heading: "Into three dimensions", body: "The same idea extends to spherical coordinates, where two angles and a radius locate a point in space. The transformer's spherical mode draws r = f(θ,φ): a constant radius gives a plain sphere, and letting the angles modulate the radius pushes it out into bumps and lobes. Drag the bump count and the sphere ripples like a sea urchin. Polar thinking scales up as cleanly as it works in the plane.", kind: "tut-spherical" },
        ],
      },
      {
        slug: "the-harmonograph",
        title: "The harmonograph",
        summary: "A pair of decaying sine waves, one per axis, traces the looping figures a pendulum-driven drawing machine makes. Four sliders set the whole dance.",
        steps: [
          { heading: "Two oscillations at right angles", body: "A harmonograph is a Victorian drawing machine: pendulums swing a pen along x and y at the same time, and the slow decay of their swings turns simple oscillation into an intricate spiral. Here x(t) = e^(−d·t)·sin(fx·t) and y(t) = e^(−d·t)·sin(fy·t + φ). The two frequency sliders set how many times the pen crosses in each direction, so a frequency ratio like 3:2 closes into a tidy braided loop while nearby ratios drift and never quite repeat. The phase φ rotates the figure and opens or closes its lobes, and the decay d controls how tightly the curve spirals inward. This is the parametric cousin of the Lissajous figure, with damping added to make it spiral rather than retrace.", kind: "tut-harmonograph" },
        ],
      },
    ],
  },
  {
    id: "differential",
    title: "Differential geometry",
    blurb: "Smooth shape: parametric surfaces, the normal field, curvature, and surfaces built by motion.",
    pages: [
      {
        slug: "parametric-curves-surfaces",
        title: "Parametric curves and surfaces",
        summary: "Instead of one equation, give each coordinate its own formula in a parameter. This draws shapes an equation cannot.",
        steps: [
          { heading: "A curve traced by a parameter", body: "A parametric curve gives x, y, and z each as a function of a single parameter t. As t runs over its interval, the point (x(t), y(t), z(t)) traces a path. Here (cos t, sin t, t/5) winds up a helix. Parametric form draws bounded, self-crossing, and winding shapes that a single equation cannot.", kind: "tut-param-curve" },
          { heading: "Two parameters sweep a surface", body: "Add a second parameter and the formulas (x(u,v), y(u,v), z(u,v)) sweep out a surface as (u,v) range over a rectangle. Here the standard sphere parameterization in spherical angles. Parametric surfaces are GPU-evaluated the same way function graphs are, with the parameters becoming grid coordinates in the shader.", kind: "tut-param-surface" },
          { heading: "Sweep the domain to reveal it", body: "The domain itself can be animated. Drive the upper v-bound from an animator and the surface grows into being as the domain opens, sweeping from a pole down to the full sphere. Because domain bounds are live GPU values, this costs one update per frame rather than a rebuild.", kind: "tut-param-anim" },
        ],
      },
      {
        slug: "curvature-and-normals",
        title: "Curvature and the normal field",
        summary: "Every smooth surface has a normal at each point. Visualizing it makes the surface's curvature and orientation readable.",
        steps: [
          { heading: "Color by the normal", body: "At each point of a smooth surface there is a unit normal, the direction perpendicular to the tangent plane. Coloring by that direction turns orientation into color, so you can read how the surface turns through space. On this torus the normal sweeps through every direction as you go around both the tube and the ring.", kind: "tut-normal-color" },
          { heading: "A surface of revolution", body: "Spin a profile curve around an axis and it sweeps a surface of revolution. Here a wavy profile r(v) = 1.4 + 0.5·sin(3v) is rotated about the vertical axis, parameterized so u runs around and v runs along the profile. Surfaces of revolution are a classical source of examples in differential geometry, with curvature you can predict from the profile alone.", kind: "tut-revolution" },
        ],
      },
      {
        slug: "frames-along-a-curve",
        title: "Frames along a curve",
        summary: "A space curve carries a moving frame at each point. Giving the curve body, and a point that travels it, makes that structure visible.",
        steps: [
          { heading: "Give the curve a tube", body: "A curve on its own is infinitely thin. Sweeping a small circle along it produces a tube, which shows how the curve twists through space. Here a tube wraps a helix: the surface is parameterized by position along the curve and angle around it. The tube is a parametric surface built from the curve.", kind: "tut-frame-tube" },
          { heading: "A point traveling the curve", body: "Animate a parameter and a marker rides along the curve, tracing where the moving frame sits at each instant. The marker is a single point whose position is the curve evaluated at the animated parameter s. This is the picture behind arc-length travel and the frames that differential geometry attaches at each point.", kind: "tut-frame-moving" },
        ],
      },
      {
        slug: "tangent-spaces",
        title: "Tangent spaces and the tangent bundle",
        summary: "At every point of a smooth shape sits a flat space of directions: the tangent line to a curve, the tangent plane to a surface. Collecting one at every point gives the tangent bundle.",
        steps: [
          { heading: "The tangent line", body: "At a point on a curve, the tangent line is the straight line that best matches the curve there, sharing its slope. Drag the contact point along the parabola y = x² and the tangent rides with it, tilting to stay flush. Up close, a smooth curve and its tangent line are nearly indistinguishable; the tangent is the curve's linear approximation, the first thing calculus computes about it.", kind: "tut-tangent-line" },
          { heading: "The tangent plane", body: "On a surface the tangent line becomes a tangent plane: the flat sheet that grazes the surface at one point and matches its slope in every direction. Drag the base point across this saddle and watch the plane tilt to follow. The plane touches at exactly one point and pulls away on both sides, because the saddle curves up one way and down the other. Every smooth surface has one of these at every point.", kind: "tut-tangent-plane" },
          { heading: "The tangent bundle", body: "Now attach a tangent space to every point at once and let each one extend fully. At every point of the circle, the tangent line runs off in both directions, and the whole family of them sweeps out the entire region outside the circle, crowding bright where they bunch up against it and thinning as they fan outward. That swept region, every base point paired with its line of tangent directions, is the tangent bundle. It is the setting for everything that moves along the shape: velocities, vector fields, and flows all live in the tangent bundle, one tangent space per point. The circle itself, the envelope the lines never cross into, sits in the middle.", kind: "tut-tangent-bundle" },
        ],
      },
      {
        slug: "frenet-frame",
        title: "The Frenet frame",
        summary: "A space curve carries a natural set of three perpendicular axes at each point: tangent, normal, and binormal. Together they form a frame that turns as the curve bends and twists.",
        steps: [
          { heading: "Tangent, normal, binormal", body: "The Frenet frame attaches three unit vectors to each point of a curve. The tangent T points along the direction of travel; the normal N points the way the curve is turning; the binormal B = T × N completes a right-handed set, perpendicular to both. Watch the three arrows ride along the helix: they stay mutually perpendicular at every instant, a little coordinate system carried by the curve itself.", kind: "tut-frenet" },
          { heading: "What the frame measures", body: "How the frame turns as it moves encodes the curve's shape entirely. The rate at which T swings toward N is the curvature, how sharply the curve bends; the rate at which B drifts is the torsion, how much the curve twists out of its plane. A curve with zero torsion stays flat; a helix has constant curvature and constant torsion, which is why its frame rotates so steadily. This weaving curve is different: its curvature and torsion change as you go, so the frame visibly speeds its turn through the sharp bends and eases through the gentle stretches. The two numbers, curvature and torsion, determine a space curve up to position.", kind: "tut-frenet-measure" },
        ],
      },
      {
        slug: "curvature-by-hand",
        title: "Curvature you can feel",
        summary: "Two sliders set how a surface bends in each direction. Drag them to move between a bowl, a dome, and a saddle.",
        steps: [
          { heading: "Bend it two ways", body: "The surface z = a·x² − b·y² bends by a along one axis and by b along the other. Drag a and b and watch the shape change character: with both positive you get a saddle, curving up one way and down the other; make them the same sign and it becomes a bowl or a dome. The sign and size of the two curvatures is exactly what differential geometry measures, and here you are setting them directly with your hands. Colored by normal so the bending reads clearly.", kind: "tut-curvature-feel" },
        ],
      },
      {
        slug: "geodesics",
        title: "Geodesics",
        summary: "A geodesic is the straightest possible path on a surface, the generalization of a straight line. On a sphere they are the great circles, the routes airplanes actually fly.",
        steps: [
          { heading: "The straightest path", body: "Pick two points A and B on a sphere and connect them by the straightest route the surface allows: a path that never veers left or right, only forward. That route is the gold arc, and the white marker traces it back and forth so you can see it as a journey. It lies on a great circle, the kind of circle whose plane slices through the sphere's center. On a curved surface this is what 'straight' has to mean, since no actual straight line stays on the sphere.", kind: "tut-geodesic-sphere" },
          { heading: "Beating the obvious route", body: "Here are two points at the same latitude, joined two ways. The pink path follows that line of latitude, the route that looks natural on a globe. The green path is the great-circle geodesic between the same two endpoints, and even though it bows up toward the pole and looks like a detour, it is shorter. That is why long flights arc north instead of running due east: on a sphere the straightest path and the shortest path are the same great circle, and it is not the line that looks straight on a flat map.", kind: "tut-geodesic-compare" },
        ],
      },
      {
        slug: "gaussian-curvature",
        title: "Gaussian curvature and point types",
        summary: "Curvature has a sign. Where a surface domes outward it is positive, where it saddles it is negative, and the sign sorts every point of every surface into three kinds.",
        steps: [
          { heading: "The sign of curvature", body: "At each point a surface bends by some amount in every direction. Multiply the sharpest and gentlest of those bendings together and you get the Gaussian curvature, whose sign tells you the local shape. On this torus the outer rim domes outward in both directions, giving positive curvature (blue); the inner rim saddles, curving up one way and down the other, giving negative curvature (pink); and the top and bottom circles, where the colour crosses over, have zero. One surface holds all three signs at once.", kind: "tut-gauss-curvature" },
          { heading: "Elliptic, parabolic, hyperbolic", body: "The sign sorts every surface point into three types. Drag k through the surface z = x² + k·y². With k positive the point is elliptic, a bowl curving the same way in all directions, with positive Gaussian curvature. At k = 0 it is parabolic, a trough flat along one direction, with zero curvature. With k negative it is hyperbolic, a saddle with negative curvature. Almost every point of every surface is one of these three, and the type is a local invariant you cannot flatten away.", kind: "tut-point-types" },
        ],
      },
      {
        slug: "the-circle-of-curvature",
        title: "The circle of curvature",
        summary: "Curvature is an abstract number until you draw it. The osculating circle is the curve's best-fitting circle at a point, and its radius is exactly one over the curvature.",
        steps: [
          { heading: "Curvature you can measure", body: "How sharply a curve bends at a point is captured by a single number, the curvature κ. The cleanest way to feel it is the osculating circle: the unique circle that hugs the curve at that point, matching its position, its tangent, and its bending. Its radius is exactly 1/κ, so a gently bending curve has a big circle and a sharp turn has a tiny one. Here the curve is a bump, y = a·e^(−(x/w)²), and the circle is drawn at its apex. Drag w to make the bump wider and the circle swells; drag a to make it taller and sharper and the circle shrinks into the peak. At the top of this bump the curvature works out to 2a/w², so the radius is w²/2a, which is exactly what you watch the circle do as you slide the two knobs.", kind: "tut-osculating" },
        ],
      },
    ],
  },
  {
    id: "topology",
    title: "Topology & fractals",
    blurb: "Shape up to deformation: how many handles a surface has, when it has only one side, the knottedness of a loop, and the self-similar forms whose dimension isn't a whole number, built from the engine's lists, parametric surfaces, and ray-marched level sets.",
    pages: [
      {
        slug: "polyhedra-euler",
        title: "Polyhedra and Euler's formula",
        summary: "A polyhedron is just vertices, edges, and faces. Counting them turns up a number that never changes, the first invariant of topology, built here straight from lists.",
        steps: [
          { heading: "A solid from shared data", body: "A cube is eight corners and twelve edges. With first-class Lists you store the eight corner positions once, then give a second list of index pairs naming which corners each edge joins, so the edges reference the vertices rather than copying their coordinates. Edit a corner and every edge that touches it follows, because there is only one copy. The structure of the solid is right there as data: V = 8 vertices, E = 12 edges, and its six square faces give F = 6.", kind: "list-cube" },
          { heading: "Count V − E + F", body: "Take vertices minus edges plus faces. For the cube: 8 − 12 + 6 = 2. That combination, V − E + F, is the Euler characteristic χ. It looks like a coincidence of the cube, until you try it on something else.", kind: "list-cube" },
          { heading: "A different solid, the same number", body: "Here is an octahedron, built the same way from a vertex list and an edge list: V = 6, E = 12, F = 8. Count again: 6 − 12 + 8 = 2. The same χ = 2 as the cube, even though it has different counts in every column.", kind: "tut-octa-list" },
          { heading: "And the simplest of all", body: "The tetrahedron is the smallest polyhedron there is: V = 4, E = 6, F = 4, so 4 − 6 + 4 = 2 once more. Three solids (cube, octahedron, tetrahedron) with three different vertex, edge, and face counts, and every one gives χ = 2. You get 2 for any convex polyhedron at all, because each is topologically a sphere; χ doesn't see the particular shape, only the surface underneath. Deform a polyhedron however you like short of tearing it and the number holds. That invariance, a number attached to a shape that survives deformation, is where algebraic topology begins.", kind: "tut-tetra-list" },
        ],
      },
      {
        slug: "fractals-dimension",
        title: "Self-similarity and dimension",
        summary: "A fractal is a shape assembled from smaller copies of itself. Counting the copies and how much each shrinks gives a dimension that needn't be a whole number.",
        steps: [
          { heading: "A shape made of itself", body: "The Sierpiński octahedron is built by replacing one octahedron with six half-size copies, one at each of its vertices, then doing the same to each of those, over and over. This is depth six: 6⁶ = 46,656 small octahedra. Zoom into any corner and the whole shape appears again, which is what self-similarity means.", kind: "sierpinski" },
          { heading: "A dimension between two and three", body: "If a shape is made of N copies of itself each scaled down by a factor s, its dimension is log N / log s, the rule that gives a line dimension 1 and a square dimension 2. Halve the scale here and six copies appear, so the dimension is log 6 / log 2 ≈ 2.585: between a surface (2) and a solid (3). A non-integer dimension is what 'fractal' refers to.", kind: "sierpinski" },
          { heading: "Structure as data, geometry as a rule", body: "It is built from the same parts as the polyhedra. The 46,656 octahedron centres are generated into three Lists, and one raw-geometry index template stamps an octahedron's eight faces at each centre. The recursion lives as data in the lists; the drawing is one rule repeated, which is how a shape this large stays a small graph rather than a table of coordinates.", kind: "sierpinski" },
          { heading: "A fractal that is exactly two-dimensional", body: "Self-similar dimension need not be irrational, or even fractional. The Sierpiński tetrahedron replaces each tetrahedron with four half-size copies at its corners (N = 4 copies at scale s = 2), so its dimension is log 4 / log 2 = 2, on the nose. It is a true fractal, infinitely detailed and self-similar at every scale, that nonetheless carries the dimension of a plain surface (its faces even tile flat). Here it is drawn as a wireframe straight from a vertex list and an edge-index list, the very construction from the polyhedra page, scaled up to a couple of thousand edges. Different recursion, different dimension, same idea.", kind: "tut-sierp-tetra" },
        ],
      },
      {
        slug: "knots",
        title: "Knots in space",
        summary: "A knot is a closed loop in three dimensions, considered up to deformation without cutting. The simplest one that isn't secretly a circle is the trefoil.",
        steps: [
          { heading: "The trefoil", body: "This closed space curve, (sin t + 2 sin 2t, cos t − 2 cos 2t, −sin 3t), is a trefoil knot. It is knotted: no amount of pushing and bending, short of cutting the strand and rejoining it, will untangle it into a plain circle. The circle (the 'unknot') and the trefoil are different knots, and deciding when two loops are the same knot is the subject of knot theory. The strand is coloured along its parameter t with three RGB expressions, so you can follow it over and under itself at each of its three crossings.", kind: "curve-rgb" },
          { heading: "The figure-eight knot", body: "The next knot up is the figure-eight, written 4₁, here as ((2 + cos 2t)·cos 3t, (2 + cos 2t)·sin 3t, sin 4t). It has four crossings to the trefoil's three, and a property the trefoil lacks: it is amphichiral, identical to its own mirror image, where the trefoil comes in distinct left- and right-handed versions. Unknot, trefoil, figure-eight are three separate classes, no continuous motion carrying any one to another. Telling them apart rigorously is what knot invariants are built to do.", kind: "tut-knot-fig8" },
        ],
      },
      {
        slug: "surface-topology",
        title: "Genus, handles, and one-sided surfaces",
        summary: "Closed surfaces are classified by how many handles they have and whether they have two sides. A torus, a Möbius strip, and a minimal surface span the idea.",
        steps: [
          { heading: "Genus: counting handles", body: "Topologically a torus is a sphere with one handle, so its genus is 1. Genus counts handles, and for orientable closed surfaces it is a complete invariant: two of them can be deformed into each other exactly when their genus matches. It ties straight to the Euler characteristic by χ = 2 − 2g, so the sphere (g = 0) has χ = 2 and the torus (g = 1) has χ = 0, the same χ you counted on the polyhedra, now read off the number of holes.", kind: "tex-paramsurf" },
          { heading: "A surface with only one side", body: "Give a strip a half-twist before joining its ends and you get a Möbius strip. Trace along its middle and you return to where you began having visited 'both' faces without ever crossing the edge, so it has a single side and a single boundary curve. It is the simplest non-orientable surface: the first shape on which you cannot consistently choose a normal direction over the whole thing, which is exactly why the half-twist matters. It's a parametric surface here, lit so the twist reads as the camera circles it.", kind: "tut-mobius" },
          { heading: "A closed one-sided surface", body: "The Möbius strip still has an edge. Glue two Möbius strips together along their boundary circles and the edge disappears: that is the Klein bottle, a closed non-orientable surface. It cannot sit in three dimensions without passing through itself, so this is the standard figure-eight immersion, a surface that seems to plunge through its own wall. A sphere or torus has a clear inside and outside; the Klein bottle has neither, which is non-orientability made into a closed shape.", kind: "tut-klein" },
          { heading: "A minimal surface", body: "Beyond connectivity, curvature distinguishes surfaces. A minimal surface is one that locally minimizes area, balancing its bending so the mean curvature is zero everywhere, so it saddles equally in both directions at every point. The Schwarz P surface, cos x + cos y + cos z = 0, is the classic triply-periodic example: it carves space into two identical interpenetrating networks of channels meeting at right angles, the 'plumber's nightmare'. Boundaryless and of unbounded genus, ray-marched straight from its equation and coloured by orientation.", kind: "tut-schwarz" },
          { heading: "A chiral minimal surface", body: "The gyroid is another triply-periodic minimal surface, with the same zero-mean-curvature property as the Schwarz P but a chiral structure: it is not congruent to its mirror image, where the Schwarz P is. Like the Schwarz P it is boundaryless and of unbounded genus, ray-marched here from its single equation.", kind: "gyroid" },
        ],
      },
    ],
  },
  {
    id: "dynamics",
    title: "Dynamical systems",
    blurb: "How systems change over time: vector fields and continuous flows, discrete iteration, stability, cycles, and the routes into chaos.",
    pages: [
      {
        slug: "vector-fields-and-flow",
        title: "Vector fields and flow",
        summary: "A vector field assigns a direction to every point. Different fields produce different flows, and integrating them traces how things move.",
        steps: [
          { heading: "A field of directions", body: "A two-output map V(x,y) assigns a vector to each point of the plane, drawn here as an arrow per sample. This spiral field, V = (−y + 0.25x, x + 0.25y), circulates while drifting outward. A vector field is the picture behind any rate-of-change law: at each point it says which way to go next.", kind: "tut-vector-field" },
          { heading: "Follow the flow", body: "Seed a set of starting points and integrate the field forward, and each point traces a streamline: the path a particle would follow. Here the trajectories grow out from their seeds and retrace, like particles released into the field, so you can watch the flow develop. The same field that looked like scattered arrows now shows its global swirl.", kind: "tut-streamlines" },
          { heading: "A source", body: "The character of a field shows in its flow. A pure source points straight out from the origin everywhere, so every trajectory radiates outward like spokes: a point everything flows away from. Drag the swirl s and the field gains a rotational component, so the spokes wind into a spiral source while still flowing outward. Watch the straight rays bend into spirals as you drag.", kind: "tut-flow-source" },
          { heading: "A saddle", body: "The field V = (a·x, −y) pulls inward along one axis and pushes outward along the other. Trajectories sweep in from top and bottom, curve, and shoot out left and right. This is a saddle, the flow near an unstable balance point: almost every path eventually leaves, but along one special direction it approaches. Drag a to change how lopsided the saddle is, and watch where the trajectories peel away. Saddles are where the interesting structure of a flow lives.", kind: "tut-flow-saddle" },
          { heading: "A shear", body: "Not every flow swirls or spreads. A pure shear V = (y, 0) moves everything horizontally, faster the higher up you are, so a vertical line of particles tilts and stretches into a slanting sheet. Drag the bend k to add a vertical response, and the straight shear curves toward rotation. Shear is the flow that mixes fluids and stacks of cards alike.", kind: "tut-flow-shear" },
          { heading: "Tune the field", body: "A single parameter can change a flow's whole character. The field V = (−y + a·x, x + a·y) is pure rotation when a is zero: closed circular orbits. Drag a positive and the closed circles open into outward spirals; drag it negative and they wind inward to the origin. The parameter a is the difference between a system that circulates forever and one that decays or blows up.", kind: "tut-flow-morph" },
        ],
      },
      {
        slug: "flows-in-depth",
        title: "Flows in depth",
        summary: "How the flow node renders trajectories, what its outputs mean, and how the same machinery extends to physics and to three dimensions.",
        steps: [
          { heading: "Trajectories as lines", body: "From a handful of seed points, the flow node integrates each forward and draws the separate paths. In line mode you get exactly that: one curve per seed, the discrete trajectories of a few chosen starting points. This is the clearest view when you want to follow specific particles.", kind: "tut-flow-lines" },
          { heading: "Trajectories as a surface", body: "Seed densely along a line and the flow node stitches neighbouring trajectories into a filled stream surface, the sheet swept out by a whole front of particles moving together. Here a swirling field with an upward lift sweeps the seed line into a spiral ramp in three dimensions; the lift breathes in and out and the view orbits so you can read the shape. Same field, same integration as the line view; the difference is whether you see the flow as separate threads or as one continuous sheet.", kind: "tut-flow-surface" },
          { heading: "A phase portrait", body: "Flows are how physics draws a system's whole behavior at once. An undamped pendulum has state (angle, angular velocity) evolving by θ′ = ω, ω′ = −g·sin θ. Its flow is a phase portrait: closed loops near the center are the pendulum swinging back and forth, and the wavy lines across the top are it whirling all the way over. Drag g to change gravity and watch the boundary between swinging and whirling shift. Every possible motion of the pendulum is one streamline in this picture.", kind: "tut-flow-pendulum" },
        ],
      },
      {
        slug: "dense-flows",
        title: "Dense flows",
        summary: "When you integrate many trajectories at once, the field's structure emerges as a continuous texture. These scenes push the seed count high, where parallel GPU integration earns its keep.",
        steps: [
          { heading: "A hundred streamlines", body: "A single streamline tells you one particle's fate; a hundred of them, seeded across the plane, reveal the whole field's flow at a glance. Here a ring of about 150 seeds is integrated at once, each tracing its own path as the field spirals and pulls inward. Integrating this many trajectories is exactly the workload that benefits from advancing every seed in parallel.", kind: "tut-flow-dense2d" },
          { heading: "A finely-sampled surface", body: "Seed a line densely, with scores of points, and the stitched stream surface becomes smooth rather than faceted. The finer the seeding, the more faithfully the swept sheet captures how the flow deforms a front of particles. This is the same stream-surface idea as before, refined to the point where it reads as a continuous ribbon.", kind: "tut-flow-dense-surface" },
          { heading: "A smooth sheet in 3D", body: "The same density pays off in three dimensions. Nearly a hundred seeds along a line, advected through a swirling, rising field, sweep out a smooth helicoidal sheet. At low seed counts this surface looks coarse and angular; sampled finely it becomes the clean spiral ramp the flow really describes.", kind: "tut-flow-dense-grid" },
        ],
      },
      {
        slug: "fixed-points-and-stability",
        title: "Fixed points and stability",
        summary: "A flow's resting points are where the field vanishes. Whether nearby trajectories approach or flee them is the idea of stability.",
        steps: [
          { heading: "A stable spiral", body: "A fixed point is where the field is zero, so a particle placed exactly there never moves. What matters is what happens nearby. For the field V = (−x − ω·y, ω·x − y) every surrounding trajectory winds inward to the origin: it is a stable, attracting fixed point. Perturb the system and it returns. Drag ω to wind the spiral tighter or looser. This is what equilibrium means in a dynamical system.", kind: "tut-fixed-attract" },
          { heading: "An unstable spiral", body: "Flip the signs and the same spiral runs the other way. For V = (x − ω·y, ω·x + y) trajectories wind outward from the origin: the fixed point repels. A particle placed exactly at the origin stays, but the slightest nudge sends it away forever. Drag ω here too. Stable and unstable fixed points look almost identical up close; the difference is the direction of time.", kind: "tut-fixed-repel" },
          { heading: "A center", body: "Between attracting and repelling sits the knife-edge case. For pure rotation V = (−ω·y, ω·x) every trajectory is a closed circle: orbits neither approach nor flee, they circle forever. Drag ω to set how fast they go around. This is a center, the marginal case that separates stability from instability, and the kind of fixed point a frictionless pendulum or an ideal orbit has.", kind: "tut-fixed-center" },
        ],
      },
      {
        slug: "limit-cycles",
        title: "Limit cycles",
        summary: "Some systems settle not to a point but to a loop: an isolated closed orbit that nearby trajectories spiral onto. This is self-sustained oscillation.",
        steps: [
          { heading: "Everything spirals onto one loop", body: "The Van der Pol oscillator, x′ = y, y′ = μ(1−x²)y − x, has the property that whatever starting point you choose, inside or outside, the trajectory spirals onto the same single closed loop. That loop is a limit cycle, an isolated periodic orbit the system is drawn to. Drag μ to change its shape, from a near-circle at small μ to a sharp relaxation oscillation at large μ. Limit cycles model self-sustaining oscillation: heartbeats, fireflies, and electronic oscillators all settle onto one.", kind: "tut-limitcycle" },
        ],
      },
      {
        slug: "iteration-and-dynamics",
        title: "Iteration and dynamical systems",
        summary: "Discrete dynamics: apply a rule over and over and plot what happens, from orbits that settle, to chaos and the butterfly effect, to the strange attractors that 2D maps trace out.",
        steps: [
          { heading: "An orbit of the logistic map", body: "A dynamical system is a rule applied repeatedly. The logistic map xₙ₊₁ = r·xₙ(1−xₙ) is the textbook example. Plotting an orbit as the sequence of values shows the behavior directly: at r = 3.6 the values never settle, bouncing chaotically. A recurrence-mode points node is exactly the tool for this, with each new value computed from the last.", kind: "tut-orbit-logistic" },
          { heading: "Settling to a fixed point", body: "Not every orbit wanders. At a gentler rate, r = 2.8, the same map draws every starting value toward a single number and holds it there: the orbit steps in, overshoots, corrects, and converges to the fixed point 1 − 1/r. This is the discrete cousin of a stable equilibrium, a resting state the system returns to. Whether an orbit settles or wanders is the central question of the whole subject.", kind: "tut-orbit-converge" },
          { heading: "Sensitive dependence", body: "Here is what makes chaos chaos. Two orbits of the logistic map at r = 3.9 start almost on top of each other, just 0.0005 apart. For a dozen steps they track together, then they peel apart and end up completely unrelated. A vanishing difference in where you begin becomes a total difference in where you end: the butterfly effect, drawn as two coloured sequences diverging.", kind: "tut-sensitive" },
          { heading: "A strange attractor", body: "Iterating a 2D map and plotting thousands of points reveals structure that no single point shows. This map folds the plane back on itself each step, and the orbit fills out a fractal attractor: the points never repeat, yet they trace a definite shape. Watch fifteen hundred iterations sketch it in.", kind: "tut-orbit-attractor" },
          { heading: "The Hénon attractor", body: "The Hénon map, x′ = 1 − 1.4x² + y and y′ = 0.3x, is the other classic. Its attractor looks at a glance like a few smooth curves, but zoom in and each curve is itself a bundle of curves, all the way down: a fractal cross-section. It is one of the simplest systems that provably has a strange attractor, and it fills in here over a few thousand steps.", kind: "tut-henon" },
          { heading: "The Gingerbreadman map", body: "Strange attractors need not be smooth. The Gingerbreadman map, x′ = 1 − y + |x| and y′ = x, is piecewise-linear, built only from addition and an absolute value, yet its orbit tiles the plane into a kaleidoscope of polygonal regions. It is chaos with straight edges, a reminder that intricate dynamics can come from almost trivial rules.", kind: "tut-gingerbread" },
        ],
      },
      {
        slug: "tuning-a-system",
        title: "Tuning a system",
        summary: "One parameter can change a system's whole character. Drag the logistic map's growth rate and watch it pass from calm into chaos.",
        steps: [
          { heading: "Period doubling", body: "Below r = 3 the logistic map settles to a single steady value. Raise r past 3.0 and that value goes unstable, replaced by an orbit that alternates between two values forever, a period-2 cycle. Push further and each value splits again into period-4, then period-8, the splits coming faster and faster as r climbs and accumulating toward a critical rate where the period becomes infinite. This is the period-doubling cascade, the staircase from order into chaos.", kind: "tut-logistic-fixed2" },
          { heading: "See it on the map", body: "A cobweb diagram shows why this happens. Draw the map y = r·x(1−x) and the diagonal y = x, then trace the orbit: go up to the curve, across to the diagonal, up to the curve again. The zigzag spirals into a single crossing when the system is stable, settles into a box when it is period-2, and fills the square erratically in the chaotic regime. Drag r and watch the cobweb's character change with the dynamics.", kind: "tut-cobweb" },
          { heading: "From steady to chaotic", body: "Now take the control yourself. Drag r upward from 2.6: the orbit settles to one value, splits to two, to four, and beyond a critical point near 3.57 dissolves into the scattered, never-repeating motion of chaos, with narrow windows of order reappearing as you near 4.0. This is the period-doubling route to chaos, walked through with one slider.", kind: "tut-logistic-r" },
        ],
      },
      {
        slug: "continuous-chaos",
        title: "Continuous chaos: the Lorenz attractor",
        summary: "Chaos is not only a discrete phenomenon. A smooth three-dimensional flow can be chaotic too, and trace a well-known shape.",
        steps: [
          { heading: "The butterfly", body: "The logistic map is chaos in discrete steps; the Lorenz system is chaos in continuous flow. Its three equations, x′ = 10(y−x), y′ = x(28−z)−y, z′ = xy − (8/3)z, came from a stripped-down model of atmospheric convection. A single trajectory, integrated forward, never repeats and never settles, yet it is drawn forever to a definite shape: two spiral wings the path weaves between unpredictably. This is the Lorenz attractor; it is where the phrase “butterfly effect” comes from, the idea that a small change in the start leads to a large difference later. Watch the trajectory draw itself, jumping between the wings with no pattern you can predict.", kind: "tut-lorenz" },
          { heading: "Another shape entirely", body: "Different equations fold space differently, and produce different attractors. The Rössler system, x′ = −y−z, y′ = x + 0.2y, z′ = 0.2 + z(x−5.7), is simpler than Lorenz, with only one nonlinear term, yet it is also chaotic. Its trajectory spirals outward in a nearly flat band, then periodically lifts up and folds back to the center, a stretch-and-fold that is the essential mechanism of chaos. Where Lorenz has two wings, Rössler has one spiral with a fold.", kind: "tut-rossler" },
        ],
      },
      {
        slug: "resonance",
        title: "Resonance",
        summary: "Push a damped oscillator at the right frequency and it answers with a huge swing. The resonance curve shows that answer as a function of how fast you push.",
        steps: [
          { heading: "The resonance peak", body: "Drive a damped oscillator, a mass on a spring, a tuned circuit, a swing being pushed, with a force that oscillates at frequency ω, and after the transients die away it settles into a steady oscillation. The amplitude of that response is A(ω) = F / √((ω₀² − ω²)² + (2ζω₀ω)²), and plotting it against the drive frequency ω gives the resonance curve. It peaks sharply when ω is near the natural frequency ω₀: push at the right rate and a small force produces a large swing. Drag ω₀ and the whole peak slides along the axis, since that is the frequency the system wants to move at. Drag the damping ζ and watch the peak's character change completely, light damping gives a tall narrow spike, a system that rings, while heavy damping flattens it into a broad gentle hump that barely responds. This single curve governs everything from a radio tuning to a bridge swaying in the wind.", kind: "tut-resonance" },
        ],
      },
    ],
  },
];

// Flatten for slug lookup.
function findPage(slug) {
  for (const sec of SECTIONS) {
    const p = sec.pages.find((x) => x.slug === slug);
    if (p) return { section: sec, page: p };
  }
  return null;
}

// ── Index: list of sections and their pages ─────────────────────────────────
function TutorialsIndex({ onOpenPage, onExit }) {
  return (
    <div className="tut-root">
      <header className="tut-head">
        <button className="tut-back" onClick={onExit}>← editor</button>
        <div className="tut-brand"><span className="tut-mark">∂</span> Tutorials</div>
      </header>
      <div className="tut-wrap">
        <h1 className="tut-h1">Learn Dedekind by building</h1>
        <p className="tut-lede">
          Each tutorial builds a concept up one plot at a time. Every plot is the live
          renderer, and every plot opens as a real project you can take apart.
        </p>
        {SECTIONS.map((sec) => (
          <section className="tut-section" key={sec.id}>
            <div className="tut-sec-title">{sec.title}</div>
            <div className="tut-sec-blurb">{sec.blurb}</div>
            <div className="tut-cards">
              {sec.pages.map((p) => (
                <button className="tut-card" key={p.slug} onClick={() => onOpenPage(p.slug)}>
                  <div className="tut-card-t">{p.title}</div>
                  <div className="tut-card-s">{p.summary}</div>
                  <div className="tut-card-go">Start →</div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ── A single tutorial page: prose steps with embedded live plots ─────────────
function TutorialPage({ slug, onBack }) {
  const found = findPage(slug);
  if (!found) {
    return (
      <div className="tut-wrap">
        <p>That tutorial does not exist. <button className="tut-link" onClick={onBack}>Back to tutorials</button></p>
      </div>
    );
  }
  const { section, page } = found;
  return (
    <div className="tut-root">
      <header className="tut-head">
        <button className="tut-back" onClick={onBack}>← all tutorials</button>
        <div className="tut-brand"><span className="tut-mark">∂</span> {section.title}</div>
      </header>
      <div className="tut-wrap">
        <h1 className="tut-h1">{page.title}</h1>
        <p className="tut-lede">{page.summary}</p>
        {page.steps.map((step, i) => (
          <div className="tut-step" key={i}>
            <div className="tut-step-n">{i + 1}</div>
            <div className="tut-step-body">
              <h2 className="tut-h2">{step.heading}</h2>
              <p className="tut-p">{step.body}</p>
              {step.kind && (
                <div className="tut-plot">
                  <LivePreview kind={step.kind} />
                  <button className="tut-open" onClick={() => openDemoProject(step.kind)}>
                    Open this project in the editor →
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div className="tut-foot">
          <button className="tut-link" onClick={onBack}>← Back to all tutorials</button>
        </div>
      </div>
    </div>
  );
}

// ── Router: reads/writes the #tutorials hash, shows index or a page ──────────
// Hash shapes: "#tutorials" (index) and "#tutorials/<slug>" (a page).
function Tutorials({ onExit }) {
  const [slug, setSlug] = useState(() => slugFromHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setSlug(slugFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openPage = (s) => { window.location.hash = "tutorials/" + s; setSlug(s); };
  const backToIndex = () => { window.location.hash = "tutorials"; setSlug(null); };

  if (slug) return <><style>{TUT_CSS}</style><TutorialPage slug={slug} onBack={backToIndex} /></>;
  return <><style>{TUT_CSS}</style><TutorialsIndex onOpenPage={openPage} onExit={onExit} /></>;
}

function slugFromHash(hash) {
  const m = /^#?tutorials\/([\w-]+)$/.exec(hash || "");
  return m ? m[1] : null;
}

// True when the hash is any tutorials route.
function isTutorialsHash(hash) {
  return /^#?tutorials(\/[\w-]+)?$/.test(hash || "");
}

export { Tutorials, isTutorialsHash, SECTIONS };

const TUT_CSS = `
.tut-root{position:fixed;inset:0;z-index:40;overflow-y:auto;background:#0a0c12;color:#c9d1e0;
  font:400 16px/1.7 "Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;}
.tut-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:18px;
  padding:14px 28px;background:rgba(14,17,24,.86);backdrop-filter:blur(10px);
  border-bottom:1px solid #1e2433;}
.tut-back{background:#141823;color:#c9d1e0;border:1px solid #1e2433;border-radius:7px;
  padding:6px 12px;font-size:.86rem;cursor:pointer;}
.tut-back:hover{border-color:#9b8cff;color:#eef2f8;}
.tut-brand{font-family:Georgia,serif;font-weight:600;color:#eef2f8;letter-spacing:.01em;}
.tut-mark{background:linear-gradient(135deg,#9b8cff,#5ad1e6);-webkit-background-clip:text;
  background-clip:text;color:transparent;font-style:italic;margin-right:6px;}
.tut-wrap{max-width:50rem;margin:0 auto;padding:42px 28px 96px;}
.tut-h1{font-family:Georgia,serif;font-weight:600;color:#eef2f8;font-size:2.4rem;
  letter-spacing:-.02em;margin:0 0 .5rem;}
.tut-lede{font-size:1.12rem;color:#8b94a8;line-height:1.6;margin:0 0 2.4rem;max-width:40rem;}
.tut-section{margin:0 0 2.6rem;}
.tut-sec-title{font-family:Georgia,serif;font-size:1.3rem;font-weight:600;color:#eef2f8;margin:0 0 .25rem;}
.tut-sec-blurb{color:#8b94a8;font-size:.95rem;margin:0 0 1rem;}
.tut-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:14px;}
.tut-card{text-align:left;background:#0e1118;border:1px solid #1e2433;border-radius:11px;
  padding:1.1rem 1.2rem;cursor:pointer;transition:border-color .15s,transform .15s;}
.tut-card:hover{border-color:#9b8cff;transform:translateY(-2px);}
.tut-card-t{font-family:Georgia,serif;font-weight:600;color:#eef2f8;font-size:1.08rem;margin:0 0 .35rem;}
.tut-card-s{color:#8b94a8;font-size:.9rem;line-height:1.5;margin:0 0 .8rem;}
.tut-card-go{color:#9b8cff;font-size:.86rem;font-weight:600;}
.tut-step{display:flex;gap:18px;margin:0 0 2.6rem;}
.tut-step-n{flex:0 0 auto;width:2rem;height:2rem;border-radius:50%;display:flex;align-items:center;
  justify-content:center;background:#141823;border:1px solid #2a3550;color:#9b8cff;
  font-weight:600;font-size:.95rem;margin-top:.2rem;}
.tut-step-body{min-width:0;flex:1;}
.tut-h2{font-family:Georgia,serif;font-weight:600;color:#eef2f8;font-size:1.32rem;margin:.1rem 0 .5rem;}
.tut-p{color:#c9d1e0;margin:0 0 1.1rem;}
.tut-plot{border:1px solid #1e2433;border-radius:12px;overflow:hidden;background:#0c0f17;
  aspect-ratio:16/10;position:relative;}
.tut-plot > :first-child{position:absolute;inset:0;}
.tut-open{position:absolute;left:12px;bottom:12px;z-index:3;background:rgba(20,24,35,.9);
  color:#eef2f8;border:1px solid #2a3550;border-radius:8px;padding:7px 12px;font-size:.84rem;
  cursor:pointer;backdrop-filter:blur(6px);}
.tut-open:hover{border-color:#9b8cff;}
.tut-foot{margin-top:1rem;}
.tut-link{background:none;border:none;color:#9b8cff;cursor:pointer;font-size:.95rem;padding:0;}
.tut-link:hover{text-decoration:underline;}
@media (max-width:48rem){
  .tut-h1{font-size:1.9rem;} .tut-step{gap:12px;} .tut-step-n{width:1.7rem;height:1.7rem;font-size:.85rem;}
}
@media (prefers-reduced-motion:reduce){ *{transition:none !important;} }
`;

