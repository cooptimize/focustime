// SA-2 (developer aid): pictures of Settings sections in the demo, for checking a redraw by eye.
//   node scripts/settings-peek.ts <out-folder> <size: desk|phone> <section>...
import { mkdirSync } from "node:fs";
import { devices } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";

const [out = "peek", size = "desk", ...ids] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const h = await startDemo("chromium");
try {
  const opts = size === "phone" ? { ...devices["iPhone 15"], viewport: { width: 390, height: 844 } } : { viewport: { width: 1440, height: 900 } };
  const ctx = await h.browser.newContext({ ...opts, colorScheme: "dark", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(h.url);
  await page.getByText(/Try the demo/).click({ timeout: 60_000 });
  await page.waitForSelector(".demo-tag", { timeout: 60_000 });
  const base = h.url.split("#")[0]!;
  for (const id of ids) {
    await page.goto(`${base}#/settings/${id}`);
    await page.reload();
    await page.locator(".ps-body").waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    const body = page.locator(".ps-body");
    const full = await body.evaluate((el) => el.scrollHeight);
    await page.setViewportSize({ width: opts.viewport.width, height: Math.min(6000, Math.max(opts.viewport.height, full + 200)) });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${id.replace(/\//g, "-")}-${size}.png`, fullPage: size === "phone" });
    await page.setViewportSize(opts.viewport);
    console.log(id);
  }
} finally {
  await h.stop();
}
