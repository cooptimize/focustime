// Demo mode (step 15, D272): a whole action context built from fictional data, with its own plan store in memory and
// its config held in memory. It is given no fetch, keyring, writer, link launcher or export, and dispatch refuses
// every outward action while it is on, so nothing leaves FocusTime and nothing real is read or written.
import { parseConfig } from "../config/schema.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { dispatch } from "../actions/dispatch.ts";
import type { ProcessOverrides } from "../plan/process.ts";
import { createDemoSources } from "../sources/demo/sources.ts";
import { demoAssistantProvider } from "../sources/demo/assistant.ts";
import { DEFAULT_AI } from "./appconfig.ts";
import { DEMO_CLIENTS, DEMO_CONFIG, DEMO_TZ } from "../sources/demo/data.ts";
import { createPlanStore, openPlanDb, type PlanStore } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { mondayOf } from "../week/dates.ts";
import { createDemoAzure, DEMO_PERSON, DEMO_VM_ID } from "../sources/demo/azure.ts";
import { createDemoFeedbackDevOps, demoFeedbackBackend, type DemoFeedbackParent } from "../sources/demo/feedback.ts";
import { notices } from "../plan/notify.ts";
import { createAdminStore, FOCUSTIME } from "../store/admin-store.ts";
import { clientScope } from "../config/org.ts";
import { settingsEdit } from "../config/settings.ts";
import { createStatusRegistry } from "../actions/status-rows.ts";
import { devopsStatusSource } from "../actions/devops-poll.ts";
import { createOrgRuntime } from "../actions/org.ts";
import { teamStore } from "../store/team-store.ts";
import { DEMO_PEOPLE } from "../sources/demo/data.ts";
import { demoAdminCheck } from "../actions/admin.ts";
import type { AdminOps, ClientScopeFacts } from "../actions/admin-actions.ts";
import { demoDirectory } from "../sources/demo/directory.ts";
import { scopeDepsOf } from "../actions/scope-deps.ts";
import { scopeCounts } from "../plan/devops-scope.ts";
import { demoAreas, demoAssignees, demoScopeItems, isDemoClient } from "../sources/demo/data.ts";
import type { ScopeDeps } from "../sources/devops/source.ts";

/** The demo's settings with its clients' colors left to the team (they are the demo's team colors). */
function followTeamColors(t: string): string {
  const parsed = parseConfig(t);
  if (!parsed.ok) return t;
  for (const [key, v] of Object.entries(parsed.config.clientSettings)) if (v.color && DEMO_CLIENTS.some((c) => c.key === key)) t = settingsEdit("client", { key, color: "", name: v.name, follow: v.follow })(t);
  return t;
}

export type DemoControl = { on: boolean; set: (on: boolean) => Promise<void> };

export function createDemoContext(opts: { now: () => string; demo: DemoControl; /** A2 tests: a store on a shared database. */ plan?: PlanStore; /** F1 checks: the pretend feature's state. */ feedbackParent?: DemoFeedbackParent }): ActionContext {
  let text = followTeamColors(DEMO_CONFIG);
  // The demo team's process Rules (Admin › Clients in the demo) apply to the demo's process models.
  let rulesOf: (k: string) => Promise<ProcessOverrides> = async () => ({});
  // AH-2: the demo team's DevOps scope per client, through the same helper as the hosted app's.
  let scopeOf: (k: string) => Promise<ScopeDeps | null> = async () => null;
  const sources = createDemoSources(opts.now, (k) => rulesOf(k), (k) => scopeOf(k));
  const plan = opts.plan ?? createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(opts.now()).toZonedDateTimeISO(DEMO_TZ) });
  // Shared polling: the demo's own client chats and Requests, in memory beside its plan (never the real shared store).
  // The demo reads no messages, so Refresh has nothing to do.
  const instant = () => Temporal.Instant.from(opts.now());
  const shared = sqliteConn(openPlanDb({ path: ":memory:", now: () => instant().toZonedDateTimeISO(DEMO_TZ) }));
  const teams = createTeamsStore(shared, instant);
  // ADM-1: the demo's own team settings, people and audit, on the same in-memory database (never the real ones). The
  // demo's person is an admin inside their own demo and nowhere else.
  const adminStore = createAdminStore(shared, instant);
  // The demo's person is signed in, so the one person match (D599) finds them the way it does in the hosted app.
  const org = createOrgRuntime({ store: adminStore, bootstrap: { model: "stub", appCapUsd: 100, inviteDomains: ["example.com"], feedback: null }, now: () => Date.parse(opts.now()), signedIn: async () => [{ id: DEMO_PERSON.oid, email: DEMO_PERSON.email, upn: DEMO_PERSON.username }] });
  scopeOf = scopeDepsOf(org);
  rulesOf = async (k) => {
    const c = (await org.rules()).clients[k];
    return c ? { noBreakdown: c.noBreakdown, background: c.background } : {};
  };
  const dir = demoDirectory();
  // SW-1: the demo's sends, commitments, priorities and asks, on the same in-memory database (never the real ones). The
  // demo's teammates count as signed in, except Alex Kim, who shows as not on FocusTime yet.
  const team = teamStore(shared, instant);
  const notYet = DEMO_PEOPLE[3]!.aadId.toLowerCase();
  // The demo's clients start on team colors (the ones the demo always had), so a person's own color shows as theirs.
  const ready = (async () => {
    await adminStore.replaceDirectory(dir.people, dir.leads, dir.clients, dir.accounts, dir.identities);
    for (const c of DEMO_CLIENTS) await adminStore.setOrg({ scope: clientScope(c.key), key: "color", value: c.color, actor: FOCUSTIME, area: "clients", target: c.key, note: "demo" });
    // AH-1: an admin took Alex off Harbor's leads, so Ahead shows a teammate's feature there that only Harbor's leads
    // and its owner can change (the read-only note).
    await adminStore.setOverride({ personId: DEMO_PERSON.oid, personName: DEMO_PERSON.name, kind: "lead_remove", clientKey: "Harbor", actor: FOCUSTIME });
  })();
  // DV-1: Admin › Status's DevOps rows, pretend (the demo reads no DevOps): one fine, one with a bad token, one slowed.
  const checked = new Map<string, string>();
  const demoPoll = {
    status: async () =>
      DEMO_CLIENTS.map((c, i) => {
        const at = checked.get(c.key) ?? Temporal.Instant.from(opts.now()).subtract({ seconds: 20 + i * 15 }).toString();
        return { clientKey: c.key, checkedAt: at, okAt: c.key === "Harbor" ? Temporal.Instant.from(at).subtract({ hours: 3 }).toString() : at, changedToday: [2, 7, 0, 4][i]!, callsToday: [214, 236, 9, 131][i]!, minutes: c.key === "Harbor" ? 30 : c.key === "Atlas" ? 4 : 1, slowed: c.key === "Atlas" ? "Close to the DevOps usage limit" : null, error: c.key === "Harbor" ? "Token not valid" : null, rate: c.key === "Atlas" ? { limit: 200, remaining: 31, cost: 0.42, at } : null };
      }),
    checkNow: async (k: string) => void checked.set(k, opts.now()),
  };
  const statusRows = createStatusRegistry();
  statusRows.register(devopsStatusSource(demoPoll));
  const adminOps: AdminOps = {
    statusRows,
    check: demoAdminCheck(DEMO_PERSON.oid),
    org,
    groupId: null,
    breakGlass: [],
    tenantId: null,
    people: async () => [{ id: DEMO_PERSON.oid, name: DEMO_PERSON.name, email: DEMO_PERSON.email, lastSignInAt: opts.now(), setup: "done", sources: { microsoft: true, google: true, devopsWrites: 1 } }],
    chatClients: async () => [...new Set([...(await teams.chats()).map((c) => c.clientKey), ...dir.clients.map((c) => c.clientKey)])].sort(),
    aiSetUp: async () => ({ provider: "stub", keyConfigured: true }),
    appSpentMicros: async () => 0,
    status: async () => ({
      environment: "demo",
      version: { env: "demo", sha: "demo", pr: "", builtAt: null },
      ai: { provider: "stub", keyConfigured: true },
      feedback: { ok: true, message: "A pretend backlog in the demo" },
      dataverse: { refreshedAt: await adminStore.directoryRefreshedAt(), ok: true, message: null },
      chats: (await teams.chats()).map((c) => ({ chatId: c.chatId, clientKey: c.clientKey, name: c.displayName, reading: c.readOn, polledAt: c.polledAt, state: c.pollState, note: c.pollNote, via: null })),
      lastPoll: null,
      conversations: null,
    }),
    refreshPeople: async () => {
      await adminStore.replaceDirectory(dir.people, dir.leads, dir.clients, dir.accounts, dir.identities);
      org.invalidate();
      return { ok: true, message: null, people: dir.people.length };
    },
    removePerson: async () => {
      throw new Error("The demo's people are pretend, so there is nobody to remove");
    },
    // AH-2: the demo projects' areas and teams with counts, from the demo's own items (the same rules).
    scope: async (keys) => {
      const out: Record<string, ClientScopeFacts> = {};
      for (const k of keys.filter(isDemoClient)) {
        const deps = await scopeOf(k);
        out[k] = { counts: deps ? scopeCounts(demoScopeItems(k), { areas: demoAreas(k), isCooptimizer: deps.isCooptimizer }) : null, areasProblem: null, teamsProblem: null, readAt: demoAreas(k).readAt };
      }
      return out;
    },
    // AH-3: the demo projects' assignees (Harbor has two client logins: Priya's linked, Sam's suggested).
    assignees: async (keys) => Object.fromEntries(keys.filter(isDemoClient).map((k) => [k, demoAssignees(k)])),
  };
  const applied = async (t: string) => {
    const parsed = parseConfig(t);
    if (!parsed.ok) return parsed;
    await ready;
    return { ...parsed, config: await org.apply(parsed.config, DEMO_PERSON.oid) };
  };
  // Step 15.4: a fictional signed-in person and VM, simulated (no Azure calls).
  const demoAzure = createDemoAzure();
  const assistant = demoAssistantProvider();
  // F1: Send feedback against a pretend backlog in memory (nothing leaves FocusTime).
  const feedback = demoFeedbackBackend(createDemoFeedbackDevOps({ parent: opts.feedbackParent ?? "ok" }));
  return {
    loadConfig: async () => ({ path: "Demo data (in memory, not your config file)", parsed: await applied(text) }),
    // Theme or view changes in demo mode stay in memory: the real config file is never touched.
    writeConfig: async (edit) => {
      const next = edit(text);
      const parsed = parseConfig(next);
      if (!parsed.ok) return { ok: false, parsed };
      text = next;
      const withTeam = await applied(next);
      return { ok: true, parsed: withTeam.ok ? withTeam : parsed, backup: "" };
    },
    makeDataverse: () => sources.dataverse,
    makeOutlook: () => sources.outlook,
    makeGoogle: () => sources.google,
    makeDevOps: () => sources.devops,
    saveSystemUserId: async () => {},
    now: opts.now,
    plan,
    team,
    onFocusTime: (id) => id.toLowerCase() !== notYet,
    requests: { teams, refresh: async () => ({ polled: 0, messages: 0, updated: 0, candidates: 0, promises: 0, failures: 0 }) },
    // D522, ADM-1: the demo's person is an admin of the demo only (its own store), so the demo shows the admin console.
    org,
    adminOps,
    demo: opts.demo,
    // AS-1: the demo's assistant (a scripted provider, nothing leaves FocusTime), on for the demo's clients; the
    // demo's other AI features stay off.
    assistantAi: { runtime: { app: { ...DEFAULT_AI, provider: "stub", model: "demo" }, provider: async () => assistant, appSpend: { get: async () => 0, add: async () => {} } }, rules: { on: true, allowedClients: DEMO_CLIENTS.map((c) => c.key), personCapUsd: 10 } },
    account: () => demoAzure.account,
    azure: demoAzure.azure,
    feedback: { demo: feedback, sender: async () => ({ name: DEMO_PERSON.name, email: DEMO_PERSON.email }) },
    // P1: the demo's notifications stay in the page: a test lands in ⋯ › Notifications (no desktop, no push).
    notifications: {
      test: async () => void (await plan.addNotice({ key: `test:${opts.now()}`, kind: "test", title: "FocusTime", body: "Test notification. It shows here and as a toast.", route: "settings:notifications" })),
      sample: async () => false,
    },
  };
}

/**
 * A believable week to demo: the week plan per client (musts, nice to haves, a pin), follow-ups (one overdue, one due
 * today), a resume note and a capture to sort. Seeded through the app's own actions, so every rule applies. Today's
 * day is left unplanned, so the walkthrough can plan it.
 */
export async function seedDemo(ctx: ActionContext): Promise<void> {
  const tz = DEMO_TZ;
  const today = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz).toPlainDate();
  const weekStart = mondayOf(today.toString());
  const day = (n: number) => today.add({ days: n }).toString();
  const run = async (action: string, input: Record<string, unknown>) => {
    const r = await dispatch(ctx, { action, input });
    if (!r.ok) throw new Error(`demo seed ${action}: ${r.error}`);
    return r.data as Record<string, unknown>;
  };
  // Signed in as the fictional person, with the demo VM confirmed as theirs.
  await run("auth.status", {});
  await run("vm.choose", { vmId: DEMO_VM_ID });
  await run("week.load", { weekStart });
  await run("weekplan.load", { weekStart });
  // E2: a feature's load comes from its stories on the list once one is sized (Harbor's S and S: 2h; Northwind 1110's
  // L and an unsized one: 4h + 2h), else its estimate in hours (Northwind 1120: 4h, none set); stories S, M, L or not
  // sized yet. Northwind needs about 2h more than its free time (the amber line); the others fit.
  const list: [string, number, "must" | "nice", { hours?: number; size?: "S" | "M" | "L" }][] = [
    ["Cooptimize", 4410, "must", { hours: 4 }],
    ["Cooptimize", 4411, "must", { size: "S" }],
    ["Cooptimize", 4412, "must", { size: "S" }],
    ["Northwind", 1110, "must", { hours: 8 }],
    ["Northwind", 1111, "must", { size: "L" }],
    ["Northwind", 1112, "must", {}],
    ["Northwind", 1120, "must", {}],
    ["Northwind", 1130, "nice", { size: "M" }],
    ["Harbor", 2210, "must", { hours: 4 }],
    ["Harbor", 2211, "must", { size: "S" }],
    ["Harbor", 2212, "must", { size: "S" }],
    ["Atlas", 3311, "must", { size: "S" }],
    ["Atlas", 3330, "nice", { size: "S" }],
  ];
  for (const [clientKey, itemId, tier, est] of list) await run("weekplan.add", { weekStart, clientKey, itemId, tier, ...est });
  await run("weekplan.place", { weekStart, clientKey: "Cooptimize", itemId: 4410, date: weekStart, half: "AM", on: true });
  await run("weekplan.commit", { weekStart });
  await seedTeam(ctx, weekStart);
  await run("followup.add", { clientKey: "Cooptimize", who: "Jordan Lee", what: "Reply about the proposal timeline", channel: "teams", due: day(-1) });
  await run("followup.add", { clientKey: "Northwind", who: "Dana Morales", what: "Send the export spec for review", channel: "email", due: day(0) });
  await run("followup.add", { clientKey: "Harbor", who: "Chris Park", what: "Confirm the intake form go-live date", channel: "teams", due: day(1) });
  await run("followup.add", { clientKey: "Atlas", who: "Morgan Diaz", what: "Share the delay alert mockups", channel: "email", due: day(3) });
  await run("note.set", { clientKey: "Northwind", date: day(0), note: "CSV export works for orders. Next: the date filter." });
  await run("capture.add", { text: "Ask Harbor about single sign-on for the intake form", clientKey: "Harbor" });
  // UI-B: unfinished picks on this week's earlier days (none on a Monday), so the Board shows them suggested in each
  // client's next block, and Cooptimize's (no block left this week) in Unfinished from earlier days.
  if (ctx.plan) {
    const left: [number, "AM" | "PM", string, number, string, "S" | "M" | "L" | null][] = [
      [0, "AM", "Cooptimize", 4411, "Timesheet summary query", "S"],
      [0, "PM", "Northwind", 1112, "Filter orders by date range", "M"],
      [1, "AM", "Harbor", 2212, "Validate date of birth", "S"],
      [1, "PM", "Atlas", 3311, "Map of active shipments", null],
    ];
    for (const [n, half, clientKey, itemId, title, size] of left) {
      const date = Temporal.PlainDate.from(weekStart).add({ days: n }).toString();
      if (date >= today.toString()) continue;
      await ctx.plan.start(date);
      await ctx.plan.addPick({ date, half, clientKey, kind: "item", itemId, title, itemType: "User Story", size });
      await ctx.plan.commit(date);
    }
  }
  // AH-1: three changes pending in Ahead (nothing is ever written in the demo): a start date, an owner, and a target
  // date that changed in DevOps since editing began (the fictional earlier value), so the review shows a conflict.
  if (ctx.plan) {
    await ctx.plan.stageAheadChange({ clientKey: "Northwind", itemId: 1150, field: "start", value: "2026-11-16", half: "PM", baseRev: 1, baseValue: null });
    await ctx.plan.stageAheadChange({ clientKey: "Northwind", itemId: 1113, field: "assignee", value: { email: DEMO_PERSON.email.toLowerCase(), name: DEMO_PERSON.name }, half: null, baseRev: 1, baseValue: { email: "priya.shah@example.com", name: "Priya Shah" } });
    await ctx.plan.stageAheadChange({ clientKey: "Northwind", itemId: 1140, field: "target", value: "2026-12-23", half: "PM", baseRev: 1, baseValue: "2026-12-04" });
  }
  // P1: this morning's notifications in ⋯ › Notifications: the day's plan (read) and the follow-ups due (new).
  if (ctx.plan) {
    const at = Temporal.Instant.from(ctx.now()).toString();
    const planned = notices.planDay(day(0), at);
    const due = notices.followUps(day(0), [{ id: 1, what: "Reply about the proposal timeline", overdue: true }, { id: 2, what: "Send the export spec for review", overdue: false }], at)!;
    const first = await ctx.plan.addNotice({ key: planned.key, kind: planned.kind, title: planned.title, body: planned.body, route: planned.route });
    await ctx.plan.readNotices([first]);
    await ctx.plan.addNotice({ key: due.key, kind: due.kind, title: due.title, body: due.body, route: due.route });
  }
  // Step 16 (Roadmap): three weeks of daily counts for the features I own, so the trend and signal show (today's comes
  // from the first Roadmap read).
  const history: [string, number, [number, number][]][] = [
    ["Northwind", 1110, [[0, 3], [0, 4], [1, 3]]],
    ["Harbor", 2210, [[0, 6], [1, 5], [2, 4]]],
    ["Cooptimize", 4410, [[0, 2], [0, 2], [0, 2]]],
    ["Cooptimize", 4430, [[0, 4], [1, 3], [2, 2]]],
    ["Northwind", 1140, [[0, 2], [0, 2], [0, 2]]],
    ["Northwind", 1150, [[0, 1], [0, 1], [0, 1]]],
    ["Harbor", 2240, [[0, 2], [1, 1], [2, 0]]],
  ];
  // Step 17 (slice 3): the last 2 weeks for Plan ahead's planned against worked: committed week plans and focused time
  // on picks settled as dropped (nothing carries over into today, and no DevOps update follow-up opens).
  const plan = ctx.plan;
  if (plan) {
    const past: [number, [string, number, string, number][], [string, number, string, number, number][]][] = [
      [-14, [["Northwind", 1110, "Order history export", 1]], [["Northwind", 1114, "Order export API endpoint", 1, 220]]],
      [-7, [["Northwind", 1110, "Order history export", 2], ["Harbor", 2210, "Patient intake form", 1], ["Cooptimize", 4410, "Internal reporting refresh", 1], ["Atlas", 3310, "Shipment tracking dashboard", 1], ["Atlas", 3350, "Carrier rate alerts", 1], ["Atlas", 3360, "Carrier contact list", 1]], [["Northwind", 1111, "Export orders to CSV", 1, 200], ["Harbor", 2211, "Insurance card upload", 3, 60]]],
    ];
    for (const [n, features, picks] of past) {
      const ws = Temporal.PlainDate.from(weekStart).add({ days: n }).toString();
      for (const [clientKey, itemId, title, blocks] of features) (await plan.addWeekItem({ weekStart: ws, clientKey, itemId, title, itemType: "Feature", url: null, level: "feature", tier: "must", estimate: blocks * 240 }));
      (await plan.commitWeek(ws));
      for (const [clientKey, itemId, title, dayN, minutes] of picks) {
        const date = Temporal.PlainDate.from(ws).add({ days: dayN }).toString();
        const pick = (await plan.addPick({ date, half: "AM", clientKey, kind: "item", itemId, title, itemType: "User Story", size: "L" }));
        const start = Temporal.ZonedDateTime.from({ timeZone: tz, year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)), hour: 9 });
        (await plan.addFocus({ pickId: pick.id, label: title, startedAt: start.toString(), endedAt: start.add({ minutes }).toString(), seconds: minutes * 60 }));
        (await plan.drop(pick.id));
      }
    }
  }
  for (const [i, n] of [-21, -14, -7].entries()) await ctx.plan?.recordSnapshots(day(n), history.map(([clientKey, itemId, c]) => ({ clientKey, itemId, done: c[i]![0], open: c[i]![1] })));
}

/**
 * SW-1: the demo's team. Priya (a Northwind and Harbor lead) sent Alex a Must and a suggestion; Alex (a Northwind
 * lead) sent Sam a Must he hasn't answered and one he can't take, and Priya one she scheduled. Teammates' committed
 * features for the Team view, a Northwind priority, and an Ask to look with Priya's reply. All fictional.
 */
async function seedTeam(ctx: ActionContext, weekStart: string): Promise<void> {
  const team = ctx.team;
  if (!team) return;
  const [jordan, priya, sam] = DEMO_PEOPLE;
  const p = (x: { aadId: string; name: string }) => ({ id: x.aadId.toLowerCase(), name: x.name });
  const me = { id: DEMO_PERSON.oid, name: DEMO_PERSON.name };
  const url = (org: string, id: number) => `https://dev.azure.com/${org}/_workitems/edit/${id}`;
  const item = (clientKey: string, org: string, itemId: number, title: string, itemType = "Feature") => ({ clientKey, itemId, title, itemType, url: url(org, itemId), level: itemType === "Feature" ? ("feature" as const) : ("story" as const), parentId: null, weekStart });
  await team.addSend({ ...item("Northwind", "northwind-demo", 1140, "Loyalty points"), kind: "must", note: "The client moved this up. Can you start it this week?", askTake: true, from: p(priya!), to: me });
  await team.addSend({ ...item("Harbor", "harbor-demo", 2220, "Appointment reminders"), kind: "suggested", note: "You built the SMS template, so this may be quick for you.", askTake: false, from: p(priya!), to: me });
  await team.addSend({ ...item("Northwind", "northwind-demo", 1150, "Store locator"), kind: "must", note: null, askTake: false, from: me, to: p(sam!) });
  const cant = await team.addSend({ ...item("Northwind", "northwind-demo", 1131, "Invoice PDF totals round wrong", "Bug"), kind: "must", note: "Finance noticed it.", askTake: false, from: me, to: p(sam!) });
  await team.setSend(cant.id, { state: "cant", reason: "Out Thursday and Friday" });
  const ok = await team.addSend({ ...item("Northwind", "northwind-demo", 1130, "Fix login timeout on mobile", "User Story"), kind: "suggested", note: null, askTake: false, from: me, to: p(priya!) });
  await team.setSend(ok.id, { state: "scheduled" });
  const at = ctx.now();
  await team.publish(p(priya!).id, weekStart, [
    { clientKey: "Northwind", itemId: 1110, title: "Order history export", itemType: "Feature", url: url("northwind-demo", 1110), tier: "must", watching: false },
    { clientKey: "Harbor", itemId: 2220, title: "Appointment reminders", itemType: "Feature", url: url("harbor-demo", 2220), tier: "must", watching: false },
    { clientKey: "Harbor", itemId: 2210, title: "Patient intake form", itemType: "Feature", url: url("harbor-demo", 2210), tier: "nice", watching: false },
    { clientKey: "Northwind", itemId: 1140, title: "Loyalty points", itemType: "Feature", url: url("northwind-demo", 1140), tier: "nice", watching: true },
  ], at);
  await team.publish(p(jordan!).id, weekStart, [
    { clientKey: "Atlas", itemId: 3310, title: "Shipment tracking dashboard", itemType: "Feature", url: url("atlas-demo", 3310), tier: "must", watching: false },
    { clientKey: "Atlas", itemId: 3340, title: "Delivery time estimates", itemType: "Feature", url: url("atlas-demo", 3340), tier: "nice", watching: true },
  ], at);
  await team.flag({ clientKey: "Northwind", itemId: 1110, title: "Order history export", itemType: "Feature", url: url("northwind-demo", 1110), note: "The client's top ask for November", flaggedBy: p(priya!) }, at);
  const look = await team.addLook({ clientKey: "Harbor", weekStart, from: me, to: p(priya!), note: "Is the intake form enough for this week?" }, at);
  await team.reply(look.id, "Yes. Leave reminders for next week if it gets tight.", at);
}
