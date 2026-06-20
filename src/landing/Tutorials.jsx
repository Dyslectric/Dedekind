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
          { heading: "Named values are visible everywhere", body: "A plot can only evaluate what is wired into it, with one convenience: named scalars (constants, sliders, animators) are also folded into a global scope, so an expression can mention a slider by name without an explicit wire. Here a value k is referenced inside sin(k·x) to control frequency; drag the k slider and the wave tightens and loosens. That global-by-name behavior is why quick experiments stay quick.", kind: "tut-named-scope" },
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
          { heading: "A formula over an index", body: "Instead of listing points, give a formula in an index i and a count, and the node generates a point for each i from zero up. Here a golden-angle spiral places 360 points by i alone, colored by index. This is how you plot a sampled sequence or a parameterized scatter without writing every coordinate.", kind: "tut-points-index" },
          { heading: "A recurrence", body: "A recurrence defines each point from the previous one, written with x[n-1] and y[n-1]. Here a point is rotated and scaled inward at every step, spiralling toward the origin. Recurrences are the natural way to plot orbits and iterated processes, where each state follows from the last.", kind: "tut-points-recursive" },
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
          { heading: "One input: a curve", body: "With a single input, a graph transformer draws the familiar curve y = f(x). Here f(x) = x·sin(x), with x on the horizontal axis and the output rising vertically. This is the plot you have drawn by hand a hundred times, now sampled and drawn over a domain.", kind: "tut-graph-1d" },
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
    ],
  },
  {
    id: "applications",
    title: "Where it applies",
    blurb: "The tool reaches past pure geometry. Vector fields, flows, and the dynamical pictures they produce.",
    pages: [
      {
        slug: "vector-fields-and-flow",
        title: "Vector fields and flow",
        summary: "A vector field assigns a direction to every point. Integrating it traces how things move through the field.",
        steps: [
          { heading: "A field of directions", body: "A two-output map V(x,y) assigns a vector to each point of the plane, drawn here as an arrow per sample. This spiral field, V = (−y + 0.25x, x + 0.25y), circulates while drifting outward. A vector field is the picture behind any rate-of-change law: at each point it says which way to go next.", kind: "tut-vector-field" },
          { heading: "Follow the flow", body: "Seed a set of starting points and integrate the field forward, and each point traces a streamline: the path a particle would follow. The flow node does this with RK4 stepping, stitching the trajectories into a stream surface. The same field that looked like scattered arrows now shows its global swirl.", kind: "tut-streamlines" },
        ],
      },
      {
        slug: "iteration-and-dynamics",
        title: "Iteration and dynamical systems",
        summary: "Discrete dynamics: plot what happens when a rule is applied over and over, from period doubling to strange attractors.",
        steps: [
          { heading: "An orbit of the logistic map", body: "A dynamical system is a rule applied repeatedly. The logistic map xₙ₊₁ = r·xₙ(1−xₙ) is the textbook example. Plotting an orbit as the sequence of values shows the behavior directly: at r = 3.6 the values never settle, bouncing chaotically. A recurrence-mode points node is exactly the tool for this.", kind: "tut-orbit-logistic" },
          { heading: "A strange attractor", body: "Iterating a 2D map and plotting thousands of points reveals structure that no single point shows. This map folds the plane back on itself each step, and the orbit fills out a fractal attractor: the points never repeat, yet they trace a definite shape. Four thousand iterations sketch it.", kind: "tut-orbit-attractor" },
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

