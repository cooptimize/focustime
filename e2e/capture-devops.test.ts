// CP-1 Capture to DevOps, the main path in a real (not demo) session on fake sources, a fake DevOps (read and write)
// and a fake AI provider behind the real ai/ service: the box (Shift+Enter, ↵, Enter), the Saved toast naming the
// client with Undo, the chip staying put after a save, a leftover @word never moving a capture, the AI version in the
// background ("Ready to create" in the Drafts list), Create in DevOps going straight to the write framework's preview
// naming the client, then the create; and Ctrl+Enter opening the New form with the AI version offered (QC-1). Edge cases are
// unit tests (actions/draft-prepare.test.ts, store/capture-undo.test.ts, actions/devops-write.test.ts, plan/ and ui/).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { IDENTITY_KEY } from "../actions/account.ts";
import { stubProvider } from "../ai/stub.ts";
import { Pat } from "../sources/devops/pat.ts";
import { basic, fakeDevOpsWrite, WRITE_PAT } from "../sources/devops/write-fakes.ts";
import { createDevOpsWriter } from "../sources/devops/write.ts";
import { anAiApp } from "../test/builders/index.ts";
import { CHROMIUM, openCaptures } from "./harness.ts";
import { appReady, liveBrowser, liveContext, liveTeam, ME, T, type LiveBrowser } from "./live.ts";
import { shotBoth, SHOTS } from "./shots.ts";

const HOME = "72f988bf-0000-4000-8000-000000000001";
const api = <R = unknown>(page: Page, action: string, input: unknown) =>
  page.evaluate(
    ([a, i]) => fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": document.cookie.match(/__Host-focustime-csrf=([^;]+)/)?.[1] ?? "" }, body: JSON.stringify({ action: a, input: i }) }).then((r) => r.json()),
    [action, input] as const,
  ) as Promise<{ ok: boolean; data: R; error?: string }>;
const box = (page: Page) => page.locator(".ib-capture .cap-box textarea[aria-label='Quick capture']");
type Draft = { id: number; title: string; clientKey: string; parentItemId: number | null; ai?: { state: string; title: string | null; parentId: number | null } | null; devopsId?: number };
const drafts = async (page: Page) => (await api<{ drafts: Draft[] }>(page, "capture.load", {})).data.drafts;

/** The fake model: a tidy title, the first offered type and parent. */
function answer(inputText: string): string {
  const input = JSON.parse(inputText) as { note: string; offered_types: string[]; offered_parents: { id: number }[] };
  return JSON.stringify({
    title: `Export invoices as CSV (${input.note.length})`,
    description: "Finance needs the invoice list in a spreadsheet each month.",
    acceptance_criteria: "- A CSV button on the invoice list\n- The file has every visible column",
    type: input.offered_types[0] ?? null,
    parent_id: input.offered_parents[0]?.id ?? null,
    parent_reason: "It belongs with the export work",
  });
}

describe.skipIf(!CHROMIUM)("Capture to DevOps (CP-1)", () => {
  let lb: LiveBrowser;
  beforeAll(async () => {
    lb = await liveBrowser();
  }, T);
  afterAll(async () => {
    await lb?.close();
  }, T);

  it("capture, Undo, the AI version in the background, the straight preview, the New form, and the create", async () => {
    const dv = fakeDevOpsWrite({ org: "contoso", identities: { [basic(WRITE_PAT)]: { id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example" } } });
    const pats = new Map([["Adatum", WRITE_PAT]]);
    let prepares = 0;
    const team = liveTeam();
    await team.set("org", "ai.on", true);
    await team.set("client:Adatum", "allow_ai", true);
    const ctx = await liveContext({
      team,
      extra: {
        devopsWriter: createDevOpsWriter({ fetch: dv.fetch, log: () => {} }),
        writePats: { get: async (k) => new Pat(pats.get(k) ?? ""), set: async (k, v) => void pats.set(k, v), clear: async (k) => void pats.delete(k) },
        ai: { app: anAiApp(), provider: async () => stubProvider({ respond: (c) => (c.schemaName === "capture_prepare" && prepares++, answer(c.input)) }), appSpend: { get: async () => 0, add: async () => {} } },
      },
    });
    await ctx.plan!.setAccountState(IDENTITY_KEY, { oid: ME, tid: HOME, name: "Sam Tester", username: "me@contoso.example", email: "me@contoso.example", signedInAt: "2026-11-02T14:00:00Z", systemUserId: null, systemUserEmail: null });
    await ctx.plan!.setDevopsIdentity({ clientKey: "Adatum", org: "contoso", id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "me@contoso.example", expires: null });
    const app = await lb.start(ctx);
    try {
      const page = await app.page();
      page.setDefaultTimeout(60_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(e.message));
      await page.goto(app.url);
      await appReady(page);
      await openCaptures(page);
      await box(page).waitFor();

      // The chip is the client: choose Adatum.
      await page.locator(".ib-capture .cap-box .cap-client").click();
      await page.locator(".cap-choose .chip-btn", { hasText: "Adatum" }).click();
      const chip = page.locator(".ib-capture .cap-box .cap-client");
      await expect(chip.textContent()).resolves.toContain("Adatum");

      // Shift+Enter is a new line; Enter saves; the toast names the client, with Undo.
      await box(page).fill("story: invoice export for finance");
      await box(page).press("Shift+Enter");
      await box(page).pressSequentially("as csv");
      await expect(box(page).inputValue()).resolves.toBe("story: invoice export for finance\nas csv");
      await page.locator(".ib-capture .cap-box .cap-kinds [role=radio]", { hasText: "Draft story" }).click();
      await box(page).press("Enter");
      const toast = page.locator(".ib-capture .cap-toast");
      await expect.poll(() => toast.textContent()).toMatch(/^Saved to Adatum as a draft story·Undo$/);
      await expect.poll(async () => (await drafts(page)).length).toBe(1);
      // Undo: the draft goes and my text comes back.
      await toast.getByRole("button", { name: "Undo" }).click();
      await expect.poll(async () => (await drafts(page)).length).toBe(0);
      await expect(box(page).inputValue()).resolves.toBe("story: invoice export for finance\nas csv");
      // Saved again with the ↵ button; the chip stays Adatum after the save.
      await page.locator(".ib-capture .cap-box .cap-kinds [role=radio]", { hasText: "Draft story" }).click();
      await page.locator(".ib-capture .cap-box .cap-send").click();
      await expect.poll(() => toast.textContent()).toContain("Saved to Adatum");
      await expect(chip.textContent()).resolves.toContain("Adatum");
      await expect(box(page).inputValue()).resolves.toBe("");

      // The AI version arrives in the background; the list keeps my title and says what it needs.
      await expect.poll(async () => (await drafts(page))[0]?.ai?.state, { timeout: 30_000 }).toBe("ready");
      const d = (await drafts(page))[0]!;
      expect(d).toMatchObject({ clientKey: "Adatum", title: "Invoice export for finance as csv" });
      // IB-1: the draft is a row in Captures and drafts; its pane says what it needs.
      const row = page.locator(".ib-row", { hasText: "Invoice export for finance" }).first();
      await row.click();
      await expect.poll(() => page.locator(".ib-pane .dw-draft-state").textContent()).toBe("Ready to create");
      await expect(row.locator(".ib-row-title").textContent()).resolves.toContain("Invoice export for finance");
      await shotBoth(page, "cp1-capture-toast-drafts", page.locator(".ib-capture .cap-box"));

      // UI-7, IB-1: the pane's ⋯ has Prepare again (one more request) and Delete.
      const before = prepares;
      const pane = page.locator(".ib-pane");
      await pane.getByRole("button", { name: /^More for/ }).click();
      await expect(pane.getByRole("menuitem", { name: "Delete draft" }).count()).resolves.toBe(1);
      await pane.getByRole("menuitem", { name: "Prepare again" }).click();
      await expect.poll(() => prepares).toBe(before + 1);
      await expect.poll(() => pane.locator(".dw-draft-state").textContent(), { timeout: 30_000 }).toBe("Ready to create");

      // A leftover @word that names no client never moves a capture: the chip decides.
      await page.locator(".ib-capture .cap-box .cap-kinds [role=radio]", { hasText: "Draft story" }).click();
      await box(page).fill("story: tidy @nobody headers");
      await page.locator(".ib-capture .cap-box .cap-kinds [role=radio]", { hasText: "Draft story" }).click();
      await box(page).press("Enter");
      await expect.poll(async () => (await drafts(page)).find((x) => x.title.includes("@nobody"))?.clientKey).toBe("Adatum");

      // The parent DevOps will check, as the fake read side offers it.
      dv.add(d.ai!.parentId!, { "System.WorkItemType": "Feature", "System.Title": "Feature I own", "System.State": "Active", "System.AssignedTo": { uniqueName: "me@contoso.example" } });

      // QC-1: Create in DevOps on a draft's row goes straight to the write framework's preview, in my own words.
      await row.click();
      await page.locator(".ib-pane").getByRole("button", { name: "Create in DevOps" }).click();
      const preview = page.getByRole("dialog", { name: "Create a DevOps item" });
      await preview.waitFor();
      await expect(preview.locator(".dw-client").textContent()).resolves.toContain("Creating in Adatum's DevOps");
      await expect(preview.locator(".wd-where").textContent()).resolves.toContain("DevOps · Adatum · contoso");
      await expect(preview.textContent()).resolves.toContain("Invoice export for finance as csv");
      expect(dv.writes().filter((w) => w.method === "POST")).toEqual([]);
      await shotBoth(page, "cp1-write-preview", preview);
      await preview.getByRole("button", { name: "Create in DevOps" }).click();
      await expect.poll(() => dv.writes().filter((w) => w.method === "POST").length).toBe(1);
      await expect.poll(async () => (await drafts(page)).some((x) => x.id === d.id)).toBe(false);

      // Ctrl+Enter: saves and opens the New form; the AI version is offered under More once it lands, never required.
      await page.locator(".ib-capture .cap-box .cap-kinds [role=radio]", { hasText: "Draft story" }).click();
      await box(page).fill("story: retry failed syncs");
      await page.locator(".ib-capture .cap-box .cap-kinds [role=radio]", { hasText: "Draft story" }).click();
      await box(page).press("Control+Enter");
      const form = page.getByRole("dialog", { name: /^New in .*DevOps$/ });
      await form.waitFor();
      await expect.poll(() => form.locator("#nf-title").inputValue()).toBe("Retry failed syncs");
      await form.getByRole("button", { name: /More: description and size/ }).click();
      const useAi = form.getByRole("button", { name: "Use the AI version" });
      await expect.poll(() => useAi.count(), { timeout: 30_000 }).toBe(1);
      await useAi.click();
      await expect(form.locator("#nf-title").inputValue()).resolves.toMatch(/^Export invoices as CSV/);
      await shotBoth(page, "cp1-new-form-ai", form);
      await form.locator("#nf-title").fill("Export the invoice list as CSV");
      await form.locator("#nf-title").press("Enter");
      const second = page.getByRole("dialog", { name: "Create a DevOps item" });
      await second.waitFor();
      await expect(second.textContent()).resolves.toContain("Export the invoice list as CSV");
      expect(dv.writes().filter((w) => w.method === "POST")).toHaveLength(1);
      await second.getByRole("button", { name: "Create in DevOps" }).click();
      await expect.poll(() => dv.writes().filter((w) => w.method === "POST").length).toBe(2);

      if (SHOTS) {
        // The phone (390 wide, a 17px root font as on iPhone): the capture sheet with ↵ and the toast, the preview stacked.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => void (document.documentElement.style.fontSize = "17px"));
        await page.locator(".phone-capture").click();
        const sheet = page.locator(".cap-dialog .cap-box");
        await sheet.waitFor();
        await page.locator(".cap-dialog .cap-kinds [role=radio]", { hasText: "Draft story" }).click();
        await sheet.locator("textarea").fill("story: phone capture with a longer line that wraps onto the next one");
        await page.screenshot({ path: `${SHOTS}/cp1-phone-capture.png` });
        await sheet.locator(".cap-send").click();
        await page.locator(".cap-dialog .cap-toast").waitFor();
        await page.screenshot({ path: `${SHOTS}/cp1-phone-toast.png` });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.keyboard.press("Escape");
        await page.locator(".dw-drafts-section .cap-item").first().getByRole("button", { name: "Create in DevOps" }).click();
        const ph = page.getByRole("dialog", { name: "Create a DevOps item" });
        await ph.waitFor();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${SHOTS}/cp1-phone-preview.png` });
        await ph.evaluate((el) => el.scrollTo(0, el.scrollHeight));
        await page.screenshot({ path: `${SHOTS}/cp1-phone-preview-end.png` });
        expect(await ph.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  }, T);

});
