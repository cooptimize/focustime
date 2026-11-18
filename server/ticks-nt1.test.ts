// NT-1: notices and reminders know a day off on the hosted app. A hosted person's Dataverse user is kept with their
// sign-in, not in their settings; the background read PTO from the raw settings, so a PTO day looked like a working day
// and "Quiet on PTO days" never quieted anything. Reproduced on the real tick code with a fake Dataverse. Fictional data.
import { describe, expect, it } from "vitest";
import { IDENTITY_KEY } from "../actions/account.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { clearVmState } from "../actions/vm-actions.ts";
import { backgroundPolicy } from "../config/background-policy.ts";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import type { HostMedia, HostNotifications } from "../host/types.ts";
import type { LogRecord } from "../log/logger.ts";
import type { Notice } from "../plan/notify.ts";
import { createPlanStore } from "../store/plan-store.ts";
import type { PassFacts } from "./teams/rhythm.ts";
import { personTicks } from "./ticks.ts";

const NY = "America/New_York";
const OID = "0f0f0f0f-3333-4222-8333-444455556666";
const DV_USER = "11111111-2222-4333-8444-555566667777";
const MEDIA = { status: async () => ({ players: false, spotify: false }), transition: async () => null, open: async () => {}, endSound: () => {} } as unknown as HostMedia;

type Opts = {
  /** The Dataverse user in the person's own settings (a developer's machine); hosted people have none there. */
  userInSettings?: boolean;
  /** Mon Nov 2, 2026 is PTO. */
  pto?: boolean;
};

async function person(o: Opts = {}) {
  clearVmState();
  // Mon Nov 2, 2026, 9:10 AM in New York: the starter's day starts at 9:00, so Plan your day is due.
  const at = Temporal.Instant.from("2026-11-02T14:10:00Z");
  let toml = setValue(setValue(starterToml(NY), "dataverse", "my_email", "ana@example.com"), "notify", "teams_messages", true);
  if (o.userInSettings) toml = setValue(toml, "dataverse", "my_systemuserid", DV_USER);
  const config = parseConfig(toml);
  if (!config.ok) throw new Error(JSON.stringify(config.errors));
  const plan = createPlanStore({ path: ":memory:", now: () => at.toZonedDateTimeISO(NY) });
  // As the hosted app keeps it: the Dataverse user found for the signed-in work email, with the sign-in.
  await plan.setAccountState(IDENTITY_KEY, { oid: OID, tid: "t", name: "Ana Example", username: "ana@example.com", email: "ana@example.com", signedInAt: at.toString(), systemUserId: DV_USER, systemUserEmail: "ana@example.com" });
  const shown: Notice[] = [];
  const logs: LogRecord[] = [];
  const facts: PassFacts[] = [];
  const notifications = { show: async (n: Notice) => (shown.push(n), null), close: () => {}, line: () => {} } as unknown as HostNotifications;
  const ctx = {
    plan,
    loadConfig: async () => ({ path: "x", parsed: config }),
    now: () => at.toString(),
    // The real Dataverse source refuses PTO without a Dataverse user; the fake does the same.
    makeDataverse: (dv: { mySystemUserId: string | null }) => ({
      pto: async () => (dv.mySystemUserId ? { status: "ok", items: o.pto ? [{ date: "2026-11-02" }] : [] } : { status: "misconfigured", items: [], message: "Your Dataverse user id is not resolved yet" }),
      holidays: async () => ({ ok: true, days: [] }),
    }),
    makeOutlook: () => { throw new Error("no Outlook here"); },
    makeGoogle: () => { throw new Error("no Google here"); },
  } as unknown as ActionContext;
  const teams = { tick: async (f: PassFacts) => void facts.push(f), wake: async () => null };
  const ticks = personTicks({ policy: backgroundPolicy({ FOCUSTIME_ENV: "prod" }), log: (r) => void logs.push(r), now: () => at, notifications, media: MEDIA, openRoute: () => {}, teams }, plan, ctx, { zone: NY });
  return { ticks, shown, logs, facts };
}

describe("NT-1 STEP 0.3: a hosted person on a PTO day", () => {
  it("the gate's facts say PTO and Plan your day stays quiet (on main: not PTO, and it went out)", async () => {
    const p = await person({ pto: true });
    await p.ticks.slow();
    await p.ticks.settled?.();
    expect(p.facts.at(-1)?.pto).toBe(true);
    expect(p.shown.filter((n) => n.kind === "plan_day")).toEqual([]);
  });
});
