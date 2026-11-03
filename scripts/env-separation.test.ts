// A5 (D465): dev and prod share nothing but the image registry. Dev's files never name prod's resources, identities,
// vault or database, and prod's never name dev's, except the one shared registry (AcrPull only, D471).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const DEV = ["infra/dev.bicepparam", ".github/workflows/deploy-dev.yml"];
const PROD = ["infra/prod.bicepparam", ".github/workflows/deploy-prod.yml"];
/** Anything that names an environment's own resources: names, the resource group, identities, variables, vault, SQL. */
const names = (env: "dev" | "prod") => [new RegExp(`\\bft-${env}-`, "i"), new RegExp(`\\bft${env}acr`, "i"), new RegExp(`AZURE_${env.toUpperCase()}_`), env === "dev" ? /FocusTime-dev\b/ : /resourceGroup: 'FocusTime'|-g FocusTime\b/, new RegExp(`${env}-(kv|sql)-`, "i")];
/** Prod's one allowed line about dev: the shared registry. */
const SHARED = /^param sharedRegistry = \{ name: 'ftdevacr[a-z0-9]+', resourceGroup: 'FocusTime-dev' \}/;

function crossings(files: string[], other: "dev" | "prod"): string[] {
  return files.flatMap((f) =>
    read(f)
      .split("\n")
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => !/^\s*(#|\/\/)/.test(line) && !SHARED.test(line) && names(other).some((re) => re.test(line)))
      .map(({ line, i }) => `${f}:${i + 1}: ${line.trim().slice(0, 100)}`),
  );
}

describe("dev and prod stay apart (D465)", () => {
  it("dev's config never names a prod resource", () => {
    expect(crossings(DEV, "prod")).toEqual([]);
  });

  it("prod's config never names a dev resource, except the shared registry", () => {
    expect(crossings(PROD, "dev")).toEqual([]);
  });

  it("each parameter file is its own environment", () => {
    expect(read("infra/dev.bicepparam")).toMatch(/^param env = 'dev'$/m);
    expect(read("infra/prod.bicepparam")).toMatch(/^param env = 'prod'$/m);
    expect(read("infra/prod.bicepparam")).toMatch(/^param minReplicas = 1\b/m);
  });

  it("would catch a crossing", () => {
    expect(names("prod").some((re) => re.test("--principal ft-prod-app"))).toBe(true);
    expect(names("dev").some((re) => re.test("client-id: ${{ vars.AZURE_DEV_CLIENT_ID }}"))).toBe(true);
    expect(SHARED.test("param sharedRegistry = { name: 'ftdevacr5bthbn', resourceGroup: 'FocusTime-dev' } // x")).toBe(true);
  });
});
