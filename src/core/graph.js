// ── Selection / dependency graph helpers ─────────────────────────────────────
// The dependency model: `node.attachments` lists a node's UPSTREAM dependencies
// (the scalars/functions/domains it consumes, and for a camera the plots it
// shows). An edge therefore points consumer → dependency. These helpers walk
// that graph for the multi-select features.

// All nodes a starting set transitively DEPENDS ON (follows attachments, i.e.
// the upstream direction). The seed ids themselves are included so the result
// is a self-contained set ready to copy. guard prevents cycles.
function collectDependencies(seedIds, nodes){
  const out=new Set();
  const visit=(id)=>{
    if(out.has(id)) return;
    const n=nodes[id]; if(!n) return;
    out.add(id);
    for(const depId of (n.attachments||[])) if(nodes[depId]) visit(depId);
  };
  for(const id of seedIds) visit(id);
  return out;
}

// All nodes transitively CONNECTED to a starting set, treating edges as
// undirected (a node is connected to both its attachments and to any node that
// attaches to it). This is the connected component(s) containing the seeds.
function collectConnected(seedIds, nodes){
  // Build an undirected adjacency map once.
  const adj=new Map();
  const add=(a,b)=>{ if(!adj.has(a)) adj.set(a,new Set()); adj.get(a).add(b); };
  for(const [id,n] of Object.entries(nodes)){
    for(const depId of (n.attachments||[])){
      if(!nodes[depId]) continue;
      add(id,depId); add(depId,id);
    }
  }
  const out=new Set();
  const stack=[...seedIds].filter(id=>nodes[id]);
  while(stack.length){
    const id=stack.pop();
    if(out.has(id)) continue;
    out.add(id);
    for(const nb of (adj.get(id)||[])) if(!out.has(nb)) stack.push(nb);
  }
  return out;
}

// Build a portable JSON payload for a set of node ids. Includes each node in
// full plus a list of which attachment edges fall ENTIRELY inside the set
// (edges to nodes outside the selection are dropped on import so the payload is
// self-contained). Returns a plain object suitable for JSON.stringify.
function buildSelectionPayload(ids, nodes){
  const idSet=new Set([...ids].filter(id=>nodes[id]));
  const out=[];
  for(const id of idSet){
    const n=nodes[id];
    // Keep internal edges only; external attachments would dangle on import.
    const attachments=(n.attachments||[]).filter(a=>idSet.has(a));
    out.push({...structuredCloneSafe(n), attachments});
  }
  return { kind:"dedekind/selection", version:1, nodes:out };
}

// structuredClone is not available in every embedding; fall back to a JSON
// round-trip (node props are plain serialisable data — expressions are strings).
function structuredCloneSafe(obj){
  try { return structuredClone(obj); }
  catch { return JSON.parse(JSON.stringify(obj)); }
}

// Validate + materialise a selection payload into a map of brand-new nodes with
// fresh ids (so they never collide with existing ones). Internal attachment
// edges are rewired to the new ids; positions are placed either by a fixed
// `offset` (default — nudges the cluster off the original) or, when
// `opts.center` is given, so the cluster's bounding-box midpoint lands on that
// world point (used for paste-under-cursor). `makeId` is the id generator
// (passed in to avoid a hard import cycle). Returns { nodes:{id:node}, ids:[...] }
// or null if the payload is not a valid selection. Project nodes are skipped.
function importSelection(payload, makeId, opts={}){
  const offset = opts.offset || {x:40,y:40};
  const center = opts.center || null;   // {x,y} world point to center on
  if(!payload || payload.kind!=="dedekind/selection" || !Array.isArray(payload.nodes)) return null;
  const remap=new Map();
  const incoming=payload.nodes.filter(n=>n && n.id && n.type && n.type!=="project");
  if(!incoming.length) return null;
  for(const n of incoming) remap.set(n.id, makeId());

  // When centering, compute the cluster's current bounding-box midpoint so we
  // can translate every node by (center - midpoint).
  let tx=offset.x, ty=offset.y;
  if(center){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const n of incoming){
      const x=n.pos?.x??0, y=n.pos?.y??0;
      if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y;
    }
    const midX=(minX+maxX)/2, midY=(minY+maxY)/2;
    tx=center.x-midX; ty=center.y-midY;
  }

  const out={};
  for(const n of incoming){
    const newId=remap.get(n.id);
    const clone=structuredCloneSafe(n);
    clone.id=newId;
    // Keep only edges whose target is also part of this payload, rewired to the
    // fresh ids. (buildSelectionPayload already trims external edges, but we
    // re-check so hand-edited / partial payloads can't introduce dangling refs.)
    clone.attachments=(n.attachments||[]).map(a=>remap.get(a)).filter(Boolean);
    const px=(n.pos?.x??300)+tx, py=(n.pos?.y??160)+ty;
    clone.pos={x:px,y:py};
    out[newId]=clone;
  }
  return { nodes:out, ids:[...remap.values()] };
}

export { collectDependencies, collectConnected, buildSelectionPayload, importSelection };
