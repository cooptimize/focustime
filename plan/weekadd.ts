// Plan the week's right pane, "Add to <client>" (U6, D412; fix D437): what FROM DEVOPS offers for the open client.
// Pure.
//
// - Feature-tier items not on the list, each with its open stories nested under it (never rows of their own), and
//   stories that have no parent feature (orphans: no parent, or an epic as parent). A story under a feature is
//   offered only through its feature.
// - Never an epic: an epic with no features is a readiness line on the client's card ("Epic needs features").
// - Each row's type word is a glossary tier name: "Feature" for the feature tier (whatever the process calls it), and
//   for a story the process's name for its story-tier type, with "User Story" said as "Story", so the pane never mixes
//   "User Story" and "Story".
import type { IsoDate, PortfolioItem, WorkItem } from "../week/types.ts";

export type AddNested = { id: number; title: string; url: string; typeWord: string };
export type AddRowInfo = {
  id: number;
  title: string;
  url: string;
  /** The muted word after the title: "Feature", "Story" or the process's story-tier name. */
  typeWord: string;
  /** Features: their target date, when set. */
  targetDate: IsoDate | null;
  /** Features: "no stories" when it has none at all. */
  flag: string | null;
  /** Features: their open stories not on the list, nested under the row. */
  nested: AddNested[];
};

/** The type word for a story-tier item: "User Story" is "Story"; other processes keep their name (Product Backlog Item, Issue, Requirement, Bug). */
export const storyWord = (type: string) => (type === "User Story" || type === "Story" ? "Story" : type);
export const FEATURE_WORD = "Feature";

export function addPaneRows(o: {
  portfolio: readonly PortfolioItem[];
  work: readonly WorkItem[];
  /** Item ids on this client's week list. */
  listed: ReadonlySet<number>;
}): AddRowInfo[] {
  const epics = new Set(o.portfolio.filter((i) => i.tier === "epic").map((i) => i.id));
  const featureIds = new Set(o.portfolio.filter((i) => i.tier === "feature").map((i) => i.id));
  const features: AddRowInfo[] = o.portfolio
    .filter((f) => f.tier === "feature" && !o.listed.has(f.id))
    .map((f) => ({
      id: f.id,
      title: f.title,
      url: f.url,
      typeWord: FEATURE_WORD,
      targetDate: f.targetDate,
      flag: f.children.some((c) => c.level === "story") ? null : "no stories",
      nested: f.children.filter((c) => c.level === "story" && c.open && !o.listed.has(c.id)).map((c) => ({ id: c.id, title: c.title, url: c.url, typeWord: storyWord(c.type) })),
    }));
  // A story's parent is a feature unless it has none or its parent is an epic (a story straight under an epic).
  const orphan = (s: WorkItem) => s.parentId == null || (epics.has(s.parentId) && !featureIds.has(s.parentId));
  const stories: AddRowInfo[] = o.work
    .filter((s) => s.level === "story" && !o.listed.has(s.id) && orphan(s))
    .map((s) => ({ id: s.id, title: s.title, url: s.url, typeWord: storyWord(s.type), targetDate: null, flag: null, nested: [] }));
  return [...features, ...stories];
}
