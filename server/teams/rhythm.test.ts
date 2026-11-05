// TB-2: the rhythm engine with the real actions (dispatch on a real plan store and the week from the Dataverse
// fakes), the real assistant service (propose and confirm, no AI), the real bot and rhythm stores (SQLite and SQL
// Server) and a fake Teams sender: each kind once at its time and never when it shouldn't, sent once with two
// replicas, at most once when a send is lost, Done on a card is the app's own pick.mark_done with Undo, close out in my
// words is one proposal and one Confirm, nudges batch one an hour, pacing and a blocked chat, and no text in the log.
import { createSnapshotStore } from "../../host/local/snapshots.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { assistantFor, dispatch, type ActionContext } from "../../actions/dispatch.ts";
import type { ActionName } from "../../actions/registry.ts";
import { parseConfig } from "../../config/schema.ts";
import { STARTER_TOML } from "../../fixtures/starter.ts";
import type { LogRecord } from "../../log/logger.ts";
import { createDataverseSource } from "../../sources/dataverse/source.ts";
import { dvConfig, FAKE_SECRET, fakeFetch } from "../../sources/dataverse/test-fakes.ts";
import type { DevOpsSource } from "../../sources/devops/source.ts";
import { createPlanStore, type NewPick } from "../../store/plan-store.ts";
import { createTeamsBotStore } from "../../store/teams-bot-store.ts";
import { createTeamsRhythmStore } from "../../store/teams-rhythm-store.ts";
import { addUsers, forEachDriver } from "../../test/db.ts";
import type { Assistant } from "../../assistant/types.ts";
import { teamsAssistant } from "./assistant.ts";
import type { OutActivity, Sender } from "./bot.ts";
import { Blocked, BLOCKED_KEY, createRhythm, pacedSender, type Takeover } from "./rhythm.ts";

const NY = "America/New_York";
const URL_ = "https://ft-dev-app.example.azurecontainerapps.io";
const ANA = "aaaaaaaa-0000-0000-0000-00000000000a";
const MON = "2026-11-02";
const SECRET = "Quarterly board deck for Adatum";
const BASE = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"').replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`).replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl);
const ON = `\n[notify]\nteams_messages = true\nteams_brief = true\nteams_checkin = true\nteams_closeout = true\nteams_nudges = true\n`;
const local = (t: string) => Temporal.ZonedDateTime.from(`${MON}T${t}[${NY}]`).toInstant();

async function setup(d: { open: () => Promise<{ conn: import("../../store/sql/conn.ts").Conn }> }, o: { toml?: string; takeovers?: Takeover[]; send?: Sender["send"]; inboxItems?: unknown[] } = {}) {
  const db = await d.open();
  await addUsers(db.conn, ANA);
  let now = local("09:05");
  let toml = BASE + (o.toml ?? ON);
  const dir = mkdtempSync(join(tmpdir(), "ft-rhythm-"));
  const dv = fakeFetch("ok");
  const plan = createPlanStore({ path: ":memory:", now: () => now.toZonedDateTimeISO(NY) });
  const devops = { load: async () => [], lookup: () => null, orgOf: () => "contoso", last: () => null } as unknown as DevOpsSource;
  const ctx: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(toml) }),
    makeDataverse: (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, snapshots: createSnapshotStore(dir), log: () => {} }),
    makeOutlook: () => {
      throw new Error("n/a");
    },
    makeGoogle: () => {
      throw new Error("n/a");
    },
    makeDevOps: () => devops,
    saveSystemUserId: async () => {},
    writeConfig: async (edit) => ((toml = edit(toml)), { ok: true, parsed: parseConfig(toml) } as never),
    now: () => now.toString(),
    plan,
  };
  const runs: string[] = [];
  let confirms = 0;
  const run = async (_u: string, action: string, input: unknown) => {
    runs.push(action);
    // IB-1's later slices (titles, snoozes) as inbox.list will return them.
    if (action === "inbox.list" && o.inboxItems) return { ok: true as const, data: { today: MON, items: o.inboxItems, counts: {}, needsYou: 0 } };
    return dispatch(ctx, { action: action as ActionName, input });
  };
  const svc = async () => (await assistantFor(ctx, "teams", URL_))!.service;
  const hub: Pick<Assistant, "handle" | "confirm" | "cancel" | "propose"> = {
    handle: async (i) => (await svc()).handle(i.text, i.context ?? {}),
    confirm: async (i) => (confirms++, (await svc()).confirm(i.proposalId, i.edits ?? {})),
    cancel: async (i) => (await svc()).cancel(i.proposalId),
    propose: async (i) => (await svc()).propose(i.tool, i.args),
  };
  const sent: { a: OutActivity; id: string }[] = [];
  const updates: { id: string; a: OutActivity }[] = [];
  let n = 0;
  const inner: Sender = {
    send: o.send ?? (async (_to, a) => {
      const id = `msg-${++n}`;
      sent.push({ a, id });
      return { id };
    }),
    update: async (_to, id, a) => void updates.push({ id, a }),
  };
  const logs: LogRecord[] = [];
  const blocked: string[] = [];
  const clock = () => now;
  const deps = {
    publicUrl: URL_,
    sender: inner,
    botStore: (u: string) => createTeamsBotStore({ db: db.conn, userId: u, now: clock }),
    store: (u: string) => createTeamsRhythmStore({ db: db.conn, userId: u, now: clock }),
    plan: async () => plan,
    run,
    config: async () => {
      const p = parseConfig(toml);
      return p.ok ? p.config : null;
    },
    assistant: teamsAssistant(hub, URL_),
    takeovers: async () => o.takeovers ?? [],
    blocked: async (u: string) => {
      blocked.push(u);
      await plan.setState(BLOCKED_KEY, now.toString());
    },
    log: (r: Pick<LogRecord, "op" | "kind" | "count" | "status">) => logs.push({ source: "server", ...r }),
    now: clock,
  };
  const rhythm = createRhythm(deps);
  await deps.botStore(ANA).saveChat({ conversationId: "a:ana-1", serviceUrl: "https://smba.trafficmanager.net/amer/", tenantId: "t", botId: "28:bot" });
  const facts = async (f: Partial<{ inHours: boolean; pto: boolean; focusRunning: boolean }> = {}) => ({ config: (await deps.config())!, inHours: true, pto: false, focusRunning: false, ...f });
  const add = (p: Partial<NewPick> = {}) => plan.addPick({ date: MON, half: "AM", clientKey: "Adatum", kind: "intention", title: "Review the mapping", size: "M", ...p });
  const cardsSent = () => sent.map((s) => JSON.stringify((s.a as { attachments?: unknown[] }).attachments ?? []));
  const tap = async (occasion: string, op: string, extra: Record<string, unknown> = {}) => {
    const t = rhythm.tapOf({ action: { type: "Action.Execute", verb: "rhythm", data: { ft: "rhythm", occasion, op, ...extra } } });
    expect(t).not.toBeNull();
    return JSON.stringify((await rhythm.tap(ANA, t!)).value);
  };
  return { confirms: () => confirms, db, plan, rhythm, deps, sent, updates, logs, runs, blocked, facts, add, cardsSent, tap, at: (t: string) => void (now = local(t)), setToml: (t: string) => void (toml = BASE + t), rhythmStore: deps.store(ANA) };
}

await forEachDriver("the bot's rhythm in Teams (TB-2)", (d) => {
  it("sends the morning brief once at its time, with today's blocks, picks and Confirm today", async () => {
    const t = await setup(d);
    await t.add({ title: "Fix the login timeout" });
    t.at("08:50");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(0);
    t.at("09:05");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(1);
    const card = t.cardsSent()[0]!;
    expect(card).toContain("FocusTime · Morning brief");
    expect(card).toContain("Fix the login timeout");
    expect(card).toContain("Confirm today");
    expect(card).toContain(`${URL_}/#/today`);
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(1);
  });

  it("never with the master switch or the kind off, on PTO days, during focus or in quiet hours", async () => {
    const t = await setup(d, { toml: "\n[notify]\nteams_messages = false\nteams_brief = true\n" });
    await t.rhythm.tick(ANA, await t.facts());
    t.setToml("\n[notify]\nteams_messages = true\nteams_brief = false\n");
    await t.rhythm.tick(ANA, await t.facts());
    t.setToml(ON);
    await t.rhythm.tick(ANA, await t.facts({ pto: true }));
    await t.rhythm.tick(ANA, await t.facts({ focusRunning: true }));
    await t.rhythm.tick(ANA, await t.facts({ inHours: false }));
    expect(t.sent).toHaveLength(0);
    expect(t.logs.some((l) => l.kind === "brief_waits_focus")).toBe(true);
    // Focus over, still in the brief's window: it goes now.
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(1);
  });

  it("with two replicas a scheduled message is sent once (the claim)", async () => {
    const t = await setup(d);
    const other = createRhythm(t.deps);
    await Promise.all([t.rhythm.tick(ANA, await t.facts()), other.tick(ANA, await t.facts())]);
    expect(t.sent).toHaveLength(1);
  });

  it("at most once: a send Teams refused, or one lost before Teams answered, is never sent again", async () => {
    let fail = true;
    const t = await setup(d, { send: async () => {
      if (fail) throw Object.assign(new Error("x"), { response: { status: 500 } });
      return { id: "m" };
    } });
    await t.rhythm.tick(ANA, await t.facts());
    expect((await t.rhythmStore.get(`brief:${MON}`))?.state).toBe("failed");
    fail = false;
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.logs.filter((l) => l.kind === "brief_sent")).toHaveLength(0);
    // A claim that never reached Teams (a crash between the claim and the send) becomes lost and is logged.
    expect(await t.rhythmStore.claim(`checkin:${MON}`, "checkin")).toBe(true);
    t.at("12:30");
    expect((await t.rhythmStore.sweep()).lost).toBe(1);
    expect((await t.rhythmStore.get(`checkin:${MON}`))?.state).toBe("lost");
  });

  it("check-in: Done is the app's own pick.mark_done, with Undo; Move the rest proposes, Confirm moves them", async () => {
    const t = await setup(d);
    const a = await t.add({ title: "Fix the login timeout" });
    const b = await t.add({ title: "Write the release notes" });
    t.at("12:10");
    await t.rhythm.tick(ANA, await t.facts());
    const occ = `checkin:${MON}`;
    expect(t.cardsSent().at(-1)).toContain("FocusTime · Midday check-in");
    let card = await t.tap(occ, "done", { pickId: a.id });
    expect((await t.plan.getPick(a.id))?.status).toBe("done");
    expect(t.runs).toContain("pick.mark_done");
    expect(card).toContain("✓ Fix the login timeout");
    expect(card).toContain("Undo");
    await t.tap(occ, "undone", { pickId: a.id });
    expect((await t.plan.getPick(a.id))?.status).toBe("planned");
    await t.tap(occ, "done", { pickId: a.id });
    card = await t.tap(occ, "move_rest", { moveTo: `${MON}:PM` });
    expect(card).toContain("Move \\\"Write the release notes\\\"");
    expect((await t.plan.getPick(b.id))?.half).toBe("AM");
    const row = (await t.rhythmStore.get(occ))!.model as { proposal: { proposalId: string } };
    card = await t.tap(occ, "confirm", { proposalId: row.proposal.proposalId });
    expect(card).toContain("Done: ");
    expect((await t.plan.getPick(b.id))?.half).toBe("PM");
    // A second tap on the same Confirm runs nothing again.
    await t.tap(occ, "confirm", { proposalId: row.proposal.proposalId });
    expect(t.confirms()).toBe(1);
  });

  it("close out in my words: one proposal shows done, moved on and closed out; one Confirm does all of it", async () => {
    const t = await setup(d);
    const a = await t.add({ title: "Fix the login timeout" });
    const b = await t.add({ title: "Write the release notes", half: "PM" });
    t.at("16:40");
    await t.rhythm.tick(ANA, await t.facts());
    const occ = `closeout:${MON}`;
    expect(t.cardsSent().at(-1)).toContain("What got done today?");
    const reply = await t.rhythm.closeoutReply(ANA, "fixed the login timeout");
    expect(reply).toContain("Close out card above");
    const m = (await t.rhythmStore.get(occ))!.model as { proposal: { proposalId: string; changes: { field: string; after: string | null }[] } };
    expect(m.proposal.changes.map((c) => [c.field, c.after])).toEqual([["Fix the login timeout", "Done"], ["Write the release notes", expect.stringMatching(/^Moves to |^Unfinished list$/)], ["The day", "Closed out"]]);
    expect(t.updates.at(-1)?.id).toBe("msg-1");
    const card = await t.tap(occ, "confirm", { proposalId: m.proposal.proposalId });
    expect(card).toContain("Done: Close out");
    expect((await t.plan.getPick(a.id))?.status).toBe("done");
    expect((await t.plan.day(MON))?.closedOutAt).toBeTruthy();
    const moved = await t.plan.getPick(b.id);
    // What happened to the unfinished pick is what the preview said.
    const said = m.proposal.changes[1]!.after!;
    expect(moved?.status).toBe(said === "Unfinished list" ? "planned" : "moved");
  });

  it("capture: saves to Captures as typed, Undo removes it", async () => {
    const t = await setup(d);
    const r = await t.rhythm.capture(ANA, "call Dana about the export");
    expect(JSON.stringify(r.card)).toContain("Captured to sort later");
    const caps = await t.plan.inbox();
    expect(caps.map((c) => c.text)).toEqual(["call Dana about the export"]);
    const id = caps[0]!.id;
    const undo = t.rhythm.tapOf({ action: { verb: "capture_undo", data: { ft: "capture_undo", captureId: id } } })!;
    expect(JSON.stringify((await t.rhythm.tap(ANA, undo)).value)).toContain("Removed from Captures");
    expect(await t.plan.inbox()).toEqual([]);
  });

  it("nudges: batched into one card, at most one an hour, each item once", async () => {
    const take = (k: string): Takeover => ({ key: k, itemId: Number(k), title: "Login fix", clientName: "Adatum", byName: "Sam", at: local("13:00").toString() });
    const list: Takeover[] = [take("4417"), take("4418")];
    const t = await setup(d, { toml: "\n[notify]\nteams_messages = true\nteams_nudges = true\n", takeovers: list });
    t.at("13:30");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(1);
    expect(t.cardsSent()[0]).toContain("#4417 Login fix");
    expect(t.cardsSent()[0]).toContain("#4418 Login fix");
    list.push(take("4419"));
    t.at("14:00");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(1);
    t.at("14:45");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(2);
    expect(t.cardsSent()[1]).toContain("#4419");
    expect(t.cardsSent()[1]).not.toContain("#4417");
  });

  it("IB-1's items once they carry titles: promises and sends to me; never a snoozed one, nor my own sends (kind sent)", async () => {
    const at = local("08:00").toString();
    const item = (o: Record<string, unknown>) => ({ clientKey: "Adatum", at, views: ["needs_you"], who: "Dana", due: MON, done: false, ...o });
    const t = await setup(d, {
      toml: "\n[notify]\nteams_messages = true\nteams_nudges = true\n",
      inboxItems: [
        item({ key: "f1", kind: "promise", title: "Send the totals" }),
        item({ key: "f2", kind: "promise", title: "Snoozed promise", snoozedUntil: local("18:00").toString(), views: [] }),
        item({ key: "s3", kind: "send", title: "Export spec", sendState: "waiting" }),
        item({ key: "s4", kind: "sent", title: "My own send", sendState: "waiting", views: ["waiting"] }),
        item({ key: "c5", kind: "commitment", title: "Their commitment", views: ["waiting"] }),
      ],
    });
    t.at("15:30");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(1);
    const card = t.cardsSent()[0]!;
    expect(card).toContain("Send the totals");
    expect(card).toContain("Export spec");
    expect(card).not.toContain("Snoozed promise");
    expect(card).not.toContain("My own send");
    expect(card).not.toContain("Their commitment");
  });

  it("a test goes now past the switches; a blocked chat turns Teams messages off", async () => {
    const t = await setup(d, { toml: "\n[notify]\nteams_messages = false\n", send: async () => {
      throw Object.assign(new Error("Forbidden"), { response: { status: 403, data: { error: { code: "Forbidden", message: "Thread is blocked from message writes.", subCode: "MessageWritesBlocked" } } } });
    } });
    const paced = createRhythm({ ...t.deps, sender: pacedSender(t.deps.sender) });
    const r = await paced.test(ANA, "brief");
    expect(r.ok).toBe(false);
    expect(t.blocked).toEqual([ANA]);
    expect(t.logs.some((l) => l.kind === "blocked")).toBe(true);
  });

  it("logs kinds and counts only: no titles, captured text or chat ids", async () => {
    const t = await setup(d);
    await t.add({ title: SECRET });
    await t.rhythm.tick(ANA, await t.facts());
    await t.rhythm.capture(ANA, `capture text ${SECRET}`);
    t.at("16:40");
    await t.rhythm.tick(ANA, await t.facts());
    await t.rhythm.closeoutReply(ANA, SECRET);
    const all = JSON.stringify(t.logs);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("a:ana-1");
    expect(all).not.toContain("Board");
  });
});

it("pacing: retries 429, 412, 502 and 504 with backoff (or Retry-After), at most 3 times; a blocked chat is Blocked", async () => {
  const waits: number[] = [];
  let calls = 0;
  const flaky: Sender = {
    send: async () => {
      calls++;
      if (calls === 1) throw { response: { status: 429, headers: { "retry-after": "3" } } };
      if (calls === 2) throw { response: { status: 502 } };
      return { id: "ok" };
    },
    update: async () => {},
  };
  const s = pacedSender(flaky, { sleep: async (ms) => void waits.push(ms), random: () => 0.5 });
  expect(await s.send({ conversationId: "a", serviceUrl: "https://x" }, { type: "typing" })).toEqual({ id: "ok" });
  expect(waits.filter((w) => w >= 1000)).toEqual([3000, 4000]);
  let n = 0;
  const down = pacedSender({ send: async () => (n++, Promise.reject({ response: { status: 504 } })), update: async () => {} }, { sleep: async () => {} });
  await expect(down.send({ conversationId: "a", serviceUrl: "https://x" }, { type: "typing" })).rejects.toBeTruthy();
  expect(n).toBe(4);
  const blocked = pacedSender({ send: async () => Promise.reject({ response: { status: 403, data: { error: { subCode: "MessageWritesBlocked" } } } }), update: async () => {} }, { sleep: async () => {} });
  await expect(blocked.send({ conversationId: "a", serviceUrl: "https://x" }, { type: "typing" })).rejects.toBeInstanceOf(Blocked);
});
