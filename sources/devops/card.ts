// FN-1: parsing what the story card reads from DevOps (pure). One work item with all its fields and relations
// (GET workitems/{id}?$expand=all), its parent and the parent's parent, its children (from the relations), and a page of
// comments. Nothing here is cached or logged; the action sanitizes the HTML before it reaches a browser.
import type { CardLink, CardRead } from "../../plan/item-card.ts";
import { COMMENTS_MAX } from "../../plan/item-card.ts";
import { ACCEPTANCE_FIELD, identityName, START_DATE_FIELD, TYPE_SIZE_FIELDS } from "./normalize.ts";

export const REMAINING_WORK_FIELD = "Microsoft.VSTS.Scheduling.RemainingWork";
const TARGET = "Microsoft.VSTS.Scheduling.TargetDate";
const PARENT = "System.LinkTypes.Hierarchy-Reverse";
const CHILD = "System.LinkTypes.Hierarchy-Forward";
/** The fields a related item (parent, epic, child) is read with. */
export const LINK_FIELDS = ["System.Id", "System.Title", "System.WorkItemType", "System.State"];

type Raw = { id?: unknown; fields?: Record<string, unknown>; relations?: { rel?: unknown; url?: unknown }[] | null };
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const idOfRel = (url: unknown) => {
  const m = /\/workItems\/(\d+)$/i.exec(str(url));
  return m ? Number(m[1]) : null;
};

/** The ids of an item's children and its parent, from its relations. */
export function relatedIds(r: Raw): { parent: number | null; children: number[] } {
  const rels = Array.isArray(r.relations) ? r.relations : [];
  const parent = rels.find((x) => x?.rel === PARENT);
  const kids = rels.filter((x) => x?.rel === CHILD).map((x) => idOfRel(x.url)).filter((n): n is number => n !== null);
  return { parent: parent ? idOfRel(parent.url) : (num(r.fields?.["System.Parent"]) ?? null), children: [...new Set(kids)] };
}

export function parseLink(r: Raw | undefined): CardLink | null {
  const f = r?.fields ?? {};
  if (typeof r?.id !== "number" || typeof f["System.Title"] !== "string") return null;
  return { id: r.id, title: f["System.Title"], type: str(f["System.WorkItemType"]), state: str(f["System.State"]) || null };
}

/** The comments page (newest first, as asked), deleted ones left out. Text stays HTML for the sanitizer. */
export function parseCardComments(body: unknown): { comments: CardRead["comments"]; count: number } {
  const b = body as { totalCount?: unknown; count?: unknown; comments?: { id?: unknown; text?: unknown; createdDate?: unknown; isDeleted?: unknown; createdBy?: unknown }[] } | null;
  const list = Array.isArray(b?.comments) ? b!.comments! : [];
  const comments = list
    .filter((c) => c && c.isDeleted !== true && typeof c.text === "string" && typeof c.id === "number")
    .slice(0, COMMENTS_MAX)
    .map((c) => ({ id: c.id as number, author: identityName(c.createdBy) ?? "Someone", at: str(c.createdDate), text: c.text as string }));
  const total = num(b?.totalCount) ?? num(b?.count) ?? comments.length;
  return { comments, count: Math.max(total, comments.length) };
}

/**
 * The card from the item, its related items and its comments. `category` gives a state's category for the item's type
 * (from the process model); `sizeLabel` names the type's size field ("Story Points").
 */
export function parseCard(o: { raw: Raw; url: string; related: readonly Raw[]; comments: unknown; category: (type: string, state: string) => string | null; sizeLabel: (ref: string) => string; states?: { name: string; category: string }[]; typeHas: ReadonlySet<string> | null; breakDown?: boolean }): CardRead | null {
  const r = o.raw;
  const f = r.fields ?? {};
  if (typeof r.id !== "number" || typeof f["System.Title"] !== "string") return null;
  const type = str(f["System.WorkItemType"]);
  const state = str(f["System.State"]);
  const rel = relatedIds(r);
  const byId = new Map(o.related.map((x) => [x.id, x] as const));
  const parent = rel.parent !== null ? parseLink(byId.get(rel.parent)) : null;
  const gpId = parent ? relatedIds(byId.get(parent.id) ?? {}).parent : null;
  const grandparent = gpId !== null ? parseLink(byId.get(gpId)) : null;
  const has = (ref: string) => (o.typeHas ? o.typeHas.has(ref) : ref in f);
  const sizeRef = TYPE_SIZE_FIELDS.find((x) => has(x)) ?? null;
  const cm = parseCardComments(o.comments);
  return {
    id: r.id,
    title: f["System.Title"],
    type,
    state,
    stateCategory: o.category(type, state),
    states: o.states ?? [],
    assignee: identityName(f["System.AssignedTo"]),
    iteration: str(f["System.IterationPath"]) || null,
    area: str(f["System.AreaPath"]) || null,
    size: sizeRef ? { label: o.sizeLabel(sizeRef), value: num(f[sizeRef]) } : null,
    remainingWork: num(f[REMAINING_WORK_FIELD]),
    hasRemainingWork: has(REMAINING_WORK_FIELD),
    start: day(f[START_DATE_FIELD]),
    target: day(f[TARGET]),
    descriptionHtml: str(f["System.Description"]) || str(f["Microsoft.VSTS.TCM.ReproSteps"]),
    acceptanceHtml: str(f[ACCEPTANCE_FIELD]),
    tags: str(f["System.Tags"]).split(";").map((t) => t.trim()).filter(Boolean).slice(0, 50),
    parent,
    grandparent,
    children: rel.children.map((id) => parseLink(byId.get(id))).filter((x): x is CardLink => !!x),
    comments: cm.comments,
    commentCount: cm.count,
    url: o.url,
    changedAt: str(f["System.ChangedDate"]) || null,
    breakDown: o.breakDown ?? false,
  };
}
