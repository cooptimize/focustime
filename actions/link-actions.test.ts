import { createSnapshotStore } from "../host/local/snapshots.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, FAKE_SECRET, fakeFetch } from "../sources/dataverse/test-fakes.ts";
import { createDevOpsSource } from "../sources/devops/source.ts";
import { fakeDevOps } from "../sources/devops/test-fakes.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";

const text =
  STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')
    .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`)
    .replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl);

function setup(opts: { launchFails?: boolean; noLaunch?: boolean; hosted?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "c-link-"));
  const dv = fakeFetch("ok");
  const ado = fakeDevOps({ contoso: "portfolio", cooptimize: "agile" });
  const makeDataverse: ActionContext["makeDataverse"] = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv.fetch, snapshots: createSnapshotStore(dir), log: () => {} });
  let devops: ReturnType<typeof createDevOpsSource> | undefined;
  const launched: string[][] = [];
  const c: ActionContext = {
    loadConfig: async () => ({ path: "/x/config.toml", parsed: parseConfig(text) }),
    makeDataverse,
    makeOutlook: () => { throw new Error("n/a"); },
    makeGoogle: () => { throw new Error("n/a"); },
    makeDevOps: (cfg, tz) => (devops ??= createDevOpsSource({ fetch: ado.fetch, log: () => {}, snapshots: createSnapshotStore(dir), timeZone: tz, targets: (k) => makeDataverse(cfg, tz).devopsTargets(k) })),
    saveSystemUserId: async () => {},
    now: () => "2026-11-03T14:00:00Z",
    // The host's links (A1): local opens them itself; the hosted app hands them back to the page.
    ...(opts.noLaunch ? {} : { links: { open: async (url: string) => { if (opts.launchFails) throw new Error("ENOENT"); launched.push([url]); return opts.hosted ? "client" : "opened"; } } }),
  };
  const open = (input: unknown) => dispatch(c, { action: "link.open", input });
  return { c, open, launched, ado };
}

const Adatum_URL = "https://dev.azure.com/contoso/Project%20Ada/_workitems/edit/101";

describe("link.open", () => {
  it("opens a client's work item in the person's browser through the host", async () => {
    const t = setup();
    await dispatch(t.c, { action: "week.load", input: { weekStart: "2026-11-02" } });
    expect(await t.open({ clientKey: "Adatum", url: Adatum_URL })).toEqual({ ok: true, data: { opened: "browser" } });
    expect(t.launched).toEqual([[Adatum_URL]]);
  });

  it("in the hosted app, the checked link comes back for the page to open", async () => {
    const t = setup({ hosted: true });
    await dispatch(t.c, { action: "week.load", input: { weekStart: "2026-11-02" } });
    expect(await t.open({ clientKey: "Adatum", url: Adatum_URL })).toEqual({ ok: true, data: { opened: "page", url: Adatum_URL } });
  });

  it("refuses another client's link and non-DevOps links, and launches nothing", async () => {
    const t = setup();
    await dispatch(t.c, { action: "week.load", input: { weekStart: "2026-11-02" } });
    const crossClient = await t.open({ clientKey: "Adatum", url: "https://dev.azure.com/cooptimize/Internal/_workitems/edit/5" });
    expect(crossClient).toMatchObject({ ok: false, status: 422, error: "That link is not in this client's DevOps organization" });
    expect(await t.open({ clientKey: "Adatum", url: "https://evil.example/contoso/x" })).toMatchObject({ ok: false, status: 422 });
    expect(await t.open({ clientKey: "Adatum", url: "file:///etc/passwd" })).toMatchObject({ ok: false, status: 422 });
    expect(t.launched).toEqual([]);
  });

  it("before the client's DevOps settings are loaded, nothing is opened", async () => {
    const t = setup();
    expect(await t.open({ clientKey: "Adatum", url: Adatum_URL })).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/not known yet/) });
  });

  it("rejects bad input and reports a browser that won't start", async () => {
    const t = setup({ launchFails: true });
    await dispatch(t.c, { action: "week.load", input: { weekStart: "2026-11-02" } });
    expect(await t.open({ clientKey: "Adatum", url: Adatum_URL, extra: 1 })).toMatchObject({ ok: false, status: 400 });
    expect(await t.open({ url: Adatum_URL })).toMatchObject({ ok: false, status: 400 });
    expect(await t.open({ clientKey: "Adatum", url: Adatum_URL })).toMatchObject({ ok: false, status: 500, error: "Could not start the browser" });
  });

  it("opening a link makes no DevOps call", async () => {
    const t = setup();
    await dispatch(t.c, { action: "week.load", input: { weekStart: "2026-11-02" } });
    const before = t.ado.calls.length;
    await t.open({ clientKey: "Adatum", url: Adatum_URL });
    expect(t.ado.calls.length).toBe(before);
  });
});
