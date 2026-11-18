// EV-1: the dev site says so in the page (the tab's title, iOS's home screen title, the mark's cue) and the manifest
// (the installed app's name); production's files go out exactly as built. Run against the repo's own index.html and
// manifest, so a change to either that the rewrite no longer finds fails here.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import type { BuildEnv } from "./buildinfo.ts";
import { markedEnv, siteManifest, sitePage } from "./site-env.ts";
import { startTestApp } from "./test-app.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PAGE = readFileSync(join(ROOT, "index.html"), "utf8");
const MANIFEST = readFileSync(join(ROOT, "public", "manifest.webmanifest"), "utf8");

describe("the page and the manifest per environment (EV-1)", () => {
  it("only dev and local are marked; production, the demo label and none are not", () => {
    expect(["dev", "local", "prod", "demo", undefined, null, "Prod", "production"].map((e) => markedEnv(e))).toEqual(["dev", "local", null, null, null, null, null, null]);
  });

  it("dev: the title starts with Dev, iOS's name is FocusTime Dev, and the page is a test site", () => {
    const p = sitePage(PAGE, "dev");
    expect(p).toContain("<title>Dev · FocusTime</title>");
    expect(p).toContain(`<meta name="apple-mobile-web-app-title" content="FocusTime Dev" />`);
    expect(p).toContain(`<html lang="en" data-site="test">`);
    expect(p).not.toContain("<title>FocusTime</title>");
  });

  it("local: Local", () => {
    const p = sitePage(PAGE, "local");
    expect(p).toContain("<title>Local · FocusTime</title>");
    expect(p).toContain(`content="FocusTime Local"`);
  });

  it("production and the demo label: the page and the manifest exactly as built", () => {
    for (const env of ["prod", "demo", undefined] as const) {
      expect(sitePage(PAGE, env)).toBe(PAGE);
      expect(siteManifest(MANIFEST, env)).toBe(MANIFEST);
    }
  });

  it("dev: the manifest's name and short name are FocusTime Dev; its id, start, scope and icons are unchanged", () => {
    const before = JSON.parse(MANIFEST) as Record<string, unknown>;
    const after = JSON.parse(siteManifest(MANIFEST, "dev")) as Record<string, unknown>;
    expect([after.name, after.short_name]).toEqual(["FocusTime Dev", "FocusTime Dev"]);
    expect({ ...after, name: before.name, short_name: before.short_name }).toEqual(before);
    expect((JSON.parse(siteManifest(MANIFEST, "local")) as { name: string }).name).toBe("FocusTime Local");
  });

  it("a page the rewrite doesn't recognize is left as it is, never half changed", () => {
    const odd = PAGE.replace("<title>FocusTime</title>", "<title>Something else</title>");
    expect(sitePage(odd, "dev")).toBe(odd);
    expect(siteManifest("not json", "dev")).toBe("not json");
  });
});

describe("served by the app (EV-1)", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const serve = async (env: BuildEnv | null) => {
    const dist = mkdtempSync(join(tmpdir(), "ev1-dist-"));
    dirs.push(dist);
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), PAGE);
    writeFileSync(join(dist, "manifest.webmanifest"), MANIFEST);
    writeFileSync(join(dist, "assets", "main-abc.js"), "export {};");
    return startTestApp({ ctx: () => ({}) as ActionContext, distDir: dist, ...(env ? { extra: { build: { env, pr: "none", sha: "abc1234", builtAt: null } } } : {}) });
  };
  const text = (r: { raw: Buffer; headers: Record<string, unknown> }) => (r.headers["content-encoding"] === "br" ? brotliDecompressSync(r.raw) : r.headers["content-encoding"] === "gzip" ? gunzipSync(r.raw) : r.raw).toString("utf8");

  for (const env of ["prod", "demo", null] as const) {
    it(`${env ?? "no build given"}: the page, any address's page and the manifest are byte for byte as built`, async () => {
      const app = await serve(env);
      try {
        for (const accept of ["br", "gzip", ""]) {
          for (const path of ["/", "/index.html", "/week"]) expect(text(await app.browser().send(path, { "accept-encoding": accept }))).toBe(PAGE);
          expect(text(await app.browser().send("/manifest.webmanifest", { "accept-encoding": accept }))).toBe(MANIFEST);
        }
      } finally {
        await app.close();
      }
    });
  }

  it("dev: every address's page and the manifest say Dev, in every encoding, with their usual cache lines", async () => {
    const app = await serve("dev");
    try {
      for (const accept of ["br", "gzip", ""]) {
        for (const path of ["/", "/week"]) {
          const r = await app.browser().send(path, { "accept-encoding": accept });
          expect(text(r)).toBe(sitePage(PAGE, "dev"));
          expect(r.headers["cache-control"]).toBe("no-store");
        }
        const m = await app.browser().send("/manifest.webmanifest", { "accept-encoding": accept });
        expect((JSON.parse(text(m)) as { short_name: string }).short_name).toBe("FocusTime Dev");
        expect([m.headers["content-type"], m.headers["cache-control"]]).toEqual(["application/manifest+json", "no-cache"]);
      }
    } finally {
      await app.close();
    }
  });
});
