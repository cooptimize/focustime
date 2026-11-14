// RB-4, test 4: the words of a search inside files, through the real server on the demo. After a search that worked,
// one whose client has no code search, and one DevOps's fake refused, the words are in no log line, no monitoring
// event (Application Insights), no row of the view log and no file on disk; an error answer never repeats them. The
// demo's session asks only the demo's fake: any network call would throw. The words here are invented.
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { appInsights } from "../log/appinsights.ts";
import { createDemoContext, seedDemo } from "./demo.ts";
import { startTestApp } from "./test-app.ts";

const NOW = "2026-11-02T13:30:00Z";
const CS = "InstrumentationKey=00000000-0000-4000-8000-000000000001;IngestionEndpoint=https://example.in.applicationinsights.azure.com/";
const PLANTED = "zzqxplanted";
const WORDS = `${PLANTED} OR Watermarks`;
const saved = { fetch: globalThis.fetch, env: { ...process.env } };
let dirs: string[];
const stops: (() => Promise<void>)[] = [];

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => {
    throw new Error("network call in demo mode");
  }) as never;
  dirs = ["cfg", "data", "cache"].map((n) => mkdtempSync(join(tmpdir(), `rb4-${n}-`)));
  [process.env.XDG_CONFIG_HOME, process.env.XDG_DATA_HOME, process.env.XDG_CACHE_HOME] = dirs;
});
afterEach(async () => {
  for (const s of stops.splice(0)) await s();
  globalThis.fetch = saved.fetch;
  process.env = { ...saved.env };
});

/** Every file under a folder, as text. */
function filesText(dir: string): string {
  let out = "";
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    out += statSync(p).isDirectory() ? filesText(p) : readFileSync(p, "latin1");
  }
  return out;
}

describe("the words of a search inside files reach nothing FocusTime keeps (RB-4)", () => {
  it("no log line, no monitoring event, no view log row, no file, no error text", async () => {
    const logs: unknown[] = [];
    const sent: unknown[][] = [];
    const errors: unknown[] = [];
    const t = appInsights({ connectionString: CS, next: (r) => void logs.push(r), fetch: (async (_u: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body)) as unknown[]), new Response("", { status: 200 }))) as unknown as typeof globalThis.fetch, everyMs: 60_000, root: process.cwd() })!;
    const ctx: ActionContext = createDemoContext({ now: () => NOW, demo: { on: true, set: async () => {} } });
    await seedDemo(ctx);
    const app = await startTestApp({ ctx, log: t.log, extra: { onRequest: t.request, onError: (e, w) => (errors.push(e), t.exception(e, w)) } });
    stops.push(app.close, async () => t.stop());
    const b = app.browser();
    await b.signIn("demo-person", true);
    const inside = (clientKey: string, words: string, extra: Record<string, unknown> = {}) => b.action("code.inside", { clientKey, words, ...extra });

    // A search that worked: files come back, with paths and counts, and nothing of the words.
    const ok = await inside("Atlas", WORDS);
    expect(ok.status).toBe(200);
    const data = (JSON.parse(ok.body) as { data: { files: { path: string }[] } }).data;
    expect(data.files.map((f) => f.path)).toContain("/sql/etl/StoredProcedures/usp_SetWatermark.sql");
    expect(ok.body).not.toContain(PLANTED);
    // A client without code search, a client only its team may read, a refused search, and input that isn't allowed.
    const answers = [await inside("Cooptimize", WORDS), await inside("Fabrikam", WORDS), await inside("Atlas", `*${PLANTED}`), await inside("Atlas", WORDS, { kind: PLANTED }), await inside("Atlas", WORDS, { [PLANTED]: 1 }), await inside("Atlas", `${PLANTED}\n${PLANTED}`)];
    expect(answers.map((a) => a.status)).toEqual([409, 403, 400, 400, 400, 400]);
    await t.flush();

    const views = await b.action("admin.code_views", {});
    const everything = { logs: JSON.stringify(logs), telemetry: JSON.stringify(sent), errors: errors.map(String).join("\n"), views: views.body, answers: answers.slice(0, 4).map((a) => a.body).join("\n"), files: dirs.map(filesText).join("\n") };
    for (const [where, text] of Object.entries(everything)) expect(text.includes(PLANTED), where).toBe(false);
    // The monitoring events name the action and nothing more; the view log has a row per client asked.
    expect(JSON.stringify(sent)).toContain("POST /api/action code.inside");
    expect(JSON.stringify(sent)).not.toContain("Watermarks");
    expect(JSON.stringify(logs)).not.toContain("Watermarks");
    expect(views.status).toBe(200);
    {
      const rows = (JSON.parse(views.body) as { data: { views: { clientKey: string; event: string; path: string; repoName: string }[] } }).data.views.filter((v) => v.event === "inside_searched");
      expect(rows.map((r) => [r.clientKey, r.repoName, r.path]).sort()).toEqual([["Atlas", "", ""], ["Atlas", "", ""], ["Cooptimize", "", ""]]);
    }
    // Nothing went to the network: the demo's session asked only the demo's fake.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
