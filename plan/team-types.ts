// SW-1: the shapes of sends, commitments, priorities and asks, and what the page is shown of them. Types only (the
// page imports these; nothing here touches a store or the machine).
import type { IsoDate } from "../week/types.ts";

export type SendKind = "suggested" | "must";
export type SendState = "waiting" | "accepted" | "scheduled" | "cant" | "cancelled" | "withdrawn" | "done";
export type Person = { id: string; name: string };

export type Send = {
  id: number;
  clientKey: string;
  itemId: number;
  level: "feature" | "story";
  title: string;
  itemType: string | null;
  url: string | null;
  parentId: number | null;
  weekStart: string;
  kind: SendKind;
  note: string | null;
  /** The sender asked them to take it in DevOps: the recipient's Accept offers "Also assign to me" pre-ticked. */
  askTake: boolean;
  /** The original sender (kept through Pass to). */
  from: Person;
  /** Who passed it last, or null. */
  by: Person | null;
  to: Person;
  state: SendState;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
};
export type NewSend = Omit<Send, "id" | "by" | "state" | "reason" | "createdAt" | "updatedAt">;

export type Commitment = { personId: string; weekStart: string; clientKey: string; itemId: number; title: string; itemType: string | null; url: string | null; tier: "must" | "nice"; watching: boolean; committedAt: string };
export type NewCommitment = Omit<Commitment, "personId" | "weekStart" | "committedAt">;

export type Priority = { clientKey: string; itemId: number; title: string; itemType: string | null; url: string | null; note: string | null; flaggedBy: Person; flaggedAt: string };
export type LookAsk = { id: number; clientKey: string; weekStart: string; from: Person; to: Person; note: string | null; reply: string | null; repliedAt: string | null; createdAt: string };

/** What a send is now, as its sender, recipient or teammates see it. */
export type Shown = "waiting" | "passed" | "accepted" | "scheduled" | "cant" | "done" | "not_answered" | "cancelled" | "withdrawn";

/** The view of a send for the person looking (sender, passer or recipient). */
export type SendView = Omit<Send, "state"> & { state: Send["state"]; shown: Shown; words: string; conflict: boolean; role: "sender" | "recipient" | "passer" | "teammate"; canCancel: boolean; canWithdraw: boolean; canAnswer: boolean };
export type PriorityView = Priority & { onMyWeek: boolean; canUnflag: boolean };
export type LookView = LookAsk & { role: "asker" | "lead" };
export type CommitClient = { clientKey: string; clientName: string; isLead: boolean; leads: Person[]; incoming: SendView[]; sent: SendView[]; priorities: PriorityView[]; looks: LookView[] };
export type CommitData = { weekStart: IsoDate; clients: CommitClient[] };
export type TeamPerson = { id: string; name: string; email: string | null; lead: boolean; you: boolean; /** CF-1: "shared" when they have anything on the week, "empty" when on FocusTime with nothing on it. */ state: "shared" | "empty" | "not_on_focustime"; features: { itemId: number; title: string; itemType: string | null; url: string | null }[]; watching: { itemId: number; title: string; itemType: string | null; url: string | null; moved: boolean | null }[] };
export type TeamClient = { clientKey: string; clientName: string; people: TeamPerson[]; sends: SendView[]; priorities: PriorityView[]; looks: LookView[] };
export type TeamData = { weekStart: IsoDate; thisWeek: IsoDate; clients: TeamClient[] };
export type PickerPersonView = { id: string; name: string; email: string | null; lead: boolean; onFocusTime: boolean };

