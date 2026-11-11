// DV-2: Find an item's answers, one case each: not in DevOps, not in the store, out of area, a type the process
// doesn't place, closed, not mine, filtered in Ahead, and a story that's fine everywhere.
import { describe, expect, it } from "vitest";
import { findAnswer, type FindFacts, type FoundItem } from "./find-item.ts";

const NOW = Date.parse("2026-11-11T15:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const story: FoundItem = { id: 42, title: "Export the report", type: "User Story", state: "Active", closed: false, tier: "story", parentId: 7, assignee: "me", area: "Contoso Project\\BI" };
const facts = (o: Partial<FindFacts> = {}, item: Partial<FoundItem> = {}): FindFacts => ({
  clientName: "Contoso",
  id: 42,
  devops: { kind: "found", item: { ...story, ...item } },
  devopsRev: 3,
  store: { has: true, changedAt: ago(600), rev: 3, checkedAt: ago(40), okAt: ago(40) },
  scope: { inScope: true, rule: "Area Contoso Project\\BI and sub-areas" },
  todayTodo: true,
  weekPlanned: false,
  ahead: { kind: "shown" },
  status: { kind: "feature_shown", featureId: 7 },
  ...o,
});
const text = (f: FindFacts) => findAnswer(f, NOW).map((l) => `${l.part}:${l.ok ? "ok" : "no"}: ${l.text}`);

describe("Find an item", () => {
  it("a story that shows everywhere", () => {
    expect(text(facts())).toEqual([
      'devops:ok: DevOps has #42 "Export the report", a User Story in Active.',
      "store:ok: FocusTime has it: last changed in DevOps 10 min ago, Contoso last checked just now.",
      "scope:ok: It's in what FocusTime shows for Contoso (Area Contoso Project\\BI and sub-areas).",
      "day:ok: Day shows it: it's a to-do on today's plan.",
      "week:ok: Week shows it under Your stories in Contoso's block details.",
      "ahead:ok: Ahead shows it.",
      "status:ok: Status shows its feature #7; Status lists features, with stories under them.",
    ]);
  });

  it("not in DevOps: one answer, whether it doesn't exist or is in another project", () => {
    const lines = text(facts({ devops: { kind: "missing" }, store: { has: false, changedAt: null, rev: null, checkedAt: ago(40), okAt: ago(40) } }));
    expect(lines).toEqual(["devops:no: FocusTime's last check of Contoso's project (just now) found no #42. If you just made it, Refresh checks now. If you made it in another project, FocusTime doesn't read that project for Contoso."]);
  });

  it("in DevOps, not in FocusTime's store yet", () => {
    const lines = text(facts({ store: { has: false, changedAt: null, rev: null, checkedAt: ago(300), okAt: ago(300) }, ahead: { kind: "absent" } }));
    expect(lines[1]).toBe("store:no: FocusTime doesn't have it yet. Contoso last checked 5 min ago; it arrives with the next check (Refresh checks now).");
    expect(lines.find((l) => l.startsWith("ahead"))).toBe("ahead:no: Ahead shows it after the next check.");
  });

  it("the store is behind DevOps", () => {
    expect(text(facts({ devopsRev: 4 }))[1]).toMatch(/DevOps has a newer change; it shows after the next check/);
  });

  it("out of area", () => {
    const lines = text(facts({ scope: { inScope: false, rule: "Area Contoso Project\\BI and sub-areas" }, ahead: { kind: "absent" } }, { area: "Contoso Project\\Finance" }));
    expect(lines[2]).toBe("scope:no: It's in area Contoso Project\\Finance, outside what FocusTime shows for Contoso (Area Contoso Project\\BI and sub-areas). Ahead shows it with Show the whole project; an admin sets the scope in Admin › Clients.");
    expect(lines.find((l) => l.startsWith("ahead"))).toBe("ahead:no: Ahead shows it only with Show the whole project (it's outside the scope).");
  });

  it("a type the process doesn't place", () => {
    const lines = text(facts({ ahead: { kind: "absent" }, todayTodo: false }, { tier: null, type: "Impediment" }));
    expect(lines).toContain("scope:no: Contoso's process doesn't place the type Impediment on a backlog level, so FocusTime's screens don't show it.");
    expect(lines).toContain("ahead:no: Ahead doesn't show it: Ahead shows epics, features and stories, not Impediment items.");
  });

  it("closed", () => {
    const lines = text(facts({ todayTodo: false, ahead: { kind: "absent" } }, { closed: true, state: "Closed" }));
    expect(lines).toContain("day:no: Day doesn't show it: it's Closed, and Day shows open to-dos.");
    expect(lines).toContain("week:no: Week doesn't show it: it's Closed. Your stories lists open ones.");
    expect(lines).toContain("ahead:no: Ahead doesn't show it: it's Closed, and Ahead shows open items.");
  });

  it("not mine (someone else's, or nobody's)", () => {
    expect(text(facts({ todayTodo: false }, { assignee: "someone" }))).toContain("week:no: Week's Your stories doesn't show it: it's assigned to someone else. Take one or assign it to yourself to see it there.");
    expect(text(facts({ todayTodo: false }, { assignee: "nobody" }))).toContain("week:no: Week's Your stories doesn't show it: it's not assigned to anyone. Take one or assign it to yourself to see it there.");
  });

  it("filtered in Ahead", () => {
    expect(text(facts({ ahead: { kind: "filtered", filter: "owner", owner: "mine" } }))).toContain("ahead:no: Ahead hides it: your owner filter for Contoso is Mine. Choose All to see it.");
    expect(text(facts({ ahead: { kind: "filtered", filter: "dates" } }))).toContain("ahead:no: Ahead hides it: the Dates filter is on.");
  });

  it("a new unassigned feature with no parent", () => {
    const lines = text(facts({ todayTodo: false, weekPlanned: false, status: { kind: "absent", featureId: 42 } }, { tier: "feature", type: "Feature", assignee: "nobody", parentId: null, state: "New" }));
    expect(lines).toContain("day:no: Day doesn't show it: Day shows to-dos, and a Feature shows there only as This week's chip once it's on the week's plan.");
    expect(lines).toContain("week:no: Week's cards don't show it: it isn't on this week's plan. Add it in Week › Plan.");
    expect(lines).toContain("status:no: Status doesn't show it unless you commented on it this week: Status lists features on this week's plan, open ones assigned to you, and ones you worked on this week.");
  });
});
