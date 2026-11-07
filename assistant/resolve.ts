// AS-2: find what my words point at, on the server, across my own clients: to-dos, DevOps items and features, by
// title, #id or parent feature ("the stories under the Freshness Alert feature" are my to-dos whose item's parent is
// that feature). The model never sees another client's titles to do this; the server matches and only then, with one
// client, does that client's request go to the AI. Conservative: a title counts only when it appears whole in my words
// (two words or more), an item named after "the story for …" only when one item fits, and two that fit equally are
// never chosen between: they come back as `ambiguous` for the assistant to ask. Pure.
import type { AheadItem } from "../actions/types.ts";
import { tierOf } from "../plan/ahead-model.ts";
import type { Pick } from "../plan/types.ts";

export type ResolveClient = { clientKey: string; items: readonly AheadItem[] };
export type MatchedItem = { clientKey: string; id: number; title: string; type: string; tier: "epic" | "feature" | "story" | null };
export type MatchedPick = { pick: Pick; feature: { id: number; title: string } | null };

export type Resolved = {
  /** To-dos my words point at: by their own title, their item's #id, or their item's parent feature or epic. */
  picks: MatchedPick[];
  /** Items my words point at (by #id or title), features included. */
  items: MatchedItem[];
  /** The clients of everything matched, in first-seen order. */
  clients: string[];
  /** Two or more items fit one phrase equally: ask, never guess. */
  ambiguous: { phrase: string; options: MatchedItem[] } | null;
};

const norm = (s: string) => ` ${s.toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
const words = (s: string) => norm(s).trim().split(" ").filter(Boolean);
/** A title appears whole in the text (word boundaries, case and punctuation ignored), and is specific enough. */
const whole = (text: string, title: string) => words(title).length >= 2 && norm(text).includes(norm(title));
const idsIn = (text: string) => [...text.matchAll(/(?<![\w.,$€£/:-])#?(\d{2,})(?![\w%]|[.,/:-]\d)/g)].map((m) => Number(m[1]));

/** "the user story for XYZ", "the feature called Data export": the words after it, up to the next clause. */
function namedPhrases(text: string): string[] {
  const out: string[] = [];
  const re = /\b(?:user stor(?:y|ies)|stor(?:y|ies)|feature|epic|bug|task|item|to-?do|pick)\s+(?:for|about|called|named|on)\s+["“]?(.{2,80}?)["”]?(?=\s+(?:as|and|to|is|so|with|because)\b|[.,;!?]|$)/giu;
  for (const m of text.matchAll(re)) if (m[1]) out.push(m[1].trim());
  for (const m of text.matchAll(/["“]([^"”]{3,80})["”]/gu)) if (m[1]) out.push(m[1].trim());
  return out;
}

export function resolve(text: string, clients: readonly ResolveClient[], picks: readonly Pick[], isMine: (k: string) => boolean): Resolved {
  const mineClients = clients.filter((c) => isMine(c.clientKey));
  const all = mineClients.flatMap((c) => c.items.map((item) => ({ clientKey: c.clientKey, item })));
  const itemView = (x: { clientKey: string; item: AheadItem }): MatchedItem => ({ clientKey: x.clientKey, id: x.item.id, title: x.item.title, type: x.item.type, tier: tierOf(x.item) });
  const items = new Map<string, MatchedItem>();
  const add = (m: MatchedItem) => items.set(`${m.clientKey}:${m.id}`, m);
  let ambiguous: Resolved["ambiguous"] = null;

  // 1. #ids (and bare numbers of two digits or more) that are one of my clients' items.
  for (const id of idsIn(text)) for (const x of all.filter((a) => a.item.id === id)) add(itemView(x));
  // 2. Whole titles of my items (features and epics included).
  const titled = all.filter((x) => whole(text, x.item.title));
  // A longer title wins over one it contains ("Freshness alert rules" over "Freshness alert").
  for (const x of titled) if (!titled.some((y) => y !== x && norm(y.item.title).includes(norm(x.item.title)) && norm(y.item.title) !== norm(x.item.title))) add(itemView(x));
  // 3. "the story for XYZ": one item whose title has those words; two or more is a question.
  for (const phrase of namedPhrases(text)) {
    const p = norm(phrase);
    if (p.trim().length < 3) continue;
    const exact = all.filter((x) => norm(x.item.title) === p);
    const fits = exact.length ? exact : all.filter((x) => norm(x.item.title).includes(p));
    const fresh = fits.filter((x) => !items.has(`${x.clientKey}:${x.item.id}`));
    if (fits.length === 1) add(itemView(fits[0]!));
    else if (fresh.length > 1 && !ambiguous) ambiguous = { phrase, options: fits.slice(0, 6).map(itemView) };
  }
  // Same title on two items of one client (or two clients) is a question too.
  const byTitle = new Map<string, MatchedItem[]>();
  for (const m of items.values()) byTitle.set(norm(m.title), [...(byTitle.get(norm(m.title)) ?? []), m]);
  for (const [, ms] of byTitle) if (ms.length > 1 && !ambiguous && !idsIn(text).includes(ms[0]!.id)) ambiguous = { phrase: ms[0]!.title, options: ms };

  // To-dos: an item matched directly, a parent feature or epic matched, or the to-do's own title in my words.
  const parentOf = new Map(all.map((x) => [`${x.clientKey}:${x.item.id}`, x.item.parentId]));
  const titleOf = new Map(all.map((x) => [`${x.clientKey}:${x.item.id}`, x.item.title]));
  const feats = [...items.values()].filter((m) => m.tier === "feature" || m.tier === "epic");
  const matchedPicks: MatchedPick[] = [];
  for (const p of picks) {
    if (!isMine(p.clientKey) || (p.status !== "planned" && p.status !== "done")) continue;
    const key = p.itemId === null ? null : `${p.clientKey}:${p.itemId}`;
    const parent = key ? (parentOf.get(key) ?? null) : null;
    const grand = parent !== null ? (parentOf.get(`${p.clientKey}:${parent}`) ?? null) : null;
    const feature = feats.find((f) => f.clientKey === p.clientKey && (f.id === parent || f.id === grand || f.id === p.itemId)) ?? null;
    const direct = key !== null && items.has(key);
    if (feature || direct || whole(text, p.title)) {
      const fid = feature?.id ?? (parent !== null ? parent : null);
      matchedPicks.push({ pick: p, feature: fid !== null ? { id: fid, title: titleOf.get(`${p.clientKey}:${fid}`) ?? "" } : null });
    }
  }
  const clients2: string[] = [];
  for (const k of [...[...items.values()].map((m) => m.clientKey), ...matchedPicks.map((m) => m.pick.clientKey)]) if (!clients2.includes(k)) clients2.push(k);
  return { picks: matchedPicks, items: [...items.values()], clients: clients2, ambiguous };
}
