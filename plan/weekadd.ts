// Plan the week's right pane, "Add to <client>" (U6, D412; fix D437): what FROM DEVOPS offers for the open client.
// Pure.
//
// - Feature-tier items not on the list, each with its open stories nested under it (never rows of their own), and
//   stories that have no parent feature (orphans: no parent, or an epic as parent). A story under a feature is
//   offered only through its feature.
// - Never an epic: an epic with no features is a readiness line on the client's card ("Epic needs features").
// - Each row carries its DevOps type, which the pane draws as the type's icon (WT-1), never a type word.
import type { IsoDate, PortfolioItem, WorkItem } from "../week/types.ts";
import { isPickable } from "./rules.ts";

export type AddNested = { id: number; title: string; url: string; /** WT-1: the DevOps type, drawn as its icon. */ type: string };
export type AddRowInfo = {
  id: number;
  title: string;
  url: string;
  /** WT-1: the DevOps type, drawn as its icon (TypeIcon) instead of a word. */
  type: string;
  /** Features: their target date, when set. */
  targetDate: IsoDate | null;
  /** Features: "no stories" when it has none at all. */
  flag: string | null;
  /** Features: their open stories not on the list, nested under the row. */
  nested: AddNested[];
};


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
      type: f.type,
      targetDate: f.targetDate,
      flag: f.needsBreakdown === false || f.children.some((c) => c.level === "story") ? null : "no stories",
      nested: f.children.filter((c) => c.level === "story" && c.open && !o.listed.has(c.id)).map((c) => ({ id: c.id, title: c.title, url: c.url, type: c.type })),
    }));
  // A story's parent is a feature unless it has none or its parent is an epic (a story straight under an epic).
  const orphan = (s: WorkItem) => s.parentId == null || (epics.has(s.parentId) && !featureIds.has(s.parentId));
  const stories: AddRowInfo[] = o.work
    .filter((s) => isPickable(s) && !o.listed.has(s.id) && orphan(s))
    .map((s) => ({ id: s.id, title: s.title, url: s.url, type: s.type, targetDate: null, flag: null, nested: [] }));
  return [...features, ...stories];
}
