// The to-dos that serve one of this week's musts (their item, or its parent feature): Timebox my day places them first
// and Plan today's trim spares them. Pure.
import type { WorkItem } from "../week/types.ts";
import type { Pick } from "./types.ts";

type WeekMust = { tier: string; clientKey: string; itemId: number };

export function mustPicks(picks: readonly Pick[], weekFeatures: readonly WeekMust[], work: ReadonlyMap<string, { items: readonly WorkItem[] }>): Set<number> {
  const musts = new Set(weekFeatures.filter((f) => f.tier === "must").map((f) => `${f.clientKey}:${f.itemId}`));
  const out = new Set<number>();
  for (const p of picks) {
    if (p.itemId === null) continue;
    const parent = work.get(p.clientKey)?.items.find((i) => i.id === p.itemId)?.parentId ?? null;
    if (musts.has(`${p.clientKey}:${p.itemId}`) || (parent !== null && musts.has(`${p.clientKey}:${parent}`))) out.add(p.id);
  }
  return out;
}
