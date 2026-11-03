// Step 15.4: the signed-in person, my VM chip, the morning prompt, the chip's menu (D472: Start only; the
// auto-shutdown time is shown, never changed), Settings > You and the Inbox's kind chips, clicked in a real browser on
// demo data (a fictional person and VM, no Azure calls). Screenshots when FOCUSTIME_SHOTS is set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness, openSettings } from "./harness.ts";
import { shotBoth } from "./shots.ts";

let h: Harness;
const T = 90_000;

describe.skipIf(!CHROMIUM)("My VM and the sign-in (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  const today = async (page: import("playwright-core").Page) => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("1");
    await page.locator(".today-view").waitFor();
  };

  it("shows who is signed in and the VM chip; the morning prompt asks to start it, Not today hides it", async () => {
    const { page, errors } = await freshPage(h);
    await today(page);
    // Step 16.4: my photo (a generated avatar in demo mode) with my presence on its corner.
    await expect.poll(() => page.locator(".person-chip .avatar img").count(), { timeout: 10_000 }).toBe(1);
    await expect(page.locator(".person-chip").getAttribute("title")).resolves.toContain("Alex Rivera");
    const chip = page.locator(".topbar .vm-chip");
    await expect.poll(() => chip.textContent(), { timeout: 10_000 }).toContain("Stopped (deallocated)");
    // Step 16.3: the header chip is the one place for VM status; Today has only the prompts.
    await expect(page.locator(".today-view .vm-chip").count()).resolves.toBe(0);
    const prompt = page.locator(".att-chip.vm", { hasText: "VM is off" });
    await prompt.waitFor();
    await prompt.getByRole("button", { name: "Not today" }).click();
    await expect.poll(() => prompt.count(), { timeout: 5000 }).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Start from the prompt: Starting… then Running, logged in Settings > Data", async () => {
    const { page, errors } = await freshPage(h);
    await today(page);
    const prompt = page.locator(".att-chip.vm", { hasText: "VM is off" });
    await prompt.getByRole("button", { name: "Start" }).click();
    const chip = page.locator(".topbar .vm-chip");
    await expect.poll(() => chip.textContent(), { timeout: 10_000 }).toContain("Starting…");
    await expect.poll(() => chip.textContent(), { timeout: 45_000, interval: 1000 }).toContain("Running · off at 7:00 PM");
    await page.keyboard.press(",");
    await page.getByRole("button", { name: "Data", exact: true }).click();
    const log = page.locator('[aria-label="Azure write log"]');
    await expect.poll(() => log.textContent(), { timeout: 10_000 }).toMatch(/Started vm-demo-alex.*Confirmed/);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("D472: the chip shows the auto-shutdown time read only; its menu has no Stop, Delay, Skip tonight or Restore", async () => {
    const { page, errors } = await freshPage(h);
    const actions: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/action") && r.method() === "POST") actions.push(String((JSON.parse(r.postData() ?? "{}") as { action?: string; input?: unknown }).action) + JSON.stringify((JSON.parse(r.postData() ?? "{}") as { input?: unknown }).input ?? {}));
    });
    await today(page);
    const chip = page.locator(".topbar .vm-chip");
    await expect.poll(() => chip.textContent(), { timeout: 10_000 }).toContain("Stopped");
    // Stopped: Start is the only change on offer.
    await chip.click();
    const menu = page.locator('.menu-list[role="menu"]');
    await menu.waitFor();
    await expect(menu.getByRole("menuitem").allTextContents()).resolves.toEqual([expect.stringMatching(/^Start/), expect.stringMatching(/^Refresh/), expect.stringMatching(/^Choose another VM/)]);
    await menu.getByRole("menuitem", { name: /^Start/ }).click();
    const dlg = page.getByRole("dialog", { name: "Start your VM" });
    await expect(dlg.textContent()).resolves.toContain("FocusTime never changes your VM's auto-shutdown");
    await dlg.getByRole("button", { name: "Start" }).click();
    // Running: the auto-shutdown time from the schedule, read only.
    await expect.poll(() => chip.textContent(), { timeout: 45_000, interval: 1000 }).toContain("Running · off at 7:00 PM");
    await chip.click();
    await menu.waitFor();
    await expect(menu.getByRole("menuitem").allTextContents()).resolves.toEqual([expect.stringMatching(/^Refresh/), expect.stringMatching(/^Choose another VM/)]);
    for (const gone of [/Stop/, /Delay/, /Skip tonight/, /Restore/, /Auto-shutdown/]) await expect(menu.getByRole("menuitem", { name: gone }).count()).resolves.toBe(0);
    await shotBoth(page, "vm-chip-menu");
    await page.keyboard.press("Escape");
    // Nothing the window sent asked for anything but status, find or start.
    const other = actions.filter((a) => a.startsWith("vm.") && !/^vm\.(status|find|choose|dismiss_prompt|log|confirm)\{/.test(a) && !/^vm\.preview\{"op":"start"[,}]/.test(a));
    expect(other).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Settings > You: signed in, Find my VM by the Owner tag, the confirmed VM", async () => {
    const { page, errors } = await freshPage(h);
    await openSettings(page);
    const you = page.locator(".set-account");
    await expect(you.textContent()).resolves.toContain("Alex Rivera");
    await expect(you.getByRole("button", { name: "Sign out" }).count()).resolves.toBe(1);
    await you.getByRole("button", { name: "Find my VM" }).click();
    await expect.poll(() => you.locator(".vm-found").textContent(), { timeout: 10_000 }).toMatch(/Owner = “Alex Rivera”.*vm-demo-alex.*Your VM/);
    // A typed ID that isn't a VM is refused in plain words.
    await you.getByLabel("VM resource ID").fill("vm-demo-alex");
    await you.getByRole("button", { name: "Use this VM" }).click();
    await expect.poll(() => you.locator(".set-problem").textContent(), { timeout: 5000 }).toContain("isn't a VM resource ID");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("Inbox sorting uses the capture box's kind chips", async () => {
    const { page, errors } = await freshPage(h);
    await page.keyboard.press("4");
    await page.locator(".cap-item").first().getByRole("button", { name: "Sort" }).click();
    const sort = page.locator(".cap-sort").first();
    await sort.waitFor();
    await expect(sort.getByRole("radio").allTextContents()).resolves.toEqual(["Sort later", "Follow-up", "Draft story", "Draft feature"]);
    await sort.getByRole("radio", { name: "Follow-up" }).click();
    await expect(sort.getByRole("group", { name: "Follow-up details" }).count()).resolves.toBe(1);
    // "Ask Harbor about single sign-on…" has no name to owe it to: Who stays empty (Q84).
    await expect(sort.getByLabel("Who").inputValue()).resolves.toBe("");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("an ended session says You're signed out with Sign in again, never Session expired (A2)", async () => {
    const { page } = await freshPage(h);
    await today(page);
    // The session ends at the server (signed out in another window): the next call finds no session.
    await page.evaluate(() => fetch("/auth/logout", { method: "POST", headers: { "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" } }));
    await openSettings(page);
    const banner = page.locator(".stale-banner");
    await banner.waitFor({ timeout: 15_000 });
    await expect(banner.textContent()).resolves.toContain("You're signed out of FocusTime.");
    await expect(page.getByText(/session expired/i).count()).resolves.toBe(0);
    await expect(banner.getByRole("button", { name: "Sign in again" }).count()).resolves.toBe(1);
    await page.close();
  }, T);
});
