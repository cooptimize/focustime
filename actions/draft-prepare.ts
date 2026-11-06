// CP-1: the AI-prepared version of a captured draft, made in the background after the save. The capture box saves
// at once and then asks for draft.prepare without waiting; the preview reads draft.get until it is ready. One request
// through ai/ (AI for FocusTime, that client's Allow AI, the guards, my own cap, its own output limit), with only that
// client's offered types, open parents and examples. No retry: a failure leaves a plain draft. No write PAT for the
// client: nothing is sent (the draft couldn't be created anyway). Nothing here writes to DevOps; my own text is kept.
import type { AiService } from "../ai/service.ts";
import type { AppConfig } from "../config/schema.ts";
import { MAX_CANDIDATES, MAX_EXAMPLES, offeredTypes, PREPARE_INSTRUCTIONS, PREPARE_TASK, prepareInput, prepareSchema, toDraftAi, WRITING_MS, type Candidate, type Example, type PrepareAnswer } from "../plan/capture-prepare.ts";
import { typeOf, type ProcessModel } from "../plan/process.ts";
import { rankExemplars, type ExemplarCandidate } from "../plan/stories.ts";
import type { DraftAi, DraftStory } from "../plan/types.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import type { ActionResponse, CaptureFeatures, DraftAiView } from "./types.ts";
export type { DraftAiView } from "./types.ts";

export const DRAFT_AI_ACTIONS = ["draft.prepare", "draft.get"] as const;
export type DraftAiAction = (typeof DRAFT_AI_ACTIONS)[number];

export type PrepareContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  ai: () => Promise<AiService | null>;
  /** The clients I have a checked write PAT for. */
  writeClients: () => Promise<string[]>;
  /** The client's open features and epics (read-only, the company read PAT). */
  features: (cfg: AppConfig, clientKey: string) => Promise<CaptureFeatures>;
  /** The client's process model, or null when DevOps can't say. */
  model: (cfg: AppConfig, clientKey: string) => Promise<ProcessModel | null>;
  /** The client's own past items for examples, or null. */
  pool: (cfg: AppConfig, clientKey: string) => Promise<ExemplarCandidate[] | null>;
  now: () => string;
  /** IB-1: whether a client key is Cooptimize Internal (clientAccounts' why "internal"). */
  isInternal?: (clientKey: string) => Promise<boolean>;
};

/**
 * IB-1 slice 3: a draft's refusal for naming another client, as stored before IB-1 (AI_MESSAGES.refused_client) and
 * from now on. Before GD-1 that refusal caught every Cooptimize Internal draft, so an Internal draft still carrying
 * the old note is prepared once more under the current guard; refused again, it takes the new note and stays.
 */
export const LEGACY_DRAFT_REFUSED = "Not sent: it mentions another client";
export const DRAFT_HELD = "Held back: it mentions another client";
const stale = async (ctx: PrepareContext, d: DraftStory) => d.ai?.state === "failed" && d.ai.note === LEGACY_DRAFT_REFUSED && !!(await ctx.isInternal?.(d.clientKey).catch(() => false));


const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
const OFF_KINDS = new Set(["off", "client_off", "not_set_up", "over_budget", "zero_budget"]);

function draftId(input: unknown, extra: string[] = []): { id: number; o: Record<string, unknown> } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new PlanError("input must be an object");
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "id" && !extra.includes(k)) throw new PlanError(`unknown input field ${k}`);
  if (typeof o.id !== "number" || !Number.isSafeInteger(o.id) || o.id <= 0) throw new PlanError("id must be a positive whole number");
  return { id: o.id, o };
}

export async function draftAiAction(ctx: PrepareContext, action: DraftAiAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The plan store isn't available", 503);
  try {
    const { id, o } = draftId(input, action === "draft.prepare" ? ["again"] : []);
    const draft = await plan.getDraft(id);
    if (!draft) return bad("No such draft", 404);
    const canWrite = (await ctx.writeClients()).includes(draft.clientKey);
    const view = async (d: DraftStory): Promise<ActionResponse> => ({ ok: true, data: { draft: d, canWrite, aiOn: await aiOn(ctx, d.clientKey), now: ctx.now() } satisfies DraftAiView });
    if (draft.devopsId) return view(draft);
    // No write PAT: nothing is sent. The row says to add one.
    if (!canWrite) return view(draft);
    const cur = draft.ai;
    const writing = cur?.state === "writing" && !!cur.ranAt && Temporal.Instant.from(cur.ranAt).add({ milliseconds: WRITING_MS }).epochMilliseconds > Temporal.Instant.from(ctx.now()).epochMilliseconds;
    // IB-1: an Internal draft refused before GD-1 is checked once more under the current guard (on any read of it).
    if (!writing && (await stale(ctx, draft))) return view(await prepare(ctx, plan, draft));
    if (action === "draft.get") return view(draft);
    // Once per draft (Prepare again only on request), and never twice at once.
    if (writing || (cur && cur.state !== "writing" && o.again !== true)) return view(draft);
    return view(await prepare(ctx, plan, draft));
  } catch (e) {
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}

/** UI-7: whether a prepare would reach the AI now: set up, AI for FocusTime on and this client's Allow AI on. Nothing is sent. */
async function aiOn(ctx: PrepareContext, clientKey: string): Promise<boolean> {
  const cfg = await ctx.config().catch(() => null);
  if (!cfg?.aiRules.on || !cfg.aiRules.allowedClients.includes(clientKey)) return false;
  return !!(await ctx.ai().catch(() => null));
}

const plain = (state: "off" | "failed", note: string, ranAt: string | null): DraftAi => ({ state, title: null, description: null, acceptance: null, type: null, parentId: null, parentReason: null, note, ranAt });

async function prepare(ctx: PrepareContext, plan: PlanStore, draft: DraftStory): Promise<DraftStory> {
  const cfg = await ctx.config();
  const ai = await ctx.ai();
  // AI off, not set up, or not allowed for this client: a plain draft, no error and nothing read.
  if (!cfg || !ai) return plan.setDraftAi(draft.id, plain("off", "AI isn't set up", null));
  if (!cfg.aiRules.on) return plan.setDraftAi(draft.id, plain("off", "AI is off for FocusTime", null));
  if (!cfg.aiRules.allowedClients.includes(draft.clientKey)) return plan.setDraftAi(draft.id, plain("off", "AI isn't allowed for this client", null));
  const ranAt = ctx.now();
  await plan.setDraftAi(draft.id, { ...plain("off", "", ranAt), state: "writing", note: null });
  try {
    const level = draft.level === "feature" ? "feature" : "story";
    const [features, model, pool] = await Promise.all([
      ctx.features(cfg, draft.clientKey).catch((): CaptureFeatures => ({ clientKey: draft.clientKey, status: "unavailable", features: [], epics: [] })),
      ctx.model(cfg, draft.clientKey).catch(() => null),
      ctx.pool(cfg, draft.clientKey).catch(() => null),
    ]);
    // Only this client's own open parents (its features for a story, its epics for a feature).
    const candidates: Candidate[] = (level === "feature" ? features.epics : features.features).slice(0, MAX_CANDIDATES).map((c) => ({ id: c.id, title: c.title, type: c.type ?? "" }));
    const types = model ? offeredTypes({ level, levelTypes: model.levels[level === "feature" ? "parent" : "child"], childrenOf: (t) => typeOf(model, t)?.validChildren ?? [], parentTypes: [...new Set(candidates.map((c) => c.type).filter(Boolean))], defaultType: null }) : [];
    const capture = await plan.captureOfDraft(draft.id);
    const note = capture?.text ?? draft.title;
    const parent = draft.parentItemId !== null ? candidates.find((c) => c.id === draft.parentItemId) : undefined;
    const examples: Example[] = pool ? exampleOf(level, rankExemplars({ id: 0, areaPath: "", tags: [], parentId: parent ? parent.id : null, title: note }, pool, MAX_EXAMPLES)) : [];
    const team = cfg.org?.clients[draft.clientKey]?.houseStyle ?? null;
    const learned = await plan.houseStyle(draft.clientKey).catch(() => null);
    const style = team ?? learned?.edited ?? learned?.computed ?? null;
    const clientName = cfg.clientSettings[draft.clientKey]?.name ?? draft.clientKey;
    const ids = candidates.map((c) => c.id);
    const r = await ai.run<PrepareAnswer>({ name: PREPARE_TASK, client: draft.clientKey, instructions: PREPARE_INSTRUCTIONS }, prepareInput({ level, clientName, note, title: draft.title, types, candidates, examples, style }), prepareSchema(types, ids));
    if (!r.ok) return plan.setDraftAi(draft.id, plain(OFF_KINDS.has(r.error.kind) ? "off" : "failed", r.error.kind === "refused_client" ? DRAFT_HELD : r.error.message, ranAt));
    const made = toDraftAi(r.value, { level, types, candidateIds: ids, hasParent: draft.parentItemId !== null, ranAt });
    if ("problem" in made) return plan.setDraftAi(draft.id, plain("failed", "The AI's answer wasn't usable", ranAt));
    return plan.setDraftAi(draft.id, made);
  } catch {
    // A lost read or a store hiccup: a plain draft, never an error on the capture.
    return plan.setDraftAi(draft.id, plain("failed", "The AI couldn't help this time", ranAt)).catch(() => draft);
  }
}

/** Examples in the draft's own level: past features for a feature, their stories for a story. */
function exampleOf(level: "story" | "feature", ranked: readonly ExemplarCandidate[]): Example[] {
  if (level === "feature") return ranked.slice(0, MAX_EXAMPLES).map((e) => ({ title: e.title, summary: e.description }));
  return ranked.flatMap((e) => e.stories.map((s) => ({ title: s.title, summary: s.description }))).slice(0, MAX_EXAMPLES);
}
