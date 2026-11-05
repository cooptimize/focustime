// TB-1: builds the Teams app package (a zip of manifest.json, color.png and outline.png) for one environment, for
// the Teams admin to upload in the Teams admin center (docs/setup/teams-bot.md). Manifest schema 1.30, the bot only, personal
// scope only (1:1 chats), no files, no tabs, no SSO, no permissions beyond the bot. The bot id is the environment's
// bot identity's client id (the deploy prints it; `az deployment group show ... --query properties.outputs.botAppId`).
//
//   node scripts/teams-package.ts --env dev|prod --bot-id <guid> --url https://<public host> [--version 1.0.0]
//
// Writes dist/teams/focustime-<env>-<version>.zip. Nothing secret goes in it: the ids are public.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";

/** Each environment's Teams app id: fixed, so an upload replaces the app instead of adding another. */
export const TEAMS_APP_IDS = { dev: "6f84bb2c-364d-4d76-8a62-153904d0551a", prod: "6e436eed-8f64-43ec-805a-6e68b7e70a5c" } as const;
export type Env = keyof typeof TEAMS_APP_IDS;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function teamsManifest(o: { env: Env; botId: string; url: string; version: string }) {
  if (!GUID.test(o.botId)) throw new Error("--bot-id must be the bot identity's client id (a GUID)");
  if (!VERSION.test(o.version)) throw new Error("--version must be like 1.0.0");
  const u = new URL(o.url);
  if (u.protocol !== "https:" || u.pathname !== "/" || u.search || u.hash) throw new Error("--url must be the app's https origin");
  const origin = u.origin;
  const dev = o.env === "dev";
  const name = dev ? "FocusTime (dev)" : "FocusTime";
  return {
    $schema: "https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json",
    manifestVersion: "1.30",
    version: o.version,
    id: TEAMS_APP_IDS[o.env],
    developer: { name: "Cooptimize", websiteUrl: origin, privacyUrl: `${origin}/#/settings/about`, termsOfUseUrl: `${origin}/#/settings/about` },
    name: { short: name, full: dev ? "FocusTime by Cooptimize (dev)" : "FocusTime by Cooptimize" },
    description: {
      short: "Your week and your focus blocks, in a 1:1 chat.",
      full: "Ask FocusTime about your day and week in your own words. Anything that would change something shows a preview first, and nothing happens until you tap Confirm. For Cooptimize accounts only.",
    },
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: "#0D1318",
    bots: [
      {
        botId: o.botId,
        scopes: ["personal"],
        supportsFiles: false,
        isNotificationOnly: false,
        commandLists: [
          {
            scopes: ["personal"],
            commands: [
              { title: "what's next", description: "Your next pick and meeting" },
              { title: "today", description: "Today's blocks and picks" },
              { title: "help", description: "What I can do" },
              { title: "open FocusTime", description: "A link to the app" },
            ],
          },
        ],
      },
    ],
    validDomains: [u.host],
  };
}

/** A zip with stored (uncompressed) entries: small, and nothing to depend on. */
export function zip(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, f.data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(f.data.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + f.data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

export function teamsPackage(o: { env: Env; botId: string; url: string; version: string; root: string }): Buffer {
  const manifest = teamsManifest(o);
  return zip([
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n") },
    { name: "color.png", data: readFileSync(join(o.root, "assets/teams/color.png")) },
    { name: "outline.png", data: readFileSync(join(o.root, "assets/teams/outline.png")) },
  ]);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const env = opt("--env");
  if (env !== "dev" && env !== "prod") {
    console.error("usage: node scripts/teams-package.ts --env dev|prod --bot-id <guid> --url https://<host> [--version 1.0.0]");
    process.exit(2);
  }
  const root = join(import.meta.dirname, "..");
  const version = opt("--version") ?? "1.0.0";
  try {
    const data = teamsPackage({ env, botId: (opt("--bot-id") ?? "").toLowerCase(), url: opt("--url") ?? "", version, root });
    const dir = join(root, "dist", "teams");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `focustime-${env}-${version}.zip`);
    writeFileSync(file, data);
    console.log(`dist/teams/focustime-${env}-${version}.zip (${data.length} bytes)`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
