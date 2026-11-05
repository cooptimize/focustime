// DS-1: Draft stories with AI, text signals only. Prepare reads the feature (its fields, epic, children and comments)
// and the client's examples, read only with the company read PAT; Run sends one "stories.draft" request through ai/
// (Use AI and that client's Allow AI, the guards, the budget) and keeps the answer as reviewable cards only when it
// fits the Coop v1 schema and its checks; Review edits, drops, reorders and regenerates cards; Publish previews the
// exact batch and creates each kept card under the feature through the write framework (devops-write-actions.ts:
// preview, confirm, read back, audit log, undo) with the person's write PAT. A proposal is tied to its write before
// the create, so a retry checks first and never makes a second item. Nothing reaches DevOps before Publish is
// confirmed, and no write PAT means nothing is sent at all.
import type { AiAppSettings, AiService } from "../ai/service.ts";
import { fmtUsd } from "../ai/cost.ts";
import { validate } from "../ai/schema.ts";
import type { AppConfig } from "../config/schema.ts";
import { sizeChipText, validStorySize } from "../plan/estimate.ts";
import {
  COOP_PROPOSALS_V1, draftInput, publishOrder, DRAFT_INSTRUCTIONS, editProblem, estimateMicros, exemplarView, houseStyle, houseStyleStale, HOUSE_STYLE_MAX, MAX_PROPOSALS, NOTE_MAX, proposalProblems, rankExemplars, styleText, toProposal, trimComments,
  EXEMPLAR_MAX, type CoopProposals, type ExemplarCandidate, type FeatureSignals, type HouseStyle, type Proposal, type StoryDraft,
} from "../plan/stories.ts";
import type { DevOpsWriteEntry } from "../plan/devopswrite.ts";
import type { DevOpsSource } from "../sources/devops/source.ts";
import type { PlanStore } from "../store/plan-store.ts";
import type { ActionResponse } from "./types.ts";

export const STORY_ACTIONS = ["stories.status", "stories.prepare", "stories.run", "stories.regenerate", "stories.save", "stories.publish_preview", "stories.publish", "stories.retry", "stories.house_style", "stories.house_style_save"] as const;
export type StoryAction = (typeof STORY_ACTIONS)[number];

/** The task name the AI log keeps (never the input or the answer). */
export const DRAFT_TASK = "stories.draft";
/** Look back this many months for examples unless the person's [ai] draft_months says otherwise. */
export const DEFAULT_DRAFT_MONTHS = 12;

export type StoryContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  /** The read-only DevOps source (the company read PAT, from Dataverse at fetch time). */
  devops: (cfg: AppConfig) => DevOpsSource;
  ai: () => Promise<AiService | null>;
  /** The app's AI settings, for the cost estimate (null: AI isn't wired here). */
  aiApp: AiAppSettings | null;
  /** The clients I have a checked write PAT for (devops identities). */
  writeClients: () => Promise<string[]>;
  /** The write framework's own actions (devops.preview, devops.confirm, devops.retry, devops.log). */
  devopsWrite: (action: "devops.preview" | "devops.confirm" | "devops.retry" | "devops.log", input: unknown) => Promise<ActionResponse>;
  now: () => string;
};

class Invalid extends Error {}
class Refused extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status = 409, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });

type Obj = Record<string, unknown>;
function fields(input: unknown, required: string[], optional: string[] = []): Obj {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Invalid("input must be an object");
  const o = input as Obj;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) throw new Invalid(`unknown input field ${k}`);
  for (const k of required) if (o[k] === undefined) throw new Invalid(`${k} is required`);
  return o;
}
const text = (v: unknown, name: string, max: number, empty = false): string => {
  if (v === undefined || v === null) {
    if (empty) return "";
    throw new Invalid(`${name} is required`);
  }
  if (typeof v !== "string") throw new Invalid(`${name} must be text`);
  if (!empty && !v.trim()) throw new Invalid(`${name} must be text`);
  if (v.length > max) throw new Invalid(`${name} is at most ${max} characters`);
  return v;
};
const posId = (v: unknown, name: string) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
};

export async function storyAction(ctx: StoryContext, action: StoryAction, input: unknown): Promise<ActionResponse> {
  try {
    return await run(ctx, action, input);
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof Refused) return bad(e.message, e.status, e.code);
    throw e;
  }
}

/** Where AI stands for a client: on, off (Use AI), not allowed for it, not set up, or not here at all. */
type AiState = "on" | "off" | "client_off" | "not_set_up";
async function aiState(ctx: StoryContext, cfg: AppConfig, clientKey: string | null): Promise<AiState> {
  const ai = await ctx.ai();
  if (!ai) return "not_set_up";
  const st = await ai.status();
  if (!st.setUp) return "not_set_up";
  if (!cfg.ai.use) return "off";
  if (clientKey && !cfg.ai.allowedClients.includes(clientKey)) return "client_off";
  return "on";
}

const AI_WORDS: Record<Exclude<AiState, "on">, (client: string) => string> = {
  off: () => "AI is off. Turn on Use AI in Settings › AI.",
  client_off: (c) => `AI is off for ${c}. Turn on Allow AI for ${c} in Settings › Clients.`,
  not_set_up: () => "AI isn't set up for this FocusTime yet. The Coop brief still works.",
};
const NO_PAT = (c: string) => `Add DevOps write access for ${c} in Settings`;

/** A card with where it stands in DevOps (from its write in the audit log). */
export type CardStatus = { state: "not_sent" } | { state: "created"; itemId: number; url: string | null } | { state: "pending" | "unconfirmed" | "failed" | "refused" | "undone"; message: string; writeId: number };
export type DraftView = Omit<StoryDraft, "costMicros"> & { cost: string; cards: (Proposal & { status: CardStatus; after: string[]; sizeText: string })[]; published: number; left: number };

async function run(ctx: StoryContext, action: StoryAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The plan store isn't available", 503);
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  const nameOf = (k: string) => cfg.clientSettings[k]?.name ?? k;
  const months = cfg.ai.draftMonths ?? DEFAULT_DRAFT_MONTHS;
  const src = () => ctx.devops(cfg);

  /** The draft's cards with each one's status from the audit log. */
  const view = async (d: StoryDraft): Promise<DraftView> => {
    const writes = await plan.storyDraftWrites(d.id);
    const log = writes.size ? ((await ctx.devopsWrite("devops.log", {})) as { ok: true; data: { entries: DevOpsWriteEntry[] } } | { ok: false }) : null;
    const entries = log && log.ok ? log.data.entries : [];
    const statusOf = (p: Proposal): CardStatus => {
      const w = writes.get(p.id);
      if (w === undefined) return { state: "not_sent" };
      const e = entries.find((x) => x.id === w);
      if (!e) return { state: "pending", message: "Its write isn't in the audit log yet", writeId: w };
      if (e.status === "confirmed" && e.undoneBy !== null) return { state: "undone", message: `#${e.itemId} was set to Removed (undone)`, writeId: w };
      if (e.status === "confirmed" && e.itemId) return { state: "created", itemId: e.itemId, url: workUrl(e) };
      return { state: e.status === "confirmed" ? "pending" : e.status, message: e.message ?? "Not confirmed yet", writeId: w };
    };
    const cards = d.proposals.map((p) => ({ ...p, status: statusOf(p), after: p.dependsOn.filter((x) => d.proposals.some((q) => q.id === x && q.keep)).map((x) => d.proposals.find((q) => q.id === x)!.title), sizeText: sizeChipText(p.size) }));
    const published = cards.filter((c) => c.status.state === "created").length;
    const left = cards.filter((c) => c.keep && c.status.state !== "created").length;
    const { costMicros, ...rest } = d;
    return { ...rest, cost: fmtUsd(costMicros), cards, published, left };
  };

  /** The house style for a client: the person's edit, else the computed one (computed again after a week). */
  const styleFor = async (clientKey: string, pool: readonly ExemplarCandidate[] | null): Promise<HouseStyle | null> => {
    const cur = await plan.houseStyle(clientKey);
    if (pool && (!cur?.computedAt || houseStyleStale(cur.computedAt, ctx.now()))) {
      const h = houseStyle(pool);
      return plan.setComputedHouseStyle(clientKey, h.text, h.learned);
    }
    return cur;
  };

  const signalsOf = async (clientKey: string, featureId: number): Promise<FeatureSignals> => {
    const r = await src().featureSignals(clientKey, featureId);
    if (!r.ok) throw new Refused(r.message, 503);
    return r.value;
  };
  const poolOf = async (clientKey: string): Promise<ExemplarCandidate[] | null> => {
    const r = await src().exemplarPool(clientKey, { months });
    return r.ok ? r.value : null;
  };
  const owned = async (draftId: unknown): Promise<StoryDraft> => {
    const d = await plan.storyDraft(text(draftId, "draftId", 64));
    if (!d) throw new Refused("That draft isn't there any more. Run Draft stories again", 404);
    return d;
  };

  /** One AI request for the set (or one card), its answer checked; the cards, or a plain error. */
  const ask = async (signals: FeatureSignals, clientKey: string, exemplars: ExemplarCandidate[], style: string, note: string, one: { keep: Proposal[]; replace: Proposal } | null) => {
    const ai = await ctx.ai();
    const st = await aiState(ctx, cfg, clientKey);
    if (!ai || st !== "on") throw new Refused(AI_WORDS[st === "on" ? "not_set_up" : st](nameOf(clientKey)), 409, "ai_off");
    const payload = draftInput({ signals, exemplars: exemplars.map(exemplarView), style, note, ...(one ? { keep: one.keep, replace: one.replace } : {}) });
    const r = await ai.run<CoopProposals>({ name: DRAFT_TASK, client: clientKey, instructions: DRAFT_INSTRUCTIONS }, payload, COOP_PROPOSALS_V1);
    if (!r.ok) throw new Refused(r.error.kind === "invalid_output" ? "The AI's answer wasn't usable, so nothing is shown. Try again" : r.error.message, r.error.kind === "invalid_output" ? 422 : 409, r.error.kind);
    // Beyond the schema: the feature, unique ids, real dependencies, existing children. Any problem: nothing shown.
    const childIds = signals.children.map((c) => c.id);
    const answer = one ? { ...r.value, proposals: [...one.keep.map((k) => ({ id: k.id, title: k.title, description: k.description, acceptance_criteria: k.acceptance, depends_on: k.dependsOn, size: k.size, evidence: k.evidence, open_questions: k.questions })), ...r.value.proposals] } : r.value;
    const problems = validate(r.value, COOP_PROPOSALS_V1).length ? ["schema"] : proposalProblems(answer, { featureId: signals.feature.id, childIds });
    if (one && (r.value.proposals.length !== 1 || r.value.proposals[0]!.id !== one.replace.id)) problems.push("$.proposals: not exactly the one card asked for");
    if (problems.length) throw new Refused("The AI's answer wasn't usable, so nothing is shown. Try again", 422, "invalid_output");
    return { value: r.value, costMicros: Math.round(r.costUsd * 1_000_000) };
  };

  switch (action) {
    case "stories.status": {
      // What the Needs stories rows need for their button: AI per client, and write access per client.
      fields(input ?? {}, []);
      const ai = await ctx.ai();
      const st = ai ? await ai.status() : null;
      return { ok: true, data: { setUp: !!st?.setUp, use: cfg.ai.use, allowed: cfg.ai.allowedClients, write: await ctx.writeClients() } };
    }
    case "stories.prepare": {
      const o = fields(input, ["clientKey", "featureId"]);
      const clientKey = text(o.clientKey, "clientKey", 100);
      const featureId = posId(o.featureId, "featureId");
      const st = await aiState(ctx, cfg, clientKey);
      const write = (await ctx.writeClients()).includes(clientKey);
      const signals = await signalsOf(clientKey, featureId);
      const pool = await poolOf(clientKey);
      const ranked = pool ? rankExemplars(signals.feature, pool, EXEMPLAR_MAX * 2) : [];
      const style = await styleFor(clientKey, pool);
      const c = trimComments(signals.comments);
      const payload = draftInput({ signals, exemplars: ranked.slice(0, EXEMPLAR_MAX).map(exemplarView), style: styleText(style), note: "" });
      const latest = await plan.latestStoryDraft(clientKey, featureId);
      return {
        ok: true,
        data: {
          clientKey, clientName: nameOf(clientKey), featureId, featureTitle: signals.feature.title, featureType: signals.feature.type, storyType: signals.storyType, childTypes: signals.childTypes ?? [signals.storyType], url: signals.feature.url,
          signals: {
            fields: [
              ["Title", signals.feature.title], ["State", signals.feature.state], ["Priority", signals.feature.priority === null ? "" : String(signals.feature.priority)], ["Tags", signals.feature.tags.join(", ")],
              ["Area", signals.feature.areaPath], ["Iteration", signals.feature.iterationPath], ["Description", signals.feature.description ? `${signals.feature.description.length} characters` : ""], ["Acceptance criteria", signals.feature.acceptance ? `${signals.feature.acceptance.length} characters` : ""],
            ].filter(([, v]) => v),
            epic: signals.epic ? { id: signals.epic.id, title: signals.epic.title } : null,
            children: signals.children,
            comments: { total: signals.comments.length, sent: c.kept.length, left: c.left, coopBlocks: c.coopBlocks },
          },
          // The first five go; the next five can swap in. All from this client's project.
          exemplars: ranked.map((e, i) => ({ id: e.id, title: e.title, summary: exemplarView(e).summary, stories: e.stories.length, chosen: i < EXEMPLAR_MAX })),
          poolRead: pool !== null,
          style: { text: styleText(style), learned: !!style?.learned, edited: !!style?.edited },
          estimate: ctx.aiApp ? fmtUsd(estimateMicros(payload, ctx.aiApp.prices)) : null,
          model: ctx.aiApp?.model ?? null,
          ai: st, aiMessage: st === "on" ? null : AI_WORDS[st](nameOf(clientKey)),
          write, writeMessage: write ? null : NO_PAT(nameOf(clientKey)),
          latest: latest ? await view(latest) : null,
        },
      };
    }
    case "stories.run": {
      const o = fields(input, ["clientKey", "featureId"], ["note", "exemplarIds", "storyType"]);
      const clientKey = text(o.clientKey, "clientKey", 100);
      const featureId = posId(o.featureId, "featureId");
      const note = text(o.note, "note", NOTE_MAX, true);
      if (o.exemplarIds !== undefined && (!Array.isArray(o.exemplarIds) || o.exemplarIds.length > EXEMPLAR_MAX || o.exemplarIds.some((x) => typeof x !== "number" || !Number.isSafeInteger(x)))) throw new Invalid(`exemplarIds is a list of at most ${EXEMPLAR_MAX} item ids`);
      // No write PAT: nothing is sent anywhere (a draft that can't be published isn't worth the request).
      if (!(await ctx.writeClients()).includes(clientKey)) throw new Refused(NO_PAT(nameOf(clientKey)), 409, "no_write_pat");
      const read = await signalsOf(clientKey, featureId);
      // WT-1: the child type the person chose, one of the types this feature's type takes; else the most common.
      const chosen = o.storyType === undefined ? null : text(o.storyType, "storyType", 100);
      if (chosen && !(read.childTypes ?? [read.storyType]).includes(chosen)) throw new Invalid(`${chosen} isn't a type that goes under #${featureId} in this project`);
      const signals = chosen ? { ...read, storyType: chosen } : read;
      const pool = (await poolOf(clientKey)) ?? [];
      // The examples the person kept (only ones from this client's own pool; anything else is ignored), else the ranking's.
      const wanted = o.exemplarIds as number[] | undefined;
      const exemplars = wanted ? wanted.map((id) => pool.find((c) => c.id === id && c.id !== featureId)).filter((c): c is ExemplarCandidate => !!c) : rankExemplars(signals.feature, pool);
      const style = styleText(await styleFor(clientKey, pool.length ? pool : null));
      const { value, costMicros } = await ask(signals, clientKey, exemplars, style, note, null);
      const d = await plan.addStoryDraft(clientKey, featureId, { featureTitle: signals.feature.title, storyType: signals.storyType, note, exemplarIds: exemplars.map((e) => e.id), proposals: value.proposals.map(toProposal), rationale: value.rationale, setAside: value.set_aside, costMicros });
      return { ok: true, data: await view(d) };
    }
    case "stories.regenerate": {
      // The whole set with a note (only before anything is published from it), or one card (not yet sent).
      const o = fields(input, ["draftId"], ["proposalId", "note"]);
      const d = await owned(o.draftId);
      const note = text(o.note, "note", NOTE_MAX, true);
      if (!(await ctx.writeClients()).includes(d.clientKey)) throw new Refused(NO_PAT(nameOf(d.clientKey)), 409, "no_write_pat");
      const writes = await plan.storyDraftWrites(d.id);
      const fresh = await signalsOf(d.clientKey, d.featureId);
      // WT-1: the draft keeps the child type it was made with.
      const signals = (fresh.childTypes ?? [fresh.storyType]).includes(d.storyType) ? { ...fresh, storyType: d.storyType } : fresh;
      const pool = (await poolOf(d.clientKey)) ?? [];
      const exemplars = d.exemplarIds.map((id) => pool.find((c) => c.id === id)).filter((c): c is ExemplarCandidate => !!c);
      const style = styleText(await plan.houseStyle(d.clientKey));
      if (o.proposalId !== undefined) {
        const pid = text(o.proposalId, "proposalId", 16);
        const target = d.proposals.find((p) => p.id === pid);
        if (!target) throw new Refused("That card isn't in this draft", 404);
        if (writes.has(pid)) throw new Refused("That story was already sent to DevOps", 409);
        const keep = d.proposals.filter((p) => p.id !== pid && p.keep);
        const { value, costMicros } = await ask(signals, d.clientKey, exemplars, style, note || d.note, { keep, replace: target });
        const fresh = { ...toProposal(value.proposals[0]!), keep: true };
        const saved = await plan.saveStoryDraft(d.id, { ...d, proposals: d.proposals.map((p) => (p.id === pid ? fresh : p)), costMicros: d.costMicros + costMicros });
        return { ok: true, data: await view(saved) };
      }
      if (writes.size) throw new Refused("Some of these stories are in DevOps already, so the set can't be drafted again. Regenerate one card instead", 409);
      const { value, costMicros } = await ask(signals, d.clientKey, exemplars, style, note || d.note, null);
      const saved = await plan.saveStoryDraft(d.id, { ...d, note: note || d.note, proposals: value.proposals.map(toProposal), rationale: value.rationale, setAside: value.set_aside, costMicros: d.costMicros + costMicros });
      return { ok: true, data: await view(saved) };
    }
    case "stories.save": {
      // The person's edits: the cards in their order, each with Keep or Drop, title, description, acceptance and size.
      const o = fields(input, ["draftId", "cards"]);
      const d = await owned(o.draftId);
      if (!Array.isArray(o.cards) || o.cards.length !== d.proposals.length) throw new Invalid("cards lists every card of the draft once");
      const writes = await plan.storyDraftWrites(d.id);
      const seen = new Set<string>();
      const next: Proposal[] = o.cards.map((c) => {
        const e = fields(c, ["id", "keep", "title", "description", "acceptance", "size"]);
        const id = text(e.id, "id", 16);
        const cur = d.proposals.find((p) => p.id === id);
        if (!cur || seen.has(id)) throw new Invalid("cards lists every card of the draft once");
        seen.add(id);
        if (typeof e.keep !== "boolean") throw new Invalid("keep must be true or false");
        if (!Array.isArray(e.acceptance) || e.acceptance.length > 20 || e.acceptance.some((a) => typeof a !== "string" || a.length > 1000)) throw new Invalid("acceptance is a list of lines");
        if (e.size !== null && !validStorySize(e.size)) throw new Invalid("size is S, M, L or null");
        const edit = { title: text(e.title, "title", 400, true).trim(), description: text(e.description, "description", 8000, true), acceptance: (e.acceptance as string[]).map((a) => a.trim()).filter(Boolean) };
        const problem = editProblem(edit);
        if (problem) throw new Refused(`${cur.title || id}: ${problem}`, 422);
        const changed = edit.title !== cur.title || edit.description !== cur.description || edit.acceptance.join("\n") !== cur.acceptance.join("\n") || e.size !== cur.size || e.keep !== cur.keep;
        // A card already sent keeps what was sent (the audit log has it); only its place in the list can change.
        if (writes.has(id) && changed) throw new Refused(`"${cur.title}" is already in DevOps; change it there`, 409);
        return { ...cur, ...edit, size: e.size as Proposal["size"], keep: e.keep };
      });
      return { ok: true, data: await view(await plan.saveStoryDraft(d.id, { ...d, proposals: next })) };
    }
    case "stories.publish_preview": {
      // The exact batch, held by the write framework: one create per kept card not yet sent, in dependency order.
      const o = fields(input, ["draftId"]);
      const d = await owned(o.draftId);
      if (!(await ctx.writeClients()).includes(d.clientKey)) throw new Refused(NO_PAT(nameOf(d.clientKey)), 409, "no_write_pat");
      const writes = await plan.storyDraftWrites(d.id);
      const todo = publishOrder(d.proposals).filter((p) => !writes.has(p.id));
      if (!todo.length) return { ok: true, data: { previews: [], nothing: ["Every kept story is in DevOps already, or waiting for Retry"], order: [] } };
      if (todo.length > MAX_PROPOSALS) throw new Invalid(`At most ${MAX_PROPOSALS} stories at once`);
      const r = await ctx.devopsWrite("devops.preview", { clientKey: d.clientKey, changes: todo.map((p) => ({ kind: "proposal_create", storyDraftId: d.id, proposalId: p.id })) });
      if (!r.ok) return r;
      return { ok: true, data: { ...(r.data as object), order: todo.map((p) => p.id) } };
    }
    case "stories.publish": {
      // Confirm the held batch; each create is tied to its proposal before it is sent (devops-write-actions.ts).
      const o = fields(input, ["draftId", "previewIds"]);
      const d = await owned(o.draftId);
      if (!Array.isArray(o.previewIds) || !o.previewIds.length || o.previewIds.length > MAX_PROPOSALS || o.previewIds.some((x) => typeof x !== "string")) throw new Invalid(`previewIds needs 1 to ${MAX_PROPOSALS} previews`);
      const r = await ctx.devopsWrite("devops.confirm", { previewIds: o.previewIds });
      if (!r.ok) return r;
      const results = (r.data as { results: ({ confirmed: boolean; message: string } | { error: string })[] }).results;
      const v = await view((await plan.storyDraft(d.id))!);
      return { ok: true, data: { draft: v, created: v.published, failed: results.filter((x) => "error" in x || !x.confirmed).map((x) => ("error" in x ? x.error : x.message)) } };
    }
    case "stories.retry": {
      // Retry for the rest: every card whose write didn't confirm is retried (it checks first); cards never sent come
      // back as "to preview" for a fresh preview and confirm.
      const o = fields(input, ["draftId"]);
      const d = await owned(o.draftId);
      const before = await view(d);
      const messages: string[] = [];
      for (const c of before.cards) {
        if (c.status.state !== "pending" && c.status.state !== "unconfirmed" && c.status.state !== "failed") continue;
        const r = await ctx.devopsWrite("devops.retry", { id: c.status.writeId });
        if (!r.ok) messages.push(`${c.title}: ${r.error}`);
        else if (!(r.data as { confirmed: boolean }).confirmed) messages.push(`${c.title}: ${(r.data as { message: string }).message}`);
      }
      const after = await view((await plan.storyDraft(d.id))!);
      return { ok: true, data: { draft: after, messages, toPreview: after.cards.filter((c) => c.keep && c.status.state === "not_sent").map((c) => c.id) } };
    }
    case "stories.house_style": {
      const o = fields(input, ["clientKey"], ["recompute"]);
      const clientKey = text(o.clientKey, "clientKey", 100);
      const pool = o.recompute === true ? await poolOf(clientKey) : null;
      if (o.recompute === true && pool) await plan.setComputedHouseStyle(clientKey, houseStyle(pool).text, houseStyle(pool).learned);
      const h = await plan.houseStyle(clientKey);
      return { ok: true, data: { clientKey, text: styleText(h), computed: h?.computed ?? null, computedAt: h?.computedAt ?? null, learned: !!h?.learned, edited: h?.edited ?? null, read: o.recompute === true ? pool !== null : null } };
    }
    case "stories.house_style_save": {
      const o = fields(input, ["clientKey", "text"]);
      const clientKey = text(o.clientKey, "clientKey", 100);
      const t = o.text === null ? null : text(o.text, "text", HOUSE_STYLE_MAX, true).trim() || null;
      const h = await plan.editHouseStyle(clientKey, t);
      return { ok: true, data: { clientKey, text: styleText(h), computed: h.computed, computedAt: h.computedAt, learned: h.learned, edited: h.edited } };
    }
  }
}

const workUrl = (e: DevOpsWriteEntry): string | null => (e.itemId ? `https://dev.azure.com/${encodeURIComponent(e.org)}/${encodeURIComponent(e.project)}/_workitems/edit/${e.itemId}` : null);
