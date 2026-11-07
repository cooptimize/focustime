// DOC-1: the technical docs (docs/technical/*.md) rendered at build time for the in-app panel (ui/docs/). One Vite
// plugin turns every page into sanitized HTML with its headings, a search index and its diagrams already drawn, as the
// virtual module `virtual:tech-docs`, which only the lazily loaded panel imports (no weight on the app's first load).
//
// Sanitizing happens here, once, on content from the repo: raw HTML in the Markdown is shown as text, links are kept
// only for http(s), mailto, in-page anchors and repo paths, images become links, and the result is checked against a
// short list of allowed tags and attributes (anything else fails the build). Diagrams are Mermaid blocks drawn ahead of
// time by `npm run docs:diagrams` (scripts/docs-diagrams.ts) into docs/technical/diagrams/<key>.svg, checked by
// `checkSvg` before they go in. Links between technical pages open in the panel; other repo files open on GitHub.
//
// The pages are bundled into the client, and built files are served without a session (like the rest of the UI), so
// nothing on these pages may be sensitive: docs/technical/README.md says so, and scripts/tech-docs.test.ts checks.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { Marked, type Tokens } from "marked";
import type { Heading, RenderedPage, SearchEntry } from "../ui/docs/types.ts";
export type { Heading, RenderedPage, SearchEntry };

export const REPO_URL = "https://github.com/cooptimize/focustime";
export const DOCS_DIR = "docs/technical";
export const VIRTUAL_ID = "virtual:tech-docs";

/** The pages in rail order (ui/docs/pages.ts repeats ids and labels for the command menu, without the words). */
export const TECH_PAGES = [
  { id: "overview", file: "README.md", label: "Overview" },
  { id: "architecture", file: "architecture.md", label: "Architecture" },
  { id: "data", file: "data.md", label: "Data" },
  { id: "integrations", file: "integrations.md", label: "Integrations" },
  { id: "security", file: "security.md", label: "Security" },
  { id: "operations", file: "operations.md", label: "Operations" },
  { id: "development", file: "development.md", label: "Development" },
] as const;

export type TechDocs = { pages: RenderedPage[] };
/** The CSS the drawn diagrams need, served as a stylesheet (the app's CSP allows no inline styles). */
export const VIRTUAL_CSS_ID = "virtual:tech-docs.css";

/** "Checked against <short SHA> on <date>": every page has one (scripts/tech-docs.test.ts). */
export const CHECKED_RE = /Checked against `?([0-9a-f]{7,40})`? on ([A-Z][a-z]{2,8} \d{1,2}, \d{4})/;

/** A GitHub-style heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Unique anchors in page order (a repeated heading gets -1, -2 like GitHub). */
export function anchorsOf(texts: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((t) => {
    const s = slug(t);
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    return n ? `${s}-${n}` : s;
  });
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** Plain text from inline Markdown (for headings and search). */
const plain = (md: string) =>
  md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The key a Mermaid block's drawing is stored under: the first 16 hex of its source's SHA-256. */
export const diagramKey = (src: string) => createHash("sha256").update(src.trim().replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);

/** Where a link goes: in the panel, out to GitHub or the web, or nowhere (dropped to text). */
export type LinkTarget = { kind: "doc"; page: string; anchor: string | null } | { kind: "repo"; path: string; anchor: string | null } | { kind: "web"; href: string } | { kind: "drop" };

/** A link's target from the page it is on (`fromFile`, a file in docs/technical/). */
export function linkTarget(href: string, fromFile: string, pageId: string): LinkTarget {
  const h = href.trim();
  if (h.startsWith("#")) return h.length > 1 ? { kind: "doc", page: pageId, anchor: h.slice(1) } : { kind: "drop" };
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return { kind: "web", href: h };
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith("//")) return { kind: "drop" };
  const [rawPath = "", anchor = null] = h.split("#") as [string, string?];
  const repoPath = h.startsWith("/") ? posix.normalize(rawPath.slice(1)) : posix.normalize(posix.join(posix.dirname(`${DOCS_DIR}/${fromFile}`), rawPath));
  if (repoPath.startsWith("..") || repoPath === "." || repoPath === "") return { kind: "drop" };
  const page = TECH_PAGES.find((p) => `${DOCS_DIR}/${p.file}` === repoPath);
  if (page) return { kind: "doc", page: page.id, anchor: anchor || null };
  return { kind: "repo", path: repoPath, anchor: anchor || null };
}

const docHref = (page: string, anchor: string | null) => `#/docs/${page}${anchor ? `/${anchor}` : ""}`;

/** The tags and attributes the rendered pages may hold (outside the drawn diagrams). */
const TAGS = new Set(["h2", "h3", "h4", "h5", "h6", "p", "a", "ul", "ol", "li", "strong", "em", "code", "pre", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "hr", "br", "del", "div", "figure", "span", "input"]);
const ATTRS = new Set(["href", "id", "class", "data-anchor", "data-doc", "target", "rel", "aria-label", "align", "type", "checked", "disabled", "start", "role", "tabindex", "title"]);

export class DocsError extends Error {}

/** Fails on any tag or attribute outside the lists, an event handler, or a script URL. */
export function checkHtml(html: string, where: string): void {
  const outsideSvg = html.replace(/<svg[\s\S]*?<\/svg>/g, "");
  for (const m of outsideSvg.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g)) {
    const tag = m[1]!.toLowerCase();
    if (!TAGS.has(tag)) throw new DocsError(`${where}: <${tag}> isn't allowed in a technical page`);
    for (const a of (m[2] ?? "").matchAll(/([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=/g)) {
      const name = a[1]!.toLowerCase();
      if (!ATTRS.has(name)) throw new DocsError(`${where}: the attribute ${name} isn't allowed`);
    }
  }
  if (/javascript:/i.test(outsideSvg)) throw new DocsError(`${where}: a script URL`);
}

/** A drawn diagram may hold no script, event handler, foreign HTML or outside reference. */
export function checkSvg(svg: string, where: string): void {
  if (!/^<svg[\s>]/.test(svg.trim())) throw new DocsError(`${where}: not an SVG`);
  if (/<script|<foreignObject|<iframe|<object|<embed/i.test(svg)) throw new DocsError(`${where}: the SVG holds a script or foreign content`);
  if (/\son[a-z]+\s*=/i.test(svg)) throw new DocsError(`${where}: the SVG holds an event handler`);
  if (/javascript:|(?:xlink:)?href\s*=\s*["'](?!#)/i.test(svg)) throw new DocsError(`${where}: the SVG links outside itself`);
  if (/url\(\s*["']?(?!#)/i.test(svg) || /@import/i.test(svg)) throw new DocsError(`${where}: the SVG loads something from outside`);
}

/**
 * A drawn diagram made fit for the app's CSP (style-src 'self', no inline styles): its <style> blocks move to `css`
 * and each style attribute becomes a class with the same declarations (the same text, the same class).
 */
export function unstyleSvg(svg: string): { svg: string; css: string } {
  // The SVG is XML, so its CSS text is escaped (">" as "&gt;"); a stylesheet needs it plain.
  const unescape = (t: string) => t.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const css: string[] = [];
  const classes = new Map<string, string>();
  let out = svg.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (_, body: string) => (css.push(unescape(body)), ""));
  out = out.replace(/<([a-zA-Z][\w:-]*)(\s[^>]*?)?(\/?)>/g, (whole, tag: string, attrs: string | undefined, self: string) => {
    if (!attrs || !/\sstyle\s*=/.test(attrs)) return whole;
    let decl = "";
    let rest = attrs.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/, (_m, _q, d: string | undefined, d2: string | undefined) => ((decl = unescape(d ?? d2 ?? "").trim()), ""));
    if (!decl) return `<${tag}${rest}${self}>`;
    let cls = classes.get(decl);
    if (!cls) {
      cls = `tds-${createHash("sha256").update(decl).digest("hex").slice(0, 10)}`;
      classes.set(decl, cls);
      css.push(`.${cls}{${decl.replace(/[{}<>]/g, "")}}`);
    }
    rest = /\sclass\s*=\s*"/.test(rest) ? rest.replace(/\sclass\s*=\s*"([^"]*)"/, (_m, c: string) => ` class="${c} ${cls}"`) : `${rest} class="${cls}"`;
    return `<${tag}${rest}${self}>`;
  });
  return { svg: out, css: css.join("\n") };
}

/** The Mermaid blocks of a Markdown page, in order. */
export function mermaidBlocks(md: string): string[] {
  const out: string[] = [];
  new Marked().walkTokens(new Marked().lexer(md), (t) => {
    if (t.type === "code" && (t as Tokens.Code).lang?.trim() === "mermaid") out.push((t as Tokens.Code).text);
  });
  return out;
}

export type RenderContext = {
  file: string;
  pageId: string;
  /** A drawn diagram by its key (diagramKey), or null when it hasn't been drawn. */
  diagram: (key: string) => string | null;
};

/** One page: its title (the first H1), sanitized HTML without the H1, headings, search entries and Checked line. */
export function renderPage(md: string, ctx: RenderContext): Omit<RenderedPage, "id" | "file"> {
  const lexed = new Marked().lexer(md);
  const headingTokens: Tokens.Heading[] = [];
  new Marked().walkTokens(lexed, (t) => void (t.type === "heading" && (t as Tokens.Heading).depth > 1 && headingTokens.push(t as Tokens.Heading)));
  const anchors = anchorsOf(headingTokens.map((h) => plain(h.text)));
  const headings: Heading[] = headingTokens.map((h, i) => ({ anchor: anchors[i]!, text: plain(h.text), level: h.depth }));
  let title = "";
  let hi = 0;
  const m = new Marked({ gfm: true, breaks: false });
  m.use({
    renderer: {
      // Raw HTML in the Markdown is shown as text, never run.
      html: (t: Tokens.HTML | Tokens.Tag) => escapeHtml(t.text),
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, t: Tokens.Heading) {
        const inner = this.parser.parseInline(t.tokens);
        if (t.depth === 1) {
          title ||= plain(t.text);
          return "";
        }
        const h = headings[hi++]!;
        return `<h${t.depth} id="td-${h.anchor}" data-anchor="${h.anchor}">${inner}<a class="td-anchor" href="${docHref(ctx.pageId, h.anchor)}" aria-label="Link to this heading">#</a></h${t.depth}>\n`;
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, t: Tokens.Link) {
        const inner = this.parser.parseInline(t.tokens);
        const to = linkTarget(t.href, ctx.file, ctx.pageId);
        if (to.kind === "drop") return inner;
        if (to.kind === "doc") return `<a href="${escapeHtml(docHref(to.page, to.anchor))}" data-doc="${to.page}">${inner}</a>`;
        const href = to.kind === "web" ? to.href : `${REPO_URL}/blob/main/${to.path}${to.anchor ? `#${to.anchor}` : ""}`;
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${inner}</a>`;
      },
      image: (t: Tokens.Image) => escapeHtml(t.text || t.href),
      code: (t: Tokens.Code) => {
        if (t.lang?.trim() === "mermaid") {
          const key = diagramKey(t.text);
          const svg = ctx.diagram(key);
          if (!svg) throw new DocsError(`${ctx.file}: a diagram isn't drawn yet (key ${key}): run npm run docs:diagrams`);
          checkSvg(svg, `${ctx.file} diagram ${key}`);
          return `<figure class="td-diagram" role="img" aria-label="Diagram">${svg.trim()}</figure>\n`;
        }
        return `<pre class="td-code"><code>${escapeHtml(t.text)}</code></pre>\n`;
      },
      table(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, t: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: "th" | "td") => `<${tag}${c.align ? ` align="${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const head = `<tr>${t.header.map((c) => cell(c, "th")).join("")}</tr>`;
        const body = t.rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("");
        return `<div class="td-scroll" role="region" aria-label="Table" tabindex="0"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>\n`;
      },
    },
  });
  const html = m.parser(lexed);
  checkHtml(html, ctx.file);
  return { title, html, headings, search: searchOf(md, title, headings), checked: CHECKED_RE.exec(md)?.[0] ?? null };
}

/** One search entry per section: the heading and the plain text under it (code and diagrams left out). */
function searchOf(md: string, title: string, headings: readonly Heading[]): SearchEntry[] {
  const lines = md.replace(/```[\s\S]*?```/g, "").split("\n");
  const out: SearchEntry[] = [{ anchor: null, title, text: "" }];
  let hi = 0;
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (h[1]!.length > 1) out.push({ anchor: headings[hi++]?.anchor ?? null, title: plain(h[2]!), text: "" });
      continue;
    }
    const e = out[out.length - 1]!;
    e.text = `${e.text} ${plain(line.replace(/^\s*[-*|>]\s*/, "").replace(/\|/g, " "))}`.trim().slice(0, 4000);
  }
  return out;
}

/** Every page from a repo checkout (`root`), with diagrams from docs/technical/diagrams/. */
export function renderAll(root: string): TechDocs & { css: string } {
  const dir = join(root, DOCS_DIR, "diagrams");
  const svgs = new Map<string, string>();
  const css: string[] = [];
  if (existsSync(dir))
    for (const f of readdirSync(dir).sort())
      if (f.endsWith(".svg")) {
        const raw = readFileSync(join(dir, f), "utf8");
        checkSvg(raw, `diagrams/${f}`);
        const u = unstyleSvg(raw);
        svgs.set(f.slice(0, -4), u.svg);
        css.push(u.css);
      }
  return {
    pages: TECH_PAGES.map((p) => {
      const md = readFileSync(join(root, DOCS_DIR, p.file), "utf8");
      return { id: p.id, file: p.file, ...renderPage(md, { file: p.file, pageId: p.id, diagram: (k) => svgs.get(k) ?? null }) };
    }),
    css: css.join("\n"),
  };
}

/** The Vite plugin: `import docs from "virtual:tech-docs"` (a JSON module), rebuilt when a page or diagram changes. */
export function techDocsPlugin(root: string = resolve(import.meta.dirname, "..")) {
  const js = `\0${VIRTUAL_ID}`;
  // A path Vite's CSS handling recognizes (it ends in .css), so the diagrams' styles become a stylesheet file.
  const css = "/@focustime-tech-docs/diagrams.css";
  return {
    name: "focustime-tech-docs",
    resolveId: (id: string) => (id === VIRTUAL_ID ? js : id === VIRTUAL_CSS_ID ? css : null),
    load(this: { addWatchFile?: (f: string) => void }, id: string) {
      if (id !== js && id !== css) return null;
      for (const p of TECH_PAGES) this.addWatchFile?.(join(root, DOCS_DIR, p.file));
      const all = renderAll(root);
      if (id === css) return all.css;
      return `export default ${JSON.stringify({ pages: all.pages })};`;
    },
  };
}
