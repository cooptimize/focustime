// The UI's only way to get data or act: named actions on the server (same origin, the session cookie, and the
// session's CSRF token in X-CSRF on every call; A2).
import type { ActionResponse, FieldProblem, WeekLoadData } from "../actions/types.ts";
import type { DraftStory, PlanDayState, Pick } from "../plan/types.ts";
import { pageActivity, USE_HEADER } from "./activity.ts";

/**
 * No live session (signed out, or it ended after 12 idle hours or 7 days): only the server says this, with code
 * "signed_out". An action's own refusal is never one, whatever its status (step 15.4 fix: missing Azure consent
 * is a 401 refusal with code "consent").
 */
export class SessionError extends Error {}

/** P1: whether the last call reached FocusTime (ui/Offline.tsx shows the offline line when not). */
let reached = true;
const reachListeners = new Set<() => void>();
function noteReached(ok: boolean) {
  if (ok === reached) return;
  reached = ok;
  reachListeners.forEach((f) => f());
}
export const lastCallReached = () => reached;
export const onReachChange = (f: () => void) => (reachListeners.add(f), () => void reachListeners.delete(f));
export const STALE_MESSAGE = "You're signed out. Sign in to continue";

/** Who shows the sign-in screen when a call finds the session ended (set by the root). */
let onStale: (() => void) | null = null;
export const setStaleListener = (f: typeof onStale) => void (onStale = f);
/** While the sign-in screen shows, an ended session is what the page already says: no banner over it. */
let signInShowing = false;
let onSignInShown: (() => void) | null = null;
export const setSignInShownListener = (f: typeof onSignInShown) => void (onSignInShown = f);
export const setSignInShowing = (v: boolean) => {
  signInShowing = v;
  if (v) onSignInShown?.();
};

/** The session's CSRF token (a readable cookie the server set with the session). */
export function csrfToken(): string {
  if (typeof document === "undefined") return "";
  for (const part of document.cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "__Host-focustime-csrf") return v.join("=");
  }
  return "";
}
const postHeaders = () => ({ "content-type": "application/json", "x-csrf": csrfToken() });

/** HK-3: reports real use (input while visible) at most once a minute; the answer carries the Rule's minutes. */
async function pingUse(): Promise<number | null> {
  const r = await fetch("/api/activity", { method: "POST", credentials: "same-origin", headers: { ...postHeaders(), [USE_HEADER]: "active" }, body: "{}" });
  if (!r.ok) return null;
  const m = ((await r.json().catch(() => null)) as { idleMinutes?: unknown } | null)?.idleMinutes;
  return typeof m === "number" ? m : null;
}
let activity: ReturnType<typeof pageActivity> | null = null;
const activityNow = () => (activity ??= pageActivity(pingUse));
/** HK-3: a call a timer makes (polls, the quiet refresh) says so and never counts as someone using FocusTime. */
export type CallOptions = { background?: boolean };

/** What a response from /api/action means: data, an action's refusal, or an out-of-date window. */
export async function readResponse<T>(res: Response): Promise<T> {
  let body: (ActionResponse<T> & { code?: string }) | null = null;
  try {
    body = (await res.json()) as ActionResponse<T> & { code?: string };
  } catch {
    body = null;
  }
  if (body && typeof body === "object" && "ok" in body) {
    if (body.ok) return body.data;
    if (body.code !== "signed_out") throw new ActionRefusal(body.error, body.status, body.fields ?? [], body.code);
  } else if (res.status !== 401) {
    throw new ActionRefusal(res.status === 403 ? "FocusTime refused that request" : `FocusTime answered ${res.status}`, res.status);
  }
  if (!signInShowing) onStale?.();
  throw new SessionError(STALE_MESSAGE);
}

/** Asks the host to open a fresh window (focustime-open replaces this one). False when it can't. */
export async function reopenFocusTime(): Promise<boolean> {
  try {
    const r = await fetch("/api/reopen", { method: "POST", credentials: "same-origin", headers: postHeaders(), body: "{}" });
    return r.status === 202;
  } catch {
    return false;
  }
}
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

export async function call<T>(action: string, input: unknown, opts: CallOptions = {}): Promise<T> {
  try {
    return await send<T>(action, input, opts);
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

/**
 * A3: the database's state while a call waits ("waking": a paused Azure SQL database resuming, up to a minute). A call
 * that hasn't answered in 1.5 seconds asks the server every second (from memory there, no database call) until it does.
 */
export type DbState = "ok" | "waking" | "unavailable";
let onDbState: ((s: DbState) => void) | null = null;
export const setDbStateListener = (f: typeof onDbState) => void (onDbState = f);
let waiting = 0;
let polling: ReturnType<typeof setInterval> | null = null;
const askDbState = async () => {
  try {
    const r = await fetch("/api/db-status", { method: "POST", credentials: "same-origin", headers: postHeaders(), body: "{}" });
    const s = ((await r.json()) as { status?: DbState }).status;
    if (s && waiting > 0) onDbState?.(s);
  } catch {
    // The server itself isn't answering: the call's own error says so.
  }
};
function watchSlowCall(): () => void {
  waiting++;
  const slow = setTimeout(() => {
    if (polling || waiting === 0) return;
    void askDbState();
    polling = setInterval(() => void askDbState(), 1000);
  }, 1500);
  return () => {
    clearTimeout(slow);
    waiting--;
    if (waiting > 0) return;
    if (polling) clearInterval(polling);
    polling = null;
    onDbState?.("ok");
  };
}

async function send<T>(action: string, input: unknown, opts: CallOptions = {}): Promise<T> {
  const done = watchSlowCall();
  let res: Response;
  try {
    res = await fetch("/api/action", {
      method: "POST",
      credentials: "same-origin",
      headers: { ...postHeaders(), [USE_HEADER]: activityNow().use(!!opts.background) },
      body: JSON.stringify({ action, input }),
    });
    noteReached(true);
  } catch (e) {
    // P1: no answer at all (no network, or FocusTime unreachable): the offline line shows until a call gets through.
    noteReached(false);
    throw e;
  } finally {
    done();
  }
  return readResponse<T>(res);
}

export const weekLoad = (input: { weekStart?: string; now?: string; refresh?: boolean; quiet?: boolean; viewRange?: string }, opts: CallOptions = {}) => call<WeekLoadData>("week.load", input, opts);

export type ConnectResult = { status: "connected" | "cancelled" | "failed" | "redirect"; message?: string; url?: string };
/** Connecting a calendar is a visit to Microsoft or Google and back (A2): the server says where, the page goes there. */
export async function connectSource(source: "outlook" | "google"): Promise<ConnectResult> {
  const r = await call<ConnectResult>(source === "outlook" ? "auth.connect_microsoft" : "auth.connect_google", {});
  if (r.status === "redirect" && r.url && r.url.startsWith("/auth/")) location.assign(r.url);
  return r;
}

/** Microsoft sign-in (A2): the page goes to the server's sign-in route, which sends it on to Microsoft and back. */
export const signInWithMicrosoft = (loginHint?: string) => location.assign(`/auth/microsoft/login${loginHint ? `?hint=${encodeURIComponent(loginHint)}` : ""}`);

/** "Try the demo": a demo session with fictional data, in place of any session this browser had. */
export async function startDemo(): Promise<void> {
  const r = await fetch("/auth/demo", { method: "POST", credentials: "same-origin", headers: postHeaders(), body: "{}" });
  if (!r.ok) throw new Error("The demo isn't available right now");
}

/** P1: what this device does before the session ends (its push removed, the shell caches cleared; ui/pwa.ts). */
let beforeSignOut: (() => Promise<void>) | null = null;
export const setBeforeSignOut = (f: typeof beforeSignOut) => void (beforeSignOut = f);

/** Signs out of FocusTime (or leaves the demo): the session ends on the server and its cookies are cleared. */
export async function endSession(): Promise<void> {
  await beforeSignOut?.().catch(() => undefined);
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin", headers: postHeaders(), body: "{}" }).catch(() => null);
}
export const disconnectSource = (source: "outlook" | "google") => call<{ status: string }>("auth.disconnect", { source });

export type PlanResult = { pick?: Pick; state?: PlanDayState; draft?: DraftStory; result?: string };
/** Plan actions (step 5): local only. */
export const planAction = (action: string, input: unknown) => call<PlanResult & PlanDayState>(action, input);

/** Saves the theme in config (step 6b). */
export const setThemeAction = (theme: string) => call<{ ui: { theme: string } }>("ui.set_theme", { theme });

/** Step 9: the view focustime-open asked for ("capture"), taken once; null when none or on any failure. */
export async function takeOpenRequest(): Promise<string | null> {
  try {
    const r = await fetch("/api/open-request", { method: "POST", credentials: "same-origin", headers: postHeaders(), body: "{}" });
    if (!r.ok) return null;
    const j = (await r.json()) as { view?: unknown };
    return typeof j.view === "string" ? j.view : null;
  } catch {
    return null;
  }
}
