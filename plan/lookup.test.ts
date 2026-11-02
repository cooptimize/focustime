import { describe, expect, it } from "vitest";
import type { WorkItem } from "../week/types.ts";
import { lookupItems, parseItemRef } from "./lookup.ts";

const wi = (id: number, title: string, order = id): WorkItem => ({ id, title, type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order, parentId: null, changedAt: "", url: `https://dev.azure.com/o/p/_workitems/edit/${id}` });
// Mine (assigned), in board order; children of my features (anyone's); committed features of the week.
const work = { items: [wi(30, "Fix login timeout"), wi(31, "Update README")], children: [wi(41, "Monthly report"), wi(42, "Export to CSV")], committed: [wi(50, "Order history export")] };

describe("lookupItems (the shared work item lookup, step 15.2)", () => {
  it("with nothing typed: this week's priorities first, then my assigned items, then the rest", () => {
    expect(lookupItems("", work, new Set([42])).map((i) => i.id)).toEqual([42, 30, 31, 41, 50]);
  });
  it("matches the title, any case", () => {
    expect(lookupItems("export", work, new Set()).map((i) => i.id)).toEqual([42, 50]);
    expect(lookupItems("EXPORT", work, new Set([50])).map((i) => i.id)).toEqual([50, 42]);
  });
  it("matches #id or a bare id, an exact id first", () => {
    expect(lookupItems("#4", work, new Set()).map((i) => i.id)).toEqual([41, 42]);
    expect(lookupItems("42", work, new Set()).map((i) => i.id)).toEqual([42]);
    expect(lookupItems("3", work, new Set()).map((i) => i.id)).toEqual([30, 31]);
  });
  it("lists each item once and stops at the limit", () => {
    const dup = { items: [wi(30, "A")], children: [wi(30, "A")] };
    expect(lookupItems("", dup, new Set()).map((i) => i.id)).toEqual([30]);
    expect(lookupItems("", work, new Set(), 2)).toHaveLength(2);
  });
  it("finds nothing without DevOps", () => expect(lookupItems("x", undefined, new Set())).toEqual([]));
});

describe("parseItemRef (Enter on text that matched nothing)", () => {
  it("reads #123 or 123 as an id; anything else stays plain text", () => {
    expect(parseItemRef("#123")).toBe(123);
    expect(parseItemRef(" 77 ")).toBe(77);
    expect(parseItemRef("fix the 2 bugs")).toBeNull();
    expect(parseItemRef("#0")).toBeNull();
  });
});
