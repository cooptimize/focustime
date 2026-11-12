// TP-1: work templates and the four lines, pure. The smallest item a builder can use is four short lines: what is being
// touched and where, what changes, how it will be checked, and how far "done" goes and who signs off. Their names are
// defined here once (fixed, so other tools can find them in a description); the team's templates (a request type each,
// with a hint and a worked example per line, and the choice lists the New form offers) are data an admin edits in the
// app. This file builds what a create writes (the description under the four headings, the acceptance text, the one
// request type tag) and reads the four lines back out of a description. No I/O.
import { textToHtml } from "./devopswrite.ts";

export const LINE_KEYS = ["where", "change", "check", "done"] as const;
export type LineKey = (typeof LINE_KEYS)[number];

/** The four lines' names, everywhere a person sees them and as the headings written to DevOps. Never edited. */
export const LINE_NAMES: Record<LineKey, string> = {
  where: "What and where",
  change: "What changes",
  check: "How we'll check",
  done: "How far and who signs off",
};
/** The names the two studies used before TP-1; read as the same four lines, never written. */
export const EARLIER_NAMES: Record<LineKey, string> = { where: "Target", change: "Change", check: "Control", done: "Boundary" };

/** The prefix of the one request type tag a create writes ("type:new-measure"). */
export const TAG_PREFIX = "type:";
/** A template's tag: lower case letters and digits joined by hyphens (never a ";", "," or "@", which DevOps tags can't hold). */
export const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TAG_MAX = 40;

/** The stories a type usually breaks into (kept and shown now; a later step offers them in Break down). */
export const STORY_KINDS = ["Discovery", "Data", "Model", "Report", "Promote and accept", "One story"] as const;
export type StoryKind = (typeof STORY_KINDS)[number];

export type LineHelp = { hint: string; example: string };
export type TemplateType = {
  /** Stable: the tag it was made with. */
  id: string;
  name: string;
  /** Set once from the name; a rename never changes it. */
  tag: string;
  meaning: string;
  lines: Record<LineKey, LineHelp>;
  stories: StoryKind[];
  /** Taken off the form; kept so items and drafts that carry its tag still show its name. */
  removed?: boolean;
};
export type ChoiceLists = { environments: string[]; touches: string[]; doneWhen: string[]; notWithout: string[] };
export type WorkTemplates = {
  /** Why each line matters to a builder: the help mark's one sentence. */
  why: Record<LineKey, string>;
  /** The hints and examples when no type is chosen. */
  generic: Record<LineKey, LineHelp>;
  types: TemplateType[];
  lists: ChoiceLists;
};
export const LIST_NAMES: Record<keyof ChoiceLists, string> = { environments: "Environment", touches: "Touches", doneWhen: "Done when it is", notWithout: "Not without asking" };

// ---- limits (the server checks every save against them) ----
export const LIMITS = { types: 40, name: 60, meaning: 140, hint: 300, example: 500, why: 200, listItems: 12, choice: 60, lineText: 2000, who: 100 } as const;

/** "New measure" → "new-measure". Empty when nothing usable is left. */
export function slugOf(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TAG_MAX)
    .replace(/-+$/, "");
}
/** A tag for a new type: its slug, made unique among every tag the team has had (removed ones too). */
export function newTag(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  const base = slugOf(name) || "type";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const t = `${base.slice(0, TAG_MAX - String(n).length - 1)}-${n}`;
    if (!used.has(t)) return t;
  }
}

/** The types the New form offers, in the team's order. */
export const activeTypes = (t: WorkTemplates) => t.types.filter((x) => !x.removed);
/** A type by its id, removed ones too. */
export const typeById = (t: WorkTemplates, id: string | null | undefined) => (id ? (t.types.find((x) => x.id === id) ?? null) : null);
/** The hints and examples for a type, or the generic ones. */
export const helpFor = (t: WorkTemplates, id: string | null | undefined): Record<LineKey, LineHelp> => typeById(t, id)?.lines ?? t.generic;

// ---- what a person fills in ----

/** A person chosen from the client's DevOps project (their email kept to check them), or a role typed in. */
export type Who = { name: string; email: string | null };
/** The four lines as the New form and a draft keep them. Every part is optional. */
export type Brief = {
  /** The template's id, or null (the generic hints). */
  type: string | null;
  where: string;
  env: string | null;
  touches: string[];
  change: string;
  check: string;
  checkedBy: Who | null;
  done: string;
  doneWhen: string | null;
  signedOffBy: Who | null;
  notWithout: string[];
};
export const EMPTY_BRIEF: Brief = { type: null, where: "", env: null, touches: [], change: "", check: "", checkedBy: null, done: "", doneWhen: null, signedOffBy: null, notWithout: [] };

/** Nothing in it at all (no type, no line, no choice). */
export const briefEmpty = (b: Brief | null | undefined): boolean => !b || (!b.type && LINE_KEYS.every((k) => !lineWords(b, k).length));

/** The person's own text, one line of it: a single space for runs of spaces and tabs, at most two newlines in a row. */
const tidy = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
/** "Deploy to production" → "deploy to production" (but "SQL", "Power BI" stay). */
export const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const sentence = (s: string) => (/[.!?:]$/.test(s) ? s : `${s}.`);

/**
 * One line's parts as plain words, in the order they are written: the person's text and then the line's choices,
 * except "How far and who signs off", whose choices come first and the box after ("anything else").
 */
export function lineWords(b: Brief, k: LineKey): string[] {
  const t = tidy(b[k]);
  const choices: string[] = [];
  if (k === "where") {
    if (b.env?.trim()) choices.push(sentence(`Environment: ${b.env.trim()}`));
    if (b.touches.length) choices.push(sentence(`Touches: ${b.touches.map((x) => x.trim()).filter(Boolean).join(", ")}`));
  } else if (k === "check") {
    if (b.checkedBy?.name.trim()) choices.push(sentence(`Checked by: ${b.checkedBy.name.trim()}`));
  } else if (k === "done") {
    if (b.doneWhen?.trim()) choices.push(sentence(`Done when it is: ${lcFirst(b.doneWhen.trim())}`));
    if (b.signedOffBy?.name.trim()) choices.push(sentence(`Signed off by: ${b.signedOffBy.name.trim()}`));
    if (b.notWithout.length) choices.push(sentence(`Not without asking: ${b.notWithout.map((x) => lcFirst(x.trim())).filter(Boolean).join(", ")}`));
  }
  const chosen = choices.join(" ");
  if (k === "done") return [chosen, t].filter(Boolean);
  return [t, chosen].filter(Boolean);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const para = (s: string) => `<p>${s.split("\n").map(esc).join("<br>")}</p>`;

/** The four lines as DevOps gets them: a heading and its paragraphs per line that has anything, in order. "" when none. */
export function linesHtml(b: Brief): string {
  return LINE_KEYS.map((k) => {
    const parts = lineWords(b, k);
    return parts.length ? `<h3>${esc(LINE_NAMES[k])}</h3>${parts.map(para).join("")}` : "";
  }).join("");
}
/** The same as plain text, for the preview ("as it will read"). */
export function linesText(b: Brief): string {
  return LINE_KEYS.map((k) => {
    const parts = lineWords(b, k);
    return parts.length ? `${LINE_NAMES[k]}\n${parts.join("\n")}` : "";
  })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The description a create writes: what the person typed in the description box (as DevOps keeps plain text, a <div>
 * per line), then the four lines under their headings. Null when there is nothing.
 */
export function descriptionHtml(typed: string | null | undefined, b: Brief | null): string | null {
  const own = typed?.trim() ? textToHtml(typed.trim()) : "";
  const lines = b ? linesHtml(b) : "";
  return own + lines || null;
}
/** As plain text, for the preview. */
export function descriptionText(typed: string | null | undefined, b: Brief | null): string | null {
  const t = [typed?.trim() ?? "", b ? linesText(b) : ""].filter(Boolean).join("\n\n");
  return t || null;
}

/** "How we'll check" for the acceptance field (with who checks), or null when that line has no text. */
export function acceptanceText(b: Brief | null): string | null {
  if (!b || !tidy(b.check)) return null;
  const who = b.checkedBy?.name.trim();
  return who ? `${tidy(b.check)}\n${sentence(`Checked by: ${who}`)}` : tidy(b.check);
}

/** The tag a create adds when a type is chosen ("type:new-measure"), or null. */
export function templateTag(t: WorkTemplates, b: Brief | null): string | null {
  const x = typeById(t, b?.type);
  return x && TAG_PATTERN.test(x.tag) ? `${TAG_PREFIX}${x.tag}` : null;
}

/** Which lines count as filled: text, except "How far and who signs off", which counts once "Done when it is" is chosen. */
export function briefFilled(b: Brief): Record<LineKey, boolean> {
  return { where: !!tidy(b.where), change: !!tidy(b.change), check: !!tidy(b.check), done: !!b.doneWhen?.trim() };
}

// ---- reading the four lines back out of a description ----

const NBSP = / /g;
const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&amp;/g, "&");
/** HTML to plain text: one line per block, tags gone, entities decoded. */
export function plainOf(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(NBSP, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const norm = (s: string) => s.replace(/[‘’ʼ]/g, "'").replace(NBSP, " ").replace(/\s+/g, " ").trim().replace(/:$/, "").trim().toLowerCase();
const NAMES = new Map<string, { k: LineKey; earlier: boolean }>([...LINE_KEYS.map((k) => [norm(LINE_NAMES[k]), { k, earlier: false }] as const), ...LINE_KEYS.map((k) => [norm(EARLIER_NAMES[k]), { k, earlier: true }] as const)]);

export type ReadLines = {
  /** The text under each heading that was found (plain text). */
  lines: Partial<Record<LineKey, string>>;
  /** Any heading at all was found. */
  found: boolean;
  /** Found under the earlier names (Target, Change, Control, Boundary). */
  earlier: boolean;
  /** The description without the four lines' sections (HTML, as given). */
  rest: string;
};

/**
 * The four lines out of a description: a heading (h1 to h6), or a paragraph or div holding only a line's name (bold or
 * not, with or without a colon), starts a line; it runs until the next such heading or any other heading. Text around
 * them stays in `rest`. The first of each line counts.
 */
export function readLines(html: string | null | undefined): ReadLines {
  const src = html ?? "";
  type Mark = { start: number; end: number; k: LineKey | null; earlier: boolean };
  const marks: Mark[] = [];
  const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>|<(p|div)\b[^>]*>\s*((?:<(?:b|strong|u|em)\b[^>]*>\s*)*)([^<]{1,80})((?:\s*<\/(?:b|strong|u|em)\s*>)*)\s*(?:<br\s*\/?>\s*)?<\/\3\s*>/gi;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const text = norm(decode(m[1] ? m[2]!.replace(/<[^>]+>/g, "") : m[5]!));
    const hit = NAMES.get(text);
    if (hit) marks.push({ start: m.index, end: m.index + m[0].length, k: hit.k, earlier: hit.earlier });
    else if (m[1]) marks.push({ start: m.index, end: m.index + m[0].length, k: null, earlier: false });
  }
  const lines: Partial<Record<LineKey, string>> = {};
  const cut: [number, number][] = [];
  let earlier = false;
  marks.forEach((mk, i) => {
    if (!mk.k) return;
    const until = marks[i + 1]?.start ?? src.length;
    cut.push([mk.start, until]);
    if (lines[mk.k] !== undefined) return;
    lines[mk.k] = plainOf(src.slice(mk.end, until));
    if (mk.earlier) earlier = true;
  });
  let rest = "";
  let at = 0;
  for (const [s, e] of cut) {
    rest += src.slice(at, s);
    at = e;
  }
  rest += src.slice(at);
  return { lines, found: cut.length > 0, earlier, rest: plainOf(rest) ? rest : "" };
}

/** Which lines count as filled in a description read back (the same rule as the form's). */
export function readFilled(r: ReadLines): Record<LineKey, boolean> {
  const has = (k: LineKey) => !!r.lines[k]?.trim();
  // "How far" counts once "Done when it is" was chosen; an item written under the earlier names had no choice, so text counts.
  const done = /done when it is:\s*\S/i.test(r.lines.done ?? "") || (r.earlier && has("done"));
  return { where: has("where"), change: has("change"), check: has("check"), done };
}

/** The request type an item's tags name, from the team's templates (removed types too), or null. */
export function typeOfTags(t: WorkTemplates, tags: readonly string[] | null | undefined): TemplateType | null {
  for (const raw of tags ?? []) {
    const s = raw.trim().toLowerCase();
    if (!s.startsWith(TAG_PREFIX)) continue;
    const tag = s.slice(TAG_PREFIX.length);
    const hit = t.types.find((x) => x.tag === tag);
    if (hit) return hit;
  }
  return null;
}

/** The story card's quiet chip: Ready, or the empty lines by name. Null for an item with neither headings nor a known tag. */
export type Readiness = { ready: true } | { ready: false; missing: LineKey[] };
export function readiness(r: ReadLines, type: TemplateType | null): Readiness | null {
  if (!r.found && !type) return null;
  const f = readFilled(r);
  const missing = LINE_KEYS.filter((k) => !f[k]);
  return missing.length ? { ready: false, missing } : { ready: true };
}
export const readinessText = (x: Readiness) => (x.ready ? "Ready" : `Missing: ${x.missing.map((k) => LINE_NAMES[k]).join(", ")}`);

// ---- checking a brief from the client ----

export class BriefError extends Error {}
const optStr = (v: unknown, name: string, max: number): string => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new BriefError(`${name} must be text`);
  if (v.length > max) throw new BriefError(`${name} is at most ${max} characters`);
  return v;
};
const optChoice = (v: unknown, name: string): string | null => {
  const s = optStr(v, name, LIMITS.choice).trim();
  return s ? s.replace(/\s+/g, " ") : null;
};
const optList = (v: unknown, name: string): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > LIMITS.listItems) throw new BriefError(`${name} is a list of at most ${LIMITS.listItems}`);
  const out: string[] = [];
  for (const x of v) {
    const s = optChoice(x, name);
    if (s && !out.some((y) => y.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
};
const optWho = (v: unknown, name: string): Who | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new BriefError(`${name} is a person or a role`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "name" && k !== "email") throw new BriefError(`${name} has an unknown field ${k}`);
  const n = optStr(o.name, name, LIMITS.who).replace(/\s+/g, " ").trim();
  if (!n) return null;
  const email = o.email === undefined || o.email === null || o.email === "" ? null : optStr(o.email, `${name} email`, 320).trim().toLowerCase();
  if (email !== null && !/^[^\s@]+@[^\s@]+$/.test(email)) throw new BriefError(`${name} email isn't an email`);
  return { name: n, email };
};

/**
 * A brief as the server takes it (the New form, a draft): every part optional, lengths capped. The type must be one of
 * the team's (a removed one is kept: a draft saved before the removal still carries it). Null when it is empty.
 */
export function parseBrief(v: unknown, t: WorkTemplates): Brief | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new BriefError("brief must be an object");
  const o = v as Record<string, unknown>;
  const known = new Set<string>(Object.keys(EMPTY_BRIEF));
  for (const k of Object.keys(o)) if (!known.has(k)) throw new BriefError(`brief has an unknown field ${k}`);
  const type = o.type === undefined || o.type === null || o.type === "" ? null : optStr(o.type, "type", TAG_MAX);
  if (type !== null && !typeById(t, type)) throw new BriefError("That request type isn't one of the team's any more. Choose another");
  const b: Brief = {
    type,
    where: optStr(o.where, LINE_NAMES.where, LIMITS.lineText),
    env: optChoice(o.env, "Environment"),
    touches: optList(o.touches, "Touches"),
    change: optStr(o.change, LINE_NAMES.change, LIMITS.lineText),
    check: optStr(o.check, LINE_NAMES.check, LIMITS.lineText),
    checkedBy: optWho(o.checkedBy, "Checked by"),
    done: optStr(o.done, LINE_NAMES.done, LIMITS.lineText),
    doneWhen: optChoice(o.doneWhen, "Done when it is"),
    signedOffBy: optWho(o.signedOffBy, "Signed off by"),
    notWithout: optList(o.notWithout, "Not without asking"),
  };
  return briefEmpty(b) ? null : b;
}
/** A brief kept as JSON (a draft's column): read leniently, never throws; anything unreadable is no brief. */
export function briefFromJson(json: string | null | undefined, t: WorkTemplates | null): Brief | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    // A removed or unknown type on an old draft: its id is kept as it was (the form names it), never dropped silently.
    const b = parseBrief({ ...raw, type: null }, t ?? SEED);
    return b || raw.type ? { ...(b ?? EMPTY_BRIEF), type: typeof raw.type === "string" ? raw.type : null } : null;
  } catch {
    return null;
  }
}

// ---- checking the team's templates (an admin's save) ----

const need = (v: unknown, name: string, max: number, allowEmpty = false): string => {
  if (typeof v !== "string") throw new BriefError(`${name} must be text`);
  const s = v.replace(/\r\n?/g, "\n").trim();
  if (!s && !allowEmpty) throw new BriefError(`${name} can't be empty`);
  if (s.length > max) throw new BriefError(`${name} is at most ${max} characters`);
  return s;
};
const helpOf = (v: unknown, where: string): Record<LineKey, LineHelp> => {
  if (!v || typeof v !== "object") throw new BriefError(`${where}: the four lines are missing`);
  const o = v as Record<string, { hint?: unknown; example?: unknown } | undefined>;
  return Object.fromEntries(LINE_KEYS.map((k) => [k, { hint: need(o[k]?.hint ?? "", `${where}, ${LINE_NAMES[k]}: the hint`, LIMITS.hint, true), example: need(o[k]?.example ?? "", `${where}, ${LINE_NAMES[k]}: the example`, LIMITS.example, true) }])) as Record<LineKey, LineHelp>;
};

/**
 * An admin's edit, checked against what is saved now. Tags never change: an existing type keeps its tag whatever its
 * name becomes; a new one gets one from its name, unique among every tag the team has had. A type left out of the edit
 * is kept as removed (items carrying its tag still show its name). Names are unique among the types offered.
 */
export function checkTemplates(next: unknown, was: WorkTemplates): WorkTemplates {
  if (!next || typeof next !== "object" || Array.isArray(next)) throw new BriefError("templates must be an object");
  const n = next as Record<string, unknown>;
  const why = n.why as Record<string, unknown> | undefined;
  if (!why || typeof why !== "object") throw new BriefError("Why each line matters is missing");
  const whyOut = Object.fromEntries(LINE_KEYS.map((k) => [k, need(why[k], `Why ${LINE_NAMES[k]} matters`, LIMITS.why)])) as Record<LineKey, string>;
  const generic = helpOf(n.generic, "No type chosen");
  if (!Array.isArray(n.types) || n.types.length > LIMITS.types) throw new BriefError(`At most ${LIMITS.types} types`);
  const taken = new Set(was.types.map((x) => x.tag));
  const seenIds = new Set<string>();
  const names = new Set<string>();
  const types: TemplateType[] = [];
  for (const raw of n.types as unknown[]) {
    if (!raw || typeof raw !== "object") throw new BriefError("A type must be an object");
    const r = raw as Record<string, unknown>;
    const name = need(r.name, "A type's name", LIMITS.name).replace(/\s+/g, " ");
    const old = typeof r.id === "string" ? was.types.find((x) => x.id === r.id) : undefined;
    const removed = r.removed === true;
    if (!removed) {
      if (names.has(name.toLowerCase())) throw new BriefError(`Two types are called ${name}`);
      names.add(name.toLowerCase());
    }
    const tag = old?.tag ?? newTag(name, taken);
    taken.add(tag);
    const id = old?.id ?? tag;
    if (seenIds.has(id)) throw new BriefError(`${name} is listed twice`);
    seenIds.add(id);
    if (!Array.isArray(r.stories) || r.stories.length > 10 || r.stories.some((s) => !(STORY_KINDS as readonly unknown[]).includes(s))) throw new BriefError(`${name}: typical stories are chosen from ${STORY_KINDS.join(", ")}`);
    types.push({ id, name, tag, meaning: need(r.meaning ?? "", `${name}: what it means`, LIMITS.meaning, true), lines: helpOf(r.lines, name), stories: [...(r.stories as StoryKind[])], ...(removed ? { removed: true } : {}) });
  }
  // Removing is taking it off the form: a type the edit left out entirely stays, removed.
  for (const x of was.types) if (!seenIds.has(x.id)) types.push({ ...x, removed: true });
  const l = n.lists as Record<string, unknown> | undefined;
  if (!l || typeof l !== "object") throw new BriefError("The choice lists are missing");
  const lists = Object.fromEntries(
    (Object.keys(LIST_NAMES) as (keyof ChoiceLists)[]).map((k) => {
      const v = l[k];
      if (!Array.isArray(v) || v.length > LIMITS.listItems) throw new BriefError(`${LIST_NAMES[k]}: at most ${LIMITS.listItems} choices`);
      const out: string[] = [];
      for (const x of v) {
        const s = need(x, `A choice in ${LIST_NAMES[k]}`, LIMITS.choice).replace(/\s+/g, " ");
        if (out.some((y) => y.toLowerCase() === s.toLowerCase())) throw new BriefError(`${LIST_NAMES[k]} has ${s} twice`);
        out.push(s);
      }
      return [k, out];
    }),
  ) as ChoiceLists;
  return { why: whyOut, generic, types, lists };
}

/** What an admin's save changed, one line each, for the audit (area "work_templates"). */
export type TemplateChange = { target: string; setting: string; oldValue: string | null; newValue: string | null };
export function templateChanges(was: WorkTemplates, now: WorkTemplates): TemplateChange[] {
  const out: TemplateChange[] = [];
  const cap = (s: string | null) => (s === null ? null : s.length > 500 ? `${s.slice(0, 497)}...` : s);
  const add = (target: string, setting: string, a: string | null, b: string | null) => a !== b && out.push({ target, setting, oldValue: cap(a), newValue: cap(b) });
  for (const k of LINE_KEYS) {
    add("The four lines", `${LINE_NAMES[k]}: why it matters`, was.why[k], now.why[k]);
    add("No type chosen", `${LINE_NAMES[k]}: hint`, was.generic[k].hint, now.generic[k].hint);
    add("No type chosen", `${LINE_NAMES[k]}: example`, was.generic[k].example, now.generic[k].example);
  }
  for (const x of now.types) {
    const o = was.types.find((y) => y.id === x.id);
    if (!o) {
      out.push({ target: x.name, setting: "Added", oldValue: null, newValue: `${TAG_PREFIX}${x.tag}` });
      continue;
    }
    add(x.name, "Name", o.name, x.name);
    if (!!o.removed !== !!x.removed) add(x.name, x.removed ? "Removed" : "Brought back", o.removed ? "removed" : "offered", x.removed ? "removed" : "offered");
    add(x.name, "Meaning", o.meaning, x.meaning);
    add(x.name, "Typical stories", o.stories.join(", ") || "None", x.stories.join(", ") || "None");
    for (const k of LINE_KEYS) {
      add(x.name, `${LINE_NAMES[k]}: hint`, o.lines[k].hint, x.lines[k].hint);
      add(x.name, `${LINE_NAMES[k]}: example`, o.lines[k].example, x.lines[k].example);
    }
  }
  const order = (t: WorkTemplates) => activeTypes(t).map((x) => x.name).join(", ");
  // Reordered: the types offered before and after, in a different order (adds and removals are their own lines).
  const common = (a: WorkTemplates, b: WorkTemplates) => activeTypes(a).filter((x) => activeTypes(b).some((y) => y.id === x.id)).map((x) => x.id).join();
  if (common(was, now) !== common(now, was)) out.push({ target: "Types", setting: "Order", oldValue: cap(order(was)), newValue: cap(order(now)) });
  for (const k of Object.keys(LIST_NAMES) as (keyof ChoiceLists)[]) add("Choice lists", LIST_NAMES[k], was.lists[k].join(", "), now.lists[k].join(", "));
  return out;
}

// ---- the seed: the first templates and lists (made up; edited later in the app) ----

const L = (where: [string, string], change: [string, string], check: [string, string], done: [string, string]): Record<LineKey, LineHelp> => ({
  where: { hint: where[0], example: where[1] },
  change: { hint: change[0], example: change[1] },
  check: { hint: check[0], example: check[1] },
  done: { hint: done[0], example: done[1] },
});
const ADD = "Anything to add to the choices below.";
const T = (name: string, meaning: string, stories: StoryKind[], lines: Record<LineKey, LineHelp>): TemplateType => {
  const tag = slugOf(name);
  return { id: tag, name, tag, meaning, lines, stories };
};

export const SEED: WorkTemplates = {
  why: {
    where: "A builder has to know exactly which thing to open before anything else.",
    change: "The rule decides the answer. If it isn't written, it ends up only in the code.",
    check: "One example with the right answer is how anyone knows it worked.",
    done: 'Built, in test, published and approved are different things. Say which one is "done".',
  },
  generic: L(
    ["The exact thing and where it lives.", "The Sales model, margin page of the finance report."],
    ["Before and after, or the rule. Add the exception that matters and what must stay the same.", "Show margin as a percent instead of an amount. Blank when revenue is zero. Totals stay as they are."],
    ["One example with the right answer, and where that answer comes from.", "October, East region should show 31.2%, matching the finance ledger."],
    [ADD, "The finance lead reviews it in test before it is published."],
  ),
  types: [
    T("Small change", "Columns, a filter, formatting or labels on something that exists", ["One story"], L(
      ["The exact page, visual or table, and who uses it.", "Orders report, Open Orders page, the orders table."],
      ["Before and after, with one edge case. What must not change.", "Add the order's created date as a column, shown as a short date. Orders with no date show blank. The totals row is unchanged."],
      ["One row you can look up, and what it should show.", 'A known order placed on Nov 3 shows "Nov 3" in the new column.'],
      [ADD, "The operations lead confirms the column on the test app."],
    )),
    T("New report", "A new report or page on existing data", ["Model", "Report", "Promote and accept"], L(
      ["Who it is for, the decision it helps, which model it reads, and where it will live.", "For project managers reviewing weekly timesheets. Reads the Projects model. A new report in the Projects app."],
      ["The pages, what each shows and at what level of detail; filters, defaults and drill-through.", "One page listing timesheet lines with their comments, one row per line. Defaults to the current week. Filter by project and person. Drill from a project to its lines."],
      ["A selection whose numbers must match the model, and who looks at the page.", "For the week of Nov 2, total hours on the page equal total hours in the model for the same week."],
      [ADD, "A project manager walks through it in test before it goes in the app."],
    )),
    T("New measure", "A new calculation on data that is already modeled", ["Model"], L(
      ["Which model, and where the measure should appear.", "The Sales model. Shown on the margin page of the finance report."],
      ["What is counted or summed and at what level; the top and bottom of a ratio; how it behaves by date, under filters, at totals, and when empty or dividing by zero.", "Gross margin percent: revenue minus cost, divided by revenue. Follows the page's date filter. Totals are recalculated, not averaged. Blank when revenue is zero."],
      ["A known value for a named selection, at detail and at total, and where it comes from.", "October, East region: 31.2%. October, all regions: 28.4%. Both from the finance ledger."],
      [ADD, "In the model and on the page in test. The finance lead confirms the two numbers."],
    )),
    T("Foundation build", "Standing up the first model, pipelines or workspace for an area", ["Discovery", "Data", "Model", "Report", "Promote and accept"], L(
      ["The business area, the first usable slice and what is left out. Who will run it.", "Inventory. First slice: on-hand stock by warehouse and item, daily. Purchasing and forecasts are left out for now."],
      ["Where the truth comes from, what one row of the first fact table is, its keys, and the core rules.", "From the inventory system's stock table. One row per item, warehouse and day. Negative stock is kept and flagged, not hidden."],
      ["An end-to-end figure that must match the source for a named day.", "Total on-hand units for Nov 1 across all warehouses matches the inventory system's own report for that day."],
      [ADD, "The first report is in test and refreshed daily for a week before the supply chain lead signs off."],
    )),
    T("New data source", "Bringing in data that has no place in the model yet", ["Discovery", "Data"], L(
      ["Who provides it, the exact feed, how it is reached and who grants access. Never a password here. Where it lands.", "Weekly hours export from the payroll provider, a file dropped in the shared folder each Monday. The payroll lead grants access. Lands in the raw hours area."],
      ["What one row means, its keys, and how corrections and deletions arrive. How often, and how much history.", "One row per person, day and pay code. A corrected week arrives as a full replacement file. Weekly, with two years of history loaded once."],
      ["One delivery that must match the source, and what a repeated or corrected delivery should do.", "The week of Nov 2 totals the same hours as the provider's summary. Loading the same file twice doesn't double the hours."],
      [ADD, "Loaded in test for two weeks running before it is scheduled."],
    )),
    T("Exploration", "Looking into data or a question before anything is built", ["Discovery"], L(
      ["The question, and where to look.", "Can returns be tied back to their original orders? Look in the returns and orders tables."],
      ["What would answer it, and a time limit.", "A yes or no, with the share of returns that can be matched and why the rest can't. Half a day."],
      ["What comes back, and who decides what happens next.", "A short note with the match rate and three example returns. The sales lead decides whether to build it."],
      [ADD, "Nothing is built or changed."],
    )),
    T("Data anomaly", "Numbers that look wrong and need finding out why", ["Discovery", "One story"], L(
      ["Where the wrong number shows: the report, page, filters and dates.", "Forecast report, Monthly page, filtered to the current plan, months July to December."],
      ["What it shows, what it should show, and who says so. Since when.", "Some months appear twice, so revenue is doubled. Each month should appear once. Reported by the finance lead, first seen this week."],
      ["The failing case fixed, and a comparison case that must not move.", "September shows once, with revenue matching the plan. January to June totals are the same as before."],
      [ADD, "Find the cause first. Fix only after the cause is written here."],
    )),
    T("Rerun or data fix", "Reloading, backfilling or correcting data", ["One story"], L(
      ["The exact data and dates.", "The orders table, order dates Oct 1 to Oct 31."],
      ["The result wanted, the approved way to do it, and what happens if it runs twice.", "Reload October after the source correction. Use the standard reload for a date range. Running it twice must not duplicate rows."],
      ["A before and after figure that must match.", "October order count and revenue match the source after the reload. September is unchanged."],
      [ADD, "The data owner approves the reload and the time it runs."],
    )),
    T("Data migration", "Moving existing data, models or reports from one platform or system to another", ["Discovery", "Data", "Model", "Report", "Promote and accept"], L(
      ["From where to where, and what is in scope.", "The finance tables and the finance model, from the old warehouse to the new platform. Sales is out of scope."],
      ["How old maps to new, and how the two are compared.", "Same tables and columns unless listed. Compare row counts and monthly revenue between old and new."],
      ["Old and new match for a named period.", "For 2025, monthly revenue matches to the cent between the two."],
      [ADD, "Both run side by side for one month end. The old one stays until the finance lead signs off."],
    )),
    T("Deployment", "Moving work between environments or releasing it", ["Promote and accept"], L(
      ["What is moving, item by item, from where to where.", "The updated Sales model and the margin page, from test to production."],
      ["When, and the check before.", "Thursday after the nightly refresh. Confirm the test refresh succeeded first."],
      ["The check after, in the place it was moved to.", "The margin page opens in production and October, East region shows 31.2%."],
      [ADD, "If the check fails, put the previous version back."],
    )),
    T("Pipeline failure", "A load or refresh that failed and needs fixing", ["One story"], L(
      ["Which pipeline or refresh.", "The nightly orders load."],
      ["The error, when it happened and what it affected.", "Failed at 2:10 AM on a timeout reading the source. Today's orders are missing from the reports."],
      ["It runs clean, and the affected data is complete.", "Tonight's run succeeds and today's order count matches the source."],
      [ADD, "Say what would stop it happening again, even if that is a separate item."],
    )),
    T("Performance", "Making a load, query or report faster", ["One story"], L(
      ["What is slow, and where the time is measured.", "The margin page of the finance report, measured opening it with no filters."],
      ["How slow now, and the target.", "About 40 seconds now. Under 8 seconds."],
      ["The same measurement after, with the numbers unchanged.", "Opens in under 8 seconds three times in a row, and October, East region still shows 31.2%."],
      [ADD, "The model may be changed. The page layout may not."],
    )),
    T("Access or admin", "Permissions, workspaces, licenses, gateways", ["One story"], L(
      ["Who, and to what.", "The planning team, to the Forecast workspace."],
      ["Which level, and why.", "View only, to read the monthly forecast."],
      ["The person can do the thing, and nothing more.", "A planner can open the forecast report and can't edit it."],
      [ADD, "Approved by the workspace owner."],
    )),
    T("Meeting or ongoing", "Recurring meetings, support time or standing work", [], L(
      ["Which client and what it covers.", "Weekly status call and general questions."],
      ["How often and how long.", "One hour a week."],
      ["Leave empty.", ""],
      [ADD, "Reviewed at the end of the quarter."],
    )),
  ],
  lists: {
    environments: ["Development", "Test", "Production"],
    touches: ["Data", "Model", "Report", "Pipeline"],
    doneWhen: ["Built", "In test", "Published", "Signed off"],
    notWithout: ["Deploy to production", "Rerun or reload data", "Change or fix data", "Change who can see it"],
  },
};

/** A full made-up item for a type ("See a full example"): its four lines filled from the type's examples and the team's first choices. */
export function fullExample(t: WorkTemplates, id: string | null): { brief: Brief; help: Record<LineKey, LineHelp> } {
  const help = helpFor(t, id);
  const first = (xs: string[], i = 0) => xs[Math.min(i, xs.length - 1)] ?? null;
  return {
    help,
    brief: {
      ...EMPTY_BRIEF,
      type: id,
      where: help.where.example,
      env: first(t.lists.environments, 1),
      touches: t.lists.touches.slice(0, 1),
      change: help.change.example,
      check: help.check.example,
      checkedBy: { name: "the finance lead", email: null },
      done: help.done.example,
      doneWhen: first(t.lists.doneWhen, 1),
      signedOffBy: { name: "the finance lead", email: null },
      notWithout: t.lists.notWithout.slice(0, 1),
    },
  };
}
