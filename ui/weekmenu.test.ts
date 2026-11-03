import { describe, expect, it, vi } from "vitest";
import { blocksStep, weekItemMenu, type WeekItemFacts, type WeekItemOps } from "./menu.ts";

const facts = (over: Partial<WeekItemFacts> = {}): WeekItemFacts => ({
  itemId: 10, title: "Order history export", tier: "must", level: "feature", first: false, last: false, past: false, done: null, blocks: 2,
  places: [{ date: "2026-11-02", half: "PM", label: "Mon PM" }, { date: "2026-11-04", half: "AM", label: "Wed AM" }], pinned: [{ date: "2026-11-04", half: "AM" }],
  openStories: 2, targetDate: null, drafts: 0, canWrite: true, ...over,
});
const ops = (): WeekItemOps & Record<string, ReturnType<typeof vi.fn>> => ({ move: vi.fn(), tier: vi.fn(), pin: vi.fn(), blocks: vi.fn(), done: vi.fn(), help: vi.fn(), targetDate: vi.fn(), brief: vi.fn(), createDrafts: vi.fn(), enableWrites: vi.fn(), remove: vi.fn() }) as never;
const items = (s: ReturnType<typeof weekItemMenu>) => ("items" in s ? s.items : []);
const item = (s: ReturnType<typeof weekItemMenu>, id: string) => items(s).find((i) => i.id === id)!;

describe("weekItemMenu (Plan the week row ⋯, D267)", () => {
  it("holds every action that left the row, in order", () => {
    expect(items(weekItemMenu(facts(), ops())).map((i) => i.id)).toEqual(["up", "down", "tier", "blocks", "pin", "done", "help", "target", "brief", "remove"]);
    expect(items(weekItemMenu(facts({ level: "story" }), ops())).map((i) => i.id)).not.toContain("brief");
    expect(items(weekItemMenu(facts({ drafts: 3 }), ops())).find((i) => i.id === "create")?.label).toBe("Create 3 drafts in DevOps");
  });
  it("runs the right operation for each", () => {
    const o = ops();
    const m = weekItemMenu(facts(), o);
    item(m, "up").run!();
    item(m, "down").run!();
    item(m, "tier").run!();
    item(m, "done").run!();
    item(m, "help").run!();
    item(m, "target").run!();
    item(m, "brief").run!();
    item(m, "remove").run!();
    expect(o.move.mock.calls).toEqual([[-1], [1]]);
    expect(o.tier).toHaveBeenCalledWith("nice");
    expect(o.done).toHaveBeenCalledWith(true);
    for (const k of ["help", "targetDate", "brief", "remove"]) expect(o[k]).toHaveBeenCalledOnce();
    expect(item(m, "tier").label).toBe("Make it a nice to have");
    expect(item(weekItemMenu(facts({ tier: "nice" }), o), "tier").label).toBe("Make it a must");
  });
  it("pins and unpins from its step, the pinned one checked", () => {
    const o = ops();
    const step = item(weekItemMenu(facts(), o), "pin").next!();
    const pins = "items" in step ? step.items : [];
    expect(pins.map((p) => [p.label, p.checked])).toEqual([["Mon PM", false], ["Wed AM", true]]);
    pins[0]!.run!();
    pins[1]!.run!();
    expect(o.pin.mock.calls).toEqual([["2026-11-02", "PM", true], ["2026-11-04", "AM", false]]);
  });
  it("sets half blocks, ½ to 10 (E1; was whole blocks in step 16.4)", () => {
    const o = ops();
    const step = blocksStep(facts(), o);
    const list = "items" in step ? step.items : [];
    expect(list.find((i) => i.checked)?.label).toBe("2 blocks");
    expect(list.slice(0, 4).map((i) => i.label)).toEqual(["½ block", "1 block", "1½ blocks", "2 blocks"]);
    expect(list.every((i) => /^\d*½? blocks?$/.test(i.label))).toBe(true);
    list.find((i) => i.label === "1½ blocks")!.run!();
    expect(o.blocks).toHaveBeenCalledWith(1.5);
  });
  it("a feature whose load comes from its stories has no estimate to set", () => {
    const m = weekItemMenu({ ...facts(), derived: true }, ops());
    const blocks = ("items" in m ? m.items : []).find((i) => i.id === "blocks");
    expect(blocks?.disabled).toMatch(/From its stories/);
  });
  it("a story has a size, not blocks; nested under its feature it takes the feature's tier", () => {
    const o = { ...ops(), size: vi.fn() };
    const m = weekItemMenu(facts({ level: "story", size: "S", nested: true }), o);
    expect(items(m).map((i) => i.id)).toContain("size");
    expect(items(m).map((i) => i.id)).not.toContain("blocks");
    expect(item(m, "tier").disabled).toBe("Stories take their feature's tier");
    const step = item(m, "size").next!();
    const list = "items" in step ? step.items : [];
    expect(list.find((i) => i.checked)?.label).toBe("S · about an hour");
    list.find((i) => i.id === "sL")!.run!();
    expect(o.size).toHaveBeenCalledWith("L");
  });
  it("can't move past the ends, and done in DevOps can't be undone here", () => {
    const m = weekItemMenu(facts({ first: true, done: "other" }), ops());
    expect(item(m, "up").disabled).toBe("Already first");
    expect(item(m, "down").disabled).toBeUndefined();
    expect(item(m, "done").disabled).toMatch(/DevOps/);
    expect(item(weekItemMenu(facts({ done: "local" }), ops()), "done").label).toBe("Mark not done");
  });
  it("without write access, target date opens Enable DevOps writes", () => {
    const o = ops();
    const t = item(weekItemMenu(facts({ canWrite: false }), o), "target");
    expect(t.hint).toBe("Enable DevOps writes first");
    t.run!();
    expect(o.enableWrites).toHaveBeenCalledOnce();
    expect(o.targetDate).not.toHaveBeenCalled();
  });
  it("a past week is a review: everything that changes is disabled", () => {
    const m = weekItemMenu(facts({ past: true }), ops());
    for (const id of ["up", "down", "tier", "blocks", "pin", "done", "help", "target", "remove"]) expect(item(m, id).disabled, id).toBeTruthy();
    expect(item(m, "brief").disabled).toBeUndefined();
  });
});
