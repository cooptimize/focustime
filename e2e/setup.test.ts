// S1 (D451): first-run setup, the main path, in a real (not demo) session on fake sources. A new person sees Your day
// with the saved hours (Outlook isn't set up here: the fallback), signs out halfway and comes back to Your clients,
// tries a PAT DevOps refuses (a plain error, nothing saved), then their own (checked, never shown again), skips
// Standing blocks with Esc and Calendars with Enter, and lands on Done. RF-1: having stepped through to the end, Day
// has no "steps left" line (after a reload too); Settings › Setup still says what's left and reopens the flow there. Edge cases are unit tests (plan/setup.test.ts, actions/setup-actions.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pat } from "../sources/devops/pat.ts";
import { WriteFailure } from "../sources/devops/write.ts";
import { CHROMIUM } from "./harness.ts";
import { IDENTITY_KEY, type MicrosoftAccount } from "../actions/account.ts";
import { createAzureClient } from "../sources/azure/client.ts";
import { fakeArm } from "../sources/azure/fake-arm.ts";
import { liveBrowser, liveContext, T, type LiveBrowser } from "./live.ts";
import { shotBoth } from "./shots.ts";

const GOOD = "good-write-pat-0000";
// VM-2: a fictional person and VM on the fake Azure Resource Manager, for setup's Your VM step.
const PERSON = { oid: "0f0f0f0f-4444-4222-8333-444455556666", tid: "t", name: "Sam Tester", username: "sam@contoso.example", email: "sam@contoso.example" };
const SUB = "00000000-0000-4000-8000-0000000000ad";
const VM_ID = `/subscriptions/${SUB}/resourceGroups/rg-e2e/providers/Microsoft.Compute/virtualMachines/vm-sam-e2e`;

describe.skipIf(!CHROMIUM)("first-run setup", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("a new person goes through the five screens, resumes after a reload, and Day has no line once through (RF-1)", async () => {
    const saved = new Map<string, string>();
    const arm = fakeArm({ now: () => Date.now(), transitionMs: 20_000 });
    arm.addVm({ id: VM_ID, name: "vm-sam-e2e", resourceGroup: "rg-e2e", subscriptionId: SUB, location: "eastus", tags: { Owner: PERSON.username }, power: "deallocated" }, { time: "1900" });
    const account: MicrosoftAccount = { signIn: async () => ({ status: "connected", identity: PERSON }), identity: async () => PERSON, armToken: async () => "FAKE-ARM", writeAccess: async () => ({ status: "read_only", message: "x" }), signOut: async () => {} };
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
        account: () => account,
        azure: (token) => createAzureClient({ fetch: arm.fetch, token, log: () => {} }),
      },
    });
    await ctx.plan!.setAccountState(IDENTITY_KEY, { ...PERSON, systemUserId: null });
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

      // 5. Your VM (VM-2): Find my VM finds it by its Owner tag; this is my VM; the same controls as Settings.
      await dialog.getByRole("heading", { name: "Your VM" }).waitFor();
      await focusIn("Your VM");
      await dialog.getByRole("button", { name: "Skip" }).waitFor();
      await dialog.getByRole("button", { name: "Find my VM" }).click();
      await dialog.getByText("vm-sam-e2e").waitFor();
      await dialog.getByRole("button", { name: "This is my VM" }).click();
      await dialog.getByText("Start without a preview").first().waitFor();
      await dialog.getByText("Start my VM before my day").first().waitFor();
      await shot("setup-5-vm");
      const vm2 = process.env.VM2_SHOTS;
      if (vm2) {
        // VM-2's own screenshots: 1440x900, light and dark (docs/ux/vm2).
        const size = page.viewportSize();
        await page.setViewportSize({ width: 1440, height: 900 });
        for (const theme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: theme });
          await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t === "light" ? "cooptimize-light" : "cooptimize-dark"), theme);
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${vm2}/setup-vm-${theme}.png` });
        }
        if (size) await page.setViewportSize(size);
      }
      await dialog.getByRole("button", { name: "Continue" }).click();

      // Done: Add work to your week (WD-2; was Plan your week), and the Guide.
      await dialog.getByRole("heading", { name: "You're set up" }).waitFor();
      await dialog.getByText("2 setup steps left").waitFor();
      await dialog.getByRole("link", { name: "Guide" }).waitFor();
      await shot("setup-6-done");
      await dialog.getByRole("button", { name: "Add work to your week" }).click();
      await page.waitForURL(/#\/week\/(commit|add|day)/);

      // RF-1: stepped through to the end (two steps skipped), so Day has no "steps left" line, after a reload too.
      await page.goto(`${app.url}#/day`);
      await page.reload();
      await page.locator(".today-view").waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
      expect(await page.locator(".setup-line").count()).toBe(0);
      expect(await dialog.count()).toBe(0);
      expect(await ctx.plan!.setupState()).toEqual({ day: "done", clients: "done", blocks: "skipped", calendars: "skipped", vm: "done" });
      // Settings › Setup still says what's left, and Finish setup opens the flow at the first step left.
      await page.evaluate(() => (location.hash = "#/settings/you"));
      await page.getByText("2 setup steps left.").waitFor({ timeout: 60_000 });
      await shot("setup-settings-left");
      await page.getByRole("button", { name: "Finish setup" }).click();
      await dialog.getByRole("heading", { name: "Standing blocks" }).waitFor();
    } finally {
      await app.close();
    }
  }, T);
});
