// ST-1: the Settings registry is one consistent list: ids unique, every setting in a section that exists, old section
// ids still land, and search finds settings by their new and their old labels (and hides developer and demo rows).
import { describe, expect, it } from "vitest";
import { OLD_SECTIONS, SECTIONS, SETTINGS, SETTINGS_GROUPS, resolveSettings, sectionOf, settingOf, settingsHref } from "./registry.ts";
import { search, type SearchOpts } from "./search.ts";

/** SA-5: these tests read results the way ST-1's search returned them; the search is ui/settings/search.ts now. */
const searchSettings = (q: string, o: SearchOpts = {}) => search(q, o).map((r) => ({ kind: r.kind, section: r.section, setting: r.kind === "section" ? null : (r.setting ?? null), label: r.label, where: r.where, matched: r.matched }));

describe("Settings registry", () => {
  it("has unique ids, known groups and sections, and a description for every section", () => {
    const sections = SECTIONS.map((s) => s.id);
    expect(new Set(sections).size).toBe(sections.length);
    const settings = SETTINGS.map((s) => s.id);
    expect(new Set(settings).size).toBe(settings.length);
    const groups = new Set(SETTINGS_GROUPS.map(([g]) => g));
    for (const s of SECTIONS) {
      expect(groups.has(s.group), s.id).toBe(true);
      expect(s.description.length, s.id).toBeGreaterThan(10);
      expect(s.description, s.id).not.toMatch(/—/);
      if (s.parent) expect(sectionOf(s.parent), s.id).toBeDefined();
    }
    for (const d of SETTINGS) {
      expect(sectionOf(d.section), d.id).toBeDefined();
      expect(d.label, d.id).not.toMatch(/—/);
      expect(d.id, d.id).toMatch(/^[a-z0-9-]+$/);
    }
    // Admin stays its own console: no Admin section in the person's registry.
    expect(sections.filter((id) => id.startsWith("admin"))).toEqual([]);
  });

  it("App secrets are gone from Settings (secrets only through the scripts)", () => {
    // The one row that says "secrets" is the notice kind about a person's own expiring PATs, not an app secret.
    expect(SETTINGS.find((d) => /secret/i.test(`${d.id} ${d.label}`) && d.id !== "notify-expiry")).toBeUndefined();
    expect(searchSettings("app secrets", { dev: true, demo: true })).toEqual([]);
  });

  it("old section ids open their new section, and the setting where it moved inside one", () => {
    for (const [old, to] of Object.entries(OLD_SECTIONS)) {
      expect(sectionOf(old), old).toBeUndefined();
      expect(sectionOf(to.section), old).toBeDefined();
      if (to.setting) expect(settingOf(to.setting)?.section, old).toBe(to.section);
    }
    expect(resolveSettings("risk")).toEqual({ section: "planning", setting: "risk-rules" });
    expect(resolveSettings("roadmap")).toEqual({ section: "planning", setting: "stale-weeks" });
    expect(resolveSettings("standing")).toEqual({ section: "hours", setting: "standing-blocks" });
    // SA-3: the four sections that went into others, and a setting that moved between sections.
    expect(resolveSettings("devops", "devops-write")).toEqual({ section: "connections", setting: "devops-write" });
    expect(resolveSettings("devops")).toEqual({ section: "connections", setting: "devops-read" });
    expect(resolveSettings("ahead")).toEqual({ section: "planning", setting: "stale-weeks" });
    expect(resolveSettings("chats")).toEqual({ section: "clients", setting: "request-phrases" });
    expect(resolveSettings("activity", "loop-log")).toEqual({ section: "data", setting: "loop-log" });
    expect(resolveSettings("planning", "plan-reminder")).toEqual({ section: "notifications", setting: "plan-reminder" });
    expect(resolveSettings("planning", "level")).toEqual({ section: "you", setting: "level" });
    expect(resolveSettings("connections", "feedback")).toEqual({ section: "about", setting: "feedback" });
    expect(resolveSettings("client", "Atlas")).toEqual({ section: "client", setting: "Atlas" });
    expect(resolveSettings("nowhere")).toBeNull();
    expect(settingsHref("devops", "devops-write")).toBe("#/settings/devops/devops-write");
    expect(settingsHref("display")).toBe("#/settings/display");
  });

  it("search finds by new label first, then old label (named), then keyword", () => {
    const roadmap = searchSettings("roadmap");
    expect(roadmap[0]).toMatchObject({ section: "planning", setting: null, label: "Planning", matched: "Roadmap" });
    expect(searchSettings("ahead").find((h) => h.section === "planning" && h.setting === null)).toMatchObject({ label: "Planning", matched: "Ahead" });
    expect(searchSettings("risk rules")[0]).toMatchObject({ section: "planning" });
    expect(searchSettings("write log").some((h) => h.setting === "write-log")).toBe(true);
    expect(searchSettings("Accounts and calendars")[0]).toMatchObject({ section: "connections", label: "Connections", matched: "Accounts and calendars" });
    expect(searchSettings("time zone")[0]).toMatchObject({ section: "hours", setting: "time-zone", matched: null });
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("zzqx")).toEqual([]);
  });

  // NM-1: the renamed section and settings are found by their new names and by every old one.
  it("search finds each renamed section and setting by its old name and its new one", () => {
    const section = (q: string) => searchSettings(q).find((h) => h.setting === null);
    expect(section("planning")).toMatchObject({ section: "planning", label: "Planning", matched: null });
    for (const old of ["today and week", "day and week", "risk rules"]) expect(section(old), old).toMatchObject({ section: "planning", label: "Planning" });
    expect(section("Today and Week")!.matched).toBe("Today and Week");
    expect(section("notifications")).toMatchObject({ section: "notifications", label: "Reminders and notices", matched: "Notifications" });
    const setting = (q: string, id: string) => searchSettings(q).find((h) => h.setting === id);
    expect(setting("needs attention nudges", "readiness-nudges")).toMatchObject({ label: "Show Needs attention nudges", matched: null, where: "Planning" });
    expect(setting("readiness nudges", "readiness-nudges")).toMatchObject({ label: "Show Needs attention nudges", matched: "Readiness nudges" });
    expect(setting("look-ahead rituals", "rituals")).toMatchObject({ label: "Look-ahead rituals", matched: null });
    for (const old of ["plan ahead rituals", "look ahead 4 weeks"]) expect(setting(old, "rituals"), old).toMatchObject({ label: "Look-ahead rituals" });
    expect(setting("direction review", "notify-direction")).toMatchObject({ label: "Direction review", matched: null });
    expect(setting("let urgent asks through", "urgent-during-focus")).toMatchObject({ label: "Let urgent requests through while I focus" });
    // Old names live only in `old` (and keywords): no label or description carries one.
    for (const s of SECTIONS) expect(`${s.label} ${s.description}`, s.id).not.toMatch(/\bToday and\b|\bRoadmap\b|\bAhead\b|\bReadiness\b|\bPlan ahead\b/);
    for (const s of SETTINGS) expect(s.label, s.id).not.toMatch(/\bToday\b|\bRoadmap\b|\bAhead\b|\bReadiness\b|\bPlan ahead\b|\bGaps\b|\bFix next\b/);
  });

  it("hides developer-loop rows outside it and demo rows outside a demo", () => {
    expect(searchSettings("style guide").some((h) => h.setting === "style-guide")).toBe(false);
    expect(searchSettings("style guide", { dev: true }).some((h) => h.setting === "style-guide")).toBe(true);
    expect(searchSettings("reset demo").some((h) => h.setting === "demo-reset")).toBe(false);
    expect(searchSettings("reset demo", { demo: true }).some((h) => h.setting === "demo-reset")).toBe(true);
    expect(searchSettings("show demo data", { demo: true }).some((h) => h.setting === "demo-mode")).toBe(false);
  });
});

// SA-2: the registry is the one home of a setting's name.
describe("SA-2: one name per setting", () => {
  it("every row has a kind of choice; every part row names its group; labels carry no unit in brackets", () => {
    for (const d of SETTINGS) {
      expect(d.kind, d.id).toBeTruthy();
      if (d.part && d.section !== "client") expect(d.group, d.id).toBeTruthy();
      expect(d.label, d.id).not.toMatch(/\((minutes|days|weeks|months|seconds)[^)]*\)/);
    }
  });
  it("search shows a row's group beside its section; a client page's rows say they need the client (SA-5)", () => {
    expect(searchSettings("quiet on days off")[0]).toMatchObject({ setting: "quiet-pto", where: "Reminders and notices › Quiet" });
    expect(searchSettings("watch at").find((h) => h.setting === "risk-watch")).toMatchObject({ where: "Planning › Fine tuning › At-risk blocks" });
    expect(searchSettings("stale after")[0]).toMatchObject({ setting: "stale-weeks", where: "Planning › Fine tuning › Backlog" });
    expect(searchSettings("someone took your story")[0]).toMatchObject({ setting: "notify-story-taken", where: "Reminders and notices › Each kind of notice" });
    expect(searchSettings("dataverse nickname")[0]).toMatchObject({ kind: "client", section: "client", setting: "client-nickname", where: "A client's page" });
    expect(searchSettings("midday check-in").some((h) => h.setting === "notify-checkin")).toBe(true);
    expect(searchSettings("check-in").find((h) => h.setting === "notify-checkin")).toMatchObject({ label: "Midday check-in" });
  });
});

describe("PH-2: a phone-only setting", () => {
  it("is found on a phone only", () => {
    expect(searchSettings("timeline", { phone: true }).some((h) => h.setting === "day-timeline")).toBe(true);
    expect(searchSettings("timeline").some((h) => h.setting === "day-timeline")).toBe(false);
  });
});
