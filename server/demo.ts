// Demo mode (step 15, D272): a whole action context built from fictional data, with its own plan store in memory and
// its config held in memory. It is given no network, keyring, link launcher or export, and dispatch refuses secrets,
// connecting accounts, sign-in and export while it is on, so nothing real is read or written. DM-1: its writes are
// simulated end to end: the app's own DevOps and Graph writers are handed the session's in-memory DevOps and calendar
// (sources/demo/devops.ts, outlook.ts), so preview, confirm, read back, the audit log and undo are the real ones and
// nothing leaves FocusTime. Its AI is the app's real provider on this fictional data when the app has one, with stored
// sample answers when it hasn't or is slow (sources/demo/ai.ts). Its starting data comes from sources/demo/seeds/.
import { parseConfig } from "../config/schema.ts";
import type { ActionContext } from "../actions/dispatch.ts";
import { dispatch } from "../actions/dispatch.ts";
import type { ProcessOverrides } from "../plan/process.ts";
import { createDemoSources } from "../sources/demo/sources.ts";
import { DEFAULT_AI } from "./appconfig.ts";
import { demoAi } from "../sources/demo/ai.ts";
import { createDemoDevOps, type DemoDevOps } from "../sources/demo/devops.ts";
import { createDemoOutlook, type DemoOutlook } from "../sources/demo/outlook.ts";
import { DEMO_SEEDS, type DemoSeedEnv } from "../sources/demo/seeds/index.ts";
import { demoDevOpsPeople, demoItems, demoPto } from "../sources/demo/data.ts";
import { createConversationStore } from "../store/conversation-store.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { AiRuntime } from "../actions/ai-actions.ts";
import { DEMO_CLIENTS, DEMO_CONFIG, DEMO_TZ } from "../sources/demo/data.ts";
import { createPlanStore, openPlanDb, type PlanStore } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { mondayOf } from "../week/dates.ts";
import { createDemoAzure, DEMO_PERSON, DEMO_VM_ID } from "../sources/demo/azure.ts";
import { createDemoFeedbackDevOps, type DemoFeedbackParent } from "../sources/demo/feedback.ts";
import { createFeedbackService } from "../actions/feedback-actions.ts";
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

/** `reset` (DM-1): Reset demo, where the host can rebuild this session's demo (absent: not offered). */
export type DemoControl = { on: boolean; set: (on: boolean) => Promise<void>; reset?: () => Promise<void> };

/** DM-1: what the app's real AI lends the demo: its provider, settings and spend, and whether a real call may run now (the team's switch on, the app's cap not reached). */
export type DemoRealAi = { runtime: AiRuntime; allowed: () => Promise<boolean> };

/** DM-1: a demo session's parts the tests, Reset and the preflight look at (never part of the action context). */
export type DemoSession = { ctx: ActionContext; devops: DemoDevOps; outlook: DemoOutlook; ai: ReturnType<typeof demoAi> };
const sessions = new WeakMap<ActionContext, DemoSession>();
/** The demo session a context belongs to (null for any other context). */
export const demoSessionOf = (ctx: ActionContext): DemoSession | null => sessions.get(ctx) ?? null;

export function createDemoContext(opts: { now: () => string; demo: DemoControl; /** A2 tests: a store on a shared database. */ plan?: PlanStore; /** F1 checks: the pretend feature's state. */ feedbackParent?: DemoFeedbackParent; /** DM-1: the app's real AI, for real answers on the demo's fictional data. */ realAi?: DemoRealAi | null }): ActionContext {
  let text = followTeamColors(DEMO_CONFIG);
  // The demo team's process Rules (Admin › Clients in the demo) apply to the demo's process models.
  let rulesOf: (k: string) => Promise<ProcessOverrides> = async () => ({});
  // AH-2: the demo team's DevOps scope per client, through the same helper as the hosted app's.
  let scopeOf: (k: string) => Promise<ScopeDeps | null> = async () => null;
  // DM-1: the session's own DevOps and calendar: the reads come from them and the writes go to them.
  const devops = createDemoDevOps({ items: demoItems(), people: demoDevOpsPeople(), now: opts.now });
  const outlook = createDemoOutlook({ now: opts.now });
  const sources = createDemoSources(devops, outlook, opts.now, (k) => rulesOf(k), (k) => scopeOf(k));
  const plan = opts.plan ?? createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(opts.now()).toZonedDateTimeISO(DEMO_TZ) });
  // Shared polling: the demo's own client chats and Requests, in memory beside its plan (never the real shared store).
  // The demo reads no messages, so Refresh has nothing to do.
  const instant = () => Temporal.Instant.from(opts.now());
  const shared = sqliteConn(openPlanDb({ path: ":memory:", now: () => instant().toZonedDateTimeISO(DEMO_TZ) }));
  const teams = createTeamsStore(shared, instant);
  // DM-1: the demo's conversations, commitments and suggestions, beside its chats (the seeds write them).
  const conversations = createConversationStore(shared, instant, teams);
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
  // demo's teammates count as signed in, except Taylor Kim, who shows as not on FocusTime yet.
  const team = teamStore(shared, instant);
  const notYet = DEMO_PEOPLE[3]!.aadId.toLowerCase();
  // The demo's clients start on team colors (the ones the demo always had), so a person's own color shows as theirs.
  const ready = (async () => {
    await adminStore.replaceDirectory(dir.people, dir.leads, dir.clients, dir.accounts, dir.identities);
    for (const c of DEMO_CLIENTS) await adminStore.setOrg({ scope: clientScope(c.key), key: "color", value: c.color, actor: FOCUSTIME, area: "clients", target: c.key, note: "demo" });
    // AH-1: an admin took Alex off Harbor's leads, so Ahead shows a teammate's feature there that only Harbor's leads
    // and its owner can change (the read-only note).
    await adminStore.setOverride({ personId: DEMO_PERSON.oid, personName: DEMO_PERSON.name, kind: "lead_remove", clientKey: "Harbor", actor: FOCUSTIME });
    // DM-1: AI is on in the demo for its clients, with a person cap of 1 USD (the session's real calls stop a little
    // under it, sources/demo/ai.ts). The app's own cap and the team's real switch decide whether a real call is made.
    await adminStore.setOrg({ scope: "org", key: "ai.on", value: true, actor: FOCUSTIME, area: "ai", target: "ai.on", note: "demo" });
    await adminStore.setOrg({ scope: "org", key: "ai.person_cap_usd", value: 1, actor: FOCUSTIME, area: "ai", target: "ai.person_cap_usd", note: "demo" });
    for (const c of DEMO_CLIENTS) await adminStore.setOrg({ scope: clientScope(c.key), key: "allow_ai", value: true, actor: FOCUSTIME, area: "ai", target: c.key, note: "demo" });
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
    aiSetUp: async () => ({ provider: real ? "openai" : "stub", keyConfigured: true }),
    appSpentMicros: async () => 0,
    status: async () => ({
      environment: "demo",
      version: { env: "demo", sha: "demo", pr: "", builtAt: null },
      ai: { provider: real ? "openai" : "stub", keyConfigured: true },
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
        out[k] = { counts: deps ? scopeCounts(demoScopeItems(devops, k), { areas: demoAreas(k), isCooptimizer: deps.isCooptimizer }) : null, areasProblem: null, teamsProblem: null, readAt: demoAreas(k).readAt };
      }
      return out;
    },
    // AH-3: the demo projects' assignees (Harbor has two client logins: Priya's linked, Sam's suggested).
    assignees: async (keys) => Object.fromEntries(keys.filter(isDemoClient).map((k) => [k, demoAssignees(devops, k)])),
  };
  const applied = async (t: string) => {
    const parsed = parseConfig(t);
    if (!parsed.ok) return parsed;
    await ready;
    return { ...parsed, config: await org.apply(parsed.config, DEMO_PERSON.oid) };
  };
  // Step 15.4: a fictional signed-in person and VM, simulated (no Azure calls).
  const demoAzure = createDemoAzure();
  // DM-1: the demo's AI. The app's spend gets what real calls cost (its cap counts them); the service reads the app's
  // spend as nothing, so its own cap check never blocks the samples: the demo provider stops real calls itself at the
  // app's cap, the team's switch and the session's cap.
  const real = opts.realAi ?? null;
  const realApp = real?.runtime.app ?? null;
  const ai = demoAi({
    real: real && realApp && realApp.provider === "openai"
      ? { provider: () => real.runtime.provider(), prices: realApp.prices, allowed: () => real.allowed() }
      : null,
  });
  const aiRuntime: AiRuntime = {
    app: { ...(realApp ?? DEFAULT_AI), provider: "stub", model: realApp?.model ?? "demo" },
    provider: async () => ai.provider,
    appSpend: { get: async () => 0, add: async (month, m) => (real ? real.runtime.appSpend.add(month, m) : undefined) },
  };
  // F1: Send feedback against a pretend backlog in memory (nothing leaves FocusTime).
  const feedback = createFeedbackService({ devops: createDemoFeedbackDevOps({ parent: opts.feedbackParent ?? "ok" }), mode: "live", env: "demo", local: false, demo: true, now: () => Date.parse(opts.now()), log: () => {}, sleep: async () => {} });
  const ctx: ActionContext = {
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
    requests: { teams, conversations, users: async () => [{ id: DEMO_PERSON.oid, name: DEMO_PERSON.name, deleted: false }, ...DEMO_PEOPLE.map((p) => ({ id: p.aadId, name: p.name, deleted: false }))], refresh: async () => ({ polled: 0, messages: 0, updated: 0, candidates: 0, promises: 0, failures: 0 }) },
    // DM-1: the app's own DevOps writer on the session's in-memory DevOps, with a demo write identity per client (set
    // by seedDemo): never a real PAT, and the demo's fetch answers only the demo's fictional orgs.
    devopsWriter: createDevOpsWriter({ fetch: devops.fetch, log: () => {} }),
    writePats: { get: async () => new Pat("demo"), set: async () => { throw new Error("The demo has no PATs"); }, clear: async () => { throw new Error("The demo has no PATs"); } },
    // D522, ADM-1: the demo's person is an admin of the demo only (its own store), so the demo shows the admin console.
    org,
    adminOps,
    demo: opts.demo,
    // DM-1: every AI feature runs in the demo: the app's real provider on this fictional data, else the stored samples.
    ai: aiRuntime,
    account: () => demoAzure.account,
    azure: demoAzure.azure,
    feedback: { service: feedback, sender: async () => ({ name: DEMO_PERSON.name, email: DEMO_PERSON.email }) },
    // P1: the demo's notifications stay in the page: a test lands in ⋯ › Notifications (no desktop, no push).
    notifications: {
      test: async () => void (await plan.addNotice({ key: `test:${opts.now()}`, kind: "test", title: "FocusTime", body: "Test notification. It shows here and as a toast.", route: "settings:notifications" })),
      sample: async () => false,
    },
  };
  sessions.set(ctx, { ctx, devops, outlook, ai });
  return ctx;
}

/**
 * A believable week to demo (DM-1: sources/demo/seeds/, one file per feature, run in order). Signed in as the
 * fictional person with the demo VM confirmed and a demo write identity per client, then every seed through the app's
 * own actions where one exists, so every rule applies. Seeds use the stored AI samples only (never a real call), so
 * every run starts the same. Today's day is left unplanned, so the walkthrough can plan it.
 */
export async function seedDemo(ctx: ActionContext): Promise<void> {
  const zone = DEMO_TZ;
  const today = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(zone).toPlainDate();
  const weekStart = mondayOf(today.toString());
  const run = async (action: string, input: Record<string, unknown>) => {
    const r = await dispatch(ctx, { action, input });
    if (!r.ok) throw new Error(`demo seed ${action}: ${r.error}`);
    return r.data as Record<string, unknown>;
  };
  await run("auth.status", {});
  await run("vm.choose", { vmId: DEMO_VM_ID });
  if (ctx.plan) for (const c of DEMO_CLIENTS) await ctx.plan.setDevopsIdentity({ clientKey: c.key, org: c.org, id: `demo-devops-${c.key.toLowerCase()}`, name: DEMO_PERSON.name, email: DEMO_PERSON.email, expires: null });
  const teams = ctx.requests?.teams;
  const conversations = ctx.requests?.conversations;
  const team = ctx.team;
  if (!teams || !conversations || !team) throw new Error("demo seed: the demo's shared stores aren't there");
  const env: DemoSeedEnv = {
    ctx, run, zone, today: today.toString(), weekStart,
    day: (n) => today.add({ days: n }).toString(),
    weekDay: (n) => Temporal.PlainDate.from(weekStart).add({ days: n }).toString(),
    lastWorkday: lastWorkday(today),
    ago: (m) => Temporal.Instant.from(ctx.now()).subtract({ minutes: m }).toString(),
    me: { id: DEMO_PERSON.oid, name: DEMO_PERSON.name, email: DEMO_PERSON.email },
    teams, conversations, team,
  };
  const session = demoSessionOf(ctx);
  session?.ai.hold(true);
  try {
    for (const s of DEMO_SEEDS) await s.seed(env).catch((e: unknown) => {
      throw new Error(`demo seed ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    });
  } finally {
    session?.ai.hold(false);
  }
}

/** The last day before `today` with the demo's working hours (Monday to Thursday) that isn't PTO. */
function lastWorkday(today: Temporal.PlainDate): string {
  for (let d = today.subtract({ days: 1 }); ; d = d.subtract({ days: 1 })) if (d.dayOfWeek <= 4 && !demoPto(d.toString(), d.toString()).length) return d.toString();
}

