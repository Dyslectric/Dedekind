// ── Lightweight cross-cutting UI settings ────────────────────────────────────
// A tiny pub/sub holder for app-wide display preferences that a few leaf
// components (EI/XF math-input wrappers) need to read without threading the
// project node all the way down. App syncs these from the project props; the
// wrappers subscribe via the useUISetting hook.
//
// This is deliberately minimal — only for preferences that are (a) global, (b)
// read by components far from where they're owned, and (c) not worth a context
// of their own. Right now: the math-input mode (live typeset vs. plain text).

import { useState, useEffect } from "react";

const settings = { mathInputMode: "live" };   // "plain" | "live"
const listeners = new Set();

function setUISetting(key, value){
  if(settings[key]===value) return;
  settings[key]=value;
  for(const l of listeners) l();
}
function getUISetting(key){ return settings[key]; }

function useUISetting(key){
  const [, force] = useState(0);
  useEffect(()=>{
    const l = ()=>force(n=>n+1);
    listeners.add(l);
    return ()=>listeners.delete(l);
  }, []);
  return settings[key];
}

export { setUISetting, getUISetting, useUISetting };
