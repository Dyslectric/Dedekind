import { useUI } from "../../theme/tokens.jsx";
import { Sec, PR } from "../primitives.jsx";

// texture — a static image source (file upload, or a URL/data-URI), exposed as a
// sampleable texture for a surface's material.
export function TextureEditor({ node, onChange }){
  const { ui, S } = useUI();
  const set = (k,v)=>onChange({props:{...node.props,[k]:v}});
  const src = node.props.src || "";
  const onFile = (e)=>{
    const f = e.target.files && e.target.files[0]; if(!f) return;
    const r = new FileReader();
    r.onload = ()=>set("src", String(r.result));   // data-URI for this session (not serialized)
    r.readAsDataURL(f);
  };
  return <>
    <Sec title="Image">
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <div style={{height:96,borderRadius:6,border:`1px solid ${ui.uiInputBorder}`,overflow:"hidden",
          background:"#0008 url("+(src||"")+") center/contain no-repeat"}}/>
        <label style={{...S.btnSm,textAlign:"center",cursor:"pointer",color:ui.uiAccent,borderColor:ui.uiAccent+"55"}}>
          choose image…
          <input type="file" accept="image/*" onChange={onFile} style={{display:"none"}}/>
        </label>
        <PR label="or URL">
          <input value={src.startsWith("data:")||src.startsWith("blob:")?"":src} onChange={e=>set("src",e.target.value)}
            placeholder="https://… or leave the default" style={{...S.inp,width:"100%"}}/>
        </PR>
        <div style={{fontSize:12,color:ui.uiFaint,lineHeight:1.5}}>
          A chosen image loads for this session but is <strong>not saved in the project</strong> (media would bloat the share). To share a textured project, point at an image <em>URL</em>. The default Dedekind tile always restores if no URL is set.
        </div>
      </div>
    </Sec>
    <Sec title="Sampling">
      <PR label="use as">
        <select value={node.props.role||"color"} onChange={e=>set("role",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="color">colour (albedo)</option>
          <option value="normal">normal map (bumps)</option>
        </select>
      </PR>
      <PR label="filter">
        <select value={node.props.filter||"linear"} onChange={e=>set("filter",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="linear">linear (smooth)</option>
          <option value="nearest">nearest (crisp pixels)</option>
        </select>
      </PR>
      <PR label="wrap">
        <select value={node.props.wrap||"clamp"} onChange={e=>set("wrap",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="clamp">clamp to edge</option>
          <option value="repeat">repeat (tile)</option>
        </select>
      </PR>
      <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        Wire this node's output into a <strong>Transformer</strong> (or a parametric surface). A <em>colour</em> texture drives the albedo when Material colour is set to Texture; a <em>normal map</em> perturbs the lighting normals (set its strength on the surface). A normal map is sampled in linear space.
      </div>
    </Sec>
  </>;
}

// video — a video source (URL or local file). Its current frame is uploaded each
// render tick. The footage is referenced, never embedded in the project.
export function VideoEditor({ node, onChange }){
  const { ui, S } = useUI();
  const set = (k,v)=>onChange({props:{...node.props,[k]:v}});
  const src = node.props.src || "";
  const onFile = (e)=>{
    const f = e.target.files && e.target.files[0]; if(!f) return;
    set("src", URL.createObjectURL(f));    // object URL; not serialized
  };
  return <>
    <Sec title="Video">
      <PR label="URL">
        <input value={src.startsWith("blob:")?"":src} onChange={e=>set("src",e.target.value)}
          placeholder="https://….mp4" style={{...S.inp,width:"100%"}}/>
      </PR>
      <label style={{...S.btnSm,textAlign:"center",cursor:"pointer",color:ui.uiAccent,borderColor:ui.uiAccent+"55",display:"block",marginTop:6}}>
        choose local video…
        <input type="file" accept="video/*" onChange={onFile} style={{display:"none"}}/>
      </label>
      <div style={{fontSize:12,color:ui.uiFaint,marginTop:6,lineHeight:1.5}}>
        Plays muted and looped. Video is referenced, not embedded — a local file plays for this session only; use a URL for a shareable project. You are responsible for the rights to whatever you load.
      </div>
    </Sec>
    <Sec title="Sampling">
      <PR label="filter">
        <select value={node.props.filter||"linear"} onChange={e=>set("filter",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="linear">linear (smooth)</option>
          <option value="nearest">nearest (crisp pixels)</option>
        </select>
      </PR>
      <PR label="wrap">
        <select value={node.props.wrap||"clamp"} onChange={e=>set("wrap",e.target.value)} style={{...S.inp,width:"100%"}}>
          <option value="clamp">clamp to edge</option>
          <option value="repeat">repeat (tile)</option>
        </select>
      </PR>
    </Sec>
  </>;
}
