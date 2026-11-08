// GD-2 screenshots on a throwaway demo server (e2e/harness.ts: fictional clients, its own temp folder and port, the
// clock pinned to Thursday Nov 5, 2026 10:00 AM ET): the held-back list, a sorted internal conversation with its
// "mentions Harbor" tag, an AI draft with "Another client's name was removed", Close the loop's preview with the flag,
// and a DevOps write preview with the flag; at 1920 (Default and Larger text), dark and light.
// Usage: node scripts/screenshot-gd2.ts <outDir>
import { mkdirSync } from "node:fs";
import type { Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";

const out = process.argv[2] ?? "docs/ux/gd2";
const only = process.argv[3] ?? null;
mkdirSync(out, { recursive: true });
const harness = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");

const act = <T = unknown>(page: Page, action: string, input: Record<string, unknown> = {}) =>
  page.evaluate(
    async ([action, input]) => {
      const csrf = document.cookie.split(";").map((p) => p.trim().split("=")).find(([k]) => k === "__Host-focustime-csrf")?.slice(1).join("=") ?? "";
      const r = await fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ action, input }) });
      const body = (await r.json()) as { ok: boolean; data?: unknown; error?: string };
      if (!body.ok) throw new Error(`${action}: ${body.error}`);
      return body.data;
    },
    [action, input] as const,
  ) as Promise<T>;

const errors: string[] = [];
const runs = [
  { tag: "1920", size: "default" },
  { tag: "1920-larger", size: "larger" },
] as const;
try {
  for (const run of runs) {
    for (const scheme of ["dark", "light"] as const) {
      const ctx = await harness.browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: scheme, reducedMotion: "reduce", ignoreHTTPSErrors: true });
      await ctx.addInitScript(() => localStorage.setItem("focustime.hint.flow", "dismissed"));
      const page = await ctx.newPage();
      page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${run.tag} ${scheme}: ${e.message}`));
      await page.goto(harness.url);
      await page.getByText(/Try the demo/).click({ timeout: 60_000 });
      await page.waitForSelector(".demo-tag", { timeout: 60_000 });
      await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
      await act(page, "ui.set_theme", { theme: scheme === "dark" ? "cooptimize-dark" : "cooptimize-light" });
      await act(page, "ui.set_text_size", { size: run.size });
      const base = harness.url.split("#")[0]!;
      const go = async (hash: string) => {
        await page.goto(`${base}${hash}`);
        await page.reload();
        await page.waitForSelector(".topbar", { timeout: 30_000 });
        await page.waitForTimeout(900);
      };
      const shot = (name: string) => page.screenshot({ path: `${out}/gd2-${name}-${run.tag}-${scheme}.png` });
      const step = async (name: string, f: () => Promise<void>) => {
        if (only && only !== name) return;
        try {
          await f();
        } catch (e) {
          await page.screenshot({ path: `${out}/gd2-FAILED-${name}-${run.tag}-${scheme}.png` });
          throw e;
        }
      };

      // 1. The held-back list, from Inbox › Needs you.
      await step("held", async () => {
        await go("#/inbox/needs-you");
        const toggle = page.locator(".held-toggle");
        await toggle.waitFor({ timeout: 30_000 });
        await toggle.click();
        await page.locator(".held-row").first().waitFor();
        await page.locator(".held-back").scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await shot("held-list");
        await page.locator(".held-row button", { hasText: "Sort for" }).first().click();
        await page.waitForTimeout(300);
        await shot("held-sort");
      });

      // 2. The internal conversation with its tag, in the list and the detail pane.
      await step("tag", async () => {
        const list = await act<{ items: { key: string; title: string; mentions?: string[] }[] }>(page, "inbox.list", {});
        const it = list.items.find((x) => x.mentions?.length);
        if (!it) throw new Error("no conversation with a mentions tag");
        await go(`#/inbox/item/${it.key}`);
        await page.locator(".ib-detail .mention-tag").first().waitFor();
        await shot("mentions-tag");
      });

      // 3. An AI draft with the notice, and a typed line with the flag (Week › Status).
      await step("status", async () => {
        await go("#/week/status");
        const nw = page.locator("section.st-client[aria-label=Northwind]");
        const draft = nw.locator("button", { hasText: /^Draft all/ });
        await draft.waitFor({ timeout: 30_000 });
        await draft.click();
        await nw.locator(".names-removed, .st-suggested").first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(600);
        await nw.scrollIntoViewIfNeeded();
        await shot("ai-draft-notice");
        const box = nw.locator(".st-suggested textarea").first();
        await box.fill("Same approach as Harbor's intake form, so the paging is done.");
        await page.locator(".st-box .mention-flag").first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(300);
        await shot("status-line-flag");
        const push = page.locator("button", { hasText: /^Push/ }).first();
        await push.click();
        await page.locator(".st-push-client .mention-flag").first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(300);
        await shot("devops-preview-flag");
        await page.keyboard.press("Escape");
      });

      // 4. Close the loop's preview with the flag.
      await step("loop", async () => {
        const list = await act<{ items: { key: string; kind: string; title: string; clientKey: string | null }[] }>(page, "inbox.list", {});
        const p = list.items.find((x) => x.kind === "promise" && x.clientKey === "Northwind");
        if (!p) throw new Error("no Northwind promise");
        await go(`#/inbox/item/${p.key}/loop`);
        const text = page.locator(".send-loop textarea").first();
        await text.waitFor({ timeout: 30_000 });
        await text.fill("Hi Marcus, the spec is attached. It uses the same date filters we built for Harbor.");
        await page.locator(".send-loop button[type=submit], .send-loop button", { hasText: /^Preview/ }).first().click();
        await page.locator(".send-loop .mention-flag").waitFor({ timeout: 30_000 });
        await page.waitForTimeout(300);
        await shot("loop-preview-flag");
      });
      await ctx.close();
    }
  }
} finally {
  await harness.stop();
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`screenshots in ${out}`);
