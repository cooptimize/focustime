import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, FAKE_PAT_CSC, FAKE_PAT_WC, FAKE_SECRET, fakeFetch } from "../sources/dataverse/test-fakes.ts";
import { createDevOpsSource } from "../sources/devops/source.ts";
import { fakeDevOps, type OrgScenario } from "../sources/devops/test-fakes.ts";
import type { WeekLoadData } from "./types.ts";
import { dispatch, weekClients, type ActionContext } from "./dispatch.ts";

const text = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')
  .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`)
  .replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl);

function ctx(orgs: Record<string, OrgScenario> = { cscsteel: "agile" }, opts: { devopsThrows?: boolean } = {}) {
  const cacheDir = mkdtempSync(join(tmpdir(), "c-"));
  const dvFetch = fakeFetch("ok").fetch;
  const ado = fakeDevOps(orgs);
  const makeDataverse: ActionContext["makeDataverse"] = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dvFetch, cacheDir, log: () => {} });
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(text) }),
    makeDataverse,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: (cfg, tz) => {
      if (opts.devopsThrows) return { load: async () => { throw new Error("boom"); } };
      const dv = makeDataverse(cfg, tz);
      return createDevOpsSource({ fetch: ado.fetch, log: () => {}, cacheDir, timeZone: tz, targets: (k) => dv.devopsTargets(k) });
    },
    saveSystemUserId: async () => {},
    now: () => "2026-11-03T15:00:00Z",
  };
  return { c, ado };
}

async function load(c: ActionContext): Promise<WeekLoadData> {
  const r = await dispatch(c, { action: "week.load", input: { weekStart: "2026-11-02" } });
  if (!r.ok) throw new Error(r.error);
  return r.data as WeekLoadData;
}

describe("week.load with DevOps", () => {
  it("returns one DevOps result per client with a block Mon–Thu, including the standing block's client", async () => {
    const d = await load(ctx().c);
    const keys = weekClients(d.week).map((c) => c.clientKey);
    expect(keys).toContain("Cooptimize");
    expect(d.devops!.map((c) => c.clientKey)).toEqual(keys);
  });

  it("CSC shows its own items; clients without DevOps settings say why and show none", async () => {
    const d = await load(ctx().c);
    const csc = d.devops!.find((c) => c.clientKey === "CSC")!;
    expect(csc.status).toBe("ok");
    expect(csc.items.map((i) => i.id)).toEqual([102, 101, 105, 103]);
    for (const other of d.devops!.filter((c) => c.clientKey !== "CSC")) {
      expect(other.items).toEqual([]);
      expect(other.status).toBe("not_set_up");
    }
  });

  it("the response never contains a PAT or the Authorization header", async () => {
    const { c } = ctx({ cscsteel: "pat_expired" });
    const body = JSON.stringify(await dispatch(c, { action: "week.load", input: { weekStart: "2026-11-02" } }));
    for (const s of [FAKE_PAT_CSC, FAKE_PAT_WC, "FAKE-DV-PAT", "Basic "]) expect(body).not.toContain(s);
  });

  it("a DevOps crash only drops DevOps; the week still loads", async () => {
    const d = await load(ctx({}, { devopsThrows: true }).c);
    expect(d.devops).toBeNull();
    expect(d.week.days).toHaveLength(5);
    expect(d.sources.find((s) => s.source === "dataverse")?.status).toBe("ok");
  });

  it("Friday and Open half-days bring no clients to DevOps", async () => {
    const d = await load(ctx().c);
    const fri = d.week.days[4]!;
    expect([...fri.am.focus, ...fri.pm.focus]).toEqual([]);
    const openKeys = d.week.days.slice(0, 4).flatMap((day) => [day.am, day.pm]).filter((s) => s.open).flatMap((s) => s.focus.map((f) => f.clientKey));
    expect(openKeys).toEqual([]);
  });
});
