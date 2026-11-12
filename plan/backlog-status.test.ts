// BL-1: the Grid's one Status chip per row, and the tree's sibling order.
import { describe, expect, it } from "vitest";
import { siblingOrder } from "./ahead-model.ts";
import { statusOf, statusWords } from "./backlog-status.ts";

const health = (state: Parameters<typeof statusOf>[0]["health"] extends infer H ? (H extends { state: infer S } ? S : never) : never, reason = "the reason") => ({ state, reason });

describe("BL-1: one status per row", () => {
  it("a closed item has none; an open one with nothing to say has none", () => {
    expect(statusOf({ open: false, health: health("blocked"), gaps: ["unsized"], stale: null })).toEqual({ main: null, more: [] });
    expect(statusOf({ open: true, health: null, gaps: [], stale: null })).toEqual({ main: null, more: [] });
  });
  it("health first when it asks for something, then gaps in order (Needs stories, No target date, Unassigned, Unsized, Stale)", () => {
    const s = statusOf({ open: true, health: health("at_risk", "9 stories open"), gaps: ["unsized", "unassigned"], stale: "8 weeks" });
    expect(s.main?.text).toBe("At risk");
    expect(s.more.map((r) => r.text)).toEqual(["Unassigned", "Unsized", "Stale"]);
    expect(statusOf({ open: true, health: null, gaps: ["unsized", "needs_stories", "no_dates"], stale: null }).main?.text).toBe("Needs stories");
  });
  it("a calm health (On track, Done) goes after the gaps: a row never leads with On track while it has something to fix", () => {
    const s = statusOf({ open: true, health: health("on_track"), gaps: ["unassigned"], stale: null });
    expect(s.main?.text).toBe("Unassigned");
    expect(s.more.map((r) => [r.text, r.action])).toEqual([["On track", false]]);
    expect(statusOf({ open: true, health: health("on_track"), gaps: [], stale: null }).main).toMatchObject({ text: "On track", action: false });
  });
  it("never two reasons that mean one thing: the health wins over the gap it repeats", () => {
    const pairs = [
      ["needs_date", "no_dates"],
      ["not_scoped", "needs_stories"],
    ] as const;
    for (const [state, gap] of pairs) {
      const s = statusOf({ open: true, health: health(state), gaps: [gap], stale: null });
      expect(s.more, state).toEqual([]);
    }
    expect(statusOf({ open: true, health: health("stalled"), gaps: [], stale: "8 weeks" }).more).toEqual([]);
    const all = statusOf({ open: true, health: health("watch"), gaps: ["needs_stories", "no_dates", "unassigned", "unsized"], stale: "6 weeks" });
    const texts = [all.main!, ...all.more].map((r) => r.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
  it("each reason reads as a sentence for the tooltip and a screen reader", () => {
    const s = statusOf({ open: true, health: health("blocked", "a blocker on #12"), gaps: ["unassigned"], stale: "8 weeks" });
    expect(statusWords(s)).toBe("Blocked: a blocker on #12; Unassigned: Assign; Stale: no change in DevOps for 8 weeks");
    expect(statusWords({ main: null, more: [] })).toBe("nothing to fix");
  });
});

describe("BL-1: siblings in the backlog's order", () => {
  const sort = (xs: { id: number; order: number | null; target: string | null }[], byOrder: boolean) => [...xs].sort((a, b) => siblingOrder(a, b, byOrder)).map((x) => x.id);
  const xs = [
    { id: 3, order: null, target: "2026-11-10" },
    { id: 1, order: 20, target: null },
    { id: 2, order: 10, target: "2026-12-01" },
    { id: 4, order: null, target: null },
  ];
  it("by the order field, unset last (then by target date, then id)", () => {
    expect(sort(xs, true)).toEqual([2, 1, 3, 4]);
  });
  it("a project with no order field: by target date, undated last, then id", () => {
    expect(sort(xs, false)).toEqual([3, 2, 1, 4]);
  });
});
