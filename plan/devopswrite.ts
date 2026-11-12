// DevOps writes (step 14), pure: the JSON Patch for each named change, the preview's rows, how each write is undone,
// what changed since an item was loaded, and the identity rule. No I/O, no PATs. Requests are built from an org name
// that has been validated, so a write can only go to that client's own organization.
import { COMPLETED, countsAsDone, isOpen, isRemoved, REMOVED, stateIn } from "./process.ts";
import { NEUTRAL_ZONE } from "../week/zone.ts";

/** Azure DevOps REST, checked Nov 1, 2026: work items GA at 7.1; comments only as 7.1-preview.4. */
export const WIT_API = "7.1";
export const COMMENTS_API = "7.1-preview.4";
/** At most this many changes in one preview or one confirm. */
export const BATCH_LIMIT = 10;
export const PARENT_REL = "System.LinkTypes.Hierarchy-Reverse";
export const AC_FIELD = "Microsoft.VSTS.Common.AcceptanceCriteria";
/** TP-1: tags, one string with ";" between them (a create writes only the one request type tag). */
export const TAGS_FIELD = "System.Tags";
/**
 * The comment an undo of Create in DevOps adds. Kept word for word from before the rename (R1): it is already posted
 * on DevOps items, and one template keeps them consistent.
 */
export const REMOVED_COMMENT = "Removed by FocusTime: undo of an item created from FocusTime.";

const ORG = /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/;
export const validOrg = (org: string | null | undefined): org is string => typeof org === "string" && ORG.test(org);
/** The only base a write may use: https://dev.azure.com/<org>. */
export function orgBase(org: string): string {
  if (!validOrg(org)) throw new Error("Not a valid DevOps organization name");
  return `https://dev.azure.com/${encodeURIComponent(org)}`;
}
/** Is this URL on this org (and nothing else: https, no credentials, no port)? */
export function onOrg(url: string, org: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "dev.azure.com" && !u.port && !u.username && !u.password && decodeURIComponent(u.pathname.split("/")[1] ?? "").toLowerCase() === org.toLowerCase();
  } catch {
    return false;
  }
}
export const itemApiUrl = (org: string, id: number) => `${orgBase(org)}/_apis/wit/workItems/${id}`;

export type PatchOp = { op: "add" | "replace" | "remove" | "test"; path: string; value?: unknown };
export type ChangeKind = "state" | "comment" | "create" | "target_date" | "description" | "assign" | "fields" | "comment_edit" | "comment_delete" | "remaining_work";
export type WriteOp = ChangeKind | "undo_state" | "undo_comment" | "undo_create" | "undo_target_date" | "undo_description" | "undo_assign" | "undo_fields" | "undo_comment_edit" | "undo_comment_delete" | "undo_remaining_work" | "feedback";

/** One identity as connectionData reports it. */
export type DevOpsIdentity = { id: string; name: string; email: string };
const ANONYMOUS = "aa442b8a-0cd8-4c3e-a0b5-9b0f84d5f0bc";
/** From a connectionData body: the authenticated user, or null (anonymous, or not the expected shape). */
export function identityFrom(body: unknown): DevOpsIdentity | null {
  const u = (body as { authenticatedUser?: { id?: unknown; providerDisplayName?: unknown; customDisplayName?: unknown; properties?: { Account?: { $value?: unknown } } } } | null)?.authenticatedUser;
  if (!u || typeof u.id !== "string" || u.id.toLowerCase() === ANONYMOUS) return null;
  const email = u.properties?.Account?.$value;
  if (typeof email !== "string" || !email.includes("@")) return null;
  const name = typeof u.customDisplayName === "string" && u.customDisplayName ? u.customDisplayName : typeof u.providerDisplayName === "string" ? u.providerDisplayName : email;
  return { id: u.id, name, email };
}
/** The write PAT must belong to my DevOps identity for that client (Account Worker email), compared without case. */
export function identityMatches(found: DevOpsIdentity | null, mine: string | null): boolean {
  return !!found && !!mine && found.email.trim().toLowerCase() === mine.trim().toLowerCase();
}

/** A work item as a write needs it: rev, the fields read, parent and relation urls. */
export type ItemSnapshot = { id: number; rev: number; type: string; title: string; state: string; fields: Record<string, unknown>; parentId: number | null; relations: { rel: string; url: string }[] };
export type StateInfo = { name: string; category: string };

const test = (rev: number): PatchOp => ({ op: "test", path: "/rev", value: rev });
const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Plain text as the HTML DevOps stores in rich text fields: one <div> per line. */
/** KB-1: a link to a GitHub article (a standards citation) is clickable in DevOps. */
const linked = (s: string) => s.replace(/https:\/\/github\.com\/[^\s<)]+/g, (u) => `<a href="${u}">${u}</a>`);
export const textToHtml = (s: string) => s.split(/\r?\n/).map((l) => `<div>${linked(html(l)) || "<br>"}</div>`).join("");

/** TX-1: the process field, in hours. Only on types that have it (read from the process, never assumed). */
export const REMAINING_WORK = "Microsoft.VSTS.Scheduling.RemainingWork";
export const REMAINING_LABEL = "Remaining Work";
/** TX-1: Remaining Work in hours, behind test /rev. Null (an undo to no value) removes it. */
export function remainingOps(rev: number, hours: number | null, had: boolean): PatchOp[] {
  if (hours === null) return had ? [test(rev), { op: "remove", path: `/fields/${REMAINING_WORK}` }] : [test(rev)];
  return [test(rev), { op: had ? "replace" : "add", path: `/fields/${REMAINING_WORK}`, value: hours }];
}
export function stateOps(rev: number, state: string, comment?: string | null): PatchOp[] {
  return [test(rev), { op: "replace", path: "/fields/System.State", value: state }, ...(comment ? [{ op: "add" as const, path: "/fields/System.History", value: textToHtml(comment) }] : [])];
}
/** A date-only field written as midnight in my zone, the way the DevOps web UI stores it. Null removes it. */
export function targetDateOps(rev: number, field: string, date: string | null, timeZone: string, had: boolean): PatchOp[] {
  if (date === null) return had ? [test(rev), { op: "remove", path: `/fields/${field}` }] : [test(rev)];
  const value = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone }).toInstant().toString();
  return [test(rev), { op: had ? "replace" : "add", path: `/fields/${field}`, value }];
}
/**
 * Step 17: Save dates to DevOps: the target date and, where the process has it, Start Date, in one patch behind one
 * rev test. Each field is set (add or replace) or removed (null).
 */
export function datesOps(rev: number, fields: { field: string; date: string | null; had: boolean }[], timeZone: string): PatchOp[] {
  const ops: PatchOp[] = [test(rev)];
  for (const f of fields) {
    if (f.date === null) {
      if (f.had) ops.push({ op: "remove", path: `/fields/${f.field}` });
    } else ops.push({ op: f.had ? "replace" : "add", path: `/fields/${f.field}`, value: Temporal.PlainDate.from(f.date).toZonedDateTime({ timeZone }).toInstant().toString() });
  }
  return ops;
}
export const dateValue = (date: string, timeZone: string) => Temporal.PlainDate.from(date).toZonedDateTime({ timeZone }).toInstant().toString();

export type CreateSpec = { org: string; title: string; description?: string | null; acceptance?: string | null; acField: boolean; /** CV-5: null leaves it unassigned (a create from a conversation may). */ assignedTo: string | null;
  /** Area, iteration and parent: from the parent for a draft; AP-1's create from an ask has none (the project's defaults). */
  areaPath: string | null; iterationPath: string | null; parentId: number | null;
  /** AP-1: where the description goes (a Bug's Repro Steps where the type has them); System.Description by default. */
  descriptionField?: string;
  /** CV-1: the description is HTML already (the path of action and the original messages, built by code). */
  descriptionIsHtml?: boolean;
  /** Step 15.3: a draft feature's dates, each only when the type has the field (start) or a target field was found. */
  startDate?: { field: string; date: string } | null; targetDate?: { field: string; date: string } | null; timeZone?: string };
export const START_FIELD = "Microsoft.VSTS.Scheduling.StartDate";
/** A new item under its parent: title, description, acceptance criteria (when the type has it), me, area and iteration of the parent, the parent link. */
export function createOps(s: CreateSpec): PatchOp[] {
  const ops: PatchOp[] = [
    { op: "add", path: "/fields/System.Title", value: s.title },
    ...(s.description ? [{ op: "add" as const, path: `/fields/${s.descriptionField ?? "System.Description"}`, value: s.descriptionIsHtml ? s.description : textToHtml(s.description) }] : []),
    ...(s.acceptance && s.acField ? [{ op: "add" as const, path: `/fields/${AC_FIELD}`, value: textToHtml(s.acceptance) }] : []),
    ...(s.startDate ? [{ op: "add" as const, path: `/fields/${s.startDate.field}`, value: dateValue(s.startDate.date, s.timeZone ?? NEUTRAL_ZONE) }] : []),
    ...(s.targetDate ? [{ op: "add" as const, path: `/fields/${s.targetDate.field}`, value: dateValue(s.targetDate.date, s.timeZone ?? NEUTRAL_ZONE) }] : []),
    ...(s.assignedTo ? [{ op: "add" as const, path: "/fields/System.AssignedTo", value: s.assignedTo }] : []),
    ...(s.areaPath ? [{ op: "add" as const, path: "/fields/System.AreaPath", value: s.areaPath }] : []),
    ...(s.iterationPath ? [{ op: "add" as const, path: "/fields/System.IterationPath", value: s.iterationPath }] : []),
    ...(s.parentId !== null ? [{ op: "add" as const, path: "/relations/-", value: { rel: PARENT_REL, url: itemApiUrl(s.org, s.parentId) } }] : []),
  ];
  return ops;
}
/** Undo of a create: the type's Removed state with a comment, never a delete. */
export function removeOps(rev: number, removedState: string): PatchOp[] {
  return [test(rev), { op: "replace", path: "/fields/System.State", value: removedState }, { op: "add", path: "/fields/System.History", value: textToHtml(REMOVED_COMMENT) }];
}

/** The completed state to preselect: the first state in the Completed category. */
export const completedState = (states: readonly StateInfo[]) => stateIn(states, COMPLETED);
export const removedState = (states: readonly StateInfo[]) => stateIn(states, REMOVED);
/**
 * PK-1: the done states a checked-off to-do offers, from the item's process model (never a name): the type's state in
 * the Completed category first, then its Resolved one when the process has one. Empty: the type has neither.
 */
export const doneChoices = (states: readonly StateInfo[]): string[] => [stateIn(states, COMPLETED), stateIn(states, "Resolved")].filter((s): s is string => !!s);
/** PK-1: an item already done (Resolved or Completed) or Removed gets no offer. An unknown state counts as open. */
export const alreadyDone = (states: readonly StateInfo[], state: string) => {
  const c = states.find((s) => s.name === state)?.category;
  return countsAsDone(c) || isRemoved(c);
};
/** WT-1: FocusTime adds items only under open parents (Proposed or In Progress). */
export const isOpenCategory = (c: string | null | undefined) => isOpen(c);

/** Rows the preview shows: label, now, after. */
export type Row = { label: string; before: string | null; after: string | null; changed: boolean };
export const row = (label: string, before: string | null, after: string | null): Row => ({ label, before, after, changed: before !== after });

/** A logged DevOps write (the audit log). */
export type DevOpsWriteStatus = "pending" | "confirmed" | "unconfirmed" | "failed" | "refused";
export type DevOpsWriteEntry = {
  id: number; at: string; clientKey: string; org: string; project: string; op: WriteOp; itemId: number | null; parentId: number | null; title: string;
  identity: string; before: Record<string, string | null>; after: Record<string, string | null>; ops: PatchOp[] | { text: string; /** SR-1: the comment an edit changes. */ commentId?: number } | null;
  revBefore: number | null; revAfter: number | null; commentId: number | null; draftId: number | null; pickIds: number[]; followUpId: number | null;
  status: DevOpsWriteStatus; message: string | null; undoOf: number | null; undoneBy: number | null; attempts: number; updatedAt: string;
  /** AP-1: the ask a create came from (its chat and message), so a retry never makes a second item. */
  ask?: { chatId: string; messageId: string } | null;
  /** CV-1: the conversation, commitment and suggestion a create, comment or description change came from. */
  conv?: { conversationId: number; commitmentId: number | null; suggestionId: number | null } | null;
};
/**
 * SR-1: comments don't stack with an item's other writes. Each new comment is its own stack (undo deletes only it),
 * and edits stack per comment (the newest edit of a comment is undone first). Everything else stacks per item.
 */
export function stackKey(e: Pick<DevOpsWriteEntry, "org" | "itemId" | "op" | "id" | "ops">): string {
  const base = `${e.org.toLowerCase()}#${e.itemId}`;
  if (e.op === "comment" || e.op === "undo_comment") return `${base}#new${e.id}`;
  if (e.op === "comment_edit" || e.op === "undo_comment_edit" || e.op === "comment_delete") return `${base}#c${editedComment(e.ops) ?? 0}`;
  // SR-3: putting a deleted comment back stacks with the delete it undoes (its own new comment has a new id).
  if (e.op === "undo_comment_delete") return `${base}#undel${e.id}`;
  return base;
}
/** SR-1: an edit's comment id, kept in its ops (never in the comment_id column: an older build would read that as a comment to delete). */
export function editedComment(ops: DevOpsWriteEntry["ops"] | undefined): number | null {
  const c = ops && !Array.isArray(ops) ? (ops as { commentId?: unknown }).commentId : null;
  return typeof c === "number" && Number.isSafeInteger(c) && c > 0 ? c : null;
}
/** Undo is a stack per item: the newest confirmed write that isn't an undo and isn't undone. `log` newest first. */
export function undoTops(log: readonly DevOpsWriteEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of log) {
    if (e.itemId === null) continue;
    const k = stackKey(e);
    if (out.has(k) || e.op.startsWith("undo_") || e.op === "feedback" || e.status !== "confirmed") continue;
    if (e.undoneBy === null) out.set(k, e.id);
  }
  return out;
}
export const VISIBILITY = (project: string) => `Visible to everyone with access to the ${project} project in DevOps. People following the item may get a notification from DevOps.`;

/**
 * Step 14.5 (D257): where a draft with no parent can go before it is created: open features for a story, open epics
 * for a draft feature, of its own client's loaded items, in stack rank order then id.
 */
export function parentChoices<T extends { id: number; level: string; tier?: "feature" | "epic"; stateCategory: string; order: number | null }>(items: readonly T[], draftLevel: "story" | "feature"): T[] {
  const want = draftLevel === "feature" ? "epic" : "feature";
  return items
    .filter((i) => i.level === "portfolio" && (i.tier ?? "feature") === want && isOpenCategory(i.stateCategory))
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id - b.id);
}

/**
 * PV-1 (D572): Take one: the assignee set to me (or, on undo, back to who had it; null clears it), behind the rev test.
 * The value is the DevOps uniqueName (sign-in email), the way the DevOps web UI writes it.
 */
export function assignOps(rev: number, uniqueName: string | null, had: boolean): PatchOp[] {
  if (uniqueName === null) return had ? [test(rev), { op: "remove", path: "/fields/System.AssignedTo" }] : [test(rev)];
  return [test(rev), { op: "add", path: "/fields/System.AssignedTo", value: uniqueName }];
}
/** "Sam Lee <sam@contoso.example>", the way the preview and the audit log show an assignee; null when unassigned. */
export const assigneeText = (name: string | null, email: string | null): string | null => (email ? `${name ?? email} <${email}>` : name);
/** The email out of assigneeText's form, lowercased; null when unassigned. */
export const assigneeEmail = (text: string | null | undefined): string | null => (text ? (text.match(/<([^<>\s]+@[^<>\s]+)>$/)?.[1] ?? (text.includes("@") ? text.trim() : null))?.toLowerCase() ?? null : null);

/** CV-1: a description change (description_update): the whole field replaced, written only at the revision read. */
export function descriptionOps(rev: number, field: string, html: string): PatchOp[] {
  return [test(rev), { op: "replace", path: `/fields/${field}`, value: html }];
}

// ---- AH-1 (D660): one patch per item for Ahead's change set: start, target, size and assignee behind one rev test ----

/** The labels a fields write shows and logs (the size label is the field's own name, "Story Points"). */
export const FIELD_LABEL = { start: "Start date", target: "Target date", assignee: "Assigned to", state: "State" } as const;
export type FieldSpec =
  | { kind: "date"; field: string; value: string | null; had: boolean }
  | { kind: "number"; field: string; value: number | null; had: boolean }
  /** An assignee by uniqueName (email); null is Nobody, written as add with an empty value (the Update docs' "reset an identity field"). */
  | { kind: "identity"; field: string; value: string | null; had: boolean }
  /** AH-5: a state by name (System.State always has one, so it is always a replace). */
  | { kind: "state"; field: string; value: string; had: boolean };
export function fieldsOps(rev: number, specs: readonly FieldSpec[], timeZone: string): PatchOp[] {
  const ops: PatchOp[] = [test(rev)];
  for (const f of specs) {
    const path = `/fields/${f.field}`;
    if (f.kind === "identity") ops.push({ op: "add", path, value: f.value ?? "" });
    else if (f.kind === "state") ops.push({ op: "add", path, value: f.value });
    else if (f.value === null) {
      if (f.had) ops.push({ op: "remove", path });
    } else ops.push({ op: f.had ? "replace" : "add", path, value: f.kind === "date" ? dateValue(f.value, timeZone) : f.value });
  }
  return ops;
}
/** The fields a fields write touches (reference names), from its ops. */
export const fieldRefsOf = (ops: unknown): string[] => (Array.isArray(ops) ? (ops as PatchOp[]).filter((p) => p.op !== "test" && p.path.startsWith("/fields/")).map((p) => p.path.slice(8)) : []);
