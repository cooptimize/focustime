// Pure: Azure DevOps responses → WorkItem. No I/O, no PATs.
import { isBlocked } from "../../plan/followups.ts";
import { isClosed, levelsFromProcessConfig } from "../../plan/process.ts";
import type { WorkItem } from "../../week/types.ts";
import { NEUTRAL_ZONE } from "../../week/zone.ts";

/** type → (lowercased state name → state category). From each project's process model (plan/process.ts). */
export type StateCategories = Map<string, Map<string, string>>;

type StateColor = { name?: unknown; category?: unknown };

/** The categories of each type's states (lowercased names), as read from the work item types API. */
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

/** Story-level and portfolio types from the project's process model, not type names. */
export type BacklogLevels = { known: boolean; story: ReadonlySet<string>; portfolio: ReadonlySet<string> };

/**
 * The planning levels from process configuration alone (the fallback when team backlogs can't be read, and the write
 * path): story level = child and task levels; portfolio = the levels above. Unknown when it lists no backlogs.
 */
export function backlogLevels(processConfig: unknown): BacklogLevels {
  const { levels } = levelsFromProcessConfig(processConfig);
  const story = new Set([...levels.child, ...levels.task]);
  const portfolio = new Set([...levels.top, ...levels.parent].filter((t) => !story.has(t)));
  return { known: story.size > 0 || portfolio.size > 0, story, portfolio };
}

/** Plan the week (step 8): the feature tier is the parent level (lowest portfolio backlog), the epic tier everything above. */
export const portfolioTiers = (processConfig: unknown): { feature: Set<string>; epic: Set<string> } => levelsFromProcessConfig(processConfig).tiers;

export type FieldInfo = { referenceName?: unknown; name?: unknown; type?: unknown };

const TARGET_FIELD = "Microsoft.VSTS.Scheduling.TargetDate";
/** Step 17: the standard Start Date (Agile, Scrum, CMMI portfolio types have it; a custom process may not). */
export const START_DATE_FIELD = "Microsoft.VSTS.Scheduling.StartDate";
/** Names a client process may give its target date, best first. */
const TARGET_NAMES = [/\btarget\b/i, /estimated\s+(completion|end|finish|delivery)/i, /\bdue\b/i, /\b(finish|delivery|go-?live)\s+date\b/i];
/** Dates that record what happened, never a promise. */
const SYSTEM_DATES = /^(System\.|Microsoft\.VSTS\.Common\.(Closed|Resolved|Activated|StateChange)Date)/;

/**
 * A process's target date field for a type: the standard TargetDate when the type has it, else the first date field
 * the type has whose name reads like a target (Estimated Completion, Due Date). Null when there is none (step 8).
 */
export function detectTargetField(fields: readonly FieldInfo[], typeHas: ReadonlySet<string>): string | null {
  const dates = fields.filter((f): f is { referenceName: string; name: string; type: string } => typeof f.referenceName === "string" && typeof f.name === "string" && f.type === "dateTime" && typeHas.has(f.referenceName) && !SYSTEM_DATES.test(f.referenceName));
  if (dates.some((f) => f.referenceName === TARGET_FIELD)) return TARGET_FIELD;
  for (const re of TARGET_NAMES) {
    const hit = dates.find((f) => re.test(f.name) && !/start/i.test(f.name));
    if (hit && /^[A-Za-z][\w.]*$/.test(hit.referenceName)) return hit.referenceName;
  }
  return null;
}

/** Step 16 (D279): the size field on stories, by process: Story Points (Agile), Effort (Scrum, Basic), Size (CMMI). */
export const SIZE_FIELDS = ["Microsoft.VSTS.Scheduling.StoryPoints", "Microsoft.VSTS.Scheduling.Effort", "Microsoft.VSTS.Scheduling.Size"] as const;
export function detectSizeField(fields: readonly FieldInfo[]): string | null {
  const have = new Set(fields.map((f) => f.referenceName).filter((r): r is string => typeof r === "string"));
  return SIZE_FIELDS.find((r) => have.has(r)) ?? null;
}

/**
 * AH-1 (D653): a type's own size field, from the fields that type has, in this order: Story Points, Effort, Size,
 * Original Estimate. Null when the type has none of them. The value is the field's own number (no conversion).
 */
export const TYPE_SIZE_FIELDS = [...SIZE_FIELDS.slice(0, 2), SIZE_FIELDS[2], "Microsoft.VSTS.Scheduling.OriginalEstimate"] as const;
export function detectTypeSizeField(typeHas: ReadonlySet<string>): string | null {
  return TYPE_SIZE_FIELDS.find((r) => typeHas.has(r)) ?? null;
}
/** The display names of the given fields from the project's field list ("Story Points"); the reference name when unknown. */
export function fieldNames(fields: readonly FieldInfo[], refs: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of refs) {
    const f = fields.find((x) => x.referenceName === r);
    out[r] = typeof f?.name === "string" && f.name.trim() ? f.name.trim().slice(0, 80) : r;
  }
  return out;
}

/** A DevOps date field as a calendar date: stored at midnight UTC, that date; else the date in the local zone. */
export function dateOnly(value: unknown, timeZone: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const i = Temporal.Instant.from(value);
    const utc = i.toZonedDateTimeISO("UTC");
    if (utc.hour === 0 && utc.minute === 0) return utc.toPlainDate().toString();
    return i.toZonedDateTimeISO(timeZone).toPlainDate().toString();
  } catch {
    return null;
  }
}

/** Every child of the given parents, in any state and for any assignee, in board order (step 8). */
export function buildAllChildrenWiql(parentIds: number[], orderField: string | null): string {
  const ids = parentIds.filter((id) => Number.isInteger(id) && id > 0);
  const order = orderField ? `[${orderField}] ASC, [System.Id] ASC` : `[System.ChangedDate] DESC`;
  return `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Parent] IN (${ids.join(", ")}) ORDER BY ${order}`;
}

/** DV-1: how far back closed items are kept in the store (Roadmap's pace and done counts read them). */
export const CLOSED_KEEP_DAYS = 90;

/**
 * DV-1: the store's scope in the client's projects: open items of the types the process knows (per type, states
 * outside a Completed or Removed category), and anything changed in the last 90 days. One query for all projects.
 */
export function buildScopeWiql(projects: readonly string[], categories: StateCategories): string {
  const open: string[] = [];
  for (const [type, states] of [...categories.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const done = [...states.entries()].filter(([, c]) => isClosed(c)).map(([n]) => n);
    const t = `[System.WorkItemType] = ${wiqlString(type)}`;
    open.push(done.length ? `(${t} AND [System.State] NOT IN (${done.map(wiqlString).join(", ")}))` : `(${t})`);
  }
  const keep = `[System.ChangedDate] >= @today - ${CLOSED_KEEP_DAYS}`;
  return `SELECT [System.Id] FROM WorkItems WHERE ${projectClause(projects)} AND (${[...open, keep].join(" OR ")})`;
}

/** DV-1: items changed at or after an instant (UTC, to the second; the query runs with timePrecision). */
export function buildChangedWiql(projects: readonly string[], since: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(since)) throw new Error("since must be an instant to the second, in UTC");
  return `SELECT [System.Id] FROM WorkItems WHERE ${projectClause(projects)} AND [System.ChangedDate] >= '${since}' ORDER BY [System.ChangedDate] ASC`;
}

const projectClause = (projects: readonly string[]) => (projects.length === 1 ? `[System.TeamProject] = ${wiqlString(projects[0]!)}` : `[System.TeamProject] IN (${projects.map(wiqlString).join(", ")})`);

/** A DevOps HTML field (a description) as plain text with simple bullets, at most 4000 characters (step 8). */
export function htmlToText(html: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (named[e.toLowerCase()] ?? m)))
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join("\n")
    .trim()
    .slice(0, 4000);
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
    const done = [...states.entries()].filter(([, c]) => isClosed(c)).map(([n]) => n);
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

// System.Tags (step 7): a "Blocked" tag opens a follow-up (plan/followups.ts). System.ChangedBy (step 8, Q42): reduced to
// changedByMe at once; nobody's identity is kept.
export const BASE_FIELDS = ["System.Id", "System.Title", "System.WorkItemType", "System.State", "System.Parent", "System.ChangedDate", "System.Tags", "System.ChangedBy"] as const;

/** The email in an identity field: an IdentityRef's uniqueName, or "Name <email>" text. Lowercased; null when absent. */
export function identityEmail(v: unknown): string | null {
  if (typeof v === "string") return (v.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? (v.includes("@") ? v.trim() : null))?.toLowerCase() ?? null;
  const u = (v as { uniqueName?: unknown } | null)?.uniqueName;
  return typeof u === "string" && u.includes("@") ? u.trim().toLowerCase() : null;
}

/** An identity field's display name (for assignees shown in Plan the week). Never the email. */
export function identityName(v: unknown): string | null {
  if (typeof v === "string") return v.replace(/\s*<[^>]*>\s*$/, "").trim() || null;
  const n = (v as { displayName?: unknown } | null)?.displayName;
  return typeof n === "string" && n.trim() ? n.trim().slice(0, 100) : null;
}

export function batchFields(orderField: string | null): string[] {
  return orderField ? [...BASE_FIELDS, orderField] : [...BASE_FIELDS];
}

export type NormalizeContext = {
  org: string;
  projectName: string;
  orderField: string | null;
  categories: StateCategories;
  levels?: BacklogLevels;
  /** Step 13.6 (D243): portfolio tiers (portfolioTiers), so a portfolio item says whether it is a feature or an epic. */
  tiers?: { feature: ReadonlySet<string>; epic: ReadonlySet<string> };
  /** Keep completed and removed items (items read by id for a follow-up, step 7). */
  keepDone?: boolean;
  /** My DevOps identity (email) for this client, to tell my own changes (Q42). */
  me?: string | null;
  /** Keep the assignee's display name and whether it's me (Plan the week). Emails are never kept. */
  people?: boolean;
  /** The target date field per type (Plan the week), and the zone its dates are read in. */
  targetFields?: Readonly<Record<string, string>>;
  /** Step 17: the Start Date field per type, when the process has it. */
  startFields?: Readonly<Record<string, string>>;
  timeZone?: string;
  /** Roadmap (step 16): the size field to read into `size`. */
  sizeField?: string | null;
  /** Step 15.3: read area and iteration paths. */
  paths?: boolean;
};

/** Step 15.3: the acceptance criteria field (stories), written by Create in DevOps when the type has it. */
export const ACCEPTANCE_FIELD = "Microsoft.VSTS.Common.AcceptanceCriteria";

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
    if (isClosed(category) && !ctx.keepDone) continue;
    const rawOrder = ctx.orderField ? f[ctx.orderField] : null;
    // "a; b" in DevOps; absent when the item has none.
    const tags = typeof f["System.Tags"] === "string" ? (f["System.Tags"] as string).split(";").map((t) => t.trim()).filter(Boolean).slice(0, 50) : [];
    const parent = f["System.Parent"];
    const title = typeof f["System.Title"] === "string" && f["System.Title"].trim() ? (f["System.Title"] as string) : "(No title)";
    items.push({
      id,
      title,
      type,
      state,
      stateCategory: category,
      level: levelOf(type, ctx.levels ?? NO_LEVELS),
      ...(ctx.tiers && levelOf(type, ctx.levels ?? NO_LEVELS) === "portfolio" && (ctx.tiers.feature.has(type) || ctx.tiers.epic.has(type)) ? { tier: ctx.tiers.feature.has(type) ? ("feature" as const) : ("epic" as const) } : {}),
      order: typeof rawOrder === "number" && Number.isFinite(rawOrder) ? rawOrder : null,
      parentId: typeof parent === "number" && Number.isInteger(parent) ? parent : null,
      changedAt: typeof f["System.ChangedDate"] === "string" ? (f["System.ChangedDate"] as string) : "",
      url: workItemUrl(ctx.org, ctx.projectName, id),
      tags,
      blocked: isBlocked(state, tags),
      changedByMe: !!ctx.me && identityEmail(f["System.ChangedBy"]) === ctx.me.toLowerCase(),
      ...(ctx.people ? { assignedTo: identityName(f["System.AssignedTo"]), assignedToEmail: identityEmail(f["System.AssignedTo"]), assignedToMe: !!ctx.me && identityEmail(f["System.AssignedTo"]) === ctx.me.toLowerCase() } : {}),
      ...(ctx.targetFields?.[type] ? { targetDate: dateOnly(f[ctx.targetFields[type]!], ctx.timeZone ?? NEUTRAL_ZONE) } : {}),
      ...(ctx.startFields?.[type] ? { startDate: dateOnly(f[ctx.startFields[type]!], ctx.timeZone ?? NEUTRAL_ZONE) } : {}),
      ...(ctx.paths ? { areaPath: typeof f["System.AreaPath"] === "string" ? (f["System.AreaPath"] as string) : null, iterationPath: typeof f["System.IterationPath"] === "string" ? (f["System.IterationPath"] as string) : null } : {}),
      ...(ctx.sizeField ? { size: typeof f[ctx.sizeField] === "number" && Number.isFinite(f[ctx.sizeField]) ? (f[ctx.sizeField] as number) : null } : {}),
    });
  }
  items.sort(byBoardOrder);
  return { items, skipped };
}
