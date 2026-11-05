// TB-1: the Teams app package: manifest 1.30, the bot in the personal scope only, the two icons, a zip unzip reads.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { LEGAL_PATH, TEAMS_APP_IDS, teamsManifest, teamsPackage } from "./teams-package.ts";

const BOT = "0a1b2c3d-1111-2222-3333-444455556666";
const URL_ = "https://ft-dev-app.example.centralus.azurecontainerapps.io";

it("is a personal-scope bot only, named FocusTime, with a fixed app id per environment", () => {
  const m = teamsManifest({ env: "prod", botId: BOT, url: URL_, version: "1.0.0" });
  expect(m.manifestVersion).toBe("1.30");
  expect(m.$schema).toContain("/v1.30/");
  expect(m.id).toBe(TEAMS_APP_IDS.prod);
  expect(m.name.short).toBe("FocusTime");
  expect(m.bots).toHaveLength(1);
  expect(m.bots[0]).toMatchObject({ botId: BOT, scopes: ["personal"], supportsFiles: false, isNotificationOnly: false });
  expect(m.bots[0]!.commandLists[0]!.scopes).toEqual(["personal"]);
  expect(Object.keys(m)).not.toContain("staticTabs");
  expect(Object.keys(m)).not.toContain("webApplicationInfo");
  expect(m.validDomains).toEqual([new URL(URL_).host]);
  expect(teamsManifest({ env: "dev", botId: BOT, url: URL_, version: "1.0.0" }).name.short).toBe("FocusTime (dev)");
  expect(TEAMS_APP_IDS.dev).not.toBe(TEAMS_APP_IDS.prod);
  expect(JSON.stringify(m)).not.toMatch(/—/);
});

it("refuses a bot id, URL or version that isn't one", () => {
  expect(() => teamsManifest({ env: "dev", botId: "not-a-guid", url: URL_, version: "1.0.0" })).toThrow();
  expect(() => teamsManifest({ env: "dev", botId: BOT, url: "http://insecure.example", version: "1.0.0" })).toThrow();
  expect(() => teamsManifest({ env: "dev", botId: BOT, url: `${URL_}/path`, version: "1.0.0" })).toThrow();
  expect(() => teamsManifest({ env: "dev", botId: BOT, url: URL_, version: "1.0" })).toThrow();
});

it("zips the manifest and both icons so unzip reads them back", () => {
  const root = join(import.meta.dirname, "..");
  const dir = mkdtempSync(join(tmpdir(), "ft-teams-"));
  const file = join(dir, "p.zip");
  writeFileSync(file, teamsPackage({ env: "dev", botId: BOT, url: URL_, version: "1.0.0", root }));
  const list = execFileSync("unzip", ["-l", file], { encoding: "utf8" });
  for (const n of ["manifest.json", "color.png", "outline.png"]) expect(list).toContain(n);
  execFileSync("unzip", ["-q", "-o", file, "-d", dir]);
  expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).bots[0].botId).toBe(BOT);
  expect(readFileSync(join(dir, "color.png")).equals(readFileSync(join(root, "assets/teams/color.png")))).toBe(true);
});

it("links privacy and terms to the app's own page, which has both sections and nothing the app's CSP would block (TB-1b)", () => {
  const m = teamsManifest({ env: "prod", botId: BOT, url: URL_, version: "1.0.0" });
  expect(m.developer.privacyUrl).toBe(`${URL_}${LEGAL_PATH}#privacy`);
  expect(m.developer.termsOfUseUrl).toBe(`${URL_}${LEGAL_PATH}#terms`);
  const html = readFileSync(join(import.meta.dirname, "..", "public", LEGAL_PATH.slice(1)), "utf8");
  expect(html).toContain('id="privacy"');
  expect(html).toContain('id="terms"');
  expect(html).not.toMatch(/<script|style=|<style/i);
  expect(html).not.toMatch(/—/);
});
