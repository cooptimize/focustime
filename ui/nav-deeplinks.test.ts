// CV-2 (IB-1: now #/inbox/item/<key>): Inbox deep links for one conversation or promise, and Settings and Admin sections with a hyphen (Q-ADM2-4).
import { describe, expect, it } from "vitest";
import { hashOf, navOf, parseHash } from "./nav.ts";
import { ADMIN_PARTS, CLIENT_TABS, OLD_ADMIN_SECTIONS, PART_TABS } from "./settings/admin/places.ts";

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
  // SA-4: Admin is its own place, #/admin…; every old #/settings/admin-<x> address lands on its new place.
  const admin = (path: string | null) => ({ nav: navOf.today(), overlay: { kind: "settings", section: "admin", setting: path } });
  it("lands every old Admin address on its new place, and writes the new address", () => {
    const landing: [string, string | null, string][] = [
      ["#/settings/admin-clients", "clients", "#/admin/clients"],
      ["#/settings/admin-ai", "defaults/ai", "#/admin/defaults/ai"],
      ["#/settings/admin-conversations", "defaults/chats", "#/admin/defaults/chats"],
      ["#/settings/admin-people", "people", "#/admin/people"],
      ["#/settings/admin-people/whos-set-up", "people/setup", "#/admin/people/setup"],
      ["#/settings/admin-organization", "defaults/planning", "#/admin/defaults/planning"],
      ["#/settings/admin-standards", "defaults/standards", "#/admin/defaults/standards"],
      ["#/settings/admin-status", "health", "#/admin/health"],
      ["#/settings/admin-audit", "audit", "#/admin/audit"],
      ["#/settings/admin-audit/code-views", "audit/code", "#/admin/audit/code"],
    ];
    expect(Object.keys(OLD_ADMIN_SECTIONS)).toHaveLength(8);
    for (const [old, path, now] of landing) {
      const l = parseHash(old);
      expect(l, old).toEqual(admin(path));
      expect(hashOf(l!), old).toBe(now);
    }
    // A retired one (Work templates) stays a Settings address; Settings sends it where it went before.
    expect(parseHash("#/settings/admin-templates")).toEqual({ nav: navOf.today(), overlay: { kind: "settings", section: "admin-templates" } });
  });
  it("opens every new Admin address and writes it back the same", () => {
    const all = ["#/admin", "#/admin/clients", "#/admin/clients/Atlas", "#/admin/clients/Harbor%20Co/chats", ...ADMIN_PARTS.map(([p]) => `#/admin/${p}`), ...CLIENT_TABS.map(([t]) => `#/admin/clients/Atlas/${t}`)];
    for (const p of ["people", "defaults", "audit"] as const) for (const [t] of PART_TABS[p]) all.push(`#/admin/${p}/${t}`);
    for (const h of all) {
      const l = parseHash(h);
      expect(l, h).not.toBeNull();
      expect(hashOf(l!), h).toBe(h);
    }
    expect(parseHash("#/admin/clients/Harbor%20Co/chats")).toEqual(admin("clients/Harbor Co/chats"));
  });
  it("refuses what isn't an Admin place", () => {
    for (const bad of ["#/admin/nope", "#/admin/health/x", "#/admin/people/nope", "#/admin/clients/Atlas/nope", "#/admin/clients/Atlas/chats/x", "#/admin/defaults/ai/x", "#/admin/clients/%E0%A4%A"]) expect(parseHash(bad), bad).toBeNull();
  });
  it("still refuses what isn't a section name", () => {
    for (const bad of ["#/settings/admin-", "#/settings/-audit", "#/settings/admin--audit", "#/settings/admin-audit-x", "#/settings/Admin-Audit", "#/settings/admin_audit", "#/settings/a"]) expect(parseHash(bad), bad).toBeNull();
  });
});
