import { describe, expect, it } from "vitest";
import type { Pick } from "./types.ts";
import { addTargets, type TargetBlock } from "./addtargets.ts";

const blk = (date: string, half: "AM" | "PM" | "EVE", focusClient: string | null, over: Partial<TargetBlock> = {}): TargetBlock => ({ date, half, focusClient, flexClients: [], overflow: false, pto: false, off: false, freeMinutes: 120, ...over });
const pick = (id: number, date: string, half: "AM" | "PM", itemId: number, status: Pick["status"] = "planned"): Pick =>
  ({ id, date, half, clientKey: "nw", kind: "item", itemId, draftId: null, followUpId: null, title: `Item ${itemId}`, itemType: "User Story", itemUrl: null, size: "M", status, carriedFromDate: null, notes: null, position: id }) as unknown as Pick;

// Mon Nov 2 to Fri Nov 6; Thursday is a day off.
const week: TargetBlock[] = [
  blk("2026-11-02", "AM", "coop"),
  blk("2026-11-02", "PM", "nw"),
  blk("2026-11-03", "AM", null),
  blk("2026-11-03", "PM", "hh"),
  blk("2026-11-04", "AM", "nw"),
  blk("2026-11-04", "PM", "nw", { freeMinutes: 0 }),
  blk("2026-11-05", "AM", null, { pto: true, off: true }),
  blk("2026-11-05", "PM", null, { pto: true, off: true }),
  blk("2026-11-06", "AM", null, { overflow: true }),
  blk("2026-11-06", "PM", null, { overflow: true, off: true }),
];
const base = { blocks: week, clientKey: "nw", planDate: "2026-11-02", selected: null, today: "2026-11-02", picks: [] as Pick[], ref: { clientKey: "nw", itemId: 7 } };
const keys = (t: ReturnType<typeof addTargets>) => t.map((x) => `${x.date.slice(8)}${x.half}:${x.group}${x.disabled ? `!${x.disabled}` : ""}`);

describe("addTargets (where ⋯ → Add to the plan can put an item)", () => {
  it("orders: this client's blocks on the planned day, its other blocks, Open half-days, then other clients' blocks", () => {
    expect(keys(addTargets(base))).toEqual([
      "02PM:here",
      "04AM:client",
      "04PM:client!No free time left: meetings fill it",
      "03AM:open",
      "05AM:open!Day off",
      "05PM:open!Day off",
      "06AM:open",
      "06PM:open",
      "02AM:other",
      "03PM:other",
    ]);
  });

  it("marks other clients' blocks with the client, so the menu can say Different client and ask first", () => {
    const t = addTargets(base);
    expect(t.find((x) => x.date === "2026-11-03" && x.half === "PM")).toMatchObject({ group: "other", otherClient: "hh" });
    expect(t.filter((x) => x.group !== "other").every((x) => x.otherClient === null)).toBe(true);
  });

  it("puts the block selected in Plan the day first, even when it is an Open half-day", () => {
    const t = addTargets({ ...base, selected: { date: "2026-11-03", half: "AM" } });
    expect(t[0]).toMatchObject({ date: "2026-11-03", half: "AM", selected: true, group: "open" });
    expect(t.filter((x) => x.selected)).toHaveLength(1);
  });

  it("never puts another client's block first, even when it is selected", () => {
    const t = addTargets({ ...base, selected: { date: "2026-11-02", half: "AM" } });
    expect(t[0]).toMatchObject({ date: "2026-11-02", half: "PM" });
  });

  it("uses the planned day, not today, for the first group", () => {
    const t = addTargets({ ...base, planDate: "2026-11-04" });
    expect(keys(t).slice(0, 3)).toEqual(["04AM:here", "04PM:here!No free time left: meetings fill it", "02PM:client"]);
  });

  it("leaves out past days and weekday halves with no working time", () => {
    const t = addTargets({ ...base, today: "2026-11-03" });
    expect(t.some((x) => x.date === "2026-11-02")).toBe(false);
    expect(addTargets({ ...base, blocks: [blk("2026-11-07", "AM", null, { off: true })] })).toEqual([]);
  });

  it("says Already planned here for the same item in a block, and names the half when it's planned the same day", () => {
    const t = addTargets({ ...base, picks: [pick(1, "2026-11-02", "PM", 7)] });
    expect(t.find((x) => x.date === "2026-11-02" && x.half === "PM")?.disabled).toBe("Already planned here");
    expect(t.find((x) => x.date === "2026-11-02" && x.half === "AM")?.disabled).toBe("Already planned for the afternoon that day");
    expect(t.find((x) => x.date === "2026-11-04" && x.half === "AM")?.disabled).toBeUndefined();
  });

  it("ignores dropped and moved picks of the same item", () => {
    const t = addTargets({ ...base, picks: [pick(1, "2026-11-02", "PM", 7, "dropped"), pick(2, "2026-11-02", "PM", 7, "moved")] });
    expect(t.find((x) => x.date === "2026-11-02" && x.half === "PM")?.disabled).toBeUndefined();
  });

  it("counts an evening flex session for the client as the client's block", () => {
    const t = addTargets({ ...base, blocks: [...week, blk("2026-11-02", "EVE", null, { flexClients: ["nw"] }), blk("2026-11-03", "EVE", null, { flexClients: ["hh"] })] });
    expect(t.find((x) => x.date === "2026-11-02" && x.half === "EVE")?.group).toBe("here");
    expect(t.find((x) => x.date === "2026-11-03" && x.half === "EVE")).toMatchObject({ group: "other", otherClient: "hh" });
  });
});
