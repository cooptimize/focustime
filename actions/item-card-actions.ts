// FN-1: item.card, the story card's one read. A work item's title anywhere in FocusTime opens this card instead of
// DevOps. Read only: the item fresh from DevOps with the company read PAT (kept a minute per person in memory so
// reopening is instant; `fresh` reads again after a write), the HTML sanitized here so nothing from DevOps runs in the
// page, and FocusTime's own context (my to-dos and timeboxes on it, my promises about it). Only for a client the
// person can see (the clients they follow, are on, or write to); anything else answers "no access" and reads nothing.
import type { ActionResponse } from "./types.ts";
import type { AppConfig } from "../config/schema.ts";
import type { DevOpsSource } from "../sources/devops/source.ts";
import type { PlanStore } from "../store/plan-store.ts";
import type { CardRead, CardTodo, ItemCard } from "../plan/item-card.ts";
import { sanitizeMessageHtml } from "../plan/sanitize.ts";
import { pickNeed } from "../plan/types.ts";

export const ITEM_CARD_ACTIONS = ["item.card"] as const;
export type ItemCardAction = (typeof ITEM_CARD_ACTIONS)[number];

export type ItemCardContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  devops: (cfg: AppConfig) => Pick<DevOpsSource, "itemCard">;
  /** The clients this person can see: followed, on the client's team, or with a write PAT. */
  clients: (cfg: AppConfig) => Promise<{ clientKey: string; clientName: string }[]>;
  writeClients: () => Promise<string[]>;
  /** Whose cache entries these are: the session's person (their plan store), never shared between people. */
  scope: object;
  now: () => string;
};

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; read: CardRead }>();
const scopes = new WeakMap<object, number>();
let nextScope = 1;
const scopeId = (o: object) => scopes.get(o) ?? (scopes.set(o, nextScope++), scopes.get(o)!);
/** FN-1: a write from the card or Wrap it up makes the next read fresh for everyone's copy of that item. */
export function forgetCard(clientKey: string, itemId: number): void {
  for (const k of cache.keys()) if (k.endsWith(`\u0000${clientKey}\u0000${itemId}`)) cache.delete(k);
}

const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });
export const NO_ACCESS = "You don't have access to this client's work items in FocusTime";

/** DevOps' rich text as the card shows it: the sanitizer's allowlist (links only, no scripts, styles or images). */
export const cardHtml = (html: string) => sanitizeMessageHtml(html, { contentType: "html" });

export async function itemCardAction(ctx: ItemCardContext, action: ItemCardAction, input: unknown): Promise<ActionResponse> {
  if (action !== "item.card") return bad("unknown action");
  if (typeof input !== "object" || input === null || Array.isArray(input)) return bad("item.card takes { clientKey, itemId }");
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["clientKey", "itemId", "fresh"].includes(k)) return bad(`unknown input field ${k}`);
  if (typeof o.clientKey !== "string" || !o.clientKey.trim() || o.clientKey.length > 100) return bad("clientKey must be text");
  if (typeof o.itemId !== "number" || !Number.isSafeInteger(o.itemId) || o.itemId <= 0) return bad("itemId must be a work item id");
  if (o.fresh !== undefined && typeof o.fresh !== "boolean") return bad("fresh must be true or false");
  const clientKey = o.clientKey;
  const itemId = o.itemId;
  const cfg = await ctx.config();
  if (!cfg) return bad("Fix the config first", 409);
  // GD-2: only a client this person can see. Checked before any read, so a guessed address reads nothing.
  const [visible, writes] = await Promise.all([ctx.clients(cfg).catch(() => []), ctx.writeClients().catch(() => [] as string[])]);
  const ref = visible.find((c) => c.clientKey === clientKey);
  if (!ref && !writes.includes(clientKey)) return { ok: true, data: { access: false, message: NO_ACCESS } };
  const src = ctx.devops(cfg);
  if (!src.itemCard) return bad("Work item details aren't available here", 503);
  const key = `${scopeId(ctx.scope)}\u0000${clientKey}\u0000${itemId}`;
  const t = Date.parse(ctx.now());
  let hit = o.fresh ? undefined : cache.get(key);
  if (hit && t - hit.at > CACHE_MS) hit = undefined;
  let read: CardRead;
  let at: number;
  if (hit) ({ read, at } = hit);
  else {
    const r = await src.itemCard(clientKey, itemId);
    if (!r.ok) return bad(r.message, 502, "unreadable");
    read = r.value;
    at = t;
    cache.set(key, { at, read });
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
  }
  const todos = ctx.plan ? await todosOn(ctx.plan, clientKey, itemId, cfg, ctx.now()) : [];
  const promises = ctx.plan ? (await ctx.plan.openFollowUps()).filter((f) => f.clientKey === clientKey && f.itemId === itemId).map((f) => ({ key: `f${f.id}`, what: f.what, due: f.due, state: f.snoozedUntil ? "snoozed" : "open" })) : [];
  const canWrite = writes.includes(clientKey);
  const { descriptionHtml, acceptanceHtml, comments, ...rest } = read;
  const card: ItemCard = {
    ...rest,
    clientKey,
    clientName: ref?.clientName ?? cfg.clientSettings[clientKey]?.name ?? clientKey,
    description: cardHtml(descriptionHtml),
    acceptance: cardHtml(acceptanceHtml),
    comments: comments.map((c) => ({ id: c.id, author: c.author, at: c.at, html: cardHtml(c.text) })),
    todos,
    promises,
    canWrite,
    writeNote: canWrite ? null : `Turn on DevOps writes for ${ref?.clientName ?? clientKey} in Settings › DevOps to change it from here.`,
    readAt: new Date(at).toISOString(),
  };
  return { ok: true, data: { access: true, card } };
}

/** My to-dos on this item from four weeks back to four weeks ahead, newest first, with the timebox each has. */
async function todosOn(plan: PlanStore, clientKey: string, itemId: number, cfg: AppConfig, now: string): Promise<CardTodo[]> {
  const today = Date.parse(now);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const from = iso(today - 28 * 86_400_000);
  const to = iso(today + 28 * 86_400_000);
  const picks = (await plan.picksBetween(from, to)).filter((p) => p.clientKey === clientKey && p.itemId === itemId && p.status !== "dropped");
  if (!picks.length) return [];
  const boxes = await plan.timeboxesBetween(from, to);
  const hm = (s: string) => s.slice(11, 16).replace(/^0/, "");
  return picks
    .map((p) => {
      const b = boxes.find((x) => x.pickId === p.id && !x.removedAt);
      return { id: p.id, date: p.date, half: p.half, status: p.status, title: p.title, timebox: b ? `${hm(b.start)}–${hm(b.end)}` : null, leftMinutes: p.status === "done" ? 0 : pickNeed(p, cfg.plan.sizes) };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.half === "PM" ? 1 : -1));
}
