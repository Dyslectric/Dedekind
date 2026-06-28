import * as math from "mathjs";

// ── GPU offload: expression → GLSL transpiler ────────────────────────────────
// Translates the subset of mathjs expressions that map cleanly to GLSL so that
// analytic surfaces (z=f(x,y), y=f(x), parametric x/y/z=f(u,v)) can be evaluated
// in a vertex shader on the GPU instead of CPU-sampling thousands of points.
// Returns null for anything unsupported (user functions, conditionals, unknown
// symbols) — callers then fall back to the CPU/worker path. Free scalar
// variables (sliders/animators) are passed in as uniforms.
const _GLSL_FN1 = { sin:1,cos:1,tan:1,asin:1,acos:1,atan:1,sinh:1,cosh:1,tanh:1,exp:1,log:1,sqrt:1,abs:1,floor:1,ceil:1,sign:1,fract:1,round:"floor",
  // additional single-arg functions with direct or trivial GLSL equivalents
  asinh:1,acosh:1,atanh:1,trunc:"trunc",exp2:"exp2",log2:"log2",radians:"radians",degrees:"degrees" };
const _GLSL_FN2 = { pow:"pow",atan2:"atan",mod:"mod",min:"min",max:"max",step:"step" };
const _GLSL_CONST = { pi:"3.141592653589793",e:"2.718281828459045",tau:"6.283185307179586",phi:"1.618033988749895" };
// Symbols currently bound to a COMPLEX scope value. exprToGLSL emits re()/im() of
// these as decomposed re_<name>/im_<name> uniforms (a complex uniform is two
// floats). The builder sets this from the live scope just before transpiling.
const _COMPLEX_SCOPE_SYMS = new Set();
function setComplexScopeSyms(scope){
  _COMPLEX_SCOPE_SYMS.clear();
  if(!scope) return;
  for(const k in scope){ const v=scope[k];
    if(v && typeof v==="object" && typeof v.re==="number" && typeof v.im==="number") _COMPLEX_SCOPE_SYMS.add(k); }
}
// Greek glyph → ASCII, mirroring core/math.js so the GPU path normalizes the
// same way (π/τ/φ are the constants; the rest are conventional variable names).
const _GREEK_GLSL = {
  "π":"pi","τ":"tau","φ":"phi","θ":"theta","α":"alpha","β":"beta","γ":"gamma",
  "λ":"lambda","μ":"mu","ω":"omega","σ":"sigma","δ":"delta","ρ":"rho","ε":"epsilon",
};
// Single-char constants that are always valid juxtaposition tokens (mirrors CPU).
const _GLSL_SINGLE_CONST = new Set(["e","i"]);
// Greedy longest-match tokenizer for a glued letter run: `pi` first, then known
// axis letters / single-char constants. Returns token names or null (leave run
// intact). Identical rule to core/math.js _tokenizeRun.
function _glslTokenizeRun(name, knownLetters){
  if(name.length<2 || !/^[A-Za-z]+$/.test(name)) return null;
  const toks=[]; let p=0;
  while(p<name.length){
    if(name.startsWith("pi",p)){ toks.push("pi"); p+=2; continue; }
    const c=name[p];
    if(knownLetters.has(c) || _GLSL_SINGLE_CONST.has(c)){ toks.push(c); p+=1; continue; }
    return null;
  }
  return toks.length>=2 ? toks : null;
}
// Rewrite glued letter-run SymbolNodes into single-token products, using the
// axis variable set as the known letters. A name that is an axis var, a builtin
// constant, or `i` (imaginary) is left intact for the walker to resolve/reject.
function _glslSplitJux(root, vars){
  const RESERVED = (n)=> n==="pi" || n==="e" || n==="i";
  return root.transform(function(n){
    if(n.isSymbolNode){
      const nm=n.name;
      if(vars.has(nm) || RESERVED(nm)) return n;
      const toks=_glslTokenizeRun(nm, vars);
      if(toks){
        let acc=new math.SymbolNode(toks[0]);
        for(let i=1;i<toks.length;i++) acc=new math.OperatorNode("*","multiply",[acc,new math.SymbolNode(toks[i])]);
        return acc;
      }
    }
    return n;
  });
}
// ── Fractal distance-estimator intrinsics ────────────────────────────────────
// Genuine fractals need ITERATION, which a closed-form expression can't express,
// so these are recognized as function calls that emit a GLSL helper with a real
// loop. They are only defined inside the ray-march shader (implicit-raymarch.js
// injects fractalHelpersFor(glsl) before the field function), so they are meant
// for an `equation` rendered through a transformer. Each takes the sample point
// as its first three arguments; the rest are shape parameters (which can be
// wired sliders/animators → live uniforms). They return a distance estimate
// (≈0 on the surface), which the ray-marcher's sphere-trace / graze step renders.
//   mandelbulb(x,y,z, power)   — the 3-D Mandelbrot (animate the power)
//   mandelbox(x,y,z, scale)    — box+sphere folding fractal (animate the scale)
//   menger(x,y,z)              — Menger-sponge SDF (signed)
//   juliaq(x,y,z, cx,cy,cz)    — quaternion Julia set (animate c)
const FRACTAL_INTRINSICS = {
  mandelbulb:{ argc:4, emit:A=>`frMandelbulb(vec3(${A[0]},${A[1]},${A[2]}),${A[3]})` },
  mandelbox: { argc:4, emit:A=>`frMandelbox(vec3(${A[0]},${A[1]},${A[2]}),${A[3]})` },
  menger:    { argc:3, emit:A=>`frMenger(vec3(${A[0]},${A[1]},${A[2]}))` },
  juliaq:    { argc:6, emit:A=>`frJulia(vec3(${A[0]},${A[1]},${A[2]}),vec3(${A[3]},${A[4]},${A[5]}))` },
};
// GLSL bodies for the helpers each intrinsic emits (plus the _frBox SDF the
// Menger sponge needs). Standard distance estimators.
const FRACTAL_GLSL = {
  _frBox: `float _frBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0); }`,
  frMandelbulb: `float frMandelbulb(vec3 pos,float power){
    vec3 z=pos; float dr=1.0; float r=0.0;
    for(int i=0;i<8;i++){
      r=length(z); if(r>2.0) break;
      float th=acos(clamp(z.z/max(r,1e-6),-1.0,1.0));
      float ph=atan(z.y,z.x);
      float zr=pow(r,power);
      dr=pow(r,power-1.0)*power*dr+1.0;
      th*=power; ph*=power;
      z=zr*vec3(sin(th)*cos(ph),sin(th)*sin(ph),cos(th))+pos;
    }
    return 0.5*log(max(r,1e-6))*r/max(dr,1e-6);
  }`,
  frMandelbox: `float frMandelbox(vec3 pos,float scale){
    vec3 z=pos; float dr=1.0;
    for(int i=0;i<9;i++){
      z=clamp(z,-1.0,1.0)*2.0-z;
      float r2=dot(z,z);
      float f = r2<0.25 ? 4.0 : (r2<1.0 ? 1.0/r2 : 1.0);
      z=z*f*scale+pos;
      dr=dr*abs(scale)*f+1.0;
    }
    return length(z)/abs(dr);
  }`,
  frMenger: `float frMenger(vec3 p){
    float d=_frBox(p,vec3(1.2));
    float s=1.0;
    for(int i=0;i<5;i++){
      vec3 a=mod(p*s,2.0)-1.0;
      s*=3.0;
      vec3 r=abs(1.0-3.0*abs(a));
      float da=max(r.x,r.y), db=max(r.y,r.z), dc=max(r.z,r.x);
      float c=(min(da,min(db,dc))-1.0)/s;
      d=max(d,c);
    }
    return d;
  }`,
  frJulia: `float frJulia(vec3 pos,vec3 c){
    vec4 z=vec4(pos,0.0); vec4 cc=vec4(c,0.0);
    float dr=1.0; float mz=dot(z,z);
    for(int i=0;i<9;i++){
      dr=2.0*sqrt(max(mz,1e-12))*dr+1.0;
      vec4 nz;
      nz.x=z.x*z.x-dot(z.yzw,z.yzw);
      nz.yzw=2.0*z.x*z.yzw;
      z=nz+cc;
      mz=dot(z,z);
      if(mz>4.0) break;
    }
    float r=sqrt(max(mz,1e-12));
    return 0.5*r*log(max(r,1e-6))/max(dr,1e-6);
  }`,
};
// Given a transpiled GLSL string, return the helper definitions it references, in
// dependency order (so a caller can prepend them to the shader). Empty if none.
function fractalHelpersFor(glsl){
  if(!glsl) return "";
  const need=new Set();
  for(const k of Object.keys(FRACTAL_GLSL)){ if(glsl.indexOf(k+"(")>=0) need.add(k); }
  if(need.has("frMenger")) need.add("_frBox");
  const order=["_frBox","frMandelbulb","frMandelbox","frMenger","frJulia"];
  return order.filter(k=>need.has(k)).map(k=>FRACTAL_GLSL[k]).join("\n");
}
function _glslNum(v){ let s=String(v); if(!/[.eE]/.test(s)) s+=".0"; return s; }

// GLSL's pow(x,y) is undefined for x<0 (returns NaN on most GPUs), so a plain
// translation of `x^2` breaks every polynomial surface over negative x. Emit
// safe forms instead:
//   • small integer exponent (|k|<=8): expand to repeated multiply (exact,
//     sign-correct, and faster than a pow() call) — covers x^2, x^3, r^2, …
//   • exponent 0.5 / -0.5: sqrt / inversesqrt
//   • general real exponent: sign-correcting pow that mirrors mathjs/JS:
//        s = sign-of-base handling so (-2)^2 == 4, (-2)^3 == -8 for integer-
//        valued exponents, and |base|^exp for non-integer (matching JS NaN only
//        when truly undefined). We approximate JS semantics for the common case.
function _glslPow(a, b, bNode){
  // constant numeric exponent? (also detect unary-minus of a constant, e.g. x^-2)
  let k=null;
  if(bNode){
    if(bNode.type==="ConstantNode" && typeof bNode.value==="number") k=bNode.value;
    else if(bNode.type==="OperatorNode" && bNode.fn==="unaryMinus"
            && bNode.args[0]?.type==="ConstantNode" && typeof bNode.args[0].value==="number")
      k=-bNode.args[0].value;
  }
  if(k!=null){
    if(k===0) return "1.0";
    if(k===1) return a;
    if(k===0.5) return `sqrt(${a})`;
    if(k===-0.5) return `inversesqrt(${a})`;
    if(Number.isInteger(k) && Math.abs(k)<=8){
      const n=Math.abs(k);
      // bind the base once via a helper-free inline: repeat multiply. Since `a`
      // may be a complex expression, wrap so it's evaluated once is not possible
      // without a temp; GLSL has no statement context here, so we accept textual
      // repetition (the GLSL compiler CSEs identical subexpressions).
      const mul="("+Array(n).fill(a).join("*")+")";
      return k>0 ? mul : `(1.0/${mul})`;
    }
    // other constant exponent: sign-safe pow with magnitude, integer-parity sign.
    // For non-integer k this yields pow(|a|,k) (matches JS for a>=0; for a<0 JS
    // returns NaN which we approximate as pow on magnitude — rare in surfaces).
    return `pow(abs(${a}),${_glslNum(k)})`;
  }
  // non-constant exponent: use magnitude-based pow (safe, no NaN); exact for a>=0.
  return `pow(abs(${a}),${b})`;
}

// vars: Set of axis variable names (x,y / x / u,v). uniforms: Set collecting
// referenced free scalar names (always the ORIGINAL names, for scope lookup).
// prefix: optional GLSL identifier prefix applied to emitted free-scalar symbols
// so a user scalar named like a shader internal (a, e, f, h, P, L, …) or a
// builtin cannot collide. Callers that pass a prefix must declare the uniforms as
// `${prefix}${name}` while still reading their values from scope[name]. Default ""
// keeps the bare-name behavior (used by the transpilability probes in scope.js).
// fnTable: optional map name → {params:[...], expr:"..."} of user fnDefs. When a
// FunctionNode names an entry, its body is INLINED (parameters substituted by the
// argument ASTs) so composed surfaces (built from helper functions) can ride the
// GPU path instead of falling back to CPU. Recursion is depth/cycle guarded.
// Returns GLSL string or null.
function exprToGLSL(expr, vars, uniforms, prefix="", fnTable=null, field=undefined){
  // When the expression's field treats `i` as the imaginary unit, it can't go to
  // GLSL (no complex on the GPU) and any use of `i` rejects → CPU fallback. When
  // the field frees `i` (real), `i` is an ordinary symbol the transpiler handles
  // like any other variable/uniform. Default (no field) is real.
  const iImaginary = field === "complex";
  // Normalize Greek glyphs to ASCII so π/τ/φ transpile as the constants, matching
  // the CPU path (core/math.js normalizeGreek). Kept inline to avoid importing
  // math.js into the shader layer.
  let text = String(expr);
  for(const g in _GREEK_GLSL) if(text.indexOf(g)>=0) text = text.split(g).join(_GREEK_GLSL[g]);
  let root; try { root = math.parse(text); } catch { return null; }
  // Apply the SAME juxtaposition rule as the CPU path so `xy`→x*y, `pir`→pi*r,
  // etc. transpile identically (without this, a glued run would be emitted as a
  // single bogus uniform). Known letters here are the axis vars; `pi`/`e` are
  // constants and `i` is the imaginary unit (which can't go to GLSL, so a run
  // containing it makes the whole expression non-transpilable → CPU fallback).
  root = _glslSplitJux(root, vars);
  // Substitute parameter SymbolNodes in an fnDef body AST with the call's argument
  // ASTs, so the inlined body references the caller's expressions/vars directly.
  const substitute = (node, bind) => {
    switch(node.type){
      case "SymbolNode": return bind[node.name] || node;
      case "ConstantNode": return node;
      case "ParenthesisNode": return new math.ParenthesisNode(substitute(node.content, bind));
      case "OperatorNode": return new math.OperatorNode(node.op, node.fn, node.args.map(a=>substitute(a,bind)), node.implicit);
      case "FunctionNode": return new math.FunctionNode(node.fn.name, node.args.map(a=>substitute(a,bind)));
      default: return node;
    }
  };
  const walk = (node, depth) => {
    if(depth > 64) return null;     // runaway inlining guard
    switch(node.type){
      case "ConstantNode": return typeof node.value==="number" ? _glslNum(node.value) : null;
      case "ParenthesisNode": { const c=walk(node.content, depth); return c==null?null:"("+c+")"; }
      case "SymbolNode": {
        if(vars.has(node.name)) return node.name;
        // `i` is the imaginary unit (complex field only) — GLSL has no complex
        // numbers, so any expression that references it cannot transpile.
        // Returning null makes the caller fall back to the (complex-correct) CPU
        // path. In a real field `i` is an ordinary symbol and falls through to the
        // uniform/builtin handling below.
        if(node.name==="i" && iImaginary) return null;
        if(_GLSL_CONST[node.name]) return _GLSL_CONST[node.name];
        // a free scalar (slider/animator/constant) → uniform. Collect the original
        // name (scope is keyed on it) but EMIT a prefixed identifier so it can't
        // collide with shader internals or GLSL builtins.
        if(/^[A-Za-z_]\w*$/.test(node.name)){ uniforms.add(node.name); return prefix+node.name; }
        return null;
      }
      case "OperatorNode": {
        if(node.fn==="unaryMinus"){ const a=walk(node.args[0], depth); return a==null?null:"(-"+a+")"; }
        if(node.fn==="unaryPlus"){ return walk(node.args[0], depth); }
        if(node.op==="^"){ const a=walk(node.args[0], depth),b=walk(node.args[1], depth); return (a==null||b==null)?null:_glslPow(a,b,node.args[1]); }
        if(["+","-","*","/"].includes(node.op)){ const a=walk(node.args[0], depth),b=walk(node.args[1], depth); return (a==null||b==null)?null:"("+a+node.op+b+")"; }
        return null;
      }
      case "FunctionNode": {
        const n=node.fn.name;
        // 1-arg standard functions
        if(_GLSL_FN1[n]&&node.args.length===1){ const a=walk(node.args[0], depth); if(a==null)return null; const g=_GLSL_FN1[n]===1?n:_GLSL_FN1[n]; return g+"("+a+")"; }
        // 2-arg standard functions
        if(_GLSL_FN2[n]&&node.args.length===2){
          const a=walk(node.args[0], depth),b=walk(node.args[1], depth); if(a==null||b==null)return null;
          if(n==="pow") return _glslPow(a,b,node.args[1]);
          return _GLSL_FN2[n]+"("+a+","+b+")";
        }
        // composite / derived functions expressible via GLSL primitives
        if(node.args.length===1){
          const a=walk(node.args[0], depth); if(a==null)return null;
          switch(n){
            case "square": return `(${a})*(${a})`;
            case "cube":   return `(${a})*(${a})*(${a})`;
            case "cbrt":   return `(sign(${a})*pow(abs(${a}),0.3333333333333333))`;
            case "log10":  return `(log(${a})/2.302585092994046)`;
            case "ln":     return `log(${a})`;
            case "sec":    return `(1.0/cos(${a}))`;
            case "csc":    return `(1.0/sin(${a}))`;
            case "cot":    return `(cos(${a})/sin(${a}))`;
          }
        }
        // re(z)/im(z) of a bare symbol bound to a COMPLEX scope value: the GPU has
        // no complex type, but a complex uniform is just two floats. Emit dedicated
        // uniforms re_<name> / im_<name> and register the original name so the
        // uniform resolver splits the Complex into those two float uniforms. This
        // lets a complex-slider value (read via re()/im()) drive a GPU surface.
        if((n==="re"||n==="im") && node.args.length===1 && node.args[0].type==="SymbolNode"){
          const sym=node.args[0].name;
          if(!vars.has(sym) && _COMPLEX_SCOPE_SYMS.has(sym)){
            const u = (n==="re"?"re_":"im_")+sym;
            uniforms.add(u);           // resolver maps this back to <name>.re / .im
            return prefix+u;
          }
        }
        if(node.args.length===2){
          const a=walk(node.args[0], depth),b=walk(node.args[1], depth); if(a==null||b==null)return null;
          switch(n){
            case "hypot":  return `sqrt((${a})*(${a})+(${b})*(${b}))`;
            case "log":    return `(log(${a})/log(${b}))`;   // log(value, base)
          }
        }
        // fractal distance-estimator intrinsic → emit a call to the looping GLSL
        // helper (defined by the ray-march shader). The point is the first 3 args.
        if(FRACTAL_INTRINSICS[n] && node.args.length===FRACTAL_INTRINSICS[n].argc){
          const A=node.args.map(a=>walk(a, depth)); if(A.some(x=>x==null)) return null;
          return FRACTAL_INTRINSICS[n].emit(A);
        }
        // user fnDef → inline its body with parameters bound to the call args.
        if(fnTable && fnTable[n] && fnTable[n].params.length===node.args.length){
          const def=fnTable[n];
          let body; try { body = math.parse(def.expr); } catch { return null; }
          const bind={};
          // Wrap each argument AST in parentheses-equivalent by substituting the
          // node directly; the substituted body is then transpiled, so argument
          // expressions are emitted inline (GLSL CSEs identical subexpressions).
          for(let i=0;i<def.params.length;i++) bind[def.params[i]]=node.args[i];
          const inlined=substitute(body, bind);
          return walk(inlined, depth+1);
        }
        return null;
      }
      default: return null;
    }
  };
  return walk(root, 0);
}

// Build an fnTable (name → {params, expr}) from a resolved scope's fnDef closures
// (the closures carry _fnName/_fnParams/_fnExpr metadata, see makeFn). Pass the
// result as exprToGLSL's fnTable argument to inline user functions into the GPU
// path. Returns null if the scope has no fnDefs (so callers can cheaply skip).
// Recurses into each fnDef's own closed-over scope so a helper that itself calls
// another helper (nested composition) is fully inlinable.
function fnTableFromScope(scope){
  if(!scope) return null;
  let table=null;
  const seen=new Set();
  const collect=(sc)=>{
    if(!sc) return;
    for(const k in sc){
      const v=sc[k];
      if(typeof v==="function" && v._fnExpr!=null && Array.isArray(v._fnParams)){
        const name=v._fnName||k;
        if(seen.has(name)) continue; seen.add(name);
        (table||(table={}))[name]={ params:v._fnParams, expr:v._fnExpr };
        collect(v._fnScope);   // pull in helpers this helper calls
      }
    }
  };
  collect(scope);
  return table;
}

// A stable text signature of an fnTable's STRUCTURE (names, params, bodies). Used
// to key the transpilability probes' memo: whether an expression transpiles can
// change when a referenced fnDef's body changes, but not when a slider value
// changes, so the value-free structure is the right cache key. "" when no table.
function fnTableSig(fnTable){
  if(!fnTable) return "";
  return Object.keys(fnTable).sort()
    .map(n=>`${n}(${(fnTable[n].params||[]).join(",")})=${fnTable[n].expr}`).join(";");
}

// Flatten every fnDef-private numeric scalar reachable from a scope into a flat
// {name: value} map. When a fnDef body is INLINED into a shader, the scalars it
// references (that aren't its parameters) are emitted as uniforms by their
// original names — but those scalars live in the fnDef's OWN closed-over scope,
// not the consumer's, so the consumer's scope can't resolve them. This hoists
// them so the uniform values are available at build and update time. Parameter
// names are stripped (they're substituted by call-site args, never uniforms).
function _collectFnScalars(scope, out, seen){
  if(!scope) return out;
  for(const k in scope){
    const v=scope[k];
    if(typeof v==="function" && v._fnExpr!=null && Array.isArray(v._fnParams)){
      const name=v._fnName||k;
      if(seen.has(name)) continue; seen.add(name);
      const fnScope=v._fnScope||{};
      const params=new Set(v._fnParams);
      for(const kk in fnScope){
        if(params.has(kk)) continue;
        const vv=fnScope[kk];
        if(typeof vv==="number" && !(kk in out)) out[kk]=vv;
      }
      _collectFnScalars(fnScope, out, seen);   // nested helpers + their scalars
    }
  }
  return out;
}
// Return a scope augmented with all inlined-fnDef-private scalars, so shader
// uniforms resolve. The consumer's own scalars win on name conflict. Returns the
// SAME object when there are no fnDef-private scalars (the common case), so the
// per-frame uniform update doesn't allocate for ordinary surfaces.
function augmentScopeForGPU(scope){
  if(!scope) return scope;
  const extra=_collectFnScalars(scope, {}, new Set());
  for(const _ in extra) return { ...extra, ...scope };
  return scope;
}

// Reserved prefix for user-derived (slider/constant/animator) uniforms in
// generated shaders. Chosen so it can't collide with shader-internal locals
// (single letters, camelCase) or the app's own uniforms (uSteps, uColor, …).
const GLSL_UNIFORM_PREFIX = "usr_";

// Resolve a uniform NAME to its float value from scope, handling the decomposed
// complex uniforms re_<name>/im_<name> emitted for re()/im() of complex sliders.
function resolveUniformValue(name, scope){
  if(!scope) return 0;
  let m;
  if((m=/^re_(.+)$/.exec(name))){ const v=scope[m[1]]; return (v&&typeof v.re==="number")?v.re:(Number(v)||0); }
  if((m=/^im_(.+)$/.exec(name))){ const v=scope[m[1]]; return (v&&typeof v.im==="number")?v.im:0; }
  return Number(scope[name])||0;
}

// ── Complex → GLSL (vec2 = re,im) ────────────────────────────────────────────
// GLSL has no complex type, but a complex number is a vec2 (x=re, y=im) and the
// arithmetic decomposes into real ops. complexExprToGLSL transpiles an
// expression over the complex plane — where `re`/`im` are the real/imag parts of
// the input z (provided as vec2 locals) and `i` is the imaginary unit — into a
// vec2-valued GLSL expression, so a ℂ→ℂ map can be evaluated per fragment.
// Returns null if anything can't be expressed. Uniforms (sliders) are collected
// as real floats and lifted to vec2(u,0.0). `_COMPLEX_HELPERS_GLSL` must be
// prepended to the shader.
const _COMPLEX_HELPERS_GLSL = `
vec2 _cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 _cdiv(vec2 a, vec2 b){ float d=b.x*b.x + b.y*b.y; return vec2((a.x*b.x + a.y*b.y)/d, (a.y*b.x - a.x*b.y)/d); }
vec2 _cexp(vec2 a){ float e=exp(a.x); return vec2(e*cos(a.y), e*sin(a.y)); }
vec2 _clog(vec2 a){ return vec2(0.5*log(a.x*a.x + a.y*a.y), atan(a.y, a.x)); }
vec2 _cpow(vec2 a, vec2 b){ // a^b = exp(b * log a); a=0 → 0
  if(a.x==0.0 && a.y==0.0) return vec2(0.0);
  return _cexp(_cmul(b, _clog(a))); }
vec2 _cpowi(vec2 a, int n){ // integer power by repeated multiply (exact, fast)
  if(n==0) return vec2(1.0,0.0);
  bool inv = n<0; if(inv) n=-n;
  vec2 r=vec2(1.0,0.0), base=a;
  for(int k=0;k<32;k++){ if(k>=n) break; r=_cmul(r,base); }
  return inv ? _cdiv(vec2(1.0,0.0), r) : r; }
// Unrolled small powers: branch-free, base evaluated once (the caller passes the
// base subexpression as the single argument, so there's no re-evaluation).
vec2 _cp2(vec2 a){ return _cmul(a,a); }
vec2 _cp3(vec2 a){ return _cmul(_cmul(a,a),a); }
vec2 _cp4(vec2 a){ vec2 b=_cmul(a,a); return _cmul(b,b); }
vec2 _cp5(vec2 a){ vec2 b=_cmul(a,a); return _cmul(_cmul(b,b),a); }
vec2 _cp6(vec2 a){ vec2 b=_cmul(a,a); return _cmul(_cmul(b,b),b); }
vec2 _cp7(vec2 a){ vec2 b=_cmul(a,a); return _cmul(_cmul(_cmul(b,b),b),a); }
vec2 _cp8(vec2 a){ vec2 b=_cmul(a,a); vec2 c=_cmul(b,b); return _cmul(c,c); }
vec2 _csin(vec2 a){ return vec2(sin(a.x)*cosh(a.y), cos(a.x)*sinh(a.y)); }
vec2 _ccos(vec2 a){ return vec2(cos(a.x)*cosh(a.y), -sin(a.x)*sinh(a.y)); }
vec2 _csqrt(vec2 a){ float r=length(a); return vec2(sqrt(max(0.0,(r+a.x)*0.5)), sign(a.y==0.0?1.0:a.y)*sqrt(max(0.0,(r-a.x)*0.5))); }
`;

// Emit an unrolled small-integer complex power (|n|<=8) as a _cpN(base) call.
// n=0 → 1, n=1 → base, n<0 → reciprocal. Returns null if out of range.
function _cmulPowGLSL(a, n){
  if(n===0) return "vec2(1.0,0.0)";
  const m=Math.abs(n);
  if(m>8) return null;
  const pos = m===1 ? `(${a})` : `_cp${m}(${a})`;
  return n<0 ? `_cdiv(vec2(1.0,0.0),${pos})` : pos;
}

function complexExprToGLSL(expr, uniforms, prefix=""){
  let text = String(expr);
  for(const g in _GREEK_GLSL) if(text.indexOf(g)>=0) text = text.split(g).join(_GREEK_GLSL[g]);
  let root; try { root = math.parse(text); } catch { return null; }
  // known symbols: the input parts re,im and the imaginary unit i. Everything else
  // single-letter or named is a (real) uniform.
  const vars = new Set(["re","im","i"]);
  root = _glslSplitJux(root, vars);
  const C = (re,im)=>`vec2(${_glslNum(re)},${_glslNum(im)})`;
  const walk = (node, depth) => {
    if(depth>64) return null;
    switch(node.type){
      case "ConstantNode": return typeof node.value==="number" ? C(node.value,0) : null;
      case "ParenthesisNode": { const c=walk(node.content,depth); return c==null?null:"("+c+")"; }
      case "SymbolNode": {
        if(node.name==="re") return "vec2(_z.x,0.0)";
        if(node.name==="im") return "vec2(_z.y,0.0)";
        if(node.name==="i")  return "vec2(0.0,1.0)";
        if(node.name==="pi") return C(Math.PI,0);
        if(node.name==="e")  return C(Math.E,0);
        if(node.name==="tau")return C(2*Math.PI,0);
        // a slider/constant uniform. A COMPLEX-valued one (e.g. a complex slider)
        // decomposes to two real uniforms re_<name>/im_<name> → vec2; a real one
        // lifts to vec2(value, 0).
        if(/^[A-Za-z_]\w*$/.test(node.name)){
          if(_COMPLEX_SCOPE_SYMS.has(node.name)){
            uniforms.add("re_"+node.name); uniforms.add("im_"+node.name);
            return `vec2(${prefix}re_${node.name},${prefix}im_${node.name})`;
          }
          uniforms.add(node.name); return `vec2(${prefix}${node.name},0.0)`;
        }
        return null;
      }
      case "OperatorNode": {
        if(node.fn==="unaryMinus"){ const a=walk(node.args[0],depth); return a==null?null:`(-(${a}))`; }
        if(node.fn==="unaryPlus") return walk(node.args[0],depth);
        if(node.op==="+"||node.op==="-"){ const a=walk(node.args[0],depth),b=walk(node.args[1],depth); return (a==null||b==null)?null:`(${a}${node.op}${b})`; }
        if(node.op==="*"){ const a=walk(node.args[0],depth),b=walk(node.args[1],depth); return (a==null||b==null)?null:`_cmul(${a},${b})`; }
        if(node.op==="/"){ const a=walk(node.args[0],depth),b=walk(node.args[1],depth); return (a==null||b==null)?null:`_cdiv(${a},${b})`; }
        if(node.op==="^"){
          const a=walk(node.args[0],depth); if(a==null) return null;
          const en=node.args[1];
          if(en.type==="ConstantNode" && typeof en.value==="number" && Number.isInteger(en.value) && Math.abs(en.value)<=8){
            // small integer power → fully unrolled inline _cmul chain. GPUs run a
            // loop-with-break poorly (divergent loops can execute every iteration),
            // so for the common exponents (², ³, …) emit branch-free multiplies.
            const g=_cmulPowGLSL(a, en.value); if(g!=null) return g;
          }
          if(en.type==="ConstantNode" && typeof en.value==="number" && Number.isInteger(en.value) && Math.abs(en.value)<=32)
            return `_cpowi(${a},${en.value})`;
          const b=walk(en,depth); return b==null?null:`_cpow(${a},${b})`;
        }
        return null;
      }
      case "FunctionNode": {
        const n=node.fn.name;
        if(node.args.length===1){
          const a=walk(node.args[0],depth); if(a==null) return null;
          switch(n){ case "exp":return `_cexp(${a})`; case "log":case "ln":return `_clog(${a})`;
            case "sin":return `_csin(${a})`; case "cos":return `_ccos(${a})`;
            case "sqrt":return `_csqrt(${a})`;
            case "conj":return `vec2((${a}).x,-(${a}).y)`; }
        }
        if(n==="pow" && node.args.length===2){ const a=walk(node.args[0],depth),b=walk(node.args[1],depth); return (a==null||b==null)?null:`_cpow(${a},${b})`; }
        return null;
      }
      default: return null;
    }
  };
  return walk(root, 0);
}

export {
  exprToGLSL, _glslNum, GLSL_UNIFORM_PREFIX, fnTableFromScope, fnTableSig, augmentScopeForGPU, fractalHelpersFor,
  setComplexScopeSyms, resolveUniformValue, complexExprToGLSL, _COMPLEX_HELPERS_GLSL
};
