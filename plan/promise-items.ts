// CV-3: likely items for "Link existing…" on a promise, by rules only (no AI). The words of the promise and the
// messages around it are matched against one client's open item titles. Order: an item written as #id first (or the
// conversation's likely item), then items assigned to me, then the most matched words, then the most recently
// changed. At most 5, each with a short reason. A typed query narrows the same list (title words or #id). Pure.
import type { WorkItem } from "../week/types.ts";

export const LIKELY_MAX = 5;

/** Words that say nothing about which item it is. */
const STOP = new Set(
  ("the and for with that this from have has had are was were will would could should can cannot can't i'll i'm it's its you your yours our ours we they them their there here what when where which who why how not but all any " +
    "get got set put let make made just now then than into onto out off over about after before again also only very more most some such each other same been being does did doing done dont don't isn't wasn't won't " +
    "okay yes yeah sure thanks thank please today tomorrow tonight week next end day monday tuesday wednesday thursday friday morning afternoon evening " +
    "look looking check checking take taking send sending fix fixing work working add adding update updating need needs needed want see seen know think").split(/\s+/),
);

/** The words worth matching in a text: lower case, letters or digits, 3 or more characters, stopwords dropped. */
export function wordsOf(text: string): string[] {
  return [...spelled(text).keys()];
}
/** Each matchable word (its stem) with how it was first written, for the reason. */
function spelled(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    if (!out.has(stem(raw))) out.set(stem(raw), raw);
  }
  return out;
}
/** A plain plural or -ing/-ed ending off, so "exports" meets "export". */
const stem = (w: string) => (/\d/.test(w) || w.length < 5 ? w : w.replace(/(ing|ed|es|s)$/, ""));

/** Item ids written as #123 in the texts. */
export function idsIn(texts: readonly string[]): number[] {
  const out: number[] = [];
  for (const t of texts) for (const m of t.matchAll(/#(\d{1,9})\b/g)) out.push(Number(m[1]));
  return [...new Set(out)];
}

export type LikelyItem = { id: number; title: string; type: string; state: string; url: string; tier: "feature" | "epic" | null; mine: boolean; reason: string };

/**
 * The likely items: `texts` are the promise's what, its own messages and its neighbours (or its conversation's);
 * `items` are one client's open items. `query` (typed) narrows to titles with every typed word, or one #id.
 */
export function likelyItems(o: { texts: readonly string[]; items: readonly WorkItem[]; myEmail: string | null; suggestedId?: number | null; query?: string; max?: number }): LikelyItem[] {
  const q = (o.query ?? "").trim().toLowerCase();
  const qId = /^#?\d+$/.test(q) ? Number(q.replace(/^#/, "")) : null;
  const qWords = qId === null ? q.split(/\s+/).filter(Boolean) : [];
  const said = spelled(o.texts.join("\n"));
  const words = [...said.keys()];
  const named = new Set(idsIn(o.texts));
  const isMine = (i: WorkItem) => !!i.assignedToMe || (!!o.myEmail && !!i.assignedToEmail && i.assignedToEmail.toLowerCase() === o.myEmail.toLowerCase());
  const scored = o.items
    .filter((i) => (qId !== null ? i.id === qId : qWords.every((w) => i.title.toLowerCase().includes(w))))
    .map((i) => {
      const title = new Set(wordsOf(i.title));
      const hits = words.filter((w) => title.has(w));
      const pointed = named.has(i.id) ? "named" : o.suggestedId === i.id ? "suggested" : null;
      return { i, hits, pointed, mine: isMine(i) };
    })
    // Without a query, only items the texts point at or share a word with; my items fill in when nothing matches.
    .filter((x) => q || x.pointed || x.hits.length);
  const pool = q || scored.length ? scored : o.items.filter(isMine).map((i) => ({ i, hits: [] as string[], pointed: null, mine: true }));
  return pool
    .sort((a, b) => Number(!!b.pointed) - Number(!!a.pointed) || Number(b.mine) - Number(a.mine) || b.hits.length - a.hits.length || (b.i.changedAt ?? "").localeCompare(a.i.changedAt ?? "") || a.i.id - b.i.id)
    .slice(0, o.max ?? LIKELY_MAX)
    .map(({ i, hits, pointed, mine }) => ({ id: i.id, title: i.title, type: i.type, state: i.state, url: i.url, tier: i.tier ?? null, mine, reason: reasonOf(i.id, hits.map((h) => said.get(h) ?? h), pointed, mine) }));
}

function reasonOf(id: number, hits: readonly string[], pointed: string | null, mine: boolean): string {
  const parts: string[] = [];
  if (pointed === "named") parts.push(`Mentioned as #${id}`);
  else if (pointed === "suggested") parts.push("Likely for this conversation");
  if (mine) parts.push("Assigned to you");
  if (hits.length) parts.push(`matches ${hits.slice(0, 3).join(", ")}`);
  if (!parts.length) return "Matches your search";
  const s = parts.join(" · ");
  return s[0]!.toUpperCase() + s.slice(1);
}
