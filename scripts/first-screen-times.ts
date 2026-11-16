// PF-1: how long the app takes to open and to show each tab for the first time, measured in a browser on the demo.
// Each run is a new browser context with a demo session and an empty cache: the time from opening the app to the first
// screen being usable (the loader gone and Day drawn), then each other tab's key pressed in turn, at once, timed until
// that tab's screen is drawn. Twice: unslowed, and slowed to a mid-range phone on a slow connection (the processor four
// times slower; 1.6 Mbit/s down, 750 kbit/s up, 150 ms each way: Lighthouse's "slow 4G" profile). The middle value of
// the runs is reported. The demo server sends files uncompressed, so the slowed numbers follow the raw sizes.
//
//   FOCUSTIME_E2E_DIST=<a built dist> node scripts/first-screen-times.ts [--runs 10] [--json out.json]
import { writeFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { startDemo } from "../e2e/harness.ts";

const TABS = [
  ["Week", "2", "main.grid"],
  ["Backlog", "3", "main.ahead"],
  ["Status", "4", "main.status-view"],
  ["Inbox", "5", "main.ib4"],
  ["Code", "6", "main.code-page"],
] as const;
const SLOW = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const RUNS = Number(arg("--runs") ?? 10);
const middle = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2);
};

async function usable(page: Page): Promise<void> {
  await page.waitForSelector("main.today-view", { timeout: 120_000 });
  await page.waitForSelector(".brand-stage", { state: "detached", timeout: 120_000 });
}

if (!process.env.FOCUSTIME_E2E_DIST) throw new Error("Set FOCUSTIME_E2E_DIST to a built dist (npx vite build --outDir <dir>).");
const h = await startDemo();
const out: Record<string, Record<string, number[]>> = { unslowed: {}, slowed: {} };
try {
  for (const mode of ["unslowed", "slowed"] as const) {
    for (let run = 0; run < RUNS; run++) {
      const ctx = await h.browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(h.url);
      await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
      await usable(page);
      // The session stays; the files go, so the next load is a first visit's.
      const cdp = await ctx.newCDPSession(page);
      await page.goto("about:blank");
      await cdp.send("Network.enable");
      await cdp.send("Network.clearBrowserCache");
      if (mode === "slowed") {
        await cdp.send("Network.emulateNetworkConditions", SLOW);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      const add = (k: string, ms: number) => (out[mode]![k] ??= []).push(Math.round(ms));
      let t = performance.now();
      await page.goto(`${h.url}#/today`, { waitUntil: "commit" });
      await usable(page);
      add("First screen usable", performance.now() - t);
      for (const [name, key, sel] of TABS) {
        t = performance.now();
        await page.keyboard.press(key);
        await page.waitForSelector(sel, { timeout: 120_000 });
        add(name, performance.now() - t);
      }
      await ctx.close();
      process.stderr.write(`${mode} run ${run + 1}/${RUNS}\n`);
    }
  }
} finally {
  await h.stop();
}
const rows = Object.keys(out.unslowed!);
const table = ["| | Unslowed | Slowed |", "|---|---|---|", ...rows.map((k) => `| ${k} | ${middle(out.unslowed![k]!)} ms | ${middle(out.slowed![k]!)} ms |`)].join("\n");
process.stdout.write(table + "\n");
if (arg("--json")) writeFileSync(arg("--json")!, JSON.stringify(out, null, 1));
