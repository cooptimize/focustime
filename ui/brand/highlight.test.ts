// Step 17.5: Lumen's lime highlight is the brand module's alone. Anywhere else it would read as information (D: brand B05).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ui = new URL("..", import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

describe("mascot-highlight", () => {
  it("is used only inside ui/brand/", () => {
    const outside = files(ui)
      .filter((p) => !relative(ui, p).startsWith("brand/"))
      .filter((p) => /var\(\s*--mascot-highlight/.test(readFileSync(p, "utf8")))
      .map((p) => relative(ui, p));
    expect(outside).toEqual([]);
  });
});
