// S1 (D451): first-run setup, the main path, in a real (not demo) session on fake sources. A new person sees Your day
// with the saved hours (Outlook isn't set up here: the fallback), signs out halfway and comes back to Your clients,
// tries a PAT DevOps refuses (a plain error, nothing saved), then their own (checked, never shown again), skips
// Standing blocks with Esc and Calendars with Enter, and lands on Done. Today then has one quiet line; it reopens the
// flow at the first step left. Edge cases are unit tests (plan/setup.test.ts, actions/setup-actions.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pat } from "../sources/devops/pat.ts";
import { WriteFailure } from "../sources/devops/write.ts";
import { CHROMIUM } from "./harness.ts";
import { liveBrowser, liveContext, T, type LiveBrowser } from "./live.ts";
import { shotBoth } from "./shots.ts";

const GOOD = "good-write-pat-0000";

describe.skipIf(!CHROMIUM)("first-run setup", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("a new person goes through the four screens, resumes after a reload, and Today keeps one line", async () => {
    const saved = new Map<string, string>();
    const ctx = await liveContext({
      setupDone: false,
      extra: {
        // The fake Dataverse's DevOps identity for Adatum is me@contoso.example on org "contoso".
        devopsWriter: {
          identity: async (_org: string, pat: Pat) => {
            if (pat.basicAuth() !== new Pat(GOOD).basicAuth()) throw new WriteFailure("auth", "not accepted", 401);
            return { id: "id-me", name: "Sam Tester", email: "me@contoso.example" };
          },
        } as never,
        writePats: { get: async (k) => new Pat(saved.get(k) ?? ""), set: async (k, v) => void saved.set(k, v), clear: async (k) => void saved.delete(k) },
      },
    });
    const app = await lb.start(ctx);
    try {
      const page = await app.page();
      // The whole suite runs in parallel: a slow first load under that load is not a failure.
      page.setDefaultTimeout(60_000);
      const shot = (name: string) => shotBoth(page, name);
      await page.goto(app.url);

      // 1. Your day: focus on the first field; Enter continues.
      const dialog = page.getByRole("dialog", { name: /^Setup/ });
      // HK-1: a key reaches a screen only once focus is in it. Between screens (and while the next one loads) focus sits
      // on the dialog box, where Enter does nothing; under load the heading shows before the screen takes focus, and a
      // key sent then was lost (the flow stayed on Calendars). Wait for the screen named `title` to hold focus.
      // The opening (a slow load) plays over the dialog and takes every key to skip itself, so it must be gone too: the
      // screen can hold focus underneath it (CI run 41993529746 lost the first Enter that way).
      const focusIn = async (title: string) => {
        await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
        await page.waitForFunction((t) => document.activeElement?.closest(".setup-screen")?.querySelector("h2")?.textContent === t, title);
      };
      await dialog.getByRole("heading", { name: "Your day" }).waitFor({ timeout: 60_000 });
      await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLSelectElement | null)?.value)).toBe("America/New_York");
      await dialog.getByText(/Outlook didn't share your working hours/).waitFor();
      await shot("setup-1-day");
      await focusIn("Your day");
      await page.keyboard.press("Enter");
      await dialog.getByRole("heading", { name: "Your clients" }).waitFor();

      // Signing out halfway (here: opening FocusTime again) resumes at the first step left.
      await page.reload();
      await dialog.getByRole("heading", { name: "Your clients" }).waitFor({ timeout: 60_000 });

      // 2. Your clients: a refused PAT says so and saves nothing; the person's own is checked and never shown again.
      const adatum = dialog.locator(".setup-client", { hasText: "Adatum" });
      await adatum.getByRole("button", { name: "Add DevOps write access" }).click();
      expect(await adatum.getByRole("link", { name: /Personal access tokens \(contoso\)/ }).getAttribute("href")).toBe("https://dev.azure.com/contoso/_usersSettings/tokens");
      await adatum.getByText("Work Items: Read & write").waitFor();
      const box = adatum.getByLabel(/DevOps write PAT for Adatum/);
      await box.fill("someone-elses-pat");
      await adatum.getByRole("button", { name: "Check and save" }).click();
      await adatum.getByRole("alert").getByText(/Nothing was saved/).waitFor();
      expect(saved.size).toBe(0);
      expect(await box.inputValue()).toBe("");
      await shot("setup-2-clients-error");
      await box.fill(GOOD);
      await adatum.getByRole("button", { name: "Check and save" }).click();
      await adatum.getByText("DevOps write access on, as Sam Tester").waitFor();
      expect(saved.get("adatum") ?? saved.get("Adatum")).toBe(GOOD);
      expect(await page.content()).not.toContain(GOOD);
      await shot("setup-2-clients");
      await dialog.getByRole("button", { name: "Continue" }).click();

      // 3. Standing blocks: optional; Esc skips.
      await dialog.getByRole("heading", { name: "Standing blocks" }).waitFor();
      await shot("setup-3-blocks");
      await focusIn("Standing blocks");
      await page.keyboard.press("Escape");

      // 4. Calendars: Skip is the default (Enter).
      await dialog.getByRole("heading", { name: "Calendars" }).waitFor();
      await shot("setup-4-calendars");
      await focusIn("Calendars");
      await page.keyboard.press("Enter");

      // Done: Plan your week, and the Guide.
      await dialog.getByRole("heading", { name: "You're set up" }).waitFor();
      await dialog.getByText("2 setup steps left").waitFor();
      await dialog.getByRole("link", { name: "Guide" }).waitFor();
      await shot("setup-5-done");
      await dialog.getByRole("button", { name: "Plan your week" }).click();
      await page.waitForURL(/#\/week\/commit/);

      // Today: one quiet line, which opens the flow at the first step left.
      await page.goto(`${app.url}#/today`);
      const line = page.locator(".setup-line").getByRole("button", { name: "2 setup steps left" });
      await line.waitFor({ timeout: 60_000 });
      expect(await dialog.count()).toBe(0);
      await shot("setup-today-line");
      await line.click();
      await dialog.getByRole("heading", { name: "Standing blocks" }).waitFor();
      await dialog.getByRole("button", { name: "Close" }).click();
      await line.waitFor();
      expect(await ctx.plan!.setupState()).toEqual({ day: "done", clients: "done", blocks: "skipped", calendars: "skipped" });
    } finally {
      await app.close();
    }
  }, T);
});
