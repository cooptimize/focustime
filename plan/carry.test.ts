import { describe, expect, it } from "vitest";
import { aClient, aDirectoryPerson, aFocusBlock, aPortfolioChild, aPortfolioItem, aPto, aWeek, aWeekFeature } from "../test/builders/index.ts";
import { acceptAllDecision, carryProposal, checkInWith, checkinTarget, proposalCounts, treeOf, watchState, type CarryInput, type FeatureTree } from "./carry.ts";
import { levels } from "./levels.ts";

const ME = "me@contoso.example";
const TEAMMATE = "dana@contoso.example";
const mineStory = (o = {}) => aPortfolioChild({ assignedTo: "Me", assignedToEmail: ME, mine: true, ...o });
const theirs = (o = {}) => aPortfolioChild({ assignedTo: "Dana", assignedToEmail: TEAMMATE, ...o });
const done = { state: "Closed", stateCategory: "Completed", open: false };

function propose(trees: FeatureTree[], o: Partial<CarryInput> = {}) {
  const byId = new Map(trees.map((t) => [t.id, t]));
  return carryProposal({
    me: ME,
    meIsCooptimizer: true,
    isClient: () => true,
    isLead: () => false,
    lastWeek: trees.map((t) => aWeekFeature({ weekStart: "2026-10-26", clientKey: "adatum", itemId: t.id, title: t.title, estimate: 360 })),
    planned: [],
    decided: [],
    tree: (_k, id) => byId.get(id) ?? null,
    ...o,
  });
}
const kindOf = (t: FeatureTree, o: Partial<CarryInput> = {}) => propose([t], o).rows[0]?.kind ?? null;

describe("the From last week proposal (PL-1)", () => {
  it("shows a resolved or closed feature as finished, for anyone", () => {
    expect(kindOf(treeOf(aPortfolioItem({ stateCategory: "Resolved", children: [mineStory()] })))).toBe("finished");
    expect(kindOf(treeOf(aPortfolioItem({ stateCategory: "Completed" })))).toBe("finished");
    // Removed isn't finished work: no row.
    expect(kindOf(treeOf(aPortfolioItem({ stateCategory: "Removed" })))).toBeNull();
  });

  it("carries a feature with my open stories as a must, with those stories and last week's estimate", () => {
    const open = mineStory();
    const t = treeOf(aPortfolioItem({ children: [open, mineStory(done), theirs()] }));
    const [row] = propose([t]).rows;
    expect(row).toMatchObject({ kind: "carry", estimate: 360 });
    expect(row!.stories.map((s) => s.id)).toEqual([open.id]);
    // The same for the owner and a lead: my open stories win.
    expect(kindOf(treeOf(aPortfolioItem({ mine: true, children: [mineStory()] })))).toBe("carry");
    expect(kindOf(t, { isLead: () => true })).toBe("carry");
  });

  it("my part done: Watching for the owner or a client lead, Your part is done for a contributor", () => {
    const kids = () => [mineStory(done), theirs()];
    expect(propose([treeOf(aPortfolioItem({ mine: true, children: kids() }))]).rows[0]).toMatchObject({ kind: "watch", why: "owner" });
    expect(propose([treeOf(aPortfolioItem({ children: kids() }))], { isLead: () => true }).rows[0]).toMatchObject({ kind: "watch", why: "lead" });
    expect(kindOf(treeOf(aPortfolioItem({ children: kids() })))).toBe("part_done");
  });

  it("stories never mine: Watching for the owner or a lead, Not yours yet with teammates' open stories otherwise", () => {
    const open = theirs();
    const t = treeOf(aPortfolioItem({ children: [open, theirs(done)] }));
    expect(kindOf(treeOf(aPortfolioItem({ mine: true, children: [theirs()] })))).toBe("watch");
    expect(kindOf(t, { isLead: () => true })).toBe("watch");
    const [row] = propose([t]).rows;
    expect(row).toMatchObject({ kind: "not_yours", why: null });
    expect(row!.stories.map((s) => s.id)).toEqual([open.id]);
  });

  it("no stories at all: Needs stories for the owner or a lead; a senior who isn't a lead gets no row", () => {
    expect(propose([treeOf(aPortfolioItem({ mine: true }))]).rows[0]).toMatchObject({ kind: "needs_stories", why: "owner" });
    expect(kindOf(treeOf(aPortfolioItem()), { isLead: () => true })).toBe("needs_stories");
    // Level isn't a role here: a Senior who neither owns it nor leads the client isn't offered it.
    expect(kindOf(treeOf(aPortfolioItem()))).toBeNull();
    // Removed stories don't count as stories.
    expect(kindOf(treeOf(aPortfolioItem({ mine: true, children: [mineStory({ stateCategory: "Removed", open: false })] })))).toBe("needs_stories");
  });

  it("gives no rows for a prospect or a hidden account (only clients)", () => {
    const t = treeOf(aPortfolioItem({ mine: true, children: [mineStory()] }));
    expect(propose([t], { isClient: () => false }).rows).toEqual([]);
  });

  it("gives a guest or an automation account no rows at all", () => {
    const t = treeOf(aPortfolioItem({ mine: true, children: [mineStory()] }));
    expect(propose([t], { meIsCooptimizer: false }).rows).toEqual([]);
    expect(propose([t], { me: null }).rows).toEqual([]);
  });

  it("leaves out rows already planned or decided this week, and counts features DevOps can't say anything about", () => {
    const a = treeOf(aPortfolioItem({ mine: true, children: [mineStory()] }));
    const b = treeOf(aPortfolioItem({ mine: true, children: [mineStory()] }));
    const c = treeOf(aPortfolioItem({ mine: true, children: [mineStory()] }));
    const r = propose([a, b, c], { planned: [{ clientKey: "adatum", itemId: a.id }], decided: [{ clientKey: "adatum", itemId: b.id }], tree: (_k, id) => (id === c.id ? null : a) });
    expect(r.rows).toEqual([]);
    expect(r.unknown).toBe(1);
    expect(proposalCounts(r.rows, r.unknown)).toMatchObject({ carry: 0, unknown: 1 });
  });

  it("Accept all keeps carries and needs-stories rows, watches Watching rows, and leaves the rest", () => {
    expect(acceptAllDecision("carry")).toBe("kept");
    expect(acceptAllDecision("needs_stories")).toBe("kept");
    expect(acceptAllDecision("watch")).toBe("watching");
    for (const k of ["finished", "part_done", "not_yours"] as const) expect(acceptAllDecision(k)).toBeNull();
  });

  it("a Kat-owned account makes nobody a watcher (automation accounts never lead)", () => {
    const kat = aDirectoryPerson({ name: "Kat", email: "kat@contoso.example" });
    const people = levels({ directory: [kat], leads: [{ clientKey: "adatum", personId: kat.personId, source: "owner" }], overrides: [], automation: [kat.personId], domains: ["contoso.example"] });
    expect(people.clientLeads("adatum")).toEqual([]);
    const t = treeOf(aPortfolioItem({ children: [theirs()] }));
    expect(kindOf(t, { isLead: (k) => people.isClientLead(kat.personId, k) })).toBe("not_yours");
    expect(kindOf(treeOf(aPortfolioItem()), { isLead: (k) => people.isClientLead(kat.personId, k) })).toBeNull();
  });
});

describe("Watching (PL-1)", () => {
  const coop = (e: string) => e.endsWith("@contoso.example") && !e.startsWith("kat");
  const tree = (children = [theirs(), theirs()]) => treeOf(aPortfolioItem({ mine: true, children }));

  it("is amber after a week with no child state change, naming who to check in with", () => {
    expect(watchState({ tree: tree(), changed: new Set(), weekday: 5, me: ME, isCooptimizer: coop })).toEqual({ kind: "quiet", text: "No movement this week", checkInWith: "Dana" });
  });

  it("isn't amber when a child changed state, early in the week, or while movement isn't known", () => {
    const t = tree();
    expect(watchState({ tree: t, changed: new Set([t.children[0]!.id]), weekday: 5, me: ME, isCooptimizer: coop }).kind).toBe("moving");
    expect(watchState({ tree: t, changed: new Set(), weekday: 1, me: ME, isCooptimizer: coop }).kind).toBe("early");
    expect(watchState({ tree: t, changed: null, weekday: 5, me: ME, isCooptimizer: coop })).toEqual({ kind: "unknown", text: "Movement not known yet" });
  });

  it("checks in with the Cooptimizer with the most open stories, never an automation account or me", () => {
    const kids = [
      aPortfolioChild({ assignedTo: "Kat 🤖", assignedToEmail: "kat@contoso.example" }),
      aPortfolioChild({ assignedTo: "Kat 🤖", assignedToEmail: "kat@contoso.example" }),
      aPortfolioChild({ assignedTo: "Kat 🤖", assignedToEmail: "kat@contoso.example" }),
      mineStory(),
      mineStory(),
      theirs(),
      theirs(done),
      theirs(done),
      aPortfolioChild({ assignedTo: "Lee", assignedToEmail: "lee@fabrikam.example" }),
      aPortfolioChild({ assignedTo: "Lee", assignedToEmail: "lee@fabrikam.example" }),
    ];
    expect(checkInWith(tree(kids), ME, coop)).toBe("Dana");
    expect(checkInWith(tree([mineStory()]), ME, coop)).toBeNull();
  });
});

describe("where the check-in goes (PL-1)", () => {
  it("the client's first block of the week not yet ended, else the first open half-day", () => {
    const week = aWeek({ patterns: [aFocusBlock({ client: aClient({ name: "Adatum" }), days: { Tue: "PM", Wed: "AM" } })] });
    expect(checkinTarget(week.days, "adatum")).toEqual({ date: "2026-11-03", half: "PM" });
    // Never a block that has ended: on Tuesday evening, Wednesday morning.
    expect(checkinTarget(week.days, "adatum", "2026-11-03T23:30:00Z")).toEqual({ date: "2026-11-04", half: "AM" });
    // After its last block, the first open half-day still ahead (Wednesday afternoon, at 1 PM).
    expect(checkinTarget(week.days, "adatum", "2026-11-04T18:00:00Z")).toEqual({ date: "2026-11-04", half: "PM" });
    // A client with no blocks: Monday morning is the first open half-day.
    expect(checkinTarget(week.days, "fabrikam")).toEqual({ date: "2026-11-02", half: "AM" });
    // On PTO there is nowhere to put it.
    expect(checkinTarget(aWeek({ pto: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((date) => aPto({ date })) }).days, "fabrikam")).toBeNull();
  });
});
