// SA-4: the one list of Admin's settings has every key Admin can write, each with a label, and Audit shows labels,
// never a code name or an id.
import { describe, expect, it } from "vitest";
import { CLIENT_SPECS, LEVEL_SPECS, ORG_SPECS, PERSON_SPECS } from "../../../config/org.ts";
import { ADMIN_SETTINGS, auditSettingLabel, hasLabel, RETIRED_KEYS, SETTINGS_ON_SCREEN } from "./settings-list.ts";
import { CLIENT_TABS, PART_TABS, type TabbedPart } from "./places.ts";

describe("Admin's settings list", () => {
  it("has a label for every key Admin can write", () => {
    const missing = [
      ...Object.keys(ORG_SPECS).filter((k) => !hasLabel("org", k)).map((k) => `org/${k}`),
      ...Object.keys(CLIENT_SPECS).filter((k) => !hasLabel("client", k)).map((k) => `client/${k}`),
      ...Object.keys(LEVEL_SPECS).filter((k) => !hasLabel("level", k)).map((k) => `level/${k}`),
      ...Object.keys(PERSON_SPECS).filter((k) => !hasLabel("person", k)).map((k) => `person/${k}`),
    ];
    expect(missing).toEqual([]);
    // And names nothing that isn't one.
    const known = new Set([...Object.keys(ORG_SPECS).map((k) => `org/${k}`), ...Object.keys(CLIENT_SPECS).map((k) => `client/${k}`), ...Object.keys(LEVEL_SPECS).map((k) => `level/${k}`), ...Object.keys(PERSON_SPECS).map((k) => `person/${k}`)]);
    expect(ADMIN_SETTINGS.filter((s) => s.scope !== "audit" && !known.has(`${s.scope}/${s.key}`) && !RETIRED_KEYS.includes(`${s.scope}/${s.key}`)).map((s) => s.key)).toEqual([]);
  });
  it("puts every setting on screen at a part and tab that exist", () => {
    for (const s of SETTINGS_ON_SCREEN) {
      if (s.part === "clients") expect(s.tab === null || CLIENT_TABS.some(([t]) => t === s.tab), s.key).toBe(true);
      else expect(PART_TABS[s.part as TabbedPart]?.some(([t]) => t === s.tab), s.key).toBe(true);
    }
    // Only these left the screen: nothing enforces retention; the rest had no control before either.
    expect(ADMIN_SETTINGS.filter((s) => s.part === null).map((s) => s.key).sort()).toEqual(["conv.closed_shown_days", "devops.poll_minutes", "devops_patterns", "keep_open", "org.retention_years", "plan_share"]);
  });
  it("gives Audit a label for each kind of row, never a code name or an id", () => {
    const rows = ["client:Atlas/allow_ai", "person:0b9c2f1e-1111-4222-8333-944445555666/automation", "org/org.never_suggest", "org/ai.on", "level:lead/draft_stories", "level", "client_lead", "devops_identity", "invite"];
    const labels = rows.map(auditSettingLabel);
    expect(labels).toEqual(["Allow AI", "Automation account", "Never suggested, for everyone", "AI for FocusTime", "Break down offered", "Level", "Client lead", "Client DevOps identity", "Invite"]);
    for (const l of labels) expect(l).not.toMatch(/[_:/]|^[a-z]+\.[a-z]/);
    expect(auditSettingLabel("org/not.a.key")).toBe("A setting");
  });
});
