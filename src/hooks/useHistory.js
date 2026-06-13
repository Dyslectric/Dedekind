import { useRef, useState, useCallback, useEffect } from "react";

// ── Undo / redo history ──────────────────────────────────────────────────────
// Wraps a piece of state (the node graph) with past/future stacks. Design goals:
//   • Coalesce rapid edits (dragging a node, typing in a field) into a single
//     undo step via a short idle window, so undo isn't per-pixel/per-keystroke.
//   • Treat structural changes (add/delete/connect/load) as their own discrete
//     steps by letting callers force a commit boundary.
//   • Never record animation playback: animator values live in a ref and don't
//     flow through this state, and the rare animator state writes (e.g. a "once"
//     loop finishing) are deliberately coalesced/ignored where appropriate.
//
// Usage:
//   const { state, set, undo, redo, canUndo, canRedo, beginStep } = useHistory(initial);
//   set(next | updater, { coalesce })   — change state (records history)
//   beginStep()                          — force the next set() to start a new step
//
// `set` mirrors React's setState signature. By default consecutive sets within
// COALESCE_MS extend the current history step; pass {coalesce:false} (or call
// beginStep() first) to start a fresh step immediately.
const COALESCE_MS = 450;
const MAX_DEPTH = 200;

function useHistory(initial){
  const [state, setStateRaw] = useState(initial);
  const stateRef = useRef(initial);
  const past = useRef([]);          // array of previous snapshots (oldest → newest)
  const future = useRef([]);        // redo snapshots (newest first)
  const lastEditAt = useRef(0);
  const stepOpen = useRef(false);   // is the current coalescing window still open?
  const [, force] = useState(0);    // bump to refresh canUndo/canRedo in UI

  useEffect(()=>{ stateRef.current = state; }, [state]);

  const refresh = useCallback(()=>force(n=>n+1),[]);

  // Force the next set() to begin a new, separate history step.
  const beginStep = useCallback(()=>{ stepOpen.current = false; }, []);

  const set = useCallback((next, opts={})=>{
    const prev = stateRef.current;
    const value = typeof next === "function" ? next(prev) : next;
    if (value === prev) return;                       // no-op change: skip
    const now = performance.now();
    const coalesce = opts.coalesce !== false
      && stepOpen.current
      && (now - lastEditAt.current) < COALESCE_MS;
    if (!coalesce){
      // Open a fresh step: record the prior committed state as an undo point.
      past.current.push(prev);
      if (past.current.length > MAX_DEPTH) past.current.shift();
      future.current = [];                            // any new edit clears redo
      stepOpen.current = true;
    }
    // (when coalescing, we extend the current step — the snapshot already on
    //  `past` remains the correct "before" state for this whole burst)
    lastEditAt.current = now;
    stateRef.current = value;
    setStateRaw(value);
    refresh();
  }, [refresh]);

  // Replace state WITHOUT recording history (e.g. live animator commits we don't
  // want as undo points). Keeps undo/redo stacks intact.
  const setSilent = useCallback((next)=>{
    const prev = stateRef.current;
    const value = typeof next === "function" ? next(prev) : next;
    if (value === prev) return;
    stateRef.current = value;
    setStateRaw(value);
  }, []);

  // Reset history entirely around a new base state (e.g. loading a project).
  const reset = useCallback((value)=>{
    past.current = []; future.current = []; stepOpen.current = false;
    stateRef.current = value; setStateRaw(value); refresh();
  }, [refresh]);

  const undo = useCallback(()=>{
    if (!past.current.length) return;
    const prev = past.current.pop();
    future.current.push(stateRef.current);
    stepOpen.current = false;                         // close any open coalescing window
    stateRef.current = prev; setStateRaw(prev); refresh();
  }, [refresh]);

  const redo = useCallback(()=>{
    if (!future.current.length) return;
    const nextState = future.current.pop();
    past.current.push(stateRef.current);
    stepOpen.current = false;
    stateRef.current = nextState; setStateRaw(nextState); refresh();
  }, [refresh]);

  return {
    state, stateRef, set, setSilent, reset, undo, redo, beginStep,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

export { useHistory };
