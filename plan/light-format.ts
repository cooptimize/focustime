// ED-1: light formatting, pure. A description or acceptance criteria is edited on the story card as plain text with a
// few marks (a blank line between paragraphs, "- " bullets, "1. " numbers two levels deep, **bold**, *italic*,
// [words](address) links, "# " to "### " headings), and written back in the format DevOps already stores it in: an
// HTML field becomes clean HTML, a Markdown field stays the Markdown as typed (FocusTime never converts a field).
//
// An HTML field is edited here only when turning it into the text and back gives the same content (the canonical
// blocks below), apart from fonts, sizes and colors, which are flagged ("Fonts and colors from the old text will be
// removed."). Tables, images, embedded content, mentions and anything else that would not survive make it not
// editable here, with the reason. Every character typed is escaped on the way to HTML: nothing typed runs as page
// content, and a link is only http, https or mailto. No DOM, so the server and the browser give the same result.
import { attr, decodeEntities } from "./sanitize.ts";

export type FieldFormat = "html" | "markdown";
export type NotEditable = "table" | "image" | "embed" | "mention" | "other";

/** One run of inline text with its marks. Nesting order doesn't matter, so content is compared as runs. */
type Run = { s: string; b: boolean; i: boolean; href: string | null };
type Inline = { t: "text"; s: string } | { t: "b"; c: Inline[] } | { t: "i"; c: Inline[] } | { t: "a"; href: string; c: Inline[] };
type Block = { t: "line"; c: Inline[] } | { t: "h"; level: 1 | 2 | 3; c: Inline[] } | { t: "li"; ordered: boolean; depth: 1 | 2; c: Inline[] } | { t: "blank" };

/** The most a description or acceptance text may be when typed here. */
export const LIGHT_MAX = 32_000;
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s<>"]+$/i;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- Light text → blocks ----

const BULLET = /^( *)- +(.*)$/;
const NUMBER = /^( *)(\d{1,9})\. +(.*)$/;
const HEADING = /^(#{1,3}) +(.*)$/;

function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  let lastDepth: 0 | 1 = 0;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      out.push({ t: "blank" });
      lastDepth = 0;
      continue;
    }
    const h = HEADING.exec(line);
    const b = BULLET.exec(line);
    const n = b ? null : NUMBER.exec(line);
    if (h) {
      out.push({ t: "h", level: h[1]!.length as 1 | 2 | 3, c: parseInline(h[2]!) });
      lastDepth = 0;
    } else if (b || n) {
      const indent = (b ? b[1] : n![1])!.length;
      // Two levels at most; an indented item needs an item above it.
      const depth: 1 | 2 = indent >= 2 && lastDepth >= 1 ? 2 : 1;
      out.push({ t: "li", ordered: !!n, depth, c: parseInline(b ? b[2]! : n![3]!) });
      lastDepth = 1;
    } else {
      out.push({ t: "line", c: parseInline(line.trim()) });
      lastDepth = 0;
    }
  }
  while (out.length && out[out.length - 1]!.t === "blank") out.pop();
  while (out.length && out[0]!.t === "blank") out.shift();
  return out;
}

const PUNCT = /[!-/:-@[-`{-~]/;

/** **bold**, *italic*, [words](address) and backslash escapes; anything unmatched stays as typed. */
function parseInline(s: string): Inline[] {
  type Frame = { mark: "**" | "*" | null; c: Inline[] };
  const stack: Frame[] = [{ mark: null, c: [] }];
  const top = () => stack[stack.length - 1]!;
  const text = (t: string) => {
    const c = top().c;
    const last = c[c.length - 1];
    if (last?.t === "text") last.s += t;
    else c.push({ t: "text", s: t });
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\\" && i + 1 < s.length && PUNCT.test(s[i + 1]!)) {
      text(s[i + 1]!);
      i += 2;
      continue;
    }
    if (ch === "[") {
      const link = linkAt(s, i);
      if (link) {
        top().c.push({ t: "a", href: link.href, c: parseInline(link.words) });
        i = link.end;
        continue;
      }
      text("[");
      i++;
      continue;
    }
    if (ch === "*") {
      let run = 0;
      while (s[i + run] === "*") run++;
      i += run;
      while (run > 0) {
        const f = top();
        if (f.mark === "**" && run >= 2) {
          stack.pop();
          top().c.push({ t: "b", c: f.c });
          run -= 2;
        } else if (f.mark === "*") {
          stack.pop();
          top().c.push({ t: "i", c: f.c });
          run -= 1;
        } else if (run >= 2) {
          stack.push({ mark: "**", c: [] });
          run -= 2;
        } else {
          stack.push({ mark: "*", c: [] });
          run -= 1;
        }
      }
      continue;
    }
    text(ch);
    i++;
  }
  // Marks never closed are text after all.
  while (stack.length > 1) {
    const f = stack.pop()!;
    text(f.mark!);
    for (const x of f.c) {
      if (x.t === "text") text(x.s);
      else top().c.push(x);
    }
  }
  return top().c.filter((x) => !(x.t !== "text" && !x.c.length));
}

/** [words](address) at i, with an http, https or mailto address; null when it isn't a link. */
function linkAt(s: string, i: number): { words: string; href: string; end: number } | null {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "[") depth++;
    else if (s[j] === "]" && --depth === 0) {
      if (s[j + 1] !== "(") return null;
      const close = s.indexOf(")", j + 2);
      if (close < 0) return null;
      const href = s.slice(j + 2, close).trim();
      const words = s.slice(i + 1, j);
      if (!SAFE_HREF.test(href) || !words.trim()) return null;
      return { words, href, end: close + 1 };
    }
  }
  return null;
}

// ---- Blocks → HTML (clean, escaped) ----

function inlineHtml(c: readonly Inline[]): string {
  return c.map((x) => (x.t === "text" ? esc(x.s) : x.t === "b" ? `<strong>${inlineHtml(x.c)}</strong>` : x.t === "i" ? `<em>${inlineHtml(x.c)}</em>` : `<a href="${esc(x.href)}">${inlineHtml(x.c)}</a>`)).join("");
}

function blocksHtml(blocks: readonly Block[]): string {
  const out: string[] = [];
  let k = 0;
  while (k < blocks.length) {
    const b = blocks[k]!;
    if (b.t === "li") {
      // One list run: depth-1 items, each with the depth-2 items under it.
      const tag = (o: boolean) => (o ? "ol" : "ul");
      let open: boolean | null = null;
      let html = "";
      while (k < blocks.length && blocks[k]!.t === "li") {
        const item = blocks[k] as Extract<Block, { t: "li" }>;
        if (open !== item.ordered) {
          if (open !== null) html += `</${tag(open)}>`;
          html += `<${tag(item.ordered)}>`;
          open = item.ordered;
        }
        k++;
        let sub = "";
        let subOpen: boolean | null = null;
        while (k < blocks.length && blocks[k]!.t === "li" && (blocks[k] as Extract<Block, { t: "li" }>).depth === 2) {
          const s2 = blocks[k] as Extract<Block, { t: "li" }>;
          if (subOpen !== s2.ordered) {
            if (subOpen !== null) sub += `</${tag(subOpen)}>`;
            sub += `<${tag(s2.ordered)}>`;
            subOpen = s2.ordered;
          }
          sub += `<li>${inlineHtml(s2.c)}</li>`;
          k++;
        }
        if (subOpen !== null) sub += `</${tag(subOpen)}>`;
        html += `<li>${inlineHtml(item.c)}${sub}</li>`;
      }
      if (open !== null) html += `</${tag(open)}>`;
      out.push(html);
      continue;
    }
    if (b.t === "blank") out.push("<div><br></div>");
    else if (b.t === "h") out.push(`<h${b.level}>${inlineHtml(b.c)}</h${b.level}>`);
    else out.push(`<div>${inlineHtml(b.c) || "<br>"}</div>`);
    k++;
  }
  return out.join("");
}

/** The light text as clean HTML, the way an HTML field is written (and the live look shows it). */
export const lightToHtml = (text: string): string => blocksHtml(parseBlocks(text));

// ---- HTML → blocks (or why it can't be kept) ----

type Node = { tag: string; attrs: string; kids: Node[] } | { text: string };
const VOID = new Set(["br", "img", "hr", "input", "wbr", "col", "source", "embed", "area", "meta", "link"]);
const TABLE = new Set(["table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col"]);
const IMAGE = new Set(["img", "picture", "figure", "svg"]);
const EMBED = new Set(["iframe", "embed", "object", "video", "audio", "canvas", "source", "math"]);
const RANK: NotEditable[] = ["table", "image", "embed", "mention", "other"];

/** A small tag tree; unbalanced closes are ignored and anything left open closes at the end. */
function tree(html: string): Node[] {
  const root: { tag: string; attrs: string; kids: Node[] } = { tag: "#root", attrs: "", kids: [] };
  const open: (typeof root)[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)|(<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, slash, name, attrs = "", text, lt] = m;
    const cur = open[open.length - 1]!;
    if (text !== undefined || lt !== undefined) {
      cur.kids.push({ text: decodeEntities(text ?? "<") });
      continue;
    }
    if (!name) continue; // a comment, CDATA or doctype: nothing a reader sees
    const tag = name.toLowerCase();
    if (slash) {
      const at = open.map((x) => x.tag).lastIndexOf(tag);
      if (at > 0) open.length = at;
      continue;
    }
    const node = { tag, attrs, kids: [] as Node[] };
    cur.kids.push(node);
    if (!VOID.has(tag) && !/\/\s*$/.test(attrs)) open.push(node);
  }
  return root.kids;
}

/** Style properties that are only fonts, sizes, colors and spacing: dropped, and the person is told. */
const DROPPABLE_STYLE = /^(font(-family|-size)?|color|background(-color)?|line-height|margin(-\w+)?|padding(-\w+)?|letter-spacing)$/i;

type Walk = { blocks: Block[]; lossy: boolean; refuse: NotEditable | null };

function htmlBlocks(html: string): Walk {
  const w: Walk = { blocks: [], lossy: false, refuse: null };
  const no = (why: NotEditable) => {
    if (w.refuse === null || RANK.indexOf(why) < RANK.indexOf(w.refuse)) w.refuse = why;
  };
  /** Style and font attributes: fonts and colors are dropped (lossy); anything else that shows can't be kept. */
  const attrsOk = (tag: string, attrs: string) => {
    const style = attr(attrs, "style");
    if (style)
      for (const decl of style.split(";")) {
        const prop = decl.split(":")[0]?.trim() ?? "";
        if (!prop) continue;
        if (DROPPABLE_STYLE.test(prop)) w.lossy = true;
        else no("other");
      }
    if (tag === "font" && (attr(attrs, "face") !== null || attr(attrs, "size") !== null || attr(attrs, "color") !== null)) w.lossy = true;
    if (attr(attrs, "data-vss-mention") !== null) no("mention");
    if (tag === "ol" && attr(attrs, "start") !== null && attr(attrs, "start") !== "1") no("other");
  };
  let cur: Inline[] | null = null;
  const flush = () => {
    if (cur && cur.some((x) => x.t !== "text" || x.s.trim())) w.blocks.push({ t: "line", c: cur });
    cur = null;
  };
  const inline = (nodes: readonly Node[], into: Inline[]): void => {
    for (const n of nodes) {
      if ("text" in n) {
        into.push({ t: "text", s: n.text });
        continue;
      }
      attrsOk(n.tag, n.attrs);
      if (TABLE.has(n.tag)) no("table");
      else if (IMAGE.has(n.tag)) no("image");
      else if (EMBED.has(n.tag)) no("embed");
      else if (n.tag === "strong" || n.tag === "b") into.push({ t: "b", c: kids(n.kids) });
      else if (n.tag === "em" || n.tag === "i") into.push({ t: "i", c: kids(n.kids) });
      else if (n.tag === "a") {
        const href = attr(n.attrs, "href")?.trim() ?? "";
        if (attr(n.attrs, "data-vss-mention") !== null || /^#|mention/i.test(href)) no("mention");
        else if (!SAFE_HREF.test(href)) no("other");
        else into.push({ t: "a", href, c: kids(n.kids) });
      } else if (n.tag === "span" || n.tag === "font") inline(n.kids, into);
      else if (n.tag === "br") into.push({ t: "text", s: "\n" });
      else no("other");
    }
  };
  const kids = (nodes: readonly Node[]) => {
    const c: Inline[] = [];
    inline(nodes, c);
    return c;
  };
  const listItems = (n: { tag: string; attrs: string; kids: Node[] }, depth: number) => {
    if (depth > 2) return no("other");
    const ordered = n.tag === "ol";
    for (const k of n.kids) {
      if ("text" in k) {
        if (k.text.trim()) no("other");
        continue;
      }
      attrsOk(k.tag, k.attrs);
      if (k.tag === "ul" || k.tag === "ol") {
        attrsOk(k.tag, k.attrs);
        listItems(k, depth + 1);
        continue;
      }
      if (k.tag !== "li") {
        no("other");
        continue;
      }
      // An item is one line of inline text (one wrapping div or p is fine), then at most one more list level.
      const c: Inline[] = [];
      const sub: (typeof k)[] = [];
      // A wrapper is fine only as the item's whole line: text beside it (or a second one) would merge two lines.
      let wrapped = false;
      const filled = () => c.some((y) => y.t !== "text" || y.s.trim());
      for (const x of k.kids) {
        if (!("text" in x) && (x.tag === "ul" || x.tag === "ol")) sub.push(x);
        else if (!("text" in x) && (x.tag === "div" || x.tag === "p")) {
          attrsOk(x.tag, x.attrs);
          if (wrapped || filled()) no("other");
          wrapped = true;
          inline(x.kids, c);
        } else if (sub.length && ("text" in x ? x.text.trim() : true)) no("other");
        else if (wrapped && ("text" in x ? x.text.trim() : true)) no("other");
        else inline([x], c);
      }
      if (c.some((x) => x.t === "text" && x.s.includes("\n") && x.s.trim())) {
        // A line break inside an item can't be written as one light line.
        const joined = runs(c).map((r) => r.s).join("");
        if (joined.trim().includes("\n")) no("other");
      }
      w.blocks.push({ t: "li", ordered, depth: depth as 1 | 2, c });
      for (const s of sub) {
        attrsOk(s.tag, s.attrs);
        listItems(s, depth + 1);
      }
    }
  };
  const block = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if ("text" in n) {
        if (!cur && !n.text.trim()) continue;
        (cur ??= []).push({ t: "text", s: n.text });
        continue;
      }
      if (n.tag === "div" || n.tag === "p" || n.tag === "section" || n.tag === "article") {
        attrsOk(n.tag, n.attrs);
        flush();
        block(n.kids);
        flush();
        if (n.tag === "p") w.blocks.push({ t: "blank" });
      } else if (/^h[1-3]$/.test(n.tag)) {
        attrsOk(n.tag, n.attrs);
        flush();
        w.blocks.push({ t: "h", level: Number(n.tag[1]) as 1 | 2 | 3, c: kids(n.kids) });
      } else if (/^h[4-6]$/.test(n.tag)) no("other");
      else if (n.tag === "ul" || n.tag === "ol") {
        attrsOk(n.tag, n.attrs);
        flush();
        listItems(n, 1);
      } else if (n.tag === "br") {
        if (cur && cur.some((x) => x.t !== "text" || x.s.trim())) flush();
        else {
          cur = null;
          w.blocks.push({ t: "blank" });
        }
      } else if (n.tag === "li") no("other");
      else {
        // Inline content at block level joins the current line.
        const into: Inline[] = (cur ??= []);
        inline([n], into);
      }
    }
  };
  block(tree(html));
  flush();
  // A line break inside a line splits it (DevOps writes <div>a<br>b</div> for two lines).
  w.blocks = w.blocks.flatMap((b) => (b.t === "line" ? splitLine(b.c) : [b]));
  return w;
}

/** A line with "\n" in its text becomes several lines (marks spanning a break can't be kept: refused by the compare). */
function splitLine(c: Inline[]): Block[] {
  if (!c.some((x) => x.t === "text" && x.s.includes("\n"))) return [{ t: "line", c }];
  const out: Block[] = [];
  let line: Inline[] = [];
  for (const x of c) {
    if (x.t !== "text" || !x.s.includes("\n")) {
      line.push(x);
      continue;
    }
    const parts = x.s.split("\n");
    parts.forEach((p, k) => {
      if (k > 0) {
        out.push(line.some((y) => y.t !== "text" || y.s.trim()) ? { t: "line", c: line } : { t: "blank" });
        line = [];
      }
      if (p) line.push({ t: "text", s: p });
    });
  }
  if (line.some((y) => y.t !== "text" || y.s.trim())) out.push({ t: "line", c: line });
  return out;
}

// ---- Blocks → light text ----

function inlineText(c: readonly Inline[], lineStart: boolean): string {
  let out = "";
  for (const x of c) {
    if (x.t === "text") out += x.s.replace(/\s+/g, " ").replace(/[\\*[\]]/g, (m) => `\\${m}`);
    else if (x.t === "b") out += `**${inlineText(x.c, false)}**`;
    else if (x.t === "i") out += `*${inlineText(x.c, false)}*`;
    else out += `[${inlineText(x.c, false)}](${x.href})`;
  }
  out = out.trim();
  // Text that only looks like a mark at the start of a line keeps its meaning.
  if (lineStart) out = out.replace(/^(#{1,6} )/, "\\$1").replace(/^- /, "\\- ").replace(/^(\d{1,9})\. /, "$1\\. ");
  return out;
}

function blocksText(blocks: readonly Block[]): string {
  const lines: string[] = [];
  let num = [0, 0];
  let kind: (boolean | null)[] = [null, null];
  for (const b of blocks) {
    if (b.t === "blank") {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      num = [0, 0];
      kind = [null, null];
      continue;
    }
    if (b.t === "li") {
      const d = b.depth - 1;
      if (d === 0) num[1] = 0;
      // A new list kind at this depth starts its own numbering.
      if (kind[d] !== b.ordered) num[d] = 0;
      kind[d] = b.ordered;
      num[d] = (num[d] ?? 0) + 1;
      lines.push(`${d ? "  " : ""}${b.ordered ? `${num[d]}. ` : "- "}${inlineText(b.c, false)}`);
      continue;
    }
    num = [0, 0];
    kind = [null, null];
    if (b.t === "h") lines.push(`${"#".repeat(b.level)} ${inlineText(b.c, false)}`);
    else lines.push(inlineText(b.c, true));
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

// ---- The canonical form: what a reader sees, compared ----

function runs(c: readonly Inline[], b = false, i = false, href: string | null = null): Run[] {
  return c.flatMap((x) => (x.t === "text" ? [{ s: x.s, b, i, href }] : x.t === "b" ? runs(x.c, true, i, href) : x.t === "i" ? runs(x.c, b, true, href) : runs(x.c, b, i, x.href)));
}
function canonRuns(c: readonly Inline[]): Run[] {
  const out: Run[] = [];
  for (const r0 of runs(c)) {
    const s = r0.s.replace(/\s+/g, " ");
    if (!s) continue;
    // Marks on spaces alone don't show.
    const r = /^ +$/.test(s) && !r0.href ? { s, b: false, i: false, href: null } : { ...r0, s };
    const last = out[out.length - 1];
    if (last && last.b === r.b && last.i === r.i && last.href === r.href) last.s += r.s;
    else out.push({ ...r });
  }
  for (let k = 1; k < out.length; k++) if (out[k - 1]!.s.endsWith(" ") && out[k]!.s.startsWith(" ")) out[k]!.s = out[k]!.s.slice(1);
  if (out[0]) out[0].s = out[0].s.replace(/^ +/, "");
  if (out.length) out[out.length - 1]!.s = out[out.length - 1]!.s.replace(/ +$/, "");
  return out.filter((r) => r.s);
}
function canon(blocks: readonly Block[]): string {
  return JSON.stringify(blocks.flatMap((b) => (b.t === "blank" ? [] : [b.t === "line" ? ["p", canonRuns(b.c)] : b.t === "h" ? [`h${b.level}`, canonRuns(b.c)] : [`li${b.depth}${b.ordered ? "o" : "u"}`, canonRuns(b.c)]])).filter((x) => x[0] !== "p" || (x[1] as Run[]).length));
}

// ---- The one entry point the card and the write use ----

export type Editing =
  | { editable: true; format: FieldFormat; text: string; /** Fonts, sizes or colors would be dropped. */ lossy: boolean }
  | { editable: false; format: FieldFormat; why: NotEditable };

/**
 * How a stored field is edited here: its light text, or why it can't be. An empty field is editable. A Markdown field
 * is its own text (passed through untouched), unless it holds a table, an image, raw HTML or a mention, which the
 * editing text and its live look can't show.
 */
export function editingOf(stored: string | null | undefined, format: FieldFormat): Editing {
  const v = stored ?? "";
  if (format === "markdown") {
    if (/^\s*\|.*\|\s*$/m.test(v)) return { editable: false, format, why: "table" };
    if (/!\[[^\]]*\]\(/.test(v)) return { editable: false, format, why: "image" };
    if (/@<[^>]+>/.test(v)) return { editable: false, format, why: "mention" };
    if (/<\/?[a-z][^>]*>/i.test(v)) return { editable: false, format, why: "other" };
    return { editable: true, format, text: v, lossy: false };
  }
  if (!v.trim()) return { editable: true, format, text: "", lossy: false };
  // A named character FocusTime doesn't read (&ndash;, &rsquo; …) would be written back as its letters: not a box.
  if (/&[a-z][a-z0-9]*;/i.test(v.replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, ""))) return { editable: false, format, why: "other" };
  const w = htmlBlocks(v);
  if (w.refuse) return { editable: false, format, why: w.refuse };
  const text = blocksText(w.blocks);
  // The proof: the text read back, and the HTML it writes read again, are the same content as what DevOps has.
  const want = canon(w.blocks);
  if (canon(parseBlocks(text)) !== want || canon(htmlBlocks(lightToHtml(text)).blocks) !== want) return { editable: false, format, why: "other" };
  return { editable: true, format, text, lossy: w.lossy };
}

/** What is written for typed text: clean HTML for an HTML field, the text itself for a Markdown field. */
export const storedValue = (text: string, format: FieldFormat): string => (format === "markdown" ? text.replace(/\r\n?/g, "\n").replace(/\s+$/, "") : lightToHtml(text));

/** The live look (and the preview's "as it will read"): always safe HTML, whatever the field's format. */
export const lookHtml = (text: string): string => lightToHtml(text);

/** Two stored values hold the same content (the canonical blocks), for read back and undo. */
export function sameContent(a: string, b: string, format: FieldFormat): boolean {
  if (format === "markdown") return a.replace(/\r\n?/g, "\n").trim() === b.replace(/\r\n?/g, "\n").trim();
  return canon(htmlBlocks(a).blocks) === canon(htmlBlocks(b).blocks);
}

/** The line shown instead of the Edit box. */
export const NOT_EDITABLE_TEXT: Record<NotEditable, string> = {
  table: "This has a table or an image, so it can't be changed here without losing it.",
  image: "This has a table or an image, so it can't be changed here without losing it.",
  embed: "This has embedded content, so it can't be changed here without losing it.",
  mention: "This mentions someone, so it can't be changed here without losing the mention.",
  other: "This has formatting FocusTime can't keep, so it can't be changed here without losing it.",
};
export const LOSSY_TEXT = "Fonts and colors from the old text will be removed.";

/** For tests and the card: the text with its marks, never run as HTML. */
export const plainOf = (text: string) => canonRuns(parseBlocks(text).flatMap((b) => (b.t === "blank" ? [] : b.c))).map((r) => r.s).join(" ");

/** The marks the format buttons add around a selection (Bold, Italic, Link) or at line starts (Bullets, Numbers). */
export function applyMark(value: string, start: number, end: number, mark: "bold" | "italic" | "bullets" | "numbers" | "link"): { value: string; start: number; end: number } {
  const sel = value.slice(start, end);
  if (mark === "bold" || mark === "italic" || mark === "link") {
    const [a, z] = mark === "bold" ? ["**", "**"] : mark === "italic" ? ["*", "*"] : ["[", "](https://)"];
    const words = sel || (mark === "link" ? "words" : "text");
    const next = value.slice(0, start) + a + words + z + value.slice(end);
    // The words stay selected (for a link, the address to type is selected).
    if (mark === "link") return { value: next, start: start + a.length + words.length + 2, end: start + a.length + words.length + z.length - 1 };
    return { value: next, start: start + a.length, end: start + a.length + words.length };
  }
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const toNl = value.indexOf("\n", Math.max(end, start));
  const to = toNl < 0 ? value.length : toNl;
  const lines = value.slice(from, to).split("\n");
  const has = mark === "bullets" ? /^\s*- / : /^\s*\d{1,9}\. /;
  const all = lines.every((l) => has.test(l) || !l.trim());
  const changed = lines.map((l, k) => {
    if (!l.trim()) return l;
    const bare = l.replace(/^(\s*)(- |\d{1,9}\. )/, "$1");
    if (all) return bare;
    const ind = /^\s*/.exec(bare)![0];
    return `${ind}${mark === "bullets" ? "- " : `${k + 1}. `}${bare.slice(ind.length)}`;
  });
  const block = changed.join("\n");
  return { value: value.slice(0, from) + block + value.slice(to), start: from, end: from + block.length };
}

/**
 * A stored value's content as one string, for read back and undo: the canonical blocks of HTML (a field holding
 * anything FocusTime can't keep compares as its raw text, so a table or image added since never matches), or
 * Markdown's text.
 */
export function canonOf(v: string, format: FieldFormat): string {
  if (format === "markdown") return `md:${v.replace(/\r\n?/g, "\n").trim()}`;
  const w = htmlBlocks(v);
  return w.refuse ? `raw:${v}` : canon(w.blocks);
}
