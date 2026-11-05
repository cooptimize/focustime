// HK-1 (Q-ADM2-2): infra/scripts/app-registration.sh adds the acct optional claim to the ID token, against a fake
// `az` that answers the reads and fails on any write. The dry run shows the one update and sends no write; a
// registration that has acct already gets no update; other optional claims are kept in the update.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "infra/scripts/app-registration.sh");
const hasJq = spawnSync("jq", ["--version"]).status === 0;
const APP = "11111111-2222-4333-8444-555555555555";

function run(optionalClaims: unknown, args = ["--dev-url", "https://dev.example.io", "--vault", "kv", "--dry-run"]) {
  const dir = mkdtempSync(join(tmpdir(), "appreg-"));
  writeFileSync(join(dir, "claims.json"), JSON.stringify(optionalClaims));
  writeFileSync(
    join(dir, "az"),
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/calls.log"
case "$*" in
  "account show -o none") ;;
  "ad app list "*) echo ${APP} ;;
  "ad app show --id ${APP} --query optionalClaims -o json") cat "${dir}/claims.json" ;;
  "ad app show --id ${APP} --query requiredResourceAccess"*) echo "scope-id" ;;
  "ad sp show --id ${APP} -o none") ;;
  "ad app show --id ${APP} --query {appId"*) echo "appId: ${APP}" ;;
  "ad app permission list"*) echo "[]" ;;
  "ad app show --id ${APP} --query optionalClaims.idToken[].name -o tsv") echo acct ;;
  "ad sp show --id "*) echo "scope-id" ;;
  "keyvault secret list "*) echo ft-entra-client-secret ;;
  *) echo "unexpected az $*" >&2; exit 9 ;;
esac
`,
  );
  chmodSync(join(dir, "az"), 0o755);
  const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
  const calls = existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n") : [];
  return { ...r, calls };
}
const claimUpdate = (out: string) => out.split("\n").find((l) => l.startsWith("dry-run: az ad app update") && l.includes("--optional-claims"));

describe.skipIf(!hasJq)("the acct optional claim (HK-1)", () => {
  it("a dry run shows the one update and sends no write", () => {
    const r = run(null);
    expect(r.status, r.stderr).toBe(0);
    const line = claimUpdate(r.stdout)!;
    expect(line).toBeDefined();
    const json = JSON.parse(line.slice(line.indexOf("--optional-claims ") + 18, line.lastIndexOf(" -o none")));
    expect(json.idToken).toEqual([{ name: "acct", source: null, essential: false, additionalProperties: [] }]);
    expect(r.calls.filter((c) => /^ad app (update|create|permission (add|grant|admin-consent)|credential)|^ad sp create|^keyvault secret set/.test(c))).toEqual([]);
  });

  it("keeps the registration's other optional claims", () => {
    const r = run({ idToken: [{ name: "auth_time", essential: false }], accessToken: [{ name: "ipaddr", essential: false }], saml2Token: [] });
    const line = claimUpdate(r.stdout)!;
    const json = JSON.parse(line.slice(line.indexOf("--optional-claims ") + 18, line.lastIndexOf(" -o none")));
    expect(json.idToken.map((c: { name: string }) => c.name)).toEqual(["auth_time", "acct"]);
    expect(json.accessToken).toEqual([{ name: "ipaddr", essential: false }]);
  });

  it("changes nothing when the ID token has acct already", () => {
    const r = run({ idToken: [{ name: "acct", essential: false }], accessToken: [], saml2Token: [] });
    expect(r.status, r.stderr).toBe(0);
    expect(claimUpdate(r.stdout)).toBeUndefined();
    expect(r.stdout).toContain("The ID token already has the acct optional claim");
  });

  it("--claims-only touches nothing but the optional claims", () => {
    const r = run(null, ["--claims-only", "--dry-run"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.split("\n").filter((l) => l.startsWith("dry-run:"))).toEqual([claimUpdate(r.stdout)]);
    expect(r.calls.some((c) => /permission|keyvault|sp show/.test(c))).toBe(false);
    expect(run(null, ["--claims-only", "--vault", "kv"]).status).toBe(2);
  });
});
