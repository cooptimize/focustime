// RB-7: which branch Code reads a repo on. Pure: no reads, no DOM.
//   - A repo opens on its client's opening branch when an admin has set one and the repo has a branch of that name;
//     otherwise on the repo's own default branch, as before RB-7.
//   - A branch a person chose (it travels in the address) wins while the repo has it. One that is gone (deleted or
//     renamed) falls back to the opening branch, and the answer says which was asked for.
// No branch name is written into the code: the opening branch is the client's Rule (config/org.ts code_branch), the
// default is what DevOps says, and the rest come from the repo's own branch list.
import { isBranchName } from "./code.ts";

export type BranchWhy = "chosen" | "opening" | "default";
/** The branch a read is made on, and what the screen needs to say about it. */
export type BranchPick = {
  /** The branch read. */
  name: string;
  why: BranchWhy;
  /** The branch this repo opens on: the client's opening branch when the repo has it, else its default. */
  opening: string;
  /** The repo's own default branch. */
  default: string;
  /** A chosen branch that isn't there any more, or null. */
  gone: string | null;
};

/** The client's opening branch when it's a name a branch can have; anything else counts as not set. */
export const openingRule = (v: unknown): string | null => (isBranchName(v) ? v : null);

/**
 * Whether the repo's branch list is needed to know the branch: only when a branch other than the default is asked
 * for, by a person or by the client's Rule. With neither, nothing more is read (as before RB-7).
 */
export function needsBranchList(i: { defaultBranch: string; opening: string | null; chosen: string | null }): boolean {
  return (!!i.chosen && i.chosen !== i.defaultBranch) || (!!i.opening && i.opening !== i.defaultBranch);
}

/** The branch a repo opens on. `names` is its branch list (null when it wasn't read, which needsBranchList allows). */
export function openingOf(defaultBranch: string, opening: string | null, names: readonly string[] | null): string {
  if (!opening || opening === defaultBranch) return defaultBranch;
  return names?.includes(opening) ? opening : defaultBranch;
}

/** The branch to read: a chosen one while the repo has it, else the opening branch (saying a chosen one is gone). */
export function pickBranch(i: { defaultBranch: string; opening: string | null; chosen: string | null; names: readonly string[] | null }): BranchPick {
  const opening = openingOf(i.defaultBranch, i.opening, i.names);
  const base = { opening, default: i.defaultBranch };
  const usual: BranchPick = { ...base, name: opening, why: opening === i.defaultBranch ? "default" : "opening", gone: null };
  if (!i.chosen || i.chosen === opening) return usual;
  if (i.chosen === i.defaultBranch || i.names?.includes(i.chosen)) return { ...base, name: i.chosen, why: "chosen", gone: null };
  return { ...usual, gone: i.chosen };
}

/** The picker's order: the opening branch first, then the default when it differs, then the rest by name. */
export function branchOrder(names: readonly string[], opening: string, defaultBranch: string): string[] {
  const rest = names.filter((n) => n !== opening && n !== defaultBranch).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }) || (a < b ? -1 : 1));
  return [opening, ...(defaultBranch !== opening ? [defaultBranch] : []), ...rest];
}

/** With more branches than this, the picker has a box to find one by typing. */
export const BRANCH_FIND_AFTER = 20;
/** Names longer than this are cut in the middle on screen (the whole name shows on hover). */
export const BRANCH_SHOWN_MAX = 36;

/** "feature/a-very-long-name-for-returns" → "feature/a-very…for-returns": the start and the end kept. */
export function middleCut(name: string, max = BRANCH_SHOWN_MAX): string {
  if (name.length <= max) return name;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (keep - head))}`;
}

/** The folders a path is in, nearest first, ending with the repo's top: "/a/b/c.sql" → ["/a/b", "/a", "/"]. */
export function foldersUp(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const out: string[] = [];
  for (let n = parts.length - 1; n > 0; n--) out.push(`/${parts.slice(0, n).join("/")}`);
  out.push("/");
  return out;
}

/** RB-7's words on screen (docs/design/wording.md). */
export const BRANCH_TEXT = {
  /** The header's line when the branch on screen isn't the one the repo opens on. */
  offUsual: (name: string, opening: string) => `On ${name}, not the usual ${opening}`,
  backTo: (opening: string) => `Back to ${opening}`,
  /** A branch asked for (an address, or mid-read) that isn't there any more. */
  gone: (asked: string, opening: string) => `${asked} isn't there any more, so this is ${opening}.`,
  /** Choosing a branch where the open file or folder isn't. */
  moved: (path: string, name: string, folder: string) => `${path} isn't on ${name}, so this is ${folder === "/" ? "the top of the repo" : folder}.`,
  opening: "opens here",
  default: "default",
  find: "Find a branch",
  noMatch: "No branch by that name.",
  cut: (n: number) => `Showing the first ${n.toLocaleString("en-US")} branches.`,
  label: (name: string) => `Branch: ${name}. Change branch`,
  /** Search inside files, on a branch DevOps doesn't search for that repo. */
  notSearched: (shown: string) => `DevOps doesn't search this branch. These are from ${shown}.`,
} as const;
