// ADM-1: the settings model. Four kinds (Rule, Default, Default by level, Personal), resolved personal override, then
// level default, then org default, then built-in; Reset to team default; colors; phrase lists.
import { describe, expect, it } from "vitest";
import { applyOrg } from "./org-apply.ts";
import { BRAND_COLORS, colorProblem, contrast, distance, guidanceFor, onlyMine, readableEverywhere, resolve, resolveRules, specFor, suggestColor, themeValues, THEME_BACKGROUNDS, withMine, type OrgBootstrap, type OrgRow } from "./org.ts";
import { parseConfig, type AppConfig } from "./schema.ts";
import { settingsEdit } from "./settings.ts";
import { starterToml } from "./starter.ts";
import { setValue } from "./edit.ts";

const BOOT: OrgBootstrap = { model: "test-model", appCapUsd: 100, inviteDomains: ["cooptimize.example"], feedback: null };
const row = (scope: string, key: string, value: unknown): OrgRow => ({ scope, key, value: JSON.stringify(value), updatedAt: "2026-11-04T12:00:00Z", updatedBy: "admin" });
const cfgOf = (toml: string): AppConfig => {
  const p = parseConfig(toml);
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  return p.config;
};
const starter = () => setValue(starterToml("America/Chicago"), "dataverse", "my_email", "me@example.com");

describe("resolve: personal, then level, then org, then built-in", () => {
  it("takes the first that is set", () => {
    expect(resolve({ personal: 1, level: 2, org: 3, builtin: 4 })).toEqual({ value: 1, from: "personal" });
    expect(resolve({ level: 2, org: 3, builtin: 4 })).toEqual({ value: 2, from: "level" });
    expect(resolve({ personal: null, org: 3, builtin: 4 })).toEqual({ value: 3, from: "org" });
    expect(resolve({ builtin: 4 })).toEqual({ value: 4, from: "builtin" });
    expect(resolve({ personal: false, builtin: true })).toEqual({ value: false, from: "personal" });
  });
});

describe("Defaults by level", () => {
  const rules = resolveRules([], BOOT);
  it("Consultants plan up to 80% with Draft stories and readiness nudges on; Senior and Lead as before", () => {
    expect(guidanceFor(rules, "consultant", {})).toEqual({ draftStories: true, readinessNudges: true, planShare: 80, keepOpen: 0 });
    expect(guidanceFor(rules, "senior", {})).toEqual({ draftStories: true, readinessNudges: true, planShare: 100, keepOpen: 0 });
    expect(guidanceFor(rules, "lead", {})).toEqual({ draftStories: true, readinessNudges: true, planShare: 100, keepOpen: 0 });
    // ADM-2 (D605): no level (an unmapped position, or none read) uses the Consultant defaults.
    expect(guidanceFor(rules, null, {})).toEqual({ draftStories: true, readinessNudges: true, planShare: 80, keepOpen: 0 });
  });
  it("an admin's level default, then the person's own choice over it", () => {
    const r = resolveRules([row("level:senior", "plan_share", 90)], BOOT);
    expect(guidanceFor(r, "senior", {}).planShare).toBe(90);
    expect(guidanceFor(r, "senior", { planShare: 70 }).planShare).toBe(70);
  });
  it("Reset to team default: removing the person's value goes back to their level's", () => {
    let t = settingsEdit("guidance", { planShare: 60 })(starter());
    const r = resolveRules([], BOOT);
    expect(applyOrg(cfgOf(t), r, { level: "consultant", levelSource: "dataverse" }).org!.guidance.planShare).toBe(60);
    t = settingsEdit("guidance", { planShare: null })(t);
    const back = applyOrg(cfgOf(t), r, { level: "consultant", levelSource: "dataverse" }).org!;
    expect(back.guidance.planShare).toBe(80);
    expect(back.levelGuidance.planShare).toBe(80);
  });
  it("plan share stays between 50 and 100", () => {
    expect(() => specFor("level:consultant", "plan_share")!.parse(40)).toThrow();
    expect(specFor("level:consultant", "plan_share")!.parse(75)).toBe(75);
  });
});

describe("Rules: the team's value replaces the person's", () => {
  it("AI on, allowed clients and the cap come only from the rules", () => {
    const old = cfgOf(`${starter()}\n[ai]\nuse = true\nmonthly_cap_usd = 50\nallowed_clients = ["fabrikam"]\n`);
    const r = resolveRules([row("org", "ai.on", false), row("client:contoso", "allow_ai", true)], BOOT);
    const c = applyOrg(old, r, { level: null, levelSource: null });
    expect(c.aiRules).toMatchObject({ on: false, allowedClients: ["contoso"], personCapUsd: 10, appCapUsd: 100, model: "test-model" });
  });
  it("invite domains: the bootstrap until an admin sets them", () => {
    expect(resolveRules([], BOOT).organization.inviteDomains).toEqual(["cooptimize.example"]);
    expect(resolveRules([row("org", "org.invite_domains", ["contoso.example"])], BOOT).organization.inviteDomains).toEqual(["contoso.example"]);
  });
  it("never suggested: the team's list plus the person's own excludes", () => {
    const c = cfgOf(`${starter()}\n[collab]\nexclude = ["Pat Doe"]\n`);
    const r = resolveRules([row("org", "org.never_suggest", ["Robot"])], BOOT);
    expect(applyOrg(c, r, { level: null, levelSource: null }).collab.exclude.sort()).toEqual(["Pat Doe", "Robot"]);
  });
  it("states treated as open per client come from the rule, not the person", () => {
    const c = cfgOf(`${starter()}\n[clients.contoso]\nopen_states = ["Mine"]\n`);
    const r = resolveRules([row("client:contoso", "open_states", ["Resolved"])], BOOT);
    expect(applyOrg(c, r, { level: null, levelSource: null }).clientSettings.contoso?.openStates).toEqual(["Resolved"]);
  });
  it("Send attachments to AI can't be turned on yet", () => {
    expect(() => specFor("client:contoso", "attachments_ai")!.parse(true)).toThrow();
  });
});

describe("phrase lists: the team's Default plus each person's additions", () => {
  it("a person adds on top and can't remove the team's", () => {
    expect(withMine(["can you", "please"], ["Could You ", "please"])).toEqual(["can you", "please", "could you"]);
    expect(onlyMine(["can you", "please"], ["please", "could you"])).toEqual(["could you"]);
  });
  it("an admin removing a team phrase removes it for everyone who didn't add it", () => {
    const c = cfgOf(`${starter()}\n[asks]\nrequest_phrases = ["by friday"]\n`);
    const r = resolveRules([row("org", "conv.request_phrases", ["can you"])], BOOT);
    const out = applyOrg(c, r, { level: null, levelSource: null });
    expect(out.asks.requestPhrases).toEqual(["can you", "by friday"]);
    expect(out.org!.phrases.mine.request).toEqual(["by friday"]);
  });
});

describe("client colors: a team Default, a person's own color over it", () => {
  it("the team color applies until the person picks their own; Reset to team color clears theirs", () => {
    const r = resolveRules([row("client:contoso", "color", "teal")], BOOT);
    const base = cfgOf(starter());
    expect(applyOrg(base, r, { level: null, levelSource: null }).org!.teamColors).toEqual({ contoso: "teal" });
    const mine = settingsEdit("client", { key: "contoso", color: "rose", name: "Contoso", follow: null })(starter());
    const withMineColor = applyOrg(cfgOf(mine), r, { level: null, levelSource: null });
    expect(withMineColor.clientSettings.contoso?.color).toBe("rose");
    const reset = settingsEdit("client", { key: "contoso", color: "", name: "Contoso", follow: null })(mine);
    expect(cfgOf(reset).clientSettings.contoso?.color ?? null).toBeNull();
  });
  it("suggested colors are distinct, never the brand's, and readable in both themes", () => {
    const taken: string[] = [];
    for (let i = 0; i < 16; i++) taken.push(suggestColor(taken));
    expect(new Set(taken).size).toBe(16);
    expect(taken).not.toContain("green");
    for (const c of taken) {
      expect(colorProblem(c)).toBeNull();
      expect(readableEverywhere(c)).toBe(true);
      for (const v of themeValues(c)) for (const b of BRAND_COLORS) expect(distance(v, b)).toBeGreaterThan(0);
    }
    for (const c of taken.filter((x) => x.startsWith("#"))) for (const bg of THEME_BACKGROUNDS) expect(contrast(c, bg)).toBeGreaterThanOrEqual(3);
  });
  it("refuses the brand's navy and green and colors you can't see on one theme", () => {
    expect(colorProblem("#00416b")).toMatch(/navy or green/);
    expect(colorProblem("#42783c")).toMatch(/navy or green/);
    expect(colorProblem("#fafafa")).toMatch(/light or the dark/);
    expect(colorProblem("#c0392b")).toBeNull();
  });
});

describe("Keep open (PL-1): a Default by level with a per-client personal value", () => {
  it("defaults to 0%, takes the level's default, and a client's own share over it; Reset goes back", () => {
    expect(guidanceFor(resolveRules([], BOOT), null, {}).keepOpen).toBe(0);
    expect(specFor("level:lead", "keep_open")!.parse(30)).toBe(30);
    expect(() => specFor("level:lead", "keep_open")!.parse(90)).toThrow();
    let t = settingsEdit("keep_open", { key: "Fabrikam", percent: 30 })(starter());
    expect(cfgOf(t).keepOpen).toEqual({ Fabrikam: 30 });
    t = settingsEdit("keep_open", { key: "Fabrikam", percent: null })(t);
    expect(cfgOf(t).keepOpen).toEqual({});
    expect(() => settingsEdit("keep_open", { key: "Fabrikam", percent: 81 })).toThrow("Must be from 0 to 80 percent");
    expect(() => settingsEdit("keep_open", { key: "Fabrikam", percent: 20, extra: 1 })).toThrow();
  });
});
