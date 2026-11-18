// NT-1: notices and reminders know a day off on the hosted app. A hosted person's Dataverse user is kept with their
// sign-in, not in their settings; the background read PTO from the raw settings, so a PTO day looked like a working day
// and "Quiet on PTO days" never quieted anything. A day off is now PTO or a company holiday, one answer for the whole
// background. Reproduced on the real tick code with a fake Dataverse. Fictional data only.
import { describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { AUTOSTART_KEY, clearVmState } from "../actions/vm-actions.ts";
import { backgroundPolicy } from "../config/background-policy.ts";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import type { HostMedia, HostNotifications } from "../host/types.ts";
import type { LogRecord } from "../log/logger.ts";
import type { Notice } from "../plan/notify.ts";
import { lookAheadOccasion } from "../plan/rituals.ts";
import { createPlanStore } from "../store/plan-store.ts";
import type { PassFacts } from "./teams/rhythm.ts";
import { personTicks } from "./ticks.ts";

const NY = "America/New_York";
const OID = "0f0f0f0f-3333-4222-8333-444455556666";
const DV_USER = "11111111-2222-4333-8444-555566667777";
const MEDIA = { status: async () => ({ players: false, spotify: false }), transition: async () => null, open: async () => {}, endSound: () => {} } as unknown as HostMedia;
/** The look-ahead Thursday in November 2026 (every other Thursday). */
const LA_THU = ["2026-11-05", "2026-11-12"].find((d) => lookAheadOccasion(d) === d)!;

type Opts = {
  /** Local time in New York, "YYYY-MM-DDTHH:MM". */
  at: string;
  /** The day (the local date of `at`) is PTO or a company holiday. */
  off?: "pto" | "holiday";
  /** "Quiet on days off" (on by default, as the setting). */
  quiet?: boolean;
  /** The Dataverse user in the person's own settings and no sign-in kept (a developer's machine). */
  local?: boolean;
  ptoFails?: boolean;
  holidaysFail?: boolean;
  env?: string;
  optIn?: boolean;
  statusOn?: boolean;
  /** A to-do on a date (Check in needs today's; Plan ahead next week's). */
  workOn?: string;
  followUpDue?: boolean;
  /** The VM start's stored last PTO read: hours before `at`, and whether it said PTO. */
  earlier?: { hoursAgo: number; off: boolean };
};

async function person(o: Opts) {
  clearVmState();
  let at = Temporal.PlainDateTime.from(o.at).toZonedDateTime(NY).toInstant();
  const date = o.at.slice(0, 10);
  let toml = setValue(setValue(starterToml(NY), "dataverse", "my_email", "ana@example.com"), "notify", "teams_messages", true);
  if (o.local) toml = setValue(toml, "dataverse", "my_systemuserid", DV_USER);
  if (o.quiet === false) toml = setValue(toml, "notify", "quiet_pto", false);
  if (o.statusOn) toml = setValue(toml, "notify", "status_report", true);
  if (o.optIn) toml = setValue(toml, "notify", "from_test_site", true);
  const config = parseConfig(toml);
  if (!config.ok) throw new Error(JSON.stringify(config.errors));
  const plan = createPlanStore({ path: ":memory:", now: () => at.toZonedDateTimeISO(NY) });
  // As the hosted app keeps it: the Dataverse user found for the signed-in work email, with the sign-in.
  if (!o.local) await plan.setAccountState(IDENTITY_KEY, { oid: OID, tid: "t", name: "Ana Example", username: "ana@example.com", email: "ana@example.com", signedInAt: at.toString(), systemUserId: DV_USER, systemUserEmail: "ana@example.com" });
  if (o.workOn) await plan.addPick({ date: o.workOn, half: "AM", clientKey: "Adatum", kind: "intention", title: "Review the mapping", size: "M" } as never);
  if (o.followUpDue) await plan.addFollowUp({ who: null, what: "Send the summary", due: date });
  if (o.earlier) await plan.setState(AUTOSTART_KEY, { ptoRead: { at: at.subtract({ hours: o.earlier.hoursAgo }).toString(), from: date, to: date, days: o.earlier.off ? [date] : [] } });
  const shown: Notice[] = [];
  const logs: LogRecord[] = [];
  const facts: PassFacts[] = [];
  const reads = { pto: 0, holidays: 0 };
  const notifications = { show: async (n: Notice) => (shown.push(n), null), close: () => {}, line: () => {} } as unknown as HostNotifications;
  const ctx = {
    plan,
    loadConfig: async () => ({ path: "x", parsed: config }),
    now: () => at.toString(),
    // The real Dataverse source refuses PTO without a Dataverse user; the fake does the same.
    makeDataverse: (dv: { mySystemUserId: string | null }) => ({
      pto: async () => {
        reads.pto++;
        if (o.ptoFails) return { status: "unreachable", items: [], message: "Dataverse unreachable" };
        return dv.mySystemUserId ? { status: "ok", items: o.off === "pto" ? [{ date }] : [] } : { status: "misconfigured", items: [], message: "Your Dataverse user id is not resolved yet" };
      },
      holidays: async () => {
        reads.holidays++;
        if (o.holidaysFail) return { ok: false, message: "Dataverse read failed" };
        return { ok: true, days: o.off === "holiday" ? [{ date, name: "A company holiday" }] : [] };
      },
    }),
    makeOutlook: () => { throw new Error("no Outlook here"); },
    makeGoogle: () => { throw new Error("no Google here"); },
  } as unknown as ActionContext;
  const teams = { tick: async (f: PassFacts) => void facts.push(f), wake: async () => null };
  const ticks = personTicks({ policy: backgroundPolicy({ FOCUSTIME_ENV: o.env ?? "prod" }), log: (r) => void logs.push(r), now: () => at, notifications, media: MEDIA, openRoute: () => {}, teams }, plan, ctx, { zone: NY });
  const pass = async () => {
    await ticks.slow();
    await ticks.fast();
    await ticks.settled?.();
  };
  const kinds = () => shown.map((n) => String(n.kind));
  return { ticks, pass, shown, kinds, logs, facts, reads, advance: (m: number) => void (at = at.add({ minutes: m })) };
}

describe("NT-1 STEP 0.3: a hosted person on a PTO day", () => {
  it("the gate's facts say PTO and Plan your day stays quiet (on main: not PTO, and it went out)", async () => {
    const p = await person({ at: "2026-11-02T09:10", off: "pto" });
    await p.ticks.slow();
    await p.ticks.settled?.();
    expect(p.facts.at(-1)?.pto).toBe(true);
    expect(p.shown.filter((n) => n.kind === "plan_day")).toEqual([]);
  });
});

/** Each reminder and nudge at a time it is due on a working day. */
const DUE: { kind: string; at: string; o?: Partial<Opts> }[] = [
  { kind: "plan_day", at: "2026-11-02T09:10" },
  { kind: "plan_week", at: "2026-11-02T09:10" },
  { kind: "checkin", at: "2026-11-02T12:10", o: { workOn: "2026-11-02" } },
  { kind: "closeout", at: "2026-11-02T16:50" },
  { kind: "look_ahead", at: "2026-11-05T14:10" },
  { kind: "direction", at: "2026-11-05T09:10" },
  { kind: "plan_ahead", at: `${LA_THU}T09:10`, o: { workOn: Temporal.PlainDate.from(LA_THU).add({ days: 4 }).toString() } },
];

describe("NT-1 B: on a PTO day and on a company holiday, with the setting on and off", () => {
  for (const off of ["pto", "holiday"] as const)
    for (const quiet of [true, false])
      describe(`${off}, Quiet on days off ${quiet ? "on" : "off"}`, () => {
        for (const r of DUE)
          it(`${r.kind}: not sent (its own rule skips a day off, whatever the setting)`, async () => {
            const p = await person({ at: r.at, off, quiet, ...r.o });
            await p.pass();
            expect(p.kinds()).not.toContain(r.kind);
          });

        it("the status nudge waits (Monday's report isn't even read)", async () => {
          const p = await person({ at: "2026-11-06T15:10", off, quiet, statusOn: true });
          await p.pass();
          expect(p.logs.filter((l) => l.op === "status_nudge")).toEqual([]);
        });

        it(`the gate and the Teams rhythm know it: a promise due today is ${quiet ? "quiet" : "sent"}`, async () => {
          const p = await person({ at: "2026-11-02T09:10", off, quiet, followUpDue: true });
          await p.pass();
          expect(p.facts.at(-1)?.pto).toBe(true);
          expect(p.kinds().includes("followups")).toBe(!quiet);
        });
      });
});

describe("NT-1 B: a working day is unchanged", () => {
  for (const r of DUE)
    it(`${r.kind} is sent`, async () => {
      const p = await person({ at: r.at, ...r.o });
      await p.pass();
      expect(p.kinds()).toContain(r.kind);
    });
  it("the status nudge reads Monday's report (here it can't, and says so)", async () => {
    const p = await person({ at: "2026-11-06T15:10", statusOn: true });
    await p.pass();
    expect(p.logs).toContainEqual({ source: "plan", op: "status_nudge", kind: "unavailable" });
  });
  it("the gate and the rhythm: not a day off, the promise goes out", async () => {
    const p = await person({ at: "2026-11-02T09:10", followUpDue: true });
    await p.pass();
    expect(p.facts.at(-1)?.pto).toBe(false);
    expect(p.kinds()).toContain("followups");
  });
});

describe("NT-1: a person whose settings hold the Dataverse user (as on a developer's machine) behaves as before", () => {
  it("PTO quiets the day; a working day sends", async () => {
    const off = await person({ at: "2026-11-02T09:10", off: "pto", local: true, followUpDue: true });
    await off.pass();
    expect(off.facts.at(-1)?.pto).toBe(true);
    expect(off.kinds()).toEqual([]);
    const on = await person({ at: "2026-11-02T09:10", local: true });
    await on.pass();
    expect(on.kinds()).toContain("plan_day");
  });
});

describe("NT-1 B: PTO or holidays that can't be read", () => {
  it("PTO unread, a read from the last 24 hours covers today: used (here it said PTO)", async () => {
    const p = await person({ at: "2026-11-02T09:10", ptoFails: true, earlier: { hoursAgo: 20, off: true }, followUpDue: true });
    await p.pass();
    expect(p.facts.at(-1)?.pto).toBe(true);
    expect(p.kinds()).toEqual([]);
    expect(p.logs).toContainEqual({ source: "dataverse", op: "day_off", kind: "pto_unread_earlier" });
  });

  it("PTO unread and no read from the last 24 hours: the gate sends, the reminders wait and try again later", async () => {
    const p = await person({ at: "2026-11-02T09:10", ptoFails: true, earlier: { hoursAgo: 25, off: false }, followUpDue: true });
    await p.pass();
    expect(p.facts.at(-1)?.pto).toBe(false);
    expect(p.kinds()).toContain("followups");
    expect(p.kinds()).not.toContain("plan_day");
    expect(p.kinds()).not.toContain("plan_week");
    // The status nudge waits too.
    const s = await person({ at: "2026-11-06T15:10", ptoFails: true, statusOn: true });
    await s.pass();
    expect(s.logs.filter((l) => l.op === "status_nudge")).toEqual([]);
  });

  it("one log line a day per reason, by kind only", async () => {
    const p = await person({ at: "2026-11-02T09:10", ptoFails: true, holidaysFail: true });
    for (let i = 0; i < 4; i++) {
      await p.pass();
      p.advance(40);
    }
    const lines = p.logs.filter((l) => l.op === "day_off");
    expect(lines).toEqual([
      { source: "dataverse", op: "day_off", kind: "holidays_unread" },
      { source: "dataverse", op: "day_off", kind: "pto_unread" },
    ]);
  });

  it("holidays unread: a working day (Plan your day goes out)", async () => {
    const p = await person({ at: "2026-11-02T09:10", holidaysFail: true });
    await p.pass();
    expect(p.kinds()).toContain("plan_day");
    expect(p.logs).toContainEqual({ source: "dataverse", op: "day_off", kind: "holidays_unread" });
  });
});

describe("NT-1 B: the read budget", () => {
  it("at most one fresh PTO read and one holidays read per 30 minutes, for every part of the background", async () => {
    const p = await person({ at: "2026-11-02T09:10", followUpDue: true, statusOn: true });
    for (let i = 0; i < 6; i++) {
      await p.pass();
      p.advance(5);
    }
    expect(p.reads).toEqual({ pto: 1, holidays: 1 });
    p.advance(5);
    await p.pass();
    expect(p.reads).toEqual({ pto: 2, holidays: 2 });
  });
});

describe("NT-1: outside production nothing new is read", () => {
  for (const optIn of [false, true])
    it(`a test site${optIn ? ", reminders switched on" : ""}: no PTO or holiday read by any part`, async () => {
      for (const local of [false, true]) {
        const p = await person({ at: "2026-11-02T09:10", env: "dev", optIn, local, off: "pto", followUpDue: true, statusOn: true });
        for (let i = 0; i < 3; i++) {
          await p.pass();
          p.advance(31);
        }
        expect(p.reads).toEqual({ pto: 0, holidays: 0 });
      }
    });
});
