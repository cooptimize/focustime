// CV-1: the one place FocusTime turns a level (bug, story, feature) into a project's work item type. WT-1 (work item
// types) replaces the body with its model; every caller goes through typeInfo, so that switch is one line here.
export type ItemLevel = "bug" | "story" | "feature";

type Cat = { defaultWorkItemType?: { name?: unknown }; workItemTypes?: { name?: unknown }[] };
type Pc = { requirementBacklog?: Cat; portfolioBacklogs?: Cat[]; bugWorkItems?: Cat } | null;
const nameOf = (c: Cat | undefined) => {
  const n = c?.defaultWorkItemType?.name ?? c?.workItemTypes?.[0]?.name;
  return typeof n === "string" ? n : null;
};

/**
 * The project's default type for a level, from its process configuration (backlog levels, never type names): a bug is
 * the type bugs are tracked as on a backlog, a story the requirement backlog's default, a feature the lowest portfolio
 * backlog's. Null when the process has no such level.
 */
export function typeInfo(processConfig: unknown, level: ItemLevel): { type: string; level: ItemLevel } | null {
  const pc = processConfig as Pc;
  const type = level === "bug" ? nameOf(pc?.bugWorkItems) : level === "story" ? nameOf(pc?.requirementBacklog) : nameOf((Array.isArray(pc?.portfolioBacklogs) ? pc.portfolioBacklogs : []).filter((b) => (b.workItemTypes ?? []).length > 0).at(-1));
  return type ? { type, level } : null;
}
