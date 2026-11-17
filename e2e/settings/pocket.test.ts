// PK-2: Settings › Accounts and calendars › Pocket recorder, in demo mode, against the demo's pretend Pocket (any pk_
// key is accepted; pk_demo_wrong, pk_demo_busy, pk_demo_slow and pk_demo_odd act out Pocket's failures). The main path
// by keyboard: the guide, a key Pocket refuses (its words, nothing saved), a good key (connected, the count, the time),
// Check again, Disconnect asks first, then the guide again. Opening the section never asks Pocket; the key never
// comes back in an answer, the address or the browser's storage. At 390 by 844 nothing is clipped.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, NOW, startDemo, type Harness } from "../harness.ts";

const T = 240_000;
const GOOD = "pk_demo_teammate_key_0001";

async function open(page: Page) {
  await page.evaluate(() => (location.hash = "#/settings/connections/pocket"));
  const s = page.locator('[data-setting="pocket"]');
  await s.waitFor({ timeout: 30_000 });
  await s.scrollIntoViewIfNeeded();
  return s;
}

describe.skipIf(!CHROMIUM)("PK-2: Connect your Pocket", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("guide, a refused key, a good key, Check again, Disconnect; by keyboard; the key never comes back", async () => {
    const { page, errors } = await freshPage(h, { width: 1440, height: 900 });
    // The page's clock at the demo's, so "checked just now" reads as it will live.
    await page.clock.install({ time: Temporal.Instant.from(NOW).epochMilliseconds });
    const actions: string[] = [];
    const bodies: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/action")) actions.push(String((JSON.parse(r.postData() ?? "{}") as { action?: string }).action));
    });
    page.on("response", async (r) => {
      if (r.url().includes("/api/")) bodies.push(await r.text().catch(() => ""));
    });
    await page.goto(`${h.url}/`);
    await page.locator(".demo-tag").waitFor({ timeout: 30_000 });
    const s = await open(page);

    // Not connected: the sentence, the numbered steps with Pocket's own page, the field and one button.
    await expect(s.locator("h3").textContent()).resolves.toBe("Pocket recorder");
    await expect(s.locator(".pocket-steps li").count()).resolves.toBe(4);
    await expect(s.getByRole("link", { name: "Pocket's guide to API keys" }).getAttribute("href")).resolves.toBe("https://docs.heypocketai.com/docs/api");
    const field = s.getByLabel("Your Pocket key");
    await expect(field.getAttribute("type")).resolves.toBe("password");
    // Opening the section only read what FocusTime kept.
    expect(actions.filter((a) => a.startsWith("pocket.")).length).toBeGreaterThan(0);
    expect(actions.filter((a) => a.startsWith("pocket.") && a !== "pocket.status")).toEqual([]);

    // A key Pocket refuses: its words, nothing saved. By keyboard: type, Enter.
    await field.focus();
    await page.keyboard.type("pk_demo_wrong");
    await page.keyboard.press("Enter");
    const alert = s.getByRole("alert");
    await expect.poll(() => alert.textContent(), { timeout: 15_000 }).toMatch(/^Pocket didn't accept this key\..*Nothing was saved\.$/);
    await expect(s.getByLabel("Your Pocket key").count()).resolves.toBe(1);

    // A good key: connected, how many recordings from the last 7 days, and when.
    await field.fill(GOOD);
    await s.getByRole("button", { name: "Check and save" }).click();
    await expect.poll(() => s.locator(".pocket-state").textContent(), { timeout: 15_000 }).toMatch(/^Connectedchecked just now · \d+ recordings? in the last 7 days$/);
    await expect(s.getByLabel("Your Pocket key").count()).resolves.toBe(0);

    // Check again, from the keyboard.
    await s.getByRole("button", { name: "Check again" }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => s.getByRole("status").textContent(), { timeout: 15_000 }).toBe("Checked. Pocket answered.");

    // Disconnect asks first; Keep it keeps it.
    await s.getByRole("button", { name: "Disconnect" }).click();
    const ask = s.getByRole("group", { name: "Disconnect" });
    await expect(ask.textContent()).resolves.toMatch(/^Disconnect Pocket\? FocusTime forgets your key now\./);
    // The question's Disconnect has the focus, so Enter or Escape is one key away; Keep it is next.
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe("Disconnect");
    // One Disconnect on screen while it asks: the question's own.
    await expect(s.getByRole("button", { name: "Disconnect" }).count()).resolves.toBe(1);
    await ask.getByRole("button", { name: "Keep it" }).click();
    await expect(s.locator(".pocket-state").count()).resolves.toBe(1);
    await s.getByRole("button", { name: "Disconnect" }).click();
    await s.getByRole("group", { name: "Disconnect" }).getByRole("button", { name: "Disconnect" }).click();
    await expect.poll(() => s.getByRole("status").textContent(), { timeout: 15_000 }).toBe("Disconnected. FocusTime forgot your key.");
    await expect(s.locator(".pocket-steps li").count()).resolves.toBe(4);

    // Pocket was asked only on the presses: twice to connect (refused, then good) and once to check.
    expect(actions.filter((a) => a === "pocket.connect" || a === "pocket.check")).toEqual(["pocket.connect", "pocket.connect", "pocket.check"]);
    // The key never came back, and nothing of it is in the address or the browser's storage.
    expect(bodies.join("\n")).not.toContain(GOOD);
    expect(bodies.join("\n")).not.toContain("pk_demo_wrong");
    const kept = await page.evaluate(() => [location.href, JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie].join("\n"));
    expect(kept).not.toMatch(/pk_/);
    expect(errors).toEqual([]);
  }, T);

  it("at 390 by 844 nothing is clipped, guide or connected", async () => {
    const { page } = await freshPage(h, { width: 390, height: 844 });
    await page.goto(`${h.url}/`);
    await page.locator(".demo-tag").waitFor({ timeout: 30_000 });
    const s = await open(page);
    const fits = () =>
      s.evaluate((el) => {
        const w = document.documentElement.clientWidth;
        const over = [...el.querySelectorAll<HTMLElement>("*")].filter((x) => x.getBoundingClientRect().right > w + 0.5 || x.scrollWidth > x.clientWidth + 1).map((x) => x.className || x.tagName);
        return { pageScroll: document.documentElement.scrollWidth > w, over };
      });
    await expect(fits()).resolves.toEqual({ pageScroll: false, over: [] });
    await s.getByLabel("Your Pocket key").fill(GOOD);
    await s.getByRole("button", { name: "Check and save" }).click();
    await s.locator(".pocket-state").waitFor({ timeout: 15_000 });
    await s.getByRole("button", { name: "Use a new key" }).click();
    await expect(fits()).resolves.toEqual({ pageScroll: false, over: [] });
    await s.getByRole("button", { name: "Disconnect" }).click();
    await expect(fits()).resolves.toEqual({ pageScroll: false, over: [] });
    await s.getByRole("group", { name: "Disconnect" }).getByRole("button", { name: "Disconnect" }).click();
    await s.locator(".pocket-steps").waitFor({ timeout: 15_000 });
  }, T);
});
