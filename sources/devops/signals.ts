// DS-1: the DevOps reads behind Draft stories, read only, with the company read PAT (like the Coop brief's description):
// one feature's fields, its epic, its child items and its comments; and the example pool, the same project's features
// changed in the last months with their stories. Pure here: the queries and the parsing; the calls are in source.ts.
// Never cached on disk, never logged (counts only).
import type { ChildItem, EpicFields, ExemplarCandidate, FeatureFields, RawComment } from "../../plan/stories.ts";
import { ACCEPTANCE_FIELD, htmlToText, type StateCategories } from "./normalize.ts";

export const PRIORITY_FIELD = "Microsoft.VSTS.Common.Priority";
export const FEATURE_FIELDS = ["System.Id", "System.Title", "System.WorkItemType", "System.State", "System.Description", ACCEPTANCE_FIELD, "System.Tags", "System.AreaPath", "System.IterationPath", PRIORITY_FIELD, "System.Parent", "System.TeamProject"];
export const EPIC_FIELDS = ["System.Id", "System.Title", "System.WorkItemType", "System.Description"];
export const CHILD_FIELDS = ["System.Id", "System.Title", "System.WorkItemType", "System.State", "System.Parent"];
export const POOL_FEATURE_FIELDS = ["System.Id", "System.Title", "System.Description", "System.Tags", "System.AreaPath", "System.Parent", "System.ChangedDate"];
export const poolStoryFields = (sizeField: string | null) => ["System.Id", "System.Title", "System.Description", ACCEPTANCE_FIELD, "System.Parent", ...(sizeField ? [sizeField] : [])];

/** Comments: the Work Item Comments API is still a preview version in 7.1. Newest first, one page. */
export const COMMENTS_API = "7.1-preview.4";
export const COMMENTS_TOP = 50;
/** The pool: this many of the most recently changed features, read with their stories. */
export const POOL_FEATURES = 100;

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ids = (xs: readonly number[]) => xs.filter((i) => Number.isSafeInteger(i) && i > 0).join(", ");

/** Every child of one item (any state, any type). */
export const childrenWiql = (parentId: number) => `SELECT [System.Id] FROM WorkItems WHERE [System.Parent] = ${Number(parentId)} ORDER BY [System.Id]`;

/** The pool: the project's features (the feature tier) that are under way or done, changed since the date. */
export function poolWiql(o: { project: string; featureTypes: readonly string[]; categories: StateCategories; since: string }): string {
  const states = new Set<string>();
  for (const t of o.featureTypes) for (const [name, cat] of o.categories.get(t) ?? []) if (cat === "InProgress" || cat === "Resolved" || cat === "Completed") states.add(name);
  // Names come lower-cased from categoriesFrom; WIQL compares states without case.
  const stateClause = states.size ? ` AND [System.State] IN (${[...states].map(q).join(", ")})` : "";
  return `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = ${q(o.project)} AND [System.WorkItemType] IN (${o.featureTypes.map(q).join(", ")})${stateClause} AND [System.ChangedDate] >= ${q(o.since)} ORDER BY [System.ChangedDate] DESC`;
}

/** The stories under some features (the story types of the requirement backlog only). */
export const poolStoriesWiql = (parents: readonly number[], storyTypes: readonly string[]) => `SELECT [System.Id] FROM WorkItems WHERE [System.Parent] IN (${ids(parents)}) AND [System.WorkItemType] IN (${storyTypes.map(q).join(", ")}) ORDER BY [System.Id]`;

type Raw = { id?: unknown; fields?: Record<string, unknown> };
const text = (v: unknown) => (typeof v === "string" ? htmlToText(v).replace(/\n{3,}/g, "\n\n").trim() : "");
const plain = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const tagsOf = (v: unknown) => (typeof v === "string" ? v.split(";").map((t) => t.trim()).filter(Boolean) : []);

export function parseFeature(r: Raw, url: string): FeatureFields | null {
  const f = r.fields ?? {};
  if (typeof r.id !== "number" || typeof f["System.Title"] !== "string") return null;
  return {
    id: r.id, title: f["System.Title"], type: plain(f["System.WorkItemType"]), state: plain(f["System.State"]), priority: num(f[PRIORITY_FIELD]), tags: tagsOf(f["System.Tags"]),
    areaPath: plain(f["System.AreaPath"]), iterationPath: plain(f["System.IterationPath"]), description: text(f["System.Description"]), acceptance: text(f[ACCEPTANCE_FIELD]),
    parentId: num(f["System.Parent"]), url,
  };
}
export function parseEpic(r: Raw): EpicFields | null {
  const f = r.fields ?? {};
  if (typeof r.id !== "number" || typeof f["System.Title"] !== "string") return null;
  return { id: r.id, title: f["System.Title"], type: plain(f["System.WorkItemType"]), description: text(f["System.Description"]) };
}
export function parseChild(r: Raw): ChildItem | null {
  const f = r.fields ?? {};
  if (typeof r.id !== "number" || typeof f["System.Title"] !== "string") return null;
  return { id: r.id, title: f["System.Title"], type: plain(f["System.WorkItemType"]), state: plain(f["System.State"]) };
}

/** The comments page: newest first (as asked), deleted ones left out, text as plain text. */
export function parseComments(body: unknown): RawComment[] {
  const list = (body as { comments?: { text?: unknown; createdDate?: unknown; isDeleted?: unknown }[] } | null)?.comments;
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && c.isDeleted !== true && typeof c.text === "string")
    .map((c) => ({ at: typeof c.createdDate === "string" ? c.createdDate : "", text: text(c.text) }))
    .filter((c) => c.text)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** The pool's candidates: each feature with the stories under it (only features that have any are useful). */
export function poolCandidates(features: readonly Raw[], stories: readonly Raw[], sizeField: string | null): ExemplarCandidate[] {
  const by = new Map<number, ExemplarCandidate["stories"]>();
  for (const s of stories) {
    const f = s.fields ?? {};
    const parent = num(f["System.Parent"]);
    if (parent === null || typeof f["System.Title"] !== "string") continue;
    const list = by.get(parent) ?? [];
    list.push({ title: f["System.Title"], description: text(f["System.Description"]), hasAcceptance: text(f[ACCEPTANCE_FIELD]).length > 0, size: sizeField ? num(f[sizeField]) : null });
    by.set(parent, list);
  }
  return features.flatMap((r) => {
    const f = r.fields ?? {};
    if (typeof r.id !== "number" || typeof f["System.Title"] !== "string") return [];
    return [{ id: r.id, title: f["System.Title"], description: text(f["System.Description"]), tags: tagsOf(f["System.Tags"]), areaPath: plain(f["System.AreaPath"]), parentId: num(f["System.Parent"]), changedAt: plain(f["System.ChangedDate"]), stories: by.get(r.id) ?? [] }];
  });
}
