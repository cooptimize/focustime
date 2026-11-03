// DevOps writes through the write framework (step 14). Same shape as the Outlook side (timebox-actions.ts): a named
// change with narrow inputs, a preview held on the server for five minutes (org, project, item, every field before and
// after, link changes, the identity it writes as, who can see it), a confirm that writes with a JSON Patch test on
// /rev, reads back and only then reports success, an audit log with prior values, Retry that checks before writing
// again, and Undo. Writes use the client's personal write PAT from the keyring, checked against my DevOps identity
// for that client, and go only to that client's org. The company read PAT from Dataverse is never read here: targets
// come from devopsTargets(keys, { withPat: false }). Nothing is ever deleted except a comment FocusTime added (undo).
import { readBack, type Sleep } from "./readback.ts";
import type { AppConfig } from "../config/schema.ts";
import { AC_FIELD, BATCH_LIMIT, REMOVED_COMMENT, START_FIELD, completedState, createOps, datesOps, identityMatches, isOpenCategory, removedState, removeOps, row, stateOps, targetDateOps, undoTops, validOrg, VISIBILITY, type DevOpsWriteEntry, type ItemSnapshot, type PatchOp, type StateInfo, type WriteOp } from "../plan/devopswrite.ts";
import { dateOnly, detectTargetField, htmlToText, identityEmail, portfolioTiers, workItemUrl } from "../sources/devops/normalize.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { DevOpsSource } from "../sources/devops/source.ts";
import type { TargetsResult } from "../sources/devops/types.ts";
import { WriteFailure, type DevOpsWriter } from "../sources/devops/write.ts";
import { PlanError, type DevOpsIdentityRow, type PlanStore } from "../store/plan-store.ts";
import type { ActionResponse, DevOpsPreview, DevOpsResult } from "./types.ts";
export type { DevOpsPreview, DevOpsResult };

export const DEVOPS_WRITE_ACTIONS = ["devops.set_write_pat", "devops.clear_write_pat", "devops.write_status", "devops.states", "devops.preview", "devops.confirm", "devops.retry", "devops.log"] as const;
export type DevOpsWriteAction = (typeof DEVOPS_WRITE_ACTIONS)[number];

/** The keyring for write PATs (secrets/keyring.ts). A PAT only ever comes back wrapped. */
export type WritePats = { get: (clientKey: string) => Promise<Pat>; set: (clientKey: string, value: string) => Promise<void>; clear: (clientKey: string) => Promise<void> };
export type DevOpsWriteContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  /** Dataverse DevOps settings without the company PAT (withPat: false). */
  targets: (cfg: AppConfig, clientKeys: string[]) => Promise<TargetsResult>;
  /** Waits before a second read-back (D255); tests pass an instant one. */
  sleep?: Sleep;
  writer: DevOpsWriter | null;
  pats: WritePats | null;
  devops: ((cfg: AppConfig) => DevOpsSource) | null;
  now: () => string;
};

export const PREVIEW_MS = 5 * 60_000;
type Held = {
  id: string; expiresAt: number; clientKey: string; org: string; project: string; projectName: string; op: WriteOp; itemId: number | null; parentId: number | null; title: string;
  identity: string; ops: PatchOp[] | { text: string } | null; rev: number | null; before: Record<string, string | null>; after: Record<string, string | null>;
  draftId: number | null; followUpId: number | null; undoOf: number | null; commentId: number | null; pickIds: number[]; type: string | null; field: string | null;
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

type Env = { cfg: AppConfig; clientKey: string; org: string; project: string; projectName: string; pat: Pat; me: DevOpsIdentityRow; writer: DevOpsWriter; plan: PlanStore };

async function run(ctx: DevOpsWriteContext, action: DevOpsWriteAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const tz = cfg.week.hours.timeZone;
  const clientName = (k: string) => cfg.clientSettings[k]?.name ?? k;

  /** The client's org and project (never its company PAT) and my write PAT, checked to belong together. */
  const envOf = async (clientKey: string): Promise<Env> => {
    if (!ctx.writer || !ctx.pats) throw new Refused("DevOps writes aren't available here", 503);
    const me = plan.devopsIdentity(clientKey);
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
    return { cfg, clientKey, org: target.org, project: target.project, projectName: target.projectName ?? target.project, pat, me, writer: ctx.writer, plan };
  };

  switch (action) {
    case "devops.set_write_pat": {
      const o = fields(input, ["clientKey"], ["pat", "expires"]);
      const clientKey = str(o.clientKey, "clientKey", 100)!;
      const expires = o.expires === undefined || o.expires === null || o.expires === "" ? null : isoDate(o.expires, "expires");
      if (o.pat === undefined) {
        // Only the expiry changes.
        const cur = plan.devopsIdentity(clientKey);
        if (!cur) throw new Refused("Enter the PAT first", 409);
        return { ok: true, data: { write: writeView(plan.setDevopsIdentity({ ...cur, expires })) } };
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
      return { ok: true, data: { write: writeView(plan.setDevopsIdentity({ clientKey, org: target.org, id: who.id, name: who.name, email: who.email, expires })) } };
    }
    case "devops.clear_write_pat": {
      const o = fields(input, ["clientKey"]);
      const clientKey = str(o.clientKey, "clientKey", 100)!;
      if (ctx.pats) await ctx.pats.clear(clientKey).catch(() => undefined);
      plan.clearDevopsIdentity(clientKey);
      return { ok: true, data: { write: null } };
    }
    case "devops.write_status": {
      fields(input ?? {}, []);
      return { ok: true, data: { clients: plan.devopsIdentities().map(writeView) } };
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
      const log = plan.devopsWriteLog(200);
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
      for (const c of list) {
        const h = await previewOne(env, c, tz);
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
          const entry = plan.logDevopsWrite({ clientKey: h.clientKey, org: h.org, project: h.project, op: h.op, itemId: h.itemId, parentId: h.parentId, title: h.title, identity: env.me.email, before: h.before, after: h.after, ops: h.ops, revBefore: h.rev, revAfter: null, commentId: h.commentId, draftId: h.draftId, pickIds: h.pickIds, followUpId: h.followUpId, undoOf: h.undoOf });
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
      const entry = plan.devopsWrite(posId(o.id, "id"));
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
  const fieldsRows = labels.map((l) => row(l, h.op === "create" ? null : h.before[l] ?? null, h.after[l] ?? null));
  const links = h.op === "create" && h.parentId ? [`Adds a parent link to #${h.parentId}, which shows the new item as its child`] : h.op === "undo_create" ? ["The parent link stays; the item shows as Removed under it"] : [];
  const notes: string[] = [];
  if (h.op === "undo_create" && h.draftId) notes.push("The draft comes back in FocusTime, with its picks.");
  if (h.op === "undo_state" && h.commentId) notes.push("The comment added with that change is deleted too.");
  if (h.followUpId) notes.push("Closes the follow-up once DevOps shows the change.");
  if (h.rev !== null) notes.push(`Written only if the item is still at revision ${h.rev}; if anyone changed it since, nothing is written.`);
  return {
    previewId: id, expiresAt: new Date(expiresAt).toISOString(), op: h.op, summary: SUMMARY[h.op], system: "DevOps", org: h.org, project: h.projectName,
    item: h.itemId ? `#${h.itemId} ${h.title}` : `New ${h.type ?? "item"}: ${h.title}`, identity: `${env.me.name} <${env.me.email}>`, fields: fieldsRows, links, notes,
    visibility: VISIBILITY(h.projectName), undo: h.undoOf !== null,
  };
}

const base = (env: Env) => ({ clientKey: env.clientKey, org: env.org, project: env.project, projectName: env.projectName, identity: env.me.email });
const none = { draftId: null, followUpId: null, undoOf: null, commentId: null, pickIds: [] as number[], type: null, field: null, parentId: null };

/** One change → what to hold, or a reason there is nothing to do. Reads the item now (fresh rev). */
async function previewOne(env: Env, c: unknown, tz: string): Promise<HeldIn | string> {
  const o = fields(c, ["kind"], ["itemId", "state", "comment", "text", "draftId", "description", "acceptance", "date", "startDate", "writeId", "followUpId"]);
  const { writer, org, pat, project, plan } = env;
  switch (o.kind) {
    case "state": {
      const item = await writer.item(org, pat, project, posId(o.itemId, "itemId"));
      const states = await writer.states(org, pat, project, item.type);
      const state = str(o.state, "state", 100)!;
      if (!states.some((s) => s.name === state)) throw new Invalid(`${state} isn't a state of ${item.type}`);
      const comment = str(o.comment, "comment", 4000, true);
      const followUpId = o.followUpId === undefined || o.followUpId === null ? null : posId(o.followUpId, "followUpId");
      if (followUpId !== null && !plan.getFollowUp(followUpId)) throw new PlanError("No such follow-up");
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
    case "create": {
      const draft = plan.getDraft(posId(o.draftId, "draftId"));
      if (!draft) throw new PlanError("No such draft");
      if (draft.devopsId) return `"${draft.title}" is already in DevOps as #${draft.devopsId}`;
      if (draft.clientKey !== env.clientKey) throw new Refused("That draft belongs to another client", 409);
      if (draft.parentItemId === null) throw new Refused(`"${draft.title}" has no ${draft.level === "feature" ? "epic" : "feature"} yet. Put it under one first: DevOps first, and area and iteration come from the parent`, 409);
      const parent = await writer.item(org, pat, project, draft.parentItemId);
      const pc = await writer.processConfig(org, pat, project);
      const tiers = portfolioTiers(pc);
      const type = draft.level === "feature" ? defaultType(pc, "feature") : defaultType(pc, "story");
      if (!type) throw new Refused(`This project's process has no ${draft.level === "feature" ? "feature" : "story"} level`, 409);
      const wantParent = draft.level === "feature" ? tiers.epic : tiers.feature;
      if (!wantParent.has(parent.type)) throw new Refused(`#${parent.id} is a ${parent.type}: a ${draft.level === "feature" ? "feature goes under an epic" : "story goes under a feature"}`, 409);
      const parentStates = await writer.states(org, pat, project, parent.type);
      const pcat = parentStates.find((s) => s.name === parent.state)?.category ?? "InProgress";
      if (!isOpenCategory(pcat)) throw new Refused(`#${parent.id} is ${parent.state}; FocusTime adds items only under open parents`, 409);
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
    case "undo": {
      const entry = plan.devopsWrite(posId(o.writeId, "writeId"));
      if (!entry) throw new PlanError("No such write");
      if (entry.clientKey !== env.clientKey || entry.org.toLowerCase() !== org.toLowerCase()) throw new Refused("That write belongs to another client", 409);
      if (entry.status !== "confirmed" || entry.itemId === null) throw new Refused("Only a confirmed change can be undone", 409);
      if (entry.op.startsWith("undo_")) throw new Refused("An undo isn't undone again: make the change again instead", 409);
      if (entry.undoneBy !== null) throw new Refused("Already undone", 409);
      if (undoTops(plan.devopsWriteLog(1000)).get(`${entry.org.toLowerCase()}#${entry.itemId}`) !== entry.id) throw new Refused("Undo the newer change to this item first", 409);
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
      return { ...u, op: "undo_create", ops: removeOps(item.rev, removed), rev: item.rev, before: { State: item.state, Comment: null }, after: { State: removed, Comment: REMOVED_COMMENT }, draftId: entry.draftId, pickIds: entry.pickIds };
    }
    default:
      throw new Invalid("kind must be state, comment, create, target_date or undo");
  }
}

const fieldOf = (ops: DevOpsWriteEntry["ops"]) => (Array.isArray(ops) ? ops.find((p) => p.op !== "test")?.path.replace(/^\/fields\//, "") ?? null : null);
/** The default work item type of the story level (requirement backlog) or the feature tier (lowest portfolio backlog). */
function defaultType(pc: unknown, level: "story" | "feature"): string | null {
  type Cat = { defaultWorkItemType?: { name?: unknown }; workItemTypes?: { name?: unknown }[] };
  const c = pc as { requirementBacklog?: Cat; portfolioBacklogs?: Cat[] } | null;
  const cat = level === "story" ? c?.requirementBacklog : (Array.isArray(c?.portfolioBacklogs) ? c.portfolioBacklogs : []).filter((b) => (b.workItemTypes ?? []).length > 0).at(-1);
  const n = cat?.defaultWorkItemType?.name ?? cat?.workItemTypes?.[0]?.name;
  return typeof n === "string" ? n : null;
}

/** What DevOps shows now for the fields a write is about, keyed like the entry. */
function current(e: DevOpsWriteEntry, item: ItemSnapshot, tz: string): Record<string, string | null> {
  if (e.op === "state" || e.op === "undo_state" || e.op === "undo_create") return { State: item.state };
  if (e.op === "target_date" || e.op === "undo_target_date") {
    const f = fieldOf(e.ops);
    return { ...("Start date" in e.after ? { "Start date": dateOnly(item.fields[START_FIELD], tz) } : {}), "Target date": f ? dateOnly(item.fields[f], tz) : null };
  }
  return {};
}
const applied = (e: DevOpsWriteEntry, now: Record<string, string | null>) => Object.keys(now).every((k) => (now[k] ?? null) === (e.after[k] ?? null));

/**
 * One attempt at a logged write, safe to repeat: a retry first checks whether the change is already there (an update
 * already applied, a comment already posted, a created item already under its parent) and adopts it rather than
 * writing twice. Success only after reading it back.
 */
async function attempt(ctx: DevOpsWriteContext, env: Env, entry: DevOpsWriteEntry, retry: boolean, tz: string): Promise<DevOpsResult> {
  const { writer, org, pat, project, plan } = env;
  const settle = (status: DevOpsWriteEntry["status"], message: string, more: { itemId?: number | null; revAfter?: number | null; commentId?: number | null; pickIds?: number[] } = {}, extra: Partial<DevOpsResult> = {}): DevOpsResult => {
    const e = plan.settleDevopsWrite(entry.id, { status, message, retry, ...more });
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
      plan.settleDevopsWrite(entry.id, { status: "pending", commentId: made.id });
      const back = await again(() => writer.getComment(org, pat, project, entry.itemId!, made.id));
      if (back.isDeleted || !sameText(back.text, text)) return settle("unconfirmed", "DevOps didn't show the comment yet. Retry checks first and won't post it twice", { commentId: made.id });
      forget();
      return settle("confirmed", posted ? "Already in DevOps (found on retry)" : "Comment added in DevOps", { commentId: made.id });
    }
    if (entry.op === "undo_comment") {
      const before = await writer.getComment(org, pat, project, entry.itemId!, entry.commentId!);
      if (!before.isDeleted) await writer.deleteComment(org, pat, project, entry.itemId!, entry.commentId!);
      const back = await again(() => writer.getComment(org, pat, project, entry.itemId!, entry.commentId!));
      if (!back.isDeleted) return settle("unconfirmed", "DevOps still shows the comment. Retry to delete it again");
      plan.markDevopsUndone(entry.undoOf!, entry.id);
      forget();
      return settle("confirmed", "Comment deleted in DevOps");
    }
    if (entry.op === "create") {
      let id = entry.itemId;
      if (retry && id === null) {
        // Was it created before the answer got lost? Look under the parent for it, made by me since the attempt.
        const since = Temporal.Instant.from(entry.at).toZonedDateTimeISO("UTC").toPlainDate().subtract({ days: 1 }).toString();
        const q = `SELECT [System.Id] FROM WorkItems WHERE [System.Parent] = ${entry.parentId} AND [System.Title] = '${entry.title.replace(/'/g, "''")}' AND [System.CreatedBy] = @Me AND [System.CreatedDate] >= '${since}'`;
        const found = await writer.wiql(org, pat, project, q);
        if (found.length > 1) return settle("refused", `DevOps already has ${found.length} items with this title under #${entry.parentId}. Check DevOps; FocusTime won't make another`);
        id = found[0] ?? null;
      }
      if (id === null) {
        const made = await writer.create(org, pat, project, entry.after.Type!, entry.ops as PatchOp[]);
        id = made.id;
        plan.settleDevopsWrite(entry.id, { status: "pending", itemId: id });
      }
      const back = await again(() => writer.item(org, pat, project, id!));
      const ok = back.title === entry.title && back.parentId === entry.parentId && identityEmail(back.fields["System.AssignedTo"]) === env.me.email.toLowerCase();
      if (!ok) return settle("unconfirmed", `DevOps didn't show #${id} as asked yet (title, parent or assignee). Retry checks first and won't create another`, { itemId: id });
      const url = workItemUrl(org, env.projectName, id);
      const pickIds = entry.draftId !== null && plan.getDraft(entry.draftId) && !plan.getDraft(entry.draftId)!.devopsId ? plan.markDraftCreated(entry.draftId, { itemId: id, url, title: back.title, type: back.type }) : entry.pickIds;
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
      if (entry.op === "state") plan.settleDevopsWrite(entry.id, { status: "pending", commentId: wrote.commentId });
    }
    const back = await again(() => writer.item(org, pat, project, itemId));
    if (!applied(entry, current(entry, back, tz))) return settle("unconfirmed", "DevOps didn't show the change yet. Retry checks first and won't write twice", { revAfter: back.rev });
    if (entry.op === "undo_state" && entry.commentId !== null) {
      // The comment that came with the original change goes too.
      const cm = await writer.getComment(org, pat, project, itemId, entry.commentId).catch(() => null);
      if (cm && !cm.isDeleted) await writer.deleteComment(org, pat, project, itemId, entry.commentId);
    }
    if (entry.undoOf !== null) plan.markDevopsUndone(entry.undoOf, entry.id);
    if (entry.op === "undo_create" && entry.draftId !== null) plan.restoreDraft(entry.draftId, entry.pickIds);
    if (entry.op === "state" && entry.followUpId !== null) {
      const f = plan.getFollowUp(entry.followUpId);
      if (f && !f.closedAt) plan.closeFollowUp(entry.followUpId, `Marked ${entry.after.State} in DevOps`, "me", { how: "devops", outcome: "done" });
    }
    forget();
    const msg = entry.op.startsWith("undo_") ? "Undone in DevOps" : entry.op === "state" ? `#${itemId} is ${entry.after.State} in DevOps` : "Target date set in DevOps";
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

  function conflict(e: DevOpsWriteEntry, now: ItemSnapshot): DevOpsResult {
    const changed = Object.entries(current(e, now, tz)).filter(([k, v]) => (e.before[k] ?? null) !== v).map(([k, v]) => ({ field: k, was: e.before[k] ?? null, now: v }));
    const what = changed.length ? changed.map((c) => `${c.field} is ${c.now ?? "empty"} (was ${c.was ?? "empty"})`).join("; ") : `it is at revision ${now.rev} now (was ${e.revBefore})`;
    return settle("refused", `Changed in DevOps since you loaded it: ${what}. Nothing was written. Reload to review it again`, {}, { changed });
  }
}

const sameText = (html: string, text: string) => html.trim() === text.trim() || htmlToText(html).trim() === text.trim();
export type { StateInfo };
