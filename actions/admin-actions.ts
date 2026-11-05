// ADM-1: the admin console's actions. Every one but admin.status starts with the one server-side check (an admin of
// this FocusTime: the FocusTime Admins group or the break-glass list; in the demo, the demo's own person over the
// demo's own store). Admins manage the team's settings and see health; nothing more. Nothing here reads anyone's plan,
// picks, follow-ups, captures, focus sessions, write PATs, AI request content or chat messages: a person's health is
// names, dates and yes or no (AdminOps.people), and the store has no read for anything else. Every change is audited
// (store/admin-store.ts) with who, when, what, old and new value; secrets are never settings.
import type { StatusGroup, StatusRegistry } from "./status-rows.ts";
import { clientScope, CLIENT_SPECS, KIND_NAMES, LEVEL_NAMES, LEVEL_SPECS, LEVELS, ORG_SPECS, OrgInputError, specFor, SUGGESTED_SLOTS, type AdminArea, type Guidance, type Level, type OrgRules } from "../config/org.ts";
import { CLIENT_SLOTS } from "../config/schema.ts";
import { LEAD_WHY_NAMES, type LeadWhy } from "../plan/levels.ts";
import { CLIENT_WHY_TEXT } from "../plan/client-accounts.ts";
import { matchText, NOT_COOPTIMIZER_TEXT } from "../plan/person-match.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";
import type { Actor, AuditEntry, OverrideKind } from "../store/admin-store.ts";
import type { AdminCheck, AdminVia } from "./admin.ts";
import type { OrgRuntime } from "./org.ts";
import { breakdownText, looksOf } from "../plan/process.ts";
import type { ProcessModelResult } from "../sources/devops/source.ts";
import type { ConversationCounts } from "../store/conversation-store.ts";
import type { ActionResponse, ClientProcess } from "./types.ts";
import { scopeWords, type ClientScopeFacts } from "../plan/devops-scope.ts";
export type { ClientScopeFacts };

export const ADMIN_ACTIONS = ["admin.status", "admin.load", "admin.set", "admin.override", "admin.refresh_people", "admin.remove_person", "admin.audit", "admin.status_action"] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];
export const ADMIN_SECTIONS = ["clients", "ai", "conversations", "people", "organization", "status", "audit"] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** A person's health for Admin › People: names, dates and yes or no only. Never plan content or secrets. */
export type PersonHealth = {
  id: string;
  name: string;
  email: string | null;
  lastSignInAt: string | null;
  /** done: every Setup step done; skipped: closed or skipped with steps left; started; not_started. */
  setup: "done" | "skipped" | "started" | "not_started";
  /** Connected or not (never the token), and how many clients have write access (never the PAT). */
  sources: { microsoft: boolean; google: boolean; devopsWrites: number };
};

export type ChatHealth = { chatId: string; clientKey: string; name: string; reading: boolean; polledAt: string | null; state: string | null; note: string | null; via: string | null };
export type AdminStatus = {
  environment: string;
  version: { env: string; sha: string; pr: string; builtAt: string | null };
  ai: { provider: string; keyConfigured: boolean };
  feedback: { ok: boolean; message: string };
  dataverse: { refreshedAt: string | null; ok: boolean; message: string | null };
  chats: ChatHealth[];
  lastPoll: string | null;
  /** CV-1's counts: conversations by status, messages by role, commitments by state, AI calls per chat today. Never text or ids. */
  conversations: ConversationCounts | null;
  /** ADM-2: things to look at (clients filtered out with settings, Rules out of range, people). */
  warnings?: StatusWarning[];
  /** ADM-2: when the scheduler last ran each job, by name ("requests_poll", "people_refresh", "maintenance"). */
  lastRuns?: Record<string, string>;
  /** ADM-2 (D604): the background jobs with their interval or period and last run. */
  jobs?: StatusJob[];
  /** DV-1: the status rows registry's groups (DevOps polling, and whatever registers later). */
  groups?: StatusGroup[];
};

export type StatusJob = { name: string; every: string; lastRun: string | null; note: string | null };

/** ADM-2 (D604): Rules stored out of range (read as their built-in value) and the empty domains Rule. */
export function ruleWarnings(rules: OrgRules): StatusWarning[] {
  const out: StatusWarning[] = rules.problems.map((p) => ({ area: "rules" as const, text: `${p.label}: the stored value isn't allowed any more, so FocusTime uses ${JSON.stringify(p.fallback)}. Set it again in Admin.` }));
  if (!rules.organization.inviteDomains.length) out.push({ area: "people", text: "Set Cooptimize email domains in Admin › Organization. Until then only guest accounts are left out of People and sign-in." });
  return out;
}

/** The jobs Status lists, from the Rules they read (D604). */
export function statusJobs(rules: OrgRules, st: Pick<AdminStatus, "lastPoll" | "dataverse" | "lastRuns">): StatusJob[] {
  const c = rules.conversations;
  const runs = st.lastRuns ?? {};
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [
    { name: "Read client chats", every: `Every ${plural(c.pollMinutes, "minute")} in followers' working hours`, lastRun: st.lastPoll, note: null },
    { name: "Delete messages that aren't requests", every: `After each poll, those older than ${plural(c.retentionDays, "day")}`, lastRun: st.lastPoll, note: null },
    { name: "Closed conversations", every: `Shown for ${plural(c.closedShownDays, "day")} after closing`, lastRun: null, note: "Read when Inbox opens; no job" },
    { name: "People, levels and leads from Dataverse", every: "Once a day", lastRun: st.dataverse.refreshedAt, note: null },
    { name: "Sign-in sweep and removals", every: "Every hour", lastRun: runs.maintenance ?? null, note: null },
    { name: "Delete people's data", every: `After ${plural(rules.organization.retentionYears, "year")}`, lastRun: null, note: "Not enforced yet" },
  ];
}

/** What the server gives the admin console (server/main.ts; the demo's in server/demo.ts, over the demo's store only). */
export type AdminOps = {
  check: AdminCheck;
  org: OrgRuntime;
  /** The "FocusTime Admins" group's id, the break-glass ids and the tenant (for the Entra link). */
  groupId: string | null;
  breakGlass: readonly string[];
  tenantId: string | null;
  people(): Promise<PersonHealth[]>;
  /** Clients FocusTime knows of for this team (registered chats, Dataverse's directory), for Admin › Clients. */
  chatClients(): Promise<string[]>;
  aiSetUp(): Promise<{ provider: string; keyConfigured: boolean }>;
  /** The app's AI spend this month, in millionths of a dollar. */
  appSpentMicros(): Promise<number>;
  /** `day`: the admin's today, for the per-chat AI calls. */
  status(day: string): Promise<AdminStatus>;
  /** DV-1: the status rows registry (Admin › Status renders its groups; a row's action runs through admin.status_action). */
  statusRows?: StatusRegistry;
  refreshPeople(): Promise<{ ok: boolean; message: string | null; people: number }>;
  /** Deletes a person's FocusTime data and personal secrets now, and ends their sessions. */
  removePerson(id: string): Promise<void>;
  /** AH-2: each client's project areas and teams with counts from the central store (absent: DevOps isn't polled here). */
  scope?(clientKeys: string[]): Promise<Record<string, ClientScopeFacts>>;
};

export type AdminContext = {
  ops: AdminOps | null;
  /** The signed-in person (Entra object id and name). */
  me: () => Promise<Actor & { id: string } | null>;
  /** WT-1: the clients' DevOps process models (with their Rules applied); null when DevOps can't be read here. */
  process?: (clientKeys: string[], refresh: boolean) => Promise<ProcessModelResult[] | null>;
  /** The admin's own today (their time zone), for Status's AI calls per chat today. */
  today?: () => Promise<string>;
};


const LEVEL_ORDER = { top: 0, parent: 1, child: 2, task: 3 } as const;
export function processView(r: ProcessModelResult): ClientProcess {
  if (!r.ok) return { ok: false, message: r.message };
  const m = r.model;
  const looks = new Map(looksOf(m).map((l) => [l.name, l]));
  const types = m.types
    .filter((t) => t.level !== null)
    .sort((a, b) => LEVEL_ORDER[a.level!] - LEVEL_ORDER[b.level!] || a.name.localeCompare(b.name))
    .map((t) => ({ ...looks.get(t.name)!, breakdownSource: t.breakdownSource, history: breakdownText(t), bug: t.bug }));
  const bugs = m.bugsBehavior === "asRequirements" ? "Bugs are planned with stories" : m.bugsBehavior === "asTasks" ? "Bugs are planned with tasks" : m.bugsBehavior === "off" ? "Bugs aren't on the backlogs" : null;
  return { ok: true, process: m.process ?? null, project: m.project, bugs, types };
}

const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });
export const NOT_ADMIN = "Only a FocusTime admin can do this";
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const only = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).find((k) => !keys.includes(k));

const json = (v: string | null): unknown => {
  if (v === null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/** The Entra page where the group's members are managed (FocusTime never adds anyone itself). */
export const groupLink = (groupId: string | null) => (groupId ? `https://entra.microsoft.com/#view/Microsoft_AAD_IAM/GroupDetailsMenuBlade/~/Members/groupId/${groupId}` : null);

/**
 * Admin › Clients (and AI): the clients by clientAccounts() (ADM-2, D597), or with `all` every account FocusTime knows
 * of: the active Dataverse accounts, keys with team settings and registered chats. Leads never add a client here.
 */
async function clientsSection(ops: AdminOps, rules: OrgRules, process: AdminContext["process"], refresh: boolean, all = false) {
  const [rows, chatKeys, lv, users, dir, ca, overrides] = await Promise.all([ops.org.store.orgRows(), ops.chatClients(), ops.org.levels(), ops.people(), ops.org.store.directory(), ops.org.clientAccounts(), ops.org.store.overrides()]);
  const settingsKeys = new Set([...Object.keys(rules.clients), ...chatKeys, ...overrides.filter((o) => o.kind !== "level" && o.clientKey).map((o) => o.clientKey)]);
  const known = [...new Set([...ca.rows.map((r) => r.clientKey), ...settingsKeys])];
  const keys = (all ? known : known.filter((k) => ca.isClient(k))).sort((a, b) => a.localeCompare(b));
  // A client with no team color gets one now (the same suggestion everyone would get); never a non-client.
  const needColor = keys.filter((k) => ca.isClient(k) && !rules.clients[k]?.color);
  if (needColor.length) {
    await ops.org.suggestColors(needColor);
    rules = await ops.org.rules();
  }
  const by = new Map(rows.filter((r) => r.key === "color").map((r) => [r.scope.slice(7), r.updatedBy]));
  const processKeys = keys.filter((k) => ca.isClient(k));
  const models = process && processKeys.length ? await process(processKeys, refresh).catch(() => null) : null;
  const processOf = (k: string): ClientProcess => {
    const r = models?.find((x) => x.clientKey === k);
    return r ? processView(r) : { ok: false, message: models ? "Not read" : "DevOps can't be read from here" };
  };
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? dir.find((d) => d.personId === id)?.name ?? "Someone not in FocusTime";
  const facts = ops.scope && processKeys.length ? await ops.scope(processKeys).catch(() => null) : null;
  return {
    palette: CLIENT_SLOTS,
    suggested: SUGGESTED_SLOTS,
    filter: all ? "all" : "customers",
    accountsRead: ca.read,
    counts: { customers: known.filter((k) => ca.isClient(k)).length, all: known.length },
    clients: keys.map((k) => {
      const c = rules.clients[k];
      const row = ca.row(k);
      const isClient = ca.isClient(k);
      return {
        key: k,
        isClient,
        why: row?.why ?? (isClient ? "customer" : "not_in_dataverse"),
        whyText: CLIENT_WHY_TEXT[row?.why ?? (isClient ? "customer" : "not_in_dataverse")],
        names: row?.names ?? [],
        types: row?.types ?? [],
        treatAsClient: c?.treatAsClient ?? false,
        hidden: c?.hidden ?? false,
        hasSettings: !isClient && settingsKeys.has(k),
        color: c?.color ?? null,
        colorFrom: by.get(k) === null ? "suggested" : "admin",
        allowAi: c?.allowAi ?? false,
        groupWithoutAi: c?.groupWithoutAi ?? true,
        attachmentsAi: c?.attachmentsAi ?? false,
        openStates: c?.openStates ?? [],
        noBreakdown: c?.noBreakdown ?? [],
        background: c?.background ?? [],
        houseStyle: c?.houseStyle ?? null,
        process: isClient ? processOf(k) : { ok: false, message: "Not a client" },
        scope: isClient ? { rule: c?.devopsScope ?? null, words: scopeWords(c?.devopsScope ?? null), facts: facts?.[k] ?? null, polled: !!ops.scope } : null,
        leads: isClient ? lv.clientLeads(k).map((l) => ({ personId: l.personId, name: nameOf(l.personId), primary: l.primary, why: l.why.map((w) => LEAD_WHY_NAMES[w]) })) : [],
      };
    }),
  };
}

/** CV-3b: while account types aren't read, the fallback decides who is a client; Status and Admin › Clients say so. */
export const CLIENT_FALLBACK_TEXT = "Account types aren't read from Dataverse yet. Until they are, only accounts with Account Workers or Focus Time, Cooptimize Internal and accounts treated as clients count as clients; prospects don't. Refresh to read them now.";

/** A Status line (ADM-2): something an admin may want to look at; never blocks anything. */
export type StatusWarning = { area: "clients" | "people" | "rules" | "jobs"; text: string };

/**
 * ADM-2: what a filtered-out account still has (D598): focus blocks (Account Workers or Focus Time in Dataverse), a
 * registered chat, DevOps settings, AI allowed or a lead override. An account with AI allowed always gets a line.
 */
export async function clientWarnings(ops: AdminOps): Promise<StatusWarning[]> {
  const [ca, rules, chats, overrides] = await Promise.all([ops.org.clientAccounts(), ops.org.rules(), ops.chatClients(), ops.org.store.overrides()]);
  const out: StatusWarning[] = [];
  if (!ca.read) out.push({ area: "clients", text: CLIENT_FALLBACK_TEXT });
  const keys = [...new Set([...ca.rows.map((r) => r.clientKey), ...Object.keys(rules.clients), ...chats, ...overrides.filter((o) => o.kind !== "level" && o.clientKey).map((o) => o.clientKey)])].sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    if (ca.isClient(k)) continue;
    const row = ca.row(k);
    const c = rules.clients[k];
    const has: string[] = [];
    if (row && (row.workers > 0 || row.focus > 0)) has.push(`${row.workers + row.focus} Dataverse Account Worker or Focus Time ${row.workers + row.focus === 1 ? "row" : "rows"}`);
    if (chats.includes(k)) has.push("a registered chat");
    if (c && (c.openStates.length || c.noBreakdown.length || c.background.length || c.houseStyle)) has.push("DevOps settings");
    if (c?.allowAi) has.push("AI allowed");
    const leadOverrides = overrides.filter((o) => o.kind !== "level" && o.clientKey === k).length;
    if (leadOverrides) has.push(`${leadOverrides} lead ${leadOverrides === 1 ? "override" : "overrides"}`);
    if (!has.length) continue;
    const why = row?.hidden ? "is hidden from FocusTime" : "isn't a client";
    out.push({ area: "clients", text: `${k} ${why} but has ${has.join(", ")}. Treat it as a client in Admin › Clients (All accounts), or leave it.` });
  }
  return out;
}

/** The most clients shown per person in Client lead before "and N more" (the screen shows the rest on request). */
export const LEADS_SHOWN = 5;

async function peopleSection(ops: AdminOps, meId: string) {
  const [users, clients, lv, overrides, seen, refreshedAt, ca, rules] = await Promise.all([ops.people(), ops.org.store.peopleClients(), ops.org.levels(), ops.org.store.overrides(), ops.org.store.seenAdmins(), ops.org.store.directoryRefreshedAt(), ops.org.clientAccounts(), ops.org.rules()]);
  const dirName = new Map((await ops.org.store.directory()).map((d) => [d.personId, d]));
  const rows = lv.people.all
    .map((e) => {
      const id = e.id;
      const u = users.find((x) => x.id.toLowerCase() === id) ?? null;
      const d = e.dir ? (dirName.get(e.dir.personId) ?? null) : null;
      const level = lv.levelOf(id);
      const ids = new Set([id, ...(e.dir ? [e.dir.personId] : [])]);
      const removed = overrides.filter((o) => ids.has(o.personId) && o.kind === "lead_remove" && ca.isClient(o.clientKey)).map((o) => o.clientKey);
      // ADM-2 (D599): the Dataverse column reads the same match as the level and leads beside it.
      const dataverse = e.match
        ? { matched: true, text: matchText(e.match) }
        : e.dir
          ? { matched: true, text: e.dir.entra ? "In Dataverse, not signed in yet" : "In Dataverse, Entra id missing" }
          : { matched: false, text: "No Dataverse user has their Entra id, email or UPN" };
      return {
        id,
        name: u?.name ?? d?.name ?? id,
        email: u?.email ?? e.dir?.email ?? null,
        me: id === meId.toLowerCase(),
        signedIn: !!u,
        cooptimizer: !e.notCooptimizer,
        notCooptimizer: e.notCooptimizer,
        notCooptimizerText: e.notCooptimizer ? NOT_COOPTIMIZER_TEXT[e.notCooptimizer] : null,
        automation: rules.automation.includes(id) || (!!e.dir && rules.automation.includes(e.dir.personId)),
        level: level.level,
        levelName: level.level ? LEVEL_NAMES[level.level] : null,
        levelSource: level.source,
        dataverseLevel: level.dataverse ? LEVEL_NAMES[level.dataverse] : null,
        positionName: e.dir?.positionName ?? null,
        leads: lv.leadsOf(id).map((l) => ({ clientKey: l.clientKey, primary: l.primary, why: l.why, whyText: l.why.map((w: LeadWhy) => LEAD_WHY_NAMES[w]) })),
        removedLeads: removed,
        lastSignInAt: u?.lastSignInAt ?? null,
        setup: u?.setup ?? null,
        dataverseMatch: dataverse.matched,
        dataverseText: dataverse.text,
        clients: [...new Set(clients.filter((c) => ids.has(c.personId) && ca.isClient(c.clientKey)).map((c) => c.clientKey))].sort(),
        sources: u?.sources ?? null,
      };
    })
    .sort((a, b) => Number(b.signedIn) - Number(a.signedIn) || a.name.localeCompare(b.name));
  const nameOf = (id: string) => rows.find((p) => p.id === lv.canonical(id))?.name ?? null;
  const admins: { id: string; name: string | null; via: AdminVia | null; checkedAt: string | null }[] = [
    ...seen.filter((s) => !ops.breakGlass.some((b) => b.toLowerCase() === s.personId)).map((s) => ({ id: s.personId, name: nameOf(s.personId), via: s.via, checkedAt: s.checkedAt })),
    ...ops.breakGlass.map((b) => ({ id: b.toLowerCase(), name: nameOf(b), via: "break_glass" as const, checkedAt: null })),
  ];
  // ADM-2 (D605): every position a Cooptimizer holds, and every one mapped, with its level and how many hold it.
  const map = rules.organization.positionLevels;
  const mapKey = new Map(Object.keys(map).map((k) => [k.trim().toLowerCase(), k]));
  const held = new Map<string, { name: string; people: number }>();
  for (const r of rows) {
    if (!r.cooptimizer || !r.positionName) continue;
    const k = r.positionName.trim().toLowerCase();
    const h = held.get(k) ?? { name: mapKey.get(k) ?? r.positionName.trim(), people: 0 };
    h.people++;
    held.set(k, h);
  }
  for (const [k, name] of mapKey) if (!held.has(k)) held.set(k, { name, people: 0 });
  const positions = [...held.entries()]
    .map(([k, h]) => ({ name: h.name, people: h.people, mapped: mapKey.has(k), level: mapKey.has(k) ? (map[mapKey.get(k)!] ?? null) : null }))
    .sort((x, y) => Number(x.mapped) - Number(y.mapped) || x.name.localeCompare(y.name));
  return {
    people: rows.filter((r) => r.cooptimizer),
    others: rows.filter((r) => !r.cooptimizer),
    positions,
    unmappedPositions: positions.filter((x) => !x.mapped && x.people > 0).length,
    noDomains: lv.people.noDomains,
    admins,
    groupLink: groupLink(ops.groupId),
    groupSet: !!ops.groupId,
    refreshedAt,
    leadsShown: LEADS_SHOWN,
    levels: LEVELS.map((l) => ({ id: l, name: LEVEL_NAMES[l] })),
  };
}

const specList = (specs: Record<string, { kind: keyof typeof KIND_NAMES; label: string; area: AdminArea }>) => Object.entries(specs).map(([key, s]) => ({ key, label: s.label, kind: s.kind, kindName: KIND_NAMES[s.kind], area: s.area }));

async function section(ops: AdminOps, s: AdminSection, meId: string, input: Record<string, unknown>, process?: AdminContext["process"], today?: AdminContext["today"]): Promise<unknown> {
  const rules = await ops.org.rules();
  switch (s) {
    case "clients":
      return clientsSection(ops, rules, process, input.refresh === true, input.filter === "all");
    case "ai": {
      const [setup, spent, clients] = await Promise.all([ops.aiSetUp(), ops.appSpentMicros(), clientsSection(ops, rules, undefined, false, input.filter === "all")]);
      return { ...rules.ai, ...setup, appSpentMicros: spent, zero: { person: rules.ai.personCapUsd === 0, app: rules.ai.appCapUsd === 0 }, filter: clients.filter, counts: clients.counts, clients: clients.clients.map((c) => ({ key: c.key, isClient: c.isClient, whyText: c.whyText, allowAi: c.allowAi, groupWithoutAi: c.groupWithoutAi, attachmentsAi: c.attachmentsAi })), keys: specList({ "ai.on": ORG_SPECS["ai.on"], "ai.model": ORG_SPECS["ai.model"], "ai.person_cap_usd": ORG_SPECS["ai.person_cap_usd"], "ai.app_cap_usd": ORG_SPECS["ai.app_cap_usd"] }) };
    }
    case "conversations":
      // CV-1 lists the settings it needs; they are hosted here as they appear (read through the settings reader).
      return { ...rules.conversations, more: [] as string[] };
    case "organization": {
      const rows = await ops.org.store.orgRows();
      const stored = (k: string) => rows.some((r) => r.scope === "org" && r.key === k);
      return {
        ...rules.organization,
        inviteFromBootstrap: !stored("org.invite_domains"),
        feedbackFromBootstrap: !stored("org.feedback"),
        levels: rules.levels,
        levelNames: LEVEL_NAMES,
        levelKeys: specList(LEVEL_SPECS),
      };
    }
    case "people":
      return peopleSection(ops, meId);
    case "status": {
      const [st, warnings, rules, groups] = await Promise.all([ops.status(today ? await today() : new Date().toISOString().slice(0, 10)), clientWarnings(ops), ops.org.rules(), ops.statusRows ? ops.statusRows.groups() : Promise.resolve([])]);
      return { ...st, warnings: [...(st.warnings ?? []), ...ruleWarnings(rules), ...warnings], jobs: statusJobs(rules, st), groups };
    }
    case "audit": {
      const area = typeof input.area === "string" && input.area ? input.area : null;
      const text = typeof input.text === "string" ? input.text.slice(0, 100) : null;
      return { entries: await ops.org.store.auditList({ area, text }) };
    }
  }
}

/** Plain words for who a setting applies to. */
const targetOf = (scope: string) => (scope === "org" ? "Everyone" : scope.startsWith("client:") ? scope.slice(7) : scope.startsWith("level:") ? LEVEL_NAMES[scope.slice(6) as Level] : scope);

export async function adminAction(ctx: AdminContext, action: AdminAction, input: unknown): Promise<ActionResponse> {
  const i = obj(input ?? {});
  if (!i) return bad("input must be an object");
  const me = await ctx.me();
  const ops = ctx.ops;
  if (action === "admin.status") {
    if (Object.keys(i).length) return bad("admin.status takes {}");
    const via = ops && me ? await ops.check.via(me.id) : null;
    return { ok: true, data: { admin: via !== null, via } };
  }
  // The one check, on the server, for everything else.
  if (!ops || !me || !(await ops.check.isAdmin(me.id))) return bad(NOT_ADMIN, 403, "admin");
  const actor: Actor = { id: me.id, name: me.name };

  switch (action) {
    case "admin.load": {
      const extra = only(i, ["section", "area", "text", "refresh", "filter"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.section !== "string" || !(ADMIN_SECTIONS as readonly string[]).includes(i.section)) return bad(`section must be one of ${ADMIN_SECTIONS.join(", ")}`);
      return { ok: true, data: await section(ops, i.section as AdminSection, me.id, i, ctx.process, ctx.today) };
    }
    case "admin.audit": {
      const extra = only(i, ["area", "text"]);
      if (extra) return bad(`unknown input field ${extra}`);
      return { ok: true, data: await section(ops, "audit", me.id, i) };
    }
    case "admin.set": {
      const extra = only(i, ["scope", "key", "value", "clear"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.scope !== "string" || typeof i.key !== "string") return bad("admin.set takes { scope, key, value } or { scope, key, clear: true }");
      const spec = specFor(i.scope, i.key);
      if (!spec || spec.kind === "personal") return bad(`${i.scope}/${i.key} isn't a team setting`, 400);
      let value: unknown;
      if (i.clear === true) value = undefined;
      else {
        if (!("value" in i)) return bad("admin.set needs a value (or clear: true)");
        try {
          value = spec.parse(i.value);
        } catch (e) {
          if (e instanceof OrgInputError) return bad(e.message, 422, "invalid");
          throw e;
        }
      }
      if (i.key === "hidden" && value === true && i.scope.toLowerCase() === clientScope(INTERNAL_CLIENT).toLowerCase()) return bad("Cooptimize Internal is always a client", 422, "invalid");
      const before = i.scope.startsWith("client:") ? (await ops.org.rules()).clients[i.scope.slice(7)] : undefined;
      let target = targetOf(i.scope);
      if (i.scope.startsWith("person:")) {
        const e = (await ops.org.levels()).people.entry(i.scope.slice(7));
        if (!e) return bad("No such person in FocusTime or Dataverse", 404);
        const u = (await ops.people()).find((x) => x.id.toLowerCase() === e.id);
        target = u?.name ?? (await ops.org.store.directory()).find((d) => d.personId === e.dir?.personId)?.name ?? target;
      }
      const r = await ops.org.store.setOrg({ scope: i.scope, key: i.key, value, actor, area: spec.area, target });
      ops.org.invalidate();
      const next = await ops.org.rules();
      const warning =
        (i.key === "ai.person_cap_usd" || i.key === "ai.app_cap_usd") && value === 0
          ? "AI budget is set to $0: AI requests stop until the cap is raised."
          : i.key === "ai.on" && value === false
            ? "AI is off for everyone."
            : i.key === "hidden" && value === true && before?.allowAi
              ? `${i.scope.slice(7)} has AI allowed. It's hidden now, and Admin › Status lists it until AI is turned off for it.`
              : null;
      return { ok: true, data: { scope: i.scope, key: i.key, old: json(r.old), value: json(r.next), warning, ai: next.ai } };
    }
    case "admin.override": {
      const extra = only(i, ["personId", "kind", "clientKey", "value", "clear"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.personId !== "string" || !/^(dv:)?[0-9a-f-]{36}$/i.test(i.personId)) return bad("personId must be an Entra object id (or a Dataverse user's dv: id)");
      if (i.kind !== "level" && i.kind !== "lead_add" && i.kind !== "lead_remove") return bad("kind must be level, lead_add or lead_remove");
      const kind = i.kind as OverrideKind;
      const clear = i.clear === true;
      if (kind === "level" && !clear && !(LEVELS as readonly unknown[]).includes(i.value)) return bad(`value must be one of ${LEVELS.join(", ")}`, 422);
      if (kind !== "level" && (typeof i.clientKey !== "string" || !i.clientKey.trim() || i.clientKey.length > 100)) return bad("clientKey names the client", 422);
      const [users, dir, lv] = await Promise.all([ops.people(), ops.org.store.directory(), ops.org.levels()]);
      const entry = lv.people.entry(i.personId);
      const id = entry?.id ?? i.personId.toLowerCase();
      const name = users.find((u) => u.id.toLowerCase() === id)?.name ?? dir.find((d) => d.personId === (entry?.dir?.personId ?? id))?.name;
      if (!name) return bad("No such person in FocusTime or Dataverse", 404);
      // ADM-2: a lead only of a client, and only for a Cooptimizer.
      if (kind === "lead_add" && !clear) {
        if (entry?.notCooptimizer) return bad(`${name} isn't a Cooptimizer, so they can't lead a client`, 422, "invalid");
        if (!(await ops.org.clientAccounts()).isClient((i.clientKey as string).trim())) return bad("That account isn't a client", 422, "invalid");
      }
      await ops.org.store.setOverride({ personId: id, personName: name, kind, ...(kind !== "level" ? { clientKey: (i.clientKey as string).trim() } : {}), value: kind === "level" ? (i.value as string) : null, clear, actor });
      ops.org.invalidate();
      return { ok: true, data: { personId: id, kind, clear } };
    }
    case "admin.status_action": {
      // DV-1: a status row's action (Check now). It changes nothing anyone set, so it isn't in the audit log.
      const extra = only(i, ["source", "row", "action"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.source !== "string" || typeof i.row !== "string" || typeof i.action !== "string") return bad("admin.status_action takes { source, row, action }");
      const done = ops.statusRows ? await ops.statusRows.act(i.source, i.row, i.action) : false;
      return done ? { ok: true, data: { groups: await ops.statusRows!.groups() } } : bad("No such status action", 404);
    }
    case "admin.refresh_people": {
      if (Object.keys(i).length) return bad("admin.refresh_people takes {}");
      const r = await ops.refreshPeople();
      ops.org.invalidate();
      return r.ok ? { ok: true, data: r } : bad(r.message ?? "Dataverse couldn't be read", 502, "dataverse");
    }
    case "admin.remove_person": {
      const extra = only(i, ["personId", "confirmName"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.personId !== "string" || typeof i.confirmName !== "string") return bad("admin.remove_person takes { personId, confirmName }");
      const id = i.personId.toLowerCase();
      if (id === me.id.toLowerCase()) return bad("You can't remove yourself. Another admin can, or use Settings › Data › Delete my data.", 400, "self");
      const person = (await ops.people()).find((u) => u.id.toLowerCase() === id);
      if (!person) return bad("No such person in FocusTime", 404);
      const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
      if (norm(i.confirmName) !== norm(person.name)) return bad(`Type their name, ${person.name}, to remove them`, 422, "confirm");
      await ops.removePerson(person.id);
      await ops.org.store.forgetPerson(person.id);
      await ops.org.store.audit(actor, { area: "people", target: person.name, setting: "person", oldValue: null, newValue: null, note: "removed: FocusTime data and personal secrets deleted" });
      ops.check.forget(person.id);
      ops.org.invalidate();
      return { ok: true, data: { removed: person.name } };
    }
  }
}

/** The kinds and labels of every team key, for the Guide and the "Set by your FocusTime admin" lines. */
export const TEAM_KEYS = { org: specList(ORG_SPECS), client: specList(CLIENT_SPECS), level: specList(LEVEL_SPECS) };

export type { AuditEntry, Guidance };
export { clientScope };
