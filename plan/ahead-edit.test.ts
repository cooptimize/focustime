import { describe, expect, it } from "vitest";
import { byItem, canEdit, checkValue, conflictOf, pendingText, readOnlyNote, rungOf, sameValue, valueText, type StagedChange } from "./ahead-edit.ts";

// A three-rung ladder: top (epics), parent (features), child (stories). Names only label the rungs here.
const ladder = [["E"], ["F"], ["S"]];
const at = (type: string, email: string | null) => ({ assigneeEmail: email, rung: rungOf(ladder, type) });
const me = { email: "avery@example.com", lead: false, automation: false };

describe("who can edit (D652)", () => {
  it("a lead edits anything of the client", () => {
    expect(canEdit({ ...me, lead: true }, at("S", "dana@example.com"), at("F", "dana@example.com"), "Contoso")).toEqual({ ok: true, why: "lead" });
  });
  it("the owner edits their own item, compared without case", () => {
    expect(canEdit(me, at("S", "Avery@Example.com"), null, "Contoso")).toEqual({ ok: true, why: "owner" });
  });
  it("a feature's owner edits its stories; an epic's owner its features, one level only", () => {
    expect(canEdit(me, at("S", "dana@example.com"), at("F", me.email), "Contoso")).toEqual({ ok: true, why: "parent_owner" });
    expect(canEdit(me, at("F", null), at("E", me.email), "Contoso")).toEqual({ ok: true, why: "parent_owner" });
    // A story whose parent is (oddly) an epic: two rungs apart, not one.
    expect(canEdit(me, at("S", null), at("E", me.email), "Contoso").ok).toBe(false);
  });
  it("anyone else reads only, with the note", () => {
    expect(canEdit(me, at("S", "dana@example.com"), at("F", "dana@example.com"), "Contoso")).toEqual({ ok: false, note: readOnlyNote("Contoso") });
    expect(readOnlyNote("Contoso")).toBe("Only Contoso's leads and the owner can change this.");
  });
  it("an automation account never edits, even as lead or owner", () => {
    expect(canEdit({ ...me, lead: true, automation: true }, at("S", me.email), null, "Contoso").ok).toBe(false);
  });
});

describe("change values", () => {
  it("checks values per field", () => {
    expect(checkValue("target", "2026-11-20")).toBe("2026-11-20");
    expect(() => checkValue("target", "2026-02-30")).toThrow();
    expect(checkValue("size", 3)).toBe(3);
    expect(() => checkValue("size", -1)).toThrow();
    expect(checkValue("assignee", { email: " Dana@Example.com ", name: "Dana" })).toEqual({ email: "dana@example.com", name: "Dana" });
    expect(checkValue("assignee", null)).toBeNull();
  });
  it("a conflict only when this field changed since editing began (D654)", () => {
    expect(conflictOf({ field: "target", baseValue: "2026-11-20" }, "2026-11-20")).toEqual({ conflict: false });
    expect(conflictOf({ field: "target", baseValue: "2026-11-20" }, "2026-11-27")).toEqual({ conflict: true, theirs: "2026-11-27" });
    expect(sameValue("assignee", { email: "A@x.com", name: "A" }, { email: "a@x.com", name: "Other name" })).toBe(true);
  });
  it("groups by item in the order made, fields in a fixed order; words for the review", () => {
    const c = (itemId: number, field: StagedChange["field"], createdAt: string): StagedChange => ({ clientKey: "k", itemId, field, value: null, half: null, baseRev: 1, baseValue: null, createdAt, updatedAt: createdAt });
    const g = byItem([c(2, "size", "b"), c(1, "assignee", "c"), c(2, "start", "d")]);
    expect(g.map((x) => [x.itemId, x.changes.map((y) => y.field)])).toEqual([[2, ["start", "size"]], [1, ["assignee"]]]);
    expect(pendingText(7)).toBe("7 changes pending");
    expect(pendingText(0)).toBeNull();
    expect(valueText("target", "2026-11-20", "PM")).toBe("Fri, Nov 20 PM");
    expect(valueText("assignee", null)).toBe("Nobody");
  });
});
