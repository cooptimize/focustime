// SA-5: Settings' one search. The 100 searches (search-cases.ts) each find their place first; the ranking keeps its
// order; every setting is found by its own label; Admin's results show only to admins; the command menu gives the
// same results in the same order; nothing found still answers.
import { describe, expect, it } from "vitest";
import { NOT_SETTINGS, SETTINGS } from "./registry.ts";
import { SEARCH_CASES } from "./search-cases.ts";
import { adminItems, nearest, rank, search, wordsOf } from "./search.ts";
import { searchAdmin } from "./admin/search.ts";
import { settingsResults } from "./menu-results.ts";

const everyone = { demo: true, dev: true, phone: true };

describe("the 100 searches", () => {
  it("are 100, from SA-0's 27 and what a consultant and an admin would type", () => {
    expect(SEARCH_CASES).toHaveLength(100);
    expect(SEARCH_CASES.filter((c) => c.from === "sa0-none")).toHaveLength(22);
    expect(SEARCH_CASES.filter((c) => c.from === "sa0-wrong")).toHaveLength(5);
    expect(new Set(SEARCH_CASES.map((c) => `${c.q}|${c.admin ?? false}`)).size).toBe(100);
  });
  it.each(SEARCH_CASES.map((c) => [c.q + (c.admin ? " (admin)" : ""), c] as const))("%s finds its place first", (_, c) => {
    const first = search(c.q, { demo: true, admin: !!c.admin })[0];
    expect([c.expect, ...(c.also ?? [])]).toContain(first?.id);
  });
});

describe("the order", () => {
  it("a section's name, then a whole word in a label, then a whole word among the other words, then part of a word", () => {
    const ws = wordsOf("timer");
    expect(rank(wordsOf("planning"), { label: "Planning" }, "section")?.tier).toBe(0);
    expect(rank(wordsOf("reminders"), { label: "Reminders and notices" }, "section")?.tier).toBe(1);
    expect(rank(ws, { label: "Focus timer" })?.tier).toBe(2);
    expect(rank(ws, { label: "Focus length", words: ["timer"] })?.tier).toBe(3);
    expect(rank(wordsOf("time"), { label: "Timelines" })?.tier).toBe(4);
    expect(rank(ws, { label: "Theme" })).toBeNull();
    // Ranks in that order across the whole search: "notifications" is the section before the settings that say it.
    const n = search("notifications");
    expect(n[0]?.id).toBe("section:notifications");
    expect(n.map((h) => h.tier)).toEqual([...n.map((h) => h.tier)].sort((a, b) => a - b));
  });
  it("two letters match only whole words: \"ai\" never finds a setting only because its label holds those letters", () => {
    const ai = search("ai", { ...everyone, admin: true });
    expect(ai[0]?.id).toBe("section:ai");
    for (const h of ai) expect(`${h.label} ${h.where}`, h.label).toMatch(/\bAI\b|assistant/i);
    expect(ai.some((h) => h.id === "setting:email" || h.id === "setting:push-details")).toBe(false);
  });
  it("leads where SA-0's findings expected: log out, ai, audit, push, admin", () => {
    expect(search("log out")[0]?.id).toBe("setting:signed-in");
    expect(search("ai")[0]?.label).toBe("AI and assistant");
    expect(search("audit", { admin: true })[0]).toMatchObject({ id: "admin:part:audit", where: "Admin" });
    expect(search("push")[0]?.id).toBe("setting:devices");
    expect(search("admin", { admin: true })[0]).toMatchObject({ id: "admin:place:admin", label: "Admin" });
  });
  it("a result says where it is", () => {
    expect(search("close out at")[0]).toMatchObject({ label: "Close out at", where: "Reminders and notices › Close out" });
    expect(search("stalled after")[0]).toMatchObject({ where: "Planning › Fine tuning › Backlog" });
    expect(search("show friday")[0]).toMatchObject({ label: "Show the catch-up day", matched: "Show Friday" });
  });
  it("the person's own come before Admin's when both fit as well", () => {
    const ai = search("ai", { admin: true });
    const firstAdmin = ai.findIndex((h) => h.kind === "admin");
    expect(firstAdmin).toBeGreaterThan(0);
    for (const h of ai.slice(0, firstAdmin)) expect(h.kind).not.toBe("admin");
  });
});

describe("every setting is found by its own label", () => {
  it.each(SETTINGS.map((d) => [d.id, d] as const))("%s", (_, d) => {
    const hits = search(d.label, { ...everyone, limit: 40 });
    const id = `${d.section === "client" ? "client" : "setting"}:${d.id}`;
    expect(hits.map((h) => h.id)).toContain(id);
    const h = hits.find((x) => x.id === id)!;
    // It opens at its place: its section and its own id (a client's page asks which client first).
    expect(h).toMatchObject({ section: d.section, setting: d.id });
  });
  it("and each thing that isn't a setting by its own name", () => {
    for (const n of NOT_SETTINGS) expect(search(n.label)[0]?.id, n.id).toBe(`answer:${n.id}`);
  });
});

describe("Admin's results", () => {
  const adminOnly = ["model", "positions to levels", "who's set up", "code views", "health", "standards repo", "monthly cap for everyone", "automation account"];
  it("show to an admin, marked Admin", () => {
    for (const q of adminOnly) {
      const h = search(q, { admin: true }).find((x) => x.kind === "admin");
      expect(h, q).toBeDefined();
      expect(h!.where, q).toMatch(/^Admin\b/);
      expect(h!.href, q).toMatch(/^#\/admin/);
    }
  });
  it("never to anyone else, in the results or the nearest", () => {
    for (const q of [...adminOnly, "admin", "audit", "allow ai", "team color", "modle", "standrds"]) {
      expect(search(q).some((h) => h.kind === "admin" || /^Admin\b/.test(h.where)), q).toBe(false);
      expect(nearest(q).some((h) => h.kind === "admin" || /^Admin\b/.test(h.where)), q).toBe(false);
    }
    // What someone who isn't an admin gets for Admin's own words is their own settings, or nothing.
    expect(search("positions to levels")).toEqual([]);
  });
  it("Search Admin ranks the same way: a part named exactly first, then a tab, a client or a person", () => {
    const at = { part: null, tab: null, client: null };
    expect(searchAdmin("audit", { clients: [], people: [], at })[0]).toMatchObject({ kind: "part", href: "#/admin/audit" });
    expect(searchAdmin("ai", { clients: [], people: [], at })[0]).toMatchObject({ kind: "tab", label: "AI" });
    expect(adminItems().filter((a) => a.id.startsWith("setting:")).length).toBeGreaterThan(30);
  });
});

describe("nothing found", () => {
  it("offers up to three nearest settings for a typo", () => {
    expect(search("notifcations")).toEqual([]);
    const n = nearest("notifcations");
    expect(n.length).toBeGreaterThan(0);
    expect(n.length).toBeLessThanOrEqual(3);
    expect(n[0]?.label).toBe("Reminders and notices");
    expect(nearest("zzqx")).toEqual([]);
  });
});

describe("the command menu's Settings results", () => {
  const env = { openSettings: () => {}, clients: [{ key: "Northwind", name: "Northwind" }, { key: "Atlas", name: "Atlas Freight" }], go: () => {} };
  it.each(["dark mode", "ai", "close out", "vacation", "rename client", "password", "audit", "model"])("%s: the same results in the same order as Settings' box", (q) => {
    for (const admin of [false, true]) {
      const box = search(q, { demo: true, admin });
      const menu = settingsResults(q, { demo: true, admin }, env);
      expect(menu.map((m) => m.id)).toEqual(box.map((b) => `settings.${b.id}`));
      expect(menu.every((m) => m.group === "Settings")).toBe(true);
    }
  });
  it("a client's page asks which client; Admin's are named as Admin's", () => {
    const rename = settingsResults("rename client", {}, env)[0]!;
    expect(rename.next?.()).toMatchObject({ title: "Shown as: which client?" });
    expect(settingsResults("model", { admin: true }, env)[0]?.label).toBe("Model (Admin)");
  });
});
