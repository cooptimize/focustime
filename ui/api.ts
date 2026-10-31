// The UI's only way to get data or act: named actions on the local server (same origin, token cookie).
import type { ActionResponse, WeekLoadData } from "../actions/types.ts";

export class SessionError extends Error {}

async function call<T>(action: string, input: unknown): Promise<T> {
  const res = await fetch("/api/action", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  if (res.status === 401 || res.status === 403) throw new SessionError("Session expired");
  const body = (await res.json()) as ActionResponse<T>;
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

export const weekLoad = (input: { weekStart?: string; now?: string; refresh?: boolean }) => call<WeekLoadData>("week.load", input);

export type ConnectResult = { status: "connected" | "cancelled" | "failed"; message?: string };
export const connectSource = (source: "outlook" | "google") =>
  call<ConnectResult>(source === "outlook" ? "auth.connect_microsoft" : "auth.connect_google", {});
export const disconnectSource = (source: "outlook" | "google") => call<{ status: string }>("auth.disconnect", { source });
