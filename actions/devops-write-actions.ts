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
import { AC_FIELD, BATCH_LIMIT, REMOVED_COMMENT, START_FIELD, assigneeEmail, assigneeText, assignOps, completedState, createOps, descriptionOps, textToHtml, datesOps, identityMatches, isOpenCategory, removedState, removeOps, row, stateOps, targetDateOps, undoTops, validOrg, VISIBILITY, type DevOpsWriteEntry, type ItemSnapshot, type PatchOp, type StateInfo, type WriteOp } from "../plan/devopswrite.ts";
import { dateOnly, detectTargetField, htmlToText, identityEmail, identityName, workItemUrl } from "../sources/devops/normalize.ts";
import type { TakesStore } from "../store/devops-takes.ts";
import { levelsFromProcessConfig } from "../plan/process.ts";
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
import type { TeamsView } from "../store/teams-store.ts";
import type { ChatMember } from "../plan/chats.ts";
export type { DevOpsPreview, DevOpsResult };

export const DEVOPS_WRITE_ACTIONS = ["devops.set_write_pat", "devops.clear_write_pat", "devops.write_status", "devops.states", "devops.preview", "devops.confirm", "devops.retry", "devops.log"] as const;
export type DevOpsWriteAction = (typeof DEVOPS_WRITE_ACTIONS)[number];

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
  /** PV-1: Take one's notices to the previous assignee (an app table). Absent: no notice is sent. */
  takes?: TakesStore | undefined;
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
type Held = {
  id: string; expiresAt: number; clientKey: string; org: string; project: string; projectName: string; op: WriteOp; itemId: number | null; parentId: number | null; title: string;
  identity: string; ops: PatchOp[] | { text: string } | null; rev: number | null; before: Record<string, string | null>; after: Record<string, string | null>;
  draftId: number | null; followUpId: number | null; undoOf: number | null; commentId: number | null; pickIds: number[]; type: string | null; field: string | null;
  /** The Request a create comes from (stored as "ask" in the write log). */
  ask: { chatId: string; messageId: string } | null;
  /** DS-1: the Draft stories card a create comes from, tied to its write before it is sent. */
  proposal?: { draftId: string; proposalId: string } | null;
  /** CV-1: the conversation, commitment and suggestion it comes from. */
  conv?: DevOpsWriteEntry["conv"];
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
  assign: "Assign a DevOps story to you", undo_assign: "Undo: give the story back to who had it",
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

type Env = { cfg: AppConfig; clientKey: string; org: string; project: string; projectName: string; pat: Pat; me: DevOpsIdentityRow; writer: DevOpsWriter; plan: PlanStore; requests: DevOpsWriteContext["requests"]; conversations: DevOpsWriteContext["conversations"] };

async function run(ctx: DevOpsWriteContext, action: DevOpsWriteAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const tz = userZone(cfg);
  const clientName = (k: string) => cfg.clientSettings[k]?.name ?? k;

  /** The client's org and project (never its company PAT) and my write PAT, checked to belong together. */
  const envOf = async (clientKey: string): Promise<Env> => {
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
    return { cfg, clientKey, org: target.org, project: target.project, projectName: target.projectName ?? target.project, pat, me, writer: ctx.writer, plan, requests: ctx.requests, conversations: ctx.conversations };
  };

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
      return { ok: true, data: { entries: log.map((e) => ({ ...e, undoable: !!e.itemId && tops.get(`${e.org.toLowerCase()}#${e.itemId}`) === e.id && !e.op.startsWith("undo_"), retryable: e.status === "unconfirmed" || e.status === "failed" || e.status === "pending" })) } };
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
      for (const c of list) {
        const h = await previewOne(env, c, tz, memo);
        if (typeof h === "string") nothing.push(h);
        else previews.push(hold(h, env));
      }
      return { ok: true, data: o.changes !== undefined ? { previews, nothing } : previews[0] ? { preview: previews[0] } : { nothing: nothing[0] ?? "Nothing to change" } };
    }
    case "devops.confirm": {
      const o = fields(input, [], ["previewId", "previewIds"]);
      if ((o.previewId === undefined) === (o.previewIds === undefined)) throw new Invalid("devops.confirm takes { previewId } or { previewIds }");
      const ids = o.previewIds !== undefined ? o.previewIds : [o.previewId];
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > BATCH_LIMIT) throw new Invalid(`previewIds needs 1 to ${BATCH_LIMIT} previews`);
      const results: (DevOpsResult | { error: string; status: number })[] = [];
      for (const id of ids) {
        if (typeof id !== "string") throw new Invalid("previewId must be text");
        const h = held.get(id);
        held.delete(id);
        if (!h || h.expiresAt < Date.now()) {
          results.push({ error: "That preview has expired. Review the change again", status: 410 });
          continue;
        }
        try {
          const env = await envOf(h.clientKey);
          // DS-1: a card that already has a write is never sent again (Retry checks that one instead).
          if (h.proposal && (await plan.storyDraftWrites(h.proposal.draftId)).has(h.proposal.proposalId)) {
            results.push({ error: `"${h.title}" was already sent. Retry it; it checks first and won't make a second one`, status: 409 });
            continue;
          }
          const entry = (await plan.logDevopsWrite({ clientKey: h.clientKey, org: h.org, project: h.project, op: h.op, itemId: h.itemId, parentId: h.parentId, title: h.title, identity: env.me.email, before: h.before, after: h.after, ops: h.ops, revBefore: h.rev, revAfter: null, commentId: h.commentId, draftId: h.draftId, pickIds: h.pickIds, followUpId: h.followUpId, undoOf: h.undoOf, ask: h.op === "create" ? h.ask : null, conv: h.conv ?? null }));
          if (h.proposal) await plan.linkStoryDraftWrite(h.proposal.draftId, h.proposal.proposalId, entry.id);
          results.push(await attempt(ctx, env, entry, false, tz));
        } catch (e) {
          if (e instanceof Refused) results.push({ error: e.message, status: e.status });
          else throw e;
        }
      }
      if (o.previewIds !== undefined) return { ok: true, data: { results } };
      const r = results[0]!;
      return "error" in r ? bad(r.error, r.status) : { ok: true, data: r };
    }
    case "devops.retry": {
      const o = fields(input, ["id"]);
      const entry = (await plan.devopsWrite(posId(o.id, "id")));
      if (!entry) throw new PlanError("No such write");
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
  if (h.op === "undo_create" && h.draftId) notes.push("The draft comes back in FocusTime, with its picks.");
  if (h.op === "undo_state" && h.commentId) notes.push("The comment added with that change is deleted too.");
  if (h.followUpId) notes.push("Closes the follow-up once DevOps shows the change.");
  if (h.ask) notes.push(h.op === "undo_create" ? "The request opens again in Inbox › Requests, for everyone on the chat." : "Resolves the request for everyone on the chat once DevOps shows the new item. Nothing is posted in Teams.");
  if (h.conv && h.op === "create") notes.push("Tracks the conversation as the new item for everyone on the chat once DevOps shows it. Nothing is posted in Teams.");
  if (h.op === "undo_create" && h.conv) notes.push("The conversation opens again in Inbox › Conversations.");
  if (h.op === "assign" && assigneeEmail(h.before["Assigned to"])) notes.push(`${(h.before["Assigned to"] ?? "").replace(/\s*<[^>]*>$/, "")} gets a quiet note in FocusTime, if they use it. Undo gives it back.`);
  if (h.op === "description") notes.push("Replaces the whole description with the text above. The old text is kept in the audit log, and Undo puts it back.");
  if (h.rev !== null) notes.push(`Written only if the item is still at revision ${h.rev}; if anyone changed it since, nothing is written.`);
  return {
    previewId: id, expiresAt: new Date(expiresAt).toISOString(), op: h.op, summary: SUMMARY[h.op], system: "DevOps", org: h.org, project: h.projectName,
    item: h.itemId ? `#${h.itemId} ${h.title}` : `New ${h.type ?? "item"}: ${h.title}`, identity: `${env.me.name} <${env.me.email}>`, fields: fieldsRows, links, notes,
    visibility: VISIBILITY(h.projectName), undo: h.undoOf !== null,
  };
}

const base = (env: Env) => ({ clientKey: env.clientKey, org: env.org, project: env.project, projectName: env.projectName, identity: env.me.email });
const none = { draftId: null, followUpId: null, undoOf: null, commentId: null, pickIds: [] as number[], type: null, field: null, parentId: null, ask: null, proposal: null, conv: null };

/** One change → what to hold, or a reason there is nothing to do. Reads the item now (fresh rev). */
async function previewOne(env: Env, c: unknown, tz: string, memo: Map<string, Promise<unknown>> = new Map()): Promise<HeldIn | string> {
  const o = fields(c, ["kind"], ["itemId", "state", "comment", "text", "draftId", "description", "acceptance", "date", "startDate", "writeId", "followUpId", "chatId", "messageId", "level", "storyDraftId", "proposalId", "conversationId", "commitmentId", "suggestionId", "title", "parentId", "includeInternal", "after", "type"]);
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
      if (state === item.state && !comment) return `#${item.id} is already ${state}`;
      return { ...base(env), ...none, op: "state", itemId: item.id, title: item.title, ops: stateOps(item.rev, state, comment), rev: item.rev, before: { State: item.state, ...(comment ? { Comment: null } : {}) }, after: { State: state, ...(comment ? { Comment: comment } : {}) }, followUpId, type: item.type };
    }
    case "comment": {
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      const text = str(o.text, "text", 4000)!;
      return { ...base(env), ...none, op: "comment", itemId: item.id, title: item.title, ops: { text }, rev: null, before: { Comment: null }, after: { Comment: text }, type: item.type };
    }
    case "target_date": {
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      if (identityEmail(item.fields["System.AssignedTo"]) !== env.me.email.toLowerCase()) throw new Refused(`#${item.id} isn't assigned to you, so FocusTime won't set its target date`, 409);
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
    case "assign": {
      // PV-1 (D572): Take one: a teammate's open story (child level in the project's process) assigned to me.
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      const pc = await writer.processConfig(org, pat, project);
      if (!levelsFromProcessConfig(pc).levels.child.includes(item.type)) throw new Refused(`#${item.id} is a ${item.type}: Take one is for stories`, 409);
      const states = await writer.states(org, pat, project, item.type);
      if (!isOpenCategory(states.find((x) => x.name === item.state)?.category)) throw new Refused(`#${item.id} is ${item.state}; FocusTime takes only open stories`, 409);
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
      const childType = draft.level === "story" && typeof o.type === "string" && levelsFromProcessConfig(pc).childrenOf(parent.type).includes(o.type) ? o.type : null;
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
      if (!portfolioTiers(pc).feature.has(parent.type)) throw new Refused(`#${parent.id} is a ${parent.type}: stories are drafted under features`, 409);
      // WT-1: the draft's child type when the parent's type takes it (the next level down), else the default.
      const valid = levelsFromProcessConfig(pc).childrenOf(parent.type);
      const type = draft.storyType && valid.includes(draft.storyType) ? draft.storyType : defaultType(pc, "story");
      if (!type) throw new Refused("This project's process has no story level", 409);
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
      const after: Record<string, string | null> = { Type: type, Title: p.title, Description: description, ...(acField ? { "Acceptance criteria": acceptance } : {}), "Assigned to": `${env.me.name} <${env.me.email}>`, Area: area, Iteration: iteration, Parent: `#${parent.id} ${parent.title}`, "Size in FocusTime": `${sizeChipText(p.size)} (not written to DevOps)` };
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
      if (!internal || include) {
        for (const p of (await cv.view.placesIn([c.id])).filter((x) => x.role === "work")) {
          const m = await shared.teams.message(p.chatId, p.messageId);
          if (!m) continue;
          const sender = m.senderName ?? chat?.members?.find((x: ChatMember) => x.userId && m.senderId && x.userId.toLowerCase() === m.senderId.toLowerCase())?.displayName ?? "Someone";
          const byAt: { name: string | null }[] = [];
          m.mentions.forEach((x, i) => (byAt[x.at ?? i] = { name: x.name }));
          originals.push({ sender, at: m.createdAt, html: sanitizeMessageHtml(m.html ?? m.text, { contentType: m.html ? "html" : "text", mentions: byAt }) });
        }
      }
      const chatName = chat?.displayName ?? "a client chat";
      const description = descriptionHtml(path, originals, { zone: tz, chatName, chatLink: chat ? teamsLink(chat) : messageLink(c.chatId, "0") });
      const typeHas = await writer.typeFields(org, pat, project, t.type);
      const descriptionField = t.level === "bug" && typeHas.has(REPRO_FIELD) ? REPRO_FIELD : "System.Description";
      const area = parent ? String(parent.fields["System.AreaPath"] ?? "") || null : null;
      const iteration = parent ? String(parent.fields["System.IterationPath"] ?? "") || null : null;
      const ops = createOps({ org, title, description, descriptionIsHtml: true, acField: false, assignedTo: env.me.email, areaPath: area, iterationPath: iteration, parentId: parent?.id ?? null, descriptionField, timeZone: tz });
      const tail = originals.length ? `Then the ${originals.length === 1 ? "original message" : `${originals.length} original messages`} from ${chatName}, with who and when, and a link to the chat.` : internal ? `The messages from ${chatName} are left out: it's an internal chat. Only a link to it is added.` : "Then a link to the chat.";
      const after: Record<string, string | null> = { Type: t.type, Title: title, [descriptionField === REPRO_FIELD ? "Repro steps" : "Description"]: `${path}${path ? "\n\n" : ""}${tail}`, "Assigned to": `${env.me.name} <${env.me.email}>`, Area: area ?? "The project's default", Iteration: iteration ?? "The project's default", ...(parent ? { Parent: `#${parent.id} ${parent.title}` } : {}) };
      return { ...base(env), ...none, op: "create", itemId: null, parentId: parent?.id ?? null, title, ops, rev: null, before: {}, after, type: t.type, conv: { conversationId: c.id, commitmentId, suggestionId: null } };
    }
    case "conversation_comment":
    case "description_update": {
      // CV-1: a comment suggested for a linked item's owner, or a description change for a clear scope change.
      const cv = env.conversations;
      const shared = env.requests;
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
    case "undo": {
      const entry = (await plan.devopsWrite(posId(o.writeId, "writeId")));
      if (!entry) throw new PlanError("No such write");
      if (entry.clientKey !== env.clientKey || entry.org.toLowerCase() !== org.toLowerCase()) throw new Refused("That write belongs to another client", 409);
      if (entry.status !== "confirmed" || entry.itemId === null) throw new Refused("Only a confirmed change can be undone", 409);
      if (entry.op.startsWith("undo_")) throw new Refused("An undo isn't undone again: make the change again instead", 409);
      if (entry.undoneBy !== null) throw new Refused("Already undone", 409);
      if (undoTops((await plan.devopsWriteLog(1000))).get(`${entry.org.toLowerCase()}#${entry.itemId}`) !== entry.id) throw new Refused("Undo the newer change to this item first", 409);
      const item = await writer.item(org, pat, project, entry.itemId);
      const u = { ...base(env), ...none, itemId: item.id, title: item.title, undoOf: entry.id, type: item.type, parentId: entry.parentId };
      if (entry.op === "state") {
        if (item.state !== entry.after.State) throw new Refused(`DevOps shows #${item.id} as ${item.state} now, changed after FocusTime's change. Undo would overwrite that; change it in DevOps`, 409, "changed");
        return { ...u, op: "undo_state", ops: stateOps(item.rev, entry.before.State!), rev: item.rev, before: { State: item.state }, after: { State: entry.before.State ?? null }, commentId: entry.commentId };
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
      if (entry.op === "description") {
        const field = fieldOf(entry.ops) ?? "System.Description";
        const curHtml = String(item.fields[field] ?? "");
        if (htmlToText(curHtml).trim() !== htmlToText(entry.after.Description ?? "").trim()) throw new Refused(`DevOps shows another description on #${item.id} now. Undo would overwrite it`, 409, "changed");
        return { ...u, op: "undo_description", ops: descriptionOps(item.rev, field, entry.before.Description ?? ""), rev: item.rev, before: { Description: curHtml }, after: { Description: entry.before.Description ?? null }, field };
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
      return { ...u, op: "undo_create", ops: removeOps(item.rev, removed), rev: item.rev, before: { State: item.state, Comment: null }, after: { State: removed, Comment: REMOVED_COMMENT }, draftId: entry.draftId, pickIds: entry.pickIds, ask: entry.ask ?? null, conv: entry.conv ?? null };
    }
    default:
      throw new Invalid("kind must be state, comment, create, request_create, proposal_create, conversation_create, conversation_comment, description_update, target_date, assign or undo");
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
  // PV-1: an assignee is compared by email.
  if (e.op === "assign" || e.op === "undo_assign") return { "Assigned to": identityEmail(item.fields["System.AssignedTo"]) };
  // CV-1: a description is compared as text (DevOps may tidy the HTML it stores).
  if (e.op === "description" || e.op === "undo_description") return { Description: htmlToText(String(item.fields[fieldOf(e.ops) ?? "System.Description"] ?? "")).trim() };
  return {};
}
/** A logged value as current() reports it. */
const asCurrent = (e: DevOpsWriteEntry, k: string, v: string | null | undefined) => ((e.op === "description" || e.op === "undo_description") && k === "Description" ? htmlToText(v ?? "").trim() : (e.op === "assign" || e.op === "undo_assign") && k === "Assigned to" ? assigneeEmail(v) : v ?? null);
const applied = (e: DevOpsWriteEntry, now: Record<string, string | null>) => Object.keys(now).every((k) => (now[k] ?? null) === asCurrent(e, k, e.after[k]));

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
        const made = await writer.create(org, pat, project, entry.after.Type!, entry.ops as PatchOp[]);
        id = made.id;
        (await plan.settleDevopsWrite(entry.id, { status: "pending", itemId: id }));
      }
      const back = await again(() => writer.item(org, pat, project, id!));
      const ok = back.title === entry.title && (back.parentId ?? null) === entry.parentId && identityEmail(back.fields["System.AssignedTo"]) === env.me.email.toLowerCase();
      if (!ok) return settle("unconfirmed", `DevOps didn't show #${id} as asked yet (title, parent or assignee). Retry checks first and won't create another`, { itemId: id });
      const url = workItemUrl(org, env.projectName, id);
      const pickIds = entry.draftId !== null && (await plan.getDraft(entry.draftId)) && !(await plan.getDraft(entry.draftId))!.devopsId ? (await plan.markDraftCreated(entry.draftId, { itemId: id, url, title: back.title, type: back.type })) : entry.pickIds;
      // The request it came from is resolved as created, for everyone (once; a second confirm finds it resolved already).
      const shared = ctx.requests;
      if (entry.ask && shared) {
        const a = await shared.teams.request(entry.ask.chatId, entry.ask.messageId);
        if (a?.status === "open") await shared.teams.resolveRequest(entry.ask.chatId, entry.ask.messageId, { status: "created", itemId: id, itemUrl: url, itemTitle: back.title, writeId: entry.id });
      }
      if (entry.conv && ctx.conversations) await ctx.conversations.created(entry.conv, { id, url, title: back.title });
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
    const msg = entry.op.startsWith("undo_") ? "Undone in DevOps" : entry.op === "state" ? `#${itemId} is ${entry.after.State} in DevOps` : entry.op === "description" ? "Description changed in DevOps" : entry.op === "assign" ? `#${itemId} is assigned to you in DevOps` : "Target date set in DevOps";
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

const sameText = (html: string, text: string) => html.trim() === text.trim() || htmlToText(html).trim() === text.trim();
export type { StateInfo };
