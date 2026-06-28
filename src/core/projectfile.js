import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { uid } from "./math.js";
// NOTE: this module deliberately does NOT import from serialize.js. Doing so
// pulls serialize's heavy transitive deps (model.js → tokens.jsx/React) across
// the lazy Editor-chunk boundary, and Rollup's chunk split then produced a
// cross-chunk initialization cycle (a TDZ "can't access lexical declaration
// before initialization" crash when the Editor chunk loaded). The one piece
// we need — migrateModel — is injected by the caller instead (see
// readProjectArchive's `migrate` param), keeping this module a clean leaf.

// ── .ddk / .ded project archive ─────────────────────────────────────────────
// The URL hash is great for sharing small scenes but can't hold big binary
// assets: meshes blow the URL length (see the mesh-import handoff note), and
// texture/video data-URIs are stripped from the hash entirely and fall back to
// a default tile on reload. A project FILE has no such ceiling, so it's the
// home for "real" projects with imported assets.
//
// The container is a plain ZIP (via fflate, already a dependency — no new dep):
//
//   manifest.json        {format, version, app, appVersion, created}
//   project.json         the node graph, with asset-bearing props replaced by
//                        {"__asset":"assets/<sha1>.<ext>"} reference objects
//   assets/<sha1>.<ext>  the extracted payloads, one per unique asset
//
// Splitting assets out of project.json means (a) the JSON stays small and
// diffable, (b) identical assets dedupe by content hash, and (c) binary-ish
// data (mesh geometry, image/video bytes) rides as raw archive entries instead
// of bloating a JSON string. zip's own DEFLATE handles compression, so unlike
// the hash path we don't pre-compress here.

const FORMAT = "ddk";
const VERSION = 1;
// Default download extension. `.ded` is accepted on open too (same container).
const EXT = "ddk";

// ── Asset-bearing props (the one place that knows where assets live) ─────────
// Each descriptor says: for nodes of `type`, prop `prop` holds an asset; `kind`
// drives the stored file extension and how the bytes are encoded. Add a node
// type that carries a heavy payload? Add a line here and both save and open
// pick it up — nothing else changes.
//   - "json": a JSON/text string (mesh geometry) → stored verbatim as utf-8.
//   - "media": a data:/blob:/http(s) URL (texture/video) → data: URIs are
//     decoded to their raw bytes and stored with the real extension; http(s)
//     URLs are small references, left inline (not extracted); blob: URLs are
//     session-only and can't be persisted, so they're dropped (like the hash).
const ASSET_PROPS = [
  { type: "texture", prop: "src",  kind: "media" },
  { type: "video",   prop: "src",  kind: "media" },
];
function assetDescFor(type, prop){
  return ASSET_PROPS.find(d => d.type===type && d.prop===prop) || null;
}

// ── tiny SHA-1 (content-addressing only; not security) ───────────────────────
// Used purely to name/dedupe asset entries by content. A non-crypto hash would
// do, but SHA-1 over the bytes is short, dependency-free, and collision-safe
// enough for naming local files.
function sha1Hex(bytes){
  const rotl=(n,c)=>((n<<c)|(n>>> (32-c)))>>>0;
  const ml=bytes.length*8;
  // pad: 0x80, zeros, then 64-bit big-endian length
  const withPad=[];
  for(let i=0;i<bytes.length;i++) withPad.push(bytes[i]);
  withPad.push(0x80);
  while(withPad.length%64!==56) withPad.push(0);
  const hi=Math.floor(ml/0x100000000), lo=ml>>>0;
  withPad.push((hi>>>24)&255,(hi>>>16)&255,(hi>>>8)&255,hi&255);
  withPad.push((lo>>>24)&255,(lo>>>16)&255,(lo>>>8)&255,lo&255);
  let h0=0x67452301,h1=0xEFCDAB89,h2=0x98BADCFE,h3=0x10325476,h4=0xC3D2E1F0;
  const w=new Array(80);
  for(let i=0;i<withPad.length;i+=64){
    for(let t=0;t<16;t++)
      w[t]=((withPad[i+t*4]<<24)|(withPad[i+t*4+1]<<16)|(withPad[i+t*4+2]<<8)|(withPad[i+t*4+3]))>>>0;
    for(let t=16;t<80;t++) w[t]=rotl(w[t-3]^w[t-8]^w[t-14]^w[t-16],1);
    let a=h0,b=h1,c=h2,d=h3,e=h4;
    for(let t=0;t<80;t++){
      let f,k;
      if(t<20){ f=(b&c)|((~b)&d); k=0x5A827999; }
      else if(t<40){ f=b^c^d; k=0x6ED9EBA1; }
      else if(t<60){ f=(b&c)|(b&d)|(c&d); k=0x8F1BBCDC; }
      else { f=b^c^d; k=0xCA62C1D6; }
      const tmp=(rotl(a,5)+f+e+k+w[t])>>>0;
      e=d; d=c; c=rotl(b,30); b=a; a=tmp;
    }
    h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0; h4=(h4+e)>>>0;
  }
  return [h0,h1,h2,h3,h4].map(x=>x.toString(16).padStart(8,"0")).join("");
}

// ── data: URI <-> bytes ──────────────────────────────────────────────────────
// Parse a data: URI into {mime, bytes}. Returns null for anything that isn't a
// base64 data: URI we can decode (http(s)/blob handled by the caller).
function parseDataUri(s){
  const m=/^data:([^;,]*)(;base64)?,(.*)$/s.exec(s||"");
  if(!m) return null;
  const mime=m[1]||"application/octet-stream";
  const isB64=!!m[2];
  const body=m[3];
  let bytes;
  if(isB64){
    const bin=atob(body);
    bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  } else {
    bytes=strToU8(decodeURIComponent(body));
  }
  return { mime, bytes };
}
function bytesToDataUri(bytes, mime){
  let bin="";
  for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
  return `data:${mime||"application/octet-stream"};base64,${btoa(bin)}`;
}
// Map a MIME to a file extension for the assets/ entry (cosmetic — the real
// type is carried in the manifest-free per-asset header below). Falls back to
// "bin". Mesh geometry is always ".json".
const MIME_EXT={
  "image/png":"png","image/jpeg":"jpg","image/jpg":"jpg","image/webp":"webp",
  "image/gif":"gif","image/svg+xml":"svg","image/bmp":"bmp",
  "video/mp4":"mp4","video/webm":"webm","video/ogg":"ogv","video/quicktime":"mov",
};
function extForMime(mime){ return MIME_EXT[(mime||"").toLowerCase()]||"bin"; }

// Asset entries store their original MIME in a 1-line header so media can be
// rebuilt into a faithful data: URI on open (the file extension alone is lossy
// for things like image/jpg vs image/jpeg). Format: "mime\n" then raw bytes.
function packAsset(mime, bytes){
  const head=strToU8((mime||"application/octet-stream")+"\n");
  const out=new Uint8Array(head.length+bytes.length);
  out.set(head,0); out.set(bytes,head.length);
  return out;
}
function unpackAsset(bytes){
  let nl=-1;
  for(let i=0;i<bytes.length && i<256;i++){ if(bytes[i]===10){ nl=i; break; } }
  if(nl<0) return { mime:"application/octet-stream", bytes };
  const mime=strFromU8(bytes.slice(0,nl));
  return { mime, bytes: bytes.slice(nl+1) };
}

// ── Save ─────────────────────────────────────────────────────────────────────
// Build the archive bytes from the live node map. Pulls each asset-bearing prop
// out into assets/, replaces it with an {__asset} ref, and zips the result.
// Returns a Uint8Array (the .ddk file bytes). Throws on a hard failure.
function buildProjectArchive(nodes, meta={}){
  const files={};               // zip entry path -> Uint8Array
  const seen=new Map();          // sha -> assetPath (dedupe identical payloads)

  function stashAsset(rawBytes, mime, kind){
    const sha=sha1Hex(rawBytes);
    if(seen.has(sha)) return seen.get(sha);
    const ext = kind==="json" ? "json" : extForMime(mime);
    const path=`assets/${sha}.${ext}`;
    files[path]=packAsset(mime, rawBytes);
    seen.set(sha, path);
    return path;
  }

  const outNodes={};
  for(const [id,n] of Object.entries(nodes)){
    const copy={...n, props:{...(n.props||{})}};
    for(const desc of ASSET_PROPS){
      if(n.type!==desc.type) continue;
      const v=copy.props[desc.prop];
      if(typeof v!=="string" || !v) continue;
      if(desc.kind==="json"){
        const bytes=strToU8(v);
        const path=stashAsset(bytes, "application/json", "json");
        copy.props[desc.prop]={ __asset:path };
      } else { // media
        if(v.startsWith("data:")){
          const parsed=parseDataUri(v);
          if(parsed){
            const path=stashAsset(parsed.bytes, parsed.mime, "media");
            copy.props[desc.prop]={ __asset:path };
          } else {
            // undecodable data: URI — drop it (will fall back on open)
            delete copy.props[desc.prop];
          }
        } else if(v.startsWith("blob:")){
          // session-only object URL — cannot be persisted; drop it.
          delete copy.props[desc.prop];
        }
        // http(s):// and bare refs stay inline as small references.
      }
    }
    outNodes[id]=copy;
  }

  const manifest={
    format:FORMAT, version:VERSION,
    app:"sceneforge", appVersion: meta.appVersion||null,
    created: new Date().toISOString(),
    assetCount: Object.keys(files).length,
  };
  files["manifest.json"]=strToU8(JSON.stringify(manifest));
  files["project.json"]=strToU8(JSON.stringify({ nodes: outNodes }));

  return zipSync(files, { level:6 });
}

// ── Open ──────────────────────────────────────────────────────────────────────
// Parse archive bytes back into a live node map: unzip, read project.json,
// re-inline each {__asset} ref from assets/, then run the same id-refresh +
// migration the hash loader uses so old files keep working. `migrate` is
// injected by the caller (the Editor passes serialize.js's migrateModel) so
// this module needn't import serialize.js — see the note at the top of the
// file for why that edge is avoided. If omitted, migration is skipped (the
// nodes are still valid; only legacy-format upgrades are missed). Returns
// {nodes, manifest} or throws.
function readProjectArchive(buf, migrate){
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const entries=unzipSync(bytes);
  if(!entries["project.json"]) throw new Error("not a project archive (no project.json)");
  let manifest={};
  if(entries["manifest.json"]){
    try{ manifest=JSON.parse(strFromU8(entries["manifest.json"])); }catch{}
  }
  const proj=JSON.parse(strFromU8(entries["project.json"]));
  const rawNodes=proj.nodes||{};

  // Resolve an {__asset} ref to its restored prop value, by kind.
  function resolveAsset(ref, kind){
    const path=ref && ref.__asset;
    if(!path) return undefined;
    const entry=entries[path];
    if(!entry) return undefined;             // missing asset → caller drops prop
    const { mime, bytes:payload }=unpackAsset(entry);
    if(kind==="json") return strFromU8(payload);
    return bytesToDataUri(payload, mime);     // media → data: URI
  }

  const restored={};
  for(const [id,n] of Object.entries(rawNodes)){
    const copy={...n, props:{...(n.props||{})}};
    for(const desc of ASSET_PROPS){
      if(n.type!==desc.type) continue;
      const v=copy.props[desc.prop];
      if(v && typeof v==="object" && v.__asset){
        const val=resolveAsset(v, desc.kind);
        if(val!==undefined) copy.props[desc.prop]=val;
        else delete copy.props[desc.prop]; // asset missing — fall back to default
      }
    }
    restored[id]=copy;
  }

  // Refresh ids (so opening a file never collides with a node already live)
  // and remap attachments — mirrors deserializeProject's id-swap — then migrate.
  const out={}, o2n={};
  const oi=Object.keys(restored), ni=oi.map(()=>uid());
  oi.forEach((o,i)=>{ o2n[o]=ni[i]; });
  oi.forEach((o,i)=>{
    const n=restored[o];
    out[ni[i]]={ ...n, id:ni[i],
      attachments:(n.attachments||[]).map(a=>o2n[a]||a).filter(Boolean) };
  });
  return { nodes: (typeof migrate==="function" ? migrate(out) : out), manifest };
}

// ── Browser save/open helpers (DOM; no-ops are caller's concern) ─────────────
// Trigger a download of the given archive bytes under `<name>.ddk`.
function downloadProjectArchive(nodes, filename="scene", meta={}){
  const bytes=buildProjectArchive(nodes, meta);
  const blob=new Blob([bytes], { type:"application/zip" });
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const safe=(filename||"scene").replace(/[^\w.-]+/g,"_").replace(/\.(ddk|ded)$/i,"")||"scene";
  a.href=url; a.download=`${safe}.${EXT}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
// Read a File (from an <input type=file> or drop) into a node map. `migrate`
// (serialize.js's migrateModel) is injected by the caller to avoid importing
// serialize here — see the top-of-file note on the chunk cycle.
async function openProjectFile(file, migrate){
  const buf=new Uint8Array(await file.arrayBuffer());
  return readProjectArchive(buf, migrate);
}

export {
  FORMAT, VERSION, EXT, ASSET_PROPS, assetDescFor,
  buildProjectArchive, readProjectArchive,
  downloadProjectArchive, openProjectFile,
  // exported for tests
  sha1Hex, parseDataUri, bytesToDataUri, packAsset, unpackAsset,
};
