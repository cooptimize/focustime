// AI-0: Settings › AI's actions: the state (the switch, this month's spend against the cap, the last 20 requests) and
// Test AI (a fixed harmless request, client "none"). The switches and the cap are settings (settings.save, section
// "ai"). Later steps (AP-2, Draft stories) call aiFor(ctx).run(...) from their own actions; nothing here runs a task.
import type { Logger } from "../log/logger.ts";
import type { AiAppSettings, AiService, AppSpendStore } from "../ai/service.ts";
import { aiView } from "../ai/view.ts";
import type { AiProvider } from "../ai/types.ts";
import { fmtUsd } from "../ai/cost.ts";
import type { ActionResponse } from "./types.ts";

/** The app's AI runtime, handed in at startup (server/main.ts): settings, the provider (null: no key) and the app's spend. */
export type AiRuntime = { app: AiAppSettings; provider: () => Promise<AiProvider | null>; appSpend: AppSpendStore; logger?: Logger };

export const AI_ACTIONS = ["ai.status", "ai.test"] as const;
export type AiActionName = (typeof AI_ACTIONS)[number];

export async function aiAction(service: AiService | null, action: AiActionName): Promise<ActionResponse> {
  if (!service) return { ok: true, data: null };
  switch (action) {
    case "ai.status":
      return { ok: true, data: aiView(await service.status()) };
    case "ai.test": {
      const r = await service.test();
      // The answer itself is never shown or kept: only that it came back right, how long it took and what it cost.
      if (r.ok) return { ok: true, data: { ok: true, latencyMs: r.latencyMs, cost: fmtUsd(Math.round(r.costUsd * 1_000_000)), model: r.model } };
      return { ok: true, data: { ok: false, kind: r.error.kind, message: r.error.message } };
    }
  }
}
