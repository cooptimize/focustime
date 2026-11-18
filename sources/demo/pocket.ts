// PK-2: a pretend Pocket, for tests and the demo. A fetch that answers only Pocket's list call, from invented data,
// in the shape Pocket's docs show ({ success, data, pagination }). Nothing leaves the process. Some keys act out
// Pocket's failures, so the demo and the tests can show each one's words:
//   pk_demo_wrong   Pocket doesn't accept the key (401)
//   pk_demo_busy    Pocket is busy (429)
//   pk_demo_slow    Pocket never answers (the client's time limit ends it)
//   pk_demo_odd     Pocket answers in a shape FocusTime doesn't know
// Any other key starting pk_ is accepted. Every recording is invented; none is ever shown (FocusTime reads the total).
import { POCKET_LIST_PATH, POCKET_ORIGIN } from "../pocket/client.ts";

export const DEMO_POCKET_KEYS = { wrong: "pk_demo_wrong", busy: "pk_demo_busy", slow: "pk_demo_slow", odd: "pk_demo_odd" } as const;

/** Invented recordings, one every day or so, so a 7-day count is a few. */
function recordings(nowMs: number) {
  const out: { id: string; title: string; recording_at: string; transcript: string }[] = [];
  for (let i = 0; i < 20; i++) {
    const at = new Date(nowMs - i * 30 * 3_600_000);
    out.push({ id: `rec-demo-${i + 1}`, title: `Invented recording ${i + 1}`, recording_at: at.toISOString(), transcript: "Invented words. FocusTime never reads them." });
  }
  return out;
}

export type PocketCall = { method: string; url: string; authorized: boolean };

/** The pretend Pocket's fetch. `calls` records each request it got (without the key), for tests. */
export function createDemoPocketFetch(o: { now: () => number; calls?: PocketCall[] }): typeof fetch {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization") ?? "";
    o.calls?.push({ method: init?.method ?? "GET", url, authorized: auth.startsWith("Bearer pk_") });
    const u = new URL(url);
    if (u.origin !== POCKET_ORIGIN || u.pathname !== POCKET_LIST_PATH) return json(404, { success: false, data: null, error: "Not found" });
    const key = auth.replace(/^Bearer /, "");
    if (!key.startsWith("pk_") || key === DEMO_POCKET_KEYS.wrong) return json(401, { success: false, data: null, error: "Invalid API key", error_code: "unauthorized" });
    if (key === DEMO_POCKET_KEYS.busy) return json(429, { success: false, data: null, error: "Too many requests", error_code: "rate_limited" });
    if (key === DEMO_POCKET_KEYS.slow)
      return new Promise<Response>((_, reject) => {
        const s = init?.signal;
        if (s?.aborted) return reject(s.reason);
        s?.addEventListener("abort", () => reject(s.reason), { once: true });
      });
    if (key === DEMO_POCKET_KEYS.odd) return json(200, { items: [], next: null });
    const from = u.searchParams.get("start_date");
    const to = u.searchParams.get("end_date");
    const all = recordings(o.now()).filter((r) => (!from || r.recording_at.slice(0, 10) >= from) && (!to || r.recording_at.slice(0, 10) <= to));
    const limit = Number(u.searchParams.get("limit") ?? 20);
    const page = Number(u.searchParams.get("page") ?? 1);
    const data = all.slice((page - 1) * limit, page * limit);
    return json(200, { success: true, data, pagination: { page, limit, total: all.length, total_pages: Math.ceil(all.length / limit), has_more: page * limit < all.length } });
  }) as typeof fetch;
}
