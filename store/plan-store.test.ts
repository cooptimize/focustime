import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createPlanStore, MIGRATIONS } from "./plan-store.ts";

const NY = "America/New_York";
let clock = Temporal.ZonedDateTime.from("2026-11-02T08:01:00-05:00[America/New_York]");
const now = () => clock;
const fresh = () => {
  const path = join(mkdtempSync(join(tmpdir(), "coopilot-plan-")), "data", "plan.db");
  return { path, store: createPlanStore({ path, now }) };
};
const item = { half: "AM" as const, clientKey: "CSC", kind: "item" as const, itemId: 101, title: "Story", itemType: "User Story", itemUrl: "https://dev.azure.com/x/y/_workitems/edit/101", size: "M" as const };

describe("plan store", () => {
  it("migrates from empty, creates a private file, and records the schema version", () => {
    const { path, store } = fresh();
    expect(store.schemaVersion()).toBe(MIGRATIONS.length);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
    store.close();
    // Re-opening runs nothing again.
    const again = createPlanStore({ path, now });
    expect(again.schemaVersion()).toBe(MIGRATIONS.length);
    again.close();
  });

  it("refuses a store from a newer Coopilot instead of guessing", () => {
    const { path, store } = fresh();
    store.close();
    const db = new DatabaseSync(path);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(MIGRATIONS.length + 5, "x");
    db.close();
    expect(() => createPlanStore({ path, now })).toThrow(/newer Coopilot/);
  });

  it("timestamps carry offset and time zone", () => {
    const { store } = fresh();
    const plan = store.start("2026-11-02");
    expect(plan.createdAt).toBe("2026-11-02T08:01:00-05:00[America/New_York]");
    expect(store.commit("2026-11-02").committedAt).toMatch(/-05:00\[America\/New_York\]$/);
  });

  it("commit and picks persist across a restart", () => {
    const { path, store } = fresh();
    store.start("2026-11-02");
    const a = store.addPick({ date: "2026-11-02", ...item });
    store.addPick({ date: "2026-11-02", half: "PM", clientKey: "Cooptimize", kind: "intention", title: "Write the ignition doc", size: "S" });
    store.setSize(a.id, "L");
    store.commit("2026-11-02");
    store.setDone(a.id, true);
    store.close();

    const reopened = createPlanStore({ path, now });
    expect(reopened.day("2026-11-02")?.committedAt).not.toBeNull();
    const picks = reopened.picksFor("2026-11-02");
    expect(picks.map((p) => [p.half, p.title, p.size, p.status])).toEqual([
      ["AM", "Story", "L", "done"],
      ["PM", "Write the ignition doc", "S", "planned"],
    ]);
    reopened.close();
  });

  it("enforces the shape of a pick in the schema too", () => {
    const { store } = fresh();
    expect(() => store.addPick({ date: "2026-11-02", ...item, size: "XL" as never })).toThrow();
    expect(() => store.addPick({ date: "2026-11-02", half: "AM", clientKey: "CSC", kind: "item", title: "no id", size: "M" })).toThrow();
  });

  it("moving to another day carries the pick and settles the original; same day just changes block", () => {
    const { store } = fresh();
    const a = store.addPick({ date: "2026-11-02", ...item });
    const inPlace = store.move(a.id, "2026-11-02", "PM");
    expect([inPlace.id, inPlace.half]).toEqual([a.id, "PM"]);
    const fri = store.move(a.id, "2026-11-06", "AM");
    expect(fri).toMatchObject({ date: "2026-11-06", half: "AM", status: "planned", carriedFrom: a.id, carriedFromDate: "2026-11-02", itemId: 101 });
    expect(store.getPick(a.id)!.status).toBe("moved");
  });

  it("carry-over: yesterday's unfinished picks, carried once", () => {
    const { store } = fresh();
    const done = store.addPick({ date: "2026-10-29", ...item, title: "done" });
    const open = store.addPick({ date: "2026-10-29", ...item, title: "unfinished" });
    store.commit("2026-10-29");
    store.setDone(done.id, true);
    expect(store.carryOverFor("2026-11-02").map((p) => p.title)).toEqual(["unfinished"]);
    store.move(open.id, "2026-11-02", "AM");
    expect(store.carryOverFor("2026-11-02")).toEqual([]);
    expect(store.picksFor("2026-11-02")[0]).toMatchObject({ title: "unfinished", carriedFromDate: "2026-10-29" });
  });

  it("remove: deleted before commit, kept as dropped after; a carried pick dropped again goes back to its day", () => {
    const { store } = fresh();
    const a = store.addPick({ date: "2026-11-02", ...item });
    expect(store.removePick(a.id).result).toBe("deleted");
    expect(store.getPick(a.id)).toBeNull();

    const old = store.addPick({ date: "2026-10-29", ...item });
    store.commit("2026-10-29");
    const carried = store.move(old.id, "2026-11-02", "AM");
    expect(store.removePick(carried.id).result).toBe("deleted");
    expect(store.getPick(old.id)!.status).toBe("planned");
    expect(store.carryOverFor("2026-11-02")).toHaveLength(1);

    const b = store.addPick({ date: "2026-11-02", ...item });
    store.commit("2026-11-02");
    expect(store.removePick(b.id)).toMatchObject({ result: "dropped", pick: { status: "dropped" } });
  });

  it("markOnce is true only the first time, across restarts", () => {
    const { path, store } = fresh();
    expect(store.markOnce("notify", "2026-11-02")).toBe(true);
    expect(store.markOnce("notify", "2026-11-02")).toBe(false);
    store.close();
    const again = createPlanStore({ path, now });
    expect(again.markOnce("notify", "2026-11-02")).toBe(false);
    expect(again.markOnce("notify", "2026-11-03")).toBe(true);
  });

  it("exports everything to JSON", () => {
    const { store } = fresh();
    store.addPick({ date: "2026-11-02", ...item });
    store.addDraft({ clientKey: "CSC", parentItemId: 130, title: "Split the feature", size: "S" });
    store.commit("2026-11-02");
    const out = JSON.parse(JSON.stringify(store.exportJson()));
    expect(out.schemaVersion).toBe(MIGRATIONS.length);
    expect(out.dayPlans).toHaveLength(1);
    expect(out.picks[0]).toMatchObject({ itemId: 101, size: "M", status: "planned" });
    expect(out.draftStories[0]).toMatchObject({ parentItemId: 130, title: "Split the feature" });
  });

  it("works for any zone the clock is in", () => {
    clock = Temporal.ZonedDateTime.from("2026-11-02T08:01:00+01:00[Europe/Paris]");
    const { store } = fresh();
    expect(store.start("2026-11-02").createdAt).toContain("[Europe/Paris]");
    clock = Temporal.ZonedDateTime.from(`2026-11-02T08:01:00-05:00[${NY}]`);
  });
});
