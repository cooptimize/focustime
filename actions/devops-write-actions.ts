// DevOps writes through the write framework (step 14). Same shape as the Outlook side (timebox-actions.ts): a named
// change with narrow inputs, a preview held on the server for five minutes (org, project, item, every field before and
// after, link changes, the identity it writes as, who can see it), a confirm that writes with a JSON Patch test on
// /rev, reads back and only then reports success, an audit log with prior values, Retry that checks before writing
// again, and Undo. Writes use the client's personal write PAT from the keyring, checked against my DevOps identity
// for that client, and go only to that client's org. The company read PAT from Dataverse is never read here: targets
// come from devopsTargets(keys, { withPat: false }). Nothing is ever deleted except a comment FocusTime added (undo).
import { typeInfo, type ItemLevel } from "./work-item-types.ts";
import { commentText, descriptionAfter, descriptionHtml, type OriginalMessage } from "../plan/conversation-draft.ts";
import { sanitizeMessageHtml } from "../plan/sanitize.ts";
import { teamsLink } from "../plan/chats.ts";
import type { ConversationView } from "../store/conversation-store.ts";
import { readBack, type Sleep } from "./readback.ts";
import type { AppConfig } from "../config/schema.ts";
import { REMAINING_LABEL, REMAINING_WORK, remainingOps } from "../plan/devopswrite.ts";
import { AC_FIELD, BATCH_LIMIT, REMOVED_COMMENT, START_FIELD, assigneeEmail, assigneeText, assignOps, alreadyDone, completedState, createOps, doneChoices, descriptionOps, textToHtml, datesOps, identityMatches, isOpenCategory, removedState, removeOps, row, stateOps, targetDateOps, undoTops, stackKey, editedComment, validOrg, VISIBILITY, FIELD_LABEL, fieldRefsOf, fieldsOps, type FieldSpec, type DevOpsWriteEntry, type ItemSnapshot, type PatchOp, type StateInfo, type WriteOp } from "../plan/devopswrite.ts";
import { dateOnly, detectTargetField, detectTypeSizeField, fieldNames, htmlToText, identityEmail, identityName, TYPE_SIZE_FIELDS, workItemUrl } from "../sources/devops/normalize.ts";
import type { TakesStore } from "../store/devops-takes.ts";
import type { ClientEntry } from "../ai/guard.ts";
import { exitCheck, nameList, NAME_REMOVED, replaceMentions } from "../plan/boundary.ts";
import { TAGS_FIELD } from "../plan/devopswrite.ts";
import { acceptanceText, BriefError, descriptionHtml as briefHtml, descriptionText, LINE_KEYS, parseBrief, readFilled, readLines, TAG_PREFIX, typeById, templateTag, type Brief, type WorkTemplates } from "../plan/work-templates.ts";
import { isCoopComment } from "../plan/status-report.ts";
import { breakdownChildTypes, ladderFromProcessConfig, levelsFromProcessConfig } from "../plan/process.ts";
import { cleanTitle, createLevelsOf, missingRequired, parentProblem } from "../plan/quick-create.ts";
import { canEdit, rungOf, sameValue, valueText, type ChangeField, type ChangeValue, type EditRight, type StagedChange } from "../plan/ahead-edit.ts";
import { addFixed, dropFixed, fills, FIXED_KEY, readFixed } from "../plan/readiness.ts";
import type { NotesStore } from "../store/devops-notes.ts";
/** WT-1: the portfolio tiers from the process model (process configuration on the write path), never type names. */
const portfolioTiers = (pc: unknown) => levelsFromProcessConfig(pc).tiers;
import { Pat } from "../sources/devops/pat.ts";
import type { DevOpsSource } from "../sources/devops/source.ts";
import type { TargetsResult } from "../sources/devops/types.ts";
import { WriteFailure, type DevOpsWriter } from "../sources/devops/write.ts";
import { PlanError, type DevOpsIdentityRow, type PlanStore } from "../store/plan-store.ts";
import type { ActionResponse, DevOpsPreview, DevOpsResult } from "./types.ts";
import { userZone } from "../week/zone.ts";
import { askDescription, askTitle, messageLink, type AskItemLevel } from "../plan/asks.ts";
import { publishAcceptance, publishDescription } from "../plan/stories.ts";
import { sizeChipText } from "../plan/estimate.ts";
import { progressComment, remainingHours } from "../plan/progress.ts";
import { minutesOf } from "../plan/timebox.ts";
import type { TeamsView } from "../store/teams-store.ts";
import type { ChatMember } from "../plan/chats.ts";
import type { ChatMessagesClient } from "../sources/graph/chats.ts";
import { readImage, type ReadImage } from "./chat-images.ts";
import { chatImageSrc } from "../plan/conversation-views.ts";
export type { DevOpsPreview, DevOpsResult };

export const DEVOPS_WRITE_ACTIONS = ["devops.set_write_pat", "devops.clear_write_pat", "devops.write_status", "devops.states", "devops.preview", "devops.confirm", "devops.retry", "devops.log", "devops.done_offer", "devops.undo_offer", "devops.progress_offer", "devops.wrap_offer"] as const;
export type DevOpsWriteAction = (typeof DEVOPS_WRITE_ACTIONS)[number];
export type { DoneOffer, UndoOffer } from "./types.ts";
import type { DoneOffer, ItemDoneOffer, ProgressOffer, UndoOffer, WrapOffer } from "./types.ts";
import { finishChoices, progressState } from "../plan/wrapup.ts";

/** The keyring for write PATs (secrets/keyring.ts). A PAT only ever comes back wrapped. */
export type WritePats = { get: (clientKey: string) => Promise<Pat>; set: (clientKey: string, value: string) => Promise<void>; clear: (clientKey: string) => Promise<void> };
export type DevOpsWriteContext = {
  plan: PlanStore | undefined;
  /** Shared polling: the Requests a create comes from, who I am, and whether I see a chat. Absent: no Requests here. */
  /** My view of the shared Requests (only chats I'm in, D521) and whether I also follow the chat's client. */
  requests?: { teams: TeamsView; sees: (chatId: string) => Promise<boolean> } | undefined;
  config: () => Promise<AppConfig | null>;
  /** Dataverse DevOps settings without the company PAT (withPat: false). */
  targets: (cfg: AppConfig, clientKeys: string[]) => Promise<TargetsResult>;
  /** Waits before a second read-back (D255); tests pass an instant one. */
  sleep?: Sleep;
  writer: DevOpsWriter | null;
  pats: WritePats | null;
  devops: ((cfg: AppConfig) => DevOpsSource) | null;
  now: () => string;
  /** CV-1: my view of the shared conversations (only chats I'm in) and what a confirmed write settles there. */
  conversations?: ConversationsPort | undefined;
  /**
   * GD-1: the client boundary for text written into a client's DevOps: whether the client is Cooptimize Internal
   * (clientAccounts()'s why "internal"), and every other client the person has (the AI guard's directory). Absent: no check.
   */
  boundary?: ((clientKey: string) => Promise<{ internal: boolean; directory: readonly ClientEntry[] }>) | undefined;
  /** PV-1: Take one's notices to the previous assignee (an app table). Absent: no notice is sent. */
  takes?: TakesStore | undefined;
  /** AH-1: Ahead's change set and who I am to it (D656, D657). Absent: no fields writes, and the target date gate is mine only. */
  ahead?: AheadPort | undefined;
  /** AH-1 (D664): notices to a new assignee and to owners whose dates moved (an app table). */
  notes?: NotesStore | undefined;
  /** CV-4: my own Chat.Read reader, for a conversation's images when I create its item (read then, never stored). */
  chatImages?: (() => Promise<ChatMessagesClient | null>) | undefined;
  /**
   * SR-1: the start of a client's status report window (Kat's last send, or Monday 7:00 AM ET). A comment_edit is
   * refused for a comment counted before it. Absent: comment edits aren't available here.
   */
  reportSince?: ((cfg: AppConfig, clientKey: string) => Promise<string>) | undefined;
  /** TP-1: the team's work templates (the four lines' request types) and the count of items created with each. Absent: no four lines here. */
  templates?: { read: () => Promise<{ doc: WorkTemplates }>; used: (tag: string, complete: boolean) => Promise<void> } | undefined;
};

/** Batch previews where one refused change doesn't stop the rest: AH-1's change set, SR-1's Push all lines. */
const PER_ITEM = new Set(["fields", "comment", "comment_edit", "comment_delete", "state", "remaining_work"]);
/** CV-4: images attached to one item at most, and the largest one (as read from Teams, after stripping). */
export const ATTACH_LIMIT = 10;
/** One image the create preview offers: from a message being included, with who sent it and when. */
type AttachOffer = { id: number; messageId: string; sender: string; at: string; description: string | null };
/** CV-4: an AttachedFile relation in a patch (the upload's URL, and the attachment id inside it). */
const ATTACHED = "AttachedFile";
const attachmentId = (url: string) => /\/attachments\/([0-9a-fA-F-]{36})/.exec(url)?.[1]?.toLowerCase() ?? null;
export const attachedUrls = (ops: DevOpsWriteEntry["ops"]): string[] =>
  Array.isArray(ops) ? ops.flatMap((p) => (p.op === "add" && p.path === "/relations/-" && (p.value as { rel?: unknown })?.rel === ATTACHED ? [String((p.value as { url: unknown }).url)] : [])) : [];

/** AH-1: what the write framework needs from Ahead. */
export type AheadPort = {
  /** My pending changes for one item. */
  staged: (clientKey: string, itemId: number) => Promise<StagedChange[]>;
  /** DevOps changed a field since I started editing it. */
  conflict: (clientKey: string, itemId: number, field: ChangeField, theirs: ChangeValue) => Promise<void>;
  /** A change landed: it leaves the change set, and a date's half stays in FocusTime. */
  landed: (clientKey: string, itemId: number, field: ChangeField) => Promise<void>;
  setHalf: (clientKey: string, itemId: number, field: "start" | "target", day: string | null, half: "AM" | "PM" | null) => Promise<void>;
  isLead: (clientKey: string) => Promise<boolean>;
  automation: () => Promise<boolean>;
  /** The read-back goes straight into the central store and its change log. */
  stored?: (clientKey: string, value: { id: number; fields: Record<string, unknown> }) => Promise<void>;
  /** QC-1: whom a new item may be assigned to (anyone on the client's DevOps project, as Ahead's picker lists them). Missing: only me. */
  assignable?: (clientKey: string, email: string) => Promise<boolean>;
  /** AH-5: a new assignee who isn't a Cooptimizer gets no FocusTime notice (and no devops_notes row). Missing: everyone does. */
  isCooptimizer?: (clientKey: string, email: string) => Promise<boolean>;
};

/** CV-1: what the write framework needs from Conversations. */
export type ConversationsPort = {
  /** My Entra object id (suggestions are for one person). */
  me: string;
  view: ConversationView;
  /** A create from a conversation landed: its commitment Created, the conversation Tracked, for everyone. */
  created: (conv: NonNullable<DevOpsWriteEntry["conv"]>, item: { id: number; url: string; title: string }) => Promise<void>;
  /** Its undo landed: open again. */
  uncreated: (conv: NonNullable<DevOpsWriteEntry["conv"]>, itemId: number) => Promise<void>;
  /** A suggested comment or description change was written. */
  posted: (suggestionId: number, writeId: number) => Promise<void>;
};

export const PREVIEW_MS = 5 * 60_000;
const cleanTitleText = (t: string) => t.replace(/\s+/g, " ").trim();
const msOf = (stamp: string) => Date.parse(String(stamp).replace(/\[.*\]$/, ""));
/** QC-1: a confirmed create of the same title, type and parent this recently counts as a twin (a lost response, a second tab). */
const TWIN_MS = 15 * 60_000;
/**
 * QC-1: a create that would make a second item: the draft already in DevOps or on its way, or the same title, type and
 * parent pending, maybe landed, or confirmed in the last minutes (not undone). Checked at the preview and again at confirm.
 */
async function twinOf(plan: PlanStore, c: { clientKey: string; title: string; type: string; parentId: number | null; draftId: number | null }, nowMs: number): Promise<{ message: string } | null> {
  if (c.draftId !== null) {
    const d = await plan.getDraft(c.draftId);
    if (d?.devopsId) return { message: `"${d.title}" is already in DevOps as #${d.devopsId}` };
  }
  const e = (await plan.devopsWriteLog(200)).find((x) => x.op === "create" && x.clientKey === c.clientKey && x.undoneBy === null && ((c.draftId !== null && x.draftId === c.draftId && x.status !== "failed" && x.status !== "refused") || (x.title === c.title && x.after.Type === c.type && x.parentId === c.parentId && (x.status === "pending" || x.status === "unconfirmed" || (x.status === "confirmed" && nowMs - msOf(x.updatedAt) < TWIN_MS)))));
  if (!e) return null;
  return { message: e.status === "confirmed" ? `"${e.title}" is already in DevOps as #${e.itemId}` : `"${e.title}" may already be in DevOps. Retry it in Settings > Data > Audit log: it checks first and won't make a second one` };
}
type Held = {
  id: string; expiresAt: number; clientKey: string; org: string; project: string; projectName: string; op: WriteOp; itemId: number | null; parentId: number | null; title: string;
  identity: string; ops: PatchOp[] | { text: string; commentId?: number } | null; rev: number | null; before: Record<string, string | null>; after: Record<string, string | null>;
  draftId: number | null; followUpId: number | null; undoOf: number | null; commentId: number | null; pickIds: number[]; type: string | null; field: string | null;
  /** The Request a create comes from (stored as "ask" in the write log). */
  ask: { chatId: string; messageId: string } | null;
  /** DS-1: the Draft stories card a create comes from, tied to its write before it is sent. */
  proposal?: { draftId: string; proposalId: string } | null;
  /** CV-1: the conversation, commitment and suggestion it comes from. */
  conv?: DevOpsWriteEntry["conv"];
  /** QC-1: a New form create, checked again for a twin at confirm. */
  quick?: boolean;
  /** QC-1: the text is the draft's AI version (GD-2 point 5: another client's name is always replaced, never sent on a confirm). */
  aiText?: boolean;
  /** AH-1: extra lines for the preview (a kept half-day, who gets a notice). */
  notes?: string[];
  /** CV-4: the conversation's images offered, and the ones ticked (uploaded on confirm with my token). */
  attach?: { offered: AttachOffer[]; ticked: number[] };
  /** GD-2: the other clients the text names (shown in the preview); Confirm needs mentionsOk while any are left. */
  mentions?: string[];
};
const held = new Map<string, Held>();
export const clearDevopsPreviews = () => held.clear();

class Invalid extends Error {}
const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });
type Obj = Record<string, unknown>;
function fields(input: unknown, required: string[], optional: string[] = []): Obj {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Invalid("input must be an object");
  const o = input as Obj;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) throw new Invalid(`unknown input field ${k}`);
  for (const k of required) if (o[k] === undefined) throw new Invalid(`${k} is required`);
  return o;
}
const posId = (v: unknown, name: string) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
};
const str = (v: unknown, name: string, max: number, optional = false): string | null => {
  if (optional && (v === undefined || v === null || v === "")) return null;
  if (typeof v !== "string" || !v.trim()) throw new Invalid(`${name} must be text`);
  if (v.trim().length > max) throw new Invalid(`${name} is at most ${max} characters`);
  return v.trim();
};
const isoDate = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid(`${name} must be YYYY-MM-DD`);
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
  } catch {
    throw new Invalid(`${name} must be a real date`);
  }
};

const NO_PAT = (client: string) => `DevOps writes aren't enabled for ${client}. Enter your own DevOps PAT in Settings > Clients > DevOps write access`;
const SUMMARY: Record<WriteOp, string> = {
  state: "Change the state of a DevOps item", comment: "Add a comment to a DevOps item", create: "Create a DevOps item", target_date: "Set a target date in DevOps",
  undo_state: "Undo: put the state back", undo_comment: "Undo: delete the comment FocusTime added", undo_create: "Undo: set the created item to Removed", undo_target_date: "Undo: put the target date back",
  description: "Change a DevOps item's description", undo_description: "Undo: put the description back",
  assign: "Assign a DevOps story or feature to you", undo_assign: "Undo: give it back to who had it",
  fields: "Change dates, state, size or owner in DevOps", undo_fields: "Undo: put the dates, state, size and owner back",
  feedback: "Send feedback to the FocusTime backlog",
  comment_edit: "Edit your comment on a DevOps item", undo_comment_edit: "Undo: put your comment's earlier text back",
  comment_delete: "Delete your comment on a DevOps item", undo_comment_delete: "Undo: post your deleted comment's text again",
  remaining_work: "Update Remaining Work in DevOps", undo_remaining_work: "Undo: put Remaining Work back",
};

export async function devopsWriteAction(ctx: DevOpsWriteContext, action: DevOpsWriteAction, input: unknown): Promise<ActionResponse> {
  try {
    return await run(ctx, action, input);
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    if (e instanceof Refused) return bad(e.message, e.status, e.code);
    if (e instanceof WriteFailure) return bad(e.message, e.kind === "changed" ? 409 : e.kind === "network" ? 503 : 422, e.kind === "changed" ? "changed" : undefined);
    throw e;
  }
}
class Refused extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status = 409, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Env = { reportSince: DevOpsWriteContext["reportSince"]; cfg: AppConfig; clientKey: string; org: string; project: string; projectName: string; pat: Pat; me: DevOpsIdentityRow; writer: DevOpsWriter; plan: PlanStore; requests: DevOpsWriteContext["requests"]; conversations: DevOpsWriteContext["conversations"]; ahead: AheadPort | undefined; clientName: string; /** QC-1: the clock, for the twin check. */ now: () => string; /** TP-1 */ templates: DevOpsWriteContext["templates"] };

/** The client's org and project (never its company PAT) and my write PAT, checked to belong together. */
async function envFor(ctx: DevOpsWriteContext, plan: PlanStore, cfg: AppConfig, clientKey: string): Promise<Env> {
  const clientName = (k: string) => cfg.clientSettings[k]?.name ?? k;
  if (!ctx.writer || !ctx.pats) throw new Refused("DevOps writes aren't available here", 503);
  const me = (await plan.devopsIdentity(clientKey));
  if (!me) throw new Refused(NO_PAT(clientName(clientKey)), 409, "no_write_pat");
  const t = await ctx.targets(cfg, [clientKey]).catch(() => null);
  if (!t?.ok) throw new Refused(`DevOps settings for ${clientName(clientKey)} can't be read from Dataverse now. Try again`, 503);
  const target = t.targets.find((x) => x.clientKey === clientKey);
  if (!target || target.problem || !validOrg(target.org) || !target.project) throw new Refused(`DevOps isn't set up for ${clientName(clientKey)}`, 409);
  // The PAT was checked on one org; a client whose org changed since must be checked again.
  if (target.org.toLowerCase() !== me.org.toLowerCase()) throw new Refused(`${clientName(clientKey)}'s DevOps organization changed. Enter the write PAT again in Settings > Clients`, 409, "no_write_pat");
  if (!target.email || target.email.toLowerCase() !== me.email.toLowerCase()) throw new Refused(`Your DevOps identity for ${clientName(clientKey)} in Dataverse no longer matches the write PAT (${me.email}). Enter it again in Settings > Clients`, 409, "no_write_pat");
  let pat: Pat;
  try {
    pat = await ctx.pats.get(clientKey);
  } catch {
    throw new Refused(NO_PAT(clientName(clientKey)), 409, "no_write_pat");
  }
  return { reportSince: ctx.reportSince, cfg, clientKey, org: target.org, project: target.project, projectName: target.projectName ?? target.project, pat, me, writer: ctx.writer, plan, requests: ctx.requests, conversations: ctx.conversations, ahead: ctx.ahead, clientName: clientName(clientKey), now: ctx.now, templates: ctx.templates };
}

async function run(ctx: DevOpsWriteContext, action: DevOpsWriteAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const tz = userZone(cfg);
  const clientName = (k: string) => cfg.clientSettings[k]?.name ?? k;

  const envOf = (clientKey: string) => envFor(ctx, plan, cfg, clientKey);

  switch (action) {
    case "devops.set_write_pat": {
      const o = fields(input, ["clientKey"], ["pat", "expires"]);
      const clientKey = str(o.clientKey, "clientKey", 100)!;
      const expires = o.expires === undefined || o.expires === null || o.expires === "" ? null : isoDate(o.expires, "expires");
      if (o.pat === undefined) {
        // Only the expiry changes.
        const cur = (await plan.devopsIdentity(clientKey));
        if (!cur) throw new Refused("Enter the PAT first", 409);
        return { ok: true, data: { write: writeView((await plan.setDevopsIdentity({ ...cur, expires }))) } };
      }
      if (typeof o.pat !== "string" || !o.pat || o.pat.length > 1024 || /\s/.test(o.pat)) throw new Invalid("The PAT must be one line of 1 to 1024 characters with no spaces");
      if (!ctx.writer || !ctx.pats) return bad("DevOps writes aren't available here", 503);
      const candidate = new Pat(o.pat);
      const t = await ctx.targets(cfg, [clientKey]).catch(() => null);
      if (!t?.ok) return bad(`DevOps settings for ${clientName(clientKey)} can't be read from Dataverse now, so the PAT can't be checked. Nothing was saved`, 503);
      const target = t.targets.find((x) => x.clientKey === clientKey);
      if (!target || !validOrg(target.org)) return bad(`DevOps isn't set up for ${clientName(clientKey)} in Dataverse. Nothing was saved`, 409);
      if (!target.email) return bad(`Your DevOps identity for ${clientName(clientKey)} is missing in Dataverse (Account Worker DevOps email), so the PAT can't be checked. Nothing was saved`, 409);
      let who;
      try {
        who = await ctx.writer.identity(target.org, candidate);
      } catch (e) {
        return bad(e instanceof WriteFailure && e.kind === "auth" ? `DevOps didn't accept this PAT for ${target.org}. Nothing was saved` : e instanceof WriteFailure ? `${e.message}. Nothing was saved` : "The PAT couldn't be checked. Nothing was saved", 422);
      }
      if (!who) return bad(`DevOps didn't say who this PAT belongs to on ${target.org}. Nothing was saved`, 422);
      if (!identityMatches(who, target.email)) return bad(`This PAT belongs to ${who.name} (${who.email}), not your DevOps identity for ${clientName(clientKey)} (${target.email}). Nothing was saved`, 422, "identity_mismatch");
      try {
        await ctx.pats.set(clientKey, o.pat);
      } catch {
        return bad("The keyring refused the PAT (locked or unavailable). Unlock it and try again", 503);
      }
      return { ok: true, data: { write: writeView((await plan.setDevopsIdentity({ clientKey, org: target.org, id: who.id, name: who.name, email: who.email, expires }))) } };
    }
    case "devops.clear_write_pat": {
      const o = fields(input, ["clientKey"]);
      const clientKey = str(o.clientKey, "clientKey", 100)!;
      if (ctx.pats) await ctx.pats.clear(clientKey).catch(() => undefined);
      (await plan.clearDevopsIdentity(clientKey));
      return { ok: true, data: { write: null } };
    }
    case "devops.write_status": {
      fields(input ?? {}, []);
      return { ok: true, data: { clients: (await plan.devopsIdentities()).map(writeView) } };
    }
    case "devops.states": {
      // The states of an item's type with their categories, for the state picker (completed one first offered).
      const o = fields(input, ["clientKey", "itemId"]);
      const env = await envOf(str(o.clientKey, "clientKey", 100)!);
      const item = await env.writer.item(env.org, env.pat, env.project, posId(o.itemId, "itemId"));
      const states = await env.writer.states(env.org, env.pat, env.project, item.type);
      return { ok: true, data: { itemId: item.id, type: item.type, state: item.state, title: item.title, states, completed: completedState(states) } };
    }
    case "devops.log": {
      fields(input ?? {}, [], ["limit"]);
      const log = (await plan.devopsWriteLog(200));
      const tops = undoTops(log);
      // UI-8: Send feedback's creates are listed with neither Undo nor Retry (F1 never deletes and never resends on its own).
      return { ok: true, data: { entries: log.map((e) => (e.op === "feedback" ? { ...e, undoable: false, retryable: false } : { ...e, undoable: !!e.itemId && tops.get(stackKey(e)) === e.id && !e.op.startsWith("undo_"), retryable: e.status === "unconfirmed" || e.status === "failed" || e.status === "pending" })) } };
    }
    case "devops.done_offer": {
      // PK-1: read only. For to-dos just checked done: which items to offer "Set #id to <done state>?" for. Only a
      // to-do with a DevOps item, with my write PAT for its client, whose item isn't done or removed already and that
      // the shared canEdit lets me change; the choices come from its type's states (Completed, then Resolved).
      // AS-2: or items by id ({ clientKey, itemIds }), for "mark #id complete" with no to-do: the same rights check and
      // the same done states from the item's type (the process model), never a hard-coded state name.
      if (typeof input === "object" && input !== null && "itemIds" in input) {
        const q = fields(input, ["clientKey", "itemIds"]);
        if (!Array.isArray(q.itemIds) || q.itemIds.length === 0 || q.itemIds.length > 10) throw new Invalid("itemIds needs 1 to 10 items");
        const clientKey = str(q.clientKey, "clientKey", 100)!;
        const env = await envOf(clientKey).catch(() => null);
        if (!env) return { ok: true, data: { itemOffers: [], why: "DevOps writes aren't on for this client" } };
        const memo = new Map<string, Promise<unknown>>();
        const itemOffers: ItemDoneOffer[] = [];
        let why: string | null = null;
        for (const raw of [...new Set(q.itemIds)]) {
          try {
            const item = await env.writer.item(env.org, env.pat, env.project, posId(raw, "itemIds"));
            const states = await env.writer.states(env.org, env.pat, env.project, item.type);
            const choices = doneChoices(states);
            if (!choices.length) { why = `${item.type} has no done state in this process`; continue; }
            if (alreadyDone(states, item.state)) { why = `#${item.id} is ${item.state} already`; continue; }
            if (!(await rightsOn(env, item, memo)).ok) { why = `You can't change #${item.id}`; continue; }
            itemOffers.push({ clientKey, clientName: env.clientName, itemId: item.id, title: item.title, type: item.type, state: item.state, choices });
          } catch {
            why = "DevOps couldn't read that item now";
          }
        }
        return { ok: true, data: { itemOffers, why } };
      }
      const o = fields(input, ["pickIds"]);
      if (!Array.isArray(o.pickIds) || o.pickIds.length === 0 || o.pickIds.length > 30) throw new Invalid("pickIds needs 1 to 30 to-dos");
      const ids = [...new Set(o.pickIds.map((x) => posId(x, "pickIds")))];
      if (cfg.plan.devopsOnDone === "never") return { ok: true, data: { offers: [], off: true } };
      const picks = (await Promise.all(ids.map((i) => plan.getPick(i)))).filter((p): p is NonNullable<typeof p> => !!p && p.kind === "item" && p.itemId !== null && p.status === "done");
      const offers: DoneOffer[] = [];
      // The rule's "Update DevOps #id" follow-up for a to-do done here: the write closes it once DevOps shows the change.
      const owed = picks.length ? (await plan.openFollowUps()).filter((f) => f.kind === "devops_update") : [];
      const byClient = new Map<string, typeof picks>();
      for (const p of picks) byClient.set(p.clientKey, [...(byClient.get(p.clientKey) ?? []), p]);
      for (const [clientKey, list] of byClient) {
        // No write PAT, or DevOps not set up for the client: no offer (the client stays read-only, as everywhere).
        const env = await envOf(clientKey).catch(() => null);
        if (!env) continue;
        const memo = new Map<string, Promise<unknown>>();
        for (const p of list) {
          try {
            const item = await env.writer.item(env.org, env.pat, env.project, p.itemId!);
            const states = await env.writer.states(env.org, env.pat, env.project, item.type);
            const choices = doneChoices(states);
            if (!choices.length || alreadyDone(states, item.state)) continue;
            if (!(await rightsOn(env, item, memo)).ok) continue;
            const followUpId = owed.find((f) => f.ruleKey === `devops_update:${p.id}` || (f.clientKey === clientKey && f.itemId === item.id))?.id ?? null;
            offers.push({ pickId: p.id, clientKey, clientName: env.clientName, itemId: item.id, title: item.title, type: item.type, state: item.state, choices, followUpId });
          } catch {
            // An item DevOps can't read now gets no offer; the tick itself stands.
          }
        }
      }
      return { ok: true, data: { offers, off: false } };
    }
    case "devops.wrap_offer": {
      // FN-1: read only. What Wrap it up can offer for one item: its done states from the process model (Completed,
      // then Resolved; the one I used most on this client chosen), the In Progress state a New item moves to on
      // Made progress, whether its type has Remaining Work, whether canEdit lets me change it, and its parent for
      // "Also add to <feature>'s status". No write PAT: no offer, with the reason (the tick still works).
      const o = fields(input, ["clientKey", "itemId"]);
      const clientKey = str(o.clientKey, "clientKey", 100)!;
      const itemId = posId(o.itemId, "itemId");
      let env: Env;
      try {
        env = await envOf(clientKey);
      } catch (e) {
        if (e instanceof Refused) return { ok: true, data: { offer: null, why: e.message, code: e.code ?? null } };
        throw e;
      }
      const item = await env.writer.item(env.org, env.pat, env.project, itemId);
      const [states, typeHas, right, log] = await Promise.all([
        env.writer.states(env.org, env.pat, env.project, item.type),
        env.writer.typeFields(env.org, env.pat, env.project, item.type),
        rightsOn(env, item, new Map()),
        plan.devopsWriteLog(200),
      ]);
      const used: Record<string, number> = {};
      for (const e of log) if (e.op === "state" && e.clientKey === clientKey && e.status === "confirmed" && e.after.State) used[e.after.State] = (used[e.after.State] ?? 0) + 1;
      const fin = finishChoices(states, used);
      const rw = item.fields[REMAINING_WORK];
      const parent = item.parentId ? await env.writer.item(env.org, env.pat, env.project, item.parentId).catch(() => null) : null;
      const offer: WrapOffer = {
        clientKey, clientName: env.clientName, itemId: item.id, title: item.title, type: item.type, state: item.state,
        done: alreadyDone(states, item.state), choices: fin.choices, chosen: fin.chosen, activate: progressState(states, item.state),
        hasRemaining: typeHas.has(REMAINING_WORK), remaining: typeof rw === "number" && Number.isFinite(rw) ? rw : null,
        canEdit: right.ok, editNote: right.ok ? null : right.note,
        parent: parent ? { id: parent.id, title: parent.title, type: parent.type } : null,
      };
      return { ok: true, data: { offer, why: null, code: null } };
    }
    case "devops.progress_offer": {
      // TX-1: read only. End of day, once: the stories answered "partly" today (or "went to plan" with time left), each
      // as Remaining Work where its type has the field, else a short comment. Only items I can change, with my write PAT.
      const o = fields(input, ["date"]);
      const date = isoDate(o.date, "date");
      if (!cfg.plan.progressOffer) return { ok: true, data: { offers: [], off: true } };
      if ((await plan.marked("progress_offer", date)) || (await plan.day(date))?.closedOutAt) return { ok: true, data: { offers: [], off: false } };
      const worked = new Map<number, number>();
      for (const t of await plan.timeboxesBetween(date, date)) if (t.settled === "partly" && t.sessionPickId) worked.set(t.sessionPickId, (worked.get(t.sessionPickId) ?? 0) + minutesOf(t));
      const picks = (await Promise.all([...worked.keys()].map((i) => plan.getPick(i)))).filter((p): p is NonNullable<typeof p> => !!p && p.kind === "item" && p.itemId !== null && p.status === "planned" && (p.remainingMinutes ?? 0) > 0);
      const offers: ProgressOffer[] = [];
      const byClient = new Map<string, typeof picks>();
      for (const p of picks) byClient.set(p.clientKey, [...(byClient.get(p.clientKey) ?? []), p]);
      for (const [clientKey, list] of byClient) {
        const env = await envOf(clientKey).catch(() => null);
        if (!env) continue;
        const memo = new Map<string, Promise<unknown>>();
        for (const p of list) {
          try {
            const item = await env.writer.item(env.org, env.pat, env.project, p.itemId!);
            const states = await env.writer.states(env.org, env.pat, env.project, item.type);
            if (alreadyDone(states, item.state) || !(await rightsOn(env, item, memo)).ok) continue;
            const typeHas = await env.writer.typeFields(env.org, env.pat, env.project, item.type);
            const workedMinutes = worked.get(p.id)!;
            const leftMinutes = p.remainingMinutes!;
            offers.push({ pickId: p.id, clientKey, clientName: env.clientName, itemId: item.id, title: item.title, type: item.type, mode: typeHas.has(REMAINING_WORK) ? "remaining" : "comment", workedMinutes, leftMinutes, hours: remainingHours(leftMinutes), text: progressComment(workedMinutes, leftMinutes) });
          } catch {
            // An item DevOps can't read now just isn't offered.
          }
        }
      }
      return { ok: true, data: { offers, off: false } };
    }
    case "devops.undo_offer": {
      // PK-1: read only. A to-do unchecked: the state write its offer made, while it is still the newest write on
      // the item (the undo stack's top) and confirmed, from the last 12 hours. Undo itself is the write's own undo.
      const o = fields(input, ["pickId"]);
      const pickId = posId(o.pickId, "pickId");
      const p = await plan.getPick(pickId);
      if (!p || p.itemId === null) return { ok: true, data: { offer: null } };
      const log = await plan.devopsWriteLog(200);
      const tops = undoTops(log);
      const since = Temporal.Instant.from(ctx.now()).subtract({ hours: 12 });
      // FN-1: Wrap it up's writes for this to-do too (its state and Remaining Work), newest first, one at a time: the
      // undo stack takes them in order, so each Undo offers the next.
      const e = log.find((x) => (x.op === "state" || x.op === "remaining_work") && x.itemId === p.itemId && x.clientKey === p.clientKey && x.pickIds.includes(pickId) && x.status === "confirmed" && x.undoneBy === null);
      if (!e || tops.get(stackKey(e)) !== e.id || Temporal.Instant.compare(Temporal.Instant.from(e.at), since) < 0) return { ok: true, data: { offer: null } };
      const label = e.op === "state" ? null : REMAINING_LABEL;
      const offer: UndoOffer = { pickId, writeId: e.id, clientKey: e.clientKey, clientName: clientName(e.clientKey), itemId: e.itemId, title: e.title, before: label ? `${label} ${e.before[label] ?? "empty"}` : (e.before.State ?? null), after: label ? `${label} ${e.after[label] ?? "empty"}` : (e.after.State ?? null) };
      return { ok: true, data: { offer } };
    }
    case "devops.preview": {
      const o = fields(input, ["clientKey"], ["change", "changes"]);
      const clientKey = str(o.clientKey, "clientKey", 100)!;
      if ((o.change === undefined) === (o.changes === undefined)) throw new Invalid("devops.preview takes { change } or { changes }");
      const list = o.changes !== undefined ? o.changes : [o.change];
      if (!Array.isArray(list) || list.length === 0) throw new Invalid("changes needs at least one change");
      if (list.length > BATCH_LIMIT) throw new Invalid(`At most ${BATCH_LIMIT} DevOps changes at once`);
      const env = await envOf(clientKey);
      const previews: DevOpsPreview[] = [];
      const nothing: string[] = [];
      // DS-1: a batch reads the same parent and process once.
      const memo = new Map<string, Promise<unknown>>();
      // AH-1: a change set's items are previewed one by one; one that's refused (a conflict, no right) doesn't stop the rest.
      const refused: { itemId: number | null; error: string; code: string | null; key?: string }[] = [];
      for (const c0 of list) {
        // GD-2: a change may ask for another client's names to be replaced ("replace", the preview's one click).
        const { mentions: wants, ...c } = (c0 && typeof c0 === "object" && !Array.isArray(c0) ? c0 : {}) as Obj;
        if (wants !== undefined && wants !== "replace") throw new Invalid('mentions is "replace"');
        let h: HeldIn | string;
        try {
          h = await previewOne(env, c0 && typeof c0 === "object" && !Array.isArray(c0) ? c : c0, tz, memo);
          if (typeof h !== "string") h = await withBoundary(ctx, env, h, wants === "replace" || h.aiText === true);
        } catch (e) {
          if (o.changes !== undefined && (e instanceof Refused || e instanceof WriteFailure || e instanceof Invalid) && PER_ITEM.has(String((c as { kind?: unknown })?.kind))) {
            // SR-1: Push all's lines carry a key back, so each refusal lands on its own line.
            const k = (c as { key?: unknown }).key;
            refused.push({ itemId: typeof (c as { itemId?: unknown }).itemId === "number" ? ((c as { itemId: number }).itemId) : null, error: e.message, code: e instanceof Refused ? (e.code ?? null) : e instanceof WriteFailure ? e.kind : null, ...(typeof k === "string" ? { key: k } : {}) });
            continue;
          }
          throw e;
        }
        const key = typeof (c as { key?: unknown })?.key === "string" ? ((c as { key: string }).key) : null;
        if (typeof h === "string") nothing.push(h);
        else previews.push(key ? { ...hold(h, env), key } : hold(h, env));
      }
      return { ok: true, data: o.changes !== undefined ? { previews, nothing, refused } : previews[0] ? { preview: previews[0] } : { nothing: nothing[0] ?? "Nothing to change" } };
    }
    case "devops.confirm": {
      const o = fields(input, [], ["previewId", "previewIds", "mentionsOk"]);
      if (o.mentionsOk !== undefined && typeof o.mentionsOk !== "boolean") throw new Invalid("mentionsOk must be true or false");
      if ((o.previewId === undefined) === (o.previewIds === undefined)) throw new Invalid("devops.confirm takes { previewId } or { previewIds }");
      const ids = o.previewIds !== undefined ? o.previewIds : [o.previewId];
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > BATCH_LIMIT) throw new Invalid(`previewIds needs 1 to ${BATCH_LIMIT} previews`);
      const results: (DevOpsResult | { error: string; status: number; code?: string })[] = [];
      for (const id of ids) {
        if (typeof id !== "string") throw new Invalid("previewId must be text");
        const h = held.get(id);
        // GD-2 point 6: text naming another client goes only once the person has seen the flag and said so (the
        // preview stays, so Confirm can be pressed again with mentionsOk). AI text was already scrubbed (point 5).
        if (h && h.expiresAt >= Date.now() && h.mentions?.length && o.mentionsOk !== true) {
          results.push({ error: `This mentions ${nameList(h.mentions)}. Replace it with "another client", or confirm you mean to save it to ${clientName(h.clientKey)}'s DevOps`, status: 409, code: "mentions" });
          continue;
        }
        held.delete(id);
        if (!h || h.expiresAt < Date.now()) {
          results.push({ error: "That preview has expired. Review the change again", status: 410 });
          continue;
        }
        try {
          const env = await envOf(h.clientKey);
          // DS-1: a card that already has a write is never sent again (Retry checks that one instead).
          // QC-1: two tabs, or a lost answer: a New form create is checked for a twin again just before it is sent.
          if (h.quick && h.type) {
            const twin = await twinOf(plan, { clientKey: h.clientKey, title: h.title, type: h.type, parentId: h.parentId, draftId: h.draftId }, msOf(ctx.now()));
            if (twin) {
              results.push({ error: twin.message, status: 409, code: "pending_write" });
              continue;
            }
          }
          if (h.proposal && (await plan.storyDraftWrites(h.proposal.draftId)).has(h.proposal.proposalId)) {
            results.push({ error: `"${h.title}" was already sent. Retry it; it checks first and won't make a second one`, status: 409 });
            continue;
          }
          const entry = (await plan.logDevopsWrite({ clientKey: h.clientKey, org: h.org, project: h.project, op: h.op, itemId: h.itemId, parentId: h.parentId, title: h.title, identity: env.me.email, before: h.before, after: h.after, ops: h.ops, revBefore: h.rev, revAfter: null, commentId: h.commentId, draftId: h.draftId, pickIds: h.pickIds, followUpId: h.followUpId, undoOf: h.undoOf, ask: h.op === "create" ? h.ask : null, conv: h.conv ?? null }));
          if (h.proposal) await plan.linkStoryDraftWrite(h.proposal.draftId, h.proposal.proposalId, entry.id);
          // CV-4: the ticked images are read now with my token, uploaded, and linked in the same create patch.
          if (h.op === "create" && h.attach?.ticked.length) {
            const a = await attachImages(ctx, env, entry, h.attach, tz);
            const r = await attempt(ctx, env, a.entry, false, tz);
            results.push({ ...r, message: `${r.message}${a.attached ? ` with ${a.attached === 1 ? "1 image" : `${a.attached} images`}` : ""}${a.failed ? `. ${a.failed === 1 ? "1 image" : `${a.failed} images`} couldn't be read from Teams or uploaded, so ${a.failed === 1 ? "it was" : "they were"} left out` : ""}` });
          } else results.push(await attempt(ctx, env, entry, false, tz));
        } catch (e) {
          if (e instanceof Refused) results.push({ error: e.message, status: e.status });
          else throw e;
        }
      }
      if (o.previewIds !== undefined) return { ok: true, data: { results } };
      const r = results[0]!;
      return "error" in r ? bad(r.error, r.status, "code" in r ? r.code : undefined) : { ok: true, data: r };
    }
    case "devops.retry": {
      const o = fields(input, ["id"]);
      const entry = (await plan.devopsWrite(posId(o.id, "id")));
      if (!entry) throw new PlanError("No such write");
      if (entry.op === "feedback") throw new Refused("Feedback isn't sent again from here. Send it again from ⋯ › Send feedback", 409);
      if (entry.status === "confirmed" || entry.status === "refused") return { ok: true, data: { entry, confirmed: entry.status === "confirmed", message: entry.status === "confirmed" ? "Already confirmed" : entry.message ?? "Refused" } satisfies DevOpsResult };
      const env = await envOf(entry.clientKey);
      if (env.org.toLowerCase() !== entry.org.toLowerCase()) throw new Refused("This write was for another organization", 409);
      return { ok: true, data: await attempt(ctx, env, entry, true, tz) };
    }
  }
}

function writeView(i: DevOpsIdentityRow) {
  return { clientKey: i.clientKey, org: i.org, name: i.name, email: i.email, validatedAt: i.validatedAt, expires: i.expires };
}

type HeldIn = Omit<Held, "id" | "expiresAt">;
function hold(h: HeldIn, env: Env): DevOpsPreview {
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + PREVIEW_MS;
  for (const [k, v] of held) if (v.expiresAt < Date.now()) held.delete(k);
  held.set(id, { ...h, id, expiresAt });
  const labels = Object.keys({ ...h.before, ...h.after });
  const isDesc = h.op === "description" || h.op === "undo_description";
  const shown = (v: string | null | undefined) => (isDesc && v ? htmlToText(v) : v ?? null);
  const fieldsRows = labels.map((l) => row(l, h.op === "create" ? null : shown(h.before[l]), shown(h.after[l])));
  const links = h.op === "create" && h.parentId ? [`Adds a parent link to #${h.parentId}, which shows the new item as its child`] : h.op === "undo_create" && h.parentId ? ["The parent link stays; the item shows as Removed under it"] : [];
  const notes: string[] = [];
  if (h.op === "undo_create" && h.draftId) notes.push("The draft comes back in FocusTime, with its to-dos.");
  if (h.op === "undo_state" && h.commentId) notes.push("The comment added with that change is deleted too.");
  if (h.followUpId) notes.push("Closes the follow-up once DevOps shows the change.");
  if (h.ask) notes.push(h.op === "undo_create" ? "The request opens again in Inbox › Requests, for everyone on the chat." : "Resolves the request for everyone on the chat once DevOps shows the new item. Nothing is posted in Teams.");
  if (h.conv && h.op === "create") notes.push("Tracks the conversation as the new item for everyone on the chat once DevOps shows it. Nothing is posted in Teams.");
  if (h.op === "undo_create" && h.conv) notes.push("The conversation opens again in Inbox › Conversations.");
  if (h.op === "assign" && assigneeEmail(h.before["Assigned to"])) notes.push(`${(h.before["Assigned to"] ?? "").replace(/\s*<[^>]*>$/, "")} gets a quiet note in FocusTime, if they use it. Undo gives it back.`);
  if (h.op === "description") notes.push("Replaces the whole description with the text above. The old text is kept in the audit log, and Undo puts it back.");
  notes.push(...(h.notes ?? []));
  if (h.attach?.ticked.length) notes.push(`The ${h.attach.ticked.length === 1 ? "image is" : `${h.attach.ticked.length} images are`} read from Teams with your sign-in when you confirm, uploaded to DevOps and linked to the new item. FocusTime keeps no copy. An image that can't be read is left out and the item is still created.`);
  if (h.rev !== null) notes.push(`Written only if the item is still at revision ${h.rev}; if anyone changed it since, nothing is written.`);
  return {
    previewId: id, expiresAt: new Date(expiresAt).toISOString(), op: h.op, summary: SUMMARY[h.op], system: "DevOps", org: h.org, project: h.projectName,
    item: h.itemId ? `#${h.itemId} ${h.title}` : `New ${h.type ?? "item"}: ${h.title}`, identity: `${env.me.name} <${env.me.email}>`, fields: fieldsRows, links, notes,
    visibility: VISIBILITY(h.projectName), undo: h.undoOf !== null,
    ...(h.mentions?.length ? { mentions: h.mentions } : {}),
    ...(h.attach ? { attachments: h.attach.offered.map((a) => ({ id: a.id, src: chatImageSrc(a.id), sender: a.sender, at: a.at, description: a.description, ticked: h.attach!.ticked.includes(a.id) })) } : {}),
  };
}

const base = (env: Env) => ({ clientKey: env.clientKey, org: env.org, project: env.project, projectName: env.projectName, identity: env.me.email });
const none = { draftId: null, followUpId: null, undoOf: null, commentId: null, pickIds: [] as number[], type: null, field: null, parentId: null, ask: null, proposal: null, conv: null };

/** GD-1: the patch fields that carry text FocusTime writes (titles, descriptions, criteria, repro steps, comments). */
const TEXT_PATHS = new Set(["/fields/System.Title", "/fields/System.Description", "/fields/System.History", `/fields/${AC_FIELD}`, "/fields/Microsoft.VSTS.TCM.ReproSteps"]);

/** The text a held change would write into DevOps (undos only put back what was there, so they carry none). */
export function writtenText(h: Pick<HeldIn, "op" | "ops">): string[] {
  // SR-3: a delete writes no text (the comment's old text is only kept for Undo).
  if (h.op.startsWith("undo_") || h.op === "comment_delete" || !h.ops) return [];
  if (!Array.isArray(h.ops)) return [h.ops.text];
  return h.ops.filter((p) => p.op !== "test" && p.op !== "remove" && TEXT_PATHS.has(p.path) && typeof p.value === "string").map((p) => htmlToText(p.value as string) || (p.value as string));
}

/**
 * GD-1, GD-2 point 6: text going into a client's DevOps is checked for another client's names, aliases, projects and
 * known item ids (plan/boundary.ts exitCheck). GD-2: it is no longer refused: the preview flags it (the other client's
 * name shown only here, never logged or kept in the audit log), `replace` swaps each for "another client", and Confirm
 * needs mentionsOk while any are left. Cooptimize Internal may name clients. Undos only put back what was there.
 */
async function withBoundary(ctx: DevOpsWriteContext, env: Env, h: HeldIn, replace: boolean): Promise<HeldIn> {
  if (!ctx.boundary) return h;
  const texts = writtenText(h);
  if (!texts.length) return h;
  const b = await ctx.boundary(env.clientKey);
  const flag = exitCheck(texts, env.clientKey, b.directory, { internal: b.internal });
  if (!flag) return h;
  if (!replace) return { ...h, mentions: flag.names, notes: [...(h.notes ?? []), `This mentions ${nameList(flag.names)}, and ${env.clientName}'s DevOps can be seen by people outside Cooptimize.`] };
  const fix = (v: string) => replaceMentions(v, env.clientKey, b.directory, { records: true }).text;
  const ops = !h.ops ? h.ops : Array.isArray(h.ops) ? h.ops.map((p) => (p.op !== "test" && p.op !== "remove" && TEXT_PATHS.has(p.path) && typeof p.value === "string" ? { ...p, value: fix(p.value) } : p)) : { ...h.ops, text: fix(h.ops.text) };
  const after = Object.fromEntries(Object.entries(h.after).map(([k, v]) => [k, typeof v === "string" ? fix(v) : v]));
  const out: HeldIn = { ...h, ops, after, title: fix(h.title), notes: [...(h.notes ?? []), `${NAME_REMOVED}: "another client" is written instead.`] };
  const left = exitCheck(writtenText(out), env.clientKey, b.directory);
  return left ? { ...out, mentions: left.names } : out;
}

/** Feedback's own preview: another client's name still refuses it (feedback goes to FocusTime's own backlog). */
async function checkBoundary(ctx: DevOpsWriteContext, env: Env, h: HeldIn): Promise<void> {
  if (!ctx.boundary) return;
  const texts = writtenText(h);
  if (!texts.length) return;
  const b = await ctx.boundary(env.clientKey);
  const flag = exitCheck(texts, env.clientKey, b.directory, { internal: b.internal });
  if (flag) throw new Refused(`This mentions ${nameList(flag.names)}; remove it before saving to ${env.clientName}'s DevOps`, 409, "other_client");
}

/** CV-5: a time as the preview shows it, in my zone ("2026-11-02 08:00"). */
const shownAt = (iso: string, zone: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(zone).toPlainDateTime().toString({ smallestUnit: "minute" }).replace("T", " ");

/**
 * CV-5: "Also add a comment on the item" after Link to item: the same comment write as a suggested one, on the item a
 * conversation (anyone on its chat) or my promise is linked to now, with my words or a one-line default and the link
 * back to Teams. Preview, confirm, read back, audit and undo as every comment; GD-1's scan applies.
 */
async function linkComment(env: Env, o: Record<string, unknown>): Promise<HeldIn | string> {
  const cv = env.conversations;
  const shared = env.requests;
  if (!cv || !shared) throw new PlanError("No such conversation");
  const itemId = posId(o.itemId, "itemId");
  const edited = str(o.text, "text", 4000, true);
  let link: string;
  let lines: string[];
  let conv: { conversationId: number; commitmentId: number | null; suggestionId: null } | null = null;
  if (o.commitmentId !== undefined && o.commitmentId !== null) {
    const k = await cv.view.commitment(posId(o.commitmentId, "commitmentId"));
    if (!k || !(await shared.sees(k.chatId)) || (k.whoId ?? "").toLowerCase() !== cv.me.toLowerCase()) throw new PlanError("No such promise");
    if (k.clientKey !== env.clientKey) throw new Refused("That promise belongs to another client", 409);
    if (k.itemId !== itemId) throw new Refused(`Link #${itemId} to the promise first`, 409);
    link = messageLink(k.chatId, k.messageIds.at(-1) ?? "0");
    lines = [`Linked to a promise in Teams: ${k.what}`];
    if (k.conversationId !== null) conv = { conversationId: k.conversationId, commitmentId: k.id, suggestionId: null };
  } else {
    const c = await cv.view.conversation(posId(o.conversationId, "conversationId"));
    if (!c || !(await shared.sees(c.chatId))) throw new PlanError("No such conversation");
    if (c.clientKey !== env.clientKey) throw new Refused("That conversation belongs to another client", 409);
    if (c.itemId !== itemId) throw new Refused(`Link #${itemId} to the conversation first`, 409);
    const last = (await cv.view.placesIn([c.id])).filter((p) => p.role === "work").at(-1);
    const chat = await shared.teams.chat(c.chatId);
    link = last ? messageLink(c.chatId, last.messageId) : chat ? teamsLink(chat) : messageLink(c.chatId, "0");
    lines = [`Linked to the Teams conversation: ${c.title}`];
    conv = { conversationId: c.id, commitmentId: null, suggestionId: null };
  }
  const item = await env.writer.item(env.org, env.pat, env.project, itemId);
  const text = commentText(edited ? edited.split("\n") : lines, link);
  return { ...base(env), ...none, op: "comment", itemId: item.id, title: item.title, ops: { text }, rev: null, before: { Comment: null }, after: { Comment: text }, type: item.type, conv };
}

/** One change → what to hold, or a reason there is nothing to do. Reads the item now (fresh rev). */
async function previewOne(env: Env, c: unknown, tz: string, memo: Map<string, Promise<unknown>> = new Map()): Promise<HeldIn | string> {
  const o = fields(c, ["kind"], ["key", "hours", "itemId", "commentId", "state", "comment", "text", "draftId", "description", "acceptance", "date", "startDate", "writeId", "followUpId", "chatId", "messageId", "level", "storyDraftId", "proposalId", "conversationId", "commitmentId", "suggestionId", "title", "parentId", "includeInternal", "after", "type", "images", "assign", "pickId", "mention", "assignTo", "size", "brief", "noTag"]);
  const { writer, org, pat, project, plan } = env;
  switch (o.kind) {
    case "state": {
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      const states = await writer.states(org, pat, project, item.type);
      const state = str(o.state, "state", 100)!;
      if (!states.some((s) => s.name === state)) throw new Invalid(`${state} isn't a state of ${item.type}`);
      const comment = str(o.comment, "comment", 4000, true);
      const followUpId = o.followUpId === undefined || o.followUpId === null ? null : posId(o.followUpId, "followUpId");
      if (followUpId !== null && !(await plan.getFollowUp(followUpId))) throw new PlanError("No such follow-up");
      // PK-1: a to-do's offer names its pick, so unchecking it later finds this write for Undo.
      const pickId = o.pickId === undefined || o.pickId === null ? null : posId(o.pickId, "pickId");
      if (pickId !== null) {
        const p = await plan.getPick(pickId);
        if (!p || p.itemId !== item.id || p.clientKey !== env.clientKey) throw new PlanError("That to-do isn't for this item");
      }
      if (state === item.state && !comment) return `#${item.id} is already ${state}`;
      return { ...base(env), ...none, ...(pickId !== null ? { pickIds: [pickId] } : {}), op: "state", itemId: item.id, title: item.title, ops: stateOps(item.rev, state, comment), rev: item.rev, before: { State: item.state, ...(comment ? { Comment: null } : {}) }, after: { State: state, ...(comment ? { Comment: comment } : {}) }, followUpId, type: item.type };
    }
    case "remaining_work": {
      // TX-1: one named write: Remaining Work in hours, only on a type that has it and an item canEdit allows.
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      const right = await rightsOn(env, item, memo);
      if (!right.ok) throw new Refused(right.note, 409);
      const typeHas = await writer.typeFields(org, pat, project, item.type);
      if (!typeHas.has(REMAINING_WORK)) throw new Refused(`${item.type} has no Remaining Work field in this process`, 409);
      if (typeof o.hours !== "number" || !Number.isFinite(o.hours) || o.hours < 0 || o.hours > 10_000) throw new Invalid("hours must be a number from 0 to 10000");
      const pickId = o.pickId === undefined || o.pickId === null ? null : posId(o.pickId, "pickId");
      if (pickId !== null) {
        const p = await plan.getPick(pickId);
        if (!p || p.itemId !== item.id || p.clientKey !== env.clientKey) throw new PlanError("That to-do isn't for this item");
      }
      const was = item.fields[REMAINING_WORK];
      const prior = typeof was === "number" && Number.isFinite(was) ? was : null;
      if (prior === o.hours) return `#${item.id} already has ${o.hours}h remaining`;
      return { ...base(env), ...none, ...(pickId !== null ? { pickIds: [pickId] } : {}), op: "remaining_work", itemId: item.id, title: item.title, ops: remainingOps(item.rev, o.hours, prior !== null), rev: item.rev, before: { [REMAINING_LABEL]: prior === null ? null : String(prior) }, after: { [REMAINING_LABEL]: String(o.hours) }, type: item.type };
    }
    case "comment": {
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      const text = str(o.text, "text", 4000)!;
      // LP-1: an @mention of the person a loop is closed with, when they are on this item (its assignee, creator or
      // last changer), so their DevOps identity id is known; anyone else gets the text alone (DevOps would show a
      // plain "@name" that notifies nobody).
      const who = o.mention === undefined || o.mention === null ? null : str(o.mention, "mention", 200);
      const m = who ? mentionOn(item, who) : null;
      const posted = m ? `<a href="#" data-vss-mention="version:2.0,${m.id}">@${escHtml(m.name)}</a> ${escHtml(text).replace(/\r?\n/g, "<br>")}` : text;
      return { ...base(env), ...none, op: "comment", itemId: item.id, title: item.title, ops: { text: posted }, rev: null, before: { Comment: null }, after: { Comment: m ? `@${m.name} ${text}` : text }, type: item.type, ...(who && !m ? { notes: [`${who} isn't on #${item.id} in DevOps, so the comment doesn't @mention them`] } : {}) };
    }
    case "comment_edit": {
      // SR-1: my own comment, inside this client's status report window, the full text before and after; DevOps keeps
      // no history of a comment's text, so the old text is kept in the audit log and Undo puts it back.
      if (!env.reportSince) throw new Refused("Editing comments isn't available here", 409);
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      const commentId = posId(o.commentId, "commentId");
      const text = str(o.text, "text", 4000)!;
      const cm = await writer.getComment(org, pat, project, item.id, commentId);
      if (cm.isDeleted) throw new Refused("That comment was deleted in DevOps", 409, "changed");
      if (!cm.createdBy || cm.createdBy.toLowerCase() !== env.me.email.toLowerCase()) throw new Refused("Only your own comments can be edited. DevOps doesn't let anyone change someone else's", 409);
      if (isCoopComment(cm.text)) throw new Refused("Coop's comments aren't edited from FocusTime", 409);
      const since = await env.reportSince(env.cfg, env.clientKey);
      const counted = cm.modifiedDate || cm.createdDate;
      if (!counted || Temporal.Instant.compare(Temporal.Instant.from(counted), Temporal.Instant.from(since)) < 0) throw new Refused("Only comments in this week's status report can be edited here", 409);
      const was = htmlToText(cm.text).trim() || cm.text.trim();
      if (sameText(cm.text, text)) return "That comment already says that";
      return { ...base(env), ...none, op: "comment_edit", itemId: item.id, title: item.title, ops: { text, commentId }, rev: null, before: { Comment: was }, after: { Comment: text }, type: item.type };
    }
    case "comment_delete": {
      // SR-3: my own comment, inside this client's status report window, the same checks as an edit. The full text is
      // shown in the preview and kept in the audit log; Undo posts it again as a new comment (DevOps has no undelete).
      if (!env.reportSince) throw new Refused("Deleting comments isn't available here", 409);
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      const commentId = posId(o.commentId, "commentId");
      const cm = await writer.getComment(org, pat, project, item.id, commentId);
      if (cm.isDeleted) return "That comment is already deleted";
      if (!cm.createdBy || cm.createdBy.toLowerCase() !== env.me.email.toLowerCase()) throw new Refused("Only your own comments can be deleted. DevOps doesn't let anyone delete someone else's", 409);
      if (isCoopComment(cm.text)) throw new Refused("Coop's comments aren't deleted from FocusTime", 409);
      const since = await env.reportSince(env.cfg, env.clientKey);
      const counted = cm.modifiedDate || cm.createdDate;
      if (!counted || Temporal.Instant.compare(Temporal.Instant.from(counted), Temporal.Instant.from(since)) < 0) throw new Refused("Only comments in this week's status report can be deleted here", 409);
      const was = htmlToText(cm.text).trim() || cm.text.trim();
      return { ...base(env), ...none, op: "comment_delete", itemId: item.id, title: item.title, ops: { text: was, commentId }, rev: null, before: { Comment: was }, after: { Comment: "(deleted)" }, type: item.type, notes: ["Undo posts the same text again as a new comment, dated when you undo"] };
    }
    case "target_date": {
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      // AH-1 (D656): the shared rule (a lead, the owner, or the owner one level up), not "assigned to me" alone.
      const right = await rightsOn(env, item, memo);
      if (!right.ok) throw new Refused(right.note, 409);
      const tiers = portfolioTiers(await writer.processConfig(org, pat, project));
      if (!tiers.feature.has(item.type) && !tiers.epic.has(item.type)) throw new Refused(`#${item.id} is a ${item.type}: target dates are set on features and epics`, 409);
      const typeHas = await writer.typeFields(org, pat, project, item.type);
      const field = detectTargetField(await writer.fields(org, pat, project), typeHas);
      if (!field) throw new Refused(`${item.type} has no target date field in this process`, 409);
      const date = isoDate(o.date, "date");
      const cur = dateOnly(item.fields[field], tz);
      const had = (f: string) => item.fields[f] !== undefined && item.fields[f] !== null;
      // Step 17 (Save dates to DevOps): Start Date too, in the same patch, only where the process has it.
      if (o.startDate !== undefined) {
        if (!typeHas.has(START_FIELD)) throw new Refused(`${item.type} has no Start Date field in this process: save the target date alone`, 409);
        const start = isoDate(o.startDate, "startDate");
        if (start > date) throw new Invalid("The start date is after the target date");
        const curStart = dateOnly(item.fields[START_FIELD], tz);
        if (cur === date && curStart === start) return `#${item.id} already has those dates`;
        const ops = datesOps(item.rev, [{ field, date, had: had(field) }, { field: START_FIELD, date: start, had: had(START_FIELD) }], tz);
        return { ...base(env), ...none, op: "target_date", itemId: item.id, title: item.title, ops, rev: item.rev, before: { "Start date": curStart, "Target date": cur }, after: { "Start date": start, "Target date": date }, type: item.type, field };
      }
      if (cur === date) return `#${item.id} already has that target date`;
      return { ...base(env), ...none, op: "target_date", itemId: item.id, title: item.title, ops: targetDateOps(item.rev, field, date, tz, had(field)), rev: item.rev, before: { "Target date": cur }, after: { "Target date": date }, type: item.type, field };
    }
    case "fields": {
      // AH-1 (D660): my pending changes for one item, one patch behind a test on the rev it has now. A field DevOps
      // changed since I started editing it is a conflict (nothing is written for the item); other changes to the item
      // don't count, so my values go on the new rev quietly (D658).
      const port = env.ahead;
      if (!port) throw new Refused("Backlog's change set isn't available here", 503);
      const itemId = posId(o.itemId, "itemId");
      const staged = await port.staged(env.clientKey, itemId);
      if (!staged.length) return `Nothing is pending for #${itemId}`;
      const item = await writer.item(org, pat, project, itemId);
      const right = await rightsOn(env, item, memo);
      if (!right.ok) throw new Refused(right.note, 403, "read_only");
      const typeHas = await writer.typeFields(org, pat, project, item.type);
      const all = await writer.fields(org, pat, project);
      const refs: Record<ChangeField, string | null> = { start: typeHas.has(START_FIELD) ? START_FIELD : null, target: detectTargetField(all, typeHas), size: detectTypeSizeField(typeHas), assignee: "System.AssignedTo", state: "System.State" };
      // AH-5: a state must be one of the type's states in the process model, read on the write path.
      const typeStates = staged.some((x) => x.field === "state") ? await writer.states(org, pat, project, item.type) : [];
      const sizeLabel = refs.size ? (fieldNames(all, [refs.size])[refs.size] ?? "Size") : "Size";
      const label = (f: ChangeField) => (f === "size" ? sizeLabel : FIELD_LABEL[f]);
      const now = (f: ChangeField): ChangeValue => valueNow(item, f, refs[f], tz);
      const conflicts = staged.filter((x) => !sameValue(x.field, x.baseValue, now(x.field)));
      for (const x of conflicts) await port.conflict(env.clientKey, itemId, x.field, now(x.field));
      if (conflicts.length) throw new Refused(`#${itemId} changed in DevOps since you started editing it: ${conflicts.map((x) => `${label(x.field)} is ${valueText(x.field, now(x.field))} now`).join("; ")}. Keep mine or take theirs in the review`, 409, "conflict");
      const specs: FieldSpec[] = [];
      const before: Record<string, string | null> = {};
      const after: Record<string, string | null> = {};
      const notes: string[] = [];
      for (const x of staged) {
        const ref = refs[x.field];
        if (!ref) throw new Refused(`${label(x.field)} isn't in ${env.projectName}'s process for ${item.type}. Remove that change in the review`, 409, "no_field");
        if (sameValue(x.field, x.value, now(x.field))) continue;
        const had = item.fields[ref] !== undefined && item.fields[ref] !== null && item.fields[ref] !== "";
        if (x.field === "start" || x.field === "target") {
          specs.push({ kind: "date", field: ref, value: typeof x.value === "string" ? x.value : null, had });
          before[label(x.field)] = (now(x.field) as string | null) ?? null;
          after[label(x.field)] = typeof x.value === "string" ? x.value : null;
          if (typeof x.value === "string" && x.half) notes.push(`${label(x.field)}: ${valueText(x.field, x.value, x.half)} in FocusTime; DevOps stores the day.`);
        } else if (x.field === "state") {
          const st = typeStates.find((t) => typeof x.value === "string" && t.name.toLowerCase() === x.value.trim().toLowerCase());
          if (!st) throw new Refused(`${String(x.value)} isn't a state of ${item.type} in ${env.projectName}'s process. Remove that change in the review`, 409, "no_field");
          specs.push({ kind: "state", field: ref, value: st.name, had: true });
          before[FIELD_LABEL.state] = typeof item.fields[ref] === "string" ? (item.fields[ref] as string) : null;
          after[FIELD_LABEL.state] = st.name;
        } else if (x.field === "size") {
          specs.push({ kind: "number", field: ref, value: typeof x.value === "number" ? x.value : null, had });
          before[label("size")] = typeof now("size") === "number" ? String(now("size")) : null;
          after[label("size")] = typeof x.value === "number" ? String(x.value) : null;
        } else {
          const v = x.value && typeof x.value === "object" ? x.value : null;
          specs.push({ kind: "identity", field: ref, value: v?.email ?? null, had });
          before[label("assignee")] = assigneeText(identityName(item.fields[ref]), identityEmail(item.fields[ref]));
          after[label("assignee")] = v ? assigneeText(v.name, v.email) : null;
          if (v && v.email.toLowerCase() !== env.me.email.toLowerCase()) {
            const coop = port.isCooptimizer ? await port.isCooptimizer(env.clientKey, v.email).catch(() => true) : true;
            notes.push(coop ? `${v.name} gets a notice in FocusTime with a link to it.` : `${v.name} is outside Cooptimize, so FocusTime sends them no notice.`);
          }
        }
      }
      // BH-1: a bulk change can touch items that aren't mine: the preview says whose each one is.
      const owner = identityEmail(item.fields["System.AssignedTo"]);
      if (specs.length && right.why !== "owner" && owner && owner.toLowerCase() !== env.me.email.toLowerCase() && !staged.some((x) => x.field === "assignee")) {
        const moved = staged.some((x) => x.field === "start" || x.field === "target");
        notes.unshift(`Assigned to ${identityName(item.fields["System.AssignedTo"]) ?? owner}, not you.${moved ? " They get a quiet note in FocusTime that the dates moved." : ""}`);
      }
      if (!specs.length) {
        for (const x of staged) await port.landed(env.clientKey, itemId, x.field);
        return `#${itemId} already has those values`;
      }
      return { ...base(env), ...none, op: "fields", itemId: item.id, title: item.title, ops: fieldsOps(item.rev, specs, tz), rev: item.rev, before, after, type: item.type, notes };
    }
    case "assign": {
      // PV-1 (D572): Take one: a teammate's open story (child level in the project's process) assigned to me. SW-1
      // (D637): also a feature (the feature tier, from backlog levels), for Accept's "Also assign to me in DevOps".
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      const pc = await writer.processConfig(org, pat, project);
      const lv = levelsFromProcessConfig(pc);
      if (!lv.levels.child.includes(item.type) && !lv.tiers.feature.has(item.type)) throw new Refused(`#${item.id} is a ${item.type}: FocusTime assigns only stories and features to you`, 409);
      const states = await writer.states(org, pat, project, item.type);
      if (!isOpenCategory(states.find((x) => x.name === item.state)?.category)) throw new Refused(`#${item.id} is ${item.state}; FocusTime assigns only open items`, 409);
      const was = item.fields["System.AssignedTo"];
      const wasEmail = identityEmail(was);
      if (wasEmail === env.me.email.toLowerCase()) return `#${item.id} is already assigned to you`;
      return { ...base(env), ...none, op: "assign", itemId: item.id, title: item.title, ops: assignOps(item.rev, env.me.email, true), rev: item.rev, before: { "Assigned to": assigneeText(identityName(was), wasEmail) }, after: { "Assigned to": `${env.me.name} <${env.me.email}>` }, type: item.type };
    }
    case "create": {
      const draft = (await plan.getDraft(posId(o.draftId, "draftId")));
      if (!draft) throw new PlanError("No such draft");
      if (draft.devopsId) return `"${draft.title}" is already in DevOps as #${draft.devopsId}`;
      if (draft.clientKey !== env.clientKey) throw new Refused("That draft belongs to another client", 409);
      if (draft.parentItemId === null) throw new Refused(`"${draft.title}" has no ${draft.level === "feature" ? "epic" : "feature"} yet. Put it under one first: DevOps first, and area and iteration come from the parent`, 409);
      const parent = await writer.item(org, pat, project, draft.parentItemId);
      const pc = await writer.processConfig(org, pat, project);
      const tiers = portfolioTiers(pc);
      // PV-1: a story may name its type (the parent type's default child in the process model) when the parent takes it.
      // CP-1: so may a feature (the AI version's type, once I accept it): one the parent epic's type takes, at the
      // feature tier. Anything else is the process default, as before.
      const takes = typeof o.type === "string" && levelsFromProcessConfig(pc).childrenOf(parent.type).includes(o.type);
      const childType = takes && (draft.level === "story" || tiers.feature.has(o.type as string)) ? (o.type as string) : null;
      const type = childType ?? (draft.level === "feature" ? defaultType(pc, "feature") : defaultType(pc, "story"));
      if (!type) throw new Refused(`This project's process has no ${draft.level === "feature" ? "feature" : "story"} level`, 409);
      const wantParent = draft.level === "feature" ? tiers.epic : tiers.feature;
      if (!wantParent.has(parent.type)) throw new Refused(`#${parent.id} is a ${parent.type}: a ${draft.level === "feature" ? "feature goes under an epic" : "story goes under a feature"}`, 409);
      const parentStates = await writer.states(org, pat, project, parent.type);
      // An unknown state counts as open (plan/process.ts).
      if (!isOpenCategory(parentStates.find((s) => s.name === parent.state)?.category)) throw new Refused(`#${parent.id} is ${parent.state}; FocusTime adds items only under open parents`, 409);
      const typeHas = await writer.typeFields(org, pat, project, type);
      const acField = draft.level === "story" && typeHas.has(AC_FIELD);
      // Step 15.3: the draft editor's values; an explicit input (older callers) still wins.
      const description = o.description !== undefined ? str(o.description, "description", 8000, true) : (draft.description ?? null);
      const acceptance = o.acceptance !== undefined ? str(o.acceptance, "acceptance", 8000, true) : (draft.acceptance ?? null);
      let startDate: { field: string; date: string } | null = null;
      let targetDate: { field: string; date: string } | null = null;
      if (draft.level === "feature" && (draft.startDate || draft.targetDate)) {
        if (draft.startDate) {
          if (!typeHas.has(START_FIELD)) throw new Refused(`${type} has no start date field in this process. Clear the start date in the draft, then create it`, 409);
          startDate = { field: START_FIELD, date: draft.startDate };
        }
        if (draft.targetDate) {
          const field = detectTargetField(await writer.fields(org, pat, project), typeHas);
          if (!field) throw new Refused(`${type} has no target date field in this process. Clear the target date in the draft, then create it`, 409);
          targetDate = { field, date: draft.targetDate };
        }
      }
      const area = String(parent.fields["System.AreaPath"] ?? "");
      const iteration = String(parent.fields["System.IterationPath"] ?? "");
      if (!area || !iteration) throw new Refused(`#${parent.id} has no area or iteration to copy`, 409);
      const ops = createOps({ org, title: draft.title, description, acceptance, acField, assignedTo: env.me.email, areaPath: area, iterationPath: iteration, parentId: parent.id, startDate, targetDate, timeZone: tz });
      const after: Record<string, string | null> = { Type: type, Title: draft.title, Description: description, ...(acField ? { "Acceptance criteria": acceptance } : {}), ...(draft.level === "feature" ? { "Start date": startDate?.date ?? null, "Target date": targetDate?.date ?? null } : {}), "Assigned to": `${env.me.name} <${env.me.email}>`, Area: area, Iteration: iteration, Parent: `#${parent.id} ${parent.title}` };
      return { ...base(env), ...none, op: "create", itemId: null, parentId: parent.id, title: draft.title, ops, rev: null, before: {}, after, draftId: draft.id, type };
    }
    case "new_item": {
      // QC-1: the New form's create, at any level the client's process has (its backlog ladder, never a list of names):
      // a title, a type, an optional parent one level up (its area and iteration; else the project's defaults),
      // assigned to me, to someone on the client's project or to nobody, an optional target date, description and the
      // type's size field. From a draft (any level) the draft's values fill what the form didn't send, and the to-dos
      // that use it become the item on confirm. Every check runs here, before anything is sent.
      const draft = o.draftId === undefined || o.draftId === null ? null : await plan.getDraft(posId(o.draftId, "draftId"));
      if (o.draftId !== undefined && o.draftId !== null && !draft) throw new PlanError("No such draft");
      if (draft?.devopsId) return `"${draft.title}" is already in DevOps as #${draft.devopsId}`;
      if (draft && draft.clientKey !== env.clientKey) throw new Refused("That draft belongs to another client", 409);
      const t = cleanTitle(o.title !== undefined ? o.title : draft?.title);
      if ("problem" in t) throw new Invalid(t.problem);
      const title = t.title;
      const pc = await writer.processConfig(org, pat, project);
      const ladder = ladderFromProcessConfig(pc);
      const levels = createLevelsOf(ladder);
      const asked = o.type !== undefined && o.type !== null ? str(o.type, "type", 200)! : (draft?.itemType ?? null);
      const fallback = draft ? (draft.level === "feature" ? levels.filter((l) => l.kind === "portfolio").at(-1)?.types[0] : levels.find((l) => l.kind === "requirement")?.types[0]) : undefined;
      const type = asked ?? fallback ?? null;
      if (!type) throw new Invalid("Choose a level and type");
      if (!levels.some((l) => l.types.includes(type))) throw new Refused(`${type} isn't a level in ${env.projectName}'s process. It has: ${levels.flatMap((l) => l.types).join(", ")}`, 409);
      const parentId = o.parentId !== undefined ? (o.parentId === null ? null : posId(o.parentId, "parentId")) : (draft?.parentItemId ?? null);
      let parent: ItemSnapshot | null = null;
      if (parentId !== null) {
        try {
          parent = await writer.item(org, pat, project, parentId);
        } catch (e) {
          if (e instanceof WriteFailure && e.kind === "not_found") throw new Refused(`#${parentId} isn't in ${env.clientName}'s project ${env.projectName}`, 409);
          throw e;
        }
        // An id from another project of the same organization reads fine: only this client's project counts.
        const inProject = String(parent.fields["System.TeamProject"] ?? env.projectName).toLowerCase();
        if (inProject !== env.projectName.toLowerCase() && inProject !== env.project.toLowerCase()) throw new Refused(`#${parentId} isn't in ${env.clientName}'s project ${env.projectName}`, 409);
        const why = parentProblem(ladder, parent.type, type);
        if (why) throw new Refused(why, 409);
        const parentStates = await writer.states(org, pat, project, parent.type);
        if (!isOpenCategory(parentStates.find((x) => x.name === parent!.state)?.category)) throw new Refused(`#${parent.id} is ${parent.state}; FocusTime adds items only under open parents`, 409);
      }
      // Assigned to: me (the default), nobody, or someone on this client's DevOps project.
      const want = o.assignTo !== undefined ? o.assignTo : (draft?.assignTo ?? "me");
      let assignee: { email: string; text: string } | null;
      if (want === "me" || want === undefined) assignee = { email: env.me.email, text: `${env.me.name} <${env.me.email}>` };
      else if (want === null || want === "none" || want === "") assignee = null;
      else {
        const email = str(want, "assignTo", 320)!.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Invalid("assignTo must be me, none or an email");
        if (email === env.me.email.toLowerCase()) assignee = { email: env.me.email, text: `${env.me.name} <${env.me.email}>` };
        else if (!(await env.ahead?.assignable?.(env.clientKey, email).catch(() => false))) throw new Refused(`Only people on ${env.clientName}'s DevOps project can be assigned here`, 409);
        else assignee = { email, text: email };
      }
      const description = o.description !== undefined ? str(o.description, "description", 8000, true) : (draft?.description ?? null);
      // TP-1: the four lines (the form's, else the draft's), written only here at create: under their headings in the
      // description, "How we'll check" in the acceptance field when the type has it, and one request type tag.
      const doc = env.templates ? (await env.templates.read()).doc : null;
      let brief: Brief | null = null;
      if (doc) {
        try {
          brief = o.brief !== undefined ? parseBrief(o.brief, doc) : draft?.brief ? parseBrief({ ...draft.brief, type: typeById(doc, draft.brief.type) ? draft.brief.type : null }, doc) : null;
        } catch (e) {
          if (e instanceof BriefError) throw new Invalid(e.message);
          throw e;
        }
      } else if (o.brief !== undefined && o.brief !== null) throw new Refused("Work templates aren't available here. Create it without the four lines", 409);
      if (o.noTag !== undefined && typeof o.noTag !== "boolean") throw new Invalid("noTag must be true or false");
      const tag = doc && o.noTag !== true ? templateTag(doc, brief) : null;
      const typedAcceptance = o.acceptance !== undefined ? str(o.acceptance, "acceptance", 8000, true) : (draft?.acceptance ?? null);
      const acceptance = [typedAcceptance, acceptanceText(brief)].filter((x): x is string => !!x).join("\n\n") || null;
      const descHtml = brief ? briefHtml(description, brief) : null;
      const date = o.date !== undefined && o.date !== null && o.date !== "" ? isoDate(o.date, "date") : o.date === undefined ? (draft?.targetDate ?? null) : null;
      const startDay = draft?.startDate ?? null;
      const sizeIn = o.size === undefined || o.size === null || o.size === "" ? null : Number(o.size);
      if (sizeIn !== null && (!Number.isFinite(sizeIn) || sizeIn < 0 || sizeIn > 10_000)) throw new Invalid("size must be a number from 0 to 10000");
      const info = await writer.typeFieldInfo(org, pat, project, type);
      const typeHas = new Set(info.map((f) => f.ref));
      let targetDate: { field: string; date: string } | null = null;
      if (date) {
        const field = detectTargetField(await writer.fields(org, pat, project), typeHas);
        if (!field) throw new Refused(`${type} has no target date in ${env.projectName}'s process. Leave the target date empty`, 409);
        targetDate = { field, date };
      }
      const startDate = startDay && typeHas.has(START_FIELD) ? { field: START_FIELD, date: startDay } : null;
      const sizeField = sizeIn !== null ? detectTypeSizeField(typeHas) : null;
      if (sizeIn !== null && !sizeField) throw new Refused(`${type} has no size field in ${env.projectName}'s process. Leave the size empty`, 409);
      const acField = !!acceptance && typeHas.has(AC_FIELD);
      const area = parent ? String(parent.fields["System.AreaPath"] ?? "") || null : null;
      const iteration = parent ? String(parent.fields["System.IterationPath"] ?? "") || null : null;
      const ops = [
        ...createOps({ org, title, description: descHtml ?? description, descriptionIsHtml: descHtml !== null, acceptance, acField, assignedTo: assignee?.email ?? null, areaPath: area, iterationPath: iteration, parentId: parent?.id ?? null, startDate, targetDate, timeZone: tz }),
        ...(sizeField && sizeIn !== null ? [{ op: "add" as const, path: `/fields/${sizeField}`, value: sizeIn }] : []),
        ...(tag ? [{ op: "add" as const, path: `/fields/${TAGS_FIELD}`, value: tag }] : []),
      ];
      // A required field this create leaves empty, that DevOps has no default for: say so now, never half-create.
      const missing = missingRequired(info, new Set(ops.filter((x) => x.path.startsWith("/fields/")).map((x) => x.path.slice(8))));
      if (missing.length) throw new Refused(`${env.projectName}'s process needs ${missing.map((f) => f.name ?? f.ref).join(", ")} on a new ${type}, which FocusTime doesn't fill. Create this one in DevOps, or save it as a draft`, 409, "required_field");
      // Never two: a create of this title, type and parent that may have landed (from another tab or a double click).
      const twin = await twinOf(plan, { clientKey: env.clientKey, title, type, parentId: parent?.id ?? null, draftId: draft?.id ?? null }, msOf(env.now()));
      if (twin) throw new Refused(twin.message, 409, "pending_write");
      const after: Record<string, string | null> = {
        Type: type, Title: title, Description: brief ? descriptionText(description, brief) : description, ...(acField ? { "Acceptance criteria": acceptance } : {}), ...(tag ? { Tags: tag } : {}),
        "Assigned to": assignee?.text ?? "Nobody", ...(targetDate ? { "Target date": targetDate.date } : {}), ...(startDate ? { "Start date": startDate.date } : {}), ...(sizeField && sizeIn !== null ? { Size: String(sizeIn) } : {}),
        Area: area ?? "The project's default", Iteration: iteration ?? "The project's default", Parent: parent ? `#${parent.id} ${parent.title}` : "None",
      };
      const notes = [`Created as you: DevOps shows ${env.me.name} as who made it.`, ...(draft ? ["The draft becomes this item wherever it is placed, keeping its block, size and time."] : []), ...(assignee && assignee.email !== env.me.email ? ["DevOps tells them as it usually does; FocusTime sends no note of its own."] : []),
        ...(brief && acceptanceText(brief) && !acField ? [`${type} has no acceptance criteria field in ${env.projectName}'s process, so "How we'll check" is only in the description.`] : []),
        ...(tag ? [`Adds the tag ${tag} for the request type. If you may not add new tags in ${env.projectName}, DevOps refuses it and you can create the item without it.`] : [])];
      return { ...base(env), ...none, op: "create", itemId: null, parentId: parent?.id ?? null, title, ops, rev: null, before: {}, after, type, draftId: draft?.id ?? null, notes, quick: true, aiText: !!draft?.ai && ((!!draft.ai.title && title === cleanTitleText(draft.ai.title)) || (!!draft.ai.description && description === draft.ai.description)) };
    }
    case "proposal_create": {
      // DS-1: one kept card of a Draft stories draft, as a story under its feature: the process's story type, the
      // feature's area and iteration, assigned to me, the card's description (with "After: <title>" for its kept
      // dependencies) and acceptance criteria. The FocusTime size stays in FocusTime (no estimate is written).
      const draftId = str(o.storyDraftId, "storyDraftId", 64)!;
      const proposalId = str(o.proposalId, "proposalId", 16)!;
      const draft = await plan.storyDraft(draftId);
      if (!draft) throw new PlanError("No such draft");
      if (draft.clientKey !== env.clientKey) throw new Refused("That draft belongs to another client", 409);
      const p = draft.proposals.find((x) => x.id === proposalId);
      if (!p || !p.keep) throw new Refused("That card isn't kept in the draft", 409);
      if ((await plan.storyDraftWrites(draftId)).has(proposalId)) return `"${p.title}" was already sent to DevOps`;
      // A create of the same title under the same feature that may have landed (or did): never another one.
      const same = (await plan.devopsWriteLog(1000)).find((e) => e.op === "create" && e.parentId === draft.featureId && e.title === p.title && e.undoneBy === null && e.status !== "failed" && e.status !== "refused");
      if (same) return same.status === "confirmed" ? `"${p.title}" is already in DevOps as #${same.itemId}` : `"${p.title}" may already be in DevOps. Retry it in Settings > Data > Audit log`;
      const once = <T,>(k: string, f: () => Promise<T>) => (memo.get(k) ?? memo.set(k, f()).get(k)!) as Promise<T>;
      const parent = await once(`item:${draft.featureId}`, () => writer.item(org, pat, project, draft.featureId));
      const pc = await once("pc", () => writer.processConfig(org, pat, project));
      // BD-1: any parent type that needs breaking down (the process model, the person's overrides), and only a child
      // type that type takes (the next level down): the draft's own, else the first.
      const valid = breakdownChildTypes(pc, parent.type, { noBreakdown: env.cfg.org?.clients[env.clientKey]?.noBreakdown ?? [] });
      if (!valid.length) throw new Refused(`#${parent.id} is a ${parent.type}, which isn't broken down in this project`, 409);
      const type = draft.storyType && valid.includes(draft.storyType) ? draft.storyType : valid[0]!;
      const parentStates = await once(`states:${parent.type}`, () => writer.states(org, pat, project, parent.type));
      if (!isOpenCategory(parentStates.find((s) => s.name === parent.state)?.category)) throw new Refused(`#${parent.id} is ${parent.state}; FocusTime adds items only under open parents`, 409);
      const typeHas = await once(`fields:${type}`, () => writer.typeFields(org, pat, project, type));
      const acField = typeHas.has(AC_FIELD);
      const area = String(parent.fields["System.AreaPath"] ?? "");
      const iteration = String(parent.fields["System.IterationPath"] ?? "");
      if (!area || !iteration) throw new Refused(`#${parent.id} has no area or iteration to copy`, 409);
      const description = publishDescription(p, draft.proposals) || null;
      const acceptance = publishAcceptance(p) || null;
      const ops = createOps({ org, title: p.title, description, acceptance, acField, assignedTo: env.me.email, areaPath: area, iterationPath: iteration, parentId: parent.id, timeZone: tz });
      const after: Record<string, string | null> = { Type: type, Title: p.title, Description: description, ...(acField ? { "Acceptance criteria": acceptance } : {}), "Assigned to": `${env.me.name} <${env.me.email}>`, Area: area, Iteration: iteration, Parent: `#${parent.id} ${parent.title}`, "Size in FocusTime": `${sizeChipText(p.size, env.cfg.plan.sizes)} (not written to DevOps)` };
      return { ...base(env), ...none, op: "create", itemId: null, parentId: parent.id, title: p.title, ops, rev: null, before: {}, after, type, proposal: { draftId, proposalId } };
    }
    case "request_create": {
      // AP-1: a new bug, story or feature from an ask in a client chat: no parent (the project's default area and
      // iteration), assigned to me, the message, its author, time and Teams link as the description.
      const chatId = str(o.chatId, "chatId", 400)!;
      const messageId = str(o.messageId, "messageId", 100)!;
      const level = o.level as AskItemLevel;
      if (level !== "bug" && level !== "story" && level !== "feature") throw new Invalid("level must be bug, story or feature");
      const shared = env.requests;
      if (!shared || !(await shared.sees(chatId))) throw new PlanError("No such request");
      const ask = await shared.teams.request(chatId, messageId);
      if (!ask) throw new PlanError("No such request");
      if (ask.clientKey !== env.clientKey) throw new Refused("That request belongs to another client", 409);
      if (ask.status === "created" && ask.itemId) return `This request is already in DevOps as #${ask.itemId}`;
      if (ask.status !== "open") throw new Refused("This request is already resolved. Undo that first", 409);
      // Idempotent: a create from this request that may have landed is retried (it checks first), never made again.
      const open = (await plan.devopsWriteLog(1000)).find((e) => e.op === "create" && e.ask?.chatId === chatId && e.ask.messageId === messageId && (e.status === "pending" || e.status === "unconfirmed" || (e.status === "confirmed" && e.undoneBy === null)));
      if (open) throw new Refused(open.status === "confirmed" ? `This request is already in DevOps as #${open.itemId}` : "A create from this request may already be in DevOps. Retry it in Settings > Data > Audit log: it checks first and won't make a second one", 409, "pending_write");
      const stored = await shared.teams.message(chatId, messageId);
      if (!stored) throw new PlanError("The message for this request isn't stored any more");
      const message = { text: stored.text, createdAt: stored.createdAt };
      const chat = await shared.teams.chat(chatId);
      const author = stored.senderName ?? chat?.members?.find((m: ChatMember) => m.userId && stored.senderId && m.userId.toLowerCase() === stored.senderId.toLowerCase())?.displayName ?? "Someone";
      const pc = await writer.processConfig(org, pat, project);
      const type = level === "bug" ? bugType(pc) : defaultType(pc, level);
      if (!type) throw new Refused(level === "bug" ? "This project's process doesn't track bugs on a backlog. Create a story instead" : `This project's process has no ${level} level`, 409);
      const typeHas = await writer.typeFields(org, pat, project, type);
      const descriptionField = typeHas.has(REPRO_FIELD) && type === bugType(pc) ? REPRO_FIELD : "System.Description";
      // AP-2: the AI's draft (when the ask was sorted) gives the title and a short description; the message itself
      // always goes with it. The person still sees all of it in the preview and confirms.
      const draft = ask.sortStatus === "sorted" && ask.sort && ask.sort.kind !== "none" && ask.sort.title ? ask.sort : null;
      const title = draft ? draft.title : askTitle(message.text);
      const body = draft?.description ? `${draft.description}\n\nThe message:\n${message.text}` : message.text;
      const description = askDescription({ text: body, author, at: message.createdAt, link: messageLink(chatId, messageId), zone: tz });
      const ops = createOps({ org, title, description, acField: false, assignedTo: env.me.email, areaPath: null, iterationPath: null, parentId: null, descriptionField, timeZone: tz });
      const after: Record<string, string | null> = { Type: type, Title: title, [descriptionField === REPRO_FIELD ? "Repro steps" : "Description"]: description, "Assigned to": `${env.me.name} <${env.me.email}>`, Area: "The project's default", Iteration: "The project's default" };
      return { ...base(env), ...none, op: "create", itemId: null, parentId: null, title, ops, rev: null, before: {}, after, type, ask: { chatId, messageId } };
    }
    case "conversation_create": {
      // CV-1: a bug, story or feature from a whole conversation: the edited title and path of action, then the original
      // messages (sender, time, sanitized HTML) and the Teams link, appended by code. Under a parent feature (its area
      // and iteration) when one is chosen, else the project's defaults; assigned to me.
      const cv = env.conversations;
      const shared = env.requests;
      if (!cv || !shared) throw new PlanError("No such conversation");
      const c = await cv.view.conversation(posId(o.conversationId, "conversationId"));
      if (!c || !(await shared.sees(c.chatId))) throw new PlanError("No such conversation");
      if (c.clientKey !== env.clientKey) throw new Refused("That conversation belongs to another client", 409);
      if (c.itemId) return `This conversation is already tracked as #${c.itemId}`;
      const commitmentId = o.commitmentId === undefined || o.commitmentId === null ? null : posId(o.commitmentId, "commitmentId");
      if (commitmentId !== null) {
        const k = await cv.view.commitment(commitmentId);
        if (!k || k.conversationId !== c.id) throw new PlanError("No such commitment");
        if (k.state !== "open") return "That promise is already handled";
      }
      const open = (await plan.devopsWriteLog(1000)).find((e) => e.op === "create" && e.conv?.conversationId === c.id && (e.status === "pending" || e.status === "unconfirmed" || (e.status === "confirmed" && e.undoneBy === null)));
      if (open) throw new Refused(open.status === "confirmed" ? `This conversation is already in DevOps as #${open.itemId}` : "A create from this conversation may already be in DevOps. Retry it in Settings > Data > Audit log: it checks first and won't make a second one", 409, "pending_write");
      const level = o.level as ItemLevel;
      if (level !== "bug" && level !== "story" && level !== "feature") throw new Invalid("level must be bug, story or feature");
      const title = str(o.title, "title", 255)!;
      const path = str(o.description, "description", 8000, true) ?? "";
      const pc = await writer.processConfig(org, pat, project);
      const chosen = str(o.type, "type", 128, true) ?? null;
      let parent: ItemSnapshot | null = null;
      if (o.parentId !== undefined && o.parentId !== null) {
        parent = await writer.item(org, pat, project, posId(o.parentId, "parentId"));
        const tiers = portfolioTiers(pc);
        if (!tiers.feature.has(parent.type) && !tiers.epic.has(parent.type)) throw new Refused(`#${parent.id} is a ${parent.type}: items go under a feature or an epic`, 409);
        // An unknown state counts as open (plan/process.ts).
        if (!isOpenCategory((await writer.states(org, pat, project, parent.type)).find((x) => x.name === parent!.state)?.category)) throw new Refused(`#${parent.id} is ${parent.state}; FocusTime adds items only under open parents`, 409);
      }
      // WT-1: the type goes where the process says (under the parent: one of its valid child types).
      const t = typeInfo(pc, level, { type: chosen, parentType: parent?.type ?? null });
      if (!t) throw new Refused(parent ? `${chosen ?? `A ${level}`} isn't a type that goes under #${parent.id} in this project` : level === "bug" ? "This project's process doesn't track bugs on a backlog. Create a story instead" : `This project's process has no ${level} level`, 409);
      const chat = await shared.teams.chat(c.chatId);
      const internal = chat?.kind === "delivery";
      const include = o.includeInternal === true;
      const originals: OriginalMessage[] = [];
      /** CV-5: the same messages as plain text, so the preview shows the full text that goes into DevOps. */
      const plain: string[] = [];
      // CV-4: the images of the messages going with it (an internal chat's only with "include internal").
      const offered: AttachOffer[] = [];
      if (!internal || include) {
        for (const p of (await cv.view.placesIn([c.id])).filter((x) => x.role === "work")) {
          const m = await shared.teams.message(p.chatId, p.messageId);
          if (!m) continue;
          const sender = m.senderName ?? chat?.members?.find((x: ChatMember) => x.userId && m.senderId && x.userId.toLowerCase() === m.senderId.toLowerCase())?.displayName ?? "Someone";
          const byAt: { name: string | null }[] = [];
          m.mentions.forEach((x, i) => (byAt[x.at ?? i] = { name: x.name }));
          originals.push({ sender, at: m.createdAt, html: sanitizeMessageHtml(m.html ?? m.text, { contentType: m.html ? "html" : "text", mentions: byAt }) });
          plain.push(`${sender} · ${shownAt(m.createdAt, tz)}: ${m.text}`);
          for (const i of (await shared.teams.images(m.chatId, [m.messageId])).filter((x) => x.state !== "skipped").sort((a, b) => a.position - b.position)) offered.push({ id: i.id, messageId: m.messageId, sender, at: m.createdAt, description: i.description });
        }
      }
      let ticked = offered.slice(0, ATTACH_LIMIT).map((x) => x.id);
      if (o.images !== undefined) {
        if (!Array.isArray(o.images) || o.images.some((x) => typeof x !== "number" || !offered.some((y) => y.id === x))) throw new Invalid("images must be ids of this conversation's images");
        if (o.images.length > ATTACH_LIMIT) throw new Invalid(`At most ${ATTACH_LIMIT} images on one item`);
        ticked = [...new Set(o.images as number[])];
      }
      const chatName = chat?.displayName ?? "a client chat";
      const description = descriptionHtml(path, originals, { zone: tz, chatName, chatLink: chat ? teamsLink(chat) : messageLink(c.chatId, "0") });
      const typeHas = await writer.typeFields(org, pat, project, t.type);
      const descriptionField = t.level === "bug" && typeHas.has(REPRO_FIELD) ? REPRO_FIELD : "System.Description";
      const area = parent ? String(parent.fields["System.AreaPath"] ?? "") || null : null;
      const iteration = parent ? String(parent.fields["System.IterationPath"] ?? "") || null : null;
      // CV-5: acceptance criteria only where the type has the field; me or nobody (never anyone else, D660 stays the only one).
      const acceptance = str(o.acceptance, "acceptance", 8000, true) ?? "";
      const acField = typeHas.has(AC_FIELD);
      if (o.assign !== undefined && o.assign !== "me" && o.assign !== "none") throw new Invalid("assign is me or none");
      const assignMe = o.assign !== "none";
      const ops = createOps({ org, title, description, descriptionIsHtml: true, acceptance, acField, assignedTo: assignMe ? env.me.email : null, areaPath: area, iterationPath: iteration, parentId: parent?.id ?? null, descriptionField, timeZone: tz });
      const pics = ticked.length ? ` Attached: ${ticked.length === 1 ? "1 image" : `${ticked.length} images`} from the chat.` : "";
      const tail = (originals.length ? `Then the ${originals.length === 1 ? "original message" : `${originals.length} original messages`} from ${chatName}, with who and when, and a link to the chat.` : internal ? `The messages from ${chatName} are left out: it's an internal chat. Only a link to it is added.` : "Then a link to the chat.") + pics;
      const full = [...(plain.length ? [`From the Teams conversation in ${chatName}`, ...plain] : []), `Open the chat in Teams: ${chat ? teamsLink(chat) : messageLink(c.chatId, "0")}`].join("\n");
      const after: Record<string, string | null> = {
        Type: t.type, Title: title, [descriptionField === REPRO_FIELD ? "Repro steps" : "Description"]: `${path}${path ? "\n\n" : ""}${tail}\n\n${full}`,
        ...(acField && acceptance.trim() ? { "Acceptance criteria": acceptance } : {}),
        "Assigned to": assignMe ? `${env.me.name} <${env.me.email}>` : "Nobody", Area: area ?? "The project's default", Iteration: iteration ?? "The project's default", ...(parent ? { Parent: `#${parent.id} ${parent.title}` } : {}),
      };
      let internalImages = false;
      if (internal && !include) for (const p of (await cv.view.placesIn([c.id])).filter((x) => x.role === "work")) if ((await shared.teams.images(p.chatId, [p.messageId])).length) internalImages = true;
      // CV-5: who will see it is the preview's own "Who can see it" (VISIBILITY), above the full text.
      const notesOut = [
        ...(acceptance.trim() && !acField ? [`${t.type} has no acceptance criteria field in this project, so they're left out.`] : []),
        ...(internalImages ? ["The chat's images are left out with its messages: it's an internal chat. Include the internal messages to offer them."] : []),
      ];
      return { ...base(env), ...none, op: "create", itemId: null, parentId: parent?.id ?? null, title, ops, rev: null, before: {}, after, type: t.type, conv: { conversationId: c.id, commitmentId, suggestionId: null }, notes: notesOut, ...(offered.length ? { attach: { offered, ticked } } : {}) };
    }
    case "conversation_comment":
    case "description_update": {
      // CV-1: a comment suggested for a linked item's owner, or a description change for a clear scope change.
      const cv = env.conversations;
      const shared = env.requests;
      if (o.kind === "conversation_comment" && o.suggestionId === undefined) return linkComment(env, o);
      if (!cv || !shared) throw new PlanError("No such suggestion");
      const sg = await cv.view.suggestion(posId(o.suggestionId, "suggestionId"));
      const kind = o.kind === "conversation_comment" ? "comment" : "description";
      if (!sg || sg.kind !== kind || (sg.forUser ?? "").toLowerCase() !== cv.me.toLowerCase()) throw new PlanError("No such suggestion");
      if (sg.state !== "open") return "This suggestion is already handled";
      const c = await cv.view.conversation(sg.conversationId);
      if (!c || !(await shared.sees(c.chatId))) throw new PlanError("No such suggestion");
      if (c.clientKey !== env.clientKey) throw new Refused("That suggestion belongs to another client", 409);
      const item = await writer.item(org, pat, project, sg.itemId);
      const conv = { conversationId: c.id, commitmentId: null, suggestionId: sg.id };
      if (kind === "comment") {
        const include = o.includeInternal === true;
        const edited = str(o.text, "text", 4000, true);
        const chat = await shared.teams.chat(c.chatId);
        const last = (await cv.view.placesIn([c.id])).filter((p) => p.role === "work").at(-1);
        const link = last ? messageLink(c.chatId, last.messageId) : chat ? teamsLink(chat) : messageLink(c.chatId, "0");
        const lines = edited ? edited.split("\n") : [...sg.body.split("\n"), ...(include ? sg.internal : [])];
        const text = commentText(lines, link);
        return { ...base(env), ...none, op: "comment", itemId: item.id, title: item.title, ops: { text }, rev: null, before: { Comment: null }, after: { Comment: text }, type: item.type, conv };
      }
      const field = "System.Description";
      const curHtml = String(item.fields[field] ?? "");
      const curText = htmlToText(curHtml);
      if (sg.before !== null && sg.before.trim() !== curText.trim()) throw new Refused(`#${item.id}'s description changed in DevOps since this was suggested. Skip it, or change it in DevOps`, 409, "changed");
      // The proposed text: the current description kept, the scope change added below (the person may edit it).
      const afterText = str(o.after, "after", 8000, true) ?? sg.after ?? descriptionAfter(curText, sg.body, sg.day);
      const added = afterText.trim().startsWith(curText.trim()) ? afterText.trim().slice(curText.trim().length).trim() : null;
      const html = added !== null ? `${curHtml}${curHtml && added ? "<div><br></div>" : ""}${added ? textToHtml(added) : ""}` : textToHtml(afterText);
      if (htmlToText(html).trim() === curText.trim()) return `#${item.id} already has that description`;
      return { ...base(env), ...none, op: "description", itemId: item.id, title: item.title, ops: descriptionOps(item.rev, field, html), rev: item.rev, before: { Description: curHtml }, after: { Description: html }, type: item.type, field, conv };
    }
    case "description_edit": {
      // AS-1: a description I dictated, which may rewrite it (unlike CV-1's description_update, which only appends):
      // only on items the shared canEdit allows, always the full text before and after, written only at the revision
      // read (test /rev); the old text is kept in the audit log for Undo, refused once the description changed since.
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      const right = await rightsOn(env, item, memo);
      if (!right.ok) throw new Refused(right.note, 409);
      const field = "System.Description";
      const curHtml = String(item.fields[field] ?? "");
      const afterText = str(o.after, "after", 8000, true) ?? "";
      if (!afterText.trim()) throw new Invalid("Say what the description should be");
      if (afterText.trim() === htmlToText(curHtml).trim()) return `#${item.id} already has that description`;
      const html = textToHtml(afterText.trim());
      return { ...base(env), ...none, op: "description", itemId: item.id, title: item.title, ops: descriptionOps(item.rev, field, html), rev: item.rev, before: { Description: curHtml }, after: { Description: html }, type: item.type, field };
    }
    case "undo": {
      const entry = (await plan.devopsWrite(posId(o.writeId, "writeId")));
      if (!entry) throw new PlanError("No such write");
      if (entry.op === "feedback") throw new Refused("Feedback can't be undone from FocusTime", 409);
      if (entry.clientKey !== env.clientKey || entry.org.toLowerCase() !== org.toLowerCase()) throw new Refused("That write belongs to another client", 409);
      if (entry.status !== "confirmed" || entry.itemId === null) throw new Refused("Only a confirmed change can be undone", 409);
      if (entry.op.startsWith("undo_")) throw new Refused("An undo isn't undone again: make the change again instead", 409);
      if (entry.undoneBy !== null) throw new Refused("Already undone", 409);
      if (undoTops((await plan.devopsWriteLog(1000))).get(stackKey(entry)) !== entry.id) throw new Refused(entry.op === "comment_edit" ? "Undo the newer edit of this comment first" : "Undo the newer change to this item first", 409);
      const item = await writer.item(org, pat, project, entry.itemId);
      const u = { ...base(env), ...none, itemId: item.id, title: item.title, undoOf: entry.id, type: item.type, parentId: entry.parentId };
      if (entry.op === "state") {
        if (item.state !== entry.after.State) throw new Refused(`DevOps shows #${item.id} as ${item.state} now, changed after FocusTime's change. Undo would overwrite that; change it in DevOps`, 409, "changed");
        return { ...u, op: "undo_state", ops: stateOps(item.rev, entry.before.State!), rev: item.rev, before: { State: item.state }, after: { State: entry.before.State ?? null }, commentId: entry.commentId };
      }
      if (entry.op === "remaining_work") {
        const was = item.fields[REMAINING_WORK];
        const cur = typeof was === "number" && Number.isFinite(was) ? String(was) : null;
        if (cur !== entry.after[REMAINING_LABEL]) throw new Refused(`DevOps shows another Remaining Work on #${item.id} now (${cur ?? "none"}). Undo would overwrite it`, 409, "changed");
        const prior = entry.before[REMAINING_LABEL] ?? null;
        return { ...u, op: "undo_remaining_work", ops: remainingOps(item.rev, prior === null ? null : Number(prior), cur !== null), rev: item.rev, before: { [REMAINING_LABEL]: cur }, after: { [REMAINING_LABEL]: prior } };
      }
      if (entry.op === "target_date") {
        const field = fieldOf(entry.ops);
        if (!field) throw new Refused("This change can't be undone (its field isn't recorded)", 409);
        const cur = dateOnly(item.fields[field], tz);
        if (cur !== entry.after["Target date"]) throw new Refused(`DevOps shows another target date on #${item.id} now (${cur ?? "none"}). Undo would overwrite it`, 409, "changed");
        const prior = entry.before["Target date"] ?? null;
        // Step 17: a dates write puts Start Date back too, if it is still what FocusTime set.
        if ("Start date" in entry.after) {
          const curStart = dateOnly(item.fields[START_FIELD], tz);
          if (curStart !== entry.after["Start date"]) throw new Refused(`DevOps shows another start date on #${item.id} now (${curStart ?? "none"}). Undo would overwrite it`, 409, "changed");
          const priorStart = entry.before["Start date"] ?? null;
          const had = (f: string) => item.fields[f] !== undefined && item.fields[f] !== null;
          return { ...u, op: "undo_target_date", ops: datesOps(item.rev, [{ field, date: prior, had: had(field) }, { field: START_FIELD, date: priorStart, had: had(START_FIELD) }], tz), rev: item.rev, before: { "Start date": curStart, "Target date": cur }, after: { "Start date": priorStart, "Target date": prior }, field };
        }
        return { ...u, op: "undo_target_date", ops: targetDateOps(item.rev, field, prior, tz, true), rev: item.rev, before: { "Target date": cur }, after: { "Target date": prior }, field };
      }
      if (entry.op === "assign") {
        // PV-1: back to who had it, only while it is still mine.
        const cur = identityEmail(item.fields["System.AssignedTo"]);
        if (cur !== assigneeEmail(entry.after["Assigned to"])) throw new Refused(`DevOps shows #${item.id} assigned to ${identityName(item.fields["System.AssignedTo"]) ?? "nobody"} now. Undo would overwrite that`, 409, "changed");
        const prior = entry.before["Assigned to"] ?? null;
        return { ...u, op: "undo_assign", ops: assignOps(item.rev, assigneeEmail(prior), cur !== null), rev: item.rev, before: { "Assigned to": entry.after["Assigned to"] ?? null }, after: { "Assigned to": prior } };
      }
      if (entry.op === "fields") {
        // AH-1: every field the patch changed goes back, only while DevOps still shows FocusTime's values.
        const cur = current(entry, item, tz);
        const moved = Object.keys(entry.after).filter((k) => (cur[k] ?? null) !== asCurrent(entry, k, entry.after[k]));
        if (moved.length) throw new Refused(`DevOps shows another ${moved.join(" and ").toLowerCase()} on #${item.id} now. Undo would overwrite it`, 409, "changed");
        const specs: FieldSpec[] = [];
        for (const [k, ref] of Object.entries(labelRefs(entry))) {
          const prior = entry.before[k] ?? null;
          const had = item.fields[ref] !== undefined && item.fields[ref] !== null && item.fields[ref] !== "";
          if (ref === "System.AssignedTo") specs.push({ kind: "identity", field: ref, value: assigneeEmail(prior), had });
          else if (ref === "System.State") {
            if (!prior) throw new Refused(`The state #${item.id} had isn't in the log, so it can't be put back`, 409, "changed");
            specs.push({ kind: "state", field: ref, value: prior, had: true });
          } else if (k === FIELD_LABEL.start || k === FIELD_LABEL.target) specs.push({ kind: "date", field: ref, value: prior, had });
          else specs.push({ kind: "number", field: ref, value: prior === null ? null : Number(prior), had });
        }
        const back: Record<string, string | null> = Object.fromEntries(Object.keys(entry.after).map((k) => [k, entry.before[k] ?? null]));
        const nowShown: Record<string, string | null> = Object.fromEntries(Object.keys(entry.after).map((k) => [k, entry.after[k] ?? null]));
        return { ...u, op: "undo_fields", ops: fieldsOps(item.rev, specs, tz), rev: item.rev, before: nowShown, after: back };
      }
      if (entry.op === "description") {
        const field = fieldOf(entry.ops) ?? "System.Description";
        const curHtml = String(item.fields[field] ?? "");
        if (htmlToText(curHtml).trim() !== htmlToText(entry.after.Description ?? "").trim()) throw new Refused(`DevOps shows another description on #${item.id} now. Undo would overwrite it`, 409, "changed");
        return { ...u, op: "undo_description", ops: descriptionOps(item.rev, field, entry.before.Description ?? ""), rev: item.rev, before: { Description: curHtml }, after: { Description: entry.before.Description ?? null }, field };
      }
      if (entry.op === "comment_edit") {
        const cid = editedComment(entry.ops);
        if (cid === null) throw new Refused("The comment's id wasn't recorded, so the edit can't be undone from here", 409);
        const cm = await writer.getComment(org, pat, project, item.id, cid);
        if (cm.isDeleted) throw new Refused("That comment was deleted in DevOps", 409, "changed");
        if (!sameText(cm.text, entry.after.Comment ?? "")) throw new Refused("The comment changed in DevOps since FocusTime's edit. Undo would overwrite that; change it in DevOps", 409, "changed");
        return { ...u, op: "undo_comment_edit", ops: { text: entry.before.Comment ?? "", commentId: cid }, rev: null, before: { Comment: entry.after.Comment ?? null }, after: { Comment: entry.before.Comment ?? null } };
      }
      if (entry.op === "comment_delete") {
        // SR-3: the deleted comment's text, posted again as a new comment of mine.
        const text = entry.before.Comment ?? "";
        if (!text.trim()) throw new Refused("The deleted comment's text wasn't recorded, so it can't be put back from here", 409);
        return { ...u, op: "undo_comment_delete", ops: { text }, rev: null, before: { Comment: "(deleted)" }, after: { Comment: text }, notes: ["Posted as a new comment, dated now. DevOps has no way to bring back the deleted one"] };
      }
      if (entry.op === "comment") {
        if (entry.commentId === null) throw new Refused("The comment's id wasn't recorded, so it can't be deleted from here", 409);
        const cm = await writer.getComment(org, pat, project, item.id, entry.commentId);
        if (cm.isDeleted) return "That comment is already deleted";
        return { ...u, op: "undo_comment", ops: null, rev: null, before: { Comment: htmlToText(cm.text) || cm.text }, after: { Comment: "(deleted)" }, commentId: entry.commentId };
      }
      // A create: never deleted, set to its type's Removed state with a comment.
      const states = await writer.states(org, pat, project, item.type);
      const removed = removedState(states);
      if (!removed) throw new Refused(`${item.type} has no Removed state in this process. FocusTime never deletes items: close or remove #${item.id} in DevOps`, 409);
      if (item.state === removed) return `#${item.id} is already ${removed}`;
      // CV-4: the images it linked are unlinked in the same patch (by index, highest first); the files stay in DevOps.
      const ours = new Set(attachedUrls(entry.ops).map(attachmentId));
      const at = item.relations.flatMap((r, i) => (r.rel === ATTACHED && ours.has(attachmentId(r.url)) ? [i] : [])).sort((a, b) => b - a);
      const unlink: PatchOp[] = at.map((i) => ({ op: "remove", path: `/relations/${i}` }));
      const pics = at.length === 1 ? "1 image" : `${at.length} images`;
      return {
        ...u, op: "undo_create", ops: [...removeOps(item.rev, removed), ...unlink], rev: item.rev,
        before: { State: item.state, Comment: null, ...(at.length ? { Attachments: `${pics} linked` } : {}) }, after: { State: removed, Comment: REMOVED_COMMENT, ...(at.length ? { Attachments: "Unlinked" } : {}) },
        draftId: entry.draftId, pickIds: entry.pickIds, ask: entry.ask ?? null, conv: entry.conv ?? null,
        ...(at.length ? { notes: [`Unlinks the ${pics}. The files stay in DevOps, unlinked: DevOps has no way to delete an attachment.`] } : {}),
      };
    }
    default:
      throw new Invalid("kind must be state, comment, comment_edit, comment_delete, create, new_item, request_create, proposal_create, conversation_create, conversation_comment, description_update, description_edit, target_date, assign, fields or undo");
  }
}

const REPRO_FIELD = "Microsoft.VSTS.TCM.ReproSteps";
/** The default bug type (typeInfo, actions/work-item-types.ts). */
const bugType = (pc: unknown) => typeInfo(pc, "bug")?.type ?? null;
const fieldOf = (ops: DevOpsWriteEntry["ops"]) => (Array.isArray(ops) ? ops.find((p) => p.op !== "test")?.path.replace(/^\/fields\//, "") ?? null : null);
/** The default work item type of the story level or the feature tier (typeInfo). */
const defaultType = (pc: unknown, level: "story" | "feature") => typeInfo(pc, level)?.type ?? null;

/** What DevOps shows now for the fields a write is about, keyed like the entry. */
function current(e: DevOpsWriteEntry, item: ItemSnapshot, tz: string): Record<string, string | null> {
  if (e.op === "state" || e.op === "undo_state" || e.op === "undo_create") return { State: item.state };
  if (e.op === "target_date" || e.op === "undo_target_date") {
    const f = fieldOf(e.ops);
    return { ...("Start date" in e.after ? { "Start date": dateOnly(item.fields[START_FIELD], tz) } : {}), "Target date": f ? dateOnly(item.fields[f], tz) : null };
  }
  // TX-1: Remaining Work as a number's text.
  if (e.op === "remaining_work" || e.op === "undo_remaining_work") {
    const v = item.fields[REMAINING_WORK];
    return { [REMAINING_LABEL]: typeof v === "number" && Number.isFinite(v) ? String(v) : null };
  }
  // PV-1: an assignee is compared by email.
  if (e.op === "assign" || e.op === "undo_assign") return { "Assigned to": identityEmail(item.fields["System.AssignedTo"]) };
  // AH-1: each field by its label: dates by day, sizes as numbers, the assignee by email.
  if (e.op === "fields" || e.op === "undo_fields") {
    const out: Record<string, string | null> = {};
    for (const [k, ref] of Object.entries(labelRefs(e))) {
      const v = item.fields[ref];
      out[k] = ref === "System.AssignedTo" ? identityEmail(v) : ref === "System.State" ? (typeof v === "string" ? v : null) : k === FIELD_LABEL.start || k === FIELD_LABEL.target ? dateOnly(v, tz) : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
    }
    return out;
  }
  // CV-1: a description is compared as text (DevOps may tidy the HTML it stores).
  if (e.op === "description" || e.op === "undo_description") return { Description: htmlToText(String(item.fields[fieldOf(e.ops) ?? "System.Description"] ?? "")).trim() };
  return {};
}
/** A logged value as current() reports it. */
const asCurrent = (e: DevOpsWriteEntry, k: string, v: string | null | undefined) => ((e.op === "description" || e.op === "undo_description") && k === "Description" ? htmlToText(v ?? "").trim() : (e.op === "assign" || e.op === "undo_assign" || e.op === "fields" || e.op === "undo_fields") && k === "Assigned to" ? assigneeEmail(v) : v ?? null);

/**
 * AH-1: a fields write's labels and the fields behind them, from its ops: Start Date, System.AssignedTo, one of the
 * size fields (its label is the field's own name), and the target date field (whatever the process calls it).
 */
function labelRefs(e: Pick<DevOpsWriteEntry, "ops" | "after">): Record<string, string> {
  const out: Record<string, string> = {};
  const sizeLabel = Object.keys(e.after).find((k) => k !== FIELD_LABEL.start && k !== FIELD_LABEL.target && k !== FIELD_LABEL.assignee && k !== FIELD_LABEL.state);
  for (const ref of fieldRefsOf(e.ops)) {
    if (ref === START_FIELD) out[FIELD_LABEL.start] = ref;
    else if (ref === "System.AssignedTo") out[FIELD_LABEL.assignee] = ref;
    else if (ref === "System.State") out[FIELD_LABEL.state] = ref;
    else if ((TYPE_SIZE_FIELDS as readonly string[]).includes(ref) && sizeLabel) out[sizeLabel] = ref;
    else out[FIELD_LABEL.target] = ref;
  }
  return out;
}

/** What DevOps has now for a change set field of an item (the type's own field; null when it has none). */
function valueNow(item: ItemSnapshot, f: ChangeField, ref: string | null, tz: string): ChangeValue {
  if (!ref) return null;
  const v = item.fields[ref];
  if (f === "start" || f === "target") return dateOnly(v, tz);
  if (f === "size") return typeof v === "number" && Number.isFinite(v) ? v : null;
  if (f === "state") return typeof v === "string" ? v : null;
  const email = identityEmail(v);
  return email ? { email, name: identityName(v) ?? email } : null;
}

/**
 * AH-1 (D656): may I change this item? A lead of the client, its owner, or the owner one level up (its parent, read
 * here), with the levels from process configuration. Without Ahead's port (older callers), only my own items.
 */
async function rightsOn(env: Env, item: ItemSnapshot, memo: Map<string, Promise<unknown>>): Promise<EditRight> {
  const port = env.ahead;
  const mine = identityEmail(item.fields["System.AssignedTo"]) === env.me.email.toLowerCase();
  if (!port) return mine ? { ok: true, why: "owner" } : { ok: false, note: `#${item.id} isn't assigned to you, so FocusTime won't change it` };
  const once = <T,>(k: string, f: () => Promise<T>) => (memo.get(k) ?? memo.set(k, f()).get(k)!) as Promise<T>;
  const [lead, automation] = await Promise.all([port.isLead(env.clientKey).catch(() => false), port.automation().catch(() => false)]);
  const ladder = await once("ladder", async () => ladderFromProcessConfig(await env.writer.processConfig(env.org, env.pat, env.project)));
  const parent = !lead && !mine && item.parentId !== null ? await once(`item:${item.parentId}`, () => env.writer.item(env.org, env.pat, env.project, item.parentId!)).catch(() => null) : null;
  const at = (i: ItemSnapshot) => ({ assigneeEmail: identityEmail(i.fields["System.AssignedTo"]), rung: rungOf(ladder, i.type) });
  return canEdit({ email: env.me.email, lead, automation }, at(item), parent ? at(parent) : null, env.clientName);
}
const applied = (e: DevOpsWriteEntry, now: Record<string, string | null>) => Object.keys(now).every((k) => (now[k] ?? null) === asCurrent(e, k, e.after[k]));

/**
 * CV-4: before a create from a conversation is sent, each ticked image is read from Teams with my own token (the
 * member check again, the stripper, 10 MB at most), kept in memory only, uploaded as an attachment with my write PAT,
 * and added to the create patch as an AttachedFile relation ("From Teams, <name>, <date time>"); the description
 * gains "Attached: N images from the chat". The audit log keeps the image ids, file names, sizes, attachment ids and
 * URLs, never the bytes. One that can't be read or uploaded is left out and the item is still created. Saved on the
 * log entry before the create, so a retry never uploads again.
 */
async function attachImages(ctx: DevOpsWriteContext, env: Env, entry: DevOpsWriteEntry, attach: NonNullable<Held["attach"]>, tz: string): Promise<{ entry: DevOpsWriteEntry; attached: number; failed: number }> {
  const teams = env.requests?.teams;
  const client = teams ? await ctx.chatImages?.().catch(() => null) : null;
  const rels: PatchOp[] = [];
  const lines: string[] = [];
  let failed = 0;
  const when = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainDateTime().toString({ smallestUnit: "minute" }).replace("T", " ");
  for (const id of attach.ticked.slice(0, ATTACH_LIMIT)) {
    const offer = attach.offered.find((x) => x.id === id);
    const row = teams && offer ? await teams.image(id).catch(() => null) : null;
    const got: ReadImage = row && client && teams ? await readImage(teams, client, row).catch((): ReadImage => ({ ok: false, why: "gone" })) : { ok: false, why: "gone" };
    if (!got.ok || !offer) {
      failed++;
      lines.push(`Image ${id}: not attached (couldn't be read from Teams)`);
      continue;
    }
    const n = rels.length + 1;
    const stamp = when(offer.at).replace(/[-: ]/g, "").slice(0, 12);
    const name = `teams-image-${stamp}-${n}.${got.type === "image/png" ? "png" : got.type === "image/gif" ? "gif" : "jpg"}`;
    try {
      const up = await env.writer.uploadAttachment(env.org, env.pat, name, got.bytes);
      rels.push({ op: "add", path: "/relations/-", value: { rel: ATTACHED, url: up.url, attributes: { comment: `From Teams, ${offer.sender}, ${when(offer.at)}` } } });
      lines.push(`Image ${id}: ${name}, ${Math.max(1, Math.round(got.bytes.length / 1024))} KB, attachment ${up.id}, ${up.url}`);
    } catch (e) {
      if (!(e instanceof WriteFailure)) throw e;
      failed++;
      lines.push(`Image ${id}: not attached (DevOps refused the upload)`);
    }
  }
  const ops = (entry.ops as PatchOp[]).map((p) =>
    rels.length && p.op === "add" && (p.path === "/fields/System.Description" || p.path === `/fields/${REPRO_FIELD}`) && typeof p.value === "string"
      ? { ...p, value: `${p.value}<div>Attached: ${rels.length === 1 ? "1 image" : `${rels.length} images`} from the chat</div>` }
      : p,
  );
  const saved = await env.plan.setDevopsWriteOps(entry.id, [...ops, ...rels], { ...entry.after, Attachments: lines.join("\n") || null });
  return { entry: saved, attached: rels.length, failed };
}

/**
 * One attempt at a logged write, safe to repeat: a retry first checks whether the change is already there (an update
 * already applied, a comment already posted, a created item already under its parent) and adopts it rather than
 * writing twice. Success only after reading it back.
 */
async function attempt(ctx: DevOpsWriteContext, env: Env, entry: DevOpsWriteEntry, retry: boolean, tz: string): Promise<DevOpsResult> {
  const { writer, org, pat, project, plan } = env;
  const settle = async (status: DevOpsWriteEntry["status"], message: string, more: { itemId?: number | null; revAfter?: number | null; commentId?: number | null; pickIds?: number[] } = {}, extra: Partial<DevOpsResult> = {}): Promise<DevOpsResult> => {
    const e = (await plan.settleDevopsWrite(entry.id, { status, message, retry, ...more }));
    return { entry: e, confirmed: status === "confirmed", message, ...extra };
  };
  const forget = () => ctx.devops?.(env.cfg).forget(env.clientKey);
  // D255: a read-back that fails on the network is tried once more after a short wait.
  const again = <T,>(read: () => Promise<T>) => readBack(read, (e) => e instanceof WriteFailure && e.kind === "network", ctx.sleep);
  try {
    if (entry.op === "comment") {
      const text = (entry.ops as { text: string }).text;
      let posted = null as Awaited<ReturnType<DevOpsWriter["getComment"]>> | null;
      // A comment by me with the same text since the attempt (an hour of clock skew allowed) is the one that landed.
      if (retry) posted = (await writer.comments(org, pat, project, entry.itemId!)).find((c) => !c.isDeleted && c.createdBy?.toLowerCase() === env.me.email.toLowerCase() && sameText(c.text, text) && (!c.createdDate || Temporal.Instant.compare(Temporal.Instant.from(c.createdDate), Temporal.Instant.from(entry.at).subtract({ hours: 1 })) >= 0)) ?? null;
      const made = posted ?? (await writer.addComment(org, pat, project, entry.itemId!, text));
      (await plan.settleDevopsWrite(entry.id, { status: "pending", commentId: made.id }));
      const back = await again(() => writer.getComment(org, pat, project, entry.itemId!, made.id));
      if (back.isDeleted || !sameText(back.text, text)) return settle("unconfirmed", "DevOps didn't show the comment yet. Retry checks first and won't post it twice", { commentId: made.id });
      forget();
      if (entry.conv?.suggestionId && ctx.conversations) await ctx.conversations.posted(entry.conv.suggestionId, entry.id).catch(() => {});
      return settle("confirmed", posted ? "Already in DevOps (found on retry)" : "Comment added in DevOps", { commentId: made.id });
    }
    if (entry.op === "comment_edit" || entry.op === "undo_comment_edit") {
      const { text, commentId } = entry.ops as { text: string; commentId: number };
      const now = await writer.getComment(org, pat, project, entry.itemId!, commentId);
      if (now.isDeleted) return settle("refused", "That comment was deleted in DevOps, so it wasn't changed");
      // A retry that finds the text already there adopts it rather than writing again.
      if (!sameText(now.text, text)) await writer.updateComment(org, pat, project, entry.itemId!, commentId, text);
      const back = await again(() => writer.getComment(org, pat, project, entry.itemId!, commentId));
      if (back.isDeleted || !sameText(back.text, text)) return settle("unconfirmed", "DevOps didn't show the new text yet. Retry checks first");
      if (entry.op === "undo_comment_edit") await plan.markDevopsUndone(entry.undoOf!, entry.id);
      forget();
      return settle("confirmed", entry.op === "undo_comment_edit" ? "Comment put back in DevOps" : "Comment edited in DevOps");
    }
    if (entry.op === "comment_delete") {
      const { commentId } = entry.ops as { commentId: number };
      const now = await writer.getComment(org, pat, project, entry.itemId!, commentId);
      if (!now.isDeleted) await writer.deleteComment(org, pat, project, entry.itemId!, commentId);
      const back = await again(() => writer.getComment(org, pat, project, entry.itemId!, commentId));
      if (!back.isDeleted) return settle("unconfirmed", "DevOps still shows the comment. Retry checks first");
      forget();
      return settle("confirmed", "Comment deleted in DevOps");
    }
    if (entry.op === "undo_comment_delete") {
      const text = (entry.ops as { text: string }).text;
      // As for a new comment: a retry adopts the one that landed rather than posting twice.
      const posted = retry ? ((await writer.comments(org, pat, project, entry.itemId!)).find((c) => !c.isDeleted && c.createdBy?.toLowerCase() === env.me.email.toLowerCase() && sameText(c.text, text) && (!c.createdDate || Temporal.Instant.compare(Temporal.Instant.from(c.createdDate), Temporal.Instant.from(entry.at).subtract({ hours: 1 })) >= 0)) ?? null) : null;
      const made = posted ?? (await writer.addComment(org, pat, project, entry.itemId!, text));
      (await plan.settleDevopsWrite(entry.id, { status: "pending", commentId: made.id }));
      const back = await again(() => writer.getComment(org, pat, project, entry.itemId!, made.id));
      if (back.isDeleted || !sameText(back.text, text)) return settle("unconfirmed", "DevOps didn't show the comment yet. Retry checks first and won't post it twice", { commentId: made.id });
      await plan.markDevopsUndone(entry.undoOf!, entry.id);
      forget();
      return settle("confirmed", "Comment posted again in DevOps", { commentId: made.id });
    }
    if (entry.op === "undo_comment") {
      const before = await writer.getComment(org, pat, project, entry.itemId!, entry.commentId!);
      if (!before.isDeleted) await writer.deleteComment(org, pat, project, entry.itemId!, entry.commentId!);
      const back = await again(() => writer.getComment(org, pat, project, entry.itemId!, entry.commentId!));
      if (!back.isDeleted) return settle("unconfirmed", "DevOps still shows the comment. Retry to delete it again");
      (await plan.markDevopsUndone(entry.undoOf!, entry.id));
      forget();
      return settle("confirmed", "Comment deleted in DevOps");
    }
    if (entry.op === "create") {
      let id = entry.itemId;
      if (retry && id === null) {
        // Was it created before the answer got lost? Look under the parent for it, made by me since the attempt.
        const since = Temporal.Instant.from(entry.at).toZonedDateTimeISO("UTC").toPlainDate().subtract({ days: 1 }).toString();
        const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
        const where = entry.parentId !== null ? `[System.Parent] = ${entry.parentId}` : `[System.WorkItemType] = ${quote(entry.after.Type ?? "")}`;
        const q = `SELECT [System.Id] FROM WorkItems WHERE ${where} AND [System.Title] = ${quote(entry.title)} AND [System.CreatedBy] = @Me AND [System.CreatedDate] >= '${since}'`;
        const found = await writer.wiql(org, pat, project, q);
        if (found.length > 1) return settle("refused", `DevOps already has ${found.length} items with this title ${entry.parentId !== null ? `under #${entry.parentId}` : "made by you since then"}. Check DevOps; FocusTime won't make another`);
        id = found[0] ?? null;
      }
      if (id === null) {
        let made: ItemSnapshot;
        try {
          made = await writer.create(org, pat, project, entry.after.Type!, entry.ops as PatchOp[]);
        } catch (e) {
          // TP-1: a refused create made nothing (DevOps applies a create's patch whole or not at all). When it carried
          // the request type tag and DevOps names tags (or refuses with 403, the write PAT already checked), say so in
          // plain words: the person can create it again without the tag.
          const tagged = typeof (entry.ops as PatchOp[]).find((p) => p.path === `/fields/${TAGS_FIELD}`)?.value === "string";
          if (tagged && e instanceof WriteFailure && ((e.kind === "rejected" && /\btags?\b/i.test(e.message)) || e.kind === "forbidden"))
            return settle("refused", `DevOps didn't let you add the tag ${entry.after.Tags ?? "for the request type"} in ${env.projectName} (adding a new tag there needs the Create tag definition permission). Nothing was created. You can create it without the tag`, {}, { code: "tag_refused" });
          throw e;
        }
        id = made.id;
        (await plan.settleDevopsWrite(entry.id, { status: "pending", itemId: id }));
      }
      const back = await again(() => writer.item(org, pat, project, id!));
      // CV-5: a create may leave it unassigned (no AssignedTo in the patch): then any assignee DevOps' own rules set is fine.
      // QC-1: the assignee is whoever the patch names (me, or someone on the client's project).
      const assignedTo = (entry.ops as PatchOp[]).find((p) => p.path === "/fields/System.AssignedTo")?.value;
      const ok = back.title === entry.title && (back.parentId ?? null) === entry.parentId && (typeof assignedTo !== "string" || identityEmail(back.fields["System.AssignedTo"]) === assignedTo.toLowerCase());
      if (!ok) return settle("unconfirmed", `DevOps didn't show #${id} as asked yet (title, parent or assignee). Retry checks first and won't create another`, { itemId: id });
      // CV-4: every image it was meant to have is linked.
      const linked = new Set(back.relations.filter((r) => r.rel === ATTACHED).map((r) => attachmentId(r.url)));
      if (attachedUrls(entry.ops).some((u) => !linked.has(attachmentId(u)))) return settle("unconfirmed", `DevOps didn't show the images on #${id} yet. Retry checks first and won't create another`, { itemId: id });
      const url = workItemUrl(org, env.projectName, id);
      const pickIds = entry.draftId !== null && (await plan.getDraft(entry.draftId)) && !(await plan.getDraft(entry.draftId))!.devopsId ? (await plan.markDraftCreated(entry.draftId, { itemId: id, url, title: back.title, type: back.type })) : entry.pickIds;
      // The request it came from is resolved as created, for everyone (once; a second confirm finds it resolved already).
      const shared = ctx.requests;
      if (entry.ask && shared) {
        const a = await shared.teams.request(entry.ask.chatId, entry.ask.messageId);
        if (a?.status === "open") await shared.teams.resolveRequest(entry.ask.chatId, entry.ask.messageId, { status: "created", itemId: id, itemUrl: url, itemTitle: back.title, writeId: entry.id });
      }
      if (entry.conv && ctx.conversations) await ctx.conversations.created(entry.conv, { id, url, title: back.title });
      // QC-1: the read back goes straight into FocusTime's store, so every open screen shows the new item now (DV-2).
      await ctx.ahead?.stored?.(env.clientKey, { id: back.id, fields: { ...back.fields, "System.Rev": back.rev } }).catch(() => {});
      // TP-1: counted for Admin › Work templates (the tag and whether all four lines were filled; nothing else).
      const typeTagOf = (entry.ops as PatchOp[]).find((p) => p.path === `/fields/${TAGS_FIELD}`)?.value;
      if (typeof typeTagOf === "string" && typeTagOf.startsWith(TAG_PREFIX) && ctx.templates && !retry) {
        const html = (entry.ops as PatchOp[]).find((p) => p.path === "/fields/System.Description")?.value;
        const filled = readFilled(readLines(typeof html === "string" ? html : ""));
        await ctx.templates.used(typeTagOf.slice(TAG_PREFIX.length), LINE_KEYS.every((k) => filled[k])).catch(() => {});
      }
      forget();
      return settle("confirmed", `Created #${id} in DevOps`, { itemId: id, revAfter: back.rev, pickIds }, { itemId: id, url });
    }
    // Updates with a rev test: state, target date, and the undos of state, target date and create.
    const itemId = entry.itemId!;
    let wrote: { rev: number; commentId: number | null } | null = null;
    if (retry) {
      const now = await writer.item(org, pat, project, itemId);
      if (applied(entry, current(entry, now, tz))) wrote = { rev: now.rev, commentId: entry.commentId };
      else if (now.rev !== entry.revBefore) return conflict(entry, now);
    }
    if (!wrote) {
      try {
        const r = await writer.update(org, pat, project, itemId, entry.ops as PatchOp[]);
        wrote = { rev: r.rev, commentId: entry.op === "state" ? r.commentId : entry.commentId };
      } catch (e) {
        if (e instanceof WriteFailure && (e.kind === "changed" || e.kind === "rejected")) {
          const now = await writer.item(org, pat, project, itemId);
          if (e.kind === "changed" || now.rev !== entry.revBefore) return conflict(entry, now);
        }
        throw e;
      }
      if (entry.op === "state") (await plan.settleDevopsWrite(entry.id, { status: "pending", commentId: wrote.commentId }));
    }
    const back = await again(() => writer.item(org, pat, project, itemId));
    if (!applied(entry, current(entry, back, tz))) return settle("unconfirmed", "DevOps didn't show the change yet. Retry checks first and won't write twice", { revAfter: back.rev });
    // AH-1 (D660): the read-back goes straight into the central store and its change log, so every screen shows it.
    await ctx.ahead?.stored?.(env.clientKey, { id: back.id, fields: { ...back.fields, "System.Rev": back.rev } }).catch(() => {});
    if (entry.op === "fields" || entry.op === "undo_fields") await aheadLanded(ctx, env, entry, back, tz).catch(() => {});
    // CV-4: an undone create's images are unlinked (the files stay in DevOps: there's no delete).
    let unlinked = 0;
    if (entry.op === "undo_create" && entry.undoOf !== null) {
      const made = await plan.devopsWrite(entry.undoOf);
      const ours = new Set(attachedUrls(made?.ops ?? null).map(attachmentId));
      if (ours.size && back.relations.some((r) => r.rel === ATTACHED && ours.has(attachmentId(r.url)))) return settle("unconfirmed", "DevOps still shows the images linked. Retry checks first", { revAfter: back.rev });
      unlinked = ours.size;
    }
    if (entry.op === "undo_state" && entry.commentId !== null) {
      // The comment that came with the original change goes too.
      const cm = await writer.getComment(org, pat, project, itemId, entry.commentId).catch(() => null);
      if (cm && !cm.isDeleted) await writer.deleteComment(org, pat, project, itemId, entry.commentId);
    }
    if (entry.undoOf !== null) (await plan.markDevopsUndone(entry.undoOf, entry.id));
    if (entry.op === "undo_create" && entry.draftId !== null) (await plan.restoreDraft(entry.draftId, entry.pickIds));
    // Undoing a create from a request opens the request again, for everyone.
    if (entry.op === "undo_create" && entry.undoOf !== null && ctx.requests) {
      const made = await plan.devopsWrite(entry.undoOf);
      const a = made?.ask ? await ctx.requests.teams.request(made.ask.chatId, made.ask.messageId) : null;
      if (made?.ask && a?.status === "created" && a.itemId === itemId) await ctx.requests.teams.resolveRequest(made.ask.chatId, made.ask.messageId, { status: "open" });
    }
    if (entry.op === "undo_create" && entry.undoOf !== null && ctx.conversations) {
      const made = await plan.devopsWrite(entry.undoOf);
      if (made?.conv) await ctx.conversations.uncreated(made.conv, itemId);
    }
    if (entry.op === "description" && entry.conv?.suggestionId && ctx.conversations) await ctx.conversations.posted(entry.conv.suggestionId, entry.id).catch(() => {});
    // PV-1: Take one tells the previous assignee (their own scheduler pass sends the notice); its undo takes that back.
    const takenFrom = entry.op === "assign" ? assigneeEmail(entry.before["Assigned to"]) : entry.op === "undo_assign" ? assigneeEmail(entry.after["Assigned to"]) : null;
    if (takenFrom && ctx.takes) {
      const t = { clientKey: env.clientKey, org: env.org, itemId, fromEmail: takenFrom };
      await (entry.op === "assign" ? ctx.takes.add({ ...t, byName: env.me.name }) : ctx.takes.remove(t)).catch(() => {});
    }
    if (entry.op === "state" && entry.followUpId !== null) {
      const f = (await plan.getFollowUp(entry.followUpId));
      if (f && !f.closedAt) (await plan.closeFollowUp(entry.followUpId, `Marked ${entry.after.State} in DevOps`, "me", { how: "devops", outcome: "done" }));
    }
    forget();
    const msg = entry.op === "undo_create" && unlinked ? `Undone in DevOps. The ${unlinked === 1 ? "image stays in DevOps as a file" : `${unlinked} images stay in DevOps as files`}, unlinked: DevOps has no way to delete an attachment` : entry.op.startsWith("undo_") ? "Undone in DevOps" : entry.op === "fields" ? `#${itemId} changed in DevOps` : entry.op === "state" ? `#${itemId} is ${entry.after.State} in DevOps` : entry.op === "description" ? "Description changed in DevOps" : entry.op === "assign" ? `#${itemId} is assigned to you in DevOps` : "Target date set in DevOps";
    return settle("confirmed", msg, { revAfter: back.rev, ...(wrote.commentId !== null ? { commentId: wrote.commentId } : {}) });
  } catch (e) {
    if (e instanceof WriteFailure) {
      if (e.kind === "network") return settle("unconfirmed", "DevOps didn't answer, so FocusTime can't tell whether the change landed. Retry checks first and won't write twice");
      if (e.kind === "auth" || e.kind === "forbidden") return settle("failed", e.message);
      if (e.kind === "not_found") return settle("refused", e.message);
      return settle("failed", e.message);
    }
    if (e instanceof PlanError) return settle("refused", e.message);
    return settle("failed", "The change didn't go through. Retry");
  }

  function conflict(e: DevOpsWriteEntry, now: ItemSnapshot): Promise<DevOpsResult> {
    const changed = Object.entries(current(e, now, tz)).filter(([k, v]) => asCurrent(e, k, e.before[k]) !== v).map(([k, v]) => ({ field: k, was: asCurrent(e, k, e.before[k]), now: v }));
    const what = changed.length ? changed.map((c) => `${c.field} is ${c.now ?? "empty"} (was ${c.was ?? "empty"})`).join("; ") : `it is at revision ${now.rev} now (was ${e.revBefore})`;
    return settle("refused", `Changed in DevOps since you loaded it: ${what}. Nothing was written. Reload to review it again`, {}, { changed });
  }
}

/**
 * AH-1: a fields write landed (or its undo). Its changes leave my change set and a date's half stays in FocusTime
 * (D659). A new assignee who isn't me gets one notice; the owner of an item whose dates moved gets one per commit,
 * grouped when sent (D664). An undo of an assignment takes its notice back.
 */
async function aheadLanded(ctx: DevOpsWriteContext, env: Env, entry: DevOpsWriteEntry, back: ItemSnapshot, tz: string): Promise<void> {
  const port = ctx.ahead;
  const itemId = back.id;
  const refs = labelRefs(entry);
  const fieldOfLabel = (k: string): ChangeField => (k === FIELD_LABEL.start ? "start" : k === FIELD_LABEL.target ? "target" : k === FIELD_LABEL.assignee ? "assignee" : k === FIELD_LABEL.state ? "state" : "size");
  if (port && entry.op === "fields") {
    const staged = await port.staged(env.clientKey, itemId);
    for (const k of Object.keys(refs)) {
      const f = fieldOfLabel(k);
      const x = staged.find((s) => s.field === f);
      if (!x) continue;
      if ((f === "start" || f === "target") && typeof x.value === "string") await port.setHalf(env.clientKey, itemId, f, x.value, x.half);
      await port.landed(env.clientKey, itemId, f);
    }
  }
  // AH-7: a gap this save filled (or its undo emptied again) counts in Readiness's "N fixed this week".
  if (entry.op === "fields" || entry.op === "undo_fields") {
    const filled = Object.keys(refs).flatMap((k) => {
      const g = fills(fieldOfLabel(k), entry.op === "fields" ? entry.before[k] : entry.after[k], entry.op === "fields" ? entry.after[k] : entry.before[k]);
      return g ? [g] : [];
    });
    if (filled.length) {
      const key = `${env.clientKey}:${itemId}`;
      const log = readFixed(await env.plan.getState<unknown>(FIXED_KEY));
      await env.plan.setState(FIXED_KEY, entry.op === "fields" ? addFixed(log, key, filled, ctx.now().toString()) : dropFixed(log, key, filled));
    }
  }
  const notes = ctx.notes;
  if (!notes) return;
  const me = env.me.email.toLowerCase();
  const was = assigneeEmail(entry.before[FIELD_LABEL.assignee]);
  const now = assigneeEmail(entry.after[FIELD_LABEL.assignee]);
  if (FIELD_LABEL.assignee in entry.after) {
    const coop = now && port?.isCooptimizer ? await port.isCooptimizer(env.clientKey, now).catch(() => false) : true;
    if (entry.op === "fields" && now && now !== me && coop) await notes.add({ kind: "assigned", clientKey: env.clientKey, org: env.org, itemIds: [itemId], toEmail: now, byName: env.me.name });
    if (entry.op === "undo_fields" && was && was !== me) await notes.remove({ kind: "assigned", org: env.org, toEmail: was, itemId });
  }
  const owner = identityEmail(back.fields["System.AssignedTo"]);
  const datesMoved = (FIELD_LABEL.start in entry.after || FIELD_LABEL.target in entry.after) && entry.op === "fields";
  if (datesMoved && owner && owner !== me && owner !== now) await notes.add({ kind: "dates", clientKey: env.clientKey, org: env.org, itemIds: [itemId], toEmail: owner, byName: env.me.name });
  void tz;
}

const sameText = (html: string, text: string) => html.trim() === text.trim() || htmlToText(html).trim() === text.trim() || (/<[a-z]/i.test(text) && htmlToText(html).trim() === htmlToText(text).trim());
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** LP-1: a person on this item (assignee, creator, last changer) by their DevOps address: their identity id and name. */
export function mentionOn(item: { fields: Record<string, unknown> }, email: string): { id: string; name: string } | null {
  const want = email.trim().toLowerCase();
  for (const f of ["System.AssignedTo", "System.CreatedBy", "System.ChangedBy"]) {
    const v = item.fields[f] as { id?: unknown; uniqueName?: unknown; displayName?: unknown } | undefined;
    if (v && typeof v === "object" && typeof v.id === "string" && /^[0-9a-f-]{36}$/i.test(v.id) && typeof v.uniqueName === "string" && v.uniqueName.trim().toLowerCase() === want)
      return { id: v.id.toLowerCase(), name: typeof v.displayName === "string" && v.displayName.trim() ? v.displayName.trim() : email };
  }
  return null;
}
export type { StateInfo };

/** FB-1: where Send feedback creates stories (the org.feedback Rule, bootstrapped from the app config). */
export type FeedbackWriteTarget = { org: string; project: string; parentId: number };
/** FB-1: Send feedback's setup, for one person. */
export type FeedbackCheck =
  | { state: "ready"; clientKey: string; clientName: string; parentId: number; parentTitle: string; storyType: string }
  | { state: "no_pat"; clientKey: string; clientName: string }
  | { state: "no_access"; clientName: string; project: string }
  | { state: "problem"; reason: string };
/** What a feedback story is: its title, plain-text description and tags. */
export type FeedbackStory = { title: string; description: string; tags: string[] };

const sameName = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

/**
 * FB-1: Send feedback through the write framework. The story is a create under the configured parent, as the person
 * sending it, with their own write PAT for the client whose DevOps the target is (found by the target's org and
 * project among their clients' DevOps settings, else Cooptimize Internal: clientAccounts()'s why "internal"). Preview,
 * confirm (devops.confirm, which checks the PAT again), read back, audit log and undo, like every create; GD-1's scan
 * applies. Nothing here changes any other create.
 */
export function feedbackWrites(ctx: DevOpsWriteContext, clients: () => Promise<{ keys: string[]; internal: string | null }>) {
  type Ready = { env: Env; clientName: string; parent: ItemSnapshot; storyType: string; tz: string };

  async function resolve(cfg: AppConfig, t: FeedbackWriteTarget): Promise<string | null> {
    const c = await clients();
    const keys = [...new Set([...c.keys, ...(c.internal ? [c.internal] : [])])];
    const r = await ctx.targets(cfg, keys).catch(() => null);
    const hits = r?.ok ? r.targets.filter((x) => !x.problem && sameName(x.org, t.org) && (sameName(x.project, t.project) || sameName(x.projectName, t.project))).map((x) => x.clientKey) : [];
    if (c.internal && hits.includes(c.internal)) return c.internal;
    return hits.sort((a, b) => a.localeCompare(b))[0] ?? c.internal;
  }

  async function prepare(t: FeedbackWriteTarget | null): Promise<Ready | Exclude<FeedbackCheck, { state: "ready" }>> {
    const plan = ctx.plan;
    if (!t) return { state: "problem", reason: "No DevOps organization, project and feature are set for feedback" };
    if (!plan || !ctx.writer || !ctx.pats) return { state: "problem", reason: "DevOps writes aren't available here" };
    const cfg = await ctx.config();
    if (!cfg) return { state: "problem", reason: "Fix the config first" };
    const clientKey = await resolve(cfg, t);
    if (!clientKey) return { state: "problem", reason: `None of your clients' DevOps is ${t.project}` };
    // Cooptimize Internal is "Internal" in the app's words, like the assistant's.
    const clientName = clientKey === (await clients()).internal ? "Internal" : (cfg.clientSettings[clientKey]?.name ?? clientKey);
    let env: Env;
    try {
      env = await envFor(ctx, plan, cfg, clientKey);
    } catch (e) {
      if (e instanceof Refused && e.code === "no_write_pat") return { state: "no_pat", clientKey, clientName };
      return { state: "problem", reason: e instanceof Error ? e.message : "The check failed" };
    }
    if (!sameName(env.org, t.org) || !(sameName(env.project, t.project) || sameName(env.projectName, t.project))) return { state: "no_access", clientName, project: t.project };
    try {
      const parent = await env.writer.item(env.org, env.pat, env.project, t.parentId);
      const pc = await env.writer.processConfig(env.org, env.pat, env.project);
      // WT-1: the parent sits at the feature tier of the process, whatever the type is called, and is open.
      if (!portfolioTiers(pc).feature.has(parent.type)) return { state: "problem", reason: `#${parent.id} is a ${parent.type || "work item"}, not at the feature level of this process` };
      const states = await env.writer.states(env.org, env.pat, env.project, parent.type);
      if (!isOpenCategory(states.find((s) => s.name === parent.state)?.category)) return { state: "problem", reason: `#${parent.id} is ${parent.state}; FocusTime adds items only under open parents` };
      const storyType = levelsFromProcessConfig(pc).childrenOf(parent.type)[0] ?? defaultType(pc, "story");
      if (!storyType) return { state: "problem", reason: "The project's process has no story type" };
      return { env, clientName, parent, storyType, tz: userZone(cfg) };
    } catch (e) {
      if (e instanceof WriteFailure && (e.kind === "auth" || e.kind === "forbidden")) return { state: "no_access", clientName, project: t.project };
      if (e instanceof WriteFailure && e.kind === "not_found") return { state: "problem", reason: `Feature #${t.parentId} isn't there, or your DevOps account can't see it` };
      if (e instanceof WriteFailure && e.kind === "network") return { state: "problem", reason: "DevOps didn't answer" };
      return { state: "problem", reason: e instanceof WriteFailure ? e.message : "The check failed" };
    }
  }

  return {
    async check(t: FeedbackWriteTarget | null): Promise<FeedbackCheck> {
      const r = await prepare(t);
      return "env" in r ? { state: "ready", clientKey: r.env.clientKey, clientName: r.clientName, parentId: r.parent.id, parentTitle: r.parent.title, storyType: r.storyType } : r;
    },
    /** The held create's preview (the write framework's own), or why there is none. */
    async preview(t: FeedbackWriteTarget | null, story: FeedbackStory): Promise<{ check: FeedbackCheck; preview: DevOpsPreview | null; refused: string | null }> {
      const r = await prepare(t);
      if (!("env" in r)) return { check: r, preview: null, refused: null };
      const { env, parent, storyType, tz } = r;
      const check: FeedbackCheck = { state: "ready", clientKey: env.clientKey, clientName: r.clientName, parentId: parent.id, parentTitle: parent.title, storyType };
      const area = String(parent.fields["System.AreaPath"] ?? "") || null;
      const iteration = String(parent.fields["System.IterationPath"] ?? "") || null;
      const ops: PatchOp[] = [...createOps({ org: env.org, title: story.title, description: story.description, acField: false, assignedTo: null, areaPath: area, iterationPath: iteration, parentId: parent.id, timeZone: tz }), { op: "add", path: "/fields/System.Tags", value: story.tags.join("; ") }];
      const after: Record<string, string | null> = { Type: storyType, Title: story.title, Description: story.description, Tags: story.tags.join(", "), Area: area ?? "The project's default", Iteration: iteration ?? "The project's default", Parent: `#${parent.id} ${parent.title}` };
      const h: HeldIn = { ...base(env), ...none, op: "create", itemId: null, parentId: parent.id, title: story.title, ops, rev: null, before: {}, after, type: storyType, notes: [`Created as you: DevOps shows ${env.me.name} as who made it.`] };
      try {
        await checkBoundary(ctx, env, h);
      } catch (e) {
        if (e instanceof Refused) return { check, preview: null, refused: e.message };
        throw e;
      }
      return { check, preview: hold(h, env), refused: null };
    },
  };
}
