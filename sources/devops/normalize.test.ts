import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowPortfolio, backlogLevels, buildAllChildrenWiql, dateOnly, detectTargetField, levelOf, batchFields, buildWiql, categoriesFrom, detectOrderField, normalizeWorkItems, portfolioTiers, type StateCategories } from "./normalize.ts";
import { detectSizeField } from "./normalize.ts";

const fx = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"));
const typesWithStates = (name: string) => fx(`${name}-workitemtypes`).value as { name: string; states: { name: string; category: string }[] }[];
const scrumCategories = () =>
  categoriesFrom(["Product Backlog Item", "Task"].map((t) => ({ name: t, states: fx(`scrum-states-${t}`).value })));

describe("board order detection", () => {
  it("Agile, CMMI and Basic: StackRank from process configuration", () => {
    expect(detectOrderField(fx("agile-processconfiguration"))).toBe("Microsoft.VSTS.Common.StackRank");
  });
  it("Scrum: BacklogPriority", () => {
    expect(detectOrderField(fx("scrum-processconfiguration"))).toBe("Microsoft.VSTS.Common.BacklogPriority");
  });
  it("no Order entry: null, never a guess", () => {
    expect(detectOrderField(fx("custom-processconfiguration"))).toBeNull();
    expect(detectOrderField(null)).toBeNull();
    expect(detectOrderField({ typeFields: { Order: { referenceName: "bad name; DROP" } } })).toBeNull();
  });
  it("accepts a lowercase order key", () => {
    expect(detectOrderField({ typeFields: { order: { referenceName: "Custom.Rank" } } })).toBe("Custom.Rank");
  });
  it("asks the batch for the detected field and nothing beyond the fields used", () => {
    expect(batchFields("Microsoft.VSTS.Common.BacklogPriority")).toEqual([
      "System.Id", "System.Title", "System.WorkItemType", "System.State", "System.Parent", "System.ChangedDate", "System.Tags", "System.ChangedBy", "Microsoft.VSTS.Common.BacklogPriority",
    ]);
    expect(batchFields(null)).not.toContain(null);
  });
});

describe("state categories from each project's metadata", () => {
  it("Agile: Closed is Completed, Removed is Removed, custom Blocked is in progress", () => {
    const c = categoriesFrom(typesWithStates("agile"));
    expect(c.get("User Story")?.get("closed")).toBe("Completed");
    expect(c.get("Task")?.get("removed")).toBe("Removed");
    expect(c.get("Task")?.get("blocked")).toBe("InProgress");
  });
  it("Scrum: Done is Completed, Committed is in progress", () => {
    const c = scrumCategories();
    expect(c.get("Product Backlog Item")?.get("done")).toBe("Completed");
    expect(c.get("Product Backlog Item")?.get("committed")).toBe("InProgress");
  });
  it("the same state name can mean different things per type", () => {
    const c = categoriesFrom(typesWithStates("custom"));
    expect(c.get("Issue")?.get("done")).toBe("Completed");
    expect(c.get("Review")?.get("done")).toBe("InProgress");
  });
});

describe("WIQL for my open work", () => {
  it("filters per type on that type's done states, for me, in this project, in board order", () => {
    const q = buildWiql("tanner@client.com", categoriesFrom(typesWithStates("agile")), "Microsoft.VSTS.Common.StackRank");
    expect(q).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = 'tanner@client.com' AND (" +
        "([System.WorkItemType] = 'Bug' AND [System.State] NOT IN ('closed')) OR " +
        "([System.WorkItemType] = 'Epic' AND [System.State] NOT IN ('closed', 'removed')) OR " +
        "([System.WorkItemType] = 'Feature' AND [System.State] NOT IN ('closed', 'removed')) OR " +
        "([System.WorkItemType] = 'Task' AND [System.State] NOT IN ('closed', 'removed')) OR " +
        "([System.WorkItemType] = 'User Story' AND [System.State] NOT IN ('closed', 'removed'))" +
        ") ORDER BY [Microsoft.VSTS.Common.StackRank] ASC, [System.Id] ASC",
    );
  });
  it("keeps a type with a custom Done that is still in progress", () => {
    const q = buildWiql("me@x.com", categoriesFrom(typesWithStates("custom")), null);
    expect(q).toContain("([System.WorkItemType] = 'Issue' AND [System.State] NOT IN ('done'))");
    expect(q).toContain("([System.WorkItemType] = 'Review' AND [System.State] NOT IN ('signed off'))");
    expect(q).toContain("ORDER BY [System.ChangedDate] DESC");
  });
  it("a type with no done states matches on type alone; no sprint or iteration filter", () => {
    const c: StateCategories = new Map([["Feedback", new Map([["open", "Proposed"]])]]);
    const q = buildWiql("me@x.com", c, null);
    expect(q).toContain("([System.WorkItemType] = 'Feedback')");
    expect(q).not.toMatch(/Iteration|@CurrentIteration/);
  });
  it("escapes quotes in the email, type and state names", () => {
    const c: StateCategories = new Map([["Dev's Task", new Map([["won't do", "Removed"]])]]);
    const q = buildWiql("o'brien@x.com", c, null);
    expect(q).toContain("[System.AssignedTo] = 'o''brien@x.com'");
    expect(q).toContain("[System.WorkItemType] = 'Dev''s Task' AND [System.State] NOT IN ('won''t do')");
  });
});

describe("work item normalization", () => {
  const agileCtx = { org: "fabrikam", projectName: "Fabrikam Data", orderField: "Microsoft.VSTS.Common.StackRank", categories: categoriesFrom(typesWithStates("agile")) };

  it("gives portfolio items their tier from the backlog levels (step 13.6, D243)", () => {
    const levels = { known: true, story: new Set(["User Story"]), portfolio: new Set(["Feature", "Epic"]) };
    const tiers = { feature: new Set(["Feature"]), epic: new Set(["Epic"]) };
    const { items } = normalizeWorkItems(
      [
        { id: 1, fields: { "System.WorkItemType": "Epic", "System.State": "New" } },
        { id: 2, fields: { "System.WorkItemType": "Feature", "System.State": "New" } },
        { id: 3, fields: { "System.WorkItemType": "User Story", "System.State": "New" } },
      ],
      { ...agileCtx, levels, tiers } as never,
    );
    expect(items.map((i) => [i.id, i.level, i.tier])).toEqual([[1, "portfolio", "epic"], [2, "portfolio", "feature"], [3, "story", undefined]]);
  });
  it("reads tags and flags an item blocked by its state or a tag (step 7)", () => {
    const { items } = normalizeWorkItems(
      [
        { id: 1, fields: { "System.WorkItemType": "User Story", "System.State": "Active", "System.Tags": "Blocked; Data" } },
        { id: 2, fields: { "System.WorkItemType": "User Story", "System.State": "Active" } },
      ],
      agileCtx,
    );
    expect(items.map((i) => [i.id, i.tags, i.blocked])).toEqual([[1, ["Blocked", "Data"], true], [2, [], false]]);
  });
  it("reduces System.ChangedBy to changedByMe against my identity for the client, keeping no one's identity (Q42)", () => {
    const me = { ...agileCtx, me: "Tanner@Fabrikam.example" };
    const { items } = normalizeWorkItems(
      [
        { id: 1, fields: { "System.WorkItemType": "User Story", "System.State": "Active", "System.ChangedBy": { displayName: "Tanner S", uniqueName: "tanner@fabrikam.example", id: "x" } } },
        { id: 2, fields: { "System.WorkItemType": "User Story", "System.State": "Active", "System.ChangedBy": { displayName: "Dana", uniqueName: "dana@fabrikam.example" } } },
        { id: 3, fields: { "System.WorkItemType": "User Story", "System.State": "Active", "System.ChangedBy": "Tanner S <TANNER@fabrikam.example>" } },
        { id: 4, fields: { "System.WorkItemType": "User Story", "System.State": "Active" } },
      ],
      me,
    );
    expect(items.map((i) => [i.id, i.changedByMe])).toEqual([[1, true], [2, false], [3, true], [4, false]]);
    expect(JSON.stringify(items)).not.toMatch(/dana|Dana|tanner@/i);
    // Without my identity nothing counts as mine.
    expect(normalizeWorkItems([{ id: 1, fields: { "System.WorkItemType": "User Story", "System.State": "Active", "System.ChangedBy": { uniqueName: "tanner@fabrikam.example" } } }], agileCtx).items[0]!.changedByMe).toBe(false);
  });
  it("Agile: only the fields used, closed items dropped, board order with unranked last", () => {
    const { items, skipped } = normalizeWorkItems(fx("agile-batch").value, agileCtx);
    expect(skipped).toBe(0);
    expect(items.map((i) => i.id)).toEqual([102, 101, 105, 103]);
    expect(items[1]).toEqual({
      id: 101,
      title: "Load customer dimension",
      type: "User Story",
      state: "Active",
      stateCategory: "InProgress",
      level: "story",
      order: 2000.5,
      parentId: 90,
      changedAt: "2026-10-29T15:04:05.123Z",
      tags: [],
      blocked: false,
      changedByMe: false,
      url: "https://dev.azure.com/fabrikam/Fabrikam%20Data/_workitems/edit/101",
    });
    expect(items.find((i) => i.id === 105)?.stateCategory).toBe("Resolved");
    expect(items.find((i) => i.id === 103)).toMatchObject({ order: null, parentId: 101, stateCategory: "InProgress" });
  });

  it("Scrum: orders by BacklogPriority", () => {
    const { items } = normalizeWorkItems(fx("scrum-batch").value, { org: "contoso", projectName: "BI", orderField: "Microsoft.VSTS.Common.BacklogPriority", categories: scrumCategories() });
    expect(items.map((i) => [i.id, i.order])).toEqual([[202, 2], [201, 5]]);
  });

  it("custom process: Review in Done stays (in progress), no order field means order null", () => {
    const { items } = normalizeWorkItems(fx("custom-batch").value, { org: "o", projectName: "p", orderField: null, categories: categoriesFrom(typesWithStates("custom")) });
    expect(items.map((i) => [i.id, i.stateCategory, i.order])).toEqual([[301, "InProgress", null], [302, "InProgress", null]]);
  });

  it("skips items the batch omitted (null) or without an id, and titles missing text", () => {
    const { items, skipped } = normalizeWorkItems([null, { fields: {} }, { id: 7, fields: { "System.Title": " ", "System.WorkItemType": "Bug", "System.State": "New" } }], agileCtx);
    expect(skipped).toBe(2);
    expect(items[0]?.title).toBe("(No title)");
  });

  it("an unknown state is kept and labeled Unknown rather than hidden", () => {
    const { items } = normalizeWorkItems([{ id: 8, fields: { "System.WorkItemType": "Bug", "System.State": "Triage" } }], agileCtx);
    expect(items[0]?.stateCategory).toBe("Unknown");
  });
});

describe("sanitized recorded responses (a real client project, custom inherited process)", () => {
  const types = fx("recorded-workitemtypes").value as { name: string; states: { name: string; category: string }[] }[];
  const categories = categoriesFrom(types);

  it("detects StackRank and reads custom numbered states from metadata", () => {
    expect(detectOrderField(fx("recorded-processconfiguration"))).toBe("Microsoft.VSTS.Common.StackRank");
    expect(categories.get("User Story")?.get("01-new")).toBe("Proposed");
    expect(categories.get("User Story")?.get("03-resolved")).toBe("Resolved");
  });

  it("the same state name maps per type: Ready for Go-live is done for Bug, still open for Issue", () => {
    expect(categories.get("Bug")?.get("ready for go-live")).toBe("Completed");
    expect(categories.get("Issue")?.get("ready for go-live")).toBe("Resolved");
    const q = buildWiql("me@x.com", categories, "Microsoft.VSTS.Common.StackRank");
    expect(q).toContain("([System.WorkItemType] = 'Bug' AND [System.State] NOT IN ('ready for go-live'))");
    expect(q).toMatch(/\(\[System\.WorkItemType\] = 'Issue' AND \[System\.State\] NOT IN \('closed', '99-not applicable', '11-cancelled'\)\)/);
  });

  it("a state the process puts in Removed (here a Blocked state) is not shown, as the metadata says", () => {
    expect(categories.get("Task")?.get("10-blocked")).toBe("Removed");
    const { items } = normalizeWorkItems([{ id: 1, fields: { "System.WorkItemType": "Task", "System.State": "10-Blocked" } }], { org: "o", projectName: "p", orderField: null, categories });
    expect(items).toEqual([]);
  });

  it("normalizes the recorded batch: requested fields only, board order, parent", () => {
    const { items, skipped } = normalizeWorkItems(fx("recorded-batch").value, { org: "sanitized", projectName: "Sanitized Project", orderField: "Microsoft.VSTS.Common.StackRank", categories });
    expect(skipped).toBe(0);
    expect(items.map((i) => [i.id, i.type, i.state, i.stateCategory, i.order, i.parentId])).toEqual([
      [9001, "User Story", "01-New", "Proposed", 399962500, 8000],
      [9002, "User Story", "01-New", "Proposed", 399963750, 8001],
    ]);
    expect(items[0]!.url).toBe("https://dev.azure.com/sanitized/Sanitized%20Project/_workitems/edit/9001");
  });
});

describe("pickable portfolio allowlist (Q20)", () => {
  // Cooptimize's real backlog categories (read Oct 31): Epic and Domain, then Feature, Recurring and Ongoing.
  const coop = backlogLevels({
    requirementBacklog: { workItemTypes: [{ name: "User Story" }] },
    taskBacklog: { workItemTypes: [{ name: "Task" }] },
    portfolioBacklogs: [{ workItemTypes: [{ name: "Epic" }, { name: "Domain" }] }, { workItemTypes: [{ name: "Feature" }, { name: "Recurring" }, { name: "Ongoing" }] }],
  });
  it("Recurring becomes pickable; Domain, Epic, Feature and Ongoing stay portfolio", () => {
    const l = allowPortfolio(coop, ["recurring"]);
    expect(levelOf("Recurring", l)).toBe("story");
    expect(["Domain", "Epic", "Feature", "Ongoing"].map((t) => levelOf(t, l))).toEqual(["portfolio", "portfolio", "portfolio", "portfolio"]);
  });
  it("an empty list, or a type that isn't portfolio, changes nothing", () => {
    expect(allowPortfolio(coop, [])).toBe(coop);
    expect(levelOf("Review", allowPortfolio(coop, ["Review"]))).toBe("other");
  });
});

describe("Plan the week: portfolio tiers and target dates (step 8)", () => {
  it("the lowest portfolio backlog is the feature tier; any above it is the epic tier (backlog levels, not type names)", () => {
    expect(portfolioTiers(fx("agile-processconfiguration"))).toEqual({ feature: new Set(["Feature"]), epic: new Set(["Epic"]) });
    expect(portfolioTiers(fx("recorded-processconfiguration"))).toEqual({ feature: new Set(["Feature"]), epic: new Set(["Epic"]) });
    // Basic: Epic sits right above Issue, so Epic is what weeks commit to.
    expect(portfolioTiers(fx("custom-processconfiguration"))).toEqual({ feature: new Set(["Epic"]), epic: new Set() });
    // A renamed or extra level follows its place, not its name.
    const pc = { portfolioBacklogs: [{ workItemTypes: [{ name: "Initiative" }] }, { workItemTypes: [{ name: "Epic" }] }, { workItemTypes: [{ name: "Capability" }] }] };
    expect(portfolioTiers(pc)).toEqual({ feature: new Set(["Capability"]), epic: new Set(["Initiative", "Epic"]) });
    expect(portfolioTiers(null)).toEqual({ feature: new Set(), epic: new Set() });
  });
  it("detects the target date field per process: the standard TargetDate, else a date field named like a target", () => {
    const fields = [
      { referenceName: "Microsoft.VSTS.Scheduling.StartDate", name: "Start Date", type: "dateTime" },
      { referenceName: "Microsoft.VSTS.Scheduling.TargetDate", name: "Target Date", type: "dateTime" },
      { referenceName: "Custom.EstimatedCompletion", name: "Estimated Completion", type: "dateTime" },
      { referenceName: "Custom.TargetNotes", name: "Target notes", type: "string" },
      { referenceName: "Microsoft.VSTS.Common.ClosedDate", name: "Closed Date", type: "dateTime" },
    ];
    expect(detectTargetField(fields, new Set(["Microsoft.VSTS.Scheduling.TargetDate", "Custom.EstimatedCompletion"]))).toBe("Microsoft.VSTS.Scheduling.TargetDate");
    expect(detectTargetField(fields, new Set(["Custom.EstimatedCompletion", "Custom.TargetNotes", "Microsoft.VSTS.Common.ClosedDate"]))).toBe("Custom.EstimatedCompletion");
    // Only fields the type has, only dates, never a system date like Closed Date.
    expect(detectTargetField(fields, new Set(["Custom.TargetNotes", "Microsoft.VSTS.Common.ClosedDate", "Microsoft.VSTS.Scheduling.StartDate"]))).toBeNull();
    expect(detectTargetField(fields, new Set())).toBeNull();
  });
  it("reads a date field as a calendar date: midnight UTC as stored, else the local date", () => {
    expect(dateOnly("2026-11-20T00:00:00Z", "America/New_York")).toBe("2026-11-20");
    expect(dateOnly("2026-11-20T05:00:00Z", "America/New_York")).toBe("2026-11-20");
    expect(dateOnly("2026-11-21T03:00:00Z", "America/New_York")).toBe("2026-11-20");
    expect(dateOnly("not a date", "America/New_York")).toBeNull();
    expect(dateOnly(undefined, "America/New_York")).toBeNull();
  });
  it("children of portfolio items in every state, any assignee", () => {
    const q = buildAllChildrenWiql([210, 220], "Microsoft.VSTS.Common.StackRank");
    expect(q).toBe("SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Parent] IN (210, 220) ORDER BY [Microsoft.VSTS.Common.StackRank] ASC, [System.Id] ASC");
  });
  it("keeps assignee display names (never emails) and the target date when asked", () => {
    const ctx = { org: "o", projectName: "p", orderField: null, categories: categoriesFrom(typesWithStates("agile")), me: "tanner@o.example", people: true, targetFields: { Feature: "Microsoft.VSTS.Scheduling.TargetDate" }, timeZone: "America/New_York", keepDone: true };
    const { items } = normalizeWorkItems(
      [
        { id: 1, fields: { "System.WorkItemType": "Feature", "System.State": "Active", "System.AssignedTo": { displayName: "Dana Ruiz", uniqueName: "dana@o.example" }, "Microsoft.VSTS.Scheduling.TargetDate": "2026-11-20T05:00:00Z" } },
        { id: 2, fields: { "System.WorkItemType": "User Story", "System.State": "Closed", "System.AssignedTo": { displayName: "Tanner S", uniqueName: "Tanner@o.example" } } },
        { id: 3, fields: { "System.WorkItemType": "User Story", "System.State": "New" } },
      ],
      ctx,
    );
    expect(items.map((i) => [i.id, i.assignedTo, i.assignedToMe, i.targetDate ?? null])).toEqual([[1, "Dana Ruiz", false, "2026-11-20"], [2, "Tanner S", true, null], [3, null, false, null]]);
    expect(JSON.stringify(items)).not.toContain("@o.example");
  });
});

describe("size field (step 16, D279)", () => {
  const f = (referenceName: string, name: string, type = "double") => ({ referenceName, name, type });
  it("takes Story Points, then Effort, then Size, from the project's field list", () => {
    expect(detectSizeField([f("Microsoft.VSTS.Scheduling.Effort", "Effort"), f("Microsoft.VSTS.Scheduling.StoryPoints", "Story Points")])).toBe("Microsoft.VSTS.Scheduling.StoryPoints");
    expect(detectSizeField([f("Microsoft.VSTS.Scheduling.Size", "Size"), f("Microsoft.VSTS.Scheduling.Effort", "Effort")])).toBe("Microsoft.VSTS.Scheduling.Effort");
    expect(detectSizeField([f("Custom.Points", "Points")])).toBeNull();
  });
});
