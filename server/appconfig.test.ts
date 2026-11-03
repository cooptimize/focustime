import { describe, expect, it } from "vitest";
import { readAppSettings } from "./appconfig.ts";

const URL = "http://localhost:4400";

describe("app settings: invite domains (A5)", () => {
  it("reads FOCUSTIME_INVITE_DOMAINS as a lowercase list, none by default", () => {
    const none = readAppSettings({}, null, URL);
    expect(none.ok && none.settings.inviteDomains).toEqual([]);
    const set = readAppSettings({ FOCUSTIME_INVITE_DOMAINS: "Cooptimize.example, fabrikam.example" }, null, URL);
    expect(set.ok && set.settings.inviteDomains).toEqual(["cooptimize.example", "fabrikam.example"]);
    const toml = readAppSettings({}, '[collab]\ninvite_domains = ["contoso.example"]\n', URL);
    expect(toml.ok && toml.settings.inviteDomains).toEqual(["contoso.example"]);
  });

  it("refuses something that isn't a domain", () => {
    expect(readAppSettings({ FOCUSTIME_INVITE_DOMAINS: "not a domain" }, null, URL).ok).toBe(false);
  });
});
