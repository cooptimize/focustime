// CV-1: the one place FocusTime turns a level (bug, story, feature) into a project's work item type, on WT-1's process
// model (plan/process.ts): levels from backlog configuration, valid children from the next level down, the default
// child from the project's history. Never a type name in code (plan/process-names.test.ts).
import { bugTypesOf, levelsFromProcessConfig, typeOf, type ProcessModel } from "../plan/process.ts";

export type ItemLevel = "bug" | "story" | "feature";

type Cat = { defaultWorkItemType?: { name?: unknown } };
type Pc = { requirementBacklog?: Cat; portfolioBacklogs?: Cat[]; bugWorkItems?: Cat } | null;
const defaultOf = (c: Cat | undefined) => (typeof c?.defaultWorkItemType?.name === "string" ? c.defaultWorkItemType.name : null);

/**
 * The write path (process configuration only): the type to create for a level, or the chosen type when it is valid
 * there (under the parent: one of its children; else one of that level's types). A bug is any of the bug category's
 * types. Null when the process has no such level or the chosen type doesn't go there.
 */
export function typeInfo(processConfig: unknown, level: ItemLevel, o: { type?: string | null; parentType?: string | null } = {}): { type: string; level: ItemLevel } | null {
  const { levels, childrenOf } = levelsFromProcessConfig(processConfig);
  const pc = processConfig as Pc;
  const bugs = bugTypesOf(processConfig);
  const under = o.parentType ? childrenOf(o.parentType) : level === "feature" ? levels.parent : level === "bug" ? bugs : levels.child.filter((t) => !bugs.includes(t));
  const allowed = level === "bug" && !o.type ? under.filter((t) => bugs.includes(t)) : under;
  if (o.type) {
    const hit = allowed.find((t) => t.toLowerCase() === o.type!.toLowerCase());
    return hit ? { type: hit, level: bugs.includes(hit) ? "bug" : levels.parent.includes(hit) ? "feature" : "story" } : null;
  }
  const preferred = level === "bug" ? defaultOf(pc?.bugWorkItems) : level === "story" ? defaultOf(pc?.requirementBacklog) : defaultOf((Array.isArray(pc?.portfolioBacklogs) ? pc.portfolioBacklogs : []).at(-1));
  const type = preferred && allowed.includes(preferred) ? preferred : (allowed.find((t) => level === "bug" || !bugs.includes(t)) ?? null);
  return type ? { type, level } : null;
}

export type TypeChoice = { type: string; bug: boolean };

/**
 * The draft's choices (the read side's process model, with history): under the suggested parent only its valid child
 * types, the most common first; with no parent, the level's own types. The default follows the drafted level (a bug
 * type when the draft says bug and one goes there), else the most common child.
 */
export function typeChoices(m: ProcessModel | null, o: { parentType: string | null; level: ItemLevel }): { choices: TypeChoice[]; type: string | null } {
  if (!m) return { choices: [], type: null };
  const parent = o.parentType ? typeOf(m, o.parentType) : undefined;
  const isBug = (t: string) => !!typeOf(m, t)?.bug;
  const names = parent ? parent.validChildren : o.level === "feature" ? m.levels.parent : m.levels.child;
  const common = parent?.defaultChild ?? names.find((t) => !isBug(t)) ?? names[0] ?? null;
  const ordered = common && names.includes(common) ? [common, ...names.filter((t) => t !== common)] : [...names];
  const want = o.level === "bug" ? (ordered.find(isBug) ?? common) : common;
  return { choices: ordered.map((type) => ({ type, bug: isBug(type) })), type: want ?? null };
}
