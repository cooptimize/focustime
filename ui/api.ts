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
    /** A refusal the UI can answer (step 13.5: "no_hours"). */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Step 13.5: what to do when a pick would move to a day with no working hours. Set by the App's prompt. */
export type NoHoursChoice = "add" | "anyway" | "cancel";
let askNoHours: ((question: string, date: string) => Promise<NoHoursChoice>) | null = null;
export const setNoHoursPrompt = (f: typeof askNoHours) => void (askNoHours = f);

export async function call<T>(action: string, input: unknown): Promise<T> {
  try {
    return await send<T>(action, input);
  } catch (e) {
    // Any Move (menus, Plan the day, Check-in, Close out) asks the same question: Add hours, or Move anyway.
    if (e instanceof ActionRefusal && e.code === "no_hours" && action === "pick.move" && askNoHours && typeof input === "object" && input) {
      const choice = await askNoHours(e.message, String((input as { date?: unknown }).date ?? ""));
      if (choice === "anyway") return send<T>(action, { ...(input as object), anyway: true });
      throw new ActionRefusal(choice === "add" ? "Not moved yet: add hours for that day in Settings, then move it" : "Not moved", 409, [], "cancelled");
    }
    throw e;
  }
}

async function send<T>(action: string, input: unknown): Promise<T> {
  const res = await fetch("/api/action", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  if (res.status === 401 || res.status === 403) throw new SessionError("Session expired");
  const body = (await res.json()) as ActionResponse<T>;
  if (!body.ok) throw new ActionRefusal(body.error, body.status, body.fields ?? [], body.code);
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

/** Step 9: the view coopilot-open asked for ("capture"), taken once; null when none or on any failure. */
export async function takeOpenRequest(): Promise<string | null> {
  try {
    const r = await fetch("/api/open-request", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!r.ok) return null;
    const j = (await r.json()) as { view?: unknown };
    return typeof j.view === "string" ? j.view : null;
  } catch {
    return null;
  }
}
