// AS-1: the assistant's registry actions, for the panel (assistant.ask, confirm, cancel, history, clear) and its three
// reads as actions of their own (assistant.today, lookup.day, items.get). Input is checked here; the work is the service's.
import type { ActionName } from "../actions/registry.ts";
import type { ActionResponse } from "../actions/types.ts";
import { dayRead, itemRead, todayRead, type ReadDeps } from "./reads.ts";
import type { AssistantService } from "./service.ts";
import { MAX_TEXT, type AssistantContext } from "./types.ts";

export const ASSISTANT_ACTIONS = ["assistant.ask", "assistant.confirm", "assistant.cancel", "assistant.history", "assistant.clear", "assistant.today", "lookup.day", "items.get"] as const satisfies readonly ActionName[];
export type AssistantAction = (typeof ASSISTANT_ACTIONS)[number];

const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const only = (v: unknown, keys: string[]): Record<string, unknown> | null => (isObj(v) && Object.keys(v).every((k) => keys.includes(k)) ? v : v === undefined || v === null ? {} : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 2 ** 31;

/** The screen as the panel sends it; anything unknown or malformed is left out. */
export function contextOf(v: unknown): AssistantContext {
  if (!isObj(v)) return {};
  const out: AssistantContext = {};
  if (typeof v.screen === "string") out.screen = v.screen.slice(0, 80);
  if (typeof v.clientKey === "string" && v.clientKey.length <= 100) out.clientKey = v.clientKey;
  if (posInt(v.itemId)) out.itemId = v.itemId;
  if (isObj(v.block) && typeof v.block.date === "string" && DATE.test(v.block.date) && (v.block.half === "AM" || v.block.half === "PM")) out.block = { date: v.block.date, half: v.block.half };
  if (typeof v.date === "string" && DATE.test(v.date)) out.date = v.date;
  return out;
}

export async function assistantAction(svc: () => Promise<AssistantService | null>, reads: () => Promise<ReadDeps | null>, action: AssistantAction, input: unknown): Promise<ActionResponse> {
  if (action === "assistant.today" || action === "lookup.day" || action === "items.get") {
    const d = await reads();
    if (!d) return bad("The assistant isn't available here", 503);
    const o = only(input, ["when", "date", "id", "clientKey"]);
    if (!o) return bad(`${action} takes ${action === "assistant.today" ? "{ when? }" : action === "lookup.day" ? "{ date, clientKey? }" : "{ id }"}`);
    const client = typeof o.clientKey === "string" && d.isMine(o.clientKey) ? o.clientKey : null;
    if (action === "assistant.today") {
      const when = o.when === undefined ? "today" : o.when;
      if (when !== "now" && when !== "today" && when !== "tonight") return bad("when is now, today or tonight");
      const r = await todayRead(d, when, client);
      return r.error ? bad(r.error, 409) : { ok: true, data: { cards: r.cards } };
    }
    if (action === "lookup.day") {
      if (typeof o.date !== "string" || !DATE.test(o.date)) return bad("lookup.day takes { date: YYYY-MM-DD, clientKey? }");
      const r = await dayRead(d, o.date, client);
      return r.error ? bad(r.error, 409) : { ok: true, data: { cards: r.cards } };
    }
    if (!posInt(o.id)) return bad("items.get takes { id }");
    const r = await itemRead(d, o.id, client);
    return r.error ? bad(r.error, 404) : { ok: true, data: { cards: r.cards } };
  }
  const s = await svc();
  if (!s) return bad("The assistant isn't available here", 503);
  switch (action) {
    case "assistant.ask": {
      const o = only(input, ["text", "context"]);
      if (!o || typeof o.text !== "string" || o.text.length > MAX_TEXT) return bad(`assistant.ask takes { text (up to ${MAX_TEXT} characters), context? }`);
      return { ok: true, data: await s.handle(o.text, contextOf(o.context)) };
    }
    case "assistant.confirm": {
      const o = only(input, ["proposalId", "edits"]);
      if (!o || !posInt(o.proposalId) || (o.edits !== undefined && (!isObj(o.edits) || Object.values(o.edits).some((v) => typeof v !== "string" || v.length > 8000)))) return bad("assistant.confirm takes { proposalId, edits? }");
      return { ok: true, data: await s.confirm(o.proposalId, (o.edits as Record<string, string> | undefined) ?? {}) };
    }
    case "assistant.cancel": {
      const o = only(input, ["proposalId"]);
      if (!o || !posInt(o.proposalId)) return bad("assistant.cancel takes { proposalId }");
      return { ok: true, data: await s.cancel(o.proposalId) };
    }
    case "assistant.history": {
      const o = only(input, ["limit"]);
      if (!o || (o.limit !== undefined && !posInt(o.limit))) return bad("assistant.history takes { limit? }");
      return { ok: true, data: { turns: await s.history(typeof o.limit === "number" ? Math.min(o.limit, 200) : 50) } };
    }
    case "assistant.clear": {
      const o = only(input, ["confirm"]);
      if (!o || o.confirm !== true) return bad("assistant.clear takes { confirm: true }");
      return { ok: true, data: await s.clear() };
    }
  }
}
