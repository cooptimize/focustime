// TX-1: check-in answers and the end of day DevOps offer through dispatch, on a real store, against a fake dev.azure.com.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { DevOpsTarget } from "../sources/devops/types.ts";
import { fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { clearDevopsPreviews, type DevOpsPreview, type DevOpsResult } from "./devops-write-actions.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { ProgressOffer, SessionView } from "./types.ts";

const NOW = "2026-11-02T17:30:00Z"; // 12:30 in New York
const D = "2026-11-02";
const COOP = "Cooptimize";
const ME = "avery@cooptimize.example";
const base = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"').replace('time_zone = ""', 'time_zone = "America/New_York"');
const at = (t: string) => `${D}T${t}:00-05:00`;

function setup(o: { toml?: string } = {}) {
  clearDevopsPreviews();
  const dv = fakeDevOpsWrite({ now: () => NOW, remainingWork: ["Task"] });
  dv.add(500, { "System.WorkItemType": "Task", "System.Title": "Mapping", "System.State": "Active", "System.AssignedTo": { uniqueName: ME }, "Microsoft.VSTS.Scheduling.RemainingWork": 2 });
  dv.add(501, { "System.WorkItemType": "User Story", "System.Title": "Export", "System.State": "Active", "System.AssignedTo": { uniqueName: ME } });
  const writer = createDevOpsWriter({ fetch: dv.fetch, log: () => {} });
  const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(NOW).toZonedDateTimeISO("America/New_York") });
  const keyring = new Map<string, string>();
  const target = (clientKey: string): DevOpsTarget => ({ accountId: "a", clientKey, clientName: clientKey, org: "cooptimize", project: "Coop Project", projectName: "Coop Project", email: ME, pat: null });
  let now = NOW;
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(`${base}${o.toml ?? ""}`) }),
    makeDataverse: () => ({ devopsTargets: async (keys: string[]) => ({ ok: true, targets: keys.map(target) }) }) as never,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => ({ forget: () => {}, last: () => null, itemStates: async () => new Map() }) as never,
    saveSystemUserId: async () => {},
    now: () => now,
    sleep: async () => {},
    plan,
    devopsWriter: writer,
    writePats: { get: async (k) => { const v = keyring.get(k); if (!v) throw new Error("not found"); return new Pat(v); }, set: async (k, v) => void keyring.set(k, v), clear: async (k) => void keyring.delete(k) },
  };
  const run = async <T = unknown>(action: string, input: unknown): Promise<T> => {
    const r = await dispatch(c, { action, input });
    if (!r.ok) throw new Error(`${r.status} ${r.error}`);
    return r.data as T;
  };
  /** A planned to-do with a timebox from 9:00 for this many minutes. */
  const boxed = async (itemId: number | null, size: "XS" | "S" | "M" | "L" | null, minutes: number, title = "Work") => {
    await plan.start(D);
    const p = await plan.addPick({ date: D, half: "AM", clientKey: COOP, ...(itemId === null ? { kind: "intention" as const } : { kind: "item" as const, itemId }), title, itemType: "Task", size });
    const end = Temporal.Instant.from(at("09:00")).add({ minutes }).toZonedDateTimeISO("-05:00").toString({ timeZoneName: "never", smallestUnit: "second" });
    const t = await plan.addTimebox({ date: D, clientKey: COOP, pickId: p.id, title, start: at("09:00"), end, outlook: false });
    return { pickId: p.id, timeboxId: t.id };
  };
  const sessions = async (moment: "midday" | "end" = "midday") => (await run<{ rows: SessionView[] }>("checkin.sessions", { date: D, moment })).rows;
  const answer = (pickId: number, a: string, left?: number, moment = "midday") => run<{ timeboxIds: number[] }>("checkin.answer", { date: D, moment, pickId, answer: a, ...(left ? { left } : {}) });
  const offers = async () => (await run<{ offers: ProgressOffer[]; off: boolean }>("devops.progress_offer", { date: D }));
  const patches = () => dv.seen.filter((w) => w.method === "PATCH");
  return { dv, plan, run, boxed, sessions, answer, offers, patches, enable: () => run("devops.set_write_pat", { clientKey: COOP, pat: WRITE_PAT }), later: (h: number) => void (now = Temporal.Instant.from(NOW).add({ hours: h }).toString()) };
}

describe("XS in the store", () => {
  it("is kept on a to-do, a draft and a week story, and an older build would read S", async () => {
    const { plan } = setup();
    await plan.start(D);
    const p = await plan.addPick({ date: D, half: "AM", clientKey: COOP, kind: "intention", title: "Tiny", size: "XS" });
    expect(p.size).toBe("XS");
    expect((await plan.setSize(p.id, "M")).size).toBe("M");
    expect((await plan.setSize(p.id, "XS")).size).toBe("XS");
    const d = await plan.addDraft({ clientKey: COOP, parentItemId: null, title: "Small draft", size: "XS" });
    expect(d.size).toBe("XS");
    expect((await plan.getPick(p.id))?.size).toBe("XS");
  });
});

describe("XS wherever a size is picked", () => {
  it("to-dos and captures take it through their actions", async () => {
    const t = setup();
    const { pickId } = await t.boxed(null, null, 60);
    const r = await t.run<{ pick: { size: string } }>("pick.set_size", { id: pickId, size: "XS" });
    expect(r.pick.size).toBe("XS");
    await expect(t.run("pick.set_size", { id: pickId, size: "XL" })).rejects.toThrow(/XS, S, M or L/);
  });
  it("re-sizing a story on the week list moves its time left", async () => {
    const t = setup();
    const { pickId } = await t.boxed(500, "M", 60);
    await t.answer(pickId, "partly", 60);
    const w = await t.plan.addWeekItem({ weekStart: D, clientKey: COOP, itemId: 500, title: "Mapping", level: "story", tier: "must", size: "M", url: null, type: "Task", parentId: null } as never);
    await t.run("weekplan.set_size", { id: w.id, size: "L" });
    expect((await t.plan.getPick(pickId))?.remainingMinutes).toBe(180);
  });
});

describe("the check-in", () => {
  it("lists only what qualifies, and nothing when nothing does", async () => {
    const t = setup();
    expect(await t.sessions()).toEqual([]);
    const { pickId } = await t.boxed(null, "M", 60);
    expect((await t.sessions()).map((r) => r.pickId)).toEqual([pickId]);
  });
  it("Partly with 1h left updates spent and remaining; the size stays", async () => {
    const t = setup();
    const { pickId } = await t.boxed(null, "M", 60);
    await t.answer(pickId, "partly", 60);
    const p = (await t.plan.getPick(pickId))!;
    expect(p).toMatchObject({ size: "M", status: "planned", spentMinutes: 60, remainingMinutes: 60 });
    expect(await t.sessions()).toEqual([]);
    // The to-do can get another timebox now: the answered one no longer holds it.
    expect((await t.plan.timeboxesBetween(D, D)).find((b) => b.sessionPickId === pickId)?.pickId).toBeNull();
  });
  it("Done marks it done, Didn't get to it takes it back to not timeboxed with nothing else changed", async () => {
    const t = setup();
    const a = await t.boxed(null, "S", 60, "One");
    await t.answer(a.pickId, "done");
    expect(await t.plan.getPick(a.pickId)).toMatchObject({ status: "done", spentMinutes: 60, remainingMinutes: 0 });
    const b = await t.boxed(null, "M", 60, "Two");
    await t.answer(b.pickId, "none");
    expect((await t.plan.getPick(b.pickId))?.remainingMinutes).toBeUndefined();
    expect((await t.plan.timeboxesBetween(D, D)).find((x) => x.id === b.timeboxId)?.removedAt).not.toBeNull();
  });
  it("Didn't get to it leaves an Outlook timebox on Outlook but frees the to-do", async () => {
    const t = setup();
    const { pickId, timeboxId } = await t.boxed(null, "M", 60);
    await t.plan.updateTimebox(timeboxId, { outlook: true });
    await t.answer(pickId, "none");
    expect((await t.plan.timeboxesBetween(D, D)).find((x) => x.id === timeboxId)).toMatchObject({ removedAt: null, pickId: null, outlook: true });
  });
  it("All went to plan: a covered to-do is done, the others count the timebox as spent", async () => {
    const t = setup();
    const full = await t.boxed(null, "S", 60, "Covered");
    const part = await t.boxed(null, "M", 60, "Part");
    const r = await t.run<{ done: number[]; partly: number }>("checkin.all_to_plan", { date: D, moment: "midday" });
    expect(r).toMatchObject({ done: [full.pickId], partly: 1 });
    expect(await t.plan.getPick(full.pickId)).toMatchObject({ status: "done", remainingMinutes: 0 });
    expect(await t.plan.getPick(part.pickId)).toMatchObject({ status: "planned", remainingMinutes: 60, spentMinutes: 60 });
  });
  it("what's skipped rolls to the next check-in; once the day is closed out nothing asks", async () => {
    const t = setup();
    const { pickId } = await t.boxed(null, "M", 60);
    expect((await t.sessions("midday")).length).toBe(1);
    expect((await t.sessions("end")).map((r) => r.pickId)).toEqual([pickId]);
    await t.run("closeout.commit", { date: D });
    expect(await t.sessions("end")).toEqual([]);
    expect((await t.plan.getPick(pickId))?.status).toBe("planned");
  });
  it("midday is only about today", async () => {
    const t = setup();
    await t.boxed(null, "M", 60);
    t.later(24);
    expect(await t.sessions("midday")).toEqual([]);
  });
  it("Undo puts back the timebox, the status and the time", async () => {
    const t = setup();
    const a = await t.boxed(null, "S", 60, "One");
    const ids = (await t.answer(a.pickId, "done")).timeboxIds;
    await t.run("checkin.undo", { timeboxIds: ids });
    const p = (await t.plan.getPick(a.pickId))!;
    expect(p.status).toBe("planned");
    expect(p.remainingMinutes).toBeUndefined();
    expect((await t.sessions()).length).toBe(1);
    const b = await t.boxed(null, "M", 60, "Two");
    const idsB = (await t.answer(b.pickId, "none")).timeboxIds;
    await t.run("checkin.undo", { timeboxIds: idsB });
    expect((await t.plan.timeboxesBetween(D, D)).find((x) => x.id === b.timeboxId)).toMatchObject({ removedAt: null, pickId: b.pickId });
  });
  it("a DevOps item keeps its progress when it's carried or picked again", async () => {
    const t = setup();
    const { pickId } = await t.boxed(500, "M", 60);
    await t.answer(pickId, "partly", 60);
    const again = await t.plan.addPick({ date: "2026-11-03", half: "AM", clientKey: COOP, kind: "item", itemId: 500, title: "Work", size: "M" });
    expect(again).toMatchObject({ remainingMinutes: 60, spentMinutes: 60 });
  });
  it("a size change moves the time left", async () => {
    const t = setup();
    const { pickId } = await t.boxed(null, "M", 60);
    await t.answer(pickId, "partly", 60);
    await t.run("pick.set_size", { id: pickId, size: "L" });
    expect(await t.plan.getPick(pickId)).toMatchObject({ size: "L", remainingMinutes: 180 });
  });
});

describe("the end of day DevOps offer", () => {
  const partly = async (t: ReturnType<typeof setup>) => {
    await t.enable();
    const a = await t.boxed(500, "M", 60, "Mapping");
    const b = await t.boxed(501, "M", 60, "Export");
    await t.answer(a.pickId, "partly", 60, "end");
    await t.answer(b.pickId, "partly", 60, "end");
    return { a, b };
  };
  it("Remaining Work where the type has it, a comment where it doesn't; only partly answers", async () => {
    const t = setup();
    await t.enable();
    const doneOne = await t.boxed(500, "S", 60, "Mapping");
    await t.answer(doneOne.pickId, "done", undefined, "end");
    expect((await t.offers()).offers).toEqual([]);
    const a = await t.boxed(501, "M", 60, "Export");
    await t.answer(a.pickId, "partly", 60, "end");
    expect((await t.offers()).offers).toMatchObject([{ itemId: 501, mode: "comment", text: "Worked 1h today, about 1h left" }]);
  });
  it("offers Remaining Work, previews before and after, writes behind /rev, reads back, logs and undoes", async () => {
    const t = setup();
    await partly(t);
    const { offers } = await t.offers();
    const rw = offers.find((o) => o.mode === "remaining")!;
    expect(rw).toMatchObject({ itemId: 500, hours: 1 });
    const { preview } = await t.run<{ preview: DevOpsPreview }>("devops.preview", { clientKey: COOP, change: { kind: "remaining_work", itemId: 500, hours: rw.hours, pickId: rw.pickId } });
    expect(preview.fields.find((f) => f.changed)).toMatchObject({ label: "Remaining Work", before: "2", after: "1" });
    expect(t.patches()).toHaveLength(0);
    const r = await t.run<DevOpsResult>("devops.confirm", { previewId: preview.previewId });
    expect(r.confirmed).toBe(true);
    expect(t.patches()).toHaveLength(1);
    const ops = t.patches()[0]!.body as { op: string; path: string; value?: unknown }[];
    expect(ops[0]).toMatchObject({ op: "test", path: "/rev" });
    expect(ops[1]).toMatchObject({ path: "/fields/Microsoft.VSTS.Scheduling.RemainingWork", value: 1 });
    const undo = await t.run<{ preview: DevOpsPreview }>("devops.preview", { clientKey: COOP, change: { kind: "undo", writeId: r.entry.id } });
    await t.run("devops.confirm", { previewId: undo.preview.previewId });
    expect(t.dv.items.get(500)!.fields["Microsoft.VSTS.Scheduling.RemainingWork"]).toBe(2);
  });
  it("is refused on a type without the field; the comment goes through the same preview", async () => {
    const t = setup();
    await t.enable();
    await expect(t.run("devops.preview", { clientKey: COOP, change: { kind: "remaining_work", itemId: 501, hours: 1 } })).rejects.toThrow(/no Remaining Work/);
    const { preview } = await t.run<{ preview: DevOpsPreview }>("devops.preview", { clientKey: COOP, change: { kind: "comment", itemId: 501, text: "Worked 1h today, about 1h left" } });
    expect(preview.op).toBe("comment");
  });
  it("is made once: Skip or Confirm ends it for the day", async () => {
    const t = setup();
    await partly(t);
    expect((await t.offers()).offers.length).toBe(2);
    await t.run("checkin.offer_close", { date: D });
    expect((await t.offers()).offers).toEqual([]);
  });
  it("the setting turns it off, and nothing is read from DevOps", async () => {
    const t = setup({ toml: "\n[plan]\ndevops_progress_offer = false\n" });
    await partly(t);
    const before = t.dv.seen.length;
    expect(await t.offers()).toMatchObject({ offers: [], off: true });
    expect(t.dv.seen.length).toBe(before);
  });
  it("never writes on its own: answers touch only the plan store", async () => {
    const t = setup();
    await partly(t);
    expect(t.patches()).toHaveLength(0);
  });
});

describe("TX-1b: fixes from the TX-1 review", () => {
  const TUE = "2026-11-03";
  const NEXT_MON = "2026-11-09";
  type T = ReturnType<typeof setup>;
  type Applied = { pickId: number; timeboxIds: number[]; as: string; left: number; removed: string[]; notice: string | null };
  const pickOn = async (t: T, date: string, itemId: number) => {
    await t.plan.start(date);
    return t.plan.addPick({ date, half: "AM", clientKey: COOP, kind: "item", itemId, title: "Mapping", itemType: "Task", size: "M" });
  };
  const story = (t: T, weekStart: string, itemId = 500) => t.plan.addWeekItem({ weekStart, clientKey: COOP, itemId, title: "Mapping", itemType: "Task", url: null, level: "story", tier: "must", size: "M" });
  const leftOn = async (t: T, weekStart: string, itemId = 500) => (await t.plan.weekPlan(weekStart)).features.find((f) => f.itemId === itemId)?.remainingMinutes ?? null;
  const allToPlan = (t: T) => t.run<{ applied: Applied[]; timeboxIds: number[]; done: number[] }>("checkin.all_to_plan", { date: D, moment: "midday" });

  it("bug 1: a drag, an Outlook toggle or a sync on an answered timebox keeps its to-do link, and Undo restores spent and left exactly", async () => {
    const t = setup();
    const a = await t.boxed(500, "M", 60);
    await t.plan.setRemaining(a.pickId, 100);
    const { timeboxIds } = await t.answer(a.pickId, "partly", 60, "end");
    await t.plan.updateTimebox(a.timeboxId, { start: at("09:15"), end: at("10:15") });
    await t.plan.updateTimebox(a.timeboxId, { outlook: false });
    await t.plan.updateTimebox(a.timeboxId, { pickId: null }); // What Outlook sync passes for a timebox that moved.
    expect((await t.plan.timebox(a.timeboxId))?.sessionPickId).toBe(a.pickId);
    await t.enable();
    expect((await t.offers()).offers.map((o) => o.pickId)).toEqual([a.pickId]);
    await t.run("checkin.undo", { timeboxIds });
    expect(await t.plan.getPick(a.pickId)).toMatchObject({ status: "planned", remainingMinutes: 100, spentMinutes: 0 });
  });

  it("bug 2: Done removes the story's planned to-dos on later days, says so once, and Undo puts them back", async () => {
    const t = setup();
    const a = await t.boxed(500, "M", 120);
    const tue = await pickOn(t, TUE, 500);
    const box = await t.plan.addTimebox({ date: TUE, clientKey: COOP, pickId: tue.id, title: "Mapping", start: `${TUE}T09:00:00-05:00`, end: `${TUE}T10:00:00-05:00`, outlook: false });
    const out = (await t.answer(a.pickId, "done")) as unknown as { timeboxIds: number[]; removed: string[]; notice: string };
    expect(out).toMatchObject({ removed: [TUE], notice: "Removed from Tue, story is done" });
    expect((await t.plan.getPick(tue.id))?.status).toBe("dropped");
    expect((await t.plan.timebox(box.id))?.removedAt).toBeTruthy();
    await t.run("checkin.undo", { timeboxIds: out.timeboxIds });
    expect(await t.plan.getPick(tue.id)).toMatchObject({ status: "planned" });
    expect((await t.plan.getPick(tue.id))?.remainingMinutes).toBeUndefined();
    expect((await t.plan.timebox(box.id))?.removedAt).toBeNull();
  });

  it("bug 3: a Done in an earlier week never counts as 0h later; the last time left before it, else the size", async () => {
    const t = setup();
    const a = await t.boxed(500, "M", 120);
    await t.plan.setRemaining(a.pickId, 90);
    await story(t, D);
    await t.answer(a.pickId, "done");
    expect(await leftOn(t, D)).toBe(0); // That week it's done.
    await story(t, NEXT_MON);
    expect(await leftOn(t, NEXT_MON)).toBe(90);
    expect((await pickOn(t, NEXT_MON, 500)).remainingMinutes).toBe(90);

    const b = await t.boxed(501, "M", 120);
    await story(t, NEXT_MON, 501);
    await t.answer(b.pickId, "done");
    expect(await leftOn(t, NEXT_MON, 501)).toBeNull();
    expect((await pickOn(t, NEXT_MON, 501)).remainingMinutes).toBeUndefined();
  });

  it("bug 7: re-sizing the to-do and its week story together moves the time left once; a timebox's length doesn't move it", async () => {
    const t = setup();
    const a = await t.boxed(500, "M", 60);
    await t.answer(a.pickId, "partly", 60);
    const w = await story(t, D);
    await t.plan.updateTimebox(a.timeboxId, { end: at("11:00") });
    expect((await t.plan.getPick(a.pickId))?.remainingMinutes).toBe(60);
    await t.run("pick.set_size", { id: a.pickId, size: "L" });
    expect((await t.plan.getPick(a.pickId))?.remainingMinutes).toBe(180);
    await t.run("weekplan.set_size", { id: w.id, size: "L" });
    expect((await t.plan.getPick(a.pickId))?.remainingMinutes).toBe(180);
  });

  it("bug 8: All went to plan works from the rows as they are now: one answered elsewhere is skipped and every applied row has its Undo", async () => {
    const t = setup();
    const a = await t.boxed(500, "M", 60);
    const b = await t.boxed(501, "M", 60);
    await t.answer(a.pickId, "partly", 60); // Answered in Teams while this page sat open.
    const out = await allToPlan(t);
    expect(out.applied.map((r) => [r.pickId, r.timeboxIds, r.as, r.left])).toEqual([[b.pickId, [b.timeboxId], "partly", 60]]);
    expect((await t.plan.getPick(a.pickId))?.remainingMinutes).toBe(60);
    await t.run("checkin.undo", { timeboxIds: out.applied[0]!.timeboxIds });
    expect((await t.plan.getPick(b.pickId))?.remainingMinutes).toBeUndefined();
  });

  it("bug 9: All went to plan is all or nothing: a failure partway leaves every row as it was", async () => {
    const t = setup();
    const a = await t.boxed(500, "M", 120);
    const b = await t.boxed(501, "M", 120);
    const real = t.plan.getPick.bind(t.plan);
    let raced = false;
    (t.plan as { getPick: typeof real }).getPick = async (id: number) => {
      if (id === b.pickId && !raced) {
        raced = true; // Teams answers the second row between the read and the write.
        await t.plan.settleSessions({ pickId: b.pickId, timeboxIds: [b.timeboxId], as: "partly", spent: 120, remaining: 30 });
      }
      return real(id);
    };
    await expect(allToPlan(t)).rejects.toThrow(/409/);
    expect((await t.plan.getPick(a.pickId))?.status).toBe("planned");
    expect((await t.sessions()).map((r) => r.pickId)).toEqual([a.pickId]);
  });
});
