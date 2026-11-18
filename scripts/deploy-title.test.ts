// DD-1: each deploy's smoke test looks for the page title the server sends for that environment. EV-1 gave dev its own
// title ("Dev · FocusTime") and deploy-dev kept looking for production's, so every deploy to dev after it ended red.
// The expected title is read from each workflow's Smoke test step; what the server sends comes from server/site-env.ts
// (siteTitle, and the page sitePage makes from the repo's own index.html), never from a copy here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { siteTitle, sitePage } from "../server/site-env.ts";

const ROOT = join(import.meta.dirname, "..");
const PAGE = readFileSync(join(ROOT, "index.html"), "utf8");

/** A workflow's Smoke test step: the lines from its `- name: Smoke test` to the next step. */
function smokeStep(file: string): string {
  const lines = readFileSync(join(ROOT, ".github/workflows", file), "utf8").split("\n");
  const start = lines.findIndex((l) => /^\s*- name: Smoke test\s*$/.test(l));
  if (start < 0) throw new Error(`${file}: no Smoke test step`);
  const indent = lines[start]!.indexOf("-");
  const end = lines.findIndex((l, i) => i > start && l.indexOf("- name:") === indent);
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

/** What a smoke step checks: the environment /version must name and the page titles it greps for. */
function checks(file: string) {
  const step = smokeStep(file);
  const envs = [...step.matchAll(/\[\[ \$served == "(\w+) \$\{\w+\}" \]\]/g)].map((m) => m[1]!);
  const titles = [...step.matchAll(/curl -fsS "\$APP_URL\/" \| grep -q "<title>([^<"]*)<\/title>"/g)].map((m) => m[1]!);
  return { envs: [...new Set(envs)], titles };
}
const served = (env: string) => /<title>([^<]*)<\/title>/.exec(sitePage(PAGE, env))?.[1];

describe("each deploy's smoke test looks for the title the server sends there (DD-1)", () => {
  for (const [file, env] of [["deploy-dev.yml", "dev"], ["deploy-prod.yml", "prod"]] as const) {
    it(`${file}: checks ${env}, and looks for exactly the ${env} page's title`, () => {
      const c = checks(file);
      expect(c.envs).toEqual([env]);
      expect(c.titles).toEqual([siteTitle(env)]);
      // And the page the server makes from the repo's index.html carries that title.
      expect(served(env)).toBe(siteTitle(env));
    });
  }

  it("dev's is the Dev mark's title and production's the build's own", () => {
    expect(siteTitle("dev")).not.toBe(siteTitle("prod"));
    expect(served("prod")).toBe(/<title>([^<]*)<\/title>/.exec(PAGE)?.[1]);
  });
});
