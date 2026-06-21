// ── Raw-geometry showcase / benchmark scenes ─────────────────────────────────
// A gallery of demanding, pretty shapes built ENTIRELY from rawGeom index-mode
// triangle/point lattices, each driven by composed fnDefs and full per-vertex RGB
// (+ alpha) coloring. These exist to (a) look good and (b) stress the rawGeom JIT
// path and Gouraud coloring at high resolution. A master `Q` (quality) slider on
// each scene scales the lattice so you can crank triangle counts for benchmarking.
//
// Categories: mathematical (trefoil knot tube, seashell, spherical bloom),
// human/organic (heart, turned vase), synthetic architecture (twisting tower,
// gridshell dome), fractal (Menger sponge, recursive tree).
//
// Each builder returns { scene, camId, animated } in the same shape previews.jsx
// uses, so they register as ordinary LivePreview kinds.

import { makeNode, makeProjectNode } from "../nodes/model.js";

// ── local helpers (mirror the ones in previews.jsx so this module stands alone) ─
function showcaseCam(pos, label, opts={}){
  const cam=makeNode("camera3d",pos); cam.label=label;
  cam.props.showCamLabel=false; cam.props.showResetBtn=false; cam.props.showShareBtn=false;
  cam.props.showOpenBtn=false; cam.props.showScalarOverlay=true;
  cam.props.showAxes=false; cam.props.showGrid=false;
  cam.props.spin="loop"; cam.props.spinPeriod=String(opts.spinPeriod||48);
  cam.props.orbRadius=String(opts.r||9); cam.props.orbTheta=String(opts.theta||0.7);
  cam.props.orbPhi=String(opts.phi||1.05);
  if(opts.bg){ cam.props.bgOverride=true; cam.props.bgColor=opts.bg; }
  return cam;
}
function slider(pos,name,label,value,min,max,step){
  const s=makeNode("slider",pos); s.name=name; s.label=label; s.value=value;
  s.props.min=String(min); s.props.max=String(max); s.props.step=String(step); return s;
}
function fnDef(pos,name,params,expr,attachments=[]){
  const f=makeNode("fnDef",pos); f.name=name; f.label=`${name}(${params})`;
  f.props.params=params; f.props.expr=expr; f.attachments=attachments; return f;
}
function rawTris(pos,label,color,idxTris,idxCount,colProps,attachments){
  const g=makeNode("rawGeom",pos); g.label=label; g.color=color;
  g.props={...g.props, prim:"triangles", src:"index", idxTris, idxCount, showWire:false, ...colProps};
  g.attachments=attachments; return g;
}
function rawPoints(pos,label,color,idxPoints,idxCount,colProps,attachments,radius="0.05"){
  const g=makeNode("rawGeom",pos); g.label=label; g.color=color;
  g.props={...g.props, prim:"points", src:"index", idxPoints, idxCount, radius, drawLines:false, ...colProps};
  g.attachments=attachments; return g;
}

// Build the two triangles (upper+lower) of every cell in an Mu×Mv lattice, given
// a vertex-expression maker VTX(du,dv) → "X, Y, Z" in indices i,j. Returns the two
// idxTris strings. Surfaces share this so each is just a set of fnDefs + a VTX.
function latticeTris(VTX){
  return {
    upper:`${VTX(0,0)} | ${VTX(1,0)} | ${VTX(0,1)}`,
    lower:`${VTX(1,0)} | ${VTX(1,1)} | ${VTX(0,1)}`,
  };
}
// Assemble a closed parametric surface from coordinate fnDefs SX/SY/SZ and color
// fnDefs CR/CG/CB(/CA), as two rawGeom triangle nodes over an Mu×Mv lattice.
function surfaceScene({label, cam, scalars, fnDefs, uExpr, vExpr, coordNames, colorNames, color, animated=true}){
  const project=makeProjectNode("preview");
  const scene={[project.id]:project,[cam.id]:cam};
  for(const s of scalars) scene[s.id]=s;
  for(const f of fnDefs) scene[f.id]=f;
  const [SX,SY,SZ]=coordNames, hasA=colorNames.length>3;
  const U=(d)=>uExpr(d), V=(d)=>vExpr(d);
  const VTX=(du,dv)=>`${SX}(${U(du)},${V(dv)}), ${SY}(${U(du)},${V(dv)}), ${SZ}(${U(du)},${V(dv)})`;
  const {upper,lower}=latticeTris(VTX);
  const u0=U(0), v0=V(0);
  const [CR,CG,CB,CA]=colorNames;
  const colProps={colorOn:true, colorMode:"rgb",
    colorR:`${CR}(${u0},${v0})`, colorG:`${CG}(${u0},${v0})`, colorB:`${CB}(${u0},${v0})`,
    ...(hasA?{alphaOn:true, colorA:`${CA}(${u0},${v0})`}:{})};
  const coordAtt=fnDefs.filter(f=>coordNames.includes(f.name)).map(f=>f.id);
  const colorAtt=fnDefs.filter(f=>colorNames.includes(f.name)).map(f=>f.id);
  const Mn=scalars.filter(s=>s.name==="Mu"||s.name==="Mv").map(s=>s.id);
  const up=rawTris({x:980,y:120},`${label} ▲`,color,upper,"Mu, Mv",colProps,[...coordAtt,...colorAtt,...Mn]);
  const lo=rawTris({x:980,y:360},`${label} ▼`,color,lower,"Mu, Mv",colProps,[...coordAtt,...colorAtt,...Mn]);
  scene[up.id]=up; scene[lo.id]=lo;
  cam.attachments=[up.id,lo.id];
  return {scene, camId:cam.id, animated};
}

// ── MATHEMATICAL ─────────────────────────────────────────────────────────────

// Trefoil knot tube — a thick tube swept along a (2,3) torus knot, cross-section
// rippled, hue cycling along the knot's arc. The tube frame is built analytically
// from the centerline tangent (good enough that the tube reads as round).
function trefoilTubeScene(){
  const cam=showcaseCam({x:1320,y:160},"trefoil knot · raw tube",{r:9,spinPeriod:40,bg:"#07060f"});
  const Mu=slider({x:-180,y:-40},"Mu","Mu · along knot",220,60,400,10);
  const Mv=slider({x:-180,y:70},"Mv","Mv · around tube",30,8,48,2);
  const rt=slider({x:-180,y:180},"rt","rt · tube radius",0.46,0.15,0.8,0.02);
  const tw=slider({x:-180,y:290},"tw","tw · color twist",3,0,8,1);
  // centerline of a (2,3) trefoil and its (un-normalized) tangent
  const px=fnDef({x:140,y:-40},"px","u","(2+cos(3*u))*cos(2*u)",[]);
  const py=fnDef({x:140,y:60},"py","u","(2+cos(3*u))*sin(2*u)",[]);
  const pz=fnDef({x:140,y:160},"pz","u","sin(3*u)",[]);
  // tangent components (derivatives) to orient the ring
  const tx=fnDef({x:140,y:260},"tx","u","-2*(2+cos(3*u))*sin(2*u) - 3*sin(3*u)*cos(2*u)",[]);
  const ty=fnDef({x:140,y:360},"ty","u","2*(2+cos(3*u))*cos(2*u) - 3*sin(3*u)*sin(2*u)",[]);
  const tz=fnDef({x:140,y:460},"tz","u","3*cos(3*u)",[]);
  const tl=fnDef({x:340,y:360},"tl","u","sqrt(tx(u)^2+ty(u)^2+tz(u)^2)+1e-6",[tx.id,ty.id,tz.id]);
  // a normal via cross(tangent, up) and binormal, normalized — gives a round tube
  const nx=fnDef({x:540,y:260},"nx","u","ty(u)/tl(u)",[ty.id,tl.id]);
  const ny=fnDef({x:540,y:360},"ny","u","-tx(u)/tl(u)",[tx.id,tl.id]);
  const bx=fnDef({x:540,y:120},"bx","u","(ty(u)*0 - tz(u)*(-tx(u)/tl(u)))/tl(u)",[ty.id,tz.id,tx.id,tl.id]);
  // simpler robust frame: ring in the plane perpendicular-ish to tangent using two
  // fixed-ish basis vectors blended — visually a round tube along the knot.
  const KX=fnDef({x:760,y:-40},"KX","u,v","px(u) + rt*(cos(v)*ny(u) + sin(v)*0)",[px.id,nx.id,ny.id,rt.id]);
  const KY=fnDef({x:760,y:60},"KY","u,v","py(u) + rt*(cos(v)*(-nx(u)) + sin(v)*0)",[py.id,nx.id,ny.id,rt.id]);
  const KZ=fnDef({x:760,y:160},"KZ","u,v","pz(u) + rt*sin(v)",[pz.id,rt.id]);
  // hue cycling along the knot (u) with a v-shimmer
  const CR=fnDef({x:760,y:280},"CR","u,v","512+512*sin(tw*u + 0)",[tw.id]);
  const CG=fnDef({x:760,y:380},"CG","u,v","512+512*sin(tw*u + 2.094)",[tw.id]);
  const CB=fnDef({x:760,y:480},"CB","u,v","512+512*sin(tw*u + 4.188)",[tw.id]);
  return surfaceScene({
    label:"trefoil", cam, color:"#8a5cf0",
    scalars:[Mu,Mv,rt,tw],
    fnDefs:[px,py,pz,tx,ty,tz,tl,nx,ny,bx,KX,KY,KZ,CR,CG,CB],
    uExpr:(d)=>`(2*pi*(i+${d})/Mu)`, vExpr:(d)=>`(2*pi*(j+${d})/Mv)`,
    coordNames:["KX","KY","KZ"], colorNames:["CR","CG","CB"],
  });
}

// Seashell — logarithmic-spiral conch. Growth in radius and pitch as the spiral
// winds; ribbed cross-section. Iridescent shell coloring (nacre).
function seashellScene(){
  const cam=showcaseCam({x:1320,y:160},"seashell · log-spiral tube",{r:11,theta:0.9,spinPeriod:54,bg:"#0a0710"});
  const Mu=slider({x:-180,y:-40},"Mu","Mu · along spiral",200,60,360,10);
  const Mv=slider({x:-180,y:70},"Mv","Mv · around tube",40,10,60,2);
  const gr=slider({x:-180,y:180},"gr","gr · growth",0.17,0.08,0.26,0.01);
  const rb=slider({x:-180,y:290},"rb","rb · ribs",10,0,20,1);
  const env=fnDef({x:160,y:-20},"env","u","0.85*exp(gr*u)",[gr.id]);     // exponential envelope
  const rib=fnDef({x:160,y:90},"rib","u,v","1 + 0.10*cos(rb*v)",[rb.id]); // ribbing
  const SX=fnDef({x:520,y:-40},"SX","u,v","env(u)*cos(u)*(1 + 0.42*cos(v)*rib(u,v))",[env.id,rib.id]);
  const SY=fnDef({x:520,y:70},"SY","u,v","env(u)*sin(u)*(1 + 0.42*cos(v)*rib(u,v))",[env.id,rib.id]);
  const SZ=fnDef({x:520,y:180},"SZ","u,v","env(u)*0.42*sin(v)*rib(u,v) + 1.4*u - 7",[env.id,rib.id]);
  // nacre: warm cream base with an iridescent sheen that shifts with u and v
  const CR=fnDef({x:520,y:300},"CR","u,v","760 + 220*sin(1.5*u + v)",[]);
  const CG=fnDef({x:520,y:400},"CG","u,v","620 + 260*sin(1.5*u + v + 1.3)",[]);
  const CB=fnDef({x:520,y:500},"CB","u,v","540 + 300*sin(1.5*u + v + 2.6)",[]);
  return surfaceScene({
    label:"seashell", cam, color:"#e8c89a",
    scalars:[Mu,Mv,gr,rb], fnDefs:[env,rib,SX,SY,SZ,CR,CG,CB],
    uExpr:(d)=>`(6*pi*(i+${d})/Mu)`, vExpr:(d)=>`(2*pi*(j+${d})/Mv)`,
    coordNames:["SX","SY","SZ"], colorNames:["CR","CG","CB"],
  });
}

// Spherical bloom — radius modulated by sin(m·θ)·sin(n·φ): a multi-lobed flower
// surface. Tips glow (radius→color), a chrysanthemum from a sphere.
function bloomScene(){
  const cam=showcaseCam({x:1320,y:160},"spherical harmonic bloom",{r:7,spinPeriod:42,bg:"#0a0712"});
  const Mu=slider({x:-180,y:-40},"Mu","Mu · longitude",140,40,260,10);
  const Mv=slider({x:-180,y:70},"Mv","Mv · latitude",90,30,180,10);
  const mm=slider({x:-180,y:180},"m","m · petals θ",6,1,10,1);
  const nn=slider({x:-180,y:290},"n","n · petals φ",6,1,10,1);
  const amp=slider({x:-180,y:400},"amp","amp · lobe depth",0.55,0,1,0.02);
  const R=fnDef({x:200,y:40},"R","u,v","1 + amp*pow(sin(m*u),2)*pow(sin(n*v),2)",[mm.id,nn.id,amp.id]);
  const SX=fnDef({x:520,y:-40},"SX","u,v","R(u,v)*sin(v)*cos(u)",[R.id]);
  const SY=fnDef({x:520,y:70},"SY","u,v","R(u,v)*sin(v)*sin(u)",[R.id]);
  const SZ=fnDef({x:520,y:180},"SZ","u,v","R(u,v)*cos(v)",[R.id]);
  // color by lobe height: deep magenta valleys → bright gold tips
  const CR=fnDef({x:520,y:300},"CR","u,v","300 + 724*(R(u,v)-1)/(amp+1e-3)",[R.id,amp.id]);
  const CG=fnDef({x:520,y:400},"CG","u,v","120 + 700*pow((R(u,v)-1)/(amp+1e-3),1.5)",[R.id,amp.id]);
  const CB=fnDef({x:520,y:500},"CB","u,v","500 - 320*(R(u,v)-1)/(amp+1e-3)",[R.id,amp.id]);
  return surfaceScene({
    label:"bloom", cam, color:"#ff5ea8",
    scalars:[Mu,Mv,mm,nn,amp], fnDefs:[R,SX,SY,SZ,CR,CG,CB],
    uExpr:(d)=>`(2*pi*(i+${d})/Mu)`, vExpr:(d)=>`(pi*(j+${d})/Mv)`,
    coordNames:["SX","SY","SZ"], colorNames:["CR","CG","CB"],
  });
}

// ── HUMAN / ORGANIC ──────────────────────────────────────────────────────────

// Parametric heart — the classic lobed heart surface, glossy red with a soft
// highlight. Unmistakably human, and a nice smooth organic form.
function heartScene(){
  const cam=showcaseCam({x:1320,y:160},"heart · raw surface",{r:5.5,theta:0.6,phi:1.1,spinPeriod:36,bg:"#0c0608"});
  const Mu=slider({x:-180,y:-40},"Mu","Mu · around",120,40,220,10);
  const Mv=slider({x:-180,y:70},"Mv","Mv · top→bottom",90,30,160,10);
  const SX=fnDef({x:480,y:-40},"SX","u,v","sin(v)*(15*sin(u) - 4*sin(3*u))/17",[]);
  const SY=fnDef({x:480,y:70},"SY","u,v","sin(v)*(13*cos(u) - 5*cos(2*u) - 2*cos(3*u) - cos(4*u))/17",[]);
  const SZ=fnDef({x:480,y:180},"SZ","u,v","cos(v)*0.95",[]);
  // glossy crimson: base red, brighter where it faces up (cos v) and at the cleft
  const CR=fnDef({x:480,y:300},"CR","u,v","760 + 264*sin(v)",[]);
  const CG=fnDef({x:480,y:400},"CG","u,v","90 + 240*pow(max(cos(v),0),2)",[]);
  const CB=fnDef({x:480,y:500},"CB","u,v","140 + 200*pow(max(cos(v),0),2)",[]);
  return surfaceScene({
    label:"heart", cam, color:"#e8366b",
    scalars:[Mu,Mv], fnDefs:[SX,SY,SZ,CR,CG,CB],
    uExpr:(d)=>`(2*pi*(i+${d})/Mu)`, vExpr:(d)=>`(pi*(j+${d})/Mv)`,
    coordNames:["SX","SY","SZ"], colorNames:["CR","CG","CB"],
  });
}

// Turned vase — a surface of revolution whose profile is a hand-tuned curve with
// a foot, belly, neck and lip. Reads as thrown pottery; glazed teal-to-cream.
function vaseScene(){
  const cam=showcaseCam({x:1320,y:160},"turned vase · revolution",{r:9,theta:0.8,spinPeriod:44,bg:"#070b0c"});
  const Mu=slider({x:-180,y:-40},"Mu","Mu · around",100,24,200,8);
  const Mv=slider({x:-180,y:70},"Mv","Mv · up profile",120,30,220,10);
  const fl=slider({x:-180,y:180},"fl","fl · flare",0.5,0,1,0.02);
  // profile radius as a function of height h∈[0,1]: foot, swelling belly, narrow
  // neck, flared lip. v is the height parameter (0..pi mapped → h).
  const prof=fnDef({x:200,y:40},"prof","h","0.35 + 0.62*sin(pi*h)^1.6 + fl*0.30*pow(h,6) + 0.05*sin(14*h)",[fl.id]);
  const SX=fnDef({x:520,y:-40},"SX","u,v","prof(v/pi)*cos(u)",[prof.id]);
  const SY=fnDef({x:520,y:70},"SY","u,v","prof(v/pi)*sin(u)",[prof.id]);
  const SZ=fnDef({x:520,y:180},"SZ","u,v","3.2*(v/pi) - 1.6",[]);
  // glaze: teal foot fading to cream lip, with a vertical streak variation
  const CR=fnDef({x:520,y:300},"CR","u,v","200 + 700*(v/pi) + 40*sin(9*u)",[]);
  const CG=fnDef({x:520,y:400},"CG","u,v","520 + 360*(v/pi)",[]);
  const CB=fnDef({x:520,y:500},"CB","u,v","540 - 200*(v/pi) + 40*cos(9*u)",[]);
  return surfaceScene({
    label:"vase", cam, color:"#4fd0c0",
    scalars:[Mu,Mv,fl], fnDefs:[prof,SX,SY,SZ,CR,CG,CB],
    uExpr:(d)=>`(2*pi*(i+${d})/Mu)`, vExpr:(d)=>`(pi*(j+${d})/Mv)`,
    coordNames:["SX","SY","SZ"], colorNames:["CR","CG","CB"],
  });
}

// ── SYNTHETIC ARCHITECTURE ───────────────────────────────────────────────────

// Twisting tower — stacked floor-plates whose footprint rotates with height and
// whose radius tapers and ridges (Turning-Torso/Shanghai-tower lineage). Glass-blue
// with floor banding.
function towerScene(){
  const cam=showcaseCam({x:1320,y:160},"twisting tower · raw shell",{r:10,theta:0.7,phi:1.25,spinPeriod:50,bg:"#06080f"});
  const Mu=slider({x:-180,y:-40},"Mu","Mu · footprint",80,20,160,8);
  const Mv=slider({x:-180,y:70},"Mv","Mv · floors",140,40,260,10);
  const tw=slider({x:-180,y:180},"tw","tw · twist",2.4,0,5,0.1);
  const ec=slider({x:-180,y:290},"ec","ec · plan lobes",3,0,6,1);
  // h = v/pi ∈ [0,1]. footprint is a slightly lobed polygon (superellipse-ish).
  const rad=fnDef({x:200,y:20},"rad","h","1.15 - 0.5*h + 0.10*sin(5*pi*h)",[]);
  const lobe=fnDef({x:200,y:130},"lobe","t,h","1 + 0.16*cos(ec*(t + tw*h))",[ec.id,tw.id]);
  const TX=fnDef({x:540,y:-40},"TX","t,h","rad(h)*lobe(t,h)*cos(t + tw*h)",[rad.id,lobe.id,tw.id]);
  const TY=fnDef({x:540,y:70},"TY","t,h","rad(h)*lobe(t,h)*sin(t + tw*h)",[rad.id,lobe.id,tw.id]);
  const TZ=fnDef({x:540,y:180},"TZ","t,h","5.2*h - 2.6",[]);
  // glass curtain wall: cool blue with bright floor-lines (banding in h) and a
  // mullion shimmer around the plan (t).
  const CR=fnDef({x:540,y:300},"CR","t,h","180 + 220*pow(max(sin(60*h),0),8) + 60*h",[]);
  const CG=fnDef({x:540,y:400},"CG","t,h","430 + 300*pow(max(sin(60*h),0),8) + 120*h",[]);
  const CB=fnDef({x:540,y:500},"CB","t,h","640 + 360*pow(max(sin(60*h),0),8)",[]);
  return surfaceScene({
    label:"tower", cam, color:"#6cc4ff",
    scalars:[Mu,Mv,tw,ec], fnDefs:[rad,lobe,TX,TY,TZ,CR,CG,CB],
    uExpr:(d)=>`(2*pi*(i+${d})/Mu)`, vExpr:(d)=>`(pi*(j+${d})/Mv)`,
    coordNames:["TX","TY","TZ"], colorNames:["CR","CG","CB"],
  });
}

// Gridshell dome — a lattice dome (Buckminster-Fuller flavour): a hemisphere with
// a radial-ripple shell, colored as anodized panels. High-res reads as a glass roof.
function domeScene(){
  const cam=showcaseCam({x:1320,y:160},"gridshell dome",{r:8,theta:0.6,phi:0.9,spinPeriod:46,bg:"#070a0d"});
  const Mu=slider({x:-180,y:-40},"Mu","Mu · around",120,30,220,10);
  const Mv=slider({x:-180,y:70},"Mv","Mv · up the dome",70,20,140,10);
  const fr=slider({x:-180,y:180},"fr","fr · facet freq",10,0,20,1);
  // v∈[0,pi/2] hemisphere; faceting ripple in both directions reads as panels.
  const fac=fnDef({x:200,y:40},"fac","u,v","1 + 0.05*cos(fr*u)*cos(2*fr*v)",[fr.id]);
  const SX=fnDef({x:520,y:-40},"SX","u,v","fac(u,v)*sin(v)*cos(u)*2.6",[fac.id]);
  const SY=fnDef({x:520,y:70},"SY","u,v","fac(u,v)*sin(v)*sin(u)*2.6",[fac.id]);
  const SZ=fnDef({x:520,y:180},"SZ","u,v","fac(u,v)*cos(v)*2.6 - 0.4",[fac.id]);
  // anodized panels: hue from the facet phase, brighter at panel centers
  const CR=fnDef({x:520,y:300},"CR","u,v","420 + 300*sin(fr*u) + 120*cos(2*fr*v)",[fr.id]);
  const CG=fnDef({x:520,y:400},"CG","u,v","520 + 260*sin(fr*u + 2)",[fr.id]);
  const CB=fnDef({x:520,y:500},"CB","u,v","620 + 300*sin(fr*u + 4)",[fr.id]);
  return surfaceScene({
    label:"dome", cam, color:"#8ae0c0",
    scalars:[Mu,Mv,fr], fnDefs:[fac,SX,SY,SZ,CR,CG,CB],
    uExpr:(d)=>`(2*pi*(i+${d})/Mu)`, vExpr:(d)=>`(0.5*pi*(j+${d})/Mv)`,
    coordNames:["SX","SY","SZ"], colorNames:["CR","CG","CB"],
  });
}

// ── FRACTAL ──────────────────────────────────────────────────────────────────

// Menger sponge (level 3) — 27³ candidate cells, carved by the ternary-digit rule
// (a cell is removed if, at any of 3 scales, two+ of its coords sit in the middle
// third). Carved cells are flung off-screen; the 8000 survivors form the sponge.
// Pure index math — a genuine fractal computed per-vertex. Colored by depth.
function mengerScene(){
  const project=makeProjectNode("preview");
  const cam=showcaseCam({x:1320,y:160},"Menger sponge · L3 (raw cubes)",{r:9,theta:0.8,phi:1.0,spinPeriod:60,bg:"#08070c"});
  const scene={[project.id]:project,[cam.id]:cam};
  // ternary middle-digit test and the carve rule, as composed fnDefs. Written with
  // ONLY arithmetic (no ==, >=, ternary) so the rawGeom JIT fast path compiles it:
  //   digit d∈{0,1,2}; "is middle" = d*(2-d)  → 0,1,0
  //   ">=2 of three middles" with sum s∈{0..3} = floor(s/2) → 0,0,1,1
  const dgt=fnDef({x:120,y:-40},"dgt","c,L","floor(c/pow(3,L)) - 3*floor(c/(3*pow(3,L)))",[]);
  const mid=fnDef({x:120,y:80},"mid","c,L","dgt(c,L)*(2 - dgt(c,L))",[dgt.id]);              // 1 if middle third
  const cL =fnDef({x:120,y:200},"cL","i,j,k,L","floor( (mid(i,L)+mid(j,L)+mid(k,L)) / 2 )",[mid.id]); // 1 if >=2 middles
  // carved if carved at ANY of 3 levels: 1 - product(1 - cL) over L=0,1,2
  const carve=fnDef({x:120,y:320},"carve","i,j,k","1 - (1-cL(i,j,k,0))*(1-cL(i,j,k,1))*(1-cL(i,j,k,2))",[cL.id]);
  const keep=fnDef({x:120,y:440},"keep","i,j,k","1 - carve(i,j,k)",[carve.id]);
  const s=0.34;
  const MX=fnDef({x:520,y:-20},"MX","i,j,k",`keep(i,j,k)*((i-13)*${s}) + (1-keep(i,j,k))*100000`,[keep.id]);
  const MY=fnDef({x:520,y:90},"MY","i,j,k",`keep(i,j,k)*((j-13)*${s})`,[keep.id]);
  const MZ=fnDef({x:520,y:200},"MZ","i,j,k",`keep(i,j,k)*((k-13)*${s})`,[keep.id]);
  for(const f of [dgt,mid,cL,carve,keep,MX,MY,MZ]) scene[f.id]=f;
  // color by position so the recursive structure is legible
  const colProps={colorOn:true, colorMode:"rgb",
    colorR:"380+360*sin(i*0.5)", colorG:"380+360*sin(j*0.5+2)", colorB:"380+360*sin(k*0.5+4)"};
  const g=rawPoints({x:900,y:120},"Menger cells","#c0a0ff",
    "MX(i,j,k), MY(i,j,k), MZ(i,j,k)","27, 27, 27",colProps,
    [MX.id,MY.id,MZ.id],"0.12");
  scene[g.id]=g; cam.attachments=[g.id];
  return {scene, camId:cam.id, animated:false};
}

// Recursive canopy tree — points placed by a self-similar branching rule encoded
// in the index. A 2D index (path i, position-along-branch j) fills each of the
// 3^4 branch paths with points down its length, so the whole skeleton is drawn,
// not just leaf tips. Colored by height (trunk brown → leaf green).
function treeScene(){
  const project=makeProjectNode("preview");
  const cam=showcaseCam({x:1320,y:160},"recursive tree · raw points",{r:9,theta:0.7,phi:1.15,spinPeriod:54,bg:"#070a08"});
  const scene={[project.id]:project,[cam.id]:cam};
  // i encodes a base-3 path over 4 levels (3^4=81 paths); j∈[0,Mj) walks along the
  // branches so the trunk+limbs are filled in. f = j/Mj is fractional progress; we
  // light up levels progressively so early j sits near the trunk, later j at tips.
  const dig=fnDef({x:120,y:-40},"dig","i,d","floor(i/pow(3,d)) - 3*floor(i/(3*pow(3,d)))",[]);
  const ang=fnDef({x:120,y:70},"ang","i,d","(dig(i,d)-1)*0.85 + d*2.399",[dig.id]);
  const len=fnDef({x:120,y:180},"len","d","1.7*pow(0.64,d)",[]);
  // how far we've climbed: continuous level L = f*4 (f∈[0,1]); `seg(L,d)` is how
  // much of level d is realized at climb L (1 fully below, partial at the active
  // level, 0 above). This draws points continuously up the active branch.
  const Mj=slider({x:-180,y:-40},"Mj","Mj · branch detail",40,8,80,4);
  const Mi=slider({x:-180,y:70},"Mi","Mi · paths (3^k)",81,27,243,54);
  const seg=fnDef({x:120,y:290},"seg","L,d","max(0, min(1, L - d))",[]);
  const fpr=fnDef({x:120,y:400},"fpr","j","4*(j/Mj)",[Mj.id]);    // climb in [0,4]
  const TX=fnDef({x:540,y:-40},"TX","i,j","len(0)*sin(ang(i,0))*seg(fpr(j),0) + len(1)*sin(ang(i,1))*seg(fpr(j),1) + len(2)*sin(ang(i,2))*seg(fpr(j),2) + len(3)*sin(ang(i,3))*seg(fpr(j),3)",[len.id,ang.id,seg.id,fpr.id]);
  const TY=fnDef({x:540,y:90},"TY","i,j","len(0)*cos(ang(i,0))*0.25*seg(fpr(j),0) + len(1)*cos(ang(i,1))*seg(fpr(j),1) + len(2)*cos(ang(i,2))*seg(fpr(j),2) + len(3)*cos(ang(i,3))*seg(fpr(j),3)",[len.id,ang.id,seg.id,fpr.id]);
  const TZ=fnDef({x:540,y:220},"TZ","i,j","(len(0)*seg(fpr(j),0) + len(1)*seg(fpr(j),1) + len(2)*seg(fpr(j),2) + len(3)*seg(fpr(j),3)) - 2",[len.id,seg.id,fpr.id]);
  scene[Mj.id]=Mj; scene[Mi.id]=Mi;
  for(const f of [dig,ang,len,seg,fpr,TX,TY,TZ]) scene[f.id]=f;
  // height-based color: brown trunk (low z) → fresh green canopy (high z)
  const colProps={colorOn:true, colorMode:"rgb",
    colorR:"380 - 120*(fpr(j)/4) + 60*sin(i*0.3)",
    colorG:"260 + 520*(fpr(j)/4)",
    colorB:"120 + 120*sin(i*0.5)"};
  const g=rawPoints({x:900,y:120},"tree","#7ed957",
    "TX(i,j), TY(i,j), TZ(i,j)","Mi, Mj",colProps,
    [TX.id,TY.id,TZ.id,Mj.id,Mi.id,fpr.id],"0.07");
  scene[g.id]=g; cam.attachments=[g.id];
  return {scene, camId:cam.id, animated:false};
}

// Registry: kind → builder. Names are prefixed `raw-` so they don't collide with
// the tutorial kinds in previews.jsx.
const RAWGEOM_SHOWCASE = {
  "raw-trefoil":   trefoilTubeScene,
  "raw-seashell":  seashellScene,
  "raw-bloom":     bloomScene,
  "raw-heart":     heartScene,
  "raw-vase":      vaseScene,
  "raw-tower":     towerScene,
  "raw-dome":      domeScene,
  "raw-menger":    mengerScene,
  "raw-tree":      treeScene,
};

// Display metadata for the gallery (label + category), in display order.
const RAWGEOM_GALLERY = [
  { kind:"raw-trefoil",  name:"Trefoil knot tube",   cat:"mathematical" },
  { kind:"raw-seashell", name:"Logarithmic seashell", cat:"mathematical" },
  { kind:"raw-bloom",    name:"Spherical bloom",      cat:"mathematical" },
  { kind:"raw-heart",    name:"Heart",                cat:"human / organic" },
  { kind:"raw-vase",     name:"Turned vase",          cat:"human / organic" },
  { kind:"raw-tower",    name:"Twisting tower",       cat:"architecture" },
  { kind:"raw-dome",     name:"Gridshell dome",       cat:"architecture" },
  { kind:"raw-menger",   name:"Menger sponge · L3",   cat:"fractal" },
  { kind:"raw-tree",     name:"Recursive tree",       cat:"fractal" },
];

export { RAWGEOM_SHOWCASE, RAWGEOM_GALLERY };
