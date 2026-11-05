// SW-1: Send to someone's week. Pure: who may send what, what each side sees, and the words. A send is one feature or
// story of one client, to one Cooptimizer on that client, for this week or next, Suggested or Must.
//   Who (D631): anyone on the client (an Account Worker or a client lead, a Cooptimizer) may send a Suggested; only
//   that client's leads may send a Must (a deliberate exception to "levels are guidance": the Must label only).
//   Recipient: Accept (a must on their week), Accept and schedule, Pass to… (the original sender stays), Can't this
//   week (a reason; a Must stays as a conflict for both until it's sorted).
//   Sender: Waiting (Cancel), Accepted, Scheduled, Passed to <name>, Can't: <reason>, Done, Not answered.
// A Must counts on the recipient's week only once accepted: until then it isn't on their list at all (D633).
import type { Send, SendState } from "../store/team-store.ts";

export type SendRole = { onClient: boolean; lead: boolean; cooptimizer: boolean };

/** Why this person may not send this kind, or null. */
export function sendRefusal(kind: Send["kind"], sender: SendRole, recipient: SendRole & { onFocusTime: boolean; self: boolean }): string | null {
  if (!sender.cooptimizer) return "Only Cooptimizers send work";
  if (!sender.onClient && !sender.lead) return "Only people on this client send its work";
  if (kind === "must" && !sender.lead) return "Only this client's leads send a Must; send it as Suggested";
  if (recipient.self) return "That's you; add it to your week instead";
  if (!recipient.cooptimizer) return "Work goes only to Cooptimizers";
  if (!recipient.onClient && !recipient.lead) return "They aren't on this client";
  if (!recipient.onFocusTime) return "They aren't on FocusTime yet";
  return null;
}

/** States a send can still change from (the rest are settled). */
export const OPEN_STATES: ReadonlySet<SendState> = new Set<SendState>(["waiting", "accepted", "scheduled", "cant"]);

export type Shown =
  | "waiting"
  | "passed"
  | "accepted"
  | "scheduled"
  | "cant"
  | "done"
  | "not_answered"
  | "cancelled"
  | "withdrawn";

/** What a send is now: Done once DevOps resolved the item, Not answered once its week ended while still Waiting. */
export function shownState(s: Pick<Send, "state" | "by" | "weekStart">, o: { resolved: boolean; thisWeek: string }): Shown {
  if (s.state === "cancelled" || s.state === "withdrawn") return s.state;
  if (s.state === "done" || o.resolved) return "done";
  if (s.state === "waiting" && s.weekStart < o.thisWeek) return "not_answered";
  if (s.state === "waiting") return s.by ? "passed" : "waiting";
  return s.state;
}

/** The sender's words for a state. */
export function stateWords(s: Pick<Send, "to" | "reason">, shown: Shown): string {
  switch (shown) {
    case "waiting":
      return "Waiting";
    case "passed":
      return `Passed to ${s.to.name}`;
    case "accepted":
      return "Accepted";
    case "scheduled":
      return "Scheduled";
    case "cant":
      return `Can't: ${s.reason ?? "no reason given"}`;
    case "done":
      return "Done";
    case "not_answered":
      return "Not answered";
    case "cancelled":
      return "Cancelled";
    case "withdrawn":
      return "Withdrawn";
  }
}

/** A Must someone couldn't take: open on both sides until the sender passes or withdraws it, or they accept after all. */
export const isConflict = (s: Pick<Send, "kind" | "state">, shown: Shown) => s.kind === "must" && s.state === "cant" && shown === "cant";

/** Today's one line for the recipient: "Josh sent you Order export (Must)", or a count when there are several. */
export function todayLine(waiting: readonly Pick<Send, "from" | "title" | "kind">[]): string | null {
  if (!waiting.length) return null;
  if (waiting.length === 1) {
    const w = waiting[0]!;
    return `${first(w.from.name)} sent you ${w.title}${w.kind === "must" ? " (Must)" : ""}`;
  }
  const musts = waiting.filter((w) => w.kind === "must").length;
  return `${waiting.length} items sent to your week${musts ? ` · ${musts} Must` : ""}`;
}

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** This week and next: the only weeks a send can be for. */
export function sendWeeks(thisWeek: string): [string, string] {
  return [thisWeek, Temporal.PlainDate.from(thisWeek).add({ days: 7 }).toString()];
}

/** Who is told about an answer. The sender always; on a Must's Can't, also the other leads (Cooptimizers, never the sender twice). */
export function toldOf(s: Pick<Send, "kind" | "from" | "to">, state: "accepted" | "scheduled" | "cant" | "passed", leads: readonly string[]): { sender: string; leads: string[] } {
  const low = (x: string) => x.toLowerCase();
  const sender = low(s.from.id);
  const others = state === "cant" && s.kind === "must" ? [...new Set(leads.map(low))].filter((l) => l !== sender && l !== low(s.to.id)) : [];
  return { sender, leads: others };
}
