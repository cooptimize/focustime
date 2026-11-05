// F1: Send feedback. A preview of the exact story first (held on the server for 10 minutes), then a send that creates
// it as the app's managed identity under the FocusTime feature, reads it back and only then says Sent. Never retried
// silently: a failure says so and the window keeps the text (Copy text). At most DAILY_LIMIT sends per person per day.
// Preview only (the developer loop, and dev while its live switch is off): everything up to the create, nothing created.
// The setup check (feature there, a Feature, the identity may create a child story: validateOnly) runs at server start
// and is shown read only in Settings > Connections.
import { randomUUID } from "node:crypto";
import { buildFeedback, DAILY_LIMIT, DESTINATION, LIMIT_REACHED, NOT_SET_UP, parseDraft, sentToday, type FeedbackPayload, type Sender } from "../plan/feedback.ts";
import { FeedbackFailure, itemWebUrl, type CreatedItem, type FeedbackDevOps } from "../sources/devops/feedback.ts";
import type { Logger } from "../log/logger.ts";
import { readBack, type Sleep } from "./readback.ts";
import type { PlanStore } from "../store/plan-store.ts";
import type { ActionResponse } from "./types.ts";
import type { FeedbackMode, FeedbackPreview, FeedbackSent, FeedbackSetup, FeedbackStatus } from "./feedback-types.ts";

export const FEEDBACK_ACTIONS = ["feedback.status", "feedback.preview", "feedback.send"] as const;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];

export type { FeedbackMode, FeedbackPreview, FeedbackSent, FeedbackSetup, FeedbackStatus } from "./feedback-types.ts";

/** One per FocusTime process: the target's DevOps client (null: not configured, or the developer loop). */
export type FeedbackService = {
  mode: FeedbackMode;
  env: string;
  /** The demo: a pretend backlog in memory (sources/demo/feedback.ts); the preview says so. */
  demo: boolean;
  check: (force?: boolean) => Promise<FeedbackSetup>;
  send: (p: FeedbackPayload) => Promise<{ item: CreatedItem; confirmed: boolean }>;
};

const READY_MS = 10 * 60_000;
const RETRY_MS = 2 * 60_000;
const isNetwork = (e: unknown) => e instanceof FeedbackFailure && e.kind === "network";

export function createFeedbackService(o: { devops: FeedbackDevOps | null; mode: FeedbackMode; env: string; local: boolean; demo?: boolean; now: () => number; log: Logger; sleep?: Sleep }): FeedbackService {
  let cached: { at: number; setup: FeedbackSetup; area: string | null } | null = null;
  let inFlight: Promise<FeedbackSetup> | null = null;

  async function run(): Promise<{ setup: FeedbackSetup; area: string | null }> {
    const at = new Date(o.now()).toISOString();
    const no = (reason: string) => ({ setup: { state: "not_set_up" as const, reason, checkedAt: at }, area: null });
    if (o.local) return { setup: { state: "local" }, area: null };
    const d = o.devops;
    if (!d) return no("No DevOps organization, project and feature are set for feedback");
    try {
      const parent = await d.parent();
      if (!parent) return no(`Feature #${d.target.parentId} isn't there, or FocusTime can't see it`);
      // WT-1: the parent must sit at the process's parent level (where features are), whatever the type is called.
      if (!(await d.parentTypes()).includes(parent.type)) return no(`#${d.target.parentId} is a ${parent.type || "work item"}, not at the feature level of this process`);
      const type = await d.storyType();
      if (!type) return no("The project's process has no story type");
      // validateOnly: everything a real create checks (type, fields, area, the parent link, permission), nothing saved.
      await d.create(type, { title: "FocusTime setup check", description: "Not saved", tags: [] }, parent.areaPath || d.target.project, d.target.project, true);
      return { setup: { state: "ready", storyType: type, parentId: parent.id, parentTitle: parent.title, checkedAt: at }, area: parent.areaPath || d.target.project };
    } catch (e) {
      return no(e instanceof FeedbackFailure ? e.message : "The check failed");
    }
  }

  async function check(force = false): Promise<FeedbackSetup> {
    const t = o.now();
    if (!force && cached && t - cached.at < (cached.setup.state === "not_set_up" ? RETRY_MS : READY_MS)) return cached.setup;
    if (!inFlight)
      inFlight = run().then((r) => {
        cached = { at: o.now(), ...r };
        o.log({ source: "devops", op: "feedback_check", kind: r.setup.state });
        return r.setup;
      }).finally(() => (inFlight = null));
    return inFlight;
  }

  async function send(p: FeedbackPayload): Promise<{ item: CreatedItem; confirmed: boolean }> {
    const d = o.devops;
    if (o.mode !== "live" || !d) throw new FeedbackFailure("error", "Feedback is preview only here");
    const setup = await check();
    if (setup.state !== "ready" || !cached?.area) throw new FeedbackFailure("forbidden", NOT_SET_UP);
    const iteration = await d.defaultIteration();
    const made = await d.create(setup.storyType, p, cached.area, iteration);
    if (!made.id) throw new FeedbackFailure("error", "DevOps didn't say which item it created");
    const id = made.id;
    // Created: from here it exists, whatever the read-back says.
    try {
      const back = await readBack(() => d.read(id), isNetwork, o.sleep);
      return { item: back, confirmed: back.title === p.title && back.parentId === d.target.parentId };
    } catch {
      return { item: { id, rev: made.rev ?? 0, title: p.title, type: setup.storyType, parentId: null, url: itemWebUrl(d.target, id) }, confirmed: false };
    }
  }

  return { mode: o.mode, env: o.env, demo: o.demo === true, check, send };
}

/** What a person's request needs: the service, who they are, their local day, and their store (the daily count). */
export type FeedbackContext = { service: FeedbackService; sender: () => Promise<Sender | null>; today: () => Promise<string>; plan: PlanStore | undefined };

const COUNT_KEY = "feedback_sent";
const PREVIEW_MS = 10 * 60_000;
type Held = { id: string; expiresAt: number; owner: object; payload: FeedbackPayload };
const held = new Map<string, Held>();
export const clearFeedbackPreviews = () => held.clear();

export const DEMO_NOTE = "Demo: this goes to a pretend backlog in memory. Nothing leaves FocusTime.";
const fail = (status: number, error: string, code: string): ActionResponse => ({ ok: false, status, error, code });

async function count(ctx: FeedbackContext): Promise<{ date: string; n: number }> {
  const date = await ctx.today();
  return { date, n: sentToday(await ctx.plan?.getState(COUNT_KEY), date) };
}

export async function feedbackAction(ctx: FeedbackContext, action: FeedbackAction, input: unknown, now: () => number = Date.now): Promise<ActionResponse> {
  const s = ctx.service;
  switch (action) {
    case "feedback.status": {
      if (input !== undefined && input !== null && (typeof input !== "object" || Object.keys(input).some((k) => k !== "fresh"))) return fail(400, "feedback.status takes { fresh? }", "invalid");
      const setup = await s.check((input as { fresh?: unknown } | null)?.fresh === true);
      const { n } = await count(ctx);
      const out: FeedbackStatus = { mode: s.mode, setup, destination: DESTINATION, limit: DAILY_LIMIT, sentToday: n, notSetUp: NOT_SET_UP };
      return { ok: true, data: out };
    }
    case "feedback.preview": {
      const d = parseDraft(input);
      if ("error" in d) return fail(400, d.error, "invalid");
      const sender = await ctx.sender();
      if (!sender) return fail(401, "Sign in first", "not_signed_in");
      const payload = buildFeedback(d, sender, s.env);
      const setup = await s.check();
      const { n } = await count(ctx);
      const setUp = setup.state === "ready" || setup.state === "local";
      const message = !setUp ? NOT_SET_UP : s.mode === "preview_only" ? "Preview only here: nothing is sent from this FocusTime." : n >= DAILY_LIMIT ? LIMIT_REACHED : s.demo ? DEMO_NOTE : null;
      const previewId = randomUUID();
      held.set(previewId, { id: previewId, expiresAt: now() + PREVIEW_MS, owner: ctx.plan ?? ctx, payload });
      const out: FeedbackPreview = { previewId, ...payload, destination: DESTINATION, mode: s.mode, setUp, message, remaining: Math.max(0, DAILY_LIMIT - n) };
      return { ok: true, data: out };
    }
    case "feedback.send": {
      if (typeof input !== "object" || input === null || Object.keys(input).some((k) => k !== "previewId") || typeof (input as { previewId?: unknown }).previewId !== "string") return fail(400, "feedback.send takes { previewId }", "invalid");
      const h = held.get((input as { previewId: string }).previewId);
      if (!h || h.expiresAt < now() || h.owner !== (ctx.plan ?? ctx)) return fail(410, "That preview expired. Go back and look again", "expired");
      if (s.mode === "preview_only") {
        held.delete(h.id);
        const out: FeedbackSent = { sent: false, previewOnly: true, message: "Preview only here: nothing was created." };
        return { ok: true, data: out };
      }
      const setup = await s.check();
      if (setup.state !== "ready") return fail(503, NOT_SET_UP, "not_set_up");
      const { date, n } = await count(ctx);
      if (n >= DAILY_LIMIT) return fail(429, LIMIT_REACHED, "limit");
      // Counted before the create: a send that reached DevOps counts, whatever happened next.
      await ctx.plan?.setState(COUNT_KEY, { date, count: n + 1 });
      held.delete(h.id);
      try {
        const { item, confirmed } = await s.send(h.payload);
        const out: FeedbackSent = { sent: true, id: item.id, url: item.url, confirmed, message: confirmed ? "Sent. Thanks." : `Sent as #${item.id}, but FocusTime couldn't check it in DevOps.` };
        return { ok: true, data: out };
      } catch (e) {
        const msg = e instanceof FeedbackFailure ? e.message : "Something went wrong sending it";
        return fail(502, `Not sent: ${msg}. Your text is still here; Copy text keeps it.`, "devops");
      }
    }
  }
}
