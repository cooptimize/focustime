// D472: deploy-prod.yml's parity check (infra/scripts/parity.sh) against a fake `az`: it fails on a name dev has and
// prod lacks, honours the allowlist and this deploy's what-if, fails on a read it can't make, and only ever reads.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "infra/scripts/parity.sh");
const hasJq = spawnSync("jq", ["--version"]).status === 0;

type Side = { settings: string[]; appSecrets: string[]; vault: string[] };
const BOTH: Side = { settings: ["FOCUSTIME_HOST", "FOCUSTIME_DATAVERSE_URL"], appSecrets: ["dataverse-client-secret"], vault: ["ft-dataverse-client-secret"] };

function run(dev: Side, prod: Side, o: { allow?: string; whatIf?: unknown; vaultDenied?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "parity-"));
  const app = (s: Side) => JSON.stringify({ s: s.settings, r: s.appSecrets });
  // The fake az: answers the four reads by resource group; anything else is a write and fails the test.
  writeFileSync(
    join(dir, "az"),
    `#!/usr/bin/env bash
case "$*" in
  "containerapp show -g FocusTime-dev "*) echo '${app(dev)}' ;;
  "containerapp show -g FocusTime "*) echo '${app(prod)}' ;;
  "keyvault list -g FocusTime-dev "*) echo dev-kv ;;
  "keyvault list -g FocusTime "*) echo prod-kv ;;
  "keyvault secret list --vault-name dev-kv "*) printf '%s\\n' ${dev.vault.join(" ")} ;;
  "keyvault secret list --vault-name prod-kv "*) ${o.vaultDenied ? "echo Forbidden >&2; exit 1" : `printf '%s\\n' ${prod.vault.join(" ")}`} ;;
  *) echo "unexpected az $*" >&2; exit 9 ;;
esac
`,
  );
  chmodSync(join(dir, "az"), 0o755);
  const args: string[] = [];
  if (o.whatIf) {
    writeFileSync(join(dir, "whatif.json"), JSON.stringify(o.whatIf));
    args.push("--what-if", join(dir, "whatif.json"));
  }
  // The allowlist sits next to the script; a copy of the script in the temp folder reads the test's own.
  const infra = join(dir, "infra");
  spawnSync("mkdir", ["-p", join(infra, "scripts")]);
  writeFileSync(join(infra, "scripts/parity.sh"), readFileSync(SCRIPT, "utf8"));
  chmodSync(join(infra, "scripts/parity.sh"), 0o755);
  writeFileSync(join(infra, "parity-allow.txt"), o.allow ?? "# nothing\n");
  const r = spawnSync(join(infra, "scripts/parity.sh"), args, { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe.skipIf(!hasJq)("dev and prod parity (D472)", () => {
  it("passes when prod has every name dev has", () => {
    expect(run(BOTH, BOTH).code).toBe(0);
  });

  it("fails on a setting, an app secret or a vault secret dev has and prod lacks, by name only", () => {
    const dev = { settings: [...BOTH.settings, "FOCUSTIME_NEW"], appSecrets: [...BOTH.appSecrets, "new-secret"], vault: [...BOTH.vault, "ft-new-secret"] };
    const r = run(dev, BOTH);
    expect(r.code).toBe(1);
    expect(r.out).toContain("missing the setting FOCUSTIME_NEW");
    expect(r.out).toContain("missing the app-secret new-secret");
    expect(r.out).toContain("missing the vault-secret ft-new-secret");
  });

  it("allows what infra/parity-allow.txt names, with its reason", () => {
    const dev = { ...BOTH, settings: [...BOTH.settings, "FOCUSTIME_DEV_ONLY"] };
    expect(run(dev, BOTH).code).toBe(1);
    expect(run(dev, BOTH, { allow: "setting FOCUSTIME_DEV_ONLY  # only dev needs it\n" }).code).toBe(0);
  });

  it("counts what this deploy adds to prod (the what-if)", () => {
    const dev = { ...BOTH, settings: [...BOTH.settings, "FOCUSTIME_NEW"] };
    const whatIf = { changes: [{ resourceId: "/subscriptions/x/resourceGroups/FocusTime/providers/Microsoft.App/containerApps/ft-prod-app", after: { properties: { template: { containers: [{ env: [{ name: "FOCUSTIME_NEW", value: "1" }] }] } } } }] };
    expect(run(dev, BOTH, { whatIf }).code).toBe(0);
  });

  it("fails, never passes, when it can't read a name", () => {
    const r = run(BOTH, BOTH, { vaultDenied: true });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Key Vault Reader");
  });

  it("only reads", () => {
    const code = readFileSync(SCRIPT, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    const azCalls = code.match(/\baz [a-z]+(?: [a-z]+)*/g) ?? [];
    expect(azCalls.length).toBeGreaterThan(0);
    for (const c of azCalls) expect(c).toMatch(/ (show|list)$/);
  });
});
