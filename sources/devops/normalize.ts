// Pure: Azure DevOps responses → WorkItem. No I/O, no PATs.
import type { WorkItem } from "../../week/types.ts";

/** type → (lowercased state name → state category). From each project's work item type metadata. */
export type StateCategories = Map<string, Map<string, string>>;

export const DONE_CATEGORIES = new Set(["Completed", "Removed"]);

type StateColor = { name?: unknown; category?: unknown };

export function categoriesFrom(types: { name: string; states: StateColor[] }[]): StateCategories {
  const out: StateCategories = new Map();
  for (const t of types) {
    const m = new Map<string, string>();
    for (const s of t.states) if (typeof s.name === "string" && typeof s.category === "string") m.set(s.name.toLowerCase(), s.category);
    out.set(t.name, m);
  }
  return out;
}

/** The project's board order field from process configuration (typeFields.Order), or null if absent. */
export function detectOrderField(processConfig: unknown): string | null {
  const tf = (processConfig as { typeFields?: Record<string, { referenceName?: unknown }> } | null)?.typeFields;
  if (!tf || typeof tf !== "object") return null;
  const entry = Object.entries(tf).find(([k]) => k.toLowerCase() === "order")?.[1];
  const ref = entry?.referenceName;
  return typeof ref === "string" && /^[A-Za-z][\w.]*$/.test(ref) ? ref : null;
}

/** Story-level and portfolio types from the project's backlog categories (process configuration), not type names. */
export type BacklogLevels = { known: boolean; story: ReadonlySet<string>; portfolio: ReadonlySet<string> };

type Category = { workItemTypes?: { name?: unknown }[] } | null | undefined;
const typesOf = (c: Category): string[] => (Array.isArray(c?.workItemTypes) ? c.workItemTypes.map((t) => t?.name).filter((n): n is string => typeof n === "string") : []);

/**
 * Pickable (story level) = the requirement category, the task category and the bug category.
 * Portfolio (epics, features and any custom portfolio level) can't be picked.
 * When the process configuration has no backlog categories at all, levels are unknown.
 */
export function backlogLevels(processConfig: unknown): BacklogLevels {
  const pc = (processConfig ?? {}) as { requirementBacklog?: Category; taskBacklog?: Category; bugWorkItems?: Category; portfolioBacklogs?: Category[] };
  const story = new Set([...typesOf(pc.requirementBacklog), ...typesOf(pc.taskBacklog), ...typesOf(pc.bugWorkItems)]);
  const portfolio = new Set((Array.isArray(pc.portfolioBacklogs) ? pc.portfolioBacklogs : []).flatMap(typesOf));
  for (const t of story) portfolio.delete(t);
  return { known: story.size > 0 || portfolio.size > 0, story, portfolio };
}

/** Portfolio types listed in config (Q20) count as story level, so they can be picked; matched without case. */
export function allowPortfolio(levels: BacklogLevels, pickable: readonly string[]): BacklogLevels {
  if (pickable.length === 0) return levels;
  const allow = new Set(pickable.map((t) => t.toLowerCase()));
  const moved = [...levels.portfolio].filter((t) => allow.has(t.toLowerCase()));
  if (moved.length === 0) return levels;
  return { known: levels.known, story: new Set([...levels.story, ...moved]), portfolio: new Set([...levels.portfolio].filter((t) => !moved.includes(t))) };
}

/** Unknown levels (no backlog metadata) count as story level, so nothing becomes unpickable by accident. */
export function levelOf(type: string, levels: BacklogLevels): WorkItem["level"] {
  if (!levels.known) return "story";
  if (levels.story.has(type)) return "story";
  if (levels.portfolio.has(type)) return "portfolio";
  return "other";
}

const wiqlString = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * Open work assigned to me in this project: for each type, states not in a Completed or Removed category.
 * Types with no done states match on type alone. State names are per type, so each type gets its own clause.
 */
export function buildWiql(email: string, categories: StateCategories, orderField: string | null): string {
  const clauses: string[] = [];
  for (const [type, states] of [...categories.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const done = [...states.entries()].filter(([, c]) => DONE_CATEGORIES.has(c)).map(([n]) => n);
    const typeClause = `[System.WorkItemType] = ${wiqlString(type)}`;
    clauses.push(done.length ? `(${typeClause} AND [System.State] NOT IN (${done.map(wiqlString).join(", ")}))` : `(${typeClause})`);
  }
  const where = [`[System.TeamProject] = @project`, `[System.AssignedTo] = ${wiqlString(email)}`];
  if (clauses.length) where.push(`(${clauses.join(" OR ")})`);
  const order = orderField ? `[${orderField}] ASC, [System.Id] ASC` : `[System.ChangedDate] DESC`;
  return `SELECT [System.Id] FROM WorkItems WHERE ${where.join(" AND ")} ORDER BY ${order}`;
}

/** Open children of the given parents, any assignee, read through the System.Parent field. */
export function buildChildrenWiql(parentIds: number[], categories: StateCategories, orderField: string | null): string {
  const ids = parentIds.filter((id) => Number.isInteger(id) && id > 0);
  const base = buildWiql("x", categories, orderField);
  // Same open-state clauses as my work, with the parent filter in place of the assignee.
  return base.replace(`[System.AssignedTo] = 'x'`, `[System.Parent] IN (${ids.join(", ")})`);
}

export const BASE_FIELDS = ["System.Id", "System.Title", "System.WorkItemType", "System.State", "System.Parent", "System.ChangedDate"] as const;

export function batchFields(orderField: string | null): string[] {
  return orderField ? [...BASE_FIELDS, orderField] : [...BASE_FIELDS];
}

export type NormalizeContext = { org: string; projectName: string; orderField: string | null; categories: StateCategories; levels?: BacklogLevels };

const NO_LEVELS: BacklogLevels = { known: false, story: new Set(), portfolio: new Set() };

/** Board order first (unset last), then id. */
export function byBoardOrder(a: WorkItem, b: WorkItem): number {
  if (a.order !== b.order) {
    if (a.order === null) return 1;
    if (b.order === null) return -1;
    return a.order - b.order;
  }
  return a.id - b.id;
}

export function workItemUrl(org: string, projectName: string, id: number): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}/_workitems/edit/${id}`;
}

export function normalizeWorkItems(values: unknown[], ctx: NormalizeContext): { items: WorkItem[]; skipped: number } {
  const items: WorkItem[] = [];
  let skipped = 0;
  for (const v of values) {
    const f = (v as { fields?: Record<string, unknown> } | null)?.fields;
    const id = (v as { id?: unknown } | null)?.id;
    if (!f || typeof id !== "number" || !Number.isInteger(id)) {
      skipped++;
      continue;
    }
    const type = typeof f["System.WorkItemType"] === "string" ? (f["System.WorkItemType"] as string) : "";
    const state = typeof f["System.State"] === "string" ? (f["System.State"] as string) : "";
    const category = ctx.categories.get(type)?.get(state.toLowerCase()) ?? "Unknown";
    if (DONE_CATEGORIES.has(category)) continue;
    const rawOrder = ctx.orderField ? f[ctx.orderField] : null;
    const parent = f["System.Parent"];
    const title = typeof f["System.Title"] === "string" && f["System.Title"].trim() ? (f["System.Title"] as string) : "(No title)";
    items.push({
      id,
      title,
      type,
      state,
      stateCategory: category,
      level: levelOf(type, ctx.levels ?? NO_LEVELS),
      order: typeof rawOrder === "number" && Number.isFinite(rawOrder) ? rawOrder : null,
      parentId: typeof parent === "number" && Number.isInteger(parent) ? parent : null,
      changedAt: typeof f["System.ChangedDate"] === "string" ? (f["System.ChangedDate"] as string) : "",
      url: workItemUrl(ctx.org, ctx.projectName, id),
    });
  }
  items.sort(byBoardOrder);
  return { items, skipped };
}
