// PK-2: Settings › Accounts and calendars › Pocket recorder. A person connects their own Pocket with their own key:
// Check and save asks Pocket once for how many recordings it has from the last 7 days and keeps the key only when
// Pocket answers; Check again asks once more; Disconnect forgets the key at once. Each acts on the signed-in person's
// own secrets only (the port is built per person); there is no input naming anyone. The key goes in once and never
// comes back: no answer carries it, nor any error, log line or address. Only the count and when it was checked are
// kept (sealed beside the key) and shown; never a recording's title, date or words. Pocket is called only from
// pocket.connect and pocket.check, which run only on the person's press; pocket.status reads what is kept.
import type { ActionResponse } from "./types.ts";
import { keyProblem, POCKET_FAILURE_TEXT, PocketError, PocketKey, type PocketClient, type PocketFailure } from "../sources/pocket/client.ts";

export const POCKET_ACTIONS = ["pocket.status", "pocket.connect", "pocket.check", "pocket.disconnect"] as const;
export type PocketAction = (typeof POCKET_ACTIONS)[number];

/** The last check FocusTime kept: when, and how many recordings Pocket had from the 7 days before it. */
export type PocketCheck = { at: string; recordings: number };

/** One person's Pocket: their key and last check (their own sealed secrets), and the one client. */
export type PocketPort = {
  key: { get(): Promise<PocketKey | null>; set(value: string): Promise<void>; clear(): Promise<void>; has(): Promise<boolean> };
  check: { get(): Promise<PocketCheck | null>; set(c: PocketCheck): Promise<void>; clear(): Promise<void> };
  client: PocketClient;
  now: () => number;
};

/** What the browser gets: connected or not, and the last check. Never the key. */
export type PocketView = { connected: boolean; checkedAt: string | null; recordings: number | null };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });

async function view(p: PocketPort): Promise<PocketView> {
  if (!(await p.key.has())) return { connected: false, checkedAt: null, recordings: null };
  const c = await p.check.get().catch(() => null);
  return { connected: true, checkedAt: c?.at ?? null, recordings: c?.recordings ?? null };
}

/** A failed check, in its own words; the status Pocket's kind maps to for the browser. */
const failed = (e: unknown, saved: boolean): ActionResponse => {
  const kind: PocketFailure = e instanceof PocketError ? e.kind : "no_answer";
  const after = saved ? "Your connection is kept as it was." : "Nothing was saved.";
  return bad(`${POCKET_FAILURE_TEXT[kind]}. ${after}`, kind === "not_accepted" ? 422 : kind === "refused" ? 400 : 502, `pocket_${kind}`);
};

export async function pocketAction(port: PocketPort | undefined, action: PocketAction, input: unknown): Promise<ActionResponse> {
  if (!port) return bad("Pocket can't be connected here", 503);
  const o = input === undefined ? {} : input;
  if (!isObj(o)) return bad(`${action} takes an object`);
  const extra = Object.keys(o).find((k) => k !== (action === "pocket.connect" ? "key" : ""));
  if (extra) return bad(action === "pocket.connect" ? "pocket.connect takes { key }" : `${action} takes no input`);
  switch (action) {
    case "pocket.status":
      return { ok: true, data: await view(port) };
    case "pocket.connect": {
      const problem = keyProblem(o.key);
      if (problem) return bad(`${problem}. Nothing was saved.`, 400, "pocket_key_shape");
      const value = (o.key as string).trim();
      const candidate = new PocketKey(value);
      const at = port.now();
      let count;
      try {
        count = await port.client.countLastWeek(async () => candidate, at);
      } catch (e) {
        // A new key replaces the old one only after its own check passes: the old one is untouched here.
        return failed(e, false);
      }
      await port.key.set(value);
      await port.check.set({ at: new Date(at).toISOString(), recordings: count.recordings });
      return { ok: true, data: await view(port) };
    }
    case "pocket.check": {
      if (!(await port.key.has())) return bad("Pocket isn't connected. Paste a key and press Check and save", 409, "pocket_not_connected");
      const at = port.now();
      try {
        const count = await port.client.countLastWeek(async () => {
          const k = await port.key.get();
          if (!k) throw new PocketError("not_accepted", 0, POCKET_FAILURE_TEXT.not_accepted);
          return k;
        }, at);
        await port.check.set({ at: new Date(at).toISOString(), recordings: count.recordings });
      } catch (e) {
        return failed(e, true);
      }
      return { ok: true, data: await view(port) };
    }
    case "pocket.disconnect": {
      await port.key.clear();
      await port.check.clear();
      return { ok: true, data: await view(port) };
    }
  }
}

/** The port over one person's sealed secrets (server/main.ts per signed-in person, server/demo.ts for the demo). */
export function pocketPort(o: { secrets: { get(a: "pocket-key" | "pocket-check"): Promise<string>; set(a: "pocket-key" | "pocket-check", v: string): Promise<void>; delete(a: "pocket-key" | "pocket-check"): Promise<void>; has(a: "pocket-key" | "pocket-check"): Promise<boolean> }; client: PocketClient; now: () => number }): PocketPort {
  const s = o.secrets;
  return {
    key: {
      get: async () => ((await s.has("pocket-key")) ? new PocketKey(await s.get("pocket-key")) : null),
      set: (v) => s.set("pocket-key", v),
      clear: () => s.delete("pocket-key"),
      has: () => s.has("pocket-key"),
    },
    check: {
      get: async () => {
        if (!(await s.has("pocket-check"))) return null;
        const j = JSON.parse(await s.get("pocket-check")) as Partial<PocketCheck>;
        return typeof j.at === "string" && typeof j.recordings === "number" ? { at: j.at, recordings: j.recordings } : null;
      },
      set: (c) => s.set("pocket-check", JSON.stringify({ at: c.at, recordings: c.recordings })),
      clear: () => s.delete("pocket-check"),
    },
    client: o.client,
    now: o.now,
  };
}
