// DM-1: `npm run demo:check` passes against a demo server (the throwaway e2e one), and prints no cookie or token.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, startDemo, type Harness } from "./harness.ts";

const run = promisify(execFile);

describe.skipIf(!CHROMIUM)("demo:check (DM-1)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, 180_000);
  afterAll(async () => h?.stop(), 180_000);

  it("passes every check and prints only names, counts and timings", async () => {
    const { stdout } = await run(process.execPath, ["scripts/demo-check.ts", "--url", new URL(h.url).origin], { timeout: 120_000 });
    if (process.env.DEMO_CHECK_PRINT) console.log(stdout);
    expect(stdout).toMatch(/All \d+ passed/);
    expect(stdout).not.toMatch(/FAIL/);
    expect(stdout).not.toMatch(/__Host-|csrf=|Bearer|session=/i);
  }, 180_000);

  it("fails when the build isn't the expected one", async () => {
    const r = await run(process.execPath, ["scripts/demo-check.ts", "--url", new URL(h.url).origin, "--sha", "0000000"], { timeout: 120_000 }).catch((e: { stdout: string; code: number }) => e);
    expect((r as { code?: number }).code).toBe(1);
    expect((r as { stdout: string }).stdout).toMatch(/FAIL\s+It runs the expected build/);
  }, 180_000);
});
