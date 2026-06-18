// ── Math layout core (pure, no DOM, no React) ────────────────────────────────
//
// This is the foundation of the live typeset math input. It turns a plain
// mathjs-style TEXT string into a LAYOUT TREE: a transient, read-only view that
// describes how to draw the expression typeset (fractions stacked, exponents
// raised, ∑/∫/∏ with bounds), where every leaf remembers the [start,end) range
// of source text it came from.
//
// DESIGN CONTRACT (load-bearing):
//   • The text string is the ONLY source of truth. This tree is rebuilt fresh
//     from the text on every render and never edited in place.
//   • Every node carries `s` and `e`: the inclusive-start / exclusive-end
//     offsets into the source text that it represents. This is what lets the
//     caret (an integer index into the text) map to/from a screen position.
//   • The parser is intentionally LENIENT. The user is mid-typing, so the input
//     is usually not a complete valid expression. Unclosed parens, a trailing
//     operator, an empty fraction denominator — all must produce a sensible
//     partial layout, never throw. Layout is a view, not a validator.
//
// The tree is consumed by a separate measure/position pass (in the DOM layer)
// that assigns x/y/size to each box; this module only produces the structure.

// Node kinds:
//   row      : a horizontal sequence of children (the universal container)
//   atom     : a single run of plain text (ident/number/operator/paren/comma…)
//   frac     : { num: row, den: row }            from  A / B  (when both sides group)
//   sup      : { base: row, exp: row }           from  A ^ B
//   bigop    : { op, sub: row, sup: row, body: row }  from summation/product/integrate(...)
//   sqrt     : { radicand: row }                 from  sqrt(...)
//
// Every node also has `kind`, `s`, `e`. Container nodes' [s,e] span all their
// source (including the operator/paren characters that produced them) so that
// caret positions just outside a structure still resolve correctly.

import { tokenizeMath } from "./identClass.js";

// Re-tokenize but keep absolute source offsets on every token (the shared
// tokenizer drops positions). We need offsets for the [s,e] ranges.
function tokenizeWithPos(str){
  const toks = tokenizeMath(str);
  let pos = 0;
  return toks.map(tk => {
    const s = pos; pos += tk.v.length;
    return { ...tk, s, e: pos };
  });
}

// A small helper to make an atom node from a positioned token.
function atom(tk){ return { kind:"atom", t:tk.t, v:tk.v, s:tk.s, e:tk.e }; }

// Names that lay out as big operators, mapping to their glyph + arg meaning.
// summation(body, i, lo, hi) / product(body, i, lo, hi) → ∑/∏ with i=lo below, hi above
// integrate(body, var, lo, hi)                          → ∫ with lo below, hi above, "d{var}" after body
const BIGOPS = {
  summation: { glyph:"∑", kind:"sum" },
  product:   { glyph:"∏", kind:"prod" },
  integrate: { glyph:"∫", kind:"int" },
};

// ── Parser ───────────────────────────────────────────────────────────────────
// Recursive-descent over the positioned tokens, lenient by construction.
// Grammar (informal), tightest binding last:
//   row      := (frac)*
//   frac     := sup ( '/' sup )*          left-assoc; only "groups" visually
//   sup      := unit ( '^' unit )?        right side becomes the exponent
//   unit     := bigop | sqrt | call | group | atom
//   group    := '(' row ')'
// Whitespace tokens are kept as atoms so caret offsets stay exact, but they’re
// trivial to render as thin gaps.

class Parser {
  constructor(toks, text){ this.toks=toks; this.text=text; this.i=0; }
  peek(){ return this.toks[this.i]; }
  next(){ return this.toks[this.i++]; }
  atEnd(){ return this.i >= this.toks.length; }
  // Is the next non-space token an operator equal to `op`?
  nextOpIs(op){
    let j=this.i; while(this.toks[j] && this.toks[j].t==="ws") j++;
    return this.toks[j] && this.toks[j].t==="op" && this.toks[j].v===op ? j : -1;
  }

  // Parse a full row until end or an unmatched ')' / ',' at this nesting level.
  parseRow(stops){
    const start = this.peek() ? this.peek().s : 0;
    const children = [];
    while(!this.atEnd()){
      const tk = this.peek();
      if(tk.t==="op" && stops && stops.includes(tk.v)) break;
      children.push(this.parseFrac());
    }
    const end = children.length ? children[children.length-1].e : start;
    return { kind:"row", children, s:start, e:end };
  }

  // Fraction: a sup, then while the next op is '/', consume it and another sup,
  // pairing them into a frac node. Left-associative: a/b/c → (a/b)/c.
  parseFrac(){
    let left = this.parseSup();
    while(true){
      const j = this.nextOpIs("/");
      if(j<0) break;
      // consume any whitespace then the '/'
      while(this.peek() && this.peek().t==="ws") this.next();
      const slash = this.next(); // the '/'
      // skip whitespace before the denominator
      while(this.peek() && this.peek().t==="ws") this.next();
      const right = this.parseSup();
      left = {
        kind:"frac",
        num: wrapRow(left),
        den: wrapRow(right),
        slash: { s:slash.s, e:slash.e },
        s: left.s, e: right ? right.e : slash.e,
      };
    }
    return left;
  }

  // Superscript: a unit, optionally followed by '^' and another unit (the exp).
  parseSup(){
    let base = this.parseUnit();
    const j = this.nextOpIs("^");
    if(j>=0){
      while(this.peek() && this.peek().t==="ws") this.next();
      const caret = this.next(); // '^'
      while(this.peek() && this.peek().t==="ws") this.next();
      const exp = this.parseUnit();
      return {
        kind:"sup",
        base: wrapRow(base),
        exp: wrapRow(exp),
        caret: { s:caret.s, e:caret.e },
        s: base.s, e: exp ? exp.e : caret.e,
      };
    }
    return base;
  }

  // A unit is the tightest-binding thing: a bracketed group, a function call
  // (including big operators / sqrt with their special layout), or a single atom.
  parseUnit(){
    const tk = this.peek();
    if(!tk) return { kind:"row", children:[], s:this.text.length, e:this.text.length };

    // skip a leading whitespace token by emitting it as an atom unit (keeps
    // offsets exact; the layout renders it as a small gap)
    if(tk.t==="ws"){ this.next(); return atom(tk); }

    // identifier possibly followed by '(' → a call
    if(tk.t==="ident"){
      // look ahead past the ident for a '('
      const save=this.i;
      const id=this.next();
      // optional whitespace then '('
      let k=this.i; while(this.toks[k] && this.toks[k].t==="ws") k++;
      if(this.toks[k] && this.toks[k].t==="op" && this.toks[k].v==="("){
        // it's a call: id ( args )
        const callNode = this.parseCallFrom(id, k);
        if(callNode) return callNode;
      }
      this.i=save+1; // just the identifier as an atom
      return atom(id);
    }

    // a parenthesized group
    if(tk.t==="op" && tk.v==="("){
      return this.parseGroup();
    }

    // any other single token (number, operator, comma, etc.) is an atom
    this.next();
    return atom(tk);
  }

  // Parse a parenthesized group starting at the current '(' token.
  parseGroup(){
    const open = this.next(); // '('
    const inner = this.parseRow([")",]);
    let close=null;
    if(this.peek() && this.peek().t==="op" && this.peek().v===")") close=this.next();
    return {
      kind:"group",
      open:{ s:open.s, e:open.e },
      inner,
      close: close ? { s:close.s, e:close.e } : null,
      s: open.s,
      e: close ? close.e : inner.e,
    };
  }

  // Parse a call given the already-consumed identifier `id` and the index `k`
  // of its '(' token. Consumes through the matching ')'. Splits top-level
  // commas into argument rows. Recognizes big operators and sqrt for special
  // layout; everything else becomes a generic `call` node. Records the ranges
  // of all structural punctuation (open paren, arg-separating commas, close
  // paren) so the full source range stays tiled and every caret offset is
  // reachable even for the special-layout forms that visually hide that syntax.
  parseCallFrom(id, kOpenIdx){
    // advance the cursor to just after '('
    this.i = kOpenIdx + 1;
    const open = this.toks[kOpenIdx];
    const args = [];
    const commas = [];
    // parse comma-separated arg rows until ')'
    while(!this.atEnd()){
      const tk=this.peek();
      if(tk.t==="op" && tk.v===")") break;
      const argRow = this.parseRow([",",")"]);
      args.push(argRow);
      if(this.peek() && this.peek().t==="op" && this.peek().v===","){
        const c=this.next(); // consume comma
        commas.push({ s:c.s, e:c.e });
        // If the comma is immediately followed by ')' or end-of-input, the
        // trailing argument is empty — emit an explicit empty row for it so
        // every declared slot (e.g. all 4 of a sum's body/idx/lo/hi) exists and
        // is navigable, even when the user hasn't typed anything there yet.
        const nx=this.peek();
        if(!nx || (nx.t==="op" && nx.v===")")){
          args.push(emptyRow(c.e));
        }
        continue;
      }
      break;
    }
    let close=null;
    if(this.peek() && this.peek().t==="op" && this.peek().v===")") close=this.next();
    const e = close ? close.e : (args.length ? args[args.length-1].e : open.e);
    const punct = { open:{s:open.s,e:open.e}, commas, close: close?{s:close.s,e:close.e}:null };

    const bigop = BIGOPS[id.v];
    if(bigop && args.length>=1){
      // summation/product: (body, idx, lo, hi);  integrate: (body, var, lo, hi)
      const [body, a1, a2, a3] = args;
      return {
        kind:"bigop", op:bigop.kind, glyph:bigop.glyph, name:id.v,
        body: body || emptyRow(open.e),
        idx:  a1 || null,           // index var (sum/prod) or integration var
        lo:   a2 || null,
        hi:   a3 || null,
        nameRange:{ s:id.s, e:id.e },
        ...punct,
        s:id.s, e,
      };
    }
    if(id.v==="sqrt"){
      // sqrt always lays out as √ with a radicand slot — even when empty
      // (sqrt() right after auto-expand), so the cursor can sit inside an empty
      // radicand placeholder rather than the parser falling back to literal text.
      const radicand = args.length>=1 ? args[0] : emptyRow(open.e);
      return { kind:"sqrt", radicand, nameRange:{s:id.s,e:id.e}, ...punct, s:id.s, e };
    }
    // generic call: render as  name( arg, arg )  but keep structure so the
    // arguments still get internal typesetting (fractions inside calls, etc.)
    return { kind:"call", name:id.v, nameRange:{s:id.s,e:id.e}, args,
             ...punct, s:id.s, e };
  }
}

function emptyRow(at){ return { kind:"row", children:[], s:at, e:at }; }
// Ensure a node is wrapped in a row (so frac/sup parts are uniformly rows).
function wrapRow(node){
  if(!node) return emptyRow(0);
  if(node.kind==="row") return node;
  return { kind:"row", children:[node], s:node.s, e:node.e };
}

// Public: parse text → layout tree (always a row at the top).
function parseLayout(text){
  const toks = tokenizeWithPos(text||"");
  const p = new Parser(toks, text||"");
  const row = p.parseRow(null);
  // If lenient parsing left tokens unconsumed (shouldn't, but be safe), append
  // them as trailing atoms so no source text is ever dropped from the view.
  while(!p.atEnd()){
    row.children.push(atom(p.next()));
  }
  row.s = 0; row.e = (text||"").length;
  return row;
}

export { parseLayout, tokenizeWithPos, BIGOPS };
