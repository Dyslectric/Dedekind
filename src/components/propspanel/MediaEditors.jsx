import { useUI } from "../../theme/tokens.jsx";
import { Sec, PR } from "../primitives.jsx";

const EMBED_CAP = 256 * 1024;   // embed images up to ~256 KB as a data-URI; larger → object URL (session only)

// texture — a static image source (file upload → data-URI, or a URL/data-URI),
// exposed as a sampleable texture for a surface's material.
export function TextureEditor({ node, onChange }){
  const { ui, S } = useUI();
  const set = (k,v)=>onChange({props:{...node.props,[k]:v}});
  const src = node.props.src || "";
  const onFile = (e)=>{
    const f = e.target.files && e.target.files[0]; if(!f) return;
    if(f.size <= EMBED_CAP){
      const r = new FileReader();
      r.onload = ()=>set("src", String(r.result));   // data-URI, embeds in the project
      r.readAsDataURL(f);
    } else {
      set("src", URL.createObjectURL(f));             // too big to embed — session-only object URL
    }
  };
  const tooBigToEmbed = src.startsWith("blob:");
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
          <input value={src.startsWith("data:")?"":src} onChange={e=>set("src",e.target.value)}
            placeholder="https://… or leave the default" style={{...S.inp,width:"100%"}}/>
        </PR>
        <div style={{fontSize:12,color:ui.uiFaint,lineHeight:1.5}}>
          Images up to 256 KB embed in the project (so shares carry the picture); larger files load for this session only.
          {tooBigToEmbed && <span style={{color:ui.uiDanger}}> This image is too large to embed — it won't be saved with the project.</span>}
        </div>
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
      <div style={{fontSize:12.5,color:ui.uiFaint,marginTop:3,lineHeight:1.5}}>
        Wire this node's output into a <strong>Transformer</strong> and set its Material colour to <em>Texture</em>. The surface samples the image at its UV (grid) coordinates.
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
