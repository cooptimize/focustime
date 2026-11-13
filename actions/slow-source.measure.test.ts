// RS-2 STEP 0.5 (a measurement, not a check): how long week.load takes with a calendar source that fails slowly or at once.
import { createSnapshotStore } from "../host/local/snapshots.ts";
import { createLoopback } from "../host/local/loopback.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { fakeApis, TENANT } from "../sources/calendar/test-fakes.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, FAKE_SECRET, fakeFetch } from "../sources/dataverse/test-fakes.ts";
import { createOutlookSource } from "../sources/graph/source.ts";
import { FAKE_REFRESH, memoryKeyring } from "../sources/oauth/test-fakes.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { WeekLoadData } from "./types.ts";

const text = STARTER_TOML.replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl)
  .replace('my_email = ""', 'my_email = "me@example.com"')
  .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`)
  .replace(`tenant_id = "abf29d42-2ea9-422b-b0af-ed7cb5595b7e"\nclient_id = ""\n\n# Google`, `tenant_id = "${TENANT}"\nclient_id = "44444444-4444-4444-8444-444444444444"\n\n# Google`);

type Mode = "ok" | "slow" | "fast";
function ctx(cacheDir: string, mode: Mode): ActionContext {
  const ok = fakeApis("ok").fetch;
  const oFetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (mode !== "ok" && String(input).startsWith("https://graph.microsoft.com/")) {
      if (mode === "slow") await new Promise((r) => setTimeout(r, Number(process.env.SLOW_MS ?? 20_000)));
      throw new TypeError("fetch failed");
    }
    return ok(input, init);
  };
  const keyring = memoryKeyring({ "outlook-refresh-token": FAKE_REFRESH });
  return {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(text) }),
    makeDataverse: (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: fakeFetch("ok").fetch, snapshots: createSnapshotStore(cacheDir), log: () => {} }),
    makeOutlook: (cfg, tz) => createOutlookSource({ config: cfg, timeZone: tz, fetch: oFetch, keyring, loopback: createLoopback(), openBrowser: async () => {}, snapshots: createSnapshotStore(cacheDir), log: () => {}, signInTimeoutMs: 150 }),
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: () => ({ load: async () => [], lookup: () => null, orgOf: () => null, last: () => null, portfolio: async () => [], description: async () => null, forget: () => undefined, featureSignals: async () => ({ ok: false as const, message: "n/a" }), exemplarPool: async () => ({ ok: true as const, value: [] }), processModels: async () => [] }),
    saveSystemUserId: async () => {},
    now: () => "2026-11-03T15:00:00Z",
  } as ActionContext;
}
const load = async (c: ActionContext) => {
  const t = performance.now();
  const r = await dispatch(c, { action: "week.load", input: { weekStart: "2026-11-02" } });
  if (!r.ok) throw new Error(r.error);
  const o = (r.data as WeekLoadData).sources.find((s) => s.source === "outlook")!;
  return { ms: Math.round(performance.now() - t), outlook: `${o.status}${o.fromCache ? " (earlier copy)" : ""}: ${o.message ?? ""}` };
};

it.runIf(process.env.RS2_MEASURE)("measures week.load with a failing calendar source", { timeout: 120_000 }, async () => {
  const rows: string[] = [];
  for (const mode of ["fast", "slow"] as const)
    for (const copy of [false, true]) {
      const dir = mkdtempSync(join(tmpdir(), "rs2-"));
      if (copy) await load(ctx(dir, "ok"));
      const r = await load(ctx(dir, mode));
      rows.push(`| ${mode === "slow" ? "fails after 20 s" : "fails at once"} | ${copy ? "yes" : "no"} | ${r.ms} ms | ${r.outlook} |`);
    }
  console.log(["| Outlook | Earlier copy | week.load | Outlook's status |", "|---|---|---|---|", ...rows].join("\n"));
});
