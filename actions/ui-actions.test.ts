import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeConfig } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";

function setup(write = true) {
  const dir = mkdtempSync(join(tmpdir(), "c-ui-"));
  const path = join(dir, "config.toml");
  writeFileSync(path, STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"'));
  const no = () => { throw new Error("n/a"); };
  const c: ActionContext = {
    loadConfig: async () => ({ path, parsed: parseConfig(readFileSync(path, "utf8")) }),
    makeDataverse: no, makeOutlook: no, makeGoogle: no, makeDevOps: no,
    saveSystemUserId: async () => {},
    now: () => "2026-11-02T14:00:00Z",
    ...(write ? { writeConfig: (edit: (t: string) => string) => writeConfig(path, edit) } : {}),
  };
  return { c, path };
}

describe("ui.set_theme (step 6b)", () => {
  it("saves the theme in [ui] and returns it; the file keeps its comments", async () => {
    const t = setup();
    const r = await dispatch(t.c, { action: "ui.set_theme", input: { theme: "cooptimize-light" } });
    expect(r).toEqual({ ok: true, data: { ui: { theme: "cooptimize-light" } } });
    const text = readFileSync(t.path, "utf8");
    expect(text).toContain('[ui]\ntheme = "cooptimize-light"');
    expect(text).toContain("# Coopilot configuration.");
  });
  it("refuses unknown themes and extra fields", async () => {
    const t = setup();
    expect(await dispatch(t.c, { action: "ui.set_theme", input: { theme: "omarchy" } })).toMatchObject({ ok: false, status: 400 });
    expect(await dispatch(t.c, { action: "ui.set_theme", input: { theme: "neutral", x: 1 } })).toMatchObject({ ok: false, status: 400 });
  });
  it("says so when settings can't be saved", async () => {
    expect(await dispatch(setup(false).c, { action: "ui.set_theme", input: { theme: "neutral" } })).toMatchObject({ ok: false, status: 503 });
  });
});
