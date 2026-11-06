// AS-1: everything the assistant may do, in one list. Each tool the model can call names the registry actions it uses
// and whether it is a read (runs at once) or a proposal (a write: shown with the button's preview, run only on
// confirm). Nothing else in the registry is reachable from the assistant; assistant/service.test.ts checks every
// action here is registered and none is on the never list (secrets, settings, admin, sign-in, data, the VM, the timer).
import type { ActionName } from "../actions/registry.ts";
import type { JsonSchema, ToolSpec } from "../ai/types.ts";

export type ToolKind = "read" | "proposal" | "stub";
export type ToolEntry = { kind: ToolKind; actions: readonly ActionName[]; spec: ToolSpec };

const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const s = (description: string): JsonSchema => ({ type: "string", description });
const sn = (description: string): JsonSchema => ({ type: ["string", "null"], description });
const id = (description: string): JsonSchema => ({ type: "integer", minimum: 1, description });
const date = (description: string): JsonSchema => ({ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description });
const half: JsonSchema = { type: "string", enum: ["AM", "PM"] };

export const TOOLS = {
  // ---- Reads ----
  today: { kind: "read", actions: ["assistant.today"], spec: { name: "today", description: "What's next for me now, what's due today, or what's due tonight (after working hours): picks, follow-ups and promises.", parameters: obj({ when: { type: "string", enum: ["now", "today", "tonight"] } }) } },
  day: { kind: "read", actions: ["lookup.day"], spec: { name: "day", description: "What I planned and did on one day: picks with done marks, focus minutes and my resume note.", parameters: obj({ date: date("The day, YYYY-MM-DD") }) } },
  item: { kind: "read", actions: ["items.get"], spec: { name: "item", description: "One DevOps work item: its state, owner, start and target dates and open children.", parameters: obj({ id: id("The work item id") }) } },
  gaps: { kind: "read", actions: ["ahead.load"], spec: { name: "gaps", description: "Features and epics of the client that have readiness gaps (needs stories, no target date, unassigned, unsized), soonest first.", parameters: obj({}) } },
  commitments: { kind: "read", actions: ["conversations.list"], spec: { name: "commitments", description: "What people committed to in the client's conversations: who, what, to whom and when.", parameters: obj({ person: sn("A person's name to narrow it to, or null for everyone") }) } },
  status: { kind: "read", actions: ["status.load"], spec: { name: "status", description: "Monday's status report (Week › Status): this week's features with how many updates each has, to write my status updates or to find the feature an update goes on.", parameters: obj({}) } },
  sends: { kind: "read", actions: ["team.commit", "send.today"], spec: { name: "sends", description: "Work I sent to someone's week and work sent to me, with each one's state.", parameters: obj({}) } },
  // ---- Proposals (writes, confirmed by the person) ----
  move_pick: { kind: "proposal", actions: ["pick.move"], spec: { name: "move_pick", description: "Propose moving one of my picks to another day and half.", parameters: obj({ pickId: id("The pick's id, from a read"), date: date("The day to move it to"), half }) } },
  drop_pick: { kind: "proposal", actions: ["pick.remove"], spec: { name: "drop_pick", description: "Propose dropping one of my picks.", parameters: obj({ pickId: id("The pick's id, from a read") }) } },
  keep_pick: { kind: "proposal", actions: ["pick.move"], spec: { name: "keep_pick", description: "Propose keeping an unfinished pick from an earlier day: it moves to today.", parameters: obj({ pickId: id("The pick's id, from a read"), half }) } },
  confirm_day: { kind: "proposal", actions: ["planday.commit"], spec: { name: "confirm_day", description: "Propose confirming a day's plan.", parameters: obj({ date: date("The day") }) } },
  confirm_week: { kind: "proposal", actions: ["weekplan.commit"], spec: { name: "confirm_week", description: "Propose confirming a week's plan.", parameters: obj({ weekStart: date("The week's Monday") }) } },
  add_must: { kind: "proposal", actions: ["weekplan.add"], spec: { name: "add_must", description: "Propose adding a DevOps feature or story to a week as a must.", parameters: obj({ itemId: id("The work item id"), weekStart: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "The week's Monday, or null for this week" } }) } },
  ahead_change: { kind: "proposal", actions: ["ahead.stage"], spec: { name: "ahead_change", description: "Propose a change to an item's start date, target date, size or owner. It goes into my Ahead change set; nothing is written to DevOps until I save the change set.", parameters: obj({ itemId: id("The work item id"), field: { type: "string", enum: ["start", "target", "size", "assignee"] }, value: sn("A date YYYY-MM-DD, a size number, a person's name, or null to clear") }) } },
  send: { kind: "proposal", actions: ["send.people", "send.create"], spec: { name: "send", description: "Propose sending a feature or story to a teammate's week (this week or next), as suggested or (leads only) must.", parameters: obj({ itemId: id("The work item id"), to: s("The person's name as I said it"), kind: { type: "string", enum: ["suggested", "must"] }, week: { type: "string", enum: ["this", "next"] }, note: sn("A short note, or null") }) } },
  comment: { kind: "proposal", actions: ["devops.preview", "devops.confirm"], spec: { name: "comment", description: "Propose adding a comment to a DevOps work item, in my words.", parameters: obj({ itemId: id("The work item id"), text: s("The comment, from what I said") }) } },
  description: { kind: "proposal", actions: ["devops.preview", "devops.confirm"], spec: { name: "description", description: "Propose a new description for a DevOps work item (the whole text after the change).", parameters: obj({ itemId: id("The work item id"), after: s("The whole description after the change") }) } },
  // TB-2: several picks at once (Check-in's Move the rest, a Teams card's choices), and Close out in one confirm.
  move_picks: { kind: "proposal", actions: ["pick.move"], spec: { name: "move_picks", description: "Propose moving several of my picks, each to a day and half.", parameters: obj({ moves: { type: "array", minItems: 1, maxItems: 12, items: obj({ pickId: id("The pick's id, from a read"), date: date("The day to move it to"), half }) } }) } },
  close_day: { kind: "proposal", actions: ["pick.mark_done", "pick.move", "closeout.commit"], spec: { name: "close_day", description: "Propose closing out a day: mark the picks I name done, move the unfinished ones into their client's next block (or the unfinished list when there is none), and mark the day closed out.", parameters: obj({ date: date("The day, YYYY-MM-DD"), donePickIds: { type: "array", maxItems: 30, items: id("A pick's id, from a read") } }) } },
  // PK-1: a to-do checked off on a Teams card offers its DevOps item's done state, and Undo offers that write's undo.
  // From buttons only (BUTTON_ONLY): never offered to the model.
  item_done: { kind: "proposal", actions: ["devops.done_offer", "devops.preview", "devops.confirm"], spec: { name: "item_done", description: "Propose setting a checked-off pick's DevOps item to its done state.", parameters: obj({ pickId: id("The pick's id, from a read"), state: sn("One of the item's done states, or null for its completed state") }) } },
  item_undo: { kind: "proposal", actions: ["devops.undo_offer", "devops.preview", "devops.confirm"], spec: { name: "item_undo", description: "Propose undoing the state change FocusTime made to an unchecked pick's DevOps item.", parameters: obj({ pickId: id("The pick's id, from a read") }) } },
  capture: { kind: "proposal", actions: ["capture.add", "capture.route", "draft.prepare"], spec: { name: "capture", description: "Propose capturing a line to sort later, or as a draft story for the client.", parameters: obj({ text: s("What to capture, in my words"), as: { type: "string", enum: ["sort_later", "draft_story"] } }) } },
  // ---- Not yet ----
  close_loop: { kind: "stub", actions: [], spec: { name: "close_loop", description: "Close a loop (a follow-up or promise). Not available yet.", parameters: obj({}) } },
} as const satisfies Record<string, ToolEntry>;

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];
export const isTool = (n: string): n is ToolName => Object.hasOwn(TOOLS, n);
/** Proposal tools that change DevOps items or the change set: their item must come from my words, the screen or a read. */
export const ITEM_TOOLS: readonly ToolName[] = ["add_must", "ahead_change", "send", "comment", "description"];
export const PICK_TOOLS: readonly ToolName[] = ["move_pick", "drop_pick", "keep_pick", "item_done", "item_undo"];
/** PK-1: tools only a button proposes (propose()), never given to the model. */
export const BUTTON_ONLY: readonly ToolName[] = ["item_done", "item_undo"];
/** TB-2: tools whose arguments carry several pick ids (each must come from a read, like PICK_TOOLS' one). */
export const PICKS_TOOLS: readonly ToolName[] = ["move_picks", "close_day"];
/**
 * TB-2: the proposals a button may ask for with propose() (no AI call): FocusTime's plan, and (PK-1) a checked-off
 * to-do's DevOps state and its undo, the same write the app's offer makes. The preview, the 15 minutes and every
 * confirm check are the same as a proposal the model made.
 */
export const PROPOSE_TOOLS = ["move_pick", "keep_pick", "drop_pick", "confirm_day", "move_picks", "close_day", "item_done", "item_undo"] as const satisfies readonly ToolName[];
export type ProposeTool = (typeof PROPOSE_TOOLS)[number];

/** Never reachable from the assistant, whatever the model asks (checked by the test against the list above). */
export const NEVER: readonly string[] = [
  "admin.", "settings.save", "secret.set", "devops.set_write_pat", "devops.clear_write_pat", "auth.", "data.", "plan.reset", "demo.set", "chats.", "requests.purge", "vm.", "timer.", "presence.", "push.",
  "assistant.ask", "assistant.confirm", "assistant.cancel", "assistant.clear", "teams.", "write.confirm", "stories.publish", "feedback.send",
];

/**
 * Every registry action the service itself may dispatch: each tool's actions, and the reads they are built on (the
 * week, Ahead's items, conversations, sends). The service's dispatch refuses anything else before it runs.
 */
export const RUNS: ReadonlySet<ActionName> = new Set<ActionName>([
  ...Object.values(TOOLS).flatMap((t) => t.actions as readonly ActionName[]),
  "week.load", "ahead.load", "conversations.list", "pick.mark_done", "closeout.commit", "team.commit", "send.today", "send.people", "devops.preview", "devops.confirm", "capture.route", "draft.prepare",
]);
