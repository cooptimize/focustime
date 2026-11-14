// Step 15.5: [notify] in config and its Settings edit.
import { describe, expect, it } from "vitest";
import { parseConfig } from "./schema.ts";
import { settingsEdit } from "./settings.ts";
import { RETIRED_KINDS } from "../plan/notify.ts";
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

  // NM-1: four kinds were removed (nothing sent them). A choice someone saved for one stays in their settings, unread.
  it("a saved choice for a removed kind is kept and skipped: the settings still load, and a later save leaves it alone", () => {
    const saved = `${TOML}\n[notify]\ncommitment_item = false\ntaken_over = false\nconversation_given = true\nconversation_activity = false\ncheckin = false\n`;
    // Not an error even where unknown fields are errors, and not listed as ignored either.
    const strict = parseConfig(saved, { strict: true });
    expect(strict.ok ? [] : strict.errors).toEqual([]);
    const p = parseConfig(saved);
    expect(p.ok ? (p.ignored ?? []) : p.errors).toEqual([]);
    if (!p.ok) return;
    expect(p.config.notify.kinds.checkin).toBe(false);
    for (const k of RETIRED_KINDS) expect(k in p.config.notify.kinds, k).toBe(false);
    // Saving another switch keeps the old lines where they were (nothing is deleted or migrated).
    const text = settingsEdit("notify", { kinds: { vm: false } })(saved);
    for (const line of ["commitment_item = false", "taken_over = false", "conversation_given = true", "conversation_activity = false"]) expect(text).toContain(line);
    expect(parseConfig(text).ok).toBe(true);
    // A removed kind can't be switched any more, and a field nobody ever had is still refused.
    expect(() => settingsEdit("notify", { kinds: { taken_over: true } })).toThrow();
    const never = parseConfig(`${TOML}\n[notify]\nnever_was = true\n`);
    expect(never.ok && never.ignored).toEqual(["notify.never_was"]);
    expect(parseConfig(`${TOML}\n[notify]\nnever_was = true\n`, { strict: true }).ok).toBe(false);
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
    const bad = parseConfig(TOML + "\n[roadmap]\nstalled_days = 2\nwatch_weeks = 9\nother = 1\n", { strict: true });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.field).sort()).toEqual(["roadmap.other", "roadmap.stalled_days", "roadmap.watch_weeks"]);
  });
});

describe("[ahead] (BH-1)", () => {
  it("stale after 6 weeks by default; Settings writes the person's own weeks; out of range refused", () => {
    const p = parseConfig(TOML);
    expect(p.ok && p.config.ahead).toEqual({ staleWeeks: 6 });
    const q = parseConfig(settingsEdit("ahead", { staleWeeks: 10 })(TOML));
    expect(q.ok && q.config.ahead).toEqual({ staleWeeks: 10 });
    expect(() => settingsEdit("ahead", { staleWeeks: 2.5 })).toThrow();
    expect(() => settingsEdit("ahead", { other: 1 })).toThrow();
    const bad = parseConfig(TOML + "\n[ahead]\nstale_weeks = 30\n");
    expect(!bad.ok && bad.errors.map((e) => e.field)).toEqual(["ahead.stale_weeks"]);
  });
});
