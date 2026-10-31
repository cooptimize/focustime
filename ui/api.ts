// The UI's only way to get data or act: named actions on the local server (same origin, token cookie).
import type { ActionResponse, FieldProblem, WeekLoadData } from "../actions/types.ts";
import type { DraftStory, PlanDayState, Pick } from "../plan/types.ts";

export class SessionError extends Error {}
/** A refusal from an action, with its HTTP status (422: the day can't be planned, 409: not allowed now). */
export class ActionRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Per-field problems (Settings). */
    readonly fields: FieldProblem[] = [],
  ) {
    super(message);
  }
}

export async function call<T>(action: string, input: unknown): Promise<T> {
  const res = await fetch("/api/action", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  if (res.status === 401 || res.status === 403) throw new SessionError("Session expired");
  const body = (await res.json()) as ActionResponse<T>;
  if (!body.ok) throw new ActionRefusal(body.error, body.status, body.fields ?? []);
  return body.data;
}

export const weekLoad = (input: { weekStart?: string; now?: string; refresh?: boolean }) => call<WeekLoadData>("week.load", input);

export type ConnectResult = { status: "connected" | "cancelled" | "failed"; message?: string };
export const connectSource = (source: "outlook" | "google") =>
  call<ConnectResult>(source === "outlook" ? "auth.connect_microsoft" : "auth.connect_google", {});
export const disconnectSource = (source: "outlook" | "google") => call<{ status: string }>("auth.disconnect", { source });

export type PlanResult = { pick?: Pick; state?: PlanDayState; draft?: DraftStory; result?: string };
/** Plan actions (step 5): local only. */
export const planAction = (action: string, input: unknown) => call<PlanResult & PlanDayState>(action, input);

/** Saves the theme in config (step 6b). */
export const setThemeAction = (theme: string) => call<{ ui: { theme: string } }>("ui.set_theme", { theme });
