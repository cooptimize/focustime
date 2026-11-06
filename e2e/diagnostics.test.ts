// DX-1 (browser, demo mode): Settings › Data › Diagnostics. The command menu's "Diagnostics" opens it; Run checks
// shows the promises check and the chatter filter check for the demo person's own chats; Copy as text holds counts
// only. Screenshots of each panel at 1920 (light, dark, Larger text) and the phone when FOCUSTIME_SHOTS names a folder.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS } from "./shots.ts";

let h: Harness;
const T = 90_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function shots(page: Page) {
  if (!SHOTS) return;
  const panel = page.locator("#diagnostics");
  const settle = async () => {
    await page.reload();
    await panel.getByRole("button", { name: "Run checks" }).click();
    await panel.locator(".dx-counts").waitFor();
  };
  for (const theme of ["cooptimize-light", "cooptimize-dark"] as const) {
    await call(page, "ui.set_theme", { theme });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await settle();
    const tag = theme.replace("cooptimize-", "");
    await panel.screenshot({ path: `${SHOTS}/dx1-diagnostics-1920-${tag}.png` });
    // The phone: the rest of Data is read only there (P1); Diagnostics only reads, so it runs there too.
    await page.setViewportSize({ width: 390, height: 844 });
    await settle();
    await panel.screenshot({ path: `${SHOTS}/dx1-diagnostics-phone-${tag}.png` });
  }
  // Larger text, the way the app sets it (e2e/shots.ts).
  await page.setViewportSize({ width: 1920, height: 1080 });
  await settle();
  await page.evaluate(() => document.documentElement.setAttribute("data-text-size", "larger"));
  await page.waitForTimeout(200);
  await panel.screenshot({ path: `${SHOTS}/dx1-diagnostics-1920-dark-larger.png` });
  await page.evaluate(() => document.documentElement.removeAttribute("data-text-size"));
}

describe.skipIf(!CHROMIUM)("DX-1 Diagnostics (browser, demo mode)", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, 120_000);
  afterAll(async () => h?.stop());

  it("the command opens Settings › Data › Diagnostics; Run checks shows both checks; Copy as text is counts only", async () => {
    const { page, errors } = await freshPage(h);
    await page.evaluate(() => (location.hash = "#/today"));
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Diagnostics");
    await page.getByRole("menuitem", { name: "Diagnostics", exact: true }).click();
    const panel = page.locator("#diagnostics");
    await panel.waitFor();
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10_000 }).toBe("#/settings/data");
    await panel.getByRole("button", { name: "Run checks" }).click();
    await panel.getByRole("heading", { name: "Promises check" }).waitFor();
    await panel.getByRole("heading", { name: /Chatter filter check/ }).waitFor();
    await expect.poll(() => panel.getByRole("table", { name: "Messages by outcome per chat" }).locator("tbody tr").count(), { timeout: 10_000 }).toBeGreaterThan(0);
    // The copy text: counts, numbered chats, no chat or client names.
    const text = await panel.getByLabel("Diagnostics as text").inputValue();
    expect(text).toMatch(/^FocusTime diagnostics/);
    expect(text).toContain("Chat 1 (");
    const names = await panel.locator(".dx-table td .dx-client").allTextContents();
    for (const n of names) expect(text).not.toContain(n.trim());
    // The response has no message text: none of the demo's stored messages appear in it.
    const r = await call(page, "diagnostics.check", {});
    expect(r.ok).toBe(true);
    const shown = await call(page, "conversations.list", {});
    const sample: string[] = [];
    for (const c of [...(shown.data?.needsYou ?? []), ...(shown.data?.inProgress ?? [])].slice(0, 3)) {
      const m = await call(page, "conversations.messages", { id: c.id });
      for (const x of (m.data?.messages ?? []).slice(0, 3)) if (x.text && x.text.length > 20) sample.push(x.text);
    }
    expect(sample.length).toBeGreaterThan(0);
    const body = JSON.stringify(r.data);
    for (const t of sample) expect(body).not.toContain(t);
    await shots(page);
    expect(errors).toEqual([]);
    await page.close();
  }, T);
});
