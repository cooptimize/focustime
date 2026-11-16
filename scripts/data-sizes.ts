// PF-2: every data read the app makes on the demo, by action, with its typical and largest size and how it went over
// the wire (its encoding, or plain). A browser opens the demo and visits each place in turn (each tab and its modes,
// the Inbox's views, a story card, Code's tree, a kind list and a file, Settings, the Guide and the Technical docs),
// and every /api/action answer is counted by the action it named. Sizes are the answer's body as sent (what the
// browser received, before decoding) and decoded; nothing of any answer is printed.
//
//   FOCUSTIME_E2E_DIST=<a built dist> node scripts/data-sizes.ts [--json out.json]
import { writeFileSync } from "node:fs";
import { CHROMIUM, freshPage, startDemo } from "../e2e/harness.ts";

if (!process.env.FOCUSTIME_E2E_DIST) throw new Error("Set FOCUSTIME_E2E_DIST to a built dist (npx vite build --outDir <dir>).");
if (!CHROMIUM) throw new Error("No Chromium here.");
const REPO = "a1b2c3d4-0001-4000-8000-00000000a001";
const PLACES = [
  "#/today",
  "#/week",
  "#/week/commit",
  "#/week/team",
  "#/week/status",
  "#/backlog",
  "#/ahead/gantt",
  "#/ahead/fix",
  "#/ahead/backlog",
  "#/status",
  "#/inbox",
  "#/inbox/promises",
  "#/inbox/captures",
  "#/inbox/done",
  "#/item/Cooptimize/4411",
  "#/code",
  "#/code/Northwind",
  `#/code/Northwind/${REPO}/`,
  "#/code/Northwind/kinds",
  `#/code/Northwind/${REPO}/${encodeURIComponent("/README.md")}`,
  `#/code/Northwind/${REPO}/${encodeURIComponent("/adf/pipeline/pl_copy_shipments.json")}`,
  "#/settings",
  "#/guide",
  "#/docs",
];

const h = await startDemo();
const seen = new Map<string, { wire: number[]; decoded: number[]; enc: Set<string> }>();
try {
  const { page } = await freshPage(h, { width: 1440, height: 900 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const pending = new Map<string, string>();
  cdp.on("Network.requestWillBeSent", (e) => {
    if (!e.request.url.endsWith("/api/action") || !e.request.postData) return;
    try {
      const name = (JSON.parse(e.request.postData) as { action?: unknown }).action;
      if (typeof name === "string") pending.set(e.requestId, name);
    } catch {
      /* not JSON */
    }
  });
  const enc = new Map<string, string>();
  cdp.on("Network.responseReceived", (e) => enc.set(e.requestId, String(e.response.headers["content-encoding"] ?? e.response.headers["Content-Encoding"] ?? "plain")));
  cdp.on("Network.loadingFinished", (e) => {
    const name = pending.get(e.requestId);
    if (!name) return;
    void cdp
      .send("Network.getResponseBody", { requestId: e.requestId })
      .then((b) => {
        const s = seen.get(name) ?? { wire: [], decoded: [], enc: new Set<string>() };
        s.wire.push(e.encodedDataLength);
        s.decoded.push(b.base64Encoded ? Buffer.from(b.body, "base64").length : Buffer.byteLength(b.body));
        s.enc.add(enc.get(e.requestId) ?? "plain");
        seen.set(name, s);
      })
      .catch(() => undefined);
  });
  // The page's first reads (the week) happen as it opens: open it again with the counting on.
  await page.reload();
  await page.waitForSelector("main.today-view", { timeout: 60_000 });
  for (const place of PLACES) {
    await page.evaluate((p) => (location.hash = p), place);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
  await page.close();
} finally {
  await h.stop();
}
const middle = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)]!;
const kb = (n: number) => `${(n / 1000).toFixed(1)} kB`;
const rows = [...seen].sort((a, b) => Math.max(...b[1].decoded) - Math.max(...a[1].decoded));
const table = [
  "| Action | Calls | Typical | Largest | Largest on the wire | Sent as |",
  "|---|---|---|---|---|---|",
  ...rows.map(([n, s]) => `| \`${n}\` | ${s.decoded.length} | ${kb(middle(s.decoded))} | ${kb(Math.max(...s.decoded))} | ${kb(Math.max(...s.wire))} | ${[...s.enc].join(", ")} |`),
].join("\n");
process.stdout.write(table + "\n");
const out = process.argv.indexOf("--json");
if (out > 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(Object.fromEntries(seen), (_k, v: unknown) => (v instanceof Set ? [...v] : v), 1));
