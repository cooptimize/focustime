// SA-2: no Settings section draws its own row, heading, help line, button or table: each draws only through the parts
// (ui/settings/parts.tsx). A section file that uses a class name, an inline style or a raw element fails here.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "sections");
const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
const RAW = /<(h[1-6]|p|table|thead|tbody|tr|td|th|button|fieldset|legend|input|select|textarea|label|ul|ol|li|details|summary|span|div|section|strong|em|small|a)\b/;

describe("SA-2: Settings sections draw only through the parts", () => {
  it("has section files", () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(f, () => {
      const lines = readFileSync(join(DIR, f), "utf8").split("\n");
      const bad = lines.flatMap((l, i) => (/\bclassName=|\bstyle=\{/.test(l) || RAW.test(l) ? [`${f}:${i + 1}: ${l.trim()}`] : []));
      expect(bad).toEqual([]);
    });
  }
});
