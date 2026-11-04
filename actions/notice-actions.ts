// P1: the in-app notification list (⋯ › Notifications, its unread dot and the toasts while the app is open) and Web
// Push per device (Settings › Notifications › Notify this device). The list holds what the notifier delivered, after
// its gate; nothing here makes a notice. Push subscriptions are sealed on the server and never returned: the UI sees a
// device's id, its coarse label and when it last got one.
import type { PlanStore } from "../store/plan-store.ts";
import { DEVICE_LABEL, NOTICES_KEPT, type NoticeList } from "../plan/push.ts";
import type { ActionResponse } from "./types.ts";

export const NOTICE_ACTIONS = ["notices.list", "notices.read", "push.status", "push.subscribe", "push.remove"] as const;
export type NoticeAction = (typeof NOTICE_ACTIONS)[number];

/** What the actions need of the server's push (server/push.ts' PushControl). */
export type PushPort = {
  status(): Promise<{ available: boolean; reason: string | null; publicKey: string | null; devices: { deviceId: string; label: string; createdAt: string; sentAt: string | null; failedAt: string | null }[] }>;
  subscribe(deviceId: string, label: string, sub: unknown): Promise<void>;
  remove(deviceId: string): Promise<boolean>;
};


const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
const obj = (input: unknown) => (typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null);
const keysOnly = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));

export async function noticeAction(ctx: { plan: PlanStore | undefined; push: PushPort | undefined; demo: boolean }, action: NoticeAction, input: unknown): Promise<ActionResponse> {
  const o = input === undefined ? {} : obj(input);
  if (!o) return bad("input must be an object");
  switch (action) {
    case "notices.list": {
      if (!keysOnly(o, [])) return bad("notices.list takes no input");
      const items = ctx.plan ? await ctx.plan.notices(NOTICES_KEPT) : [];
      return { ok: true, data: { items, unread: items.filter((n) => !n.read).length } satisfies NoticeList };
    }
    case "notices.read": {
      if (!keysOnly(o, ["ids"]) || (o.ids !== undefined && (!Array.isArray(o.ids) || o.ids.length > NOTICES_KEPT || !o.ids.every((i) => Number.isInteger(i) && (i as number) > 0)))) return bad("notices.read takes { ids? } (notice ids)");
      if (!ctx.plan) return bad("The plan store isn't available", 503);
      await ctx.plan.readNotices(o.ids as number[] | undefined);
      return { ok: true, data: { read: true } };
    }
    case "push.status": {
      if (!keysOnly(o, [])) return bad("push.status takes no input");
      if (!ctx.push) return { ok: true, data: { available: false, reason: ctx.demo ? "Push isn't part of the demo. In-app notifications still work." : "Push isn't available here. In-app notifications still work.", publicKey: null, devices: [] } };
      return { ok: true, data: await ctx.push.status() };
    }
    case "push.subscribe": {
      if (!keysOnly(o, ["deviceId", "label", "subscription"]) || typeof o.deviceId !== "string" || typeof o.label !== "string") return bad("push.subscribe takes { deviceId, label, subscription }");
      if (!ctx.push) return bad("Push isn't available here", 503);
      try {
        await ctx.push.subscribe(o.deviceId, DEVICE_LABEL.test(o.label) ? o.label : "Device", o.subscription);
      } catch (e) {
        return bad(e instanceof Error && e.name === "PushInputError" ? e.message : "This device couldn't be added");
      }
      return { ok: true, data: await ctx.push.status() };
    }
    case "push.remove": {
      if (!keysOnly(o, ["deviceId"]) || typeof o.deviceId !== "string") return bad("push.remove takes { deviceId }");
      if (!ctx.push) return bad("Push isn't available here", 503);
      try {
        await ctx.push.remove(o.deviceId);
      } catch {
        return bad("Not a device id");
      }
      return { ok: true, data: await ctx.push.status() };
    }
  }
}
