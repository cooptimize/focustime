// AI-0, ADM-1: Settings › AI, the main path, in a real (not demo) session on fake sources. AI is an admin's decision:
// Settings › AI shows it read-only ("Set by your FocusTime admin"), off at first. With no key, Test AI says AI isn't set
// up; once a key is there (here the stub provider), Test AI shows OK with the time and cost, and the request shows in
// the last 20 with no text. When an admin turns AI on and allows a client, Settings shows it; Settings › Clients shows
// the client's AI line read-only. A $0 cap says "AI budget is set to $0". Edge cases are unit tests (ai/*.test.ts,
// store/ai.test.ts). Screenshots at 1920 and Text size Larger when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stubProvider } from "../ai/stub.ts";
import type { AiProvider } from "../ai/types.ts";
import { anAiApp } from "../test/builders/index.ts";
import { CHROMIUM, openSettings } from "./harness.ts";
import { liveBrowser, liveContext, liveTeam, T, type LiveBrowser } from "./live.ts";
import { shotBoth } from "./shots.ts";

describe.skipIf(!CHROMIUM)("AI settings", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("read-only AI rules; Test AI with AI off, with no key, then OK with a key; an admin's changes show; a $0 cap says so", async () => {
    let provider: AiProvider | null = null;
    const spend = new Map<string, number>();
    const team = liveTeam();
    const ctx = await liveContext({
      team,
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

      // Settings › AI: no switch of my own; AI for FocusTime is off, set by an admin; no key yet.
      await openSettings(page);
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "AI", exact: true }).click();
      const ai = page.locator(".set-ai");
      await ai.getByText("AI for FocusTime").waitFor();
      expect(await page.getByRole("switch", { name: "Use AI" }).count()).toBe(0);
      await ai.locator(".set-field", { hasText: "AI for FocusTime" }).getByText("Off", { exact: true }).waitFor();
      await ai.getByText("Set by your FocusTime admin").first().waitFor();
      await page.getByText("AI isn't set up for this FocusTime yet").waitFor();
      await page.getByText("No AI requests yet.").waitFor();
      await shotBoth(page, "ai-read-only", ai);

      // AI off for FocusTime: Test AI sends nothing and says who turns it on.
      await page.getByRole("button", { name: "Test AI" }).click();
      await page.locator(".set-ai-test").getByText("AI is off for FocusTime. A FocusTime admin turns it on in Admin › AI.").waitFor();

      // An admin turns AI on; no key yet: Test AI says why, in plain words.
      await team.set("org", "ai.on", true);
      await page.getByRole("button", { name: "Test AI" }).click();
      await page.locator(".set-ai-test").getByText("AI isn't set up").waitFor();

      // A key arrives (the stub stands in for OpenAI): Test AI is OK with its time and cost, and it's in the log.
      provider = stubProvider();
      await page.getByRole("button", { name: "Test AI" }).click();
      await page.locator(".set-ai-ok").getByText(/^OK · \d+\.\d s · /).waitFor();
      const row = page.locator(".set-ai-log tbody tr").first();
      await row.getByText("Test AI").waitFor();
      await row.getByText("OK", { exact: true }).waitFor();
      expect(await ai.textContent()).not.toContain("Reply with ok");

      // The admin allows Adatum: Settings › AI and Settings › Clients show it, read-only.
      await team.set("client:Adatum", "allow_ai", true);
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Clients" }).click();
      const adatum = page.locator(".set-client-wrap").filter({ has: page.getByRole("heading", { name: "Adatum" }) });
      await adatum.getByText("Allowed for Adatum").waitFor();
      expect(await adatum.getByRole("switch", { name: /Allow AI/ }).count()).toBe(0);
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "AI", exact: true }).click();
      await ai.locator(".set-field", { hasText: "AI for FocusTime" }).getByText("On", { exact: true }).waitFor();
      await ai.getByText("Adatum").first().waitFor();

      // A $0 cap: "AI budget is set to $0", never "reached".
      await team.set("org", "ai.person_cap_usd", 0);
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Clients" }).click();
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "AI", exact: true }).click();
      await ai.getByText("AI budget is set to $0").first().waitFor();
      expect(await ai.textContent()).not.toMatch(/reached/i);
      await shotBoth(page, "ai-budget-zero", ai);
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);
});
