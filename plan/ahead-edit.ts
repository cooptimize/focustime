// AH-1: who may change an item's dates, size and assignee in Ahead, and the change set's values. Pure: no I/O.
//
// Who can edit (D652): a lead of the item's client (isClientLead over clientAccounts(), Internal included like any
// client), the item's owner (its Assigned To), and the owner of the item one level up: a feature's owner over its
// stories, an epic's owner over the features directly under it (never further down). Everyone can edit items assigned
// to themselves. Automation accounts never edit (guests can't sign in, D602). Levels come from the process model's
// ladder, never from type names.

export type EditWhy = "lead" | "owner" | "parent_owner";
export type EditRight = { ok: true; why: EditWhy } | { ok: false; note: string };

export type EditPerson = {
  /** My DevOps identity (email) for this client; null when FocusTime doesn't know it. */
  email: string | null;
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
  if (same(item.assigneeEmail, me.email)) return { ok: true, why: "owner" };
  // One level up only: a feature's owner over its stories, an epic's owner over its features.
  if (parent && same(parent.assigneeEmail, me.email) && item.rung !== null && parent.rung !== null && item.rung === parent.rung + 1) return { ok: true, why: "parent_owner" };
  return { ok: false, note: readOnlyNote(clientName) };
}

/** The ladder rung of a type: the index of the backlog level that holds it, or null. */
export const rungOf = (ladder: readonly (readonly string[])[], type: string): number | null => {
  const i = ladder.findIndex((r) => r.includes(type));
  return i >= 0 ? i : null;
};

// ---- The change set ----

export const CHANGE_FIELDS = ["start", "target", "size", "assignee"] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];
export type DayHalf = "AM" | "PM";

/** A person as the change set keeps an assignee: their DevOps uniqueName (email) and name; null is Nobody. */
export type Assignee = { email: string; name: string } | null;
/** A staged value: a date (start, target), a number (size) or an assignee. */
export type ChangeValue = string | number | Assignee;

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
    const ea = a && typeof a === "object" ? a.email.toLowerCase() : null;
    const eb = b && typeof b === "object" ? b.email.toLowerCase() : null;
    return ea === eb;
  }
  if (field === "size") return (typeof a === "number" ? a : null) === (typeof b === "number" ? b : null);
  return (typeof a === "string" ? a.slice(0, 10) : null) === (typeof b === "string" ? b.slice(0, 10) : null);
}

/**
 * A staged change against what DevOps has now (D654): a conflict only when this field changed in DevOps since I
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
  const order: Record<ChangeField, number> = { start: 0, target: 1, size: 2, assignee: 3 };
  return [...out.values()].sort((a, b) => a.first.localeCompare(b.first) || a.itemId - b.itemId).map(({ first: _f, ...g }) => ({ ...g, changes: g.changes.sort((a, b) => order[a.field] - order[b.field]) }));
}

/** "7 changes pending" (null at none). */
export const pendingText = (n: number) => (n <= 0 ? null : `${n} ${n === 1 ? "change" : "changes"} pending`);

/** A value in words, for the review's "before → after". */
export function valueText(field: ChangeField, v: ChangeValue | undefined, half: DayHalf | null = null): string {
  if (field === "assignee") return v && typeof v === "object" ? v.name : "Nobody";
  if (field === "size") return typeof v === "number" ? String(v) : "None";
  if (typeof v !== "string") return "None";
  const d = Temporal.PlainDate.from(v.slice(0, 10)).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return half ? `${d} ${half}` : d;
}

// ---- Filters (D650): shared by Grid and Gantt, remembered per person ----
export type AheadOwner = "mine" | "contributing" | "all";
export type AheadFilters = { owner: Record<string, AheadOwner>; clients: string[]; epic: string | null; gaps: boolean; from: string | null; to: string | null; q: string; states: string[] };
