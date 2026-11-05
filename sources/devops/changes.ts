// DV-1: what changed on a work item between two reads of its fields, for the change log (NT-1 reads it later). Pure.
// Only what notifications will need: the assignee, the target and start dates, the state, a new child (on the parent),
// and the comment count. Names only for the assignee; the changer's uniqueName is kept only to match a FocusTime user
// (a narrow exception to D156, the change log only), never shown and never logged.
import { identityEmail, identityName } from "./normalize.ts";

export type ChangeKind = "assignee" | "target_date" | "start_date" | "size" | "state" | "new_child" | "comments" | "removed";

export type ChangeEntry = {
  itemId: number;
  kind: ChangeKind;
  oldValue: string | null;
  newValue: string | null;
  /** Who made the change, per DevOps (System.ChangedBy): the display name, and the uniqueName only for matching. */
  byName: string | null;
  byUnique: string | null;
  changedAt: string;
  rev: number;
};

export type Fields = Readonly<Record<string, unknown>>;

/** The fields DV-1 reads besides the ones screens use: the revision, the comment count and when it was created. */
export const REV_FIELD = "System.Rev";
export const COMMENTS_FIELD = "System.CommentCount";
export const CREATED_FIELD = "System.CreatedDate";
export const PROJECT_FIELD = "System.TeamProject";

const cap = (v: string | null) => (v === null ? null : v.slice(0, 400));
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const dateOf = (v: unknown): string | null => (typeof v === "string" && v ? v.slice(0, 10) : null);
const parentOf = (f: Fields | null): number | null => (f && typeof f["System.Parent"] === "number" ? (f["System.Parent"] as number) : null);
export const revOf = (f: Fields | null): number => (f && typeof f[REV_FIELD] === "number" ? (f[REV_FIELD] as number) : 0);

/** Who changed it last, per DevOps. */
export function changerOf(f: Fields): { byName: string | null; byUnique: string | null } {
  return { byName: identityName(f["System.ChangedBy"]), byUnique: identityEmail(f["System.ChangedBy"]) };
}

/**
 * The entries for one item read again. `before` null: an item the store didn't have. It gets a "new child" on its
 * parent only when it was created since `newSince` (an older item coming into scope isn't news). With several
 * revisions between two reads the entry is the net change, credited to the last changer.
 */
export function diffItem(o: { id: number; before: Fields | null; after: Fields; targetField?: string | null; startField?: string | null; /** AH-1: the type's own size field (D634). */ sizeField?: string | null; newSince: string }): ChangeEntry[] {
  const { id, before, after } = o;
  const rev = revOf(after);
  if (before && revOf(before) >= rev) return [];
  const who = changerOf(after);
  const changedAt = typeof after["System.ChangedDate"] === "string" ? (after["System.ChangedDate"] as string) : "";
  const out: ChangeEntry[] = [];
  const add = (kind: ChangeKind, oldValue: string | null, newValue: string | null, itemId = id) => {
    if (oldValue === newValue) return;
    out.push({ itemId, kind, oldValue: cap(oldValue), newValue: cap(newValue), ...who, changedAt, rev });
  };
  if (!before) {
    const created = typeof after[CREATED_FIELD] === "string" ? (after[CREATED_FIELD] as string) : null;
    const parent = parentOf(after);
    if (parent !== null && created && Date.parse(created) >= Date.parse(o.newSince)) add("new_child", null, String(id), parent);
    return out;
  }
  add("assignee", identityName(before["System.AssignedTo"]), identityName(after["System.AssignedTo"]));
  if (o.targetField) add("target_date", dateOf(before[o.targetField]), dateOf(after[o.targetField]));
  if (o.startField) add("start_date", dateOf(before[o.startField]), dateOf(after[o.startField]));
  if (o.sizeField) add("size", str(before[o.sizeField]), str(after[o.sizeField]));
  add("state", str(before["System.State"]), str(after["System.State"]));
  const pb = parentOf(before);
  const pa = parentOf(after);
  if (pa !== null && pa !== pb) add("new_child", null, String(id), pa);
  const cb = typeof before[COMMENTS_FIELD] === "number" ? (before[COMMENTS_FIELD] as number) : null;
  const ca = typeof after[COMMENTS_FIELD] === "number" ? (after[COMMENTS_FIELD] as number) : null;
  if (cb !== null && ca !== null && cb !== ca) add("comments", String(cb), String(ca));
  return out;
}
