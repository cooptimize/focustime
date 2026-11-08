// AI-F1: the processing tier of every AI task, in one place. "flex" (OpenAI's Flex processing: half price, slower, an
// unbilled 429 when capacity is short) only for background work nobody waits on; everything else, and every task not
// named here (a new one), is "standard". Verified Nov 6 against developers.openai.com/api/docs/guides/flex-processing,
// /pricing and /models/gpt-6-luna: `service_tier: "flex"` on the Responses API, Batch prices, beta, not for audio.

export type AiTier = "standard" | "flex";

/**
 * The background tasks: each runs from the shared poll or a scheduled job, never while a person waits for it.
 * conversations.update carries the chat images' descriptions in the same request (CV-4). MC-1's meeting.capture
 * runs after a call (the poll job, or an upload) and its proposals wait for a reviewer: background.
 */
export const FLEX_TASKS = ["conversations.update", "promises.extract", "asks.classify", "meeting.capture"] as const;
export type FlexTask = (typeof FLEX_TASKS)[number];

/**
 * The interactive tasks, named so a test can assert each stays standard (any task not in FLEX_TASKS is standard
 * anyway). conversations.comment (follow-through) runs on a tick but is a draft a person reviews: standard for now.
 */
export const STANDARD_TASKS = [
  "test_ai", "assistant.intent", "assistant.answer", "assistant.question", "assistant_transcribe", "stories.draft", "status_draft", "status_suggest",
  "conversations.draft_item", "conversations.merge_summary", "conversations.comment", "capture.prepare", "loop_draft",
] as const;

/** Whether a task is declared background (an admin may still switch it back to standard). */
export const isFlexTask = (name: string): name is FlexTask => (FLEX_TASKS as readonly string[]).includes(name);

/**
 * The tier a request asks for: standard unless the task is declared flex, an admin hasn't switched it back
 * (`standardTasks`, Admin › AI), and the caller isn't a person waiting (a button such as Sort again).
 */
export function tierFor(task: string, o: { standardTasks?: readonly string[]; waiting?: boolean } = {}): AiTier {
  if (o.waiting || !isFlexTask(task)) return "standard";
  return o.standardTasks?.includes(task) ? "standard" : "flex";
}

/** Retries and the fallback for flex: app settings ([ai] flex_*), the same for everyone. */
export type FlexSettings = {
  /** Flex tries before falling back to standard (the first included), 1 to 10. */
  maxTries: number;
  /** The most time spent on flex (tries and waits) before falling back, in ms. */
  maxWaitMs: number;
  /** A flex call's own timeout (it is slower than standard), in ms. */
  timeoutMs: number;
  /** The first backoff; doubled each try, with jitter. */
  baseBackoffMs: number;
};
export const DEFAULT_FLEX: FlexSettings = { maxTries: 3, maxWaitMs: 90_000, timeoutMs: 120_000, baseBackoffMs: 2_000 };
