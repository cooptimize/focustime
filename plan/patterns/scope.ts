// WP-2: the analysis scope, pure. A client's DevOps often holds far more than Cooptimize's BI and analytics work (a whole
// ERP program around it), so the patterns page reads each client within a scope of its own: whole project, chosen
// teams, or chosen area paths (with or without the areas under them), across one or more of the client's projects. The
// rules and words are AH-2's (plan/devops-scope.ts: inArea, "include sub areas", team field values), but the scope is
// the page's own: it never changes Admin › Clients, and Admin › Clients' scope is only its starting point.
//
// The layout is what a person needs to choose: per project, its teams and area paths, each with how many items from the
// 24-month window sit there and of which work item types. Counts only. An item outside the scope is read for the layout
// only (area, type, created date) and counted once as "outside scope".
import { inArea, type AreaRule, type DevOpsScope, type ProjectTeam } from "../devops-scope.ts";

export type { AreaRule };

/** The page's scope for one client. */
export type AnalysisScope =
  | { kind: "whole"; projects: string[] }
  | { kind: "teams"; teams: { project: string; name: string }[] }
  | { kind: "areas"; areas: AreaRule[] };

/** What the layout keeps of one item: never a title, text or person. */
export type LayoutRow = { id: number; project: string; area: string | null; type: string; createdAt: string | null };

/** A project's area tree and teams as read for the layout (never its people). */
export type ProjectTree = { project: string; root: string | null; paths: string[]; areasProblem: string | null; teams: ProjectTeam[] | null; teamsProblem: string | null };

export type Count = { items: number; types: Record<string, number> };
export type AreaCount = Count & { path: string; depth: number; /** This area and every area under it. */ under: Count };
export type TeamCount = Count & { name: string; areas: AreaRule[]; otherField: boolean };
export type ProjectLayout = Count & { project: string; root: string | null; areas: AreaCount[]; teams: TeamCount[] | null; areasProblem: string | null; teamsProblem: string | null; /** Only the root area is used (or known). */ oneArea: boolean };
export type Layout = { items: number; projects: ProjectLayout[] };

const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const AREA_MAX = 400;

function counted(rows: readonly LayoutRow[]): Count {
  const types: Record<string, number> = {};
  for (const r of rows) types[r.type] = (types[r.type] ?? 0) + 1;
  return { items: rows.length, types };
}

/** Whether a project uses areas below its root: its tree has more than the root, or an item sits below it. */
export function oneAreaOnly(rows: readonly LayoutRow[], tree: ProjectTree | null): boolean {
  if (tree && !tree.areasProblem && tree.paths.length > 1) return false;
  const root = low(tree?.root ?? rows.find((r) => r.area)?.area?.split("\\")[0]);
  return !rows.some((r) => !!r.area && low(r.area) !== root);
}

/** The layout of a client's projects, from the rows the layout read kept and each project's tree. */
export function layoutOf(rows: readonly LayoutRow[], trees: readonly ProjectTree[]): Layout {
  const names = [...new Set([...trees.map((t) => t.project), ...rows.map((r) => r.project)])];
  const projects = names.map((project): ProjectLayout => {
    const tree = trees.find((t) => low(t.project) === low(project)) ?? null;
    const mine = rows.filter((r) => low(r.project) === low(project));
    const paths = new Map<string, string>();
    for (const p of tree?.paths ?? []) paths.set(low(p), p);
    for (const r of mine) if (r.area && !paths.has(low(r.area))) paths.set(low(r.area), r.area);
    const areas = [...paths.values()]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, AREA_MAX)
      .map((path): AreaCount => ({ path, depth: path.split("\\").length - 1, ...counted(mine.filter((r) => low(r.area) === low(path))), under: counted(mine.filter((r) => inArea(r.area, [{ path, sub: true }]))) }));
    const teams = tree?.teams?.map((t): TeamCount => ({ name: t.name, areas: t.areas, otherField: t.otherField, ...counted(t.otherField ? [] : mine.filter((r) => inArea(r.area, t.areas))) })) ?? null;
    return { project, root: tree?.root ?? null, ...counted(mine), areas, teams, areasProblem: tree?.areasProblem ?? null, teamsProblem: tree?.teamsProblem ?? null, oneArea: oneAreaOnly(mine, tree) };
  });
  return { items: rows.length, projects };
}

/** A scope as a test for one row, with the problems that make it narrower than it was set (plain words). */
export function matcherOf(scope: AnalysisScope, trees: readonly ProjectTree[]): { match: (r: Pick<LayoutRow, "project" | "area">) => boolean; problems: string[]; /** Teams: the area rules they stood for. */ rules?: AreaRule[] } {
  const problems: string[] = [];
  const tree = (p: string) => trees.find((t) => low(t.project) === low(p)) ?? null;
  if (scope.kind === "whole") {
    const want = new Set(scope.projects.map(low));
    for (const p of scope.projects) if (!tree(p)) problems.push(`Project ${p} wasn't read in the last inventory`);
    return { match: (r) => want.has(low(r.project)), problems };
  }
  if (scope.kind === "teams") {
    const rules: AreaRule[] = [];
    for (const t of scope.teams) {
      const tr = tree(t.project);
      const team = tr?.teams?.find((x) => low(x.name) === low(t.name));
      if (!tr) problems.push(`Project ${t.project} wasn't read in the last inventory`);
      else if (!tr.teams) problems.push(tr.teamsProblem ?? `The teams of ${t.project} couldn't be read`);
      else if (!team) problems.push(`Team ${t.name} isn't in ${t.project} any more`);
      else if (team.otherField) problems.push(`Team ${t.name} uses its own field, not area paths, so it can't be matched here`);
      else rules.push(...team.areas);
    }
    return { match: (r) => inArea(r.area, rules), problems, rules };
  }
  for (const a of scope.areas) {
    const tr = trees.find((t) => low(a.path).split("\\")[0] === low(t.root ?? t.project)) ?? null;
    if (tr && !tr.areasProblem && tr.paths.length && !tr.paths.some((p) => low(p) === low(a.path))) problems.push(`Area ${a.path} isn't in the project any more`);
  }
  return { match: (r) => inArea(r.area, scope.areas), problems };
}

/**
 * WP-2 review: the scope a finished inventory used, as a test for one row. A teams scope is matched by the area rules
 * the teams stood for then (kept in the snapshot), so a team renamed or unreadable later doesn't empty it.
 */
export function usedMatcher(scope: AnalysisScope, teamAreas: readonly AreaRule[] | undefined, trees: readonly ProjectTree[]): (r: Pick<LayoutRow, "project" | "area">) => boolean {
  if (scope.kind === "teams" && teamAreas) return (r) => inArea(r.area, [...teamAreas]);
  return matcherOf(scope, trees).match;
}

/** Where a client's scope comes from for the next run. */
export type ScopeChoice =
  | { scope: AnalysisScope; source: "page" | "admin" | "one area"; words: string }
  | { scope: null; source: null; words: string };

/**
 * The scope the next run uses: the page's own when set; else Admin › Clients' when it names teams or area paths (in the
 * client's main project); else the whole project when it has only one area. Otherwise none: the page says what Admin ›
 * Clients has and asks for a choice (a whole project with several areas is never read without a person confirming it).
 */
export function scopeChoice(o: { page: AnalysisScope | null; admin: DevOpsScope | null; mainProject: string | null; layout: Layout | null }): ScopeChoice {
  if (o.page) return { scope: o.page, source: "page", words: "Set on this page" };
  if (o.admin && o.mainProject && o.admin.kind === "teams") return { scope: { kind: "teams", teams: o.admin.teams.map((name) => ({ project: o.mainProject!, name })) }, source: "admin", words: "From Admin › Clients" };
  if (o.admin && o.admin.kind === "areas") return { scope: { kind: "areas", areas: o.admin.areas }, source: "admin", words: "From Admin › Clients" };
  const admin = !o.admin ? "Admin › Clients says Automatic" : "Admin › Clients says Whole project";
  const projects = o.layout?.projects ?? [];
  if (o.mainProject && projects.length <= 1 && (projects[0]?.oneArea ?? false)) return { scope: { kind: "whole", projects: [projects[0]?.project ?? o.mainProject] }, source: "one area", words: `${admin}, and the project has only one area` };
  if (!o.layout) return { scope: null, source: null, words: `${admin}. Run inventory to see the project's layout, then choose the part that is Cooptimize's work.` };
  return { scope: null, source: null, words: `${admin}. The project has more than one area: choose the part that is Cooptimize's BI and analytics work.` };
}

/** Plain words for a scope, AH-2's way. Without names (a download, for a client the person isn't on): kinds and counts. */
export function analysisScopeWords(scope: AnalysisScope | null, o: { names: boolean } = { names: true }): string {
  if (!scope) return "No scope chosen";
  const n = (k: number, one: string, many: string) => (k === 1 ? `1 ${one}` : `${k} ${many}`);
  if (scope.kind === "whole") return scope.projects.length === 1 ? (o.names ? `Whole project ${scope.projects[0]}` : "Whole project") : o.names ? `Whole projects ${scope.projects.join(", ")}` : `Whole projects (${scope.projects.length})`;
  if (scope.kind === "teams") return o.names ? (scope.teams.length === 1 ? `Team ${scope.teams[0]!.name}` : `Teams ${scope.teams.map((t) => t.name).join(", ")}`) : n(scope.teams.length, "team", "teams");
  if (!o.names) return n(scope.areas.length, "area path", "area paths");
  return scope.areas.map((a) => `Area ${a.path}${a.sub ? " and sub-areas" : ""}`).join("; ");
}

export const sameScope = (a: AnalysisScope | null, b: AnalysisScope | null): boolean => JSON.stringify(normal(a)) === JSON.stringify(normal(b));
function normal(s: AnalysisScope | null) {
  if (!s) return null;
  if (s.kind === "whole") return { kind: s.kind, projects: s.projects.map(low).sort() };
  if (s.kind === "teams") return { kind: s.kind, teams: s.teams.map((t) => `${low(t.project)}/${low(t.name)}`).sort() };
  return { kind: s.kind, areas: s.areas.map((a) => `${low(a.path)}:${a.sub}`).sort() };
}

export class AnalysisScopeError extends Error {}
const MAX = 50;

/** The page's input, checked. */
export function parseAnalysisScope(v: unknown): AnalysisScope {
  const fail = (m: string): never => {
    throw new AnalysisScopeError(m);
  };
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail("A scope is { kind: whole, projects }, { kind: teams, teams } or { kind: areas, areas }");
  const name = (s: unknown, what: string) => (typeof s === "string" && s.trim() && s.trim().length <= 256 && !/[\u0000-\u001f]/.test(s) ? s.trim() : fail(`${what} must be a name up to 256 characters`));
  const list = (x: unknown, what: string) => (Array.isArray(x) && x.length && x.length <= MAX ? x : fail(`Choose 1 to ${MAX} ${what}`));
  const keys = (allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k)) || fail("Unknown field in the scope");
  if (o.kind === "whole") {
    keys(["kind", "projects"]);
    return { kind: "whole", projects: [...new Map(list(o.projects, "projects").map((p) => name(p, "A project")).map((p) => [low(p), p])).values()] };
  }
  if (o.kind === "teams") {
    keys(["kind", "teams"]);
    const teams = list(o.teams, "teams").map((t) => {
      const r = t && typeof t === "object" ? (t as Record<string, unknown>) : fail("A team is { project, name }");
      return { project: name(r.project, "A project"), name: name(r.name, "A team") };
    });
    return { kind: "teams", teams: [...new Map(teams.map((t) => [`${low(t.project)}/${low(t.name)}`, t])).values()] };
  }
  if (o.kind === "areas") {
    keys(["kind", "areas"]);
    const areas = list(o.areas, "area paths").map((a) => {
      const r = a && typeof a === "object" ? (a as Record<string, unknown>) : fail("An area is { path, sub }");
      if (typeof r.sub !== "boolean") fail("Say whether an area includes its sub-areas");
      return { path: name(r.path, "An area path"), sub: r.sub as boolean };
    });
    return { kind: "areas", areas: [...new Map(areas.map((a) => [low(a.path), a])).values()] };
  }
  return fail("A scope is { kind: whole, projects }, { kind: teams, teams } or { kind: areas, areas }");
}
