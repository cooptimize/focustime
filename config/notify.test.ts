// Step 15.5: [notify] in config and its Settings edit.
import { describe, expect, it } from "vitest";
import { parseConfig } from "./schema.ts";
import { settingsEdit } from "./settings.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";

const TOML = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"');

describe("[notify]", () => {
  it("everything on, quiet outside working hours and on PTO days, by default", () => {
    const p = parseConfig(TOML);
    expect(p.ok && p.config.notify).toMatchObject({ quiet: "outside_hours", quietPto: true, kinds: { plan_day: true, timer: true, meeting: true, vm: true, followups: true, expiry: true, look_ahead: true } });
  });

  it("Settings writes switches and quiet hours and keeps the rest", () => {
    const text = settingsEdit("notify", { kinds: { checkin: false, vm: false }, quiet: "off", quietPto: false })(TOML);
    const p = parseConfig(text);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.config.notify.kinds).toMatchObject({ checkin: false, vm: false, closeout: true });
    expect(p.config.notify).toMatchObject({ quiet: "off", quietPto: false });
    expect(text).toContain("[notify]");
  });

  it("TB-1: Let FocusTime message me in Teams is off unless the person turns it on", () => {
    const p = parseConfig(TOML);
    expect(p.ok && p.config.notify.teamsMessages).toBe(false);
    const q = parseConfig(settingsEdit("notify", { teamsMessages: true })(TOML));
    expect(q.ok && q.config.notify.teamsMessages).toBe(true);
    expect(() => settingsEdit("notify", { teamsMessages: "yes" })).toThrow();
  });

  it("refuses unknown kinds and bad values, per field", () => {
    expect(() => settingsEdit("notify", { kinds: { pager: true } })).toThrow();
    const bad = parseConfig(TOML + '\n[notify]\nquiet = "sometimes"\ncheckin = "yes"\n');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.field).sort()).toEqual(["notify.checkin", "notify.quiet"]);
  });
});

describe("[roadmap] (step 17)", () => {
  it("Stalled after 14 days and Watch within 1 week by default; Settings writes whole numbers in range", () => {
    const p = parseConfig(TOML);
    expect(p.ok && p.config.roadmap).toEqual({ stalledDays: 14, watchWeeks: 1 });
    const text = settingsEdit("roadmap", { stalledDays: 21, watchWeeks: 2 })(TOML);
    const q = parseConfig(text);
    expect(q.ok && q.config.roadmap).toEqual({ stalledDays: 21, watchWeeks: 2 });
  });
  it("refuses fractions, out of range values and unknown fields", () => {
    expect(() => settingsEdit("roadmap", { stalledDays: 1.5 })).toThrow();
    expect(() => settingsEdit("roadmap", { pace: 2 })).toThrow();
    const bad = parseConfig(TOML + "\n[roadmap]\nstalled_days = 2\nwatch_weeks = 9\nother = 1\n");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.field).sort()).toEqual(["roadmap.other", "roadmap.stalled_days", "roadmap.watch_weeks"]);
  });
});
