// RB-3b: which words in "Where is it?" were picked, and from which client's code, while the New form or the draft
// editor is open. Pure: no I/O. The form keeps these in its memory only (ui/where-picks.ts); nothing of them is saved,
// sent or kept after it closes, and a pick is still only text in the box. When the form's client changes, each pick
// still in the box as it was written is taken out, the words the person typed stay, and Undo puts them back.

/** One pick: where its words start in the box, the words, and the client whose code they came from. */
export type WherePick = { start: number; text: string; client: string; clientName: string };

/** What a take-out removed, to put back on Undo: where in the box it was (after the take-out) and the exact text. */
export type TakenOut = { at: number; removed: string; /** Where the pick's own words start inside `removed`. */ offset: number; pick: WherePick };

/** The one changed stretch between two texts: [start, end) of `before` became [start, start + inserted) of `after`. */
function changeOf(before: string, after: string): { start: number; end: number; delta: number } | null {
  if (before === after) return null;
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return { start: p, end: before.length - s, delta: after.length - before.length };
}

const at = (text: string, p: WherePick, start = p.start) => text.slice(start, start + p.text.length) === p.text;

/**
 * The picks after the box's text changed from `before` to `after` (typing, a paste, a pick, Backspace). A pick before
 * or after the change moves with it; one the change reaches into has been edited and is no longer a pick. Where the
 * change could be read either side of a pick (the same letter repeated), the pick stays only if its words are still
 * there, whole.
 */
export function picksAfterEdit(picks: readonly WherePick[], before: string, after: string): WherePick[] {
  const c = changeOf(before, after);
  if (!c) return [...picks];
  const out: WherePick[] = [];
  for (const p of picks) {
    const end = p.start + p.text.length;
    if (end <= c.start) out.push(p);
    else if (p.start >= c.end) out.push({ ...p, start: p.start + c.delta });
    else if (at(after, p)) out.push(p);
    else if (at(after, p, p.start + c.delta)) out.push({ ...p, start: p.start + c.delta });
  }
  return out.filter((p) => at(after, p));
}

/** A spot in the box (an Undo's place) after the same change: it moves with the text, or to where the change starts. */
export function spotAfterEdit(spot: number, before: string, after: string): number {
  const c = changeOf(before, after);
  if (!c || spot <= c.start) return spot;
  if (spot >= c.end) return spot + c.delta;
  return c.start;
}

/**
 * Takes out every pick from another client's code that is still in the box as it was written, keeping the typed words
 * and one space between them ("The X totals" → "The totals"). Returns the new text, the picks that stay (from this
 * client), and what was taken out (for Undo), or null when nothing was.
 */
export function takeOut(text: string, picks: readonly WherePick[], client: string | null): { text: string; kept: WherePick[]; taken: TakenOut[] } | null {
  const going = picks.filter((p) => p.client !== client && at(text, p)).sort((a, b) => b.start - a.start);
  if (!going.length) return null;
  let t = text;
  let kept = picks.filter((p) => !going.includes(p) && at(text, p));
  const taken: TakenOut[] = [];
  for (const p of going) {
    let a = p.start;
    let b = p.start + p.text.length;
    const left = t.slice(0, a);
    const right = t.slice(b);
    // One space goes with the pick: the one after it, or before it when it ends the text or comes before punctuation.
    if (/ $/.test(left) && /^ /.test(right)) b++;
    else if (/ $/.test(left) && (right === "" || /^[,.;:)]/.test(right))) a--;
    else if (left === "" && /^ /.test(right)) b++;
    const removed = t.slice(a, b);
    t = t.slice(0, a) + t.slice(b);
    kept = kept.map((k) => (k.start >= b ? { ...k, start: k.start - removed.length } : k));
    // Earlier take-outs sit after this one: they move back by what this one removed.
    for (const x of taken) x.at -= removed.length;
    taken.push({ at: a, removed, offset: p.start - a, pick: p });
  }
  return { text: t, kept, taken: taken.sort((x, y) => x.at - y.at) };
}

/** Undo: puts back what was taken out, at the places it was (moved as the text was edited since), with its picks. */
export function putBack(text: string, picks: readonly WherePick[], taken: readonly TakenOut[]): { text: string; picks: WherePick[] } {
  let t = text;
  let offset = 0;
  let now = [...picks];
  const back: WherePick[] = [];
  for (const x of [...taken].sort((a, b) => a.at - b.at)) {
    const pos = Math.min(Math.max(0, x.at + offset), t.length);
    t = t.slice(0, pos) + x.removed + t.slice(pos);
    now = now.map((k) => (k.start >= pos ? { ...k, start: k.start + x.removed.length } : k));
    for (const b of back) if (b.start >= pos) b.start += x.removed.length;
    back.push({ ...x.pick, start: pos + x.offset });
    offset += x.removed.length;
  }
  return { text: t, picks: [...now, ...back].sort((a, b) => a.start - b.start) };
}

/** "Northwind's", or "Northwind's and Atlas's" when the picks came from two clients' code. */
const owners = (names: readonly string[]) => [...new Set(names)].map((n) => `${n}'s`).join(" and ");
const count = (n: number) => (n === 1 ? "1 name" : `${n.toLocaleString("en-US")} names`);

/** RB-3b: the words for a client change (docs/design/wording.md, "Where is it?"). */
export const PICKS_TEXT = {
  takenOut: (n: number, from: readonly string[]) => `Took out ${count(n)} picked from ${owners(from)} code.`,
  undo: "Undo",
  undoLabel: (n: number) => `Undo: put back the ${n === 1 ? "name" : `${n.toLocaleString("en-US")} names`}`,
  putBack: (n: number, from: readonly string[], to: string) => `Put back ${count(n)}. ${n === 1 ? "It's" : "They're"} from ${owners(from)} code, not ${to}'s.`,
} as const;
