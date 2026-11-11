// WP-1: builders for DevOps patterns tests: a fictional client's DevOps project (raw work items with history), a fake
// reader over it that counts its requests, and a stub AI answer that labels every item it is sent. Fictional names only.
import type { PatternsReader } from "../../actions/patterns-run.ts";
import type { ProcessFacts, RawUpdate } from "../../plan/patterns/inventory.ts";
import type { ProviderCall, ProviderReply } from "../../ai/types.ts";

export type RawItem = { id: number; fields: Record<string, unknown>; updates?: RawUpdate[] };

let seq = 1000;
/** One raw work item as the batch call returns it. `desc` and `ac` are HTML, like DevOps's. */
export function aRawItem(o: { id?: number; type?: string; state?: string; title?: string; parent?: number | null; created?: string; activated?: string | null; closed?: string | null; desc?: string; ac?: string; tags?: string; comments?: number; points?: number | null; rev?: number; updates?: RawUpdate[] } = {}): RawItem {
  const id = o.id ?? ++seq;
  const fields: Record<string, unknown> = {
    "System.Id": id,
    "System.Rev": o.rev ?? 3,
    "System.WorkItemType": o.type ?? "Story",
    "System.State": o.state ?? "New",
    "System.Title": o.title ?? `Add the sample field ${id}`,
    "System.CreatedDate": o.created ?? "2026-03-10T15:00:00Z",
    "System.CommentCount": o.comments ?? 0,
  };
  if (o.parent) fields["System.Parent"] = o.parent;
  if (o.activated) fields["Microsoft.VSTS.Common.ActivatedDate"] = o.activated;
  if (o.closed) fields["Microsoft.VSTS.Common.ClosedDate"] = o.closed;
  if (o.desc) fields["System.Description"] = o.desc;
  if (o.ac) fields["Microsoft.VSTS.Common.AcceptanceCriteria"] = o.ac;
  if (o.tags) fields["System.Tags"] = o.tags;
  if (o.points !== undefined && o.points !== null) fields["Microsoft.VSTS.Scheduling.StoryPoints"] = o.points;
  return { id, fields, ...(o.updates ? { updates: o.updates } : {}) };
}

/** A process where "Done" and "Closed" are closed and "New" isn't started (any type). */
export const aProcess = (o: Partial<ProcessFacts> = {}): ProcessFacts => ({
  closed: (_t, s) => s === "Done" || s === "Closed" || s === "Removed",
  proposed: (_t, s) => s === "New" || s === "To Do",
  estimateFields: ["Microsoft.VSTS.Scheduling.StoryPoints"],
  ...o,
});

export type FakeReader = PatternsReader & {
  calls: { op: string; client: string }[];
  /** Items read by id (batch), per client. */
  read: Map<string, number[]>;
  /** What wait() answers next (null: go). */
  waitWith: (client: string) => string | null;
  /** Make a client's next request fail (once, or always). */
  failWith: Map<string, Error>;
  /** Called before each request (a test can stop the "server" there). */
  before?: (op: string, client: string) => void | Promise<void>;
};

/** A fake DevOps over fictional projects: WIQL by created month, the oldest item, batch reads and updates. */
export function fakePatternsReader(projects: Record<string, RawItem[]>, o: { process?: ProcessFacts } = {}): FakeReader {
  const calls: { op: string; client: string }[] = [];
  const read = new Map<string, number[]>();
  const failWith = new Map<string, Error>();
  const r: FakeReader = {
    calls,
    read,
    failWith,
    waitWith: () => null,
    clients: async () => Object.keys(projects),
    async process(k) {
      await hit("process", k);
      return o.process ?? aProcess();
    },
    async ids(k, wiql, top) {
      await hit("ids", k);
      const items = projects[k] ?? [];
      const created = (i: RawItem) => String(i.fields["System.CreatedDate"]);
      const range = /\[System\.CreatedDate\] >= '([^']+)' AND \[System\.CreatedDate\] < '([^']+)'/.exec(wiql);
      if (range) return items.filter((i) => created(i) >= range[1]! && created(i) < range[2]!).map((i) => i.id).slice(0, top);
      if (/ORDER BY \[System\.CreatedDate\] ASC/.test(wiql)) return [...items].sort((a, b) => created(a).localeCompare(created(b))).map((i) => i.id).slice(0, top);
      return [];
    },
    async batch(k, ids, fields) {
      await hit("batch", k);
      read.set(k, [...(read.get(k) ?? []), ...ids]);
      const want = new Set(fields);
      return (projects[k] ?? []).filter((i) => ids.includes(i.id)).map((i) => ({ id: i.id, fields: Object.fromEntries(Object.entries(i.fields).filter(([f]) => want.has(f))) }));
    },
    async updates(k, id) {
      await hit("updates", k);
      return (projects[k] ?? []).find((i) => i.id === id)?.updates ?? [];
    },
    async wait(k) {
      return r.waitWith(k);
    },
  };
  async function hit(op: string, client: string) {
    await r.before?.(op, client);
    calls.push({ op, client });
    const e = failWith.get(client);
    if (e) throw e;
  }
  return r;
}

/**
 * A small fictional client: a two-level process ("Initiative" over "Piece" over "Step"), some written up, some not,
 * one closed item whose description was written after work started. Ids from `base`.
 */
export function aSmallProject(base: number, o: { created?: string } = {}): RawItem[] {
  const c = o.created ?? "2026-03-10T15:00:00Z";
  const top = aRawItem({ id: base, type: "Initiative", title: "Sales reporting", created: c, desc: "<p>Build the sales area end to end for the planning team.</p>" });
  const mid1 = aRawItem({ id: base + 1, type: "Piece", parent: base, title: "Add the orders fact", created: c, desc: "<div>Load orders daily from the order system into a fact table.</div>", ac: "<ul><li>Row counts match</li></ul>", points: 3, tags: "data; model" });
  const mid2 = aRawItem({ id: base + 2, type: "Piece", parent: base, title: "Margin report", created: c });
  const s1 = aRawItem({ id: base + 3, type: "Step", parent: base + 1, title: "Map the source columns", created: c, state: "Done", activated: "2026-03-11T15:00:00Z", closed: "2026-03-13T15:00:00Z", updates: [
    { rev: 1, fields: { "System.State": { newValue: "New" } } },
    { rev: 2, fields: { "System.State": { oldValue: "New", newValue: "Active" } } },
    { rev: 3, fields: { "System.Description": { newValue: "<p>Columns listed after the work.</p>" } } },
    { rev: 4, fields: { "System.State": { oldValue: "Active", newValue: "Done" } } },
  ] });
  const s2 = aRawItem({ id: base + 4, type: "Step", parent: base + 1, title: "Load the table", created: c, state: "Done", activated: "2026-03-10T16:00:00Z", closed: "2026-03-10T20:00:00Z", updates: [
    { rev: 1, fields: { "System.State": { newValue: "Active" } } },
    { rev: 2, fields: { "System.State": { oldValue: "Active", newValue: "Done" } } },
  ] });
  const loose = aRawItem({ id: base + 5, type: "Step", title: "Why is the total off?", created: c });
  return [top, mid1, mid2, s1, s2, loose];
}

/** The stub provider's answer for patterns tasks: every ref labeled (a type from the list, or "other" by `other`). */
export function patternsAnswer(o: { other?: (ref: string) => boolean; requestType?: string; layers?: string[]; otherName?: string; otherMeaning?: string } = {}) {
  return (c: ProviderCall): string | ProviderReply => {
    if (c.schemaName === "patterns_merge") {
      const input = JSON.parse(c.input) as { current: { name: string; meaning: string }[]; suggestions: { name: string }[] };
      const keep = input.current.filter((t) => t.name !== "other").map((t) => ({ name: t.name, meaning: t.meaning, example: "A made-up request" }));
      const added = input.suggestions.slice(0, 1).map((s) => ({ name: `${s.name} work`, meaning: "Work the first list didn't name", example: "Tidy the planning folder" }));
      return JSON.stringify({ types: [...keep, ...added], changes: added.map((a) => ({ kind: "add", from: input.suggestions.slice(0, 1).map((s) => s.name), to: [a.name], reason: "Suggested more than once" })) });
    }
    if (c.schemaName !== "patterns_classify") return "{}";
    const input = JSON.parse(c.input) as { items: { ref: string }[] };
    return JSON.stringify({
      items: input.items.map((it) => {
        const other = o.other?.(it.ref) ?? false;
        return { ref: it.ref, request_type: other ? "other" : (o.requestType ?? "new report"), other_name: other ? (o.otherName ?? "housekeeping") : null, other_meaning: other ? (o.otherMeaning ?? "Tidying up folders and names") : null, layers: o.layers ?? ["fact", "report"], readiness: "needs discovery first", missing: ["grain"], confidence: "medium" };
      }),
    });
  };
}
