import * as THREE from "three";
import { DEFAULT_TEXTURE_SRC } from "../nodes/textureDefault.js";

// ── Texture sources ──────────────────────────────────────────────────────────
// Image + video sources become THREE textures sampled by a surface's shader. The
// actual GPU upload happens in the browser; this module owns loading, a small
// src-keyed cache (so re-renders reuse one upload), and disposal of evicted
// entries (a leaked VideoTexture keeps decoding forever).

const _MAX = 24;                 // cache cap; evicts + disposes the oldest
const _cache = new Map();        // key → THREE.Texture

function _applyParams(tex, filter, wrap){
  const nearest = filter==="nearest";
  tex.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.minFilter = nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  const w = wrap==="repeat" ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapS = w; tex.wrapT = w;
  // Albedo textures are authored in sRGB; tag them so three linearizes on sample
  // (the surface shader applies its own gamma at the end).
  if("colorSpace" in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
}
function _store(key, tex){
  if(_cache.size >= _MAX){
    const k0 = _cache.keys().next().value;
    const old = _cache.get(k0); _cache.delete(k0);
    try { if(old && old._video) old._video.pause(); old && old.dispose && old.dispose(); } catch {}
  }
  _cache.set(key, tex);
}

// Static image → texture. The loaded image is drawn onto a fixed 512² canvas so
// SVG data-URIs (no intrinsic pixel size) and odd/NPOT sources normalize to one
// clean, mipmap-friendly texture. Returns the texture immediately; the pixels
// fill in when the image finishes loading (three re-uploads on needsUpdate).
function getStaticTexture(src, filter="linear", wrap="clamp"){
  if(!src) return null;
  const key = `img|${src}|${filter}|${wrap}`;
  const hit = _cache.get(key); if(hit) return hit;
  const tex = new THREE.Texture();
  _applyParams(tex, filter, wrap);
  if(typeof Image !== "undefined" && typeof document !== "undefined"){
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const N = 512;
        const c = document.createElement("canvas"); c.width = N; c.height = N;
        c.getContext("2d").drawImage(img, 0, 0, N, N);
        tex.image = c; tex.needsUpdate = true;
      } catch {}
    };
    img.onerror = () => {};
    img.src = src;
  }
  _store(key, tex);
  return tex;
}

// Video → VideoTexture. Plays muted/looped (autoplay policies require muted) and
// self-updates each rendered frame. Returns null in non-DOM contexts.
function getVideoTexture(src, filter="linear", wrap="clamp"){
  if(!src || typeof document === "undefined") return null;
  const key = `vid|${src}|${filter}|${wrap}`;
  const hit = _cache.get(key); if(hit) return hit;
  const v = document.createElement("video");
  v.src = src; v.crossOrigin = "anonymous";
  v.loop = true; v.muted = true; v.playsInline = true; v.autoplay = true;
  try { const p = v.play(); if(p && p.catch) p.catch(()=>{}); } catch {}
  const tex = new THREE.VideoTexture(v);
  _applyParams(tex, filter, wrap);
  tex._video = v;
  _store(key, tex);
  return tex;
}

// Resolve a texture/video node's props to a THREE texture (or null).
function getNodeTexture(node){
  if(!node) return null;
  const p = node.props || {};
  if(node.type === "video") return getVideoTexture(p.src, p.filter, p.wrap);
  return getStaticTexture(p.src || DEFAULT_TEXTURE_SRC, p.filter, p.wrap);
}

export { getStaticTexture, getVideoTexture, getNodeTexture, DEFAULT_TEXTURE_SRC };
