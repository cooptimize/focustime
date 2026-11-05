// F1, FB-1: Send feedback. A preview of the exact story first (held on the server for 10 minutes), then a send that
// creates it as the person sending it, through the write framework: the configured parent's client is found by its
// DevOps project, the person's own write PAT for that client is used, and the create is the framework's own (preview,
// confirm, read back, audit log, undo). There is no app identity and no preview-only mode: without a working PAT the
// dialog says how to turn writes on and offers Copy text, and nothing is requested. Never retried silently: a failure
// says so and the window keeps the text. At most DAILY_LIMIT sends per person per day. The demo sends to a pretend
// backlog in memory (sources/demo/feedback.ts).
import { randomUUID } from "node:crypto";
import { buildFeedback, DAILY_LIMIT, DESTINATION, LIMIT_REACHED, NOT_SET_UP, parseDraft, sentToday, type FeedbackPayload, type Sender } from "../plan/feedback.ts";
import type { PlanStore } from "../store/plan-store.ts";
import type { ActionResponse } from "./types.ts";
import { setupLine, type FeedbackPreview, type FeedbackSent, type FeedbackSetup, type FeedbackStatus, type FeedbackWriteView } from "./feedback-types.ts";

export const FEEDBACK_ACTIONS = ["feedback.status", "feedback.preview", "feedback.send"] as const;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];

export type { FeedbackPreview, FeedbackSent, FeedbackSetup, FeedbackStatus } from "./feedback-types.ts";

/** One person's way to DevOps for feedback (the write framework, or the demo's pretend backlog). */
export type FeedbackBackend = {
  /** The demo: a pretend backlog in memory; the preview says so. */
  demo: boolean;
  /** dev, prod, demo or local: dev's titles start "[dev]". */
  env: string;
  check: () => Promise<FeedbackSetup>;
  /** Holds the create and returns a token to confirm it with, or the setup that stops it (no request is made then). */
  preview: (p: FeedbackPayload) => Promise<{ setup: FeedbackSetup; write: FeedbackWriteView | null; token: string | null; refused: string | null }>;
  confirm: (token: string) => Promise<{ ok: true; id: number; url: string; confirmed: boolean } | { ok: false; message: string }>;
};

/** What a person's request needs: their backend, who they are, their local day, and their store (the daily count). */
export type FeedbackContext = { backend: FeedbackBackend; sender: () => Promise<Sender | null>; today: () => Promise<string>; plan: PlanStore | undefined };

const COUNT_KEY = "feedback_sent";
const PREVIEW_MS = 10 * 60_000;
type Held = { id: string; expiresAt: number; owner: object; payload: FeedbackPayload; token: string | null };
const held = new Map<string, Held>();
export const clearFeedbackPreviews = () => held.clear();

export const DEMO_NOTE = "Demo: this goes to a pretend backlog in memory. Nothing leaves FocusTime.";
const fail = (status: number, error: string, code: string): ActionResponse => ({ ok: false, status, error, code });

async function count(ctx: FeedbackContext): Promise<{ date: string; n: number }> {
  const date = await ctx.today();
  return { date, n: sentToday(await ctx.plan?.getState(COUNT_KEY), date) };
}

export async function feedbackAction(ctx: FeedbackContext, action: FeedbackAction, input: unknown, now: () => number = Date.now): Promise<ActionResponse> {
  const b = ctx.backend;
  switch (action) {
    case "feedback.status": {
      if (input !== undefined && input !== null && (typeof input !== "object" || Object.keys(input).some((k) => k !== "fresh"))) return fail(400, "feedback.status takes { fresh? }", "invalid");
      const setup = await b.check();
      const { n } = await count(ctx);
      const out: FeedbackStatus = { setup, line: setupLine(setup), destination: DESTINATION, limit: DAILY_LIMIT, sentToday: n };
      return { ok: true, data: out };
    }
    case "feedback.preview": {
      const d = parseDraft(input);
      if ("error" in d) return fail(400, d.error, "invalid");
      const sender = await ctx.sender();
      if (!sender) return fail(401, "Sign in first", "not_signed_in");
      const payload = buildFeedback(d, sender, b.env);
      const r = await b.preview(payload);
      const { n } = await count(ctx);
      const setUp = r.setup.state === "ready" && r.token !== null;
      const message = r.setup.state !== "ready" ? setupLine(r.setup) : r.refused ? r.refused : n >= DAILY_LIMIT ? LIMIT_REACHED : b.demo ? DEMO_NOTE : null;
      const previewId = randomUUID();
      for (const [k, v] of held) if (v.expiresAt < now()) held.delete(k);
      held.set(previewId, { id: previewId, expiresAt: now() + PREVIEW_MS, owner: ctx.plan ?? ctx, payload, token: r.token });
      const out: FeedbackPreview = { previewId, ...payload, destination: DESTINATION, setUp, setup: r.setup, message, remaining: Math.max(0, DAILY_LIMIT - n), write: r.write };
      return { ok: true, data: out };
    }
    case "feedback.send": {
      if (typeof input !== "object" || input === null || Object.keys(input).some((k) => k !== "previewId") || typeof (input as { previewId?: unknown }).previewId !== "string") return fail(400, "feedback.send takes { previewId }", "invalid");
      const h = held.get((input as { previewId: string }).previewId);
      if (!h || h.expiresAt < now() || h.owner !== (ctx.plan ?? ctx)) return fail(410, "That preview expired. Go back and look again", "expired");
      if (!h.token) return fail(503, NOT_SET_UP, "not_set_up");
      const { date, n } = await count(ctx);
      if (n >= DAILY_LIMIT) return fail(429, LIMIT_REACHED, "limit");
      // Counted before the create: a send that reached DevOps counts, whatever happened next.
      await ctx.plan?.setState(COUNT_KEY, { date, count: n + 1 });
      held.delete(h.id);
      // The write framework logs it (pending first, settled after the read back) in the person's DevOps write log.
      const r = await b.confirm(h.token);
      if (!r.ok) return fail(502, `Not sent: ${r.message.replace(/\.$/, "")}. Your text is still here; Copy text keeps it.`, "devops");
      const out: FeedbackSent = { sent: true, id: r.id, url: r.url, confirmed: r.confirmed, message: r.confirmed ? "Sent. Thanks." : `Sent as #${r.id}, but FocusTime couldn't check it in DevOps.` };
      return { ok: true, data: out };
    }
  }
}
