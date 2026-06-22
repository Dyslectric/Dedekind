import { useState } from "react";
import * as THREE from "three";
import { useUI } from "../../theme/tokens.jsx";
import { Sec, PR, Toggle } from "../primitives.jsx";
import { EI } from "../MathInput.jsx";
import { meshDataFromGeometry, meshDataSig } from "../../geometry/builders.js";

// Flatten any loaded Object3D / BufferGeometry into ONE non-indexed
// position-only BufferGeometry in world space. Loaders return wildly different
// shapes (OBJ → a Group of meshes, GLTF → a Scene, STL/PLY → a bare geometry);
// walking the tree and baking each mesh's world transform into a flat triangle
// soup gives a single uniform geometry the mesh node can store, regardless of
// source. Other attributes (uv/normals/colours) are dropped — the node keeps
// just positions + recomputes normals at build time.
function collectGeometry(root){
  if(root && root.isBufferGeometry) root = new THREE.Mesh(root);
  if(!root) return null;
  root.updateMatrixWorld(true);
  const positions=[]; const v=new THREE.Vector3();
  root.traverse(obj=>{
    if(!obj.isMesh || !obj.geometry) return;
    const g=obj.geometry, pos=g.getAttribute("position"); if(!pos) return;
    const m=obj.matrixWorld, idx=g.index;
    const push=(i)=>{ v.fromBufferAttribute(pos,i).applyMatrix4(m); positions.push(v.x,v.y,v.z); };
    if(idx){ for(let k=0;k<idx.count;k++) push(idx.getX(k)); }
    else   { for(let k=0;k<pos.count;k++) push(k); }
  });
  if(!positions.length) return null;
  const out=new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions,3));
  return out;
}

// Parse a chosen file into a geometry, picking the loader by extension. Loaders
// are dynamically imported so the (sizeable) loader code only ships when someone
// actually imports a mesh.
async function fileToGeometry(file){
  const name=(file.name||"").toLowerCase();
  const ext=name.slice(name.lastIndexOf(".")+1);
  if(ext==="obj"){
    const { OBJLoader }=await import("three/addons/loaders/OBJLoader.js");
    return collectGeometry(new OBJLoader().parse(await file.text()));
  }
  if(ext==="stl"){
    const { STLLoader }=await import("three/addons/loaders/STLLoader.js");
    return collectGeometry(new STLLoader().parse(await file.arrayBuffer()));
  }
  if(ext==="ply"){
    const { PLYLoader }=await import("three/addons/loaders/PLYLoader.js");
    return collectGeometry(new PLYLoader().parse(await file.arrayBuffer()));
  }
  if(ext==="gltf"||ext==="glb"){
    const { GLTFLoader }=await import("three/addons/loaders/GLTFLoader.js");
    const buf=await file.arrayBuffer();
    const gltf=await new Promise((res,rej)=>new GLTFLoader().parse(buf,"",res,rej));
    return collectGeometry(gltf.scene);
  }
  throw new Error("Unsupported file — use OBJ, GLTF/GLB, STL or PLY.");
}

// mesh — an embedded triangle-mesh asset. Drop in a file (OBJ/GLTF/STL/PLY) and
// its geometry is baked into the node (math-space positions + indices). It then
// renders as a lit BufferGeometry, shaded by the camera's lights.
export function MeshEditor({ node, scope, onChange }){
  const { ui, S } = useUI();
  const set = (k,v)=>onChange({props:{...node.props,[k]:v}});
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");

  // Decode the current data just to report vertex/triangle counts.
  let nVerts=0, nTris=0;
  try{
    if(node.props.data){
      const d=JSON.parse(node.props.data);
      nVerts=Array.isArray(d.p)?(d.p.length/3)|0:0;
      nTris=Array.isArray(d.i)?(d.i.length/3)|0:(nVerts/3)|0;
    }
  }catch{ /* malformed — counts stay 0 */ }

  const onFile=async(e)=>{
    const f=e.target.files && e.target.files[0]; e.target.value="";
    if(!f) return;
    setBusy(true); setErr("");
    try{
      const geo=await fileToGeometry(f);
      if(!geo) throw new Error("No triangle geometry found in that file.");
      const data=meshDataFromGeometry(geo);
      geo.dispose&&geo.dispose();
      onChange({props:{...node.props, data, __dataSig:meshDataSig(data)}});
    }catch(ex){ setErr(String(ex&&ex.message||ex)); }
    finally{ setBusy(false); }
  };

  return <>
    <Sec title="Asset">
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <label style={{...S.btnSm,textAlign:"center",cursor:"pointer",color:ui.uiAccent,borderColor:ui.uiAccent+"55"}}>
          {busy?"loading…":"import mesh file…"}
          <input type="file" accept=".obj,.gltf,.glb,.stl,.ply" onChange={onFile} style={{display:"none"}}/>
        </label>
        <div style={{fontSize:12.5,color:ui.uiFaint,lineHeight:1.5}}>
          {nVerts
            ? <>Embedded: <strong>{nVerts.toLocaleString()}</strong> vertices · <strong>{nTris.toLocaleString()}</strong> triangles.</>
            : <>No mesh yet. Import an <strong>OBJ</strong>, <strong>GLTF/GLB</strong>, <strong>STL</strong> or <strong>PLY</strong> file — its geometry is baked into this node and saved with the project.</>}
        </div>
        {err && <div style={{fontSize:12.5,color:ui.uiDanger,lineHeight:1.5}}>{err}</div>}
      </div>
    </Sec>
    <Sec title="Transform">
      <PR label="scale"><EI v={node.props.scale??"1"} sc={scope} onChange={v=>set("scale",v)} placeholder="1"/></PR>
    </Sec>
    <Sec title="Material">
      <PR label="lit"><Toggle v={node.props.lit!==false} onChange={v=>set("lit",v)}/></PR>
      {node.props.lit!==false && <>
        <PR label="shininess"><EI v={node.props.shininess??"36"} sc={scope} onChange={v=>set("shininess",v)} placeholder="36"/></PR>
        <PR label="facets"><Toggle v={node.props.flatShading===true} onChange={v=>set("flatShading",v)}/></PR>
      </>}
      <PR label="opacity"><EI v={node.props.opacity??"1"} sc={scope} onChange={v=>set("opacity",v)} placeholder="1"/></PR>
      <PR label="2-sided"><Toggle v={node.props.doubleSide!==false} onChange={v=>set("doubleSide",v)}/></PR>
      <PR label="wire"><Toggle v={node.props.showWire===true} onChange={v=>set("showWire",v)}/></PR>
      <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:4,lineHeight:1.5}}>
        Set <em>lit</em> and wire <strong>lights</strong> into the camera to shade the mesh; otherwise it draws flat in the node colour. Coordinates are math space (z up) — external files (y up) are converted on import.
      </div>
    </Sec>
  </>;
}
