// QC-1: Create work quickly, pure. What the one New form offers and what its create may write, from the client's own
// process (backlog levels, their types, which types go under which), never from a list of type names. The write
// framework (actions/devops-write-actions.ts, kind "new_item") applies the same rules on the server before anything is
// sent; the form uses them to choose its defaults. No I/O.
import { ladderFromProcessConfig } from "./process.ts";
import type { Half } from "../week/types.ts";

/** DevOps keeps a title to 255 characters (a String field). */
export const TITLE_MAX = 255;

/** One level the New form offers: its types top-down, and where it sits (0 = the highest portfolio level). */
export type CreateLevel = { rung: number; types: string[]; /** The lowest portfolio level (the feature tier) or below it. */ kind: "portfolio" | "requirement" };

/**
 * The levels a person may create at, top-down: every portfolio level and the requirement level (stories), from the
 * backlog ladder. The task level is left out: tasks belong to a story's own board, not to planning.
 */
export function createLevelsOf(ladder: readonly (readonly string[])[]): CreateLevel[] {
  // The ladder is portfolio levels top-down, then requirements, then tasks (plan/process.ts buildProcessModel).
  const rungs = ladder.slice(0, -1);
  return rungs.map((types, rung) => ({ rung, types: [...types], kind: rung === rungs.length - 1 ? ("requirement" as const) : ("portfolio" as const) })).filter((l) => l.types.length > 0);
}
export const createLevels = (pc: unknown): CreateLevel[] => createLevelsOf(ladderFromProcessConfig(pc));

/** The rung a type sits at in the ladder, or -1. */
export const rungOfType = (ladder: readonly (readonly string[])[], type: string): number => ladder.findIndex((r) => r.includes(type));

/** Every type the New form may create, in ladder order. */
export const creatableTypes = (levels: readonly CreateLevel[]): string[] => levels.flatMap((l) => l.types);

/**
 * The parent rule: a type goes under any type one level up (the next backlog level), as DevOps' backlogs nest them.
 * With no parent it is fine at any level: DevOps itself never needs one (the project's default area and iteration).
 */
export function parentProblem(ladder: readonly (readonly string[])[], parentType: string, type: string): string | null {
  const p = rungOfType(ladder, parentType);
  const t = rungOfType(ladder, type);
  if (t < 0) return `${type} isn't a level in this project's process`;
  if (p >= 0 && p + 1 === t) return null;
  const under = p >= 0 && p + 1 < ladder.length - 1 ? ladder[p + 1]! : [];
  return under.length ? `${cap(aOr(type))} doesn't go under ${aOr(parentType)} in this process. Under ${aOr(parentType)} go: ${under.join(", ")}` : `Nothing goes under ${aOr(parentType)} in this process's backlogs`;
}

/** "a Feature", "an Epic". */
export const aOr = (type: string) => `${/^[aeiou]/i.test(type) ? "an" : "a"} ${type}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The parent types a type can have (one level up), in ladder order; empty at the top. */
export const parentTypesOf = (ladder: readonly (readonly string[])[], type: string): string[] => {
  const t = rungOfType(ladder, type);
  return t > 0 ? [...ladder[t - 1]!] : [];
};

/** The child types one level down, for "New under this", task level left out. */
export const childTypesOf = (ladder: readonly (readonly string[])[], type: string): string[] => {
  const t = rungOfType(ladder, type);
  return t >= 0 && t + 1 < ladder.length - 1 ? [...ladder[t + 1]!] : [];
};

/** A title as DevOps gets it: one line, spaces collapsed. Null with the reason when it can't be one. */
export function cleanTitle(raw: unknown): { title: string } | { problem: string } {
  const title = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!title) return { problem: "Type a title" };
  if (title.length > TITLE_MAX) return { problem: `A DevOps title is at most ${TITLE_MAX} characters. This one is ${title.length}` };
  return { title };
}

/** One field of a type, as the work item type fields list gives it (alwaysRequired, defaultValue). */
export type TypeFieldInfo = { ref: string; name: string | null; required: boolean; hasDefault: boolean };

/**
 * The required fields a create would leave empty and DevOps can't fill: required, with no default, not System.*
 * (DevOps sets its own: state, reason, area, iteration, dates, who), and not one this create writes.
 */
export function missingRequired(fields: readonly TypeFieldInfo[], writes: ReadonlySet<string>): TypeFieldInfo[] {
  return fields.filter((f) => f.required && !f.hasDefault && !writes.has(f.ref) && !(f.ref.startsWith("System.") && f.ref !== "System.Title" && f.ref !== "System.Description" && f.ref !== "System.AssignedTo"));
}

/** Where the New form was opened from; each place sets its own defaults. */
export type NewPlace =
  | { from: "ahead"; clientKey: string | null }
  | { from: "ahead_row"; clientKey: string; parent: { id: number; type: string; title: string } }
  | { from: "command"; clientKey: string | null; level?: string }
  | { from: "panel"; clientKey: string; title: string; at: { date: string; half: Half } }
  | { from: "capture"; clientKey: string; title: string; draftId: number; level: "story" | "feature" }
  | { from: "draft"; clientKey: string | null; draftId: number }
  | { from: "breakdown"; clientKey: string; parent: { id: number; type: string; title: string } };

/** The level types the form starts on: the feature tier's default for Ahead, the panel and a feature capture. */
export type FormDefaults = { clientKey: string | null; type: string | null; parentId: number | null; title: string; placeOnBlock: boolean };

/**
 * The form's starting values. `levels` is the chosen client's (null until it is known); `defaults` its default type
 * per rung (the backlog's default work item type, else the first). A row's "New under this" starts one level down.
 */
export function formDefaults(p: NewPlace, levels: readonly CreateLevel[] | null, defaultOf: (rung: number) => string | null = (r) => levels?.find((l) => l.rung === r)?.types[0] ?? null): FormDefaults {
  const feature = levels?.filter((l) => l.kind === "portfolio").at(-1) ?? null;
  const story = levels?.find((l) => l.kind === "requirement") ?? null;
  const featureType = feature ? defaultOf(feature.rung) : null;
  const storyType = story ? defaultOf(story.rung) : null;
  const ladder = levels?.map((l) => l.types) ?? [];
  const under = (parentType: string) => {
    const kids = levels ? childTypesOf([...ladder, []], parentType) : [];
    const rung = levels?.find((l) => l.types.includes(kids[0] ?? ""))?.rung;
    const d = rung !== undefined ? defaultOf(rung) : null;
    return d && kids.includes(d) ? d : (kids[0] ?? null);
  };
  const named = (name: string | undefined) => (name && levels?.some((l) => l.types.includes(name)) ? name : null);
  switch (p.from) {
    case "ahead":
      return { clientKey: p.clientKey, type: featureType, parentId: null, title: "", placeOnBlock: false };
    case "ahead_row":
    case "breakdown":
      return { clientKey: p.clientKey, type: under(p.parent.type), parentId: p.parent.id, title: "", placeOnBlock: false };
    case "command":
      return { clientKey: p.clientKey, type: named(p.level) ?? featureType, parentId: null, title: "", placeOnBlock: false };
    case "panel":
      return { clientKey: p.clientKey, type: featureType, parentId: null, title: p.title, placeOnBlock: true };
    case "capture":
      return { clientKey: p.clientKey, type: p.level === "story" ? storyType : featureType, parentId: null, title: p.title, placeOnBlock: false };
    case "draft":
      return { clientKey: p.clientKey, type: null, parentId: null, title: "", placeOnBlock: false };
  }
}

/** The draft level a type is stored at (the table keeps story or feature; the exact type is kept beside it). */
export const draftLevelOf = (levels: readonly CreateLevel[], type: string): "story" | "feature" => (levels.find((l) => l.types.includes(type))?.kind === "requirement" ? "story" : "feature");

/** "New feature", "New epic": a command's words, from the process's own type name. */
export const newWords = (type: string) => `New ${type.toLowerCase()}`;

/** A parent the form offers: one of the client's open items at a level something can go under. */
export type NewParent = { id: number; title: string; type: string; state: string; url: string; parentId: number | null };
/** What the form needs for one client. */
/** QC-1 new.options: what the form needs for one client. */
export type NewOptions = {
  clientKey: string;
  /** My checked write PAT for this client; without it only Save as draft. */
  canWrite: boolean;
  /** Top-down; each with the type the backlog adds by default. Empty with `problem` when the process can't be read. */
  levels: (CreateLevel & { default: string })[];
  parents: NewParent[];
  problem: string | null;
};

