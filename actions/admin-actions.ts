// ADM-1: the admin console's actions. Every one but admin.status starts with the one server-side check (an admin of
// this FocusTime: the FocusTime Admins group or the break-glass list; in the demo, the demo's own person over the
// demo's own store). Admins manage the team's settings and see health; nothing more. Nothing here reads anyone's plan,
// picks, follow-ups, captures, focus sessions, write PATs, AI request content or chat messages: a person's health is
// names, dates and yes or no (AdminOps.people), and the store has no read for anything else. Every change is audited
// (store/admin-store.ts) with who, when, what, old and new value; secrets are never settings.
import { clientScope, CLIENT_SPECS, KIND_NAMES, LEVEL_NAMES, LEVEL_SPECS, LEVELS, ORG_SPECS, OrgInputError, specFor, SUGGESTED_SLOTS, type AdminArea, type Guidance, type Level, type OrgRules } from "../config/org.ts";
import { CLIENT_SLOTS } from "../config/schema.ts";
import { LEAD_WHY_NAMES, type LeadWhy } from "../plan/levels.ts";
import type { Actor, AuditEntry, OverrideKind } from "../store/admin-store.ts";
import type { AdminCheck, AdminVia } from "./admin.ts";
import type { OrgRuntime } from "./org.ts";
import { breakdownText, looksOf } from "../plan/process.ts";
import type { ProcessModelResult } from "../sources/devops/source.ts";
import type { ActionResponse, ClientProcess } from "./types.ts";

export const ADMIN_ACTIONS = ["admin.status", "admin.load", "admin.set", "admin.override", "admin.refresh_people", "admin.remove_person", "admin.audit"] as const;
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
  dataverseMatch: boolean;
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
};

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
  status(): Promise<AdminStatus>;
  refreshPeople(): Promise<{ ok: boolean; message: string | null; people: number }>;
  /** Deletes a person's FocusTime data and personal secrets now, and ends their sessions. */
  removePerson(id: string): Promise<void>;
};

export type AdminContext = {
  ops: AdminOps | null;
  /** The signed-in person (Entra object id and name). */
  me: () => Promise<Actor & { id: string } | null>;
  /** WT-1: the clients' DevOps process models (with their Rules applied); null when DevOps can't be read here. */
  process?: (clientKeys: string[], refresh: boolean) => Promise<ProcessModelResult[] | null>;
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

async function clientsSection(ops: AdminOps, rules: OrgRules, process: AdminContext["process"], refresh: boolean) {
  const [rows, chatKeys, dirClients, lv, users, dir] = await Promise.all([ops.org.store.orgRows(), ops.chatClients(), ops.org.store.peopleClients(), ops.org.levels(), ops.people(), ops.org.store.directory()]);
  const leadKeys = (await ops.org.store.leads()).map((l) => l.clientKey);
  const keys = [...new Set([...Object.keys(rules.clients), ...chatKeys, ...dirClients.map((c) => c.clientKey), ...leadKeys])].sort((a, b) => a.localeCompare(b));
  // A client with no team color gets one now (the same suggestion everyone would get).
  if (keys.some((k) => !rules.clients[k]?.color)) {
    await ops.org.suggestColors(keys);
    rules = await ops.org.rules();
  }
  const by = new Map(rows.filter((r) => r.key === "color").map((r) => [r.scope.slice(7), r.updatedBy]));
  const models = process && keys.length ? await process(keys, refresh).catch(() => null) : null;
  const processOf = (k: string): ClientProcess => {
    const r = models?.find((x) => x.clientKey === k);
    return r ? processView(r) : { ok: false, message: models ? "Not read" : "DevOps can't be read from here" };
  };
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? dir.find((d) => d.personId === id)?.name ?? "Someone not in FocusTime";
  return {
    palette: CLIENT_SLOTS,
    suggested: SUGGESTED_SLOTS,
    clients: keys.map((k) => {
      const c = rules.clients[k];
      return {
        key: k,
        color: c?.color ?? null,
        colorFrom: by.get(k) === null ? "suggested" : "admin",
        allowAi: c?.allowAi ?? false,
        attachmentsAi: false,
        openStates: c?.openStates ?? [],
        noBreakdown: c?.noBreakdown ?? [],
        background: c?.background ?? [],
        houseStyle: c?.houseStyle ?? null,
        process: processOf(k),
        leads: lv.clientLeads(k).map((l) => ({ personId: l.personId, name: nameOf(l.personId), primary: l.primary, why: l.why.map((w) => LEAD_WHY_NAMES[w]) })),
      };
    }),
  };
}

async function peopleSection(ops: AdminOps, meId: string) {
  const [users, dir, clients, lv, overrides, seen, refreshedAt] = await Promise.all([ops.people(), ops.org.store.directory(), ops.org.store.peopleClients(), ops.org.levels(), ops.org.store.overrides(), ops.org.store.seenAdmins(), ops.org.store.directoryRefreshedAt()]);
  const ids = [...new Set([...users.map((u) => u.id.toLowerCase()), ...dir.map((d) => d.personId)])];
  const people = ids
    .map((id) => {
      const u = users.find((x) => x.id.toLowerCase() === id) ?? null;
      const d = dir.find((x) => x.personId === id) ?? null;
      const level = lv.levelOf(id);
      const removed = overrides.filter((o) => o.personId === id && o.kind === "lead_remove").map((o) => o.clientKey);
      return {
        id,
        name: u?.name ?? d?.name ?? id,
        email: u?.email ?? d?.email ?? null,
        me: id === meId.toLowerCase(),
        signedIn: !!u,
        level: level.level,
        levelName: level.level ? LEVEL_NAMES[level.level] : null,
        levelSource: level.source,
        dataverseLevel: level.dataverse ? LEVEL_NAMES[level.dataverse] : null,
        leads: lv.leadsOf(id).map((l) => ({ clientKey: l.clientKey, primary: l.primary, why: l.why, whyText: l.why.map((w: LeadWhy) => LEAD_WHY_NAMES[w]) })),
        removedLeads: removed,
        lastSignInAt: u?.lastSignInAt ?? null,
        setup: u?.setup ?? null,
        dataverseMatch: u ? u.dataverseMatch : !!d,
        clients: clients.filter((c) => c.personId === id).map((c) => c.clientKey),
        sources: u?.sources ?? null,
      };
    })
    .sort((a, b) => Number(b.signedIn) - Number(a.signedIn) || a.name.localeCompare(b.name));
  const nameOf = (id: string) => people.find((p) => p.id === id.toLowerCase())?.name ?? null;
  const admins: { id: string; name: string | null; via: AdminVia | null; checkedAt: string | null }[] = [
    ...seen.filter((s) => !ops.breakGlass.some((b) => b.toLowerCase() === s.personId)).map((s) => ({ id: s.personId, name: nameOf(s.personId), via: s.via, checkedAt: s.checkedAt })),
    ...ops.breakGlass.map((b) => ({ id: b.toLowerCase(), name: nameOf(b), via: "break_glass" as const, checkedAt: null })),
  ];
  return { people, admins, groupLink: groupLink(ops.groupId), groupSet: !!ops.groupId, refreshedAt, levels: LEVELS.map((l) => ({ id: l, name: LEVEL_NAMES[l] })) };
}

const specList = (specs: Record<string, { kind: keyof typeof KIND_NAMES; label: string; area: AdminArea }>) => Object.entries(specs).map(([key, s]) => ({ key, label: s.label, kind: s.kind, kindName: KIND_NAMES[s.kind], area: s.area }));

async function section(ops: AdminOps, s: AdminSection, meId: string, input: Record<string, unknown>, process?: AdminContext["process"]): Promise<unknown> {
  const rules = await ops.org.rules();
  switch (s) {
    case "clients":
      return clientsSection(ops, rules, process, input.refresh === true);
    case "ai": {
      const [setup, spent, clients] = await Promise.all([ops.aiSetUp(), ops.appSpentMicros(), clientsSection(ops, rules, undefined, false)]);
      return { ...rules.ai, ...setup, appSpentMicros: spent, zero: { person: rules.ai.personCapUsd === 0, app: rules.ai.appCapUsd === 0 }, clients: clients.clients.map((c) => ({ key: c.key, allowAi: c.allowAi, attachmentsAi: c.attachmentsAi })), keys: specList({ "ai.on": ORG_SPECS["ai.on"], "ai.model": ORG_SPECS["ai.model"], "ai.person_cap_usd": ORG_SPECS["ai.person_cap_usd"], "ai.app_cap_usd": ORG_SPECS["ai.app_cap_usd"] }) };
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
    case "status":
      return ops.status();
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
      const extra = only(i, ["section", "area", "text", "refresh"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.section !== "string" || !(ADMIN_SECTIONS as readonly string[]).includes(i.section)) return bad(`section must be one of ${ADMIN_SECTIONS.join(", ")}`);
      return { ok: true, data: await section(ops, i.section as AdminSection, me.id, i, ctx.process) };
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
      const r = await ops.org.store.setOrg({ scope: i.scope, key: i.key, value, actor, area: spec.area, target: targetOf(i.scope) });
      ops.org.invalidate();
      const next = await ops.org.rules();
      const warning =
        (i.key === "ai.person_cap_usd" || i.key === "ai.app_cap_usd") && value === 0 ? "AI budget is set to $0: AI requests stop until the cap is raised." : i.key === "ai.on" && value === false ? "AI is off for everyone." : null;
      return { ok: true, data: { scope: i.scope, key: i.key, old: json(r.old), value: json(r.next), warning, ai: next.ai } };
    }
    case "admin.override": {
      const extra = only(i, ["personId", "kind", "clientKey", "value", "clear"]);
      if (extra) return bad(`unknown input field ${extra}`);
      if (typeof i.personId !== "string" || !/^[0-9a-f-]{36}$/i.test(i.personId)) return bad("personId must be an Entra object id");
      if (i.kind !== "level" && i.kind !== "lead_add" && i.kind !== "lead_remove") return bad("kind must be level, lead_add or lead_remove");
      const kind = i.kind as OverrideKind;
      const clear = i.clear === true;
      if (kind === "level" && !clear && !(LEVELS as readonly unknown[]).includes(i.value)) return bad(`value must be one of ${LEVELS.join(", ")}`, 422);
      if (kind !== "level" && (typeof i.clientKey !== "string" || !i.clientKey.trim() || i.clientKey.length > 100)) return bad("clientKey names the client", 422);
      const [users, dir] = await Promise.all([ops.people(), ops.org.store.directory()]);
      const id = i.personId.toLowerCase();
      const name = users.find((u) => u.id.toLowerCase() === id)?.name ?? dir.find((d) => d.personId === id)?.name;
      if (!name) return bad("No such person in FocusTime or Dataverse", 404);
      await ops.org.store.setOverride({ personId: id, personName: name, kind, ...(kind !== "level" ? { clientKey: (i.clientKey as string).trim() } : {}), value: kind === "level" ? (i.value as string) : null, clear, actor });
      ops.org.invalidate();
      return { ok: true, data: { personId: id, kind, clear } };
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
