import { describe, expect, it } from "vitest";
import { readAppSettings } from "./appconfig.ts";

const URL = "http://localhost:5317";

describe("app-level invite domains (fix/settings-autosave)", () => {
  it("come from FOCUSTIME_INVITE_DOMAINS, else invite_domains in the app config, lowercased and deduplicated", () => {
    const env = readAppSettings({ FOCUSTIME_INVITE_DOMAINS: "Contoso.example, fabrikam.example,contoso.example" }, null, URL);
    expect(env.ok && env.settings.inviteDomains).toEqual(["contoso.example", "fabrikam.example"]);
    const file = readAppSettings({}, 'invite_domains = ["contoso.example"]\n', URL);
    expect(file.ok && file.settings.inviteDomains).toEqual(["contoso.example"]);
    const none = readAppSettings({}, null, URL);
    expect(none.ok && none.settings.inviteDomains).toEqual([]);
  });
  it("refuse something that isn't a domain name", () => {
    expect(readAppSettings({ FOCUSTIME_INVITE_DOMAINS: "not a domain" }, null, URL)).toMatchObject({ ok: false });
  });
});

describe("feedback settings (F1)", () => {
  const env = { FOCUSTIME_FEEDBACK_ORG: "contoso", FOCUSTIME_FEEDBACK_PROJECT: "Contoso Internal", FOCUSTIME_FEEDBACK_PARENT_ID: "496" };
  it("come from FOCUSTIME_FEEDBACK_*, live off unless switched on", () => {
    const off = readAppSettings(env, null, URL);
    expect(off.ok && off.settings.feedback).toEqual({ org: "contoso", project: "Contoso Internal", parentId: 496, live: false });
    const on = readAppSettings({ ...env, FOCUSTIME_FEEDBACK_LIVE: "true" }, null, URL);
    expect(on.ok && on.settings.feedback?.live).toBe(true);
  });
  it("come from [feedback] in the app config too", () => {
    const r = readAppSettings({}, '[feedback]\norg = "contoso"\nproject = "Contoso Internal"\nparent_id = 12\nlive = true\n', URL);
    expect(r.ok && r.settings.feedback).toEqual({ org: "contoso", project: "Contoso Internal", parentId: 12, live: true });
  });
  it("are null when not set, and refused when half set", () => {
    const none = readAppSettings({}, null, URL);
    expect(none.ok && none.settings.feedback).toBeNull();
    expect(readAppSettings({ FOCUSTIME_FEEDBACK_ORG: "contoso" }, null, URL)).toMatchObject({ ok: false });
    expect(readAppSettings({ ...env, FOCUSTIME_FEEDBACK_PARENT_ID: "abc" }, null, URL)).toMatchObject({ ok: false });
  });
});

describe("[ai] app settings (AI-0)", () => {
  const read = (env: Record<string, string>, text: string | null = null) => readAppSettings(env, text, "http://localhost:4319");
  it("defaults: the host chooses the provider; the model, limits and prices from DEFAULT_AI", () => {
    const r = read({});
    expect(r.ok && r.settings.ai).toEqual({ provider: null, model: "gpt-6-luna", reasoningEffort: "low", timeoutMs: 30_000, maxOutputTokens: { default: 4000, test_ai: 1000, asks_classify: 2000, promises_extract: 1200 }, prices: { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 }, appCapUsd: 100 });
  });
  it("the app config's [ai], then the environment over it", () => {
    const text = `[ai]\nprovider = "openai"\nmodel = "gpt-5-mini"\nreasoning_effort = ""\ntimeout_ms = 60000\napp_cap_usd = 50\ninput_usd_per_million = 0.25\noutput_usd_per_million = 2\n[ai.max_output_tokens]\ndefault = 2000\nclassify_ask = 800\n`;
    const r = read({ FOCUSTIME_AI_APP_CAP_USD: "75", FOCUSTIME_AI_MAX_OUTPUT_TOKENS: "default=3000,test_ai=500" }, text);
    expect(r.ok && r.settings.ai).toEqual({ provider: "openai", model: "gpt-5-mini", reasoningEffort: null, timeoutMs: 60_000, maxOutputTokens: { default: 3000, test_ai: 500, asks_classify: 2000, promises_extract: 1200 }, prices: { inputPerMillion: 0.25, cachedInputPerMillion: 0.01, outputPerMillion: 2 }, appCapUsd: 75 });
  });
  it.each([
    [{ FOCUSTIME_AI_PROVIDER: "azure" }],
    [{ FOCUSTIME_AI_MODEL: "gpt 5" }],
    [{ FOCUSTIME_AI_TIMEOUT_MS: "10" }],
    [{ FOCUSTIME_AI_OUTPUT_USD_PER_MILLION: "-1" }],
    [{ FOCUSTIME_AI_MAX_OUTPUT_TOKENS: "default=lots" }],
  ])("refuses %o", (env) => {
    expect(read(env).ok).toBe(false);
  });
});
