// PF-1: how long the app takes to open and to show each tab for the first time, measured in a browser on the demo.
// Each run is a new browser context with a demo session and an empty cache: the time from opening the app to the first
// screen being usable (the loader gone and Day drawn), then each other tab's key pressed in turn, at once, timed until
// that tab's screen is drawn. Twice: unslowed, and slowed to a mid-range phone on a slow connection (the processor four
// times slower; 1.6 Mbit/s down, 750 kbit/s up, 150 ms each way: Lighthouse's "slow 4G" profile). The middle value of
// the runs is reported. The demo server sends files uncompressed, so the slowed numbers follow the raw sizes.
//
// With --settled each tab is pressed only after the network has been quiet for two seconds, which is a person who
// looks at Day first: by then the other screens' files have been fetched in the background.
//
// PF-2: with --bytes each run also counts the bytes on the wire (what the browser received, headers included, as the
// protocol reports it), files and data apart, for the first screen and for each tab once its screen and data are in
// (the network idle), with the files fetched in the background after the first screen as a row of their own; the middle value of the unslowed runs is reported. It waits between tabs, so its times are not
// the ones above: take the times from a run without it.
//
//   FOCUSTIME_E2E_DIST=<a built dist> node scripts/first-screen-times.ts [--runs 10] [--settled] [--bytes] [--first-visit] [--json out.json]
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
const SETTLED = process.argv.includes("--settled");
const BYTES = process.argv.includes("--bytes");
/**
 * PF-2: a true first visit. Without it (as PF-1 ran), the service worker installed when the demo was opened answers the
 * timed load's files from its own cache, so the network (and whether the files are compressed) barely shows. With it
 * (and always with --bytes) the context blocks service workers, so every file comes from the server.
 */
const FIRST_VISIT = BYTES || process.argv.includes("--first-visit");

/** Resolves once no built file (/assets/) has been in flight for `quiet` ms (or after `most`); the app's own long-lived requests don't count. */
async function networkQuiet(page: Page, quiet = 2000, most = 90_000): Promise<void> {
  let open = 0;
  let last = Date.now();
  const file = (r: { url: () => string }) => r.url().includes("/assets/");
  const up = (r: { url: () => string }) => file(r) && (open++, (last = Date.now()));
  const down = (r: { url: () => string }) => file(r) && ((open = Math.max(0, open - 1)), (last = Date.now()));
  page.on("request", up);
  page.on("requestfinished", down);
  page.on("requestfailed", down);
  const start = Date.now();
  while (Date.now() - start < most && !(open === 0 && Date.now() - last >= quiet)) await new Promise((r) => setTimeout(r, 100));
  page.off("request", up);
  page.off("requestfinished", down);
  page.off("requestfailed", down);
}
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
/** PF-2: bytes on the wire per moment (first screen, each tab), files and data apart, unslowed runs only. */
const wire: Record<string, { files: number[]; data: number[] }> = {};
try {
  // With --bytes, only unslowed (the bytes are the same either way).
  for (const mode of BYTES ? (["unslowed"] as const) : (["unslowed", "slowed"] as const)) {
    for (let run = 0; run < RUNS; run++) {
      const ctx = await h.browser.newContext({ viewport: { width: 1440, height: 900 }, ...(FIRST_VISIT ? { serviceWorkers: "block" as const } : {}) });
      const page = await ctx.newPage();
      await page.goto(h.url);
      await page.getByRole("button", { name: /Try the demo/ }).click({ timeout: 60_000 });
      await usable(page);
      // The session stays; the files go, so the next load is a first visit's.
      const cdp = await ctx.newCDPSession(page);
      await page.goto("about:blank");
      await cdp.send("Network.enable");
      await cdp.send("Network.clearBrowserCache");
      // PF-2: what arrived, by request; counted into the moment it finished in.
      const urls = new Map<string, string>();
      let moment = { files: 0, data: 0 };
      cdp.on("Network.requestWillBeSent", (e) => urls.set(e.requestId, e.request.url));
      cdp.on("Network.loadingFinished", (e) => {
        const u = urls.get(e.requestId) ?? "";
        if (u.startsWith(new URL(h.url).origin + "/")) moment[u.includes("/api/") ? "data" : "files"] += e.encodedDataLength;
      });
      const took = (k: string) => {
        if (mode === "unslowed") ((wire[k] ??= { files: [], data: [] }).files.push(moment.files), wire[k]!.data.push(moment.data));
        moment = { files: 0, data: 0 };
      };
      if (mode === "slowed") {
        await cdp.send("Network.emulateNetworkConditions", SLOW);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      const add = (k: string, ms: number) => (out[mode]![k] ??= []).push(Math.round(ms));
      let t = performance.now();
      await page.goto(`${h.url}#/today`, { waitUntil: "commit" });
      await usable(page);
      add("First screen usable", performance.now() - t);
      if (BYTES) {
        // Then the other screens' files fetched in the background, counted on their own, so each tab's row is its own.
        took("First screen usable");
        await networkQuiet(page);
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
        took("Background, after the first screen");
      }
      if (SETTLED) await networkQuiet(page);
      moment = { files: 0, data: 0 };
      for (const [name, key, sel] of TABS) {
        t = performance.now();
        await page.keyboard.press(key);
        await page.waitForSelector(sel, { timeout: 120_000 });
        add(name, performance.now() - t);
        if (BYTES) {
          // The tab's own data arrives as it draws: count once the network is idle.
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
          took(name);
        }
      }
      await ctx.close();
      process.stderr.write(`${mode} run ${run + 1}/${RUNS}\n`);
    }
  }
} finally {
  await h.stop();
}
const rows = Object.keys(out.unslowed!);
const table = ["| | Unslowed | Slowed |", "|---|---|---|", ...rows.map((k) => `| ${k} | ${middle(out.unslowed![k]!)} ms | ${out.slowed![k] ? `${middle(out.slowed![k])} ms` : "-"} |`)].join("\n");
process.stdout.write(table + "\n");
const kb = (n: number) => `${(n / 1000).toFixed(1)} kB`;
const bytes = ["", "| Bytes on the wire (unslowed) | Files | Data |", "|---|---|---|", ...Object.keys(wire).map((k) => `| ${k} | ${kb(middle(wire[k]!.files))} | ${kb(middle(wire[k]!.data))} |`)].join("\n");
if (BYTES) process.stdout.write(bytes + "\n");
if (arg("--json")) writeFileSync(arg("--json")!, JSON.stringify({ ...out, wire }, null, 1));
