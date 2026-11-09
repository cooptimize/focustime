// TX-1c: a demo server stopped from outside the test. A cleanup by pattern elsewhere on the machine used to take every
// run's servers with it and left only ERR_CONNECTION_REFUSED to go on.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHROMIUM, freshPage, startDemo, type Harness } from "./harness.ts";

const T = 120_000;
describe.skipIf(!CHROMIUM)("the e2e harness's demo servers (TX-1c)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startDemo();
  }, T);
  afterAll(async () => h?.stop());

  it("their command line doesn't match the pattern scripts use for their own servers", () => {
    const line = readFileSync(`/proc/${h.pid}/cmdline`, "utf8").replaceAll("\0", " ");
    expect(line).toContain("server/main.ts --port");
    expect(line).not.toContain("server/main.ts --no-open --no-reopen --headless");
  });

  it("one stopped from outside fails the next page with what happened, not a refused connection", async () => {
    expect(h.gone()).toBeNull();
    process.kill(h.pid, "SIGTERM"); // Only this test's own server.
    await expect.poll(() => h.gone(), { timeout: 20_000 }).toMatch(/stopped during the test.*kill by pattern/);
    await expect(freshPage(h)).rejects.toThrow(/stopped during the test/);
  }, T);
});
