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
