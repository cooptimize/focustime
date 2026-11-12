// FN-1: item.card, the story card's read: a client the person can't see reads nothing, DevOps HTML is sanitized before
// it reaches a browser, a minute's cache per person, and FocusTime's own context (to-dos, promises) on the item.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { CardRead, ItemCard } from "../plan/item-card.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { itemCardAction, NO_ACCESS, type ItemCardContext } from "./item-card-actions.ts";
import { aBrief } from "../test/builders/index.ts";
import { descriptionHtml, SEED } from "../plan/work-templates.ts";

const NOW = "2026-11-02T17:30:00Z";
const read = (id: number, o: Partial<CardRead> = {}): CardRead => ({
  id, title: "CSV export", type: "User Story", state: "Active", stateCategory: "InProgress", states: [], assignee: "Sam Tester", iteration: "P\\Sprint 9", area: "P", size: { label: "Story Points", value: 3 },
  remainingWork: null, hasRemainingWork: false, start: null, target: "2026-11-20", descriptionHtml: '<p>Export <b>all</b> rows</p><script>alert(1)</script><img src="x" onerror="alert(2)">', acceptanceHtml: '<a href="javascript:alert(3)">x</a>',
  parent: { id: 40, title: "Billing", type: "Feature", state: "Active" }, grandparent: null, children: [], comments: [{ id: 1, author: "Dana Ruiz", at: NOW, text: '<div onclick="x()">Looks good</div>' }], commentCount: 1,
  url: `https://dev.azure.com/contoso/P/_workitems/edit/${id}`, changedAt: NOW, breakDown: false, ...o,
});

function setup(o: { visible?: string[]; writes?: string[]; read?: Partial<CardRead> } = {}) {
  const calls: [string, number][] = [];
  let now = NOW;
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(now).toZonedDateTimeISO("America/New_York") });
  const scope = {};
  const ctx: ItemCardContext = {
    plan,
    config: async () => {
      const c = parseConfig(STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"').replace('time_zone = ""', 'time_zone = "America/New_York"'));
      if (!c.ok) throw new Error("config");
      return c.config;
    },
    devops: () => ({ itemCard: async (k: string, id: number) => (calls.push([k, id]), { ok: true as const, value: read(id, o.read) }) }),
    templates: async () => SEED,
    clients: async () => (o.visible ?? ["fabrikam"]).map((k) => ({ clientKey: k, clientName: k === "fabrikam" ? "Fabrikam" : k })),
    writeClients: async () => o.writes ?? [],
    scope,
    now: () => now,
  };
  const card = async (clientKey: string, itemId: number, fresh = false) => {
    const r = await itemCardAction(ctx, "item.card", { clientKey, itemId, ...(fresh ? { fresh: true } : {}) });
    if (!r.ok) throw new Error(r.error);
    return r.data as { access: false; message: string } | { access: true; card: ItemCard };
  };
  return { calls, plan, card, later: (ms: number) => void (now = new Date(Date.parse(NOW) + ms).toISOString()) };
}

describe("item.card", () => {
  it("a client I can't see answers no access and reads nothing from DevOps", async () => {
    const t = setup({ visible: ["fabrikam"] });
    expect(await t.card("contoso", 77)).toEqual({ access: false, message: NO_ACCESS });
    expect(t.calls).toEqual([]);
  });
  it("a client I only write to is visible", async () => {
    const t = setup({ visible: [], writes: ["fabrikam"] });
    const r = await t.card("fabrikam", 7);
    expect(r.access).toBe(true);
  });
  it("sanitizes the description, acceptance criteria and comments", async () => {
    const t = setup();
    const r = await t.card("fabrikam", 7);
    if (!r.access) throw new Error("no access");
    const all = r.card.description + r.card.acceptance + r.card.comments.map((c) => c.html).join("");
    expect(all).not.toMatch(/<script|onerror|onclick|javascript:|<img/i);
    expect(r.card.description).toContain("<strong>all</strong>");
    expect(r.card.comments[0]!.author).toBe("Dana Ruiz");
    expect(r.card).toMatchObject({ clientName: "Fabrikam", canWrite: false });
    expect(r.card.writeNote).toMatch(/Turn on DevOps writes/);
  });
  it("is kept a minute per person; fresh reads again", async () => {
    const t = setup({ writes: ["fabrikam"] });
    await t.card("fabrikam", 7);
    await t.card("fabrikam", 7);
    expect(t.calls).toHaveLength(1);
    await t.card("fabrikam", 7, true);
    expect(t.calls).toHaveLength(2);
    t.later(61_000);
    await t.card("fabrikam", 7);
    expect(t.calls).toHaveLength(3);
  });
  it("shows my to-dos on the item", async () => {
    const t = setup();
    await t.plan.start("2026-11-02");
    await t.plan.addPick({ date: "2026-11-02", half: "PM", clientKey: "fabrikam", kind: "item", itemId: 7, title: "CSV export", size: "M" });
    const r = await t.card("fabrikam", 7, true);
    if (!r.access) throw new Error("no access");
    expect(r.card.todos.map((x) => [x.date, x.half, x.status])).toEqual([["2026-11-02", "PM", "planned"]]);
  });
  it("refuses bad input", async () => {
    const t = setup();
    await expect(t.card("fabrikam", -1)).rejects.toThrow(/work item id/);
  });

  // TP-1: the four lines as one block above the rest, the type's name from its tag, and the quiet chip.
  const cardOf = async (r: Partial<CardRead>) => {
    const x = await setup({ read: r }).card("fabrikam", 9);
    if (!x.access) throw new Error("no access");
    return x.card;
  };
  it("TP-1: the four lines above the rest, the type's name, and Missing naming the empty lines", async () => {
    const c = await cardOf({ descriptionHtml: descriptionHtml("Context", aBrief({ where: "Sales model", check: "Oct: 31.2%" })) ?? "", tags: ["Blocked", "type:new-measure"] });
    expect(c.requestType).toBe("New measure");
    expect(c.lines?.map((l) => [l.name, l.text])).toEqual([["What and where", "Sales model"], ["What changes", null], ["How we'll check", "Oct: 31.2%"], ["How far and who signs off", null]]);
    expect(c.description).toBe("<div>Context</div>");
    expect(c.readiness).toEqual({ ready: false, text: "Missing: What changes, How far and who signs off" });
  });
  it("TP-1: Ready when all four are there, read under the earlier names too", async () => {
    const c = await cardOf({ descriptionHtml: "<h3>Target</h3><p>a</p><h3>Change</h3><p>b</p><h3>Control</h3><p>c</p><h3>Boundary</h3><p>d</p>" });
    expect(c.readiness).toEqual({ ready: true, text: "Ready" });
    expect(c.requestType).toBeNull();
  });
  it("TP-1: an item with neither headings nor a known tag shows no chip and no block", async () => {
    const c = await cardOf({ tags: ["type:unknown-one"] });
    expect(c.readiness).toBeNull();
    expect(c.lines).toBeNull();
    expect(c.description).toContain("Export <b>all</b> rows");
  });
});
