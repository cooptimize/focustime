// CV-1: a Teams message body as safe HTML for a conversation's "Show messages" and for the original messages a DevOps
// draft appends. An allowlist, never a blocklist: p, br, div, strong, em, u, a, ul, ol, li, table, thead, tbody, tr, th,
// td, blockquote, code, pre (b and i become strong and em). Every attribute goes except href on a, and only an http,
// https or mailto href. Scripts, styles and anything like them go with their content. <at id="N">…</at> becomes a
// mention chip named from the message's mentions (by position, as Graph numbers them); a hosted image (Graph's
// hostedContents URL, never hotlinked) or any other picture becomes "Image attached"; an emoji keeps its own character;
// a quoted reply's <attachment> marker is dropped. Unknown tags keep their text. The output is balanced: every tag
// opened is closed. Pure: no DOM, so the server and the browser give the same result.

const ALLOWED = new Set(["p", "br", "div", "strong", "em", "u", "a", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "blockquote", "code", "pre"]);
const RENAME: Record<string, string> = { b: "strong", i: "em" };
/** Tags dropped with everything inside them. */
const SKIP = new Set(["script", "style", "head", "title", "template", "iframe", "object", "embed", "svg", "math", "noscript", "textarea", "select", "button", "form"]);
const VOID = new Set(["br"]);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Decodes HTML entities in a text run (an unknown named one stays as written). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITY[e.toLowerCase()] ?? all;
  });
}

/** One attribute's value from a tag's attribute text, decoded, or null. */
export function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : null;
}

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
/** A Graph hostedContents URL (an image pasted into Teams): shown as "Image attached", never fetched. */
export const isHostedImage = (src: string | null) => !!src && /\/hostedContents\//i.test(src);

export type SanitizeMention = { name: string | null };

/**
 * The safe HTML of one message body. `mentions` are the message's mentions in Graph's order (the at tag's id is the
 * position). Plain-text bodies are escaped with their line breaks kept.
 */
export function sanitizeMessageHtml(content: string | null, o: { contentType?: string | null; mentions?: readonly SanitizeMention[] } = {}): string {
  if (!content) return "";
  if (o.contentType && o.contentType.toLowerCase() !== "html") return content.split(/\r?\n/).map((l) => esc(l)).join("<br>");
  const mentions = o.mentions ?? [];
  const out: string[] = [];
  const open: string[] = [];
  let skip: string | null = null;
  let skipDepth = 0;
  /** Inside a mention chip: its text is replaced by the name, the tag's own text dropped. */
  let inMention = false;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)|(<)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const [, slash, rawName, attrs = "", text, lt] = m;
    if (text !== undefined || lt !== undefined) {
      if (skip || inMention) continue;
      out.push(esc(decodeEntities(text ?? "<")));
      continue;
    }
    if (!rawName) continue; // a comment, CDATA or doctype
    const name = rawName.toLowerCase();
    const closing = slash === "/";
    if (skip) {
      if (name === skip) skipDepth += closing ? -1 : 1;
      if (skipDepth <= 0) skip = null;
      continue;
    }
    if (SKIP.has(name)) {
      if (!closing && !/\/\s*$/.test(attrs)) (skip = name), (skipDepth = 1);
      continue;
    }
    if (name === "at") {
      if (closing) {
        inMention = false;
        continue;
      }
      const id = Number(attr(attrs, "id"));
      const label = (Number.isInteger(id) && id >= 0 ? mentions[id]?.name : null) ?? null;
      // The name between the tags is the fallback when the mentions array doesn't have it.
      const after = content.slice(re.lastIndex);
      const between = decodeEntities((/^([^<]*)<\/at>/i.exec(after)?.[1] ?? "").trim());
      out.push(`<span class="mention">${esc(label ?? (between || "someone"))}</span>`);
      inMention = true;
      continue;
    }
    if (inMention) continue;
    if (name === "img") {
      if (closing) continue;
      const type = (attr(attrs, "itemtype") ?? "").toLowerCase();
      const alt = attr(attrs, "alt");
      if (/emoji/.test(type) && alt) out.push(esc(alt));
      else out.push(`<span class="attached">Image attached</span>`);
      continue;
    }
    if (name === "emoji") {
      if (!closing) out.push(esc(attr(attrs, "alt") ?? ""));
      continue;
    }
    if (name === "attachment") continue;
    const tag = RENAME[name] ?? name;
    if (!ALLOWED.has(tag)) continue;
    if (VOID.has(tag)) {
      if (!closing) out.push(`<${tag}>`);
      continue;
    }
    if (closing) {
      const at = open.lastIndexOf(tag);
      if (at < 0) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    if (tag === "a") {
      const href = attr(attrs, "href");
      out.push(href && SAFE_HREF.test(href.trim()) ? `<a href="${esc(href.trim())}">` : "<a>");
    } else out.push(`<${tag}>`);
    open.push(tag);
    if (/\/\s*$/.test(attrs)) out.push(`</${open.pop()}>`);
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join("");
}

export type BodyKind = { emojiOnly: boolean; gif: boolean; sticker: boolean; hostedImages: number; otherImages: number };

/** What a body carries besides words: emoji, a GIF (Giphy), a sticker, and how many pictures (for the chatter rules). */
export function bodyKind(html: string | null): BodyKind {
  const h = html ?? "";
  let hostedImages = 0;
  let otherImages = 0;
  let gif = false;
  let sticker = false;
  for (const m of h.matchAll(/<img\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
    const a = m[1] ?? "";
    const type = (attr(a, "itemtype") ?? "").toLowerCase();
    const src = attr(a, "src");
    if (/emoji/.test(type)) continue;
    if (/giphy/.test(type) || /giphy\.com/i.test(src ?? "")) gif = true;
    else if (/sticker|amsimage/.test(type) || /sticker/i.test(attr(a, "alt") ?? "")) sticker = true;
    else if (isHostedImage(src)) hostedImages++;
    else otherImages++;
  }
  const words = decodeEntities(h.replace(/<(emoji|img)\b[^>]*>/gi, "").replace(/<[^>]+>/g, "")).replace(/\s+/g, "");
  const emojiOnly = !words.length ? /<(emoji|img)\b/i.test(h) && !hostedImages && !otherImages && !gif && !sticker : /^[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}‍️⃣]+$/u.test(words);
  return { emojiOnly, gif, sticker, hostedImages, otherImages };
}
