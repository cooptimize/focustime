// The shared work item lookup (step 15.2): wherever a DevOps item is named (flex session, follow-up, Needs help
// from…), one search of the chosen client's loaded items by title or #id. Pure: ranking only; nothing is fetched.
import type { WorkItem } from "../week/types.ts";

type Pool = { items: readonly WorkItem[]; children: readonly WorkItem[]; committed?: readonly WorkItem[] };

/** "#123" or "123" as an id, or null for anything else. */
export function parseItemRef(text: string): number | null {
  const m = /^\s*#?(\d{1,9})\s*$/.exec(text);
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : null;
}

/**
 * Items matching the query (title, any case; or "#id"/"id" as a prefix of the id, an exact id first), this week's
 * priorities first, then my assigned items, then the rest (children of my features, committed features), each once.
 */
export function lookupItems(query: string, work: Pool | undefined, priorities: ReadonlySet<number>, limit = 8): WorkItem[] {
  if (!work) return [];
  const seen = new Set<number>();
  const pool: { item: WorkItem; rank: number }[] = [];
  for (const [list, rank] of [[work.items, 1], [work.children, 2], [work.committed ?? [], 2]] as const)
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      pool.push({ item, rank: priorities.has(item.id) ? 0 : rank });
    }
  const q = query.trim().toLowerCase();
  const idq = /^#?\d+$/.test(q) ? q.replace(/^#/, "") : null;
  const hit = (i: WorkItem) => (!q ? true : idq !== null ? String(i.id).startsWith(idq) : i.title.toLowerCase().includes(q));
  const exact = (i: WorkItem) => (idq !== null && String(i.id) === idq ? 0 : 1);
  return pool
    .map((x, n) => ({ ...x, n }))
    .filter((x) => hit(x.item))
    .sort((a, b) => exact(a.item) - exact(b.item) || a.rank - b.rank || a.n - b.n)
    .slice(0, limit)
    .map((x) => x.item);
}
