import { describe, expect, it } from "vitest";
import type { WorkItem } from "../week/types.ts";
import type { DraftStory } from "./types.ts";
import { addSections, defaultBlock, doneAction, matches, mustsSummary, type AddInput } from "./addpane.ts";

const wi = (id: number, title: string, level: WorkItem["level"], parentId: number | null = null, extra: Partial<WorkItem> = {}): WorkItem => ({ id, title, type: level === "story" ? "User Story" : "Feature", state: "Active", stateCategory: "InProgress", level, order: id, parentId, changedAt: "", url: `https://dev.azure.com/o/p/_workitems/edit/${id}`, ...extra });
const F1 = wi(10, "Order history export", "portfolio", null, { tier: "feature" });
const S11 = wi(11, "Export to CSV", "story", 10);
const S12 = wi(12, "Filter by date", "story", 10);
const F2 = wi(20, "Supplier portal", "portfolio", null, { tier: "feature" });
const S30 = wi(30, "Fix login timeout", "story");
const S31 = wi(31, "Update README", "story");
const F4 = wi(40, "Reporting", "portfolio", null, { tier: "feature" });
const S41 = wi(41, "Monthly report", "story", 40);
const work = { items: [S30, F1, S31, F4, F2], children: [S11, S12, S41] };
const ref = (itemId: number, title: string, tier: "must" | "nice", level: "feature" | "story" = "feature", slots: { date: string; half: "AM" | "PM" }[] = []) => ({ clientKey: "nw", itemId, title, url: null, slots, tier, level, parentId: null as number | null });
const draft = (id: number, parentItemId: number | null): DraftStory => ({ id, clientKey: "nw", parentItemId, title: `Draft ${id}`, size: "M", level: "story", createdAt: "" });
const fu = (id: number, clientKey: string, due: string | null) => ({ id, clientKey, due, openedAt: "2026-11-01" });

const base = (over: Partial<AddInput<ReturnType<typeof ref>, ReturnType<typeof fu>>> = {}): AddInput<ReturnType<typeof ref>, ReturnType<typeof fu>> => ({
  clientKey: "nw", date: "2026-11-02", half: "AM", work,
  week: [ref(20, "Supplier portal", "nice"), ref(10, "Order history export", "must"), ref(30, "Fix login timeout", "must", "story")],
  followUps: [fu(1, "nw", "2026-11-02"), fu(2, "hh", null), fu(3, "nw", null)], drafts: [], picked: new Set(), ...over,
});

describe("defaultBlock", () => {
  it("prefers the block asked for", () => expect(defaultBlock([{ half: "AM", ended: false, fit: "none" }, { half: "PM", ended: false, fit: "none" }], "PM")).toBe("PM"));
  it("else the first block not over with room", () => {
    expect(defaultBlock([{ half: "AM", ended: true, fit: "none" }, { half: "PM", ended: false, fit: "over" }, { half: "EVE", ended: false, fit: "room" }])).toBe("EVE");
  });
  it("else the first not over, else the first", () => {
    expect(defaultBlock([{ half: "AM", ended: true, fit: "none" }, { half: "PM", ended: false, fit: "over" }])).toBe("PM");
    expect(defaultBlock([{ half: "AM", ended: true, fit: "fits" }, { half: "PM", ended: true, fit: "none" }])).toBe("AM");
    expect(defaultBlock([])).toBeNull();
  });
});

describe("addSections", () => {
  it("a story whose feature is on the week list shows only in the feature's row (step 16.4)", () => {
    const s = addSections(base({ week: [ref(10, "Order history export", "must"), { ...ref(11, "Export to CSV", "must", "story"), parentId: 10 }] }));
    expect(s.priorities.map((p) => [p.ref.itemId, p.level])).toEqual([[10, "feature"]]);
    expect(s.priorities[0]!.stories.map((x) => x.id)).toEqual([11, 12]);
  });
  it("lists priorities (musts then nice to haves), then the client's follow-ups, then everything else in DevOps order", () => {
    const s = addSections(base());
    expect(s.priorities.map((p) => [p.ref.itemId, p.tier])).toEqual([[10, "must"], [30, "must"], [20, "nice"]]);
    expect(s.priorities[0]!.stories.map((x) => x.id)).toEqual([11, 12]);
    expect(s.followUps.map((f) => f.id)).toEqual([1, 3]);
    expect(s.rest.map((r) => r.item.id)).toEqual([31, 40]);
    expect(s.rest[1]!.kids.map((k) => k.id)).toEqual([41]);
  });
  it("a feature with no stories or drafts gets one Break it down row", () => {
    const s = addSections(base());
    expect(s.priorities.find((p) => p.ref.itemId === 20)).toMatchObject({ breakDown: true, stories: [], allPicked: false });
    const d = addSections(base({ drafts: [draft(5, 20)] }));
    expect(d.priorities.find((p) => p.ref.itemId === 20)).toMatchObject({ breakDown: false, drafts: [{ id: 5 }] });
  });
  it("leaves out anything already on the day", () => {
    const s = addSections(base({ picked: new Set(["inw:11", "inw:30", "f1", "inw:31"]) }));
    expect(s.priorities.map((p) => p.ref.itemId)).toEqual([10, 20]);
    expect(s.priorities[0]!.stories.map((x) => x.id)).toEqual([12]);
    expect(s.followUps.map((f) => f.id)).toEqual([3]);
    expect(s.rest.map((r) => r.item.id)).toEqual([40]);
  });
  it("keeps what is planned in this block, so the row can say Already planned here (step 15.2)", () => {
    const here = new Set(["inw:11", "inw:30", "f1", "inw:31"]);
    const s = addSections(base({ picked: here, here }));
    expect(s.priorities.map((p) => p.ref.itemId)).toEqual([10, 30, 20]);
    expect(s.priorities[0]!.stories.map((x) => x.id)).toEqual([11, 12]);
    expect(s.followUps.map((f) => f.id)).toEqual([1, 3]);
    expect(s.rest.map((r) => r.item.id)).toEqual([31, 40]);
    // Planned in the other half of the day: still left out.
    const other = addSections(base({ picked: new Set(["inw:11", "inw:12"]), here: new Set(["inw:11"]) }));
    expect(other.priorities[0]!.stories.map((x) => x.id)).toEqual([11]);
    expect(other.priorities[0]).toMatchObject({ allPicked: true });
  });
  it("marks a feature whose stories are all on the plan, without offering a breakdown", () => {
    const s = addSections(base({ picked: new Set(["inw:11", "inw:12"]) }));
    expect(s.priorities[0]).toMatchObject({ allPicked: true, breakDown: false });
  });
  it("puts the feature pinned to this block first", () => {
    const s = addSections(base({ week: [ref(10, "Order history export", "must"), ref(40, "Reporting", "must", "feature", [{ date: "2026-11-02", half: "AM" }])] }));
    expect(s.priorities.map((p) => [p.ref.itemId, p.pinnedHere])).toEqual([[40, true], [10, false]]);
  });
  it("filters priorities to one feature from a card's This week link", () => {
    expect(addSections(base({ focus: 20 })).priorities.map((p) => p.ref.itemId)).toEqual([20]);
  });
  it("searches everything else by title or id, keeping a feature for a matching story", () => {
    expect(addSections(base({ query: "readme" })).rest.map((r) => r.item.id)).toEqual([31]);
    expect(addSections(base({ query: "#41" })).rest.map((r) => [r.item.id, r.kids.map((k) => k.id)])).toEqual([[40, [41]]]);
  });
  it("only the other client's follow-ups stay out", () => {
    expect(addSections(base({ clientKey: "hh", week: [] })).followUps.map((f) => f.id)).toEqual([2]);
  });
});

describe("matches", () => {
  it("is case-insensitive on titles and reads #ids", () => {
    expect(matches("CSV", S11)).toBe(true);
    expect(matches("#1", S11)).toBe(true);
    expect(matches("zz", S11)).toBe(false);
    expect(matches("  ", S11)).toBe(true);
  });
});

describe("Done", () => {
  it("the first Done commits; later ones only close (committedAt stays as first set)", () => {
    expect(doneAction(null)).toBe("commit");
    expect(doneAction("2026-11-02T08:10:00-05:00[America/New_York]")).toBe("close");
  });
});

describe("mustsSummary", () => {
  it("reads client done/musts, skipping clients without musts", () => {
    const names: Record<string, string> = { coop: "Cooptimize", wc: "T&S", adatum: "Adatum", q: "Proseware" };
    expect(mustsSummary([{ clientKey: "coop", musts: 2, done: 0 }, { clientKey: "wc", musts: 1, done: 0 }, { clientKey: "q", musts: 0, done: 0 }, { clientKey: "adatum", musts: 1, done: 1 }], (k) => names[k]!)).toBe("Cooptimize 0/2 · T&S 0/1 · Adatum 1/1");
  });
});
