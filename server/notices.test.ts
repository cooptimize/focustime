// P1: the in-app list and push are fed by the notifier after its gate: a notice that is switched off, quiet or a
// repeat never reaches either; one that is held during focus reaches them when focus ends, as one. The real tick code
// (server/ticks.ts) on an in-memory store, with the host and push as spies.
import { describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { timerAction } from "../actions/timer-actions.ts";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import type { HostMedia, HostNotifications } from "../host/types.ts";
import type { Notice } from "../plan/notify.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { openPlanDb } from "../store/plan-store.ts";
import type { PushControl } from "./push.ts";
import { personTicks } from "./ticks.ts";
import { takesStore } from "../store/devops-takes.ts";
import { notesStore } from "../store/devops-notes.ts";

const NY = "America/New_York";
const MEDIA = { status: async () => ({ players: false, spotify: false }), transition: async () => null, open: async () => {}, endSound: () => {} } as unknown as HostMedia;

function person(o: { toml?: (t: string) => string; takes?: boolean } = {}) {
  let at = Temporal.Instant.from("2026-11-02T13:40:00Z"); // Mon 8:40 AM in New York; work starts at 9:00.
  const parsed = parseConfig((o.toml ?? ((t) => t))(setValue(starterToml(NY), "dataverse", "my_email", "ana@cooptimize.example")));
  if (!parsed.ok) throw new Error("bad test config");
  const plan = planStoreOn(sqliteConn(openPlanDb({ path: ":memory:", now: () => at.toZonedDateTimeISO(NY) })), { userId: "ana", now: () => at.toZonedDateTimeISO(NY) });
  const closed: string[] = [];
  const notifications = { show: async (_n: Notice, h?: (x: string) => void) => (h?.("host-1"), null), close: (h: string) => closed.push(h), line: () => {} } as unknown as HostNotifications;
  const pushed: { n: Notice; details: boolean }[] = [];
  const push = { send: async (n: Notice, details: boolean) => void pushed.push({ n, details }) } as unknown as PushControl;
  // PV-1: Take one's app table, on its own database here.
  const appDb = sqliteConn(openPlanDb({ path: ":memory:", now: () => at.toZonedDateTimeISO(NY) }));
  const takes = takesStore(appDb, () => at);
  const notes = notesStore(appDb, () => at);
  const ctx = { plan, loadConfig: async () => ({ path: "x", parsed }), now: () => at.toString(), ...(o.takes ? { takes, devopsNotes: notes, signedInAs: async () => ({ email: "ana@cooptimize.example", upn: "ana@cooptimize.example" }) } : {}) } as unknown as ActionContext;
  const ticks = personTicks({ log: () => {}, now: () => at, notifications, media: MEDIA, openRoute: () => {}, push }, plan, ctx, { zone: NY });
  const until = async (iso: string) => {
    const end = Temporal.Instant.from(iso);
    for (let n = 0; Temporal.Instant.compare(at, end) < 0; n++) {
      at = at.add({ seconds: 30 });
      await ticks.fast();
      await ticks.slow();
    }
    await new Promise((r) => setTimeout(r, 20));
  };
  // Monday 9:00 also brings "Plan the week"; these tests follow the day's reminder.
  const day = async () => (await plan.notices()).filter((n) => n.kind === "plan_day");
  const dayPushed = () => pushed.filter((x) => x.n.kind === "plan_day");
  return { plan, pushed, day, dayPushed, until, config: parsed.config, now: () => at, takes, notes };
}

describe("the in-app list and push follow the notifier's gate (P1)", () => {
  it("a delivered reminder is in the list once and pushed once, without details by default", async () => {
    const p = person();
    await p.until("2026-11-02T14:05:00Z");
    const list = await p.day();
    expect(list.map((n) => n.key)).toEqual(["plan_day:2026-11-02"]);
    expect(list[0]).toMatchObject({ kind: "plan_day", read: false, closed: false, route: "planday" });
    expect(p.dayPushed().map((x) => [x.n.key, x.details])).toEqual([["plan_day:2026-11-02", false]]);
    // Every notice in the list was pushed, and nothing else.
    expect(p.pushed.map((x) => x.n.key).sort()).toEqual((await p.plan.notices()).map((n) => n.key).sort());
    // More passes: not again.
    const before = p.pushed.length;
    await p.until("2026-11-02T14:20:00Z");
    expect((await p.day()).length).toBe(1);
    expect(p.pushed.length).toBe(before);
  });

  it("a kind switched off reaches neither the list nor push; details go out only when turned on", async () => {
    const off = person({ toml: (t) => setValue(t, "notify", "plan_day", false) });
    await off.until("2026-11-02T14:05:00Z");
    expect(await off.day()).toEqual([]);
    expect(off.dayPushed()).toEqual([]);
    const details = person({ toml: (t) => setValue(t, "notify", "push_details", true) });
    await details.until("2026-11-02T14:05:00Z");
    expect(details.dayPushed().map((x) => x.details)).toEqual([true]);
  });

  it("held during focus: nothing in the list until focus ends, then one notice for what came up", async () => {
    const p = person();
    const started = await timerAction({ plan: p.plan, config: async () => p.config, now: () => p.now().toString() }, "timer.start", { minutes: 60 });
    expect(started.ok).toBe(true);
    await p.until("2026-11-02T14:10:00Z");
    expect(await p.plan.notices()).toEqual([]);
    expect(p.pushed).toEqual([]);
    expect((await timerAction({ plan: p.plan, config: async () => p.config, now: () => p.now().toString() }, "timer.stop", {})).ok).toBe(true);
    await p.until("2026-11-02T14:12:00Z");
    // The day's and the week's reminders came up during focus: one "While you were focused" for both.
    const list = await p.plan.notices();
    expect(list.map((n) => n.kind)).toEqual(["held"]);
    expect(p.pushed.map((x) => x.n.kind)).toEqual(["held"]);
  });
});

describe("Take one's quiet note (PV-1)", () => {
  it("tells the previous assignee once, in the app only (never pushed), without the item's title", async () => {
    const p = person({ takes: true });
    await p.takes.add({ clientKey: "adatum", org: "contoso", itemId: 510, fromEmail: "Ana@cooptimize.example", byName: "Sam Tester" });
    await p.takes.add({ clientKey: "adatum", org: "contoso", itemId: 511, fromEmail: "lee@cooptimize.example", byName: "Sam Tester" });
    await p.until("2026-11-02T14:10:00Z");
    const mine = (await p.plan.notices()).filter((n) => n.kind === "story_taken");
    expect(mine.map((n) => [n.title, n.route])).toEqual([["Sam took #510", "week"]]);
    expect(mine[0]!.body).not.toContain("510 ");
    expect(p.pushed.some((x) => x.n.kind === "story_taken")).toBe(false);
    await p.until("2026-11-02T14:30:00Z");
    expect((await p.plan.notices()).filter((n) => n.kind === "story_taken")).toHaveLength(1);
  });
});

describe("Ahead's notices to teammates (AH-1, D641)", () => {
  it("a new assignee hears once; date moves by one person in one commit are one notice; in the app only, ids not titles", async () => {
    const p = person({ takes: true });
    await p.notes.add({ kind: "assigned", clientKey: "adatum", org: "contoso", itemIds: [610], toEmail: "Ana@cooptimize.example", byName: "Sam Tester" });
    await p.notes.add({ kind: "dates", clientKey: "adatum", org: "contoso", itemIds: [620], toEmail: "ana@cooptimize.example", byName: "Sam Tester" });
    await p.notes.add({ kind: "dates", clientKey: "adatum", org: "contoso", itemIds: [621], toEmail: "ana@cooptimize.example", byName: "Sam Tester" });
    await p.notes.add({ kind: "dates", clientKey: "adatum", org: "contoso", itemIds: [630], toEmail: "lee@cooptimize.example", byName: "Sam Tester" });
    await p.until("2026-11-02T14:10:00Z");
    const list = (await p.plan.notices()).filter((n) => n.kind === "assigned" || n.kind === "dates_moved");
    expect(list.map((n) => [n.kind, n.title, n.route]).sort()).toEqual([["assigned", "Sam assigned you #610", "aheaditem:610"], ["dates_moved", "Sam moved the dates of 2 of your items", "aheaditem:620"]]);
    expect(p.pushed.some((x) => x.n.kind === "assigned" || x.n.kind === "dates_moved")).toBe(false);
    await p.until("2026-11-02T14:30:00Z");
    expect((await p.plan.notices()).filter((n) => n.kind === "assigned" || n.kind === "dates_moved")).toHaveLength(2);
  });
});
