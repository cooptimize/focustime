import { chmodSync, existsSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPEN_REQUEST_FILE, takeOpenRequest } from "./open-request.ts";

const dir = () => mkdtempSync(join(tmpdir(), "focustime-run-"));
const put = (d: string, body: string, mode = 0o600) => {
  writeFileSync(join(d, OPEN_REQUEST_FILE), body, { mode });
  chmodSync(join(d, OPEN_REQUEST_FILE), mode);
};

describe("the launcher's open request (step 9)", () => {
  it("takes a fresh capture request once", async () => {
    const d = dir();
    put(d, "capture\n");
    expect(await takeOpenRequest(d)).toBe("capture");
    expect(existsSync(join(d, OPEN_REQUEST_FILE))).toBe(false);
    expect(await takeOpenRequest(d)).toBeNull();
  });
  it("ignores and removes unknown views, stale or shared files; never follows a link", async () => {
    const d = dir();
    put(d, "settings");
    expect(await takeOpenRequest(d)).toBeNull();
    expect(existsSync(join(d, OPEN_REQUEST_FILE))).toBe(false);
    put(d, "capture");
    const old = (Date.now() - 600_000) / 1000;
    utimesSync(join(d, OPEN_REQUEST_FILE), old, old);
    expect(await takeOpenRequest(d)).toBeNull();
    put(d, "capture", 0o644);
    expect(await takeOpenRequest(d)).toBeNull();
    const target = join(d, "elsewhere");
    writeFileSync(target, "capture", { mode: 0o600 });
    symlinkSync(target, join(d, OPEN_REQUEST_FILE));
    expect(await takeOpenRequest(d)).toBeNull();
    expect(existsSync(target)).toBe(true);
  });
});
