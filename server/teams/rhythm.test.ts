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
import type { StatusLoad } from "../../plan/status-types.ts";
import { aStatusLoad } from "../../test/builders/index.ts";
import { Pat } from "../../sources/devops/pat.ts";
import { fakeDevOpsWrite, WRITE_PAT } from "../../sources/devops/write-fakes.ts";
import { createDevOpsWriter } from "../../sources/devops/write.ts";

const NY = "America/New_York";
const URL_ = "https://ft-dev-app.example.azurecontainerapps.io";
const ANA = "aaaaaaaa-0000-0000-0000-00000000000a";
const MON = "2026-11-02";
const SECRET = "Quarterly board deck for Adatum";
const BASE = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"').replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`).replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl);
const ON = `\n[notify]\nteams_messages = true\nteams_brief = true\nteams_checkin = true\nteams_closeout = true\nteams_nudges = true\n`;
const local = (t: string) => Temporal.ZonedDateTime.from(`${MON}T${t}[${NY}]`).toInstant();

async function setup(d: { open: () => Promise<{ conn: import("../../store/sql/conn.ts").Conn }> }, o: { toml?: string; takeovers?: Takeover[]; send?: Sender["send"]; status?: () => StatusLoad; /** MC-1: meeting.mine's answer. */ meetings?: () => unknown; /** PK-1: a fake DevOps with my write PAT for Adatum. */ devops?: ReturnType<typeof fakeDevOpsWrite> } = {}) {
  const db = await d.open();
  await addUsers(db.conn, ANA);
  let now = local("09:05");
  let toml = BASE + (o.toml ?? ON);
  const dir = mkdtempSync(join(tmpdir(), "ft-rhythm-"));
  const dv = fakeFetch("ok");
  const plan = createPlanStore({ path: ":memory:", now: () => now.toZonedDateTimeISO(NY) });
  const devops = { load: async () => [], lookup: () => null, orgOf: () => "contoso", last: () => null, forget: () => {} } as unknown as DevOpsSource;
  const ctx: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(toml) }),
    makeDataverse: (cfg, tz) => {
      const src = createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, snapshots: createSnapshotStore(dir), log: () => {} });
      // PK-1: Adatum's DevOps (a fake org) with my identity, for the write PAT check and the state write.
      return o.devops ? { ...src, devopsTargets: async (keys: string[]) => ({ ok: true as const, targets: keys.map((k) => ({ accountId: "a", clientKey: k, clientName: k, org: "cooptimize", project: "P", projectName: "P", email: "avery@cooptimize.example", pat: null })) }) } : src;
    },
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
    ...(o.devops ? { devopsWriter: createDevOpsWriter({ fetch: o.devops.fetch, log: () => {} }), writePats: { get: async () => new Pat(WRITE_PAT), set: async () => {}, clear: async () => {} }, sleep: async () => {} } : {}),
  };
  const runs: string[] = [];
  let confirms = 0;
  const run = async (_u: string, action: string, input: unknown) => (runs.push(action), action === "status.load" && o.status ? { ok: true as const, data: o.status() } : action === "meeting.mine" && o.meetings ? { ok: true as const, data: o.meetings() } : dispatch(ctx, { action: action as ActionName, input }));
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
  if (o.devops) {
    const r = await dispatch(ctx, { action: "devops.set_write_pat", input: { clientKey: "Adatum", pat: WRITE_PAT } });
    expect(r.ok).toBe(true);
  }
  return { confirms: () => confirms, db, plan, rhythm, deps, sent, updates, logs, runs, blocked, facts, add, cardsSent, tap, at: (t: string) => void (now = local(t)), atOn: (date: string, t: string) => void (now = Temporal.ZonedDateTime.from(`${date}T${t}[${NY}]`).toInstant()), setToml: (t: string) => void (toml = BASE + t), rhythmStore: deps.store(ANA) };
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

  it("PK-1: Done on a check-in card offers the item's DevOps done state; a double tap on Confirm writes once; Undo offers the write's undo", async () => {
    const dv = fakeDevOpsWrite({ now: () => MON });
    dv.add(500, { "System.WorkItemType": "User Story", "System.Title": "Import mapping", "System.State": "Active", "System.AssignedTo": { uniqueName: "avery@cooptimize.example" } });
    const t = await setup(d, { devops: dv });
    const a = await t.add({ kind: "item", itemId: 500, title: "Import mapping", itemType: "User Story" });
    t.at("12:10");
    await t.rhythm.tick(ANA, await t.facts());
    const occ = `checkin:${MON}`;
    let card = await t.tap(occ, "done", { pickId: a.id });
    expect((await t.plan.getPick(a.id))?.status).toBe("done");
    expect(card).toContain("Set #500 to Closed");
    expect(card).toContain("Confirm");
    const patches = () => dv.seen.filter((x) => x.method === "PATCH").length;
    expect(patches()).toBe(0);
    const row = (await t.rhythmStore.get(occ))!.model as { proposal: { proposalId: string } };
    card = await t.tap(occ, "confirm", { proposalId: row.proposal.proposalId });
    await t.tap(occ, "confirm", { proposalId: row.proposal.proposalId });
    expect(t.confirms()).toBe(1);
    expect(patches()).toBe(1);
    expect(dv.items.get(500)!.fields["System.State"]).toBe("Closed");
    card = await t.tap(occ, "undone", { pickId: a.id });
    expect(card).toContain("Put #500 back to Active");
    expect(patches()).toBe(1);
    expect(t.logs.map((l) => JSON.stringify(l)).join()).not.toContain("Import mapping");
  });

  it("PK-1: with Never ask, Done on the card offers nothing", async () => {
    const dv = fakeDevOpsWrite({ now: () => MON });
    dv.add(500, { "System.WorkItemType": "User Story", "System.Title": "Import mapping", "System.State": "Active", "System.AssignedTo": { uniqueName: "avery@cooptimize.example" } });
    const t = await setup(d, { devops: dv, toml: `${ON}\n[plan]\ndevops_on_done = "never"\n` });
    const a = await t.add({ kind: "item", itemId: 500, title: "Import mapping", itemType: "User Story" });
    t.at("12:10");
    await t.rhythm.tick(ANA, await t.facts());
    const card = await t.tap(`checkin:${MON}`, "done", { pickId: a.id });
    expect((await t.plan.getPick(a.id))?.status).toBe("done");
    expect(card).not.toContain("Set #500");
expect(t.logs.map((l) => JSON.stringify(l)).join()).not.toContain("Import mapping");
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
  it("SR-1: the status report nudge goes Friday from its time, once, with the features that have no update yet", async () => {
    let load = aStatusLoad({ clientName: "Fabrikam", updates: [0, 1, 0] });
    const t = await setup(d, { toml: "\n[notify]\nteams_messages = true\nteams_status = true\n", status: () => load });
    t.atOn("2026-11-06", "14:59");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(0);
    expect(t.runs).not.toContain("status.load");
    t.atOn("2026-11-06", "15:00");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(1);
    const card = t.cardsSent()[0]!;
    expect(card).toContain("FocusTime · Status report · for Monday, Nov 9");
    expect(card).toContain("2 features have no update yet for Monday's report");
    expect(card).toContain("Fabrikam");
    expect(card).toContain(load.clients[0]!.features[0]!.title);
    expect(card).not.toContain(load.clients[0]!.features[1]!.title);
    expect(card).toContain("#/week/status");
    t.atOn("2026-11-06", "16:00");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(1);
    // Every feature has an update by Sunday: no Sunday nudge, even with it on.
    load = aStatusLoad({ updates: [1, 2] });
    t.setToml("\n[notify]\nteams_messages = true\nteams_status = true\nstatus_sunday = true\n");
    t.atOn("2026-11-08", "19:30");
    await t.rhythm.tick(ANA, await t.facts({ inHours: false }));
    expect(t.sent).toHaveLength(1);
    expect(JSON.stringify(t.logs)).not.toContain("Feature ");
  });

  it("SR-3: the nudge counts the features I worked on first, marks them, and opens Status on Needs your update", async () => {
    const load = aStatusLoad({ clientName: "Fabrikam", updates: [0, 0, 1], needs: [true, false, false] });
    const t = await setup(d, { toml: "\n[notify]\nteams_messages = true\nteams_status = true\n", status: () => load });
    t.atOn("2026-11-06", "15:00");
    await t.rhythm.tick(ANA, await t.facts());
    const card = t.cardsSent()[0]!;
    expect(card).toContain("1 feature you worked on needs an update for Monday · 1 more has no update yet");
    expect(card).toContain(`${load.clients[0]!.features[0]!.title}](`);
    expect(card).toContain("you worked on this");
    expect(card).toContain("Open Needs your update");
    expect(card).toContain("#/week/status/needs");
  });

  it("SR-1: no status nudge with its switch off, on PTO, after my day ends, or on Sunday unless asked", async () => {
    const load = aStatusLoad({ updates: [0, 0] });
    const off = await setup(d, { toml: "\n[notify]\nteams_messages = true\nteams_nudges = true\n", status: () => load });
    off.atOn("2026-11-06", "15:30");
    await off.rhythm.tick(ANA, await off.facts());
    expect(off.cardsSent().join()).not.toContain("Status report");
    expect(off.runs).not.toContain("status.load");
    const t = await setup(d, { toml: "\n[notify]\nteams_messages = true\nteams_status = true\n", status: () => load });
    t.atOn("2026-11-06", "15:30");
    await t.rhythm.tick(ANA, await t.facts({ pto: true }));
    t.atOn("2026-11-06", "18:30");
    await t.rhythm.tick(ANA, await t.facts({ inHours: false }));
    t.atOn("2026-11-08", "19:30");
    await t.rhythm.tick(ANA, await t.facts({ inHours: false }));
    expect(t.sent).toHaveLength(0);
    // Sunday evening when turned on, outside working hours.
    t.setToml("\n[notify]\nteams_messages = true\nteams_status = true\nstatus_sunday = true\n");
    await t.rhythm.tick(ANA, await t.facts({ inHours: false }));
    expect(t.cardsSent()[0]).toContain("2 features have no update yet");
  });

  // MC-1: client calls to review, its own switch (off by default), once per occurrence, never during focus or quiet hours.
  it("sends a client call to review once, only with its switch on, never during focus or outside hours", async () => {
    const nudge = (id: number, kind: "review" | "upload") => ({ key: `meeting_${kind}:${id}`, kind, occurrenceId: id, seriesId: 1, clientKey: "Adatum", meeting: "Adatum weekly status call", date: MON, clientName: "Adatum", dateLabel: "Mon, Nov 2" });
    let nudges = [nudge(7, "review")];
    const t = await setup(d, { toml: "\n[notify]\nteams_messages = true\n", meetings: () => ({ meetings: [], occurrences: [], nudges }) });
    t.at("11:00");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(0);
    expect(t.runs).not.toContain("meeting.mine");
    t.setToml("\n[notify]\nteams_messages = true\nteams_meetings = true\n");
    await t.rhythm.tick(ANA, await t.facts({ focusRunning: true }));
    await t.rhythm.tick(ANA, await t.facts({ inHours: false }));
    expect(t.sent).toHaveLength(0);
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.cardsSent()).toHaveLength(1);
    expect(t.cardsSent()[0]).toContain("FocusTime · Client calls");
    expect(t.cardsSent()[0]).toContain("Update Adatum's plan");
    expect(t.cardsSent()[0]).toContain(`${URL_}/#/meetings/7`);
    // The same occurrence again, 20 minutes on: nothing new. Its upload nudge for another occurrence: one more card.
    t.at("11:20");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.sent).toHaveLength(1);
    nudges = [nudge(7, "review"), nudge(8, "upload")];
    t.at("11:40");
    await t.rhythm.tick(ANA, await t.facts());
    expect(t.cardsSent()).toHaveLength(2);
    expect(t.cardsSent()[1]).toContain("Upload Adatum's transcript");
    expect(t.cardsSent()[1]).not.toContain("Update Adatum's plan");
    expect(JSON.stringify(t.logs)).not.toContain("Adatum weekly");
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
