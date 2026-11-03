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
