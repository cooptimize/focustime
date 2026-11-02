// U2: one block's rows on Today in time order. Meetings at their start; a timed pick at its timebox; a done pick at
// the block's start (it happened); each untimed planned pick, in plan order, where it would go if worked in turn
// through the free time from now on. Pure: the UI passes the block's free gaps, the clock and the sizes.
import type { FreeGap } from "../week/types.ts";

export type RowPick = { id: number; status: string; size: string; position: number };
export type BlockRow<E, P> = { kind: "event"; at: number; event: E } | { kind: "pick"; at: number; pick: P };

const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;

export function blockRows<E extends { start: string }, P extends RowPick>(
  events: readonly E[],
  picks: readonly P[],
  o: { start: string; end: string; freeGaps: readonly FreeGap[]; now: string; sizes: Readonly<Record<string, number>>; boxStart: (pickId: number) => string | null },
): BlockRow<E, P>[] {
  const rows: BlockRow<E, P>[] = events.map((e) => ({ kind: "event", at: ms(e.start), event: e }));
  const from = Math.max(ms(o.start), ms(o.now));
  // The free time from now on, as [start, end] stretches, walked in order by the untimed picks.
  const gaps = o.freeGaps.map((g) => [Math.max(ms(g.start), from), ms(g.end)] as [number, number]).filter(([a, b]) => b > a);
  let gi = 0;
  let cursor = gaps[0]?.[0] ?? ms(o.end);
  const ordered = [...picks].sort((a, b) => a.position - b.position);
  for (const p of ordered) {
    const box = o.boxStart(p.id);
    if (box) {
      rows.push({ kind: "pick", at: ms(box), pick: p });
      continue;
    }
    if (p.status !== "planned") {
      rows.push({ kind: "pick", at: ms(o.start), pick: p });
      continue;
    }
    // Skip to the next gap once this one has no room left.
    while (gi < gaps.length && cursor >= gaps[gi]![1]) {
      gi++;
      cursor = gaps[gi]?.[0] ?? ms(o.end);
    }
    rows.push({ kind: "pick", at: gi < gaps.length ? cursor : ms(o.end), pick: p });
    cursor += (o.sizes[p.size] ?? 60) * 60_000;
  }
  // Same time: a meeting first (it is fixed), then picks in plan order.
  return rows.sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1) || (a.kind === "pick" && b.kind === "pick" ? a.pick.position - b.pick.position : 0));
}
