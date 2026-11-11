// QC-1: the New form's reads (new.options) and Save as draft at any level, against the plan store. No DevOps writes
// here: creating goes through devops.preview kind "new_item" (actions/devops-write.test.ts).
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { ProcessModel } from "../plan/process.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { levelsWithDefaults, newItemAction, type NewItemContext, type NewOptions } from "./new-item-actions.ts";

const NOW = "2026-11-11T14:00:00Z";
// A process with a level above epics; the epic's default child is Capability, not the first feature-tier type.
const model = {
  ladder: [["Domain"], ["Epic"], ["Feature", "Capability"], ["Product Backlog Item", "Bug"], ["Task"]],
  types: [{ name: "Domain", defaultChild: "Epic" }, { name: "Epic", defaultChild: "Capability" }, { name: "Feature", defaultChild: "Product Backlog Item" }],
} as unknown as ProcessModel;
const item = (id: number, type: string, stateCategory = "InProgress") => ({ id, title: `Item ${id}`, type, state: stateCategory === "Completed" ? "Done" : "Active", stateCategory, url: `https://dev.azure.com/contoso/Portal/_workitems/edit/${id}`, parentId: null });

function setup(o: { model?: ProcessModel | null; canWrite?: boolean; items?: ReturnType<typeof item>[] | null } = {}) {
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const ctx: NewItemContext = {
    plan,
    config: async () => {
      const r = parseConfig(STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"'));
      if (!r.ok) throw new Error("starter config");
      return r.config;
    },
    model: async () => (o.model === undefined ? model : o.model),
    items: async () => (o.items === undefined ? [item(1, "Domain"), item(2, "Epic"), item(3, "Capability"), item(4, "Product Backlog Item"), item(5, "Epic", "Completed")] : o.items),
    canWrite: async () => o.canWrite ?? true,
  };
  const run = async <T,>(action: "new.options" | "draft.add" | "draft.save", input: unknown): Promise<T> => {
    const r = await newItemAction(ctx, action, input);
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  };
  const refused = async (action: "draft.add" | "draft.save", input: unknown) => {
    const r = await newItemAction(ctx, action, input);
    if (r.ok) throw new Error("expected a refusal");
    return r.error;
  };
  return { plan, run, refused };
}

describe("new.options", () => {
  it("levels top-down with each one's default type from the level above", () => {
    expect(levelsWithDefaults(model).map((l) => [l.types, l.default])).toEqual([
      [["Domain"], "Domain"],
      [["Epic"], "Epic"],
      [["Feature", "Capability"], "Capability"],
      [["Product Backlog Item", "Bug"], "Product Backlog Item"],
    ]);
  });
  it("parents are the open items at a level something goes under; my write PAT decides canWrite", async () => {
    const s = setup({ canWrite: false });
    const o = await s.run<NewOptions>("new.options", { clientKey: "Northwind" });
    expect(o.parents.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(o.canWrite).toBe(false);
    expect(o.problem).toBeNull();
  });
  it("an unreadable process says so; no items still offers the levels", async () => {
    expect((await setup({ model: null }).run<NewOptions>("new.options", { clientKey: "Northwind" })).problem).toContain("couldn't read this client's DevOps process");
    const o = await setup({ items: null }).run<NewOptions>("new.options", { clientKey: "Northwind" });
    expect(o.levels).toHaveLength(4);
    expect(o.problem).toContain("no parents to choose");
  });
});

describe("Save as draft, at any level", () => {
  it("keeps the exact type, stored at story or feature beside it", async () => {
    const s = setup();
    for (const [type, level] of [["Domain", "feature"], ["Epic", "feature"], ["Capability", "feature"], ["Bug", "story"]] as const) {
      const { draft } = await s.run<{ draft: { itemType: string | null; level: string; title: string } }>("draft.add", { clientKey: "Northwind", title: ` ${type}   draft `, type });
      expect(draft).toMatchObject({ itemType: type, level, title: `${type} draft` });
    }
  });
  it("checks the type and the parent against the process", async () => {
    const s = setup();
    expect(await s.refused("draft.add", { clientKey: "Northwind", title: "X", type: "Initiative" })).toContain("isn't a level");
    expect(await s.refused("draft.add", { clientKey: "Northwind", title: "X", type: "Bug", parentItemId: 2 })).toContain("doesn't go under an Epic");
    expect(await s.refused("draft.add", { clientKey: "Northwind", title: "X", type: "Epic", parentItemId: 99 })).toContain("isn't one of this client's open items");
    expect(await s.refused("draft.add", { clientKey: "Northwind", title: "   ", type: "Epic" })).toBe("Type a title");
    expect(await s.refused("draft.add", { clientKey: "Northwind", title: "y".repeat(256), type: "Epic" })).toContain("at most 255");
    const { draft } = await s.run<{ draft: { parentItemId: number | null } }>("draft.add", { clientKey: "Northwind", title: "Under the domain", type: "Epic", parentItemId: 1 });
    expect(draft.parentItemId).toBe(1);
  });
  it("keeps the assignee, target date and description; Save changes them", async () => {
    const s = setup();
    const { draft } = await s.run<{ draft: { id: number } }>("draft.add", { clientKey: "Northwind", title: "Owned", type: "Capability", assignTo: "Dana@Contoso.example", targetDate: "2026-12-01", description: "Why" });
    expect(await s.plan.getDraft(draft.id)).toMatchObject({ assignTo: "dana@contoso.example", targetDate: "2026-12-01", description: "Why", itemType: "Capability" });
    await s.run("draft.save", { id: draft.id, clientKey: "Northwind", title: "Owned, renamed", type: "Product Backlog Item", assignTo: "none" });
    expect(await s.plan.getDraft(draft.id)).toMatchObject({ title: "Owned, renamed", itemType: "Product Backlog Item", level: "story", assignTo: "none" });
    await s.run("draft.save", { id: draft.id, clientKey: "Northwind", title: "Mine again", type: "Product Backlog Item", assignTo: "me" });
    expect((await s.plan.getDraft(draft.id))!.assignTo).toBeUndefined();
    expect(await s.refused("draft.add", { clientKey: "Northwind", title: "X", targetDate: "2026-02-30" })).toContain("real date");
  });
  it("works with no process read (DevOps down): saved as typed", async () => {
    const s = setup({ model: null, items: null });
    const { draft } = await s.run<{ draft: { itemType: string | null } }>("draft.add", { clientKey: "Northwind", title: "Offline", type: "Capability" });
    expect(draft.itemType).toBe("Capability");
  });
});
