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

describe("admins (shared polling, D522)", () => {
  const A = "00000000-0000-4000-8000-0000000000a1";
  const B = "00000000-0000-4000-8000-0000000000b2";
  it("come from FOCUSTIME_ADMINS (comma separated), else admins in the app config: Entra object ids, lowercased", () => {
    const env = readAppSettings({ FOCUSTIME_ADMINS: `${A.toUpperCase()}, ${B},${A}` }, null, URL);
    expect(env.ok && env.settings.admins).toEqual([A, B]);
    const file = readAppSettings({}, `admins = ["${A}"]\n`, URL);
    expect(file.ok && file.settings.admins).toEqual([A]);
    const none = readAppSettings({}, null, URL);
    expect(none.ok && none.settings.admins).toEqual([]);
  });
  it("refuse anything that isn't an object id (no names or emails)", () => {
    expect(readAppSettings({ FOCUSTIME_ADMINS: "someone@example.com" }, null, URL)).toMatchObject({ ok: false });
  });
});

describe("feedback settings (F1)", () => {
  const env = { FOCUSTIME_FEEDBACK_ORG: "contoso", FOCUSTIME_FEEDBACK_PROJECT: "Contoso Internal", FOCUSTIME_FEEDBACK_PARENT_ID: "496" };
  it("come from FOCUSTIME_FEEDBACK_*, with no live switch (FB-1: a stale FOCUSTIME_FEEDBACK_LIVE is ignored)", () => {
    const r = readAppSettings({ ...env, FOCUSTIME_FEEDBACK_LIVE: "true" }, null, URL);
    expect(r.ok && r.settings.feedback).toEqual({ org: "contoso", project: "Contoso Internal", parentId: 496 });
  });
  it("come from [feedback] in the app config too", () => {
    const r = readAppSettings({}, '[feedback]\norg = "contoso"\nproject = "Contoso Internal"\nparent_id = 12\nlive = true\n', URL);
    expect(r.ok && r.settings.feedback).toEqual({ org: "contoso", project: "Contoso Internal", parentId: 12 });
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
    expect(r.ok && r.settings.ai).toEqual({ provider: null, model: "gpt-6-luna", reasoningEffort: "low", timeoutMs: 30_000, maxOutputTokens: { default: 4000, test_ai: 1000, asks_classify: 2000, promises_extract: 1200, capture_prepare: 1200 }, prices: { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 }, flexPrices: { inputPerMillion: 0.05, cachedInputPerMillion: 0.005, outputPerMillion: 0.25 }, flex: { maxTries: 3, maxWaitMs: 90_000, timeoutMs: 120_000, baseBackoffMs: 2_000 }, appCapUsd: 100, transcribe: { model: "gpt-transcribe", perMinuteUsd: 0.0045 } });
  });
  it("the app config's [ai], then the environment over it", () => {
    const text = `[ai]\nprovider = "openai"\nmodel = "gpt-5-mini"\nreasoning_effort = ""\ntimeout_ms = 60000\napp_cap_usd = 50\ninput_usd_per_million = 0.25\noutput_usd_per_million = 2\n[ai.max_output_tokens]\ndefault = 2000\nclassify_ask = 800\n`;
    const r = read({ FOCUSTIME_AI_APP_CAP_USD: "75", FOCUSTIME_AI_MAX_OUTPUT_TOKENS: "default=3000,test_ai=500" }, text);
    expect(r.ok && r.settings.ai).toEqual({ provider: "openai", model: "gpt-5-mini", reasoningEffort: null, timeoutMs: 60_000, maxOutputTokens: { default: 3000, test_ai: 500, asks_classify: 2000, promises_extract: 1200, capture_prepare: 1200 }, prices: { inputPerMillion: 0.25, cachedInputPerMillion: 0.01, outputPerMillion: 2 }, flexPrices: { inputPerMillion: 0.05, cachedInputPerMillion: 0.005, outputPerMillion: 0.25 }, flex: { maxTries: 3, maxWaitMs: 90_000, timeoutMs: 120_000, baseBackoffMs: 2_000 }, appCapUsd: 75, transcribe: { model: "gpt-transcribe", perMinuteUsd: 0.0045 } });
  });
  it("AI-F1: Flex prices and its retries from [ai] flex_*, then the environment", () => {
    const text = `[ai]\nflex_input_usd_per_million = 0.06\nflex_output_usd_per_million = 0.3\nflex_max_tries = 5\nflex_max_wait_ms = 30000\n`;
    const r = read({ FOCUSTIME_AI_FLEX_TIMEOUT_MS: "200000", FOCUSTIME_AI_FLEX_CACHED_INPUT_USD_PER_MILLION: "0.006" }, text);
    expect(r.ok && r.settings.ai.flexPrices).toEqual({ inputPerMillion: 0.06, cachedInputPerMillion: 0.006, outputPerMillion: 0.3 });
    expect(r.ok && r.settings.ai.flex).toEqual({ maxTries: 5, maxWaitMs: 30_000, timeoutMs: 200_000, baseBackoffMs: 2_000 });
  });
  it.each([
    [{ FOCUSTIME_AI_FLEX_MAX_TRIES: "0" }],
    [{ FOCUSTIME_AI_FLEX_OUTPUT_USD_PER_MILLION: "-1" }],
    [{ FOCUSTIME_AI_PROVIDER: "azure" }],
    [{ FOCUSTIME_AI_MODEL: "gpt 5" }],
    [{ FOCUSTIME_AI_TIMEOUT_MS: "10" }],
    [{ FOCUSTIME_AI_OUTPUT_USD_PER_MILLION: "-1" }],
    [{ FOCUSTIME_AI_MAX_OUTPUT_TOKENS: "default=lots" }],
  ])("refuses %o", (env) => {
    expect(read(env).ok).toBe(false);
  });
});
