import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { resolveNum, safeEval, linspace } from "../core/math.js";
import { exprToGLSL, _glslNum } from "./glsl.js";
import { hexToThree, makeSurfaceShader } from "./three-helpers.js";

// Target on-screen thickness for 1-space curves in 3D cameras (CSS pixels).
const CURVE_3D_PX = 2.6;

// Attempt a GPU-evaluated surface. Returns [mesh, wire] or null if the
// expression(s) can't be translated to GLSL.
function buildSurfGPU(kind, p, scope, color){
  // a parametrized grid of (u,v) or (x,y) in [0,1]^2 mapped to the domain
  let bodyP, uniforms=new Set(), umin, umax, vmin, vmax, ures, vres;
  if(kind==="surf3d"){
    const gx=exprToGLSL(p.expr, new Set(["x","y"]), uniforms);
    if(gx==null) return null;
    umin=resolveNum(p.xMin,scope,-4); umax=resolveNum(p.xMax,scope,4);
    vmin=resolveNum(p.yMin,scope,-4); vmax=resolveNum(p.yMax,scope,4);
    const res=Math.max(2,Math.min(256,resolveNum(p.res,scope,40))); ures=res; vres=res;
    // d.x∈[0,1]→x, d.y∈[0,1]→y, z=f(x,y)
    bodyP = `x = ${_glslNum(umin)} + d.x*${_glslNum(umax-umin)};
             y = ${_glslNum(vmin)} + d.y*${_glslNum(vmax-vmin)};
             float zz = ${gx}; vec3 P = vec3(x, y, zz);`;
  } else if(kind==="paramsurf"){
    const sx=exprToGLSL(p.exprX,new Set(["u","v"]),uniforms);
    const sy=exprToGLSL(p.exprY,new Set(["u","v"]),uniforms);
    const sz=exprToGLSL(p.exprZ,new Set(["u","v"]),uniforms);
    if(sx==null||sy==null||sz==null) return null;
    umin=resolveNum(p.uMin,scope,0); umax=resolveNum(p.uMax,scope,Math.PI*2);
    vmin=resolveNum(p.vMin,scope,0); vmax=resolveNum(p.vMax,scope,Math.PI);
    ures=Math.max(2,Math.min(256,resolveNum(p.uRes,scope,40)));
    vres=Math.max(2,Math.min(256,resolveNum(p.vRes,scope,30)));
    bodyP = `float u = ${_glslNum(umin)} + d.x*${_glslNum(umax-umin)};
             float v = ${_glslNum(vmin)} + d.y*${_glslNum(vmax-vmin)};
             vec3 P = vec3(${sx}, ${sy}, ${sz});`;
  } else return null;

  // Build a unit grid geometry; the shader maps positions through the domain.
  const geo = new THREE.PlaneGeometry(1,1, ures-1, vres-1);
  // PlaneGeometry spans [-0.5,0.5]; shift to [0,1].
  const arr = geo.attributes.position.array;
  for(let i=0;i<arr.length;i+=3){ arr[i]+=0.5; arr[i+1]+=0.5; arr[i+2]=0; }
  geo.attributes.position.needsUpdate = true;

  const uNames=[...uniforms];
  const matFill = makeSurfaceShader(bodyP, uNames, scope, color, false);
  const matWire = makeSurfaceShader(bodyP, uNames, scope, color, true);
  matWire.uniforms.uColor.value = new THREE.Color(hexToThree(color)).multiplyScalar(1.4);
  const mesh = new THREE.Mesh(geo, matFill);
  const wire = new THREE.Mesh(geo.clone(), matWire);
  mesh._gpuSurface = wire._gpuSurface = { uNames };
  return [mesh, wire];
}
function buildFn1dGPU(p, scope, color){
  // buildFn1dGPU can't use a custom vertex shader with LineMaterial (which has
  // its own), so fall back to CPU sampling + buildCurve3d for thick lines.
  const xmin=resolveNum(p.xMin,scope,-5), xmax=resolveNum(p.xMax,scope,5);
  const res=Math.max(2,Math.min(2000,resolveNum(p.res,scope,300)));
  const xs=linspace(xmin,xmax,res);
  // Evaluate y = expr(x) in scope. safeEval handles errors → NaN.
  const pts=xs.map(x=>{
    const y=safeEval(p.expr,{...scope,x});
    return (y!=null&&isFinite(y))?[x,y,0]:[NaN,NaN,NaN];
  });
  return buildCurve3d(pts, color);
}

function buildCurve3d(pts,color,cols=null){
  // Split at NaN gaps into continuous segments, then build each as a Line2
  // (screen-space fat line) so the width is a true CSS-pixel value on all
  // WebGL drivers (LineBasicMaterial.linewidth is ignored on most hardware).
  const segs=[]; let cur=[];
  for(let i=0;i<pts.length;i++){
    const p=pts[i];
    if(p&&p.every(isFinite)) cur.push({v:p, c:cols?cols[i]:null});
    else { if(cur.length>1)segs.push(cur); cur=[]; }
  }
  if(cur.length>1)segs.push(cur);

  const c3=new THREE.Color(hexToThree(color));
  return segs.map(s=>{
    const geo=new LineGeometry();
    // LineGeometry expects a flat [x,y,z, x,y,z, ...] array in world order.
    // buildCurve3d receives math-order [X,Y,Z]; apply the (x,z,y) world swap here.
    const pos=new Float32Array(s.length*3);
    for(let k=0;k<s.length;k++){
      const [mx,my,mz]=s[k].v;
      pos[k*3]=mx; pos[k*3+1]=mz; pos[k*3+2]=my;
    }
    geo.setPositions(pos);

    const useCol=!!cols;
    if(useCol){
      const ca=new Float32Array(s.length*3);
      for(let k=0;k<s.length;k++){const c=s[k].c||[1,1,1];ca[k*3]=c[0];ca[k*3+1]=c[1];ca[k*3+2]=c[2];}
      geo.setColors(ca);
    }

    const mat=new LineMaterial({
      color: useCol ? 0xffffff : c3.getHex(),
      vertexColors: useCol,
      linewidth: CURVE_3D_PX,
      worldUnits: false,   // linewidth in CSS pixels, not world units
      resolution: new THREE.Vector2(800,600), // overwritten by Viewport3D on resize
    });
    mat._isCurve3d = true; // sentinel for Viewport3D ResizeObserver
    const line=new Line2(geo,mat);
    line.computeLineDistances();
    return line;
  });
}
function buildSurf(rows,color,colRows=null){
  const nv=rows.length,nu=rows[0].length,pos=[],idx=[],colArr=[];
  const useCol=!!colRows;
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
    const p=rows[j][i];pos.push(p?p[0]:0,p?p[2]:0,p?p[1]:0);
    if(useCol){const c=(colRows[j]&&colRows[j][i])||[1,1,1];colArr.push(c[0],c[1],c[2]);}
  }
  for(let j=0;j<nv-1;j++)for(let i=0;i<nu-1;i++){const a=j*nu+i,b=j*nu+i+1,c=(j+1)*nu+i,d=(j+1)*nu+i+1;if([a,b,c,d].every(k=>{const p=rows[Math.floor(k/nu)][k%nu];return p&&p.every(isFinite);}))idx.push(a,b,c,b,d,c);}
  if(!idx.length)return[];
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  if(useCol) g.setAttribute("color",new THREE.Float32BufferAttribute(colArr,3));
  g.setIndex(idx);g.computeVertexNormals();
  const c3=hexToThree(color);
  const mat=new THREE.MeshPhongMaterial({color:useCol?0xffffff:c3,vertexColors:useCol,side:THREE.DoubleSide,transparent:true,opacity:0.82,shininess:40});
  return[new THREE.Mesh(g,mat),new THREE.LineSegments(new THREE.WireframeGeometry(g),new THREE.LineBasicMaterial({color:c3,transparent:true,opacity:0.18}))];
}
function buildPlane3d(center,normal,size,color){
  const n=new THREE.Vector3(...normal).normalize(),geo=new THREE.PlaneGeometry(size,size,12,12),c3=hexToThree(color);
  const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:c3,transparent:true,opacity:0.2,side:THREE.DoubleSide}));
  const edge=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:c3,transparent:true,opacity:0.55}));
  const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),n);
  [mesh,edge].forEach(o=>{o.quaternion.copy(q);o.position.set(...center);}); return[mesh,edge];
}
function buildPoint3d(x,y,z,color,r=0.08){
  const m=new THREE.Mesh(new THREE.SphereGeometry(r,12,10),new THREE.MeshPhongMaterial({color:hexToThree(color),shininess:60}));
  m.position.set(x,z,y); return[m];
}
function buildPointSeq3d(pts, color, r=0.07, drawLines=true) {
  const objs = [];
  const mat = new THREE.MeshPhongMaterial({color:hexToThree(color),shininess:60});
  const lineMat = new THREE.LineBasicMaterial({color:hexToThree(color),opacity:0.7,transparent:true});
  const valid = pts.filter(p=>p&&p.every(isFinite));
  for(const [x,y,z] of valid) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r,8,7),mat);
    m.position.set(x,z,y); objs.push(m);
  }
  if(drawLines && valid.length>1){
    const g = new THREE.BufferGeometry().setFromPoints(valid.map(([x,y,z])=>new THREE.Vector3(x,z,y)));
    objs.push(new THREE.Line(g,lineMat));
  }
  return objs;
}

// GPU-accelerated point cloud: a single InstancedMesh of spheres for all points
// plus one connecting Line. Per-point colours optional (cols: array of [r,g,b]
// 0..1 or hex). The returned array carries _gpuPoints metadata so sequencing can
// reveal points by setting instanceCount without rebuilding. World axis swap
// (x, z, y) matches the rest of the renderer.
function buildPointSeqGPU(pts, color, r=0.07, drawLines=true, cols=null){
  const valid=[]; const validCols=[];
  for(let i=0;i<pts.length;i++){
    const p=pts[i];
    if(p&&p.length>=3&&isFinite(p[0])&&isFinite(p[1])&&isFinite(p[2])){ valid.push(p); if(cols) validCols.push(cols[i]); }
  }
  const n=valid.length;
  if(!n) return [];
  const sphere=new THREE.SphereGeometry(r,10,8);
  // InstancedMesh per-instance color comes from setColorAt → instanceColor, NOT
  // vertexColors (which would expect a per-vertex attribute on the sphere geo).
  // Base color white so instance colors aren't tinted; uses node color when no cols.
  const mat=new THREE.MeshPhongMaterial({color:cols?0xffffff:hexToThree(color),shininess:60});
  const inst=new THREE.InstancedMesh(sphere,mat,n);
  const m=new THREE.Matrix4();
  const useCol=!!cols;
  for(let i=0;i<n;i++){
    const [x,y,z]=valid[i];
    m.makeTranslation(x,z,y);
    inst.setMatrixAt(i,m);
    if(useCol){
      const c=validCols[i];
      const col = c==null ? new THREE.Color(hexToThree(color))
                 : (Array.isArray(c) ? new THREE.Color(c[0],c[1],c[2]) : new THREE.Color(hexToThree(c)));
      inst.setColorAt(i,col);
    }
  }
  inst.instanceMatrix.needsUpdate=true;
  if(inst.instanceColor) inst.instanceColor.needsUpdate=true;
  inst.frustumCulled=false;
  inst._gpuPoints={count:n};       // marker for sequencing + GPU classification
  inst._fullCount=n;
  const objs=[inst];
  if(drawLines && n>1){
    const lineMat=new THREE.LineBasicMaterial({color:hexToThree(color),opacity:0.7,transparent:true});
    const g=new THREE.BufferGeometry().setFromPoints(valid.map(([x,y,z])=>new THREE.Vector3(x,z,y)));
    const line=new THREE.Line(g,lineMat); line._fullCount=n;
    objs.push(line);
  }
  return objs;
}
function buildQuiver3d(p,exprX,exprY,exprZ,gridN,xMin,xMax,yMin,yMax,zMin,zMax,color,scope,normalize){
  const objs=[],c3=hexToThree(color);
  const shaftMat=new THREE.LineBasicMaterial({color:c3,opacity:0.8,transparent:true});
  const coneMat=new THREE.MeshBasicMaterial({color:c3,opacity:0.8,transparent:true,side:THREE.DoubleSide});
  const xs=linspace(xMin,xMax,gridN),ys=linspace(yMin,yMax,gridN),zs=linspace(zMin,zMax,gridN);
  let maxMag=0; const raw=[];
  for(const x of xs)for(const y of ys)for(const z of zs){
    const sc={...scope,x,y,z};const vx=safeEval(exprX,sc)??0,vy=safeEval(exprY,sc)??0,vz=exprZ?(safeEval(exprZ,sc)??0):0;
    const mag=Math.sqrt(vx*vx+vy*vy+vz*vz);raw.push({x,y,z,vx,vy,vz,mag});if(mag>maxMag)maxMag=mag;
  }
  if(maxMag===0)maxMag=1;
  const spX=(xMax-xMin)/(gridN-1||1),spY=(yMax-yMin)/(gridN-1||1),spZ=(zMax-zMin)/(gridN-1||1);
  const arrowLen=Math.min(spX,spY,spZ)*0.42;
  for(const{x,y,z,vx,vy,vz,mag}of raw){
    if(mag<1e-10)continue;
    const scale=normalize?arrowLen:arrowLen*(mag/maxMag);
    const dx=(vx/mag)*scale,dy=(vy/mag)*scale,dz=(vz/mag)*scale;
    const pts=[new THREE.Vector3(x,z,y),new THREE.Vector3(x+dx,z+dz,y+dy)];
    const g=new THREE.BufferGeometry().setFromPoints(pts);objs.push(new THREE.Line(g,shaftMat));
    const cg=new THREE.ConeGeometry(scale*0.18,scale*0.38,5);const cm=new THREE.Mesh(cg,coneMat);
    cm.position.set(x+dx,z+dz,y+dy);
    const dir=new THREE.Vector3(dx,dz,dy).normalize(),up=new THREE.Vector3(0,1,0);
    if(Math.abs(dir.dot(up))<0.999)cm.quaternion.setFromUnitVectors(up,dir);
    objs.push(cm);
  }
  return objs;
}

// ── GPU quiver ───────────────────────────────────────────────────────────────
// Evaluates the vector field in the vertex shader at each grid point and
// orients/scales an arrow instance accordingly. One InstancedMesh draw call for
// all arrows instead of hundreds of Line+Cone objects. Returns null if the
// field expressions aren't GLSL-translatable (→ CPU fallback).
function buildQuiver3dGPU(p, scope, color){
  const uniforms=new Set();
  const gx=exprToGLSL(p.exprX, new Set(["x","y","z"]), uniforms);
  const gy=exprToGLSL(p.exprY, new Set(["x","y","z"]), uniforms);
  const gz=p.exprZ ? exprToGLSL(p.exprZ, new Set(["x","y","z"]), uniforms) : "0.0";
  if(gx==null||gy==null||gz==null) return null;
  const gridN=Math.max(2,Math.min(20,Math.round(resolveNum(p.gridN,scope,5))));
  const xMin=resolveNum(p.xMin,scope,-3),xMax=resolveNum(p.xMax,scope,3);
  const yMin=resolveNum(p.yMin,scope,-3),yMax=resolveNum(p.yMax,scope,3);
  const zMin=resolveNum(p.zMin,scope,-3),zMax=resolveNum(p.zMax,scope,3);
  const normalize=p.normalize!==false;
  const sp=Math.min((xMax-xMin),(yMax-yMin),(zMax-zMin))/(gridN-1||1);
  const arrowLen=sp*0.42;

  // Arrow template pointing +Y: a thin cylinder shaft + a cone head, merged.
  const tmpl=new THREE.CylinderGeometry(arrowLen*0.04, arrowLen*0.04, arrowLen*0.7, 5);
  tmpl.translate(0, arrowLen*0.35, 0);
  const head=new THREE.ConeGeometry(arrowLen*0.16, arrowLen*0.32, 6);
  head.translate(0, arrowLen*0.86, 0);
  const tpos=tmpl.toNonIndexed().attributes.position.array;
  const hpos=head.toNonIndexed().attributes.position.array;
  const merged=new Float32Array(tpos.length+hpos.length);
  merged.set(tpos,0); merged.set(hpos,tpos.length);
  tmpl.dispose(); head.dispose();

  const geo=new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(merged,3));
  const count=gridN*gridN*gridN;
  const base=new Float32Array(count*3);
  let k=0;
  for(let i=0;i<gridN;i++)for(let j=0;j<gridN;j++)for(let l=0;l<gridN;l++){
    base[k++]=xMin+(xMax-xMin)*(i/(gridN-1||1));
    base[k++]=yMin+(yMax-yMin)*(j/(gridN-1||1));
    base[k++]=zMin+(zMax-zMin)*(l/(gridN-1||1));
  }
  geo.setAttribute("iBase", new THREE.InstancedBufferAttribute(base,3));
  geo.instanceCount=count;

  const uobj={ uColor:{value:new THREE.Color(hexToThree(color))}, uMaxMag:{value:1.0}, uNorm:{value:normalize?1.0:0.0} };
  for(const u of uniforms) uobj[u]={value:Number(scope[u])||0};
  const decls=[...uniforms].map(u=>`uniform float ${u};`).join("\n");
  const vert=`
    ${decls}
    attribute vec3 iBase;
    uniform vec3 uColor; uniform float uMaxMag; uniform float uNorm;
    varying float vMag;
    vec3 field(float x, float y, float z){ return vec3(${gx}, ${gy}, ${gz}); }
    mat3 rotToDir(vec3 dir){
      vec3 up=vec3(0.0,1.0,0.0); vec3 a=normalize(dir);
      float c=dot(up,a); vec3 v=cross(up,a); float s=length(v);
      if(s<1e-6){ return c>0.0?mat3(1.0):mat3(-1.0,0.0,0.0, 0.0,-1.0,0.0, 0.0,0.0,1.0); }
      v=normalize(v); float ic=1.0-c;
      return mat3(
        c+v.x*v.x*ic,      v.x*v.y*ic+v.z*s,  v.x*v.z*ic-v.y*s,
        v.y*v.x*ic-v.z*s,  c+v.y*v.y*ic,      v.y*v.z*ic+v.x*s,
        v.z*v.x*ic+v.y*s,  v.z*v.y*ic-v.x*s,  c+v.z*v.z*ic);
    }
    void main(){
      vec3 fv = field(iBase.x, iBase.y, iBase.z);
      float mag = length(fv); vMag = mag;
      vec3 dir = (mag>1e-9) ? normalize(vec3(fv.x, fv.z, fv.y)) : vec3(0.0,1.0,0.0);
      float scl = uNorm>0.5 ? 1.0 : clamp(mag/max(uMaxMag,1e-6), 0.0, 1.0);
      vec3 world = rotToDir(dir) * (position*scl) + vec3(iBase.x, iBase.z, iBase.y);
      if(mag<1e-9){ gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
      gl_Position = projectionMatrix * modelViewMatrix * vec4(world,1.0);
    }`;
  const frag=`precision highp float; uniform vec3 uColor; varying float vMag;
    void main(){ gl_FragColor=vec4(uColor, 0.85); }`;
  const mat=new THREE.ShaderMaterial({uniforms:uobj,vertexShader:vert,fragmentShader:frag,transparent:true,side:THREE.DoubleSide});
  mat._uniformNames=[...uniforms];
  if(!normalize){
    let mx=0; const sc={...scope}; const stepN=Math.max(1,Math.floor(gridN/4));
    for(let i=0;i<gridN;i+=stepN)for(let j=0;j<gridN;j+=stepN)for(let l=0;l<gridN;l+=stepN){
      sc.x=xMin+(xMax-xMin)*(i/(gridN-1||1)); sc.y=yMin+(yMax-yMin)*(j/(gridN-1||1)); sc.z=zMin+(zMax-zMin)*(l/(gridN-1||1));
      const vx=safeEval(p.exprX,sc)??0,vy=safeEval(p.exprY,sc)??0,vz=p.exprZ?(safeEval(p.exprZ,sc)??0):0;
      const m=Math.sqrt(vx*vx+vy*vy+vz*vz); if(m>mx)mx=m;
    }
    uobj.uMaxMag.value=mx||1;
  }
  const mesh=new THREE.Mesh(geo,mat); mesh.frustumCulled=false;
  mesh._gpuSurface={uNames:[...uniforms]};
  return [mesh];
}

// ── Instanced glyph field: explicit (seed, vector) pairs ─────────────────────
// One InstancedMesh draw call for all arrows. Per-instance attributes carry the
// base position and vector; the vertex shader orients & scales each arrow.
// A uTime uniform drives flow animation: arrows can pulse and a bright crest
// travels along each one, reading as a flowing vector field. Geometry is static
// (the pairs), so animation is just a uniform update — no rebuild per frame.
function buildGlyphFieldGPU(pairs, color, opts={}){
  if(!pairs.length) return [];
  const arrowLen = opts.arrowLen ?? 0.5;
  // Length mode: "uniform" (every arrow = arrowLen), "scaled" (arrowLen * mag/maxMag),
  // or "raw" (length = |vec| directly, ignoring arrowLen and maxMag). Falls back to
  // the legacy boolean `normalize` (true→uniform, false→scaled) when absent.
  const lenMode = opts.lenMode || (opts.normalize===false ? "scaled" : "uniform");
  const anim = opts.anim || "none";        // none | pulse | crest | advect
  // Arrow template pointing +Y, parametrised so the shader knows axial position
  // (t in [0,1] along the shaft) for the travelling crest.
  const tmpl=new THREE.CylinderGeometry(arrowLen*0.045, arrowLen*0.045, arrowLen*0.7, 6);
  tmpl.translate(0, arrowLen*0.35, 0);
  const head=new THREE.ConeGeometry(arrowLen*0.17, arrowLen*0.34, 7);
  head.translate(0, arrowLen*0.85, 0);
  const tpos=tmpl.toNonIndexed().attributes.position.array;
  const hpos=head.toNonIndexed().attributes.position.array;
  const merged=new Float32Array(tpos.length+hpos.length);
  merged.set(tpos,0); merged.set(hpos,tpos.length);
  // axial parameter (y/arrowLen) per template vertex for the crest highlight
  const axial=new Float32Array(merged.length/3);
  for(let i=0;i<axial.length;i++) axial[i]=Math.min(1,Math.max(0,merged[i*3+1]/arrowLen));
  tmpl.dispose(); head.dispose();

  const n=pairs.length;
  const iPos=new Float32Array(n*3), iVec=new Float32Array(n*3), iPhase=new Float32Array(n);
  const useVCol=!!opts.cols;
  const iCol=useVCol?new Float32Array(n*3):null;
  let maxMag=0;
  for(let i=0;i<n;i++){
    const {pos,vec}=pairs[i];
    iPos[i*3]=pos[0]; iPos[i*3+1]=pos[1]; iPos[i*3+2]=pos[2];
    iVec[i*3]=vec[0]; iVec[i*3+1]=vec[1]; iVec[i*3+2]=vec[2];
    iPhase[i]=i*0.137; // staggered phase so the flow ripples through the set
    if(useVCol){const c=opts.cols[i]||[1,1,1];iCol[i*3]=c[0];iCol[i*3+1]=c[1];iCol[i*3+2]=c[2];}
    const m=Math.hypot(vec[0],vec[1],vec[2]); if(m>maxMag) maxMag=m;
  }
  if(maxMag===0) maxMag=1;

  const geo=new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(merged,3));
  geo.setAttribute("axial", new THREE.BufferAttribute(axial,1));
  geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(iPos,3));
  geo.setAttribute("iVec", new THREE.InstancedBufferAttribute(iVec,3));
  geo.setAttribute("iPhase", new THREE.InstancedBufferAttribute(iPhase,1));
  if(useVCol) geo.setAttribute("iColor", new THREE.InstancedBufferAttribute(iCol,3));
  geo.instanceCount=n;

  const ANIM={none:0,pulse:1,crest:2,advect:3}[anim]||0;
  const LENMODE={uniform:0,scaled:1,raw:2}[lenMode]??0;
  const uobj={
    uColor:{value:new THREE.Color(hexToThree(color))},
    uCrest:{value:new THREE.Color(hexToThree(opts.crestColor||"#ffffff"))},
    uMaxMag:{value:maxMag}, uLenMode:{value:LENMODE}, uLen:{value:arrowLen},
    uTime:{value:0}, uAnim:{value:ANIM}, uSpeed:{value:opts.speed??1.0},
  };
  const vert=`
    attribute vec3 iPos; attribute vec3 iVec; attribute float iPhase; attribute float axial;
    #ifdef USE_VCOL
    attribute vec3 iColor; varying vec3 vCol;
    #endif
    uniform float uMaxMag; uniform float uLenMode; uniform float uLen;
    uniform float uTime; uniform float uAnim; uniform float uSpeed;
    varying float vAxial; varying float vMag; varying float vCrest;
    mat3 rotToDir(vec3 dir){
      vec3 up=vec3(0.0,1.0,0.0); vec3 a=normalize(dir);
      float c=dot(up,a); vec3 v=cross(up,a); float s=length(v);
      if(s<1e-6){ return c>0.0?mat3(1.0):mat3(-1.0,0.0,0.0, 0.0,-1.0,0.0, 0.0,0.0,1.0); }
      v=normalize(v); float ic=1.0-c;
      return mat3(
        c+v.x*v.x*ic,      v.x*v.y*ic+v.z*s,  v.x*v.z*ic-v.y*s,
        v.y*v.x*ic-v.z*s,  c+v.y*v.y*ic,      v.y*v.z*ic+v.x*s,
        v.z*v.x*ic+v.y*s,  v.z*v.y*ic-v.x*s,  c+v.z*v.z*ic);
    }
    void main(){
      vAxial=axial;
      #ifdef USE_VCOL
      vCol=iColor;
      #endif
      float mag=length(iVec); vMag=mag;
      vec3 dir=(mag>1e-9)?normalize(vec3(iVec.x,iVec.z,iVec.y)):vec3(0.0,1.0,0.0);
      // Length mode: 0=uniform (template already at arrowLen), 1=scaled
      // (arrowLen * mag/maxMag), 2=raw (final length = mag, so divide out the
      // template's baked-in arrowLen to leave only the magnitude).
      float scl;
      if(uLenMode<0.5){ scl=1.0; }
      else if(uLenMode<1.5){ scl=clamp(mag/max(uMaxMag,1e-6),0.05,1.0); }
      else { scl=mag/max(uLen,1e-6); }
      float ph=uTime*uSpeed + iPhase;
      // pulse: arrows breathe in length; crest: highlight travels; advect: the
      // whole arrow slides forward along its vector and loops.
      float pulse = (uAnim>0.5 && uAnim<1.5) ? (0.85+0.25*sin(ph*3.1416)) : 1.0;
      float crestPos = fract(ph*0.5);
      vCrest = (uAnim>1.5 && uAnim<2.5) ? smoothstep(0.12,0.0,abs(axial-crestPos)) : 0.0;
      vec3 local = position*scl*pulse;
      vec3 world = rotToDir(dir)*local + vec3(iPos.x,iPos.z,iPos.y);
      if(uAnim>2.5){ // advect along the (math-space) vector, looping
        float t=fract(ph*0.25);
        // slide distance tracks the effective arrow length: arrowLen*scl in
        // uniform/scaled modes, mag in raw mode (where scl already encodes it).
        float effLen=(uLenMode<1.5)?(uLen*scl):mag;
        world += vec3(dir.x,dir.y,dir.z) * (t*effLen*1.6);
      }
      if(mag<1e-9){ gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
      gl_Position=projectionMatrix*modelViewMatrix*vec4(world,1.0);
    }`;
  const frag=`precision highp float;
    uniform vec3 uColor; uniform vec3 uCrest;
    #ifdef USE_VCOL
    varying vec3 vCol;
    #endif
    varying float vAxial; varying float vMag; varying float vCrest;
    void main(){
      #ifdef USE_VCOL
      vec3 base=vCol;
      #else
      vec3 base=uColor;
      #endif
      vec3 c=mix(base, base*1.5, vAxial*0.5);     // brighter toward tip
      c=mix(c, uCrest, clamp(vCrest,0.0,1.0));          // travelling crest
      gl_FragColor=vec4(c, 0.92);
    }`;
  const mat=new THREE.ShaderMaterial({uniforms:uobj,vertexShader:vert,fragmentShader:frag,transparent:true,side:THREE.DoubleSide,defines:useVCol?{USE_VCOL:1}:{}});
  mat._uniformNames=[];     // no scalar uniforms (values are baked per-instance)
  const mesh=new THREE.Mesh(geo,mat); mesh.frustumCulled=false;
  // mark as time-animated so the render loop keeps ticking & updating uTime
  mesh._glyphAnim = ANIM>0;
  mesh._gpuSurface={uNames:[]};
  return [mesh];
}

// Build a GPU-rendered surface mesh from an explicit grid of [x,y,z] points.
// opts: { opacity, noWire, a, b, axis } — a/b/axis enable a vertex-color
// gradient between colors a→b across the "u" (column) or "v" (row) direction.
function buildSurfFromGridGPU(rows, color, opts={}){
  const nv=rows.length, nu=rows[0].length, pos=[], idx=[];
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const q=rows[j][i];pos.push(q?q[0]:0,q?q[2]:0,q?q[1]:0);}
  for(let j=0;j<nv-1;j++)for(let i=0;i<nu-1;i++){
    const a=j*nu+i,b=j*nu+i+1,c=(j+1)*nu+i,d=(j+1)*nu+i+1;
    if([a,b,c,d].every(kk=>{const q=rows[Math.floor(kk/nu)][kk%nu];return q&&q.every(isFinite);})) idx.push(a,b,c,b,d,c);
  }
  if(!idx.length) return [];
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.setIndex(idx); g.computeVertexNormals();
  const opacity = opts.opacity!=null ? opts.opacity : 0.8;
  let mat;
  const useGrad = !!(opts.a && opts.b);
  if(useGrad){
    const ca=new THREE.Color(hexToThree(opts.a)), cb=new THREE.Color(hexToThree(opts.b));
    const col=new Float32Array(nv*nu*3);
    for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
      const f = opts.axis==="v" ? (nv>1?j/(nv-1):0) : (nu>1?i/(nu-1):0);
      const idx3=(j*nu+i)*3;
      col[idx3]=ca.r+(cb.r-ca.r)*f; col[idx3+1]=ca.g+(cb.g-ca.g)*f; col[idx3+2]=ca.b+(cb.b-ca.b)*f;
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col,3));
    mat=new THREE.MeshPhongMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true,opacity,shininess:40});
  } else {
    mat=new THREE.MeshPhongMaterial({color:hexToThree(color),side:THREE.DoubleSide,transparent:true,opacity,shininess:40});
  }
  const mesh=new THREE.Mesh(g,mat);
  if(opts.noWire) return [mesh];
  const wireColor = useGrad ? hexToThree(opts.b) : hexToThree(color);
  const wire=new THREE.LineSegments(new THREE.WireframeGeometry(g),new THREE.LineBasicMaterial({color:wireColor,transparent:true,opacity:0.18}));
  return [mesh,wire];
}

// ── Scalar volume: f(x,y,z) sampled on a grid, drawn as a value-coloured point
// cloud. Used by the unified scalarFn node at dims=3 where there's no single
// surface to draw. Points are coloured by normalized value (colorLo→colorHi)
// when colorByValue is set, else the node colour.
function buildScalarVolume(p, scope, color){
  const res=Math.max(2,Math.min(40,Math.round(resolveNum(p.res,scope,18))));
  const xMin=resolveNum(p.xMin,scope,-5),xMax=resolveNum(p.xMax,scope,5);
  const yMin=resolveNum(p.yMin,scope,-4),yMax=resolveNum(p.yMax,scope,4);
  const zMin=resolveNum(p.zMin,scope,-3),zMax=resolveNum(p.zMax,scope,3);
  const xs=linspace(xMin,xMax,res),ys=linspace(yMin,yMax,res),zs=linspace(zMin,zMax,res);
  const colorByValue=!!p.colorByValue;
  const cLo=new THREE.Color(hexToThree(p.colorLo||"#3a6df0"));
  const cHi=new THREE.Color(hexToThree(p.colorHi||"#f0533a"));
  const vals=[],pos=[];
  let vmin=Infinity,vmax=-Infinity;
  for(const x of xs)for(const y of ys)for(const z of zs){
    const w=safeEval(p.expr,{...scope,x,y,z});
    if(w==null||!isFinite(w)){ continue; }
    pos.push([x,z,y]); vals.push(w);     // note y/z swap to match world axes
    if(w<vmin)vmin=w; if(w>vmax)vmax=w;
  }
  if(!pos.length) return [];
  const n=pos.length;
  const arr=new Float32Array(n*3), col=new Float32Array(n*3);
  const span=(vmax-vmin)||1;
  for(let i=0;i<n;i++){
    arr[i*3]=pos[i][0]; arr[i*3+1]=pos[i][1]; arr[i*3+2]=pos[i][2];
    let r=color, g, b;
    if(colorByValue){
      const f=(vals[i]-vmin)/span;
      col[i*3]=cLo.r+(cHi.r-cLo.r)*f; col[i*3+1]=cLo.g+(cHi.g-cLo.g)*f; col[i*3+2]=cLo.b+(cHi.b-cLo.b)*f;
    } else {
      const c=new THREE.Color(hexToThree(color));
      col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b;
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.BufferAttribute(arr,3));
  geo.setAttribute("color",new THREE.BufferAttribute(col,3));
  const mat=new THREE.PointsMaterial({size:Math.max(0.04,(xMax-xMin)/res*0.5),vertexColors:true,transparent:true,opacity:0.85,sizeAttenuation:true});
  return [new THREE.Points(geo,mat)];
}

export {
  buildSurfGPU, buildFn1dGPU, buildCurve3d, buildSurf, buildPlane3d, buildPoint3d, buildPointSeq3d, buildPointSeqGPU, buildQuiver3d, buildQuiver3dGPU, buildGlyphFieldGPU, buildSurfFromGridGPU, buildScalarVolume
};
