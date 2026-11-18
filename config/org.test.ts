// ADM-1: the settings model. Four kinds (Rule, Default, Default by level, Personal), resolved personal override, then
// level default, then org default, then built-in; Reset to team default; colors; phrase lists.
import { describe, expect, it } from "vitest";
import { applyOrg } from "./org-apply.ts";
import { BRAND_COLORS, colorProblem, contrast, distance, guidanceFor, onlyMine, readableEverywhere, resolve, resolveRules, specFor, suggestColor, themeValues, THEME_BACKGROUNDS, withMine, type OrgBootstrap, type OrgRow } from "./org.ts";
import { parseConfig, type AppConfig } from "./schema.ts";
import { settingsEdit, SETTINGS_SECTIONS } from "./settings.ts";
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
  it("Draft stories and readiness nudges on for every level, and with no level", () => {
    for (const l of ["consultant", "senior", "lead", null] as const) expect(guidanceFor(rules, l, {})).toEqual({ draftStories: true, readinessNudges: true });
  });
  it("an admin's level default, then the person's own choice over it; Reset goes back to the level's", () => {
    const r = resolveRules([row("level:senior", "readiness_nudges", false)], BOOT);
    expect(guidanceFor(r, "senior", {}).readinessNudges).toBe(false);
    expect(guidanceFor(r, "senior", { readinessNudges: true }).readinessNudges).toBe(true);
    let t = settingsEdit("guidance", { draftStories: false })(starter());
    expect(applyOrg(cfgOf(t), r, { level: "consultant", levelSource: "dataverse" }).org!.guidance.draftStories).toBe(false);
    t = settingsEdit("guidance", { draftStories: null })(t);
    expect(applyOrg(cfgOf(t), r, { level: "consultant", levelSource: "dataverse" }).org!.guidance.draftStories).toBe(true);
  });
});

// SA-3 test 8: "Plan up to" (plan_share) and Keep open (keep_open) are gone. A stored value is left in place and
// never makes loading fail: the person's [guidance] plan_share and [keep_open], and an admin's level rows.
describe("SA-3: a stored plan_share or keep_open is skipped", () => {
  it("in a person's settings: loads, listed as ignored, kept through a save", () => {
    const text = `${starter()}\n[guidance]\nplan_share = 60\n\n[keep_open]\nFabrikam = 30\n`;
    const r = parseConfig(text);
    expect(r.ok).toBe(true);
    expect(r.ok && r.ignored).toEqual(expect.arrayContaining(["guidance.plan_share", "keep_open"]));
    const saved = settingsEdit("guidance", { readinessNudges: false })(text);
    expect(saved).toContain("plan_share = 60");
    expect(saved).toContain("Fabrikam = 30");
    expect(parseConfig(saved).ok).toBe(true);
    expect(() => settingsEdit("guidance", { planShare: 70 })).toThrow();
    expect((SETTINGS_SECTIONS as readonly string[]).includes("keep_open")).toBe(false);
  });
  it("in the team's level rows: resolves without them, and nobody can set them", () => {
    const r = resolveRules([row("level:consultant", "plan_share", 70), row("level:lead", "keep_open", 30)], BOOT);
    expect(guidanceFor(r, "consultant", {})).toEqual({ draftStories: true, readinessNudges: true });
    expect(specFor("level:consultant", "plan_share")).toBeNull();
    expect(specFor("level:lead", "keep_open")).toBeNull();
  });
});

describe("Rules: the team's value replaces the person's", () => {
  it("AI on, allowed clients and the cap come only from the rules", () => {
    const old = cfgOf(`${starter()}\n[ai]\nuse = true\nmonthly_cap_usd = 50\nallowed_clients = ["fabrikam"]\n`);
    const r = resolveRules([row("org", "ai.on", false), row("client:contoso", "allow_ai", true)], BOOT);
    const c = applyOrg(old, r, { level: null, levelSource: null });
    expect(c.aiRules).toMatchObject({ on: false, allowedClients: ["contoso"], personCapUsd: 10, appCapUsd: 100, model: "test-model" });
  });
  it("AI-F1: background tasks an admin put back on standard reach the AI rules; names no build knows are dropped", () => {
    const r = resolveRules([row("org", "ai.standard_tasks", ["promises.extract", "stories.draft", "gone.task"])], BOOT);
    expect(r.ai.standardTasks).toEqual(["promises.extract"]);
    expect(applyOrg(cfgOf(starter()), r, { level: null, levelSource: null }).aiRules.standardTasks).toEqual(["promises.extract"]);
    expect(resolveRules([], BOOT).ai.standardTasks).toEqual([]);
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
  it("CV-4: Send attachments to AI is a per-client Rule, off by default", () => {
    expect(specFor("client:contoso", "attachments_ai")!.parse(true)).toBe(true);
    const c = cfgOf(`${starter()}\n[clients.contoso]\n`);
    expect(applyOrg(c, resolveRules([], BOOT), { level: null, levelSource: null }).org?.clients.contoso?.attachmentsAi ?? false).toBe(false);
    expect(applyOrg(c, resolveRules([row("client:contoso", "attachments_ai", true)], BOOT), { level: null, levelSource: null }).org?.clients.contoso?.attachmentsAi).toBe(true);
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

