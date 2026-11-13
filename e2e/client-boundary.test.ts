// GD-2: the client boundary's main path in the demo that IB-4 keeps: Close the loop with a line naming Harbor shows the
// flag, and Replace writes "another client". (IB-4 took the held list and the conversation list out of the Inbox; the
// held-back rule and the tag are unit tests.) Demo mode, fictional clients.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

let h: Harness;
const T = 180_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: unknown; error?: string }>;
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(800);
};

describe.skipIf(!CHROMIUM)("GD-2: held back, sorted by hand, tagged and flagged", () => {
  beforeAll(async () => {
    h = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("Close the loop's flag with Replace", async () => {
    const { page, errors } = await freshPage(h);
    // IB-4: the held list left the Inbox (no list of messages); the GD-2 rules are unit tests. Close the loop's flag stays.
    const list = (await call(page, "inbox.list", {})).data as { items: { key: string; mentions?: string[] }[] };
    // Close the loop: flagged, then Replace writes "another client" and the flag is gone.
    const promise = list.items.find((x) => (x as { kind?: string }).kind === "promise" && (x as { clientKey?: string }).clientKey === "Northwind")!;
    await go(page, `#/inbox/item/${promise.key}/loop`);
    const text = page.locator(".send-loop textarea").first();
    await text.waitFor({ timeout: 20_000 });
    await text.fill("Same date filters we built for Harbor.");
    await page.locator(".send-loop button", { hasText: /^Preview/ }).first().click();
    const flag = page.locator(".send-loop .mention-flag");
    await flag.waitFor({ timeout: 20_000 });
    await flag.getByRole("button", { name: "Replace with “another client”" }).click();
    await page.locator(".sl-text", { hasText: "Same date filters we built for another client." }).waitFor({ timeout: 20_000 });
    expect(await flag.count()).toBe(0);
    expect(errors).toEqual([]);
  }, T);
});
