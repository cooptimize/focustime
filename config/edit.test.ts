import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backupDir, KEEP_BACKUPS, removeValue, replaceArrayTables, replaceSection, setValue, tomlValue, writeConfig } from "./edit.ts";
import { parseConfig } from "./schema.ts";
import { STARTER_TOML } from "./starter.ts";

const valid = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"');

describe("config text edits keep the file readable", () => {
  it("sets a value in place, keeping comments and other lines", () => {
    const t = "# top\n[ui]\n# the theme\ntheme = \"neutral\" # inline\nother = 1\n\n# next\n[risk]\nx = 1\n";
    expect(setValue(t, "ui", "theme", "cooptimize-light")).toBe("# top\n[ui]\n# the theme\ntheme = \"cooptimize-light\"\nother = 1\n\n# next\n[risk]\nx = 1\n");
  });
  it("adds a missing key at the end of its section, before the next section's comments", () => {
    const t = "[ui]\nother = 1\n\n# next\n[risk]\nx = 1\n";
    expect(setValue(t, "ui", "theme", "neutral")).toBe("[ui]\nother = 1\ntheme = \"neutral\"\n\n# next\n[risk]\nx = 1\n");
  });
  it("adds a missing section at the end with an optional comment", () => {
    expect(setValue("[risk]\nx = 1\n", "ui", "theme", "neutral", "Display")).toBe("[risk]\nx = 1\n\n# Display\n[ui]\ntheme = \"neutral\"\n");
  });
  it("quotes keys and escapes strings so the result parses back to the same values", () => {
    const t = setValue("[clients]\n", "clients", "W&C", 'say "hi"\\now');
    expect(t).toContain('"W&C" = "say \\"hi\\"\\\\now"');
    expect(tomlValue({ start: "09:00", list: [1, true] })).toBe('{ start = "09:00", list = [1, true] }');
  });
  it("removes a key, replaces a section body and replaces array tables", () => {
    expect(removeValue("[a]\nx = 1\ny = 2\n", "a", "x")).toBe("[a]\ny = 2\n");
    expect(replaceSection("# about a\n[a]\nx = 1\n\n[b]\n", "a", ["y = 2"])).toBe("# about a\n[a]\ny = 2\n\n[b]\n");
    const t = "[x]\n\n# blocks\n[[sb]]\nday = \"Mon\"\n\n[[sb]]\nday = \"Tue\"\n\n# after\n[z]\n";
    expect(replaceArrayTables(t, "sb", [['day = "Wed"']])).toBe("[x]\n\n# blocks\n[[sb]]\nday = \"Wed\"\n\n# after\n[z]\n");
  });
});

describe("writeConfig", () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), "c-cfg-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, valid, { mode: 0o600 });
    return path;
  };

  it("validates, backs up the old file (0600), then replaces it", async () => {
    const path = setup();
    const r = await writeConfig(path, (t) => setValue(t, "ui", "theme", "cooptimize-light"), "2026-11-01T10:00:00.000Z");
    expect(r.ok).toBe(true);
    expect(parseConfig(readFileSync(path, "utf8"))).toMatchObject({ ok: true, config: { ui: { theme: "cooptimize-light" } } });
    const b = join(backupDir(path), "config-20261101T100000000Z.toml");
    expect(readFileSync(b, "utf8")).toBe(valid);
    expect(statSync(b).mode & 0o777).toBe(0o600);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("writes nothing when the result is invalid, and returns the field errors", async () => {
    const path = setup();
    const r = await writeConfig(path, (t) => setValue(t, "ui", "theme", "omarchy"));
    expect(r.ok).toBe(false);
    expect(r.parsed.ok ? [] : r.parsed.errors).toEqual([{ field: "ui.theme", message: 'Must be one of "cooptimize-dark", "cooptimize-light", "neutral"' }]);
    expect(readFileSync(path, "utf8")).toBe(valid);
  });

  it("keeps only the newest backups", async () => {
    const path = setup();
    for (let i = 0; i < KEEP_BACKUPS + 3; i++) await writeConfig(path, (t) => setValue(t, "ui", "theme", i % 2 ? "neutral" : "cooptimize-light"), `2026-11-01T10:00:${String(i).padStart(2, "0")}.000Z`);
    const files = readdirSync(backupDir(path)).sort();
    expect(files).toHaveLength(KEEP_BACKUPS);
    expect(files[0]).toBe("config-20261101T100003000Z.toml");
  });
});

describe("[ui] theme", () => {
  it("defaults to Cooptimize Dark and accepts the three themes only", () => {
    expect(parseConfig(valid)).toMatchObject({ ok: true, config: { ui: { theme: "cooptimize-dark" } } });
    const noUi = valid.replace(/\[ui\]\ntheme = "[^"]*"\n/, "");
    expect(parseConfig(noUi)).toMatchObject({ ok: true, config: { ui: { theme: "cooptimize-dark" } } });
    for (const t of ["cooptimize-dark", "cooptimize-light", "neutral"]) expect(parseConfig(setValue(valid, "ui", "theme", t))).toMatchObject({ ok: true, config: { ui: { theme: t } } });
    expect(parseConfig(setValue(valid, "ui", "theme", "omarchy")).ok).toBe(false);
  });
});
