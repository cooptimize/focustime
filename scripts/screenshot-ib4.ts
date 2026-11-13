// IB-4 screenshots on a throwaway demo server (fictional clients, its own temp folder and port), dark and light, at
// 1440×900 and on a phone at 390×844 with iPhone-sized text. "before" is the Inbox as IB-3 left it (Everything, Needs
// you, one conversation open, Promises, Captures and drafts); "after" is IB-4's three lists with their states, Day's
// chips and the phone. Each shot also writes how many rows it shows and how many controls the page has, to <out>/counts.json.
// Usage: node scripts/screenshot-ib4.ts <before|after> [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";

const mode = process.argv[2] === "after" ? "after" : "before";
const out = process.argv[3] ?? `docs/ux/ib4/${mode}`;
mkdirSync(out, { recursive: true });
const harness = await startDemo("chromium", {}, "2026-11-05T15:30:00-05:00");
const errors: string[] = [];
const counts: Record<string, { rows: number; controls: number }> = {};
const runs = [
  { tag: "1440-dark", width: 1440, height: 900, phone: false, scheme: "dark" },
  { tag: "1440-light", width: 1440, height: 900, phone: false, scheme: "light" },
  { tag: "phone-dark", width: 390, height: 844, phone: true, scheme: "dark" },
  { tag: "phone-light", width: 390, height: 844, phone: true, scheme: "light" },
] as const;

type Shot = { name: string; at: string; then?: (p: Page) => Promise<void> };
const BEFORE: Shot[] = [
  { name: "01-everything", at: "#/inbox" },
  { name: "02-needs-you", at: "#/inbox/needs-you" },
  { name: "03-conversation-open", at: "#/inbox/needs-you", then: async (p) => {
    await p.locator(".ib-row.kind-conversation, .ib-row").filter({ hasText: /Delivery fee/ }).first().click().catch(() => p.locator(".ib-row").first().click());
    await p.waitForTimeout(600);
  } },
  { name: "04-promises", at: "#/inbox/promises" },
  { name: "05-captures", at: "#/inbox/captures" },
];
const AFTER: Shot[] = [
  { name: "01-from-chats", at: "#/inbox/chats" },
  { name: "02-suggestion-open", at: "#/inbox/chats", then: async (p) => {
    await p.locator(".ib4-row").first().locator(".ib4-row-head").click();
    await p.locator(".ib4-row.open .conv-messages, .ib4-row.open .ib4-messages").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await p.waitForTimeout(500);
  } },
  { name: "03-promises", at: "#/inbox/promises" },
  { name: "04-promise-open", at: "#/inbox/promises", then: async (p) => {
    await p.locator(".ib4-row").first().locator(".ib4-row-head").click();
    await p.waitForTimeout(500);
  } },
  { name: "05-cleared", at: "#/inbox/promises", then: async (p) => {
    await p.locator(".ib4-cleared-toggle").first().click().catch(() => {});
    await p.waitForTimeout(500);
    await p.locator(".ib4-cleared").first().scrollIntoViewIfNeeded().catch(() => {});
  } },
  { name: "06-captures", at: "#/inbox/captures" },
  { name: "07-day-chips", at: "#/day" },
];

async function signIn(page: Page) {
  await page.goto(harness.url);
  await page.getByText(/Try the demo/).click({ timeout: 60_000 });
  await page.waitForSelector(".demo-tag", { timeout: 60_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 30_000 });
}

/** Rows a view shows and the page's controls (buttons, links, inputs, selects), as a person would count them. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const vis = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    };
    const main = document.querySelector("main.ib, main.ib4") ?? document.body;
    const rows = [...main.querySelectorAll(".ib-row, .ib4-row")].filter(vis).length;
    const controls = [...main.querySelectorAll("button, a[href], input, select, textarea")].filter(vis).length;
    return { rows, controls };
  });

try {
  for (const run of runs) {
    const ctx = await harness.browser.newContext({ viewport: { width: run.width, height: run.height }, colorScheme: run.scheme, reducedMotion: "reduce", ignoreHTTPSErrors: true, bypassCSP: true, ...(run.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await ctx.addInitScript(() => localStorage.setItem("focustime.hint.flow", "dismissed"));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => !/WebSocket/.test(e.message) && errors.push(`${run.tag}: ${e.message}`));
    await signIn(page);
    for (const s of mode === "before" ? BEFORE : AFTER) {
      await page.goto(`${harness.url.split("#")[0]}${s.at}`);
      await page.waitForSelector("main", { timeout: 30_000 });
      if (run.phone) await page.addStyleTag({ content: "html{font-size:17px}" });
      await page.waitForTimeout(1200);
      if (s.then) await s.then(page);
      await page.screenshot({ path: `${out}/${s.name}-${run.tag}.png` });
      counts[`${s.name}-${run.tag}`] = await measure(page);
    }
    if (run.phone && mode === "after") {
      // The largest text size on the phone: nothing wider than the screen, the page itself scrolls.
      for (const at of ["#/inbox/chats", "#/inbox/promises", "#/inbox/captures"]) {
        await page.goto(`${harness.url.split("#")[0]}${at}`);
        await page.addStyleTag({ content: "html{font-size:21px}" });
        await page.waitForTimeout(800);
        const r = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
        if (r.doc > r.win + 1) errors.push(`${run.tag} ${at} at 21px: the page is ${r.doc} wide`);
      }
      await page.screenshot({ path: `${out}/08-phone-larger-${run.tag}.png` });
    }
    await ctx.close();
  }
} finally {
  await harness.stop();
}
writeFileSync(`${out}/counts.json`, `${JSON.stringify(counts, null, 2)}\n`);
console.log(JSON.stringify(counts, null, 2));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("done");
process.exit(0);
