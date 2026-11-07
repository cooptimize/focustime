// LP-1: Close the loop sends the update. Demo mode (nothing leaves FocusTime: the demo's sender keeps posts and
// drafts in memory), clock pinned to Mon Nov 2, 9:30 AM. The main path: a promise found in a customer chat opens its
// draft, the preview lists who will see it (people outside Cooptimize by name), Send in Teams posts and reads back,
// the promise is kept with Undo. Then a promise on a DevOps item (Comment with a state change), an Outlook draft
// waiting for "I sent it", the fallback when Send now isn't approved, and Call. On the phone (390 and 360 px, a 17 px
// root font) nothing scrolls sideways, targets are 44 px and Send sits above the home indicator.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";
import { SHOTS, shotBoth } from "./shots.ts";

let h: Harness;
const T = 180_000;
const call = (page: Page, action: string, input: unknown) =>
  page.evaluate(([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()), [action, input] as const) as Promise<{ ok: boolean; data: any; error?: string }>;
const go = async (page: Page, hash: string) => {
  await page.evaluate((x) => (location.hash = x), hash);
  await page.waitForTimeout(600);
};
/** At 1920 and at Text size Larger, when FOCUSTIME_SHOTS names a folder. */
const shot = (page: Page, name: string, el?: Locator) => shotBoth(page, name, el);
const sideways = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement | null;
    const doc = document.scrollingElement!;
    return { container: el ? el.scrollWidth - el.clientWidth : -1, page: doc.scrollWidth - doc.clientWidth };
  }, sel);

/** Opens a promise's row in the Inbox (the row with every text given) and its Close the loop draft; returns the draft form. */
async function openDraft(page: Page, ...texts: string[]): Promise<Locator> {
  await go(page, "#/inbox/promises");
  let row = page.locator(".ib-row");
  for (const t of texts) row = row.filter({ hasText: t });
  await row.first().click();
  const pane = page.locator(".ib-pane");
  await pane.getByRole("button", { name: /^Close the loop/ }).first().click();
  const form = pane.locator("form.send-loop");
  await form.getByRole("radio", { name: /^Teams/ }).waitFor({ timeout: 20_000 });
  return form;
}

describe.skipIf(!CHROMIUM)("LP-1: Close the loop by Teams, Email, Comment or Call", () => {
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => {
    await h?.stop();
  }, T);

  it("posts in the customer chat after a preview that names the people outside Cooptimize, and keeps the promise with Undo", async () => {
    const { page, errors } = await freshPage(h);
    const form = await openDraft(page, "Send Marcus the updated export spec");
    // The recipient comes from Who; the text says what it was drafted from; Teams says where it goes.
    expect(await form.textContent()).toContain("Close the loop with Marcus Bell");
    expect(await form.locator(".sl-from").textContent()).toMatch(/^Drafted by AI from your promise and the conversation/);
    expect(await form.getByRole("radio", { name: /^Teams/ }).textContent()).toContain("Northwind Customer Collaboration");
    expect(await form.getByRole("checkbox", { name: "Mark this promise kept when it's sent" }).isChecked()).toBe(true);
    await shot(page, "lp1-draft", form);
    await form.locator("textarea").fill("Hi Marcus,\n\nThe updated export spec is in the project folder. The date filter is in.\n\nAlex");
    await form.getByRole("button", { name: "Preview" }).click();
    const pv = page.locator(".ib-pane section.send-loop");
    await pv.locator(".sl-line").waitFor();
    expect(await pv.locator(".sl-line").textContent()).toMatch(/^Northwind Customer Collaboration \(Cooptimize\), \d+ people, \d+ outside Cooptimize$/);
    expect(await pv.locator(".sl-outside").first().textContent()).toMatch(/^Outside Cooptimize: /);
    expect(await pv.textContent()).toContain("can't be undone");
    await shot(page, "lp1-preview-outside", pv);
    await pv.getByRole("button", { name: "Send in Teams" }).click();
    const done = page.locator(".ib-pane section.send-loop .sl-result");
    await done.waitFor();
    expect(await done.textContent()).toContain("Posted in Northwind Customer Collaboration");
    await page.locator(".ib-pane section.send-loop").getByRole("link", { name: /Open in Teams/ }).waitFor();
    await shot(page, "lp1-sent", page.locator(".ib-pane section.send-loop"));
    // Kept, with Undo; the log has the send.
    const sends = (await call(page, "loop.sends", { key: "c1" })).data.sends;
    expect(sends[0]).toMatchObject({ channel: "teams", mode: "post", state: "sent", kept: true });
    expect(sends[0].outsideCount).toBeGreaterThan(0);
    await page.locator(".ib-pane").getByRole("button", { name: "Undo promise kept" }).click();
    await expect.poll(async () => (await call(page, "loop.sends", { key: "c1" })).data.sends[0].kept, { timeout: 10_000 }).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("a promise on a DevOps item: Comment with a state change through the write framework", async () => {
    const { page, errors } = await freshPage(h);
    expect((await call(page, "followup.add", { clientKey: "Northwind", who: "Priya Shah", what: "Tell Priya the CSV export is ready to test", channel: "teams", itemId: 1111 })).ok).toBe(true);
    const form = await openDraft(page, "Tell Priya the CSV export is ready to test");
    await form.getByRole("radio", { name: /^Comment/ }).click();
    await form.locator(".sl-state select").selectOption("Resolved");
    await form.getByRole("button", { name: "Preview" }).click();
    const pv = page.locator(".ib-pane section.send-loop");
    await pv.getByRole("button", { name: "Post comment" }).waitFor();
    expect(await pv.textContent()).toMatch(/State: Active → Resolved/);
    await pv.getByRole("button", { name: "Post comment" }).click();
    const result = page.locator(".ib-pane section.send-loop .sl-result");
    await result.waitFor();
    expect(await result.textContent()).toContain("#1111");
    expect(await page.locator(".ib-pane .sl-parts").textContent()).toContain("Resolved");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("email: an Outlook draft stays open with I sent it; Send now without approval falls back to Outlook prefilled and Mark sent", async () => {
    const { page, errors } = await freshPage(h);
    let form = await openDraft(page, "Confirm the intake form go-live date", "Lena Ortiz");
    await form.getByRole("radio", { name: /^Email/ }).click();
    expect(await form.getByRole("radio", { name: "Create Outlook draft" }).isChecked()).toBe(true);
    await form.getByRole("button", { name: "Preview" }).click();
    let pv = page.locator(".ib-pane section.send-loop");
    await pv.getByRole("button", { name: "Create Outlook draft" }).click();
    const result = page.locator(".ib-pane section.send-loop .sl-result");
    await result.waitFor();
    expect(await result.textContent()).toContain("Draft saved in Outlook");
    expect(await page.locator(".ib-pane section.send-loop").getByRole("button", { name: "I sent it" }).isVisible()).toBe(true);
    await shot(page, "lp1-outlook-draft", page.locator(".ib-pane section.send-loop"));
    // The draft waits: reopening shows it with I sent it, and the promise is still open.
    await page.locator(".ib-pane section.send-loop").getByRole("button", { name: "Done", exact: true }).click();
    form = await openDraft(page, "Confirm the intake form go-live date", "Lena Ortiz");
    expect(await form.locator(".sl-waiting").getByRole("button", { name: "I sent it" }).isVisible()).toBe(true);
    // Send now isn't approved in the demo: the fallback.
    await form.getByRole("radio", { name: /^Email/ }).click();
    await form.getByRole("radio", { name: "Send now" }).check();
    await form.getByRole("button", { name: "Preview" }).click();
    pv = page.locator(".ib-pane section.send-loop");
    await pv.locator(".sl-fallback").waitFor();
    expect(await pv.locator(".sl-fallback").textContent()).toContain("needs an admin to approve access");
    expect(await pv.getByRole("link", { name: "Open in Outlook" }).getAttribute("href")).toMatch(/^https:\/\/outlook\.office\.com\/mail\/deeplink\/compose\?/);
    expect(await pv.getByRole("button", { name: /^Send/ }).count()).toBe(0);
    await shot(page, "lp1-fallback", pv);
    await pv.getByRole("button", { name: "Mark sent" }).click();
    await page.locator(".ib-pane section.send-loop .sl-result").waitFor();
    expect(await page.locator(".ib-pane section.send-loop .sl-result").textContent()).toContain("Marked sent");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  it("call: a Teams call link and a note that closes the loop", async () => {
    const { page, errors } = await freshPage(h);
    const form = await openDraft(page, "Reply about the proposal timeline");
    await form.getByRole("radio", { name: /^Call/ }).click();
    await form.locator("textarea").fill("Talked it through; the timeline holds.");
    await form.getByRole("button", { name: "Preview" }).click();
    const pv = page.locator(".ib-pane section.send-loop");
    await pv.getByRole("button", { name: "Save call note" }).waitFor();
    expect(await pv.getByRole("link", { name: "Call in Teams" }).getAttribute("href")).toMatch(/^https:\/\/teams\.microsoft\.com\/l\/call\/0\/0\?users=/);
    await shot(page, "lp1-call", pv);
    await pv.getByRole("button", { name: "Save call note" }).click();
    await page.locator(".ib-pane section.send-loop .sl-result").waitFor();
    expect(await page.locator(".ib-pane section.send-loop .sl-result").textContent()).toContain("Called Jordan Lee");
    expect(errors).toEqual([]);
    await page.close();
  }, T);

  for (const width of [390, 360]) {
    it(`on the phone at ${width} px: no sideways scroll, 44 px targets, Send above the home indicator`, async () => {
      const page = await h.browser.newPage({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true, bypassCSP: true });
      await page.addInitScript(() => {
        localStorage.setItem("focustime.hint.flow", "dismissed");
        document.addEventListener("DOMContentLoaded", () => {
          const st = document.createElement("style");
          st.textContent = "html{font-size:17px}";
          document.head.append(st);
        });
      });
      await page.goto(h.url);
      await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await page.locator(".urgent-strip").waitFor({ timeout: 20_000 });
      await go(page, "#/inbox/promises");
      await page.locator(".ib-row", { hasText: "Send Marcus the updated export spec" }).first().click();
      const sheet = page.locator(".ib-sheet.tall");
      await sheet.getByRole("button", { name: /^Close the loop/ }).first().click();
      const form = sheet.locator("form.send-loop");
      await form.getByRole("radio", { name: /^Teams/ }).waitFor({ timeout: 20_000 });
      expect(await sideways(page, ".ib-sheet.tall")).toEqual({ container: 0, page: 0 });
      for (const r of await form.getByRole("radio").all()) expect((await r.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if (SHOTS && width === 390) await page.screenshot({ path: `${SHOTS}/lp1-phone-draft.png` });
      await form.getByRole("button", { name: "Preview" }).click();
      const pv = sheet.locator("section.send-loop");
      const send = pv.getByRole("button", { name: "Send in Teams" });
      await send.waitFor();
      expect(await sideways(page, ".ib-sheet.tall")).toEqual({ container: 0, page: 0 });
      const box = (await send.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      // Visible inside the viewport without scrolling past the bottom edge (the sticky row keeps it there).
      expect(box.y + box.height).toBeLessThanOrEqual(780);
      if (SHOTS && width === 390) await page.screenshot({ path: `${SHOTS}/lp1-phone-preview.png` });
      await send.click();
      await sheet.locator("section.send-loop .sl-result").waitFor();
      expect(await sideways(page, ".ib-sheet.tall")).toEqual({ container: 0, page: 0 });
      if (SHOTS && width === 390) await page.screenshot({ path: `${SHOTS}/lp1-phone-sent.png` });
      await page.close();
    }, T);
  }
});
