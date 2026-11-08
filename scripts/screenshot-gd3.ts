// GD-3 screenshots on a throwaway demo server (fictional clients, its own temp folder and port): the held list with each
// message's reason and the matched word marked, the bulk actions and their confirm; at 1920 (Default and Larger text)
// and on a phone at 390 with iPhone-sized text, where it also checks nothing overflows and the page itself scrolls.
// Usage: node scripts/screenshot-gd3.ts <outDir>
import { mkdirSync } from "node:fs";
import { startDemo } from "../e2e/harness.ts";

const out = process.argv[2] ?? "docs/ux/gd3";
mkdirSync(out, { recursive: true });
const harness = await startDemo("chromium", {}, "2026-11-05T10:00:00-05:00");
const errors: string[] = [];
const runs = [
  { tag: "1920", size: "default", width: 1920, height: 1080, phone: false },
  { tag: "1920-larger", size: "larger", width: 1920, height: 1080, phone: false },
  { tag: "phone-390", size: "default", width: 390, height: 844, phone: true },
] as const;
try {
  for (const run of runs) {
    const ctx = await harness.browser.newContext({ viewport: { width: run.width, height: run.height }, colorScheme: "dark", reducedMotion: "reduce", ignoreHTTPSErrors: true, bypassCSP: true, ...(run.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await ctx.addInitScript(() => localStorage.setItem("focustime.hint.flow", "dismissed"));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${run.tag}: ${e.message}`));
    await page.goto(harness.url);
    await page.getByText(/Try the demo/).click({ timeout: 60_000 });
    await page.waitForSelector(".demo-tag", { timeout: 60_000 });
    await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
    await page.evaluate(async (size) => {
      const csrf = document.cookie.split(";").map((p) => p.trim().split("=")).find(([k]) => k === "__Host-focustime-csrf")?.slice(1).join("=") ?? "";
      await fetch("/api/action", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify({ action: "ui.set_text_size", input: { size } }) });
    }, run.size);
    await page.goto(`${harness.url.split("#")[0]}#/inbox/needs-you`);
    await page.reload();
    await page.waitForSelector(".topbar, .tabbar, .bottom-bar", { timeout: 30_000 }).catch(() => {});
    if (run.phone) await page.addStyleTag({ content: "html{font-size:17px}" });
    const toggle = page.locator(".held-toggle");
    await toggle.waitFor({ timeout: 30_000 });
    await toggle.click();
    await page.locator(".held-row").first().waitFor({ timeout: 20_000 });
    await page.locator(".held-back").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const shot = (name: string) => page.screenshot({ path: `${out}/${name}-${run.tag}.png` });
    await shot("held-list");
    await page.locator(".held-bulk").getByRole("button", { name: /^Sort all for/ }).click();
    await page.waitForTimeout(250);
    await shot("bulk-confirm");
    if (run.phone) {
      for (const px of [17, 21]) {
        await page.addStyleTag({ content: `html{font-size:${px}px}` });
        await page.waitForTimeout(200);
        const r = await page.evaluate(() => {
          const over = [...document.querySelectorAll(".held-back *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 || el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "visible" && el.tagName !== "SPAN");
          return { doc: document.documentElement.scrollWidth, win: window.innerWidth, over: over.map((e) => e.className || e.tagName).slice(0, 5) };
        });
        console.log(`phone ${px}px`, JSON.stringify(r));
        if (r.doc > r.win + 1) errors.push(`phone ${px}px: the page is ${r.doc} wide`);
        if (r.over.length) errors.push(`phone ${px}px: overflow ${r.over.join(", ")}`);
      }
    }
    await ctx.close();
  }
} finally {
  await harness.stop();
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("done");
process.exit(0);
