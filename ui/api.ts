// The UI's only way to get data: named actions on the local server (same origin, token cookie).
import type { ActionResponse, WeekLoadData } from "../actions/types.ts";

export class SessionError extends Error {}

export async function weekLoad(input: { weekStart?: string; now?: string; refresh?: boolean }): Promise<WeekLoadData> {
  const res = await fetch("/api/action", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "week.load", input }),
  });
  if (res.status === 401 || res.status === 403) throw new SessionError("Session expired");
  const body = (await res.json()) as ActionResponse<WeekLoadData>;
  if (!body.ok) throw new Error(body.error);
  return body.data;
}
