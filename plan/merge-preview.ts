// IB-1 slice 4: the before → after of Merge into… (CV-2's merge, shown in the Inbox's detail pane before it runs).
// Pure. It mirrors what the store's merge does (store/conversation-store.ts `merge`): every message, commitment and
// suggestion of the absorbed conversation moves into the one that stays; people are joined; the item comes along only
// when the one that stays has none; the summary is written again. Counts and names only, never message text.

/** One side of a merge, as the store has it now. */
export type MergeSide = {
  id: number;
  title: string;
  messages: number;
  commitments: number;
  suggestions: number;
  people: string[];
  item: { id: number; title: string | null } | null;
};

/** What happens to the linked items. */
export type MergeItem =
  /** Neither has one. */
  | { kind: "none" }
  /** The one that stays keeps its own; the absorbed one had none. */
  | { kind: "kept"; item: { id: number; title: string | null } }
  /** The one that stays had none: the absorbed one's comes along. */
  | { kind: "carried"; item: { id: number; title: string | null } }
  /** Both had one: the one that stays keeps its own; the other stays in DevOps, no longer linked here (Undo links it back). */
  | { kind: "both"; item: { id: number; title: string | null }; left: { id: number; title: string | null } };

export type MergePreview = {
  /** The conversation that is absorbed (listed no more; kept for Undo). */
  from: MergeSide;
  /** The conversation that stays. */
  into: MergeSide;
  after: { id: number; title: string; messages: number; commitments: number; suggestions: number; people: string[]; added: string[]; item: MergeItem };
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function mergePreview(from: MergeSide, into: MergeSide): MergePreview {
  const added = from.people.filter((p) => !into.people.some((q) => same(p, q)));
  const item: MergeItem =
    into.item && from.item && into.item.id !== from.item.id ? { kind: "both", item: into.item, left: from.item }
    : into.item ? { kind: "kept", item: into.item }
    : from.item ? { kind: "carried", item: from.item }
    : { kind: "none" };
  return {
    from,
    into,
    after: {
      id: into.id,
      title: into.title,
      messages: into.messages + from.messages,
      commitments: into.commitments + from.commitments,
      suggestions: into.suggestions + from.suggestions,
      people: [...into.people, ...added],
      added,
      item,
    },
  };
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** "3 messages, 1 commitment" (suggestions only when there are some). */
export function contentsLine(s: Pick<MergeSide, "messages" | "commitments" | "suggestions">): string {
  return [n(s.messages, "message"), n(s.commitments, "commitment"), ...(s.suggestions ? [n(s.suggestions, "suggestion")] : [])].join(", ");
}

/** The lines under "What moves": plain words, one per kind of thing, then the item. */
export function movesLines(p: MergePreview): string[] {
  const f = p.from;
  const out = [`${n(f.messages, "message")} move into "${p.into.title}"`];
  if (f.commitments) out.push(`${n(f.commitments, "commitment")} ${f.commitments === 1 ? "moves" : "move"} with ${f.commitments === 1 ? "it" : "them"}, with ${f.commitments === 1 ? "its" : "their"} items and due dates`);
  if (f.suggestions) out.push(`${n(f.suggestions, "suggested update")} ${f.suggestions === 1 ? "moves" : "move"} too`);
  if (p.after.added.length) out.push(`${p.after.added.join(", ")} ${p.after.added.length === 1 ? "joins" : "join"} the people on it`);
  const i = p.after.item;
  if (i.kind === "carried") out.push(`#${i.item.id} comes along: "${p.into.title}" had no linked item`);
  else if (i.kind === "kept") out.push(`#${i.item.id} stays its linked item`);
  else if (i.kind === "both") out.push(`#${i.item.id} stays its linked item. #${i.left.id} stays in DevOps but is no longer linked here; Undo links it back`);
  else out.push("Neither has a linked item");
  out.push("The summary is written again");
  return out;
}
