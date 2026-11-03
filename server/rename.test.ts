// R1: the one-time move from Coopilot to FocusTime, with fake folders and a fake keyring (no real secret-tool).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { moveFromOldName, RENAME_NOTE } from "./rename.ts";
import type { Runner } from "../secrets/keyring.ts";
import { writePatAccount } from "../secrets/keyring.ts";
import type { LogRecord } from "../log/logger.ts";

/** A fake Secret Service: entries by service and account, every call recorded. */
function fakeKeyring(entries: Record<string, string>, opts: { failStoreFor?: string; corruptReadBack?: string } = {}) {
  const store = new Map(Object.entries(entries));
  const calls: string[][] = [];
  const run: Runner = async (args, stdin) => {
    calls.push(args);
    const [cmd, , service, , account] = args.filter((a) => !a.startsWith("--label"));
    const key = `${service}/${account}`;
    if (cmd === "lookup") {
      const v = store.get(key);
      if (v !== undefined && opts.corruptReadBack === account && service === "focustime") return { code: 0, stdout: v + "x\n", stderr: "" };
      return v === undefined ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: v + "\n", stderr: "" };
    }
    if (cmd === "store") {
      if (opts.failStoreFor === account) return { code: 1, stdout: "", stderr: "Cannot create an item in a locked collection" };
      store.set(key, stdin ?? "");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "clear") {
      store.delete(key);
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected ${cmd}`);
  };
  return { store, calls, run };
}

/** Fake XDG folders with Coopilot's config (and a backup), plan store (with one write identity), cache and browser profile. */
function oldHome() {
  const root = mkdtempSync(join(tmpdir(), "focustime-rename-"));
  const env = { XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache") };
  mkdirSync(join(env.XDG_CONFIG_HOME, "coopilot"), { recursive: true });
  writeFileSync(join(env.XDG_CONFIG_HOME, "coopilot", "config.toml"), "[outlook]\nclient_id = \"x\"\n");
  writeFileSync(join(env.XDG_CONFIG_HOME, "coopilot", "config.toml.bak-1"), "old\n");
  mkdirSync(join(env.XDG_DATA_HOME, "coopilot", "browser", "Default"), { recursive: true });
  writeFileSync(join(env.XDG_DATA_HOME, "coopilot", "browser", "Default", "Cookies"), "c");
  const db = new DatabaseSync(join(env.XDG_DATA_HOME, "coopilot", "plan.db"));
  db.exec("CREATE TABLE devops_identities (client_key TEXT PRIMARY KEY); INSERT INTO devops_identities VALUES ('Contoso');");
  db.close();
  writeFileSync(join(env.XDG_DATA_HOME, "coopilot", "plan.db.bak-20261101"), "b");
  mkdirSync(join(env.XDG_CACHE_HOME, "coopilot", "photos"), { recursive: true });
  writeFileSync(join(env.XDG_CACHE_HOME, "coopilot", "dataverse.json"), "{}");
  return { root, env };
}

const PAT = writePatAccount("Contoso");
const SECRETS = { "coopilot/outlook-refresh-token": "rt-value", "coopilot/dataverse-client-secret": "dv-value", [`coopilot/${PAT}`]: "pat-value" };

describe("moveFromOldName (R1)", () => {
  it("copies config, store and cache, keeps the old folders with a note, and moves each keyring entry after reading it back", async () => {
    const { root, env } = oldHome();
    const k = fakeKeyring(SECRETS);
    const logs: LogRecord[] = [];
    const r = await moveFromOldName({ env, home: root, today: "2026-11-02", run: k.run, log: (x) => logs.push(x) });

    expect(r.folders).toEqual([{ name: "config", result: "copied" }, { name: "data", result: "copied" }, { name: "cache", result: "copied" }]);
    expect(readFileSync(join(env.XDG_CONFIG_HOME, "focustime", "config.toml"), "utf8")).toContain("client_id");
    expect(existsSync(join(env.XDG_CONFIG_HOME, "focustime", "config.toml.bak-1"))).toBe(true);
    expect(readdirSync(join(env.XDG_DATA_HOME, "focustime")).sort()).toEqual(["plan.db", "plan.db.bak-20261101"]);
    expect(existsSync(join(env.XDG_CACHE_HOME, "focustime", "dataverse.json"))).toBe(true);
    // Old folders stay, each with the note and the date; nothing in them was removed.
    for (const base of [env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME]) expect(readFileSync(join(base, "coopilot", "MIGRATED.txt"), "utf8")).toContain("2026-11-02");
    expect(existsSync(join(env.XDG_DATA_HOME, "coopilot", "plan.db"))).toBe(true);
    expect(existsSync(join(env.XDG_DATA_HOME, "coopilot", "browser", "Default", "Cookies"))).toBe(true);

    // Keyring: the same account names under the new service, the old ones gone; the PAT account came from the store.
    expect(r.keyring).toEqual({ moved: ["dataverse-client-secret", "outlook-refresh-token", PAT], failed: [] });
    expect(r.note).toBeNull();
    expect(Object.fromEntries(k.store)).toEqual({ "focustime/outlook-refresh-token": "rt-value", "focustime/dataverse-client-secret": "dv-value", [`focustime/${PAT}`]: "pat-value" });
    // Each old entry is cleared only after its new entry read back.
    for (const a of ["outlook-refresh-token", PAT]) {
      const back = k.calls.findIndex((c) => c[0] === "lookup" && c[2] === "focustime" && c[4] === a && k.calls.slice(0, k.calls.indexOf(c)).some((p) => p[0] === "store" && p.at(-1) === a));
      const clear = k.calls.findIndex((c) => c[0] === "clear" && c[4] === a);
      expect(back).toBeGreaterThanOrEqual(0);
      expect(clear).toBeGreaterThan(back);
    }
    // Secrets go in through stdin only; logs name accounts, never values.
    expect(k.calls.flat().join(" ")).not.toMatch(/rt-value|dv-value|pat-value/);
    expect(JSON.stringify(logs)).not.toMatch(/value/);
    expect(logs.filter((l) => l.op === "rename_keyring").map((l) => l.kind)).toEqual(["dataverse-client-secret", "outlook-refresh-token", PAT]);
  });

  it("a second run changes nothing", async () => {
    const { root, env } = oldHome();
    const k = fakeKeyring(SECRETS);
    await moveFromOldName({ env, home: root, today: "2026-11-02", run: k.run, log: () => {} });
    writeFileSync(join(env.XDG_CONFIG_HOME, "focustime", "config.toml"), "edited after the move\n");
    const before = Object.fromEntries(k.store);
    k.calls.length = 0;
    const r = await moveFromOldName({ env, home: root, today: "2026-11-03", run: k.run, log: () => {} });
    expect(r.folders.map((f) => f.result)).toEqual(["exists", "exists", "exists"]);
    expect(r.keyring).toEqual({ moved: [], failed: [] });
    expect(Object.fromEntries(k.store)).toEqual(before);
    expect(k.calls.every((c) => c[0] === "lookup")).toBe(true);
    expect(readFileSync(join(env.XDG_CONFIG_HOME, "focustime", "config.toml"), "utf8")).toBe("edited after the move\n");
    expect(readFileSync(join(env.XDG_CONFIG_HOME, "coopilot", "MIGRATED.txt"), "utf8")).toContain("2026-11-02");
  });

  it("never overwrites an existing focustime folder", async () => {
    const { root, env } = oldHome();
    mkdirSync(join(env.XDG_CONFIG_HOME, "focustime"));
    writeFileSync(join(env.XDG_CONFIG_HOME, "focustime", "config.toml"), "mine\n");
    const r = await moveFromOldName({ env, home: root, today: "2026-11-02", run: fakeKeyring({}).run, log: () => {} });
    expect(r.folders[0]).toEqual({ name: "config", result: "exists" });
    expect(readFileSync(join(env.XDG_CONFIG_HOME, "focustime", "config.toml"), "utf8")).toBe("mine\n");
    expect(existsSync(join(env.XDG_CONFIG_HOME, "coopilot", "MIGRATED.txt"))).toBe(false);
  });

  it("a failed write or a wrong read-back keeps the old entry and gives the sign-in screen a plain note", async () => {
    const { root, env } = oldHome();
    const k = fakeKeyring(SECRETS, { failStoreFor: "outlook-refresh-token", corruptReadBack: PAT });
    const r = await moveFromOldName({ env, home: root, today: "2026-11-02", run: k.run, log: () => {} });
    expect(r.keyring).toEqual({ moved: ["dataverse-client-secret"], failed: ["outlook-refresh-token", PAT] });
    expect(k.store.get("coopilot/outlook-refresh-token")).toBe("rt-value");
    expect(k.store.get(`coopilot/${PAT}`)).toBe("pat-value");
    expect(r.note).toBe(RENAME_NOTE);
    expect(RENAME_NOTE).not.toMatch(/—/);
  });

  it("does nothing without Coopilot's folders (a fresh install, tests, demo)", async () => {
    const root = mkdtempSync(join(tmpdir(), "focustime-rename-"));
    const k = fakeKeyring(SECRETS);
    const r = await moveFromOldName({ env: { XDG_CONFIG_HOME: join(root, "c"), XDG_DATA_HOME: join(root, "d"), XDG_CACHE_HOME: join(root, "x") }, home: root, today: "2026-11-02", run: k.run, log: () => {} });
    expect(r).toEqual({ folders: [{ name: "config", result: "none" }, { name: "data", result: "none" }, { name: "cache", result: "none" }], keyring: null, note: null });
    expect(k.calls).toEqual([]);
  });
});
