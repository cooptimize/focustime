import { describe, expect, it } from "vitest";
import { allows, eventEdit, outlookLink, tierOf, type EditFacts } from "./caltier.ts";

const ol = { source: "outlook" as const, allDay: false };
const facts = (over: Partial<EditFacts> = {}): EditFacts => ({ isOrganizer: true, others: 0, recurring: false, allDay: false, marker: null, webLink: "https://outlook.office365.com/calendar/item/X", ...over });
const TB = "tb-0b6c1d2e-3f40-4152-8a6b-7c8d9e0f1a2b";
const INV = "inv-0b6c1d2e-3f40-4152-8a6b-7c8d9e0f1a2b";

describe("calendar editing tiers (FocusTime only edits what it created or what only I can see)", () => {
  it("puts each event in one tier", () => {
    expect(tierOf(ol, facts({ marker: TB }))).toBe("focustime");
    expect(tierOf(ol, facts({ marker: INV, others: 2 }))).toBe("invite");
    expect(tierOf(ol, facts())).toBe("mine");
    expect(tierOf(ol, facts({ others: 1 }))).toBe("meeting");
    expect(tierOf(ol, facts({ isOrganizer: false }))).toBe("meeting");
    expect(tierOf(ol, null)).toBe("unknown");
    expect(tierOf({ source: "google" }, facts())).toBe("readonly");
    // A marker that isn't FocusTime's shape gives no rights.
    expect(tierOf(ol, facts({ marker: "evil", others: 3 }))).toBe("meeting");
  });

  it("FocusTime events: move, resize, retitle, show as and delete", () => {
    const x = eventEdit(ol, facts({ marker: TB }), true);
    for (const a of ["move", "resize", "retitle", "show_as", "delete", "open"] as const) expect(allows(x, a)).toBe(true);
    expect(allows(x, "cancel")).toBe(false);
  });

  it("my own events with nobody else: move, resize and show as; never title or delete; repeating and all-day ones stay in Outlook", () => {
    const x = eventEdit(ol, facts(), true);
    expect(["move", "resize", "show_as", "open"].every((a) => allows(x, a as never))).toBe(true);
    expect(x.actions.find((a) => a.id === "retitle")).toMatchObject({ allowed: false, reason: expect.stringMatching(/never changes the title/) });
    expect(x.actions.find((a) => a.id === "delete")).toMatchObject({ allowed: false, reason: expect.stringMatching(/only deletes events it created/) });
    const rep = eventEdit(ol, facts({ recurring: true }), true);
    expect(allows(rep, "move")).toBe(false);
    expect(rep.actions.find((a) => a.id === "move")!.reason).toMatch(/repeating/i);
    expect(allows(eventEdit({ source: "outlook", allDay: true }, facts({ allDay: true }), true), "resize")).toBe(false);
  });

  it("meetings with others are never edited: only Open in Outlook, each other action says why", () => {
    const x = eventEdit(ol, facts({ others: 3 }), true);
    expect(x.actions.filter((a) => a.allowed).map((a) => a.id)).toEqual(["open"]);
    expect(x.actions.filter((a) => !a.allowed && a.id !== "rsvp").every((a) => /Others are on this meeting/.test(a.reason!))).toBe(true);
    expect(x.actions.find((a) => a.id === "rsvp")!.reason).toMatch(/You organize this meeting/);
  });

  it("a meeting someone else invited me to can be answered, and still never edited (step 16, D283)", () => {
    const x = eventEdit(ol, facts({ others: 3, isOrganizer: false }), true);
    expect(x.tier).toBe("meeting");
    expect(x.actions.filter((a) => a.allowed).map((a) => a.id)).toEqual(["open", "rsvp"]);
    expect(eventEdit(ol, facts({ isOrganizer: true, others: 0 }), true).actions.find((a) => a.id === "rsvp")!.allowed).toBe(false);
    expect(eventEdit(ol, facts({ others: 3, isOrganizer: false }), false).actions.find((a) => a.id === "rsvp")!.allowed).toBe(false);
  });

  it("help invites can only be cancelled", () => {
    const x = eventEdit(ol, facts({ marker: INV, others: 2 }), true);
    expect(x.actions.filter((a) => a.allowed).map((a) => a.id).sort()).toEqual(["cancel", "open"]);
  });

  it("without write access nothing is editable and the reason says how to allow it", () => {
    const x = eventEdit(ol, facts(), false);
    expect(x.actions.filter((a) => a.allowed).map((a) => a.id)).toEqual(["open"]);
    expect(x.actions.find((a) => a.id === "move")!.reason).toMatch(/Settings > Connections/);
    expect(eventEdit({ source: "google", allDay: false }, null, true).actions.every((a) => !a.allowed)).toBe(true);
  });

  it("opens only Outlook on the web links", () => {
    expect(outlookLink("https://outlook.office365.com/owa/?itemid=AAMk&exvsurl=1&path=/calendar/item")).toBeTruthy();
    expect(outlookLink("https://outlook.office.com/calendar/item/X")).toBeTruthy();
    for (const u of ["http://outlook.office.com/x", "https://evil.example/outlook.office.com", "https://user:pw@outlook.office.com/", "javascript:alert(1)", 5]) expect(outlookLink(u)).toBeNull();
  });
});
