// DP-3: one deployment, shared. Two (and three) people on one database, each with their own plan store: what each
// sees, who can change it, the refusal when two save at once, Take me off, Delete, the carry-over of every deployment
// made before DP-3, two zones, the after-hours count, the export and the delete of a person's data.
import { describe, expect, it } from "vitest";
import { afterHours } from "../plan/deploy.ts";
import { DEFAULT_SIZE_SCALE } from "../plan/estimate.ts";
import { pickNeed } from "../plan/types.ts";
import { weekConfig } from "../config/defaults.ts";
import { openPlanDb, planStoreOn, PlanError } from "./plan-store.ts";
import { sqliteConn } from "./sql/sqlite.ts";
import { sharedDeployments } from "./deployments.ts";
import { exportUser, recordSoftDelete } from "./user-data.ts";
import { notices } from "../plan/notify.ts";
import { windowWords } from "../plan/shared-deploy.ts";

const NOW = "2026-11-17T15:00:00Z"; // Tue 10:00 New York
const SAT = "2026-11-21";
const ALEX = "a0000000-0000-4000-8000-0000000000a1";
const JORDAN = "a0000000-0000-4000-8000-0000000000a2";
const PRIYA = "a0000000-0000-4000-8000-0000000000a3";
const OUTSIDER = "a0000000-0000-4000-8000-0000000000a9";

function world() {
  const raw = openPlanDb({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("UTC") });
  const conn = sqliteConn(raw);
  let clock = NOW;
  const person = (userId: string, zone: string, name: string) => {
    const s = planStoreOn(conn, { userId, now: () => Temporal.Instant.from(clock).toZonedDateTimeISO(zone) });
    return { s, name, async init() { await s.setAccountState("ms_identity", { name }); return this; } };
  };
  return { conn, raw, person, at: (t: string) => void (clock = t) };
}
const saturday = () => ({ date: SAT, half: "EVE" as const, clientKey: "contoso", kind: "intention" as const, title: "Release 4.2", itemType: "Deployment", size: null, minutes: 120, todoKind: "deployment" as const, window: { start: "09:00", end: "11:00" }, notes: "Warehouse first", links: [{ id: 101, title: "Export stories" }] }) as const;

describe("a shared deployment", () => {
  it("shows at once for a person added, the same title, window, items and note; nobody else sees anything of it", async () => {
    const w = world();
    const alex = await w.person(ALEX, "America/New_York", "Alex Rivera").init();
    const jordan = await w.person(JORDAN, "America/New_York", "Jordan Lee").init();
    const outsider = await w.person(OUTSIDER, "America/New_York", "Sam Ortiz").init();
    const mine = await alex.s.addDeployment(saturday() as never, [{ id: JORDAN, name: "Jordan Lee" }]);
    expect(mine.shared?.people.map((p) => p.name)).toEqual(["Alex Rivera", "Jordan Lee"]);
    const theirs = (await jordan.s.picksFor(SAT)).filter((p) => p.todoKind === "deployment");
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ title: "Release 4.2", window: { start: "09:00", end: "11:00" }, notes: "Warehouse first", links: [{ id: 101, title: "Export stories" }], status: "planned", clientKey: "contoso" });
    expect(theirs[0]!.shared?.addedBy).toBe(ALEX);
    // Someone not on it: nothing by any read, and nothing by the id.
    expect(await outsider.s.picksBetween("2026-11-16", "2026-11-22")).toEqual([]);
    expect(await outsider.s.getPick(mine.id)).toBeNull();
    expect(await outsider.s.deploymentOf(mine.id)).toBeNull();
    await expect(outsider.s.deployLeave(mine.id)).rejects.toThrow(PlanError);
    await expect(outsider.s.deployDeleteAll(mine.id)).rejects.toThrow(PlanError);
    await expect(outsider.s.deploySetPeople(mine.id, null, [{ id: OUTSIDER, name: "Sam Ortiz" }])).rejects.toThrow(PlanError);
    // Jordan's own to-do id is Jordan's, never Alex's.
    expect(await outsider.s.getPick(theirs[0]!.id)).toBeNull();
  });

  it("a change by anyone on it shows for everyone; done is for everyone; a person not on it changes nothing", async () => {
    const w = world();
    const alex = await w.person(ALEX, "America/New_York", "Alex Rivera").init();
    const jordan = await w.person(JORDAN, "America/New_York", "Jordan Lee").init();
    const a = await alex.s.addDeployment(saturday() as never, [{ id: JORDAN, name: "Jordan Lee" }]);
    const j = (await jordan.s.picksFor(SAT))[0]!;
    await jordan.s.setTodoKind(j.id, { todoKind: "deployment", window: { start: "10:00", end: "12:30" }, links: [{ id: 102, title: "Reports" }], deployItems: [{ key: "reports", name: "Reports" }] as never, notes: "Reports too", title: "Release 4.3", version: j.shared!.version });
    expect(await alex.s.getPick(a.id)).toMatchObject({ title: "Release 4.3", window: { start: "10:00", end: "12:30" }, notes: "Reports too", links: [{ id: 102, title: "Reports" }] });
    await alex.s.move(a.id, "2026-11-22", "EVE");
    expect((await jordan.s.getPick(j.id))!.date).toBe("2026-11-22");
    await jordan.s.setDone(j.id, true);
    expect((await alex.s.getPick(a.id))!.status).toBe("done");
    await alex.s.deploySetPeople(a.id, null, [{ id: JORDAN, name: "Jordan Lee" }, { id: PRIYA, name: "Priya Shah" }]);
    const priya = await w.person(PRIYA, "America/New_York", "Priya Shah").init();
    expect((await priya.s.picksFor("2026-11-22")).map((p) => p.title)).toEqual(["Release 4.3"]);
  });

  it("two saves at the same moment: the later one is refused in plain words and nothing is lost", async () => {
    const w = world();
    const alex = await w.person(ALEX, "America/New_York", "Alex Rivera").init();
    const jordan = await w.person(JORDAN, "America/New_York", "Jordan Lee").init();
    const a = await alex.s.addDeployment(saturday() as never, [{ id: JORDAN, name: "Jordan Lee" }]);
    const j = (await jordan.s.picksFor(SAT))[0]!;
    const seen = a.shared!.version;
    expect(j.shared!.version).toBe(seen);
    await alex.s.setTodoKind(a.id, { todoKind: "deployment", window: { start: "09:00", end: "12:00" }, links: null, notes: "Alex's note", version: seen });
    await expect(jordan.s.setTodoKind(j.id, { todoKind: "deployment", window: { start: "08:00", end: "10:00" }, links: null, notes: "Jordan's note", version: seen })).rejects.toThrow(/changed it while you had it open/);
    expect(await jordan.s.getPick(j.id)).toMatchObject({ notes: "Alex's note", window: { start: "09:00", end: "12:00" } });
  });

  it("Take me off removes only me, the last one off deletes it, and Undo puts me back", async () => {
    const w = world();
    const alex = await w.person(ALEX, "America/New_York", "Alex Rivera").init();
    const jordan = await w.person(JORDAN, "America/New_York", "Jordan Lee").init();
    const a = await alex.s.addDeployment(saturday() as never, [{ id: JORDAN, name: "Jordan Lee" }]);
    const j = (await jordan.s.picksFor(SAT))[0]!;
    const left = await jordan.s.deployLeave(j.id);
    expect(left).toMatchObject({ deleted: false, others: [{ name: "Alex Rivera" }] });
    expect((await jordan.s.picksFor(SAT)).filter((p) => p.status === "planned")).toEqual([]);
    expect((await alex.s.getPick(a.id))!.shared!.people.map((p) => p.id)).toEqual([ALEX]);
    await jordan.s.deployRejoin(j.id, left.was);
    expect((await jordan.s.getPick(j.id))!.status).toBe("planned");
    // Alex leaves, then Jordan, the last: it is deleted.
    await alex.s.deployLeave(a.id);
    expect((await jordan.s.deployLeave(j.id)).deleted).toBe(true);
    expect((await alex.s.picksFor(SAT)).filter((p) => p.status !== "dropped")).toEqual([]);
  });

  it("Undo of Take me off only undoes my own leaving: never after someone else took me off or changed it, and never with a made-up name", async () => {
    const w = world();
    const alex = await w.person(ALEX, "America/New_York", "Alex Rivera").init();
    const jordan = await w.person(JORDAN, "America/New_York", "Jordan Lee").init();
    const a = await alex.s.addDeployment(saturday() as never, [{ id: JORDAN, name: "Jordan Lee" }]);
    const j = (await jordan.s.picksFor(SAT))[0]!;
    const was = (await jordan.s.getPick(j.id))!.shared!.people.find((p) => p.id === JORDAN)!;
    // Alex takes Jordan off: Jordan can't put themselves back, whatever they send.
    await alex.s.deploySetPeople(a.id, (await alex.s.getPick(a.id))!.shared!.version, []);
    await expect(jordan.s.deployRejoin(j.id, { ...was, addedBy: JORDAN })).rejects.toThrow(PlanError);
    expect((await alex.s.getPick(a.id))!.shared!.people.map((p) => p.id)).toEqual([ALEX]);
    // Added again, Jordan leaves; Alex changes it after: the Undo is refused.
    await alex.s.deploySetPeople(a.id, (await alex.s.getPick(a.id))!.shared!.version, [{ id: JORDAN, name: "Jordan Lee" }]);
    const j2 = (await jordan.s.picksFor(SAT)).find((p) => p.status === "planned")!;
    const left = await jordan.s.deployLeave(j2.id);
    const now = (await alex.s.getPick(a.id))!;
    await alex.s.setTodoKind(a.id, { todoKind: "deployment", window: { start: "10:00", end: "12:00" }, links: null, version: now.shared!.version });
    await expect(jordan.s.deployRejoin(j2.id, left.was)).rejects.toThrow(PlanError);
    // Left with nothing since: back, under my own name, added by someone on it.
    await alex.s.deploySetPeople(a.id, (await alex.s.getPick(a.id))!.shared!.version, [{ id: JORDAN, name: "Jordan Lee" }]);
    const j3 = (await jordan.s.picksFor(SAT)).find((p) => p.status === "planned")!;
    const left3 = await jordan.s.deployLeave(j3.id);
    await jordan.s.deployRejoin(j3.id, { ...left3.was, name: "Someone Else", addedBy: OUTSIDER, addedAt: "2099-01-01T00:00:00Z" });
    const back = (await alex.s.getPick(a.id))!.shared!.people.find((p) => p.id === JORDAN)!;
    expect(back.name).toBe("Jordan Lee");
    expect(back.addedBy).toBe(JORDAN);
    expect(back.addedAt < "2099").toBe(true);
  });

  it("Delete is for everyone on it; Undo puts it back for everyone; a person removed by someone else no longer sees it", async () => {
    const w = world();
    const alex = await w.person(ALEX, "America/New_York", "Alex Rivera").init();
    const jordan = await w.person(JORDAN, "America/New_York", "Jordan Lee").init();
    const a = await alex.s.addDeployment(saturday() as never, [{ id: JORDAN, name: "Jordan Lee" }]);
    const j = (await jordan.s.picksFor(SAT))[0]!;
    // A plain Drop on a deployment others are on is refused in plain words.
    await expect(alex.s.removePick(a.id)).rejects.toThrow(/Others are on this deployment/);
    expect((await alex.s.deployDeleteAll(a.id)).people.map((p) => p.name)).toEqual(["Alex Rivera", "Jordan Lee"]);
    expect((await jordan.s.getPick(j.id))!.status).toBe("dropped");
    await alex.s.deployRestore(a.id);
    expect((await jordan.s.getPick(j.id))!.status).toBe("planned");
    await alex.s.deploySetPeople(a.id, null, []);
    expect((await jordan.s.getPick(j.id))!.status).toBe("dropped");
    expect(await jordan.s.deploymentOf(j.id)).toBeNull();
    const notes = await jordan.s.deployNotes("2026-01-01T00:00:00Z");
    expect(notes.map((n) => n.kind)).toEqual(["added", "removed"]);
    expect(await alex.s.deployNotes("2026-01-01T00:00:00Z")).toEqual([]);
  });

  it("every deployment made before DP-3 is unchanged for its owner, with them on it, once", async () => {
    const w = world();
    const alex = await w.person(ALEX, "America/New_York", "Alex Rivera").init();
    // A WK-3 deployment as it was stored before: a to-do with its kind, window, items and note, no shared row.
    const old = await alex.s.addPick(saturday() as never);
    const done = await alex.s.addPick({ ...saturday(), date: "2026-11-22", title: "Hotfix" } as never);
    await alex.s.setDone(done.id, true);
    const before = await alex.s.getPick(old.id);
    expect(before!.deploymentId).toBeUndefined();
    const read = await alex.s.picksBetween("2026-11-16", "2026-11-22");
    const again = await alex.s.picksBetween("2026-11-16", "2026-11-22");
    const deps = read.filter((p) => p.todoKind === "deployment");
    expect(deps.map((p) => [p.id, p.title, p.status, p.date, p.window, p.notes, p.links])).toEqual([
      [old.id, "Release 4.2", "planned", SAT, { start: "09:00", end: "11:00" }, "Warehouse first", [{ id: 101, title: "Export stories" }]],
      [done.id, "Hotfix", "done", "2026-11-22", { start: "09:00", end: "11:00" }, "Warehouse first", [{ id: 101, title: "Export stories" }]],
    ]);
    expect(deps.every((p) => p.shared?.people.length === 1 && p.shared.people[0]!.id === ALEX)).toBe(true);
    expect(again.filter((p) => p.todoKind === "deployment")).toHaveLength(2);
    expect((w.raw.prepare("SELECT COUNT(*) AS n FROM deployments").get() as { n: number }).n).toBe(2);
  });

  it("two people in different zones see the same moment", async () => {
    const w = world();
    const alex = await w.person(ALEX, "America/New_York", "Alex Rivera").init();
    const jordan = await w.person(JORDAN, "America/Los_Angeles", "Jordan Lee").init();
    const a = await alex.s.addDeployment({ ...saturday(), window: { start: "19:00", end: "21:00" } } as never, [{ id: JORDAN, name: "Jordan Lee" }]);
    const j = (await jordan.s.picksFor(SAT))[0]!;
    expect(j.window).toEqual({ start: "16:00", end: "18:00" });
    expect(j.shared!.startAt).toBe(a.shared!.startAt);
    // Jordan moves it an hour later, in Jordan's time; Alex sees the same moment in Alex's.
    await jordan.s.setTodoKind(j.id, { todoKind: "deployment", window: { start: "17:00", end: "19:00" }, links: null, version: j.shared!.version });
    expect((await alex.s.getPick(a.id))!.window).toEqual({ start: "20:00", end: "22:00" });
  });

  it("counts in each person's own after-hours total, once", async () => {
    const w = world();
    const alex = await w.person(ALEX, "America/New_York", "Alex Rivera").init();
    const jordan = await w.person(JORDAN, "America/New_York", "Jordan Lee").init();
    await alex.s.addDeployment(saturday() as never, [{ id: JORDAN, name: "Jordan Lee" }]);
    const dates = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];
    for (const who of [alex, jordan]) {
      const picks = await who.s.picksBetween(dates[0]!, dates[6]!);
      await who.s.picksBetween(dates[0]!, dates[6]!);
      const r = afterHours({ model: weekConfig.hours, dates, picks: await who.s.picksBetween(dates[0]!, dates[6]!), minutesOf: (p) => pickNeed(p, DEFAULT_SIZE_SCALE) });
      expect(picks).toHaveLength(1);
      expect(r.parts).toEqual([expect.objectContaining({ title: "Release 4.2", minutes: 120, why: "deployment" })]);
    }
  });

  it("a person's export holds the deployments they are on; deleting their data takes them off and leaves it for the others", async () => {
    const w = world();
    const alex = await w.person(ALEX, "America/New_York", "Alex Rivera").init();
    const jordan = await w.person(JORDAN, "America/New_York", "Jordan Lee").init();
    const a = await alex.s.addDeployment(saturday() as never, [{ id: JORDAN, name: "Jordan Lee" }]);
    await jordan.s.picksFor(SAT);
    const user = { id: JORDAN, tenantId: "t", upn: "jordan@example.com", displayName: "Jordan Lee", email: "jordan@example.com", timeZone: "America/New_York", createdAt: NOW, lastSignInAt: NOW, deletedAt: null } as never;
    const ex = (await exportUser(w.conn, user, Temporal.Instant.from(NOW))) as { deployments: { title: string; people: { name: string }[] }[] };
    expect(ex.deployments).toEqual([expect.objectContaining({ title: "Release 4.2", people: [expect.objectContaining({ name: "Alex Rivera" }), expect.objectContaining({ name: "Jordan Lee" })] })]);
    await recordSoftDelete(w.conn, JORDAN, Temporal.Instant.from(NOW));
    expect((await alex.s.getPick(a.id))!.shared!.people.map((p) => p.id)).toEqual([ALEX]);
    expect(await sharedDeployments(w.conn, () => Temporal.Instant.from(NOW)).of(JORDAN)).toEqual([]);
  });

  it("tells the others when it is added, moved, taken off or deleted; never for notes, items or links, never the one who changed it", async () => {
    const w = world();
    const alex = await w.person(ALEX, "America/New_York", "Alex Rivera").init();
    const jordan = await w.person(JORDAN, "America/New_York", "Jordan Lee").init();
    const a = await alex.s.addDeployment(saturday() as never, [{ id: JORDAN, name: "Jordan Lee" }]);
    const j = (await jordan.s.picksFor(SAT))[0]!;
    const kinds = async (who: typeof alex) => (await who.s.deployNotes("2026-01-01T00:00:00Z")).map((n) => [n.kind, n.byName]);
    // Notes, items and links: quiet.
    await jordan.s.setTodoKind(j.id, { todoKind: "deployment", window: { start: "09:00", end: "11:00" }, links: [{ id: 102, title: "Reports" }], notes: "Reports too", version: j.shared!.version });
    expect(await kinds(alex)).toEqual([]);
    // The time, then the day: Alex is told each time; Jordan, who changed it, never.
    const j2 = (await jordan.s.getPick(j.id))!;
    await jordan.s.setTodoKind(j.id, { todoKind: "deployment", window: { start: "10:00", end: "12:00" }, links: null, version: j2.shared!.version });
    await jordan.s.move(j.id, "2026-11-22", "EVE");
    expect(await kinds(alex)).toEqual([["moved", "Jordan Lee"], ["moved", "Jordan Lee"]]);
    await alex.s.deployDeleteAll(a.id);
    expect(await kinds(jordan)).toEqual([["added", "Alex Rivera"], ["deleted", "Alex Rivera"]]);
    expect(await jordan.s.deploymentTitle(j.id === a.id ? a.shared!.id : j.shared!.id)).toBe("Release 4.2");
    const note = (await jordan.s.deployNotes("2026-01-01T00:00:00Z"))[1]!;
    const n = notices.deployment(note.id, note.kind, "Alex", "Contoso", "Release 4.2", windowWords(note.startAt, note.endAt, "America/New_York"), NOW);
    expect([n.kind, n.title, n.body, n.route]).toEqual(["deployments", "Alex deleted a deployment you were on", "Contoso: Release 4.2, Sun, Nov 22, 10:00 AM to 12:00 PM.\nIt's off your plan. Check your Outlook if it was there.", "week"]);
    expect(windowWords("2026-11-21T14:00:00Z", "2026-11-21T16:00:00Z", "America/New_York")).toBe("Sat, Nov 21, 9:00 to 11:00 AM");
    // Someone not on it can't read its title by a note's id.
    const outsider = await w.person(OUTSIDER, "America/New_York", "Sam Ortiz").init();
    expect(await outsider.s.deploymentTitle(note.deploymentId)).toBeNull();
  });
});
