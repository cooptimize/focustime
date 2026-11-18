// DP-3: each person's own hold for a shared deployment, through the write framework (preview, confirm, read back, the
// write log, undo, the marker). Two people on one database; only Alex's Outlook is connected, and only Alex's own
// press puts it there. Never attendees, never anyone else's calendar.
import { describe, expect, it } from "vitest";
import { parseConfig, type AppConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { fakeGraph, FAKE_WRITE_TOKEN } from "../sources/graph/test-fakes.ts";
import { createGraphWriter } from "../sources/graph/write.ts";
import { openPlanDb, planStoreOn } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import { clearPreviews } from "./timebox-actions.ts";
import { clearSyncMemo, syncWeek } from "./outlook-sync.ts";
import type { WritePreview, WriteResult } from "./types.ts";

const NOW = "2026-11-17T15:00:00Z"; // Tue 10:00 New York
const SAT = "2026-11-21";
const ALEX = "a0000000-0000-4000-8000-0000000000a1";
const JORDAN = "a0000000-0000-4000-8000-0000000000a2";
const base = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"');

async function setup() {
  clearPreviews();
  clearSyncMemo();
  const g = fakeGraph();
  const writer = createGraphWriter({ fetch: g.fetch, token: async () => FAKE_WRITE_TOKEN, invalidate: () => {}, log: () => {} });
  const conn = sqliteConn(openPlanDb({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("UTC") }));
  const zoned = () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York");
  const alex = planStoreOn(conn, { userId: ALEX, now: zoned });
  const jordan = planStoreOn(conn, { userId: JORDAN, now: zoned });
  await alex.setAccountState("ms_identity", { name: "Alex Rivera" });
  await jordan.setAccountState("ms_identity", { name: "Jordan Lee" });
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(base) }),
    makeDataverse: () => { throw new Error("n/a"); },
    makeOutlook: () => ({ id: "outlook", load: async () => { throw new Error("n/a"); }, connect: async () => ({ status: "connected" }), disconnect: async () => {}, write: { access: async () => ({ status: "write" }), writer } }) as never,
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => { throw new Error("n/a"); },
    saveSystemUserId: async () => {},
    now: () => NOW,
    sleep: async () => {},
    plan: alex,
  };
  const run = async <T = unknown>(action: string, input: unknown): Promise<T> => {
    const r = await dispatch(c, { action, input });
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  const preview = async (uid: string) => (await run<{ preview?: WritePreview; nothing?: true }>("write.preview", { uid })).preview;
  const confirm = (p: WritePreview) => run<WriteResult>("write.confirm", { previewId: p.previewId });
  const dep = await alex.addDeployment({ date: SAT, half: "EVE", clientKey: "Adatum", kind: "intention", title: "Release 4.2", itemType: "Deployment", size: null, minutes: 120, todoKind: "deployment", window: { start: "09:00", end: "11:00" }, links: [{ id: 101, title: "Export stories" }], notes: "Warehouse first, then the reports" } as never, [{ id: JORDAN, name: "Jordan Lee" }]);
  const sync = () => (clearSyncMemo(), syncWeek({ plan: alex, ow: { access: async () => ({ status: "write" }), writer }, cfg: (parseConfig(base) as { config: AppConfig }).config, weekStart: "2026-11-16", refresh: true, now: () => NOW, clients: [{ key: "Adatum", name: "Adatum" }] }));
  return { g, alex, jordan, run, preview, confirm, dep, sync };
}

describe("a deployment's hold on my own Outlook (DP-3)", () => {
  it("being added writes nothing; Put on my Outlook is my own preview and confirm: title, window and Busy, nobody invited", async () => {
    const t = await setup();
    expect((await t.jordan.picksFor(SAT))[0]!.shared!.hold.state).toBe("off");
    expect(t.g.events.size).toBe(0);
    expect((await t.alex.getPick(t.dep.id))!.shared!.hold.state).toBe("off");
    const { uid } = await t.run<{ uid: string }>("deploy.hold", { id: t.dep.id, on: true });
    const p = (await t.preview(uid))!;
    expect(p).toMatchObject({ op: "create", system: "Outlook", auto: false });
    expect(p.fields.map((f) => [f.label, f.after])).toEqual([
      ["Title", "Adatum: Release 4.2"],
      ["When", "Sat, Nov 21, 9:00 AM to 11:00 AM"],
      ["Show as", "Busy"],
      ["Reminder", "None"],
      ["Attendees", "None"],
      ["Body", "Timebox planned in FocusTime."],
    ]);
    // Nothing of the note, the items or the links goes to Outlook.
    expect(JSON.stringify(p)).not.toMatch(/Warehouse|Export stories/);
    await t.confirm(p);
    expect(t.g.events.size).toBe(1);
    const ev = [...t.g.events.values()][0] as { attendees?: unknown[] };
    expect(ev.attendees ?? []).toEqual([]);
    expect((await t.alex.getPick(t.dep.id))!.shared!.hold.state).toBe("on");
    // Jordan's own state is Jordan's: still not on Jordan's Outlook.
    expect((await t.jordan.picksFor(SAT))[0]!.shared!.hold.state).toBe("off");
    expect((await t.alex.writeLog()).map((w) => [w.op, w.status])).toEqual([["create", "confirmed"]]);
  });

  it("falls behind when someone else changes the time, and is updated by my own preview; Take me off leaves it for me to remove", async () => {
    const t = await setup();
    const { uid } = await t.run<{ uid: string }>("deploy.hold", { id: t.dep.id, on: true });
    await t.confirm((await t.preview(uid))!);
    const j = (await t.jordan.picksFor(SAT))[0]!;
    await t.jordan.setTodoKind(j.id, { todoKind: "deployment", window: { start: "13:00", end: "15:00" }, links: null, version: j.shared!.version });
    expect((await t.alex.getPick(t.dep.id))!.shared!.hold.state).toBe("behind");
    const up = (await t.preview(uid))!;
    expect(up.op).toBe("update");
    expect(up.fields.find((f) => f.label === "When")).toMatchObject({ before: "Sat, Nov 21, 9:00 AM to 11:00 AM", after: "Sat, Nov 21, 1:00 PM to 3:00 PM", changed: true });
    await t.confirm(up);
    expect((await t.alex.getPick(t.dep.id))!.shared!.hold.state).toBe("on");
    await t.run("deploy.leave", { id: t.dep.id });
    expect((await t.alex.deployLeftHolds()).map((h) => [h.uid, h.title])).toEqual([[uid, "Release 4.2"]]);
    const del = (await t.preview(uid))!;
    expect(del.op).toBe("delete");
    await t.confirm(del);
    expect(t.g.events.size).toBe(0);
    expect(await t.alex.deployLeftHolds()).toEqual([]);
    expect((await t.alex.writeLog()).map((w) => w.op)).toEqual(["delete", "update", "create"]);
  });

  it("moved in my Outlook with others on it: it asks; Move the deployment for everyone moves it for them too", async () => {
    const t = await setup();
    const { uid } = await t.run<{ uid: string }>("deploy.hold", { id: t.dep.id, on: true });
    await t.confirm((await t.preview(uid))!);
    const ev = t.g.events.get((await t.alex.ownEvent(uid))!.eventId)!;
    ev.start = "2026-11-21T17:00:00Z"; // 12:00 New York
    ev.end = "2026-11-21T19:00:00Z";
    await t.sync();
    const mine = (await t.alex.getPick(t.dep.id))!;
    expect(mine.shared!.hold.state).toBe("moved_in_outlook");
    expect(mine.window).toEqual({ start: "09:00", end: "11:00" });
    expect((await t.jordan.picksFor(SAT))[0]!.window).toEqual({ start: "09:00", end: "11:00" });
    await t.run("deploy.hold_follow", { id: t.dep.id });
    expect((await t.jordan.picksFor(SAT))[0]!.window).toEqual({ start: "12:00", end: "14:00" });
    expect((await t.alex.getPick(t.dep.id))!.shared!.hold.state).toBe("on");
  });

  it("moved in my Outlook with nobody else on it: the deployment follows, as a timebox does", async () => {
    const t = await setup();
    await t.alex.deploySetPeople(t.dep.id, null, []);
    const { uid } = await t.run<{ uid: string }>("deploy.hold", { id: t.dep.id, on: true });
    await t.confirm((await t.preview(uid))!);
    const ev = t.g.events.get((await t.alex.ownEvent(uid))!.eventId)!;
    ev.start = "2026-11-21T17:00:00Z";
    ev.end = "2026-11-21T19:00:00Z";
    await t.sync();
    expect((await t.alex.getPick(t.dep.id))!).toMatchObject({ window: { start: "12:00", end: "14:00" }, shared: { hold: { state: "on" } } });
  });

  it("deleted in my Outlook: it says so and offers Put it back; nothing changes for the others", async () => {
    const t = await setup();
    const { uid } = await t.run<{ uid: string }>("deploy.hold", { id: t.dep.id, on: true });
    await t.confirm((await t.preview(uid))!);
    t.g.events.delete((await t.alex.ownEvent(uid))!.eventId);
    await t.sync();
    expect((await t.alex.getPick(t.dep.id))!.shared!.hold.state).toBe("deleted_in_outlook");
    expect((await t.jordan.picksFor(SAT))[0]!.status).toBe("planned");
    const back = await t.run<{ uid: string }>("deploy.hold", { id: t.dep.id, on: true });
    expect((await t.preview(back.uid))!.op).toBe("create");
  });
});
