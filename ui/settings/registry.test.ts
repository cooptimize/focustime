// ST-1: the Settings registry is one consistent list: ids unique, every setting in a section that exists, old section
// ids still land, and search finds settings by their new and their old labels (and hides developer and demo rows).
import { describe, expect, it } from "vitest";
import { OLD_SECTIONS, SECTIONS, SETTINGS, SETTINGS_GROUPS, resolveSettings, searchSettings, sectionOf, settingOf, settingsHref } from "./registry.ts";

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
    expect(SETTINGS.find((d) => /secret/i.test(`${d.id} ${d.label}`))).toBeUndefined();
    expect(searchSettings("app secrets", { dev: true, demo: true })).toEqual([]);
  });

  it("old section ids open their new section, and the setting where it moved inside one", () => {
    for (const [old, to] of Object.entries(OLD_SECTIONS)) {
      expect(sectionOf(old), old).toBeUndefined();
      expect(sectionOf(to.section), old).toBeDefined();
      if (to.setting) expect(settingOf(to.setting)?.section, old).toBe(to.section);
    }
    expect(resolveSettings("risk")).toEqual({ section: "planning", setting: "risk-rules" });
    expect(resolveSettings("roadmap")).toEqual({ section: "ahead", setting: null });
    expect(resolveSettings("standing")).toEqual({ section: "hours", setting: "standing-blocks" });
    expect(resolveSettings("devops", "devops-write")).toEqual({ section: "devops", setting: "devops-write" });
    expect(resolveSettings("nowhere")).toBeNull();
    expect(settingsHref("devops", "devops-write")).toBe("#/settings/devops/devops-write");
    expect(settingsHref("display")).toBe("#/settings/display");
  });

  it("search finds by new label first, then old label (named), then keyword", () => {
    const roadmap = searchSettings("roadmap");
    expect(roadmap[0]).toMatchObject({ section: "ahead", setting: null, label: "Ahead", matched: "Roadmap" });
    expect(searchSettings("risk rules")[0]).toMatchObject({ section: "planning" });
    expect(searchSettings("write log").some((h) => h.setting === "write-log")).toBe(true);
    expect(searchSettings("Connections")[0]).toMatchObject({ section: "connections", label: "Accounts and calendars", matched: "Connections" });
    expect(searchSettings("time zone")[0]).toMatchObject({ section: "hours", setting: "time-zone", matched: null });
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("zzqx")).toEqual([]);
  });

  it("hides developer-loop rows outside it and demo rows outside a demo", () => {
    expect(searchSettings("style guide").some((h) => h.setting === "style-guide")).toBe(false);
    expect(searchSettings("style guide", { dev: true }).some((h) => h.setting === "style-guide")).toBe(true);
    expect(searchSettings("reset demo").some((h) => h.setting === "demo-reset")).toBe(false);
    expect(searchSettings("reset demo", { demo: true }).some((h) => h.setting === "demo-reset")).toBe(true);
    expect(searchSettings("show demo data", { demo: true }).some((h) => h.setting === "demo-mode")).toBe(false);
  });
});
