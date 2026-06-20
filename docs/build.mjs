#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Dedekind docs — a tiny, dependency-free static site generator.
//
// Reads markdown from docs/content/*.md, renders each to a styled HTML page with
// a shared sidebar (ordered by the `order:` front-matter field), and writes the
// result to docs/dist/. No framework, no install step — just `node docs/build.mjs`.
//
// The markdown subset supported is exactly what these docs use: front matter,
// ATX headings, paragraphs, fenced code blocks, inline code, bold/italic, links,
// unordered/ordered lists, blockquotes, tables, and horizontal rules. Headings
// get slug ids so the sidebar and in-page anchors work.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(__dirname, "content");
// Output dir: defaults to docs/dist for a standalone docs build, but can be
// redirected (e.g. into the app's dist/docs) via `--out <dir>` or DOCS_OUT, so a
// single `npm run build` can fold the docs into the deployable site.
function resolveOut() {
  const argIdx = process.argv.indexOf("--out");
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    const p = process.argv[argIdx + 1];
    return p.startsWith("/") || /^[A-Za-z]:/.test(p) ? p : join(process.cwd(), p);
  }
  if (process.env.DOCS_OUT) {
    const p = process.env.DOCS_OUT;
    return p.startsWith("/") || /^[A-Za-z]:/.test(p) ? p : join(process.cwd(), p);
  }
  return join(__dirname, "dist");
}
const OUT = resolveOut();

// ── minimal markdown ─────────────────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slug = (s) =>
  s.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");

// inline: code, bold, italic, links (order matters; code is protected first)
function inline(text) {
  const codes = [];
  text = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  text = esc(text);
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => `<a href="${h}">${t}</a>`);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
  return text;
}

function parseFrontMatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

function render(md) {
  const lines = md.split("\n");
  let html = "";
  let i = 0;
  const headings = [];

  while (i < lines.length) {
    const line = lines[i];

    // raw HTML line: pass through verbatim. This lets the home page interleave
    // hero/card markup with normal markdown headings and prose. Any line whose
    // first non-space character begins an HTML tag is emitted as-is.
    if (/^\s*<\/?[a-zA-Z]/.test(line)) {
      html += line + "\n";
      i++;
      continue;
    }

    // fenced code
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      html += `<pre class="code"${lang ? ` data-lang="${lang}"` : ""}><code>${esc(buf.join("\n"))}</code></pre>\n`;
      continue;
    }

    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = slug(text);
      if (level <= 3) headings.push({ level, text, id });
      html += `<h${level} id="${id}"><a class="anchor" href="#${id}">#</a>${inline(text)}</h${level}>\n`;
      i++;
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      html += "<hr/>\n";
      i++;
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      html += `<blockquote>${inline(buf.join(" "))}</blockquote>\n`;
      continue;
    }

    // table (header row + separator row of dashes)
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      const cells = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") rows.push(cells(lines[i++]));
      html += "<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      for (const r of rows) html += "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
      html += "</tbody></table>\n";
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      html += "<ul>\n";
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        html += `<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>\n`;
        i++;
      }
      html += "</ul>\n";
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      html += "<ol>\n";
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        html += `<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>\n`;
        i++;
      }
      html += "</ol>\n";
      continue;
    }

    // blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // paragraph (gather until blank / block start)
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,4}\s|```|>\s?|\s*[-*]\s+|\s*\d+\.\s+|(-{3,}|\*{3,})\s*$)/.test(lines[i]) &&
      !(/\|/.test(lines[i]) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || ""))
    ) {
      buf.push(lines[i++]);
    }
    html += `<p>${inline(buf.join(" "))}</p>\n`;
  }

  return { html, headings };
}

// ── page shell ───────────────────────────────────────────────────────────────
function shell({ title, body, nav, toc, isHome }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} — Dedekind docs</title>
<link rel="stylesheet" href="style.css"/>
</head>
<body${isHome ? ' class="home"' : ""}>
<button id="menu" aria-label="Toggle navigation">≡</button>
<aside class="side">
  <a class="brand" href="index.html">
    <span class="brand-mark">∂</span>
    <span class="brand-name">Dedekind</span>
  </a>
  <nav>${nav}</nav>
</aside>
<main>
  <article>${body}</article>
  ${toc ? `<nav class="toc">${toc}</nav>` : ""}
</main>
<script>
  document.getElementById('menu').onclick = () => document.body.classList.toggle('nav-open');
  // highlight the in-view heading in the right-hand TOC
  const links = [...document.querySelectorAll('.toc a')];
  if (links.length) {
    const map = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
    const obs = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) {
        links.forEach(a => a.classList.remove('active'));
        map.get(e.target.id)?.classList.add('active');
      }
    }, { rootMargin: '0px 0px -75% 0px' });
    document.querySelectorAll('h2[id],h3[id]').forEach(h => obs.observe(h));
  }
</script>
</body>
</html>`;
}

// ── build ────────────────────────────────────────────────────────────────────
function build() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const files = readdirSync(CONTENT).filter((f) => f.endsWith(".md"));
  const pages = files.map((f) => {
    const src = readFileSync(join(CONTENT, f), "utf8");
    const { meta, body } = parseFrontMatter(src);
    const { html, headings } = render(body);
    const out = f === "index.md" ? "index.html" : f.replace(/\.md$/, ".html");
    return {
      file: out,
      title: meta.title || f.replace(/\.md$/, ""),
      order: meta.order ? Number(meta.order) : 999,
      group: meta.group || "",
      html,
      headings,
    };
  });

  pages.sort((a, b) => a.order - b.order);

  // sidebar grouped by `group`
  let nav = "";
  let lastGroup = null;
  for (const p of pages) {
    if (p.group !== lastGroup) {
      if (lastGroup !== null) nav += "</ul>";
      nav += `<div class="nav-group">${p.group || ""}</div><ul>`;
      lastGroup = p.group;
    }
    nav += `<li><a href="${p.file}" data-file="${p.file}">${esc(p.title)}</a></li>`;
  }
  nav += "</ul>";

  for (const p of pages) {
    const navHere = nav.replace(
      `data-file="${p.file}">`,
      `data-file="${p.file}" class="current">`
    );
    const toc =
      p.headings.filter((h) => h.level >= 2).length > 1
        ? "<div class=\"toc-title\">On this page</div>" +
          p.headings
            .filter((h) => h.level >= 2)
            .map((h) => `<a href="#${h.id}" class="lvl${h.level}">${esc(h.text)}</a>`)
            .join("")
        : "";
    const out = shell({
      title: p.title,
      body: p.html,
      nav: navHere,
      toc,
      isHome: p.file === "index.html",
    });
    writeFileSync(join(OUT, p.file), out);
  }

  // copy stylesheet
  writeFileSync(join(OUT, "style.css"), STYLE);

  console.log(`Built ${pages.length} pages → ${OUT}`);
}

// ── stylesheet (inlined so the generator stays a single file) ────────────────
const STYLE = readFileSync(join(__dirname, "style.css"), "utf8");

build();
