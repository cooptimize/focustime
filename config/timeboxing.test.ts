import { describe, expect, it } from "vitest";
import { parseConfig } from "./schema.ts";
import { settingsEdit } from "./settings.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";

const base = STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "me@example.com"');

describe("Use timeboxing (step 14.5, D261)", () => {
  it("is on by default", () => {
    const p = parseConfig(base);
    expect(p.ok && p.config.timebox.enabled).toBe(true);
  });
  it("Settings > Planning turns it off and back on in [timebox]", () => {
    const off = settingsEdit("timebox", { enabled: false })(base);
    expect(off).toMatch(/\[timebox\][\s\S]*enabled = false/);
    const p = parseConfig(off);
    expect(p.ok && p.config.timebox.enabled).toBe(false);
    const on = parseConfig(settingsEdit("timebox", { enabled: true })(off));
    expect(on.ok && on.config.timebox.enabled).toBe(true);
  });
  it("must be true or false", () => {
    expect(() => settingsEdit("timebox", { enabled: "no" })(base)).toThrow(/true or false/);
    expect(parseConfig(`${base}\n[timebox]\nenabled = 1\n`).ok).toBe(false);
  });
});
