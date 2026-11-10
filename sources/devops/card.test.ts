// FN-1: the story card's DevOps read, parsed: the item, its parent and epic and children from the relations, the
// comments newest first without deleted ones, and the type's size field by its own name.
import { describe, expect, it } from "vitest";
import { parseCard, parseCardComments, relatedIds } from "./card.ts";

const rel = (rel: string, id: number) => ({ rel, url: `https://dev.azure.com/contoso/_apis/wit/workItems/${id}` });
const raw = {
  id: 7,
  fields: { "System.Title": "CSV export", "System.WorkItemType": "User Story", "System.State": "Active", "System.AssignedTo": { displayName: "Sam Tester", uniqueName: "sam@cooptimize.example" }, "Microsoft.VSTS.Scheduling.StoryPoints": 3, "Microsoft.VSTS.Scheduling.TargetDate": "2026-11-20T00:00:00Z", "System.Description": "<p>All rows</p>" },
  relations: [rel("System.LinkTypes.Hierarchy-Reverse", 40), rel("System.LinkTypes.Hierarchy-Forward", 8), rel("System.LinkTypes.Hierarchy-Forward", 9), rel("System.LinkTypes.Related", 11)],
};
const related = [
  { id: 40, fields: { "System.Title": "Billing", "System.WorkItemType": "Feature", "System.State": "Active", "System.Parent": 4 } },
  { id: 4, fields: { "System.Title": "Finance", "System.WorkItemType": "Epic", "System.State": "New" } },
  { id: 8, fields: { "System.Title": "Header row", "System.WorkItemType": "Task", "System.State": "Closed" } },
];

describe("the story card's read", () => {
  it("parent, epic and children come from the relations; a child DevOps didn't return is left out", () => {
    expect(relatedIds(raw)).toEqual({ parent: 40, children: [8, 9] });
    const c = parseCard({ raw, url: "u", related, comments: null, category: () => "InProgress", sizeLabel: () => "Story Points", typeHas: new Set(["Microsoft.VSTS.Scheduling.StoryPoints"]) })!;
    expect(c.parent).toEqual({ id: 40, title: "Billing", type: "Feature", state: "Active" });
    expect(c.grandparent?.title).toBe("Finance");
    expect(c.children.map((x) => x.id)).toEqual([8]);
    expect(c).toMatchObject({ assignee: "Sam Tester", size: { label: "Story Points", value: 3 }, target: "2026-11-20", hasRemainingWork: false, descriptionHtml: "<p>All rows</p>" });
  });
  it("comments skip deleted ones and keep the total", () => {
    const r = parseCardComments({ totalCount: 12, comments: [{ id: 2, text: "<p>b</p>", createdDate: "2026-11-02T10:00:00Z", createdBy: { displayName: "Dana Ruiz" } }, { id: 1, text: "x", isDeleted: true }] });
    expect(r.comments.map((c) => [c.id, c.author])).toEqual([[2, "Dana Ruiz"]]);
    expect(r.count).toBe(12);
  });
  it("no title: nothing to show", () => {
    expect(parseCard({ raw: { id: 7, fields: {} }, url: "u", related: [], comments: null, category: () => null, sizeLabel: () => "", typeHas: null })).toBeNull();
  });
});
