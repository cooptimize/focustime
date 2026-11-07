// AH-2: Cooptimize's work in a client's DevOps project, pure. A client's project often holds far more than our work
// (a whole ERP program around a BI project), so Ahead, Fix next and Week's lists show only the items in scope. An
// admin sets the scope per client in Admin › Clients (CLIENT_SPECS.devops_scope): whole project, DevOps teams (their
// own area paths, with or without sub-areas, as each team's settings say) or area paths. Until then the automatic
// scope applies: items assigned to a Cooptimizer, everything under an epic or feature a Cooptimizer owns, and the
// exact area paths where Cooptimizers have items assigned, never the project's root area when the project has other
// areas (so a root full of the client's own work can't pull in everything). A project with only its root area is the
// whole project. Items assigned to me are always in scope. Area paths match without case, as DevOps does.

/** An area path, with or without the areas under it (DevOps's "include sub areas"). */
export type AreaRule = { path: string; sub: boolean };

/** What an admin sets. Absent (null): automatic. */
export type DevOpsScope = { kind: "whole" } | { kind: "teams"; teams: string[] } | { kind: "areas"; areas: AreaRule[] };
export type ScopeKind = "automatic" | DevOpsScope["kind"];

/** A team as its settings say: its area paths, when its team field is the area path. */
export type ProjectTeam = { name: string; areas: AreaRule[]; /** The team field isn't System.AreaPath (a custom field): no areas known. */ otherField: boolean };

/** A project's own area tree and teams, read from DevOps once a day (null parts: not readable, with the reason). */
export type ProjectAreas = {
  /** The root area (the project's name as DevOps writes it in area paths). */
  root: string | null;
  /** Every area path in the tree, root first. */
  paths: string[];
  areasProblem: string | null;
  teams: ProjectTeam[] | null;
  teamsProblem: string | null;
  readAt: string;
  /**
   * AH-5: the people on the project's teams (DevOps uniqueName and display name), for Ahead's assignee list. Read
   * with the teams, a day, in memory only; never shown as addresses (only a domain). Absent before AH-5 or unread.
   */
  people?: { email: string; name: string }[] | null;
};

/** What the rules need of an item. */
export type ScopeItem = { id: number; parentId: number | null; area: string | null; assigneeEmail: string | null; /** A top or parent level item (an epic or a feature): owning one brings in what's under it. */ portfolio: boolean };

export type ScopeResult = {
  kind: ScopeKind;
  /** Every item is in scope (whole project, or a project with only its root area). */
  all: boolean;
  ids: Set<number>;
  /** The area rules used (automatic: the derived ones; teams: their areas). */
  areas: AreaRule[];
  /** Why a set scope couldn't apply as set (teams not readable): the automatic one is used instead. */
  problem: string | null;
};

export const MAX_SCOPE_ENTRIES = 50;
const AREA_MAX = 400;

const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Whether an area path is matched by a rule (sub: the path itself or anything under it). */
export function inArea(path: string | null | undefined, rules: readonly AreaRule[]): boolean {
  const p = low(path);
  if (!p) return false;
  return rules.some((r) => {
    const q = low(r.path);
    return p === q || (r.sub && p.startsWith(`${q}\\`));
  });
}

/** The root of the project's areas: the tree's, else the first segment the items' paths share. */
export function rootOf(items: readonly Pick<ScopeItem, "area">[], areas: ProjectAreas | null): string | null {
  if (areas?.root) return areas.root;
  const first = items.map((i) => (i.area ?? "").split("\\")[0]!.trim()).find(Boolean);
  return first ?? null;
}

/** The project uses areas below its root (the tree has more than the root, or an item sits below it). */
export function hasSubAreas(items: readonly Pick<ScopeItem, "area">[], areas: ProjectAreas | null): boolean {
  if (areas && !areas.areasProblem && areas.paths.length) return areas.paths.length > 1;
  const root = low(rootOf(items, areas));
  return items.some((i) => !!i.area && low(i.area) !== root);
}

/** Every item under these (any depth), and the items themselves. */
function withDescendants(items: readonly ScopeItem[], roots: ReadonlySet<number>): Set<number> {
  const kids = new Map<number, number[]>();
  for (const i of items) if (i.parentId !== null) (kids.get(i.parentId) ?? kids.set(i.parentId, []).get(i.parentId)!).push(i.id);
  const out = new Set<number>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

/** The automatic scope's parts, for the rule and for Admin's counts. */
export function automaticParts(items: readonly ScopeItem[], o: { areas: ProjectAreas | null; isCooptimizer: (email: string) => boolean }) {
  const coop = (i: ScopeItem) => !!i.assigneeEmail && o.isCooptimizer(i.assigneeEmail.toLowerCase());
  const assigned = new Set(items.filter(coop).map((i) => i.id));
  const owned = withDescendants(items, new Set(items.filter((i) => i.portfolio && coop(i)).map((i) => i.id)));
  const sub = hasSubAreas(items, o.areas);
  const root = low(rootOf(items, o.areas));
  const seen = new Map<string, string>();
  for (const i of items) if (assigned.has(i.id) && i.area && !seen.has(low(i.area))) seen.set(low(i.area), i.area);
  // The safeguard (AH-2): the root area never counts while the project has other areas.
  const areas: AreaRule[] = [...seen.entries()].filter(([k]) => !sub || k !== root).map(([, path]) => ({ path, sub: false }));
  return { assigned, owned, areas, whole: !sub };
}

/** Which items are in scope. `me`: my DevOps identity (my items are always in). */
export function scopeOf(items: readonly ScopeItem[], rule: DevOpsScope | null, o: { areas: ProjectAreas | null; isCooptimizer: (email: string) => boolean; me: string | null }): ScopeResult {
  const me = low(o.me);
  const mine = (i: ScopeItem) => !!me && low(i.assigneeEmail) === me;
  const all = (kind: ScopeKind, problem: string | null = null): ScopeResult => ({ kind, all: true, ids: new Set(items.map((i) => i.id)), areas: [], problem });
  const automatic = (problem: string | null = null): ScopeResult => {
    const p = automaticParts(items, o);
    if (p.whole) return all("automatic", problem);
    const ids = new Set([...p.assigned, ...p.owned]);
    for (const i of items) if (mine(i) || inArea(i.area, p.areas)) ids.add(i.id);
    return { kind: "automatic", all: false, ids, areas: p.areas, problem };
  };
  const byAreas = (kind: ScopeKind, rules: AreaRule[]): ScopeResult => ({ kind, all: false, ids: new Set(items.filter((i) => mine(i) || inArea(i.area, rules)).map((i) => i.id)), areas: rules, problem: null });
  if (!rule) return automatic();
  if (rule.kind === "whole") return all("whole");
  if (rule.kind === "areas") return byAreas("areas", rule.areas);
  // Teams: their area paths from the team settings. Not readable now: the automatic scope, saying why.
  if (!o.areas?.teams) return automatic(o.areas?.teamsProblem ?? "The project's teams aren't read yet, so the automatic scope is used");
  const want = new Set(rule.teams.map(low));
  const teams = o.areas.teams.filter((t) => want.has(low(t.name)));
  if (!teams.length) return automatic("None of the chosen teams is in the project now, so the automatic scope is used");
  return byAreas("teams", teams.flatMap((t) => t.areas));
}

/** Plain words for a scope, for Admin and Ahead's note. */
export function scopeWords(rule: DevOpsScope | null): string {
  if (!rule) return "Automatic";
  if (rule.kind === "whole") return "Whole project";
  if (rule.kind === "teams") return rule.teams.length === 1 ? `Team ${rule.teams[0]}` : `${rule.teams.length} teams`;
  return rule.areas.length === 1 ? `Area ${rule.areas[0]!.path}${rule.areas[0]!.sub ? " and sub-areas" : ""}` : `${rule.areas.length} area paths`;
}

/** Admin › Clients' counts: per area path and per team, how many items and how many are Cooptimize's (assigned to a Cooptimizer or under an epic or feature one owns). */
export type ScopeCounts = {
  total: number;
  automatic: number;
  areas: { path: string; items: number; coop: number }[];
  teams: { name: string; areas: AreaRule[]; otherField: boolean; items: number; coop: number }[] | null;
};
export function scopeCounts(items: readonly ScopeItem[], o: { areas: ProjectAreas | null; isCooptimizer: (email: string) => boolean }): ScopeCounts {
  const p = automaticParts(items, o);
  const coop = (i: ScopeItem) => p.assigned.has(i.id) || p.owned.has(i.id);
  const byPath = new Map<string, { path: string; items: number; coop: number }>();
  for (const path of o.areas?.paths ?? []) byPath.set(low(path), { path, items: 0, coop: 0 });
  for (const i of items) {
    if (!i.area) continue;
    const r = byPath.get(low(i.area)) ?? byPath.set(low(i.area), { path: i.area, items: 0, coop: 0 }).get(low(i.area))!;
    r.items++;
    if (coop(i)) r.coop++;
  }
  const auto = scopeOf(items, null, { ...o, me: null });
  return {
    total: items.length,
    automatic: auto.ids.size,
    areas: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)).slice(0, AREA_MAX),
    teams: o.areas?.teams?.map((t) => {
      const mine = items.filter((i) => inArea(i.area, t.areas));
      return { name: t.name, areas: t.areas, otherField: t.otherField, items: mine.length, coop: mine.filter(coop).length };
    }) ?? null,
  };
}

/** What Admin › Clients shows to choose "Cooptimize's work in this project". Counts are open items. */
export type ClientScopeFacts = { counts: ScopeCounts | null; areasProblem: string | null; teamsProblem: string | null; readAt: string | null };

/** The admin's input, checked (Admin › Clients; config/org.ts's spec). */
export function parseScope(v: unknown): DevOpsScope {
  const fail = (m: string): never => {
    throw new ScopeInputError(m);
  };
  if (typeof v !== "object" || v === null || Array.isArray(v)) return fail("A scope is { kind: whole }, { kind: teams, teams } or { kind: areas, areas }");
  const o = v as Record<string, unknown>;
  const name = (s: unknown, what: string) => (typeof s === "string" && s.trim() && s.trim().length <= 256 && !/[\u0000-\u001f]/.test(s) ? s.trim() : fail(`${what} must be a name up to 256 characters`));
  if (o.kind === "whole" && Object.keys(o).length === 1) return { kind: "whole" };
  if (o.kind === "teams" && Object.keys(o).every((k) => k === "kind" || k === "teams")) {
    if (!Array.isArray(o.teams) || !o.teams.length || o.teams.length > MAX_SCOPE_ENTRIES) fail(`Choose 1 to ${MAX_SCOPE_ENTRIES} teams`);
    const seen = new Set<string>();
    return { kind: "teams", teams: (o.teams as unknown[]).map((t) => name(t, "A team")).filter((t) => !seen.has(low(t)) && !!seen.add(low(t))) };
  }
  if (o.kind === "areas" && Object.keys(o).every((k) => k === "kind" || k === "areas")) {
    if (!Array.isArray(o.areas) || !o.areas.length || o.areas.length > MAX_SCOPE_ENTRIES) fail(`Choose 1 to ${MAX_SCOPE_ENTRIES} area paths`);
    const areas = (o.areas as unknown[]).map((a) => {
      const r = typeof a === "object" && a !== null ? (a as Record<string, unknown>) : fail("An area is { path, sub }");
      if (typeof r.sub !== "boolean") fail("Say whether an area includes its sub-areas");
      return { path: name(r.path, "An area path"), sub: r.sub as boolean };
    });
    return { kind: "areas", areas: [...new Map(areas.map((a) => [low(a.path), a])).values()] };
  }
  return fail("A scope is { kind: whole }, { kind: teams, teams } or { kind: areas, areas }");
}
export class ScopeInputError extends Error {}
