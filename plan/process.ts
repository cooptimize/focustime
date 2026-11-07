// WT-1: the DevOps process model per project, pure. Types, levels, state categories and what each type means for
// planning come from the project's own configuration (team backlogs, bugs behavior, work item types and their states),
// never from type or state names. This is the one module that decides open, resolved and closed, which level a type sits
// at, which child types a parent takes, and whether a parent type needs breaking down. No I/O.
import type { TypeLook } from "../week/types.ts";

/** A DevOps state category (work item type states API). Anything else reads as Unknown, which counts as open. */
export type StateCategory = "Proposed" | "InProgress" | "Resolved" | "Completed" | "Removed";
const CATEGORIES: readonly string[] = ["Proposed", "InProgress", "Resolved", "Completed", "Removed"];

/**
 * One rule everywhere (WT-1, D532): open = Proposed or In Progress (counts against hours, on planning lists);
 * resolved = Resolved (no hours left, off planning lists, a small Resolved marker, done for Roadmap progress, not closed);
 * closed = Completed or Removed. An unknown category counts as open, so nothing disappears by accident.
 */
export type Bucket = "open" | "resolved" | "closed";
export const bucketOf = (category: string | null | undefined): Bucket => (category === "Resolved" ? "resolved" : category === "Completed" || category === "Removed" ? "closed" : "open");
export const isOpen = (category: string | null | undefined) => bucketOf(category) === "open";
export const isResolved = (category: string | null | undefined) => bucketOf(category) === "resolved";
export const isClosed = (category: string | null | undefined) => bucketOf(category) === "closed";
/** Done for progress (Roadmap, Plan ahead): resolved or completed. Removed work is out of the count. */
export const countsAsDone = (category: string | null | undefined) => category === "Resolved" || category === "Completed";
export const isRemoved = (category: string | null | undefined) => category === "Removed";
export const isCompleted = (category: string | null | undefined) => category === "Completed";
export const isProposed = (category: string | null | undefined) => category === "Proposed";
/** The categories a write may move an item to as "done" or "removed" (the write framework). */
export const COMPLETED: StateCategory = "Completed";
export const REMOVED: StateCategory = "Removed";

/** Levels from the backlog configuration: top (every portfolio level above the lowest), parent, child, task. */
export type ProcessLevel = "top" | "parent" | "child" | "task";
export type BugsBehavior = "off" | "asRequirements" | "asTasks";

export type TypeState = { name: string; category: string; color: string | null };
export type BreakdownHistory = { items: number; withChildren: number; share: number | null };
export type ProcessType = {
  name: string;
  /** DevOps icon id (icon_crown, icon_book, ...). FocusTime draws its own icon for it; never the DevOps image. */
  icon: string | null;
  /** The project's color for the type, hex without #. */
  color: string | null;
  level: ProcessLevel | null;
  states: TypeState[];
  /** The types one level down (the next backlog level). */
  validChildren: string[];
  /** The most common child type in this project's history, else the next level's default type. */
  defaultChild: string | null;
  /** Parent and top level: on by default; off when an override says so. Child and task level: false. */
  needsBreakdown: boolean;
  breakdownSource: "default" | "override" | "level";
  /** Information for Admin: the share of this type's items past Proposed in the last 12 months that have children. */
  history: BreakdownHistory | null;
  /** Counts against hours: true unless the type is on the background list. */
  countsHours: boolean;
  /** A bug type: a bug assigned to me is always at child level, even when the team has bugs off. */
  bug: boolean;
};
export type ProcessModel = {
  org: string;
  project: string;
  process: string | null;
  fetchedAt: string;
  /** Top-down; top may hold several backlog levels (each its own list). */
  ladder: string[][];
  levels: Record<ProcessLevel, string[]>;
  bugsBehavior: BugsBehavior | null;
  types: ProcessType[];
  /** States defaulted to open (WT-1: states named like "Blocked" that DevOps maps to Removed). */
  defaultOpenStates: { type: string; state: string }[];
};

/** A client's overrides: its Rules in Admin › Clients (ADM-1). Type names match without case. */
export type ProcessOverrides = {
  /** Parent or top level types that don't need breakdown (and so can be picked). */
  noBreakdown?: readonly string[];
  /** Types that don't count against hours ("background" types). */
  background?: readonly string[];
};

// ---- Building the model from DevOps responses (already fetched; this only reads them) ----

type Ref = { name?: unknown } | null | undefined;
const nameOf = (r: Ref) => (typeof r?.name === "string" ? r.name : null);
const namesOf = (list: unknown): string[] => (Array.isArray(list) ? (list as Ref[]).map(nameOf).filter((n): n is string => !!n) : []);
type RawLevel = { type: "portfolio" | "requirement" | "task"; rank: number; types: string[]; default: string | null };

/** Team backlogs (`{team}/_apis/work/backlogs`, rank: higher is higher up). */
function fromTeamBacklogs(raw: unknown): RawLevel[] | null {
  const list = (raw as { value?: unknown } | null)?.value;
  if (!Array.isArray(list) || !list.length) return null;
  const out: RawLevel[] = [];
  for (const b of list as { type?: unknown; rank?: unknown; workItemTypes?: unknown; defaultWorkItemType?: Ref }[]) {
    const type = b.type === "portfolio" || b.type === "requirement" || b.type === "task" ? b.type : null;
    if (!type || typeof b.rank !== "number") continue;
    out.push({ type, rank: b.rank, types: namesOf(b.workItemTypes), default: nameOf(b.defaultWorkItemType) });
  }
  return out.length ? out : null;
}

/** Process configuration (`_apis/work/processconfiguration`): portfolio backlogs listed top-down. The fallback. */
function fromProcessConfig(raw: unknown, bugs: BugsBehavior | null): RawLevel[] {
  const pc = (raw ?? {}) as { portfolioBacklogs?: unknown; requirementBacklog?: { workItemTypes?: unknown; defaultWorkItemType?: Ref }; taskBacklog?: { workItemTypes?: unknown; defaultWorkItemType?: Ref }; bugWorkItems?: { workItemTypes?: unknown } };
  const portfolio = (Array.isArray(pc.portfolioBacklogs) ? pc.portfolioBacklogs : []) as { workItemTypes?: unknown; defaultWorkItemType?: Ref }[];
  const bugTypes = namesOf(pc.bugWorkItems?.workItemTypes);
  const req = namesOf(pc.requirementBacklog?.workItemTypes);
  const task = namesOf(pc.taskBacklog?.workItemTypes);
  return [
    ...portfolio.map((b, i) => ({ type: "portfolio" as const, rank: 100 - i, types: namesOf(b.workItemTypes), default: nameOf(b.defaultWorkItemType) })),
    // Bugs behavior unknown (no team settings): bugs stay with requirements, as before WT-1.
    { type: "requirement" as const, rank: 2, types: [...req, ...(bugs === "asRequirements" || bugs === null ? bugTypes.filter((t) => !req.includes(t)) : [])], default: nameOf(pc.requirementBacklog?.defaultWorkItemType) },
    { type: "task" as const, rank: 1, types: [...task, ...(bugs === "asTasks" ? bugTypes.filter((t) => !task.includes(t)) : [])], default: nameOf(pc.taskBacklog?.defaultWorkItemType) },
  ];
}

export const bugsBehaviorOf = (teamSettings: unknown): BugsBehavior | null => {
  const b = (teamSettings as { bugsBehavior?: unknown } | null)?.bugsBehavior;
  return b === "off" || b === "asRequirements" || b === "asTasks" ? b : null;
};

/** The bug category's types from process configuration (bugWorkItems). */
export const bugTypesOf = (processConfig: unknown): string[] => namesOf((processConfig as { bugWorkItems?: { workItemTypes?: unknown } } | null)?.bugWorkItems?.workItemTypes);

const BLOCKED = /\bblocked\b/i;

export type RawProcess = {
  org: string;
  project: string;
  process?: string | null;
  fetchedAt: string;
  /** `{team}/_apis/work/backlogs` for the default team, or null when it couldn't be read. */
  teamBacklogs?: unknown;
  /** `_apis/work/processconfiguration`: the fallback for levels, and the bug category. */
  processConfig?: unknown;
  /** `{team}/_apis/work/teamsettings`. */
  teamSettings?: unknown;
  /** `_apis/wit/workitemtypes`, each with its states (from the list or the per-type states call). */
  types: { name?: unknown; icon?: { id?: unknown } | null; color?: unknown; isDisabled?: unknown; states?: unknown }[];
  /** Per parent or top type: items past Proposed in the last 12 months, how many have children, child type counts. */
  history?: Record<string, { items: number; withChildren: number; childTypes?: Record<string, number> }>;
};

const ci = (list: readonly string[] | undefined) => new Set((list ?? []).map((s) => s.toLowerCase()));

export function buildProcessModel(raw: RawProcess, o: ProcessOverrides = {}): ProcessModel {
  const bugsBehavior = bugsBehaviorOf(raw.teamSettings);
  const levelsRaw = fromTeamBacklogs(raw.teamBacklogs) ?? fromProcessConfig(raw.processConfig, bugsBehavior);
  const portfolio = levelsRaw.filter((l) => l.type === "portfolio" && l.types.length).sort((a, b) => b.rank - a.rank);
  const req = levelsRaw.filter((l) => l.type === "requirement").flatMap((l) => l.types);
  const task = levelsRaw.filter((l) => l.type === "task").flatMap((l) => l.types);
  const ladder = [...portfolio.map((l) => [...l.types]), req, task];
  const defaults = [...portfolio.map((l) => l.default), levelsRaw.find((l) => l.type === "requirement")?.default ?? null, levelsRaw.find((l) => l.type === "task")?.default ?? null];
  const levels: Record<ProcessLevel, string[]> = { top: portfolio.slice(0, -1).flatMap((l) => l.types), parent: portfolio.at(-1)?.types ?? [], child: req, task };
  const levelOfName = (n: string): ProcessLevel | null => (levels.parent.includes(n) ? "parent" : levels.top.includes(n) ? "top" : levels.child.includes(n) ? "child" : levels.task.includes(n) ? "task" : null);
  const rung = (n: string) => ladder.findIndex((r) => r.includes(n));
  const bugTypes = new Set(bugTypesOf(raw.processConfig));
  const noBreakdown = ci(o.noBreakdown);
  const background = ci(o.background);
  const defaultOpen: { type: string; state: string }[] = [];
  const types: ProcessType[] = [];
  for (const t of raw.types) {
    const name = typeof t.name === "string" ? t.name : null;
    if (!name || t.isDisabled === true) continue;
    const states: TypeState[] = (Array.isArray(t.states) ? (t.states as { name?: unknown; category?: unknown; color?: unknown }[]) : [])
      .filter((s): s is { name: string; category: string; color?: unknown } => typeof s.name === "string" && typeof s.category === "string")
      .map((s) => ({ name: s.name, category: CATEGORIES.includes(s.category) ? s.category : "Unknown", color: typeof s.color === "string" ? s.color : null }));
    for (const s of states) if (s.category === "Removed" && BLOCKED.test(s.name)) defaultOpen.push({ type: name, state: s.name });
    const level = levelOfName(name);
    const i = rung(name);
    const validChildren = i >= 0 && i + 1 < ladder.length ? [...ladder[i + 1]!] : [];
    const h = raw.history?.[name];
    const counts = h?.childTypes ?? {};
    const common = validChildren.filter((c) => (counts[c] ?? 0) > 0).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))[0];
    const nextDefault = i >= 0 ? (defaults[i + 1] ?? null) : null;
    const portfolioLevel = level === "top" || level === "parent";
    const off = portfolioLevel && noBreakdown.has(name.toLowerCase());
    types.push({
      name,
      icon: typeof t.icon?.id === "string" ? t.icon.id : null,
      color: typeof t.color === "string" && /^[0-9a-f]{6}$/i.test(t.color) ? t.color : null,
      level,
      states,
      validChildren,
      defaultChild: common ?? (nextDefault && validChildren.includes(nextDefault) ? nextDefault : (validChildren[0] ?? null)),
      needsBreakdown: portfolioLevel && !off,
      breakdownSource: !portfolioLevel ? "level" : off ? "override" : "default",
      history: h ? { items: h.items, withChildren: h.withChildren, share: h.items ? Math.round((100 * h.withChildren) / h.items) : null } : null,
      countsHours: !background.has(name.toLowerCase()),
      bug: bugTypes.has(name),
    });
  }
  return { org: raw.org, project: raw.project, process: raw.process ?? null, fetchedAt: raw.fetchedAt, ladder, levels, bugsBehavior, types, defaultOpenStates: defaultOpen };
}

// ---- Reading the model ----

export const typeOf = (m: ProcessModel, name: string): ProcessType | undefined => m.types.find((t) => t.name === name) ?? m.types.find((t) => t.name.toLowerCase() === name.toLowerCase());
export const levelOfType = (m: ProcessModel, name: string): ProcessLevel | null => typeOf(m, name)?.level ?? null;

/** Pickable: child and task level, plus parent or top types that don't need breakdown. */
export function pickableTypes(m: ProcessModel): Set<string> {
  return new Set(m.types.filter((t) => t.level === "child" || t.level === "task" || ((t.level === "top" || t.level === "parent") && !t.needsBreakdown)).map((t) => t.name));
}

/**
 * The existing planning shapes from the model: story level (what can be picked) and portfolio (what can't), and the
 * portfolio tiers (feature = the parent level, epic = the top level). Unknown levels mean no backlog configuration.
 */
export function planningLevels(m: ProcessModel): { known: boolean; story: Set<string>; portfolio: Set<string>; tiers: { feature: Set<string>; epic: Set<string> } } {
  const story = pickableTypes(m);
  const portfolio = new Set([...m.levels.top, ...m.levels.parent].filter((t) => !story.has(t)));
  return { known: story.size > 0 || portfolio.size > 0, story, portfolio, tiers: { feature: new Set(m.levels.parent), epic: new Set(m.levels.top) } };
}

/** type → (lowercased state name → category), with the given states (and the model's defaults) treated as open. */
export function stateCategories(m: ProcessModel, openStates: readonly string[] = []): Map<string, Map<string, string>> {
  const wanted = new Set([...openStates.map((s) => s.toLowerCase()), ...m.defaultOpenStates.map((d) => d.state.toLowerCase())]);
  return new Map(m.types.map((t) => [t.name, new Map(t.states.map((s) => [s.name.toLowerCase(), wanted.has(s.name.toLowerCase()) && !isOpen(s.category) ? "InProgress" : s.category]))]));
}

/** The first state of a type in a category (Completed for Mark done, Removed for undoing a create). */
export const stateIn = (states: readonly { name: string; category: string }[], category: StateCategory) => states.find((s) => s.category === category)?.name ?? null;

/** A type's look for the UI (icon, color, level, whether it counts against hours, whether it needs breakdown). */
export type { TypeLook };
export const looksOf = (m: ProcessModel): TypeLook[] => m.types.map((t) => ({ name: t.name, icon: t.icon, color: t.color, level: t.level, countsHours: t.countsHours, needsBreakdown: t.needsBreakdown, defaultChild: t.defaultChild }));

/** ADM-1 reads this: one line per type, plain. "Recurring: 75% broken down, 12 items". */
export function breakdownText(t: Pick<ProcessType, "name" | "history">): string | null {
  const h = t.history;
  if (!h) return null;
  if (!h.items) return `${t.name}: no items past Proposed in the last 12 months`;
  return `${t.name}: ${h.share}% broken down, ${h.items} ${h.items === 1 ? "item" : "items"}`;
}

/**
 * The write path reads only process configuration (with the person's write PAT): the levels from it, and the child
 * types a parent type takes. No team backlogs there, so bugs sit where process configuration says.
 */
export function levelsFromProcessConfig(pc: unknown): { levels: Record<ProcessLevel, string[]>; tiers: { feature: Set<string>; epic: Set<string> }; childrenOf: (type: string) => string[] } {
  const m = buildProcessModel({ org: "", project: "", fetchedAt: "", processConfig: pc, types: [] });
  const childrenOf = (type: string) => {
    const i = m.ladder.findIndex((r) => r.includes(type));
    return i >= 0 && i + 1 < m.ladder.length ? [...m.ladder[i + 1]!] : [];
  };
  return { levels: m.levels, tiers: { feature: new Set(m.levels.parent), epic: new Set(m.levels.top) }, childrenOf };
}

/** AH-1: the backlog ladder (top-down) from process configuration alone (the write path), for one-level-down rights. */
export const ladderFromProcessConfig = (pc: unknown): string[][] => buildProcessModel({ org: "", project: "", fetchedAt: "", processConfig: pc, types: [] }).ladder;

/**
 * BD-1: the child types Break down may create under a parent type, from process configuration alone (the write path):
 * the next level's types when the parent sits at parent or top level and no override turns breakdown off; else none.
 */
export function breakdownChildTypes(pc: unknown, parentType: string, o: ProcessOverrides = {}): string[] {
  const l = levelsFromProcessConfig(pc);
  const portfolio = l.levels.parent.includes(parentType) || l.levels.top.includes(parentType);
  if (!portfolio || ci(o.noBreakdown).has(parentType.toLowerCase())) return [];
  return l.childrenOf(parentType);
}

/** Whether a type needs breakdown, from the type looks a DevOps read carries; unknown (older caches) counts as yes. */
export const typeNeedsBreakdown = (types: readonly TypeLook[] | undefined, name: string): boolean => types?.find((t) => t.name === name)?.needsBreakdown ?? true;
/** Whether a type counts against hours, from the type looks; unknown counts. */
export const typeCountsHours = (types: readonly TypeLook[] | undefined, name: string | null | undefined): boolean => !name || (types?.find((t) => t.name === name)?.countsHours ?? true);

/**
 * WT-1: a counter for weekBudget and Plan the day's fit: does an item of this type count against hours for this client?
 * Reads each client's type looks; anything unknown counts.
 */
export const countsFor = (work: Iterable<{ clientKey: string; types?: readonly TypeLook[] }> | null | undefined) => {
  const by = new Map<string, readonly TypeLook[] | undefined>();
  for (const w of work ?? []) by.set(w.clientKey, w.types);
  return (clientKey: string, itemType: string | null | undefined) => typeCountsHours(by.get(clientKey), itemType);
};

/** A state category in plain words for a preview: "proposed", "in progress", "resolved", "completed", "removed". */
export const categoryWord = (category: string): string => (category === "InProgress" ? "in progress" : category.toLowerCase());
