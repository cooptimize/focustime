// CV-2 (IB-1: now #/inbox/item/<key>): Inbox deep links for one conversation or promise, and Settings and Admin sections with a hyphen (Q-ADM2-4).
import { describe, expect, it } from "vitest";
import { hashOf, navOf, parseHash } from "./nav.ts";
import { ADMIN_UI_SECTIONS } from "./settings/Admin.tsx";

describe("Inbox deep links", () => {
  it("opens one conversation or one promise, and writes the same address back", () => {
    expect(parseHash("#/inbox/conversation/42")).toEqual({ nav: navOf.conversation(42), overlay: null });
    expect(parseHash("#/inbox/promise/7")).toEqual({ nav: navOf.promise(7), overlay: null });
    expect(hashOf({ nav: navOf.conversation(42), overlay: null })).toBe("#/inbox/item/v42");
    expect(hashOf({ nav: navOf.promise(7), overlay: null })).toBe("#/inbox/item/c7");
    // The lists themselves are unchanged.
    expect(hashOf({ nav: navOf.conversations(), overlay: null })).toBe("#/inbox/chats");
    expect(hashOf({ nav: navOf.myPromises(), overlay: null })).toBe("#/inbox/promises");
  });
  it("refuses an id that isn't one", () => {
    for (const bad of ["#/inbox/conversation", "#/inbox/conversation/0", "#/inbox/conversation/x", "#/inbox/promise/-1", "#/inbox/promise/1/2", "#/inbox/conversation/12345678901"]) expect(parseHash(bad), bad).toBeNull();
  });
});

describe("Settings and Admin sections", () => {
  it("opens every Admin section from its address", () => {
    expect(ADMIN_UI_SECTIONS).toHaveLength(8);
    for (const [id] of ADMIN_UI_SECTIONS) {
      const l = parseHash(`#/settings/${id}`);
      expect(l, id).toEqual({ nav: navOf.today(), overlay: { kind: "settings", section: id } });
      expect(hashOf(l!)).toBe(`#/settings/${id}`);
    }
  });
  it("still refuses what isn't a section name", () => {
    for (const bad of ["#/settings/admin-", "#/settings/-audit", "#/settings/admin--audit", "#/settings/admin-audit-x", "#/settings/Admin-Audit", "#/settings/admin_audit", "#/settings/a"]) expect(parseHash(bad), bad).toBeNull();
  });
});
