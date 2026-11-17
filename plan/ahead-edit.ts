// AH-1: who may change an item's dates, size and assignee in Ahead, and the change set's values. Pure: no I/O.
//
// Who can edit (D656): a lead of the item's client (isClientLead over clientAccounts(), Internal included like any
// client), the item's owner (its Assigned To), and the owner of the item one level up: a feature's owner over its
// stories, an epic's owner over the features directly under it (never further down). Everyone can edit items assigned
// to themselves. Automation accounts never edit (guests can't sign in, D602). Levels come from the process model's
// ladder, never from type names.

import { cleanTitle, TITLE_MAX } from "./quick-create.ts";
import { isOpen as isOpenCategory } from "./process.ts";

export type EditWhy = "lead" | "owner" | "parent_owner";
export type EditRight = { ok: true; why: EditWhy } | { ok: false; note: string };

export type EditPerson = {
  /** My DevOps identity (email) for this client; null when FocusTime doesn't know it. */
  email: string | null;
  /** AH-3: every address that is me on this client (my own, my Dataverse DevOps email, linked client logins). */
  emails?: readonly string[];
  /** isClientLead for this client. */
  lead: boolean;
  /** An admin flagged me as an automation account (ADM-2). */
  automation: boolean;
};

export type EditItem = {
  /** The assignee's email (DevOps uniqueName), lowercased or not; null: unassigned. */
  assigneeEmail: string | null;
  /** Its rung on the process ladder (0 is the top backlog level); null when the type isn't on a backlog. */
  rung: number | null;
};

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The note a person sees on an item they can't change. */
export const readOnlyNote = (clientName: string) => `Only ${clientName}'s leads and the owner can change this.`;

/** Whether this person may change this item (with its parent, when it has one). */
export function canEdit(me: EditPerson, item: EditItem, parent: EditItem | null, clientName: string): EditRight {
  if (me.automation) return { ok: false, note: "Automation accounts don't change DevOps from FocusTime." };
  if (me.lead) return { ok: true, why: "lead" };
  const isMe = (e: string | null) => same(e, me.email) || (me.emails ?? []).some((x) => same(e, x));
  if (isMe(item.assigneeEmail)) return { ok: true, why: "owner" };
  // One level up only: a feature's owner over its stories, an epic's owner over its features.
  if (parent && isMe(parent.assigneeEmail) && item.rung !== null && parent.rung !== null && item.rung === parent.rung + 1) return { ok: true, why: "parent_owner" };
  return { ok: false, note: readOnlyNote(clientName) };
}

/** The ladder rung of a type: the index of the backlog level that holds it, or null. */
export const rungOf = (ladder: readonly (readonly string[])[], type: string): number | null => {
  const i = ladder.findIndex((r) => r.includes(type));
  return i >= 0 ? i : null;
};

// ---- The change set ----

// AH-5: state joins the change set (kept in its own table, ahead_state_changes).
// ED-2: title and parent join it (their own table, ahead_edit_changes), with ED-1's rules for each.
export const CHANGE_FIELDS = ["start", "target", "size", "assignee", "state", "title", "parent"] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];
export type DayHalf = "AM" | "PM";

/** A person as the change set keeps an assignee: their DevOps uniqueName (email) and name; null is Nobody. */
export type Assignee = { email: string; name: string } | null;
/** ED-2: a parent as the change set keeps it: the item's id and its title (for words only); null is No parent. */
export type ParentRef = { id: number; title: string } | null;
/** A staged value: a date (start, target), a number (size), an assignee, a state name (AH-5), a title or a parent (ED-2). */
export type ChangeValue = string | number | Assignee | ParentRef;
const idOf = (v: ChangeValue | undefined): number | null => (v && typeof v === "object" && "id" in v && typeof v.id === "number" ? v.id : null);
/** ED-2: the parent a value names (null: No parent, or not a parent value). */
export const parentIdIn = idOf;
/** ED-2: a title as DevOps keeps it: one line, spaces collapsed (the rule ED-1's title has, plan/quick-create.ts cleanTitle). */
const oneLine = (v: ChangeValue | undefined) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : null);

/** One pending change (one item and field), as the store keeps it for one person. */
export type StagedChange = {
  clientKey: string;
  itemId: number;
  field: ChangeField;
  value: ChangeValue;
  /** Start and target only: the half-day, kept in FocusTime for display (DevOps stores the day). */
  half: DayHalf | null;
  /** The item's revision and this field's value when I started editing it. */
  baseRev: number;
  baseValue: ChangeValue;
  /** DevOps changed this field since (a conflict): its value now. Undefined: no conflict. */
  theirs?: ChangeValue | undefined;
  createdAt: string;
  updatedAt: string;
};

/** Compare values as DevOps would store them: dates by day, sizes by number, assignees by email. */
export function sameValue(field: ChangeField, a: ChangeValue | undefined, b: ChangeValue | undefined): boolean {
  if (field === "assignee") {
    const ea = a && typeof a === "object" && "email" in a ? a.email.toLowerCase() : null;
    const eb = b && typeof b === "object" && "email" in b ? b.email.toLowerCase() : null;
    return ea === eb;
  }
  // ED-2: a title by its words (case counts: fixing a capital is a change); a parent by its id.
  if (field === "title") return oneLine(a) === oneLine(b);
  if (field === "parent") return idOf(a) === idOf(b);
  if (field === "size") return (typeof a === "number" ? a : null) === (typeof b === "number" ? b : null);
  if (field === "state") return (typeof a === "string" ? a.trim().toLowerCase() : null) === (typeof b === "string" ? b.trim().toLowerCase() : null);
  return (typeof a === "string" ? a.slice(0, 10) : null) === (typeof b === "string" ? b.slice(0, 10) : null);
}

/**
 * A staged change against what DevOps has now (D658): a conflict only when this field changed in DevOps since I
 * started editing it. Any other change to the item (a comment, the state) doesn't count: my values go on the new rev.
 */
export function conflictOf(c: Pick<StagedChange, "field" | "baseValue">, current: ChangeValue): { conflict: false } | { conflict: true; theirs: ChangeValue } {
  return sameValue(c.field, c.baseValue, current) ? { conflict: false } : { conflict: true, theirs: current };
}

/** A value checked for its field; throws a plain message when it can't be one. */
export function checkValue(field: ChangeField, v: unknown): ChangeValue {
  if (field === "start" || field === "target") {
    if (v === null) return null;
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("A date is YYYY-MM-DD");
    try {
      return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
    } catch {
      throw new Error("That isn't a real date");
    }
  }
  if (field === "size") {
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 10_000) throw new Error("A size is a number from 0 to 10000");
    return Math.round(v * 100) / 100;
  }
  if (field === "title") {
    // ED-2: ED-1's title rule, the one the story card and the New form use.
    const t = cleanTitle(v);
    if ("problem" in t) throw new Error(t.problem);
    return t.title;
  }
  if (field === "parent") {
    // ED-2: an item id, or null for No parent. Which items may be a parent is checked by the caller (its client's
    // own items, one level up, open); the title is only for words and is read again there.
    if (v === null) return null;
    const p = v as { id?: unknown; title?: unknown };
    if (typeof p !== "object" || typeof p.id !== "number" || !Number.isSafeInteger(p.id) || p.id <= 0) throw new Error("A parent is { id }, or null for No parent");
    return { id: p.id, title: typeof p.title === "string" ? p.title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) : "" };
  }
  if (field === "state") {
    // A state always has a value; which names the type takes is checked against the process model by the caller.
    if (typeof v !== "string" || !v.trim() || v.length > 128) throw new Error("A state is the name of one of the type's states");
    return v.trim();
  }
  if (v === null) return null;
  const o = v as { email?: unknown; name?: unknown };
  if (typeof o !== "object" || typeof o.email !== "string" || !/^[^\s@<>]+@[^\s@<>]+$/.test(o.email.trim()) || typeof o.name !== "string" || !o.name.trim()) throw new Error("An assignee is { email, name }, or null for Nobody");
  return { email: o.email.trim().toLowerCase().slice(0, 320), name: o.name.trim().slice(0, 200) };
}

/** Changes grouped by item, in the order they were first made. */
export function byItem(changes: readonly StagedChange[]): { clientKey: string; itemId: number; changes: StagedChange[] }[] {
  const out = new Map<string, { clientKey: string; itemId: number; changes: StagedChange[]; first: string }>();
  for (const c of changes) {
    const k = `${c.clientKey}:${c.itemId}`;
    const g = out.get(k) ?? { clientKey: c.clientKey, itemId: c.itemId, changes: [], first: c.createdAt };
    g.changes.push(c);
    if (c.createdAt < g.first) g.first = c.createdAt;
    out.set(k, g);
  }
  const order: Record<ChangeField, number> = { title: 0, parent: 1, state: 2, start: 3, target: 4, size: 5, assignee: 6 };
  return [...out.values()].sort((a, b) => a.first.localeCompare(b.first) || a.itemId - b.itemId).map(({ first: _f, ...g }) => ({ ...g, changes: g.changes.sort((a, b) => order[a.field] - order[b.field]) }));
}

/** "7 changes to save" (null at none; UI-7). */
export const pendingText = (n: number) => (n <= 0 ? null : `${n} ${n === 1 ? "change" : "changes"} to save`);

/** A value in words, for the review's "before → after". */
export function valueText(field: ChangeField, v: ChangeValue | undefined, half: DayHalf | null = null): string {
  if (field === "assignee") return v && typeof v === "object" && "name" in v ? v.name : "Nobody";
  if (field === "title") return typeof v === "string" && v ? v : "None";
  if (field === "parent") return v && typeof v === "object" && "id" in v ? `#${v.id}${v.title ? ` ${v.title}` : ""}` : "No parent";
  if (field === "size") return typeof v === "number" ? String(v) : "None";
  if (field === "state") return typeof v === "string" ? v : "None";
  if (typeof v !== "string") return "None";
  const d = Temporal.PlainDate.from(v.slice(0, 10)).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return half ? `${d} ${half}` : d;
}

// ---- Filters (D654): shared by Grid and Gantt, remembered per person ----
export type AheadOwner = "mine" | "contributing" | "all";
export type AheadFilters = { owner: Record<string, AheadOwner>; clients: string[]; epic: string | null; gaps: boolean; from: string | null; to: string | null; q: string; states: string[]; /** AH-2: "Show the whole project" (items outside Cooptimize's scope too). */ whole?: boolean; /** BH-1: Backlog's tier (stories by default; since AH-6 the shared level decides) and its Stale filter (since AH-6 in every mode). */ tier?: "epic" | "feature" | "story"; stale?: boolean; /** AH-6: a quick date range, read against today (it wins over from and to). */ range?: AheadRange; /** AH-6: which readiness gaps count for "Not ready only" (none: every kind). BL-1: the kinds within Needs attention (`gaps`). */ kinds?: AheadGapKind[]; /** BL-1: one level as a flat list. BL-2: gone; only read from a saved filter or an old link, which then becomes the level listed (Backlog drops it). */ flat?: "epic" | "feature" | "story" };
/** AH-6: the Dates filter's quick picks. */
export type AheadRange = "next2" | "next4" | "quarter";
export type AheadGapKind = "needs_stories" | "no_dates" | "unassigned" | "unsized";

// ---- ED-2: a move in the Grid, by ED-1's rules (the story card's Move…) ----

/** What a move needs to know of an item: its rung on its client's process ladder and whether it is open. */
export type MoveItem = { id: number; type: string; title: string; state: string; rung: number | null; open: boolean };

/**
 * Why this item can't go under that one (null: it can). ED-1's rule, from the process's backlog levels and never from
 * type names: the new parent is an open item exactly one level up, never the item itself; No parent is always allowed
 * for an item that has a level above it. Exactly one level up also means a move can never make a loop. Both items are
 * one client's: the caller only ever passes that client's own items.
 */
export function moveProblem(item: MoveItem, to: MoveItem | null, project: string): string | null {
  if (item.rung === null) return `${item.type} isn't a level in ${project}'s process`;
  // UC-2: the words need no "a" or "an" before a type's name, so no type reads wrong ("An User Story").
  if (item.rung === 0) return `In ${project}'s process, ${item.type} is the top level, so it has no parent to change`;
  if (!to) return null;
  if (to.id === item.id) return "An item can't be its own parent";
  if (to.rung === null || to.rung !== item.rung - 1) return `In ${project}'s process, ${to.type} isn't the level above ${item.type}`;
  if (!to.open) return `#${to.id} is ${to.state}; FocusTime moves items only under open parents`;
  return null;
}
/** An item as the move rule reads it (open by the one rule: Proposed or In Progress). */
export const moveItemFrom = (i: { id: number; type: string; title: string; state: string; rung: number | null; stateCategory: string }): MoveItem => ({ id: i.id, type: i.type, title: i.title, state: i.state, rung: i.rung, open: isOpenCategory(i.stateCategory) });
/** The items this one may move under: its client's open items exactly one level up (ED-1's picker). */
export const moveTargets = <T extends MoveItem>(items: readonly T[], item: MoveItem, project: string): T[] => items.filter((x) => moveProblem(item, x, project) === null);
