// AI-0: Settings › AI and Allow AI, the main path, in a real (not demo) session on fake sources. Settings › AI starts
// with Use AI off; switched on with no key it says AI isn't set up and Test AI says so; once a key is there (here the
// stub provider), Test AI shows OK with the time and cost, and the request shows in the last 20 with no text. Settings ›
// Clients has Allow AI per client, off by default. Edge cases are unit tests (ai/*.test.ts, store/ai.test.ts).
// Screenshots at 1920 and Text size Larger when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stubProvider } from "../ai/stub.ts";
import type { AiProvider } from "../ai/types.ts";
import { anAiApp } from "../test/builders/index.ts";
import { CHROMIUM, openSettings } from "./harness.ts";
import { liveBrowser, liveContext, T, type LiveBrowser } from "./live.ts";
import { shotBoth } from "./shots.ts";

describe.skipIf(!CHROMIUM)("AI settings", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("Use AI off, on with no key, Test AI ok with a key; Allow AI per client", async () => {
    let provider: AiProvider | null = null;
    const spend = new Map<string, number>();
    const ctx = await liveContext({
      extra: {
        ai: {
          app: anAiApp({ provider: "openai", model: "gpt-6-luna", prices: { inputPerMillion: 0.1, cachedInputPerMillion: 0.01, outputPerMillion: 0.5 } }),
          provider: async () => provider,
          appSpend: { get: async (m) => spend.get(m) ?? 0, add: async (m, n) => void spend.set(m, (spend.get(m) ?? 0) + n) },
        },
      },
    });
    const app = await lb.start(ctx);
    try {
      const page = await app.page();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      await page.goto(app.url);
      await page.locator(".topbar").waitFor();

      // Settings › AI: off by default; no key yet.
      await openSettings(page);
      await page.locator(".set-nav").getByRole("button", { name: "AI", exact: true }).click();
      const use = page.getByRole("switch", { name: "Use AI" });
      await use.waitFor();
      expect(await use.isChecked()).toBe(false);
      await page.getByText("AI isn't set up for this FocusTime yet").waitFor();
      await page.getByText("No AI requests yet.").waitFor();
      await shotBoth(page, "ai-off", page.locator(".set-ai"));

      // On, still no key: Test AI says why, in plain words.
      await use.click();
      await expect.poll(() => use.isChecked()).toBe(true);
      await page.getByRole("button", { name: "Test AI" }).click();
      await page.locator(".set-ai-test").getByText("AI isn't set up").waitFor();
      await shotBoth(page, "ai-no-key", page.locator(".set-ai"));

      // A key arrives (the stub stands in for OpenAI): Test AI is OK with its time and cost, and it's in the log.
      provider = stubProvider();
      await page.getByRole("button", { name: "Test AI" }).click();
      await page.locator(".set-ai-ok").getByText(/^OK · \d+\.\d s · /).waitFor();
      const row = page.locator(".set-ai-log tbody tr").first();
      await row.getByText("Test AI").waitFor();
      await row.getByText("None").waitFor();
      await row.getByText("OK", { exact: true }).waitFor();
      await expect(page.locator(".set-ai-month strong").textContent()).resolves.toMatch(/^(under \$0\.0001|\$0\.\d+) of \$10$/);
      expect(await page.locator(".set-ai").textContent()).not.toContain("Reply with ok");
      await shotBoth(page, "ai-test-ok", page.locator(".set-ai"));

      // Settings › Clients: Allow AI per client, off by default; it saves.
      await page.locator(".set-nav").getByRole("button", { name: "Clients" }).click();
      const adatum = page.locator(".set-client-wrap").filter({ has: page.getByRole("heading", { name: "Adatum" }) });
      const allow = adatum.getByRole("switch", { name: "Allow AI" });
      await allow.waitFor();
      expect(await allow.isChecked()).toBe(false);
      await allow.click();
      await expect.poll(() => allow.isChecked()).toBe(true);
      await expect.poll(async () => ((await ctx.loadConfig()).parsed.ok ? (await ctx.loadConfig()).parsed : null)).toMatchObject({ config: { ai: { use: true, allowedClients: ["Adatum"] } } });
      await shotBoth(page, "ai-allow-client", allow);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
