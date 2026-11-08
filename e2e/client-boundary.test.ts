// GD-2: the client boundary's main path in the demo. Inbox › Needs you shows "1 message held back"; opening it lists
// the message from Northwind's customer chat with "mentions Harbor"; Sort for Northwind by hand puts it in a conversation
// (no AI) and the list empties. The delivery team conversation that names Harbor shows its tag. Close the loop with a
// line naming Harbor shows the flag, and Replace writes "another client". Demo mode, fictional clients.
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

  it("held list, Sort by hand, the tag, and Close the loop's flag with Replace", async () => {
    const { page, errors } = await freshPage(h);
    await go(page, "#/inbox/needs-you");
    await page.locator(".held-toggle").click({ timeout: 30_000 });
    const row = page.locator(".held-row").first();
    await row.waitFor();
    expect(await row.locator(".mention-tag").textContent()).toBe("Mentions Harbor");
    expect(await row.locator("mark.held-match").first().textContent()).toBe("Harbor");
    expect(await page.locator(".held-why").textContent()).toContain("Held back: mentions another client in a chat with people outside Cooptimize.");
    await row.getByRole("button", { name: "Sort for Northwind by hand" }).click();
    await row.locator("select").selectOption({ label: "A new conversation" });
    await row.getByRole("button", { name: "Sort here" }).click();
    // GD-3: the bulk action asks first, with the count, then the list is empty.
    await page.locator(".held-bulk").getByRole("button", { name: "Mark all not work-related" }).click({ timeout: 20_000 });
    await page.locator(".held-bulk-ask").getByText("Mark 1 message for Northwind not work-related?").waitFor();
    await page.locator(".held-bulk").getByRole("button", { name: "Mark 1 message" }).click();
    await page.locator(".held-list").getByText("Nothing held back now.").waitFor({ timeout: 20_000 });

    // The internal conversation's tag, in the list and the detail pane.
    const list = (await call(page, "inbox.list", {})).data as { items: { key: string; mentions?: string[] }[] };
    const tagged = list.items.find((x) => x.mentions?.includes("Harbor"))!;
    await go(page, `#/inbox/item/${tagged.key}`);
    await page.locator(".ib-detail .mention-tag", { hasText: "mentions Harbor" }).waitFor({ timeout: 20_000 });

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
