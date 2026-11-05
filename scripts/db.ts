#!/usr/bin/env node
// A3: the local SQL Server container (system/sqlserver/compose.yaml) for development and tests, with rootless Podman.
//
//   node scripts/db.ts up                         start the container; the first time, make the sa password (keyring
//                                                 entry sql-password), then create and migrate focustime_dev
//   node scripts/db.ts migrate [--database <db>]  create the database if missing and bring it to this build's schema
//   node scripts/db.ts reset                      drop, recreate and migrate focustime_dev (HK-3: only that one, and only
//                                                 when port 14330 is the local container's; scripts/db-guard.ts)
//   node scripts/db.ts down                       stop the container (the volume keeps the data)
//   node scripts/db.ts start-if-configured        the service's first step: start the container when the app config
//                                                 names the local one (localhost:14330); otherwise nothing
//
// Databases: focustime (the systemd service's, after the switch), focustime_dev (npm run dev with
// FOCUSTIME_DB_NAME=focustime_dev), focustime_test_* (one per test file, made and dropped by the tests).
// The password goes to Podman in the environment and to the driver in memory; it is never printed or put in argv.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { localPaths } from "../host/local/paths.ts";
import { CONTAINER, portIsContainer, resetRefusal } from "./db-guard.ts";
import { readAppSettings } from "../server/appconfig.ts";
import { runSecretTool } from "../host/local/keyring.ts";
import { migrateSqlServer } from "../store/sql/migrate.ts";
import { sqlServerConn, type SqlServerSettings } from "../store/sql/sqlserver.ts";

/** The container, as compose.yaml publishes it. */
const local = (database: string): SqlServerSettings => ({ server: "localhost", port: 14330, database, auth: "sql", user: "sa", managedIdentityClientId: null, encrypt: true, trustServerCertificate: true });

const ROOT = join(import.meta.dirname, "..");
const COMPOSE = join(ROOT, "system", "sqlserver", "compose.yaml");
const PROTECTED = "focustime";
const say = (s: string) => process.stdout.write(`${s}\n`);
const fail = (s: string): never => {
  process.stderr.write(`${s}\n`);
  process.exit(1);
};

async function password(make: boolean): Promise<string> {
  if (process.env.FOCUSTIME_TEST_SQL_PASSWORD) return process.env.FOCUSTIME_TEST_SQL_PASSWORD;
  const r = await runSecretTool(["lookup", "service", "focustime", "account", "sql-password"]);
  if (r.code === 0 && r.stdout.trim()) return r.stdout.replace(/\n$/, "");
  if (!make) return fail("No sql-password in the keyring yet: run npm run db:up first");
  // SQL Server's rules: 8+ characters from three of upper, lower, digits and symbols.
  const pw = `${randomBytes(24).toString("base64url")}Aa1!`;
  const s = await runSecretTool(["store", "--label=FocusTime sql-password", "service", "focustime", "account", "sql-password"], pw);
  if (s.code !== 0) return fail("Couldn't save the new sql-password in the keyring");
  say("Made the local SQL Server password (keyring: focustime / sql-password)");
  return pw;
}

const podman = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  new Promise<void>((resolve, reject) => {
    // podman-compose, not Docker Compose (which would need a Docker or Podman socket).
    const p = spawn("podman", args, { stdio: "inherit", env: { ...process.env, PODMAN_COMPOSE_PROVIDER: "podman-compose", PODMAN_COMPOSE_WARNING_LOGS: "false", ...env } });
    p.on("error", () => reject(new Error("podman isn't installed (sudo pacman -S podman podman-compose)")));
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`podman ${args[0]} ${args[1] ?? ""} failed (${code})`))));
  });

/** What `podman port <container>` prints ("" when Podman or the container isn't there). */
const podmanPort = () =>
  new Promise<string>((resolve) => {
    let out = "";
    const p = spawn("podman", ["port", CONTAINER], { stdio: ["ignore", "pipe", "ignore"] });
    p.stdout.on("data", (c) => (out += c));
    p.on("error", () => resolve(""));
    p.on("exit", (code) => resolve(code === 0 ? out : ""));
  });

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
    p.on("error", () => reject(new Error(`${cmd} isn't available`)));
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} failed (${code})`))));
  });

async function connect(database: string, pw: string, tries = 1) {
  for (let i = 1; ; i++) {
    try {
      return await sqlServerConn({ settings: local(database), password: async () => pw, waits: [] });
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const NAME = /^focustime(_[a-z0-9_]+)?$/;

async function ensureDatabase(name: string, pw: string, fresh = false) {
  if (!NAME.test(name)) fail(`Not a FocusTime database name: ${name}`);
  const master = await connect("master", pw, 60);
  try {
    if (fresh) {
      if (name === PROTECTED) fail(`Refusing to reset ${PROTECTED}: it is the service's database (your plan)`);
      await master.batch(`IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]; END`);
      say(`Dropped ${name}`);
    }
    await master.batch(`IF DB_ID(N'${name}') IS NULL BEGIN CREATE DATABASE [${name}]; ALTER DATABASE [${name}] SET READ_COMMITTED_SNAPSHOT ON; END`);
  } finally {
    await master.close();
  }
  const db = await connect(name, pw);
  try {
    const applied = await migrateSqlServer(db);
    const v = await db.get("SELECT MAX(version) AS v FROM schema_version");
    say(`${name}: schema version ${String(v?.v)}${applied.length ? ` (applied ${applied.join(", ")})` : " (up to date)"}`);
  } finally {
    await db.close();
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const { values: a } = parseArgs({ args: rest, options: { database: { type: "string" } }, strict: true });
try {
  switch (cmd) {
    case "up": {
      const pw = await password(true);
      await podman(["compose", "-f", COMPOSE, "up", "-d"], { MSSQL_SA_PASSWORD: pw });
      say("Waiting for SQL Server to answer…");
      await ensureDatabase(a.database ?? "focustime_dev", pw);
      break;
    }
    case "migrate":
      await ensureDatabase(a.database ?? "focustime_dev", await password(false));
      break;
    case "reset": {
      const name = a.database ?? "focustime_dev";
      const refused = resetRefusal(name);
      if (refused) fail(refused);
      if (!portIsContainer(await podmanPort())) fail(`Refusing to reset: localhost:14330 isn't the ${CONTAINER} container (start it with npm run db:up)`);
      await ensureDatabase(name, await password(false), true);
      break;
    }
    case "start-if-configured": {
      // No password needed: the container keeps its own settings. SQL Server takes a few seconds to answer after this;
      // the store's retry rule waits for it (store/sql/sqlserver.ts).
      const text = await readFile(join(localPaths().config, "..", "app.toml"), "utf8").catch(() => null);
      const r = readAppSettings(process.env, text, "http://localhost:5317");
      const d = r.ok ? r.settings.database : null;
      if (d?.driver !== "sqlserver" || !["localhost", "127.0.0.1"].includes(d.server) || d.port !== 14330) break;
      // In a scope of its own: started from the service, Podman's monitor would otherwise join the service's process
      // group, and every restart of FocusTime would kill SQL Server with it.
      await run("systemd-run", ["--user", "--scope", "--quiet", "--unit", `focustime-sqlserver-${Date.now()}`, "podman", "start", "focustime-sqlserver"]);
      break;
    }
    case "down":
      await podman(["compose", "-f", COMPOSE, "down"], { MSSQL_SA_PASSWORD: "unused" });
      break;
    default:
      fail("Usage: node scripts/db.ts up | migrate [--database <db>] | reset | down | start-if-configured");
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
