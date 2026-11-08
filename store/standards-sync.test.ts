// KB-1: the sync against a fake GitHub, on both database drivers. Keeps only active articles in the allowed folders,
// parses front matter, stores the SHA-256 and commit, keeps the last good copy on failure, warns on duplicate ids,
// never fetches or runs anything else from the repo, and only ever makes GET requests with no credentials.
import { expect, it } from "vitest";
import { standardsJob } from "../server/standards-job.ts";
import { createStandardsReader } from "../sources/github/standards.ts";
import { forEachDriver } from "../test/db.ts";
import { fakeStandardsGitHub, STD_COMMIT, STD_FILES } from "../test/builders/standards.ts";
import { parseRepoUrl } from "../plan/standards.ts";
import { standardsStoreOn } from "./standards-store.ts";

const URL_ = "https://github.com/contoso/standards";
const T = Temporal.Instant.from("2026-11-08T15:00:00Z");

await forEachDriver("standards sync (KB-1)", ({ open }) => {
  async function setup(o: Parameters<typeof fakeStandardsGitHub>[0] = {}, branch = "") {
    const db = (await open()).conn;
    const gh = fakeStandardsGitHub(o);
    const store = standardsStoreOn(db);
    let now = T;
    const job = standardsJob({ store, reader: createStandardsReader({ fetch: gh.fetch }), source: async () => ({ repoUrl: URL_, branch }), now: () => now, log: () => {} });
    return { db, gh, store, job, tick: (ms: number) => (now = now.add({ milliseconds: ms })) };
  }

  it("keeps only active articles in the allowed folders and parses their front matter", async () => {
    const { store, job } = await setup();
    expect(await job.syncNow()).toMatchObject({ ok: true, changed: true });
    const a = await store.articles();
    const paths = a.map((x) => x.path);
    expect(paths).toContain("SQL/Gold/Fact Tables.md");
    expect(paths).toContain("Source Systems/D365 Exports.md");
    expect(paths).toContain("Technology/Fabric/Fabric Warehouse.md");
    for (const p of ["SQL/Azure SQL Users.md", "deprecation/tech/fabric/performance.md", "standards/sql.md", "SQL/No Front Matter.md", "Power BI/Incomplete.md", "README.md", "AGENTS.md", ".obsidian/notes.md"]) expect(paths).not.toContain(p);
    expect(a.find((x) => x.path === "SQL/Gold/Fact Tables.md")).toMatchObject({ id: "sql_gold_fact_tables", title: "Gold Fact Tables", domain: "sql", layer: "gold", artifact: "fact_table", technology: "agnostic", status: "active" });
  });

  it("stores each article's SHA-256 and the repo commit", async () => {
    const { store, job } = await setup();
    await job.syncNow();
    const a = (await store.articles()).find((x) => x.path === "SQL/SQL Layout.md")!;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(STD_FILES["SQL/SQL Layout.md"]!));
    expect(a.sha256).toBe([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""));
    expect(a.commit).toBe(STD_COMMIT);
    expect((await store.state())?.commit).toBe(STD_COMMIT);
    expect((await store.library(parseRepoUrl))?.repo).toEqual({ owner: "contoso", repo: "standards" });
  });

  it("only ever makes GET requests, with no token, cookies or credentials", async () => {
    const { gh, job } = await setup();
    await job.syncNow();
    expect(gh.seen.length).toBeGreaterThan(3);
    for (const r of gh.seen) {
      expect(r.method).toBe("GET");
      expect(r.headers.authorization).toBeUndefined();
      expect(r.headers.cookie).toBeUndefined();
      expect(r.url).toMatch(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//);
    }
  });

  it("never fetches a script, the retired files or anything else that isn't an article path", async () => {
    const { gh, job } = await setup();
    await job.syncNow();
    const urls = gh.seen.map((r) => decodeURIComponent(r.url));
    for (const bad of ["scripts/", "standards.yml", "standards/sql", "deprecation/", "README", "AGENTS", ".obsidian"]) expect(urls.some((u) => u.includes(bad)), bad).toBe(false);
  });

  it("treats a YAML tag or code in the front matter as plain text", async () => {
    const evil = "---\nid: !!js/function 'function () { globalThis.PWNED = true }'\ntitle: ${process.exit(1)}\ndomain: sql\nlayer: agnostic\nartifact: agnostic\ntechnology: agnostic\nstatus: active\n---\nBody\n";
    const { store, job } = await setup({ files: { "SQL/Evil.md": evil } });
    await job.syncNow();
    expect((globalThis as { PWNED?: boolean }).PWNED).toBeUndefined();
    expect((await store.articles())[0]).toMatchObject({ id: "!!js/function 'function () { globalThis.PWNED = true }'", title: "${process.exit(1)}" });
  });

  it("warns on duplicate ids and keeps both articles; names active articles with missing fields", async () => {
    const { store, job } = await setup();
    await job.syncNow();
    expect((await store.articles()).filter((x) => x.id === "sql_gold_views")).toHaveLength(2);
    const w = (await store.state())!.warnings;
    expect(w).toContainEqual({ kind: "duplicate_id", id: "sql_gold_views", paths: ["SQL/Gold/Views Again.md", "SQL/Gold/Views.md"] });
    expect(w.find((x) => x.kind === "incomplete")).toMatchObject({ path: "Power BI/Incomplete.md" });
  });

  it("keeps the last good copy and records the error when a sync fails, then recovers", async () => {
    const { gh, store, job } = await setup();
    await job.syncNow();
    const before = await store.articles();
    gh.state.fail = 503;
    gh.state.commit = "f".repeat(40);
    const r = await job.syncNow();
    expect(r.ok).toBe(false);
    expect(await store.articles()).toEqual(before);
    expect(await store.state()).toMatchObject({ commit: STD_COMMIT, error: "GitHub answered 503" });
    gh.state.fail = null;
    expect(await job.syncNow()).toMatchObject({ ok: true, changed: true });
    expect(await store.state()).toMatchObject({ commit: "f".repeat(40), error: null });
  });

  it("keeps the last good copy when the repo suddenly has no active articles", async () => {
    const { gh, store, job } = await setup();
    await job.syncNow();
    gh.state.commit = "e".repeat(40);
    gh.state.files = { "SQL/No Front Matter.md": "# nothing\n" };
    expect((await job.syncNow()).ok).toBe(false);
    expect((await store.articles()).length).toBeGreaterThan(5);
  });

  it("checks hourly, reads nothing more when the commit hasn't changed, and never wakes an idle server", async () => {
    const { gh, job, tick } = await setup();
    await job.run();
    const after = gh.seen.length;
    await job.run();
    expect(gh.seen.length).toBe(after);
    tick(61 * 60_000);
    await job.run();
    expect(gh.seen.length).toBe(after + 2); // the default branch and its commit, no files
    expect(await job.wake()).toBeNull();
  });

  it("reads the branch asked for instead of the default", async () => {
    const { gh, job } = await setup({ branch: "release" }, "release");
    await job.syncNow();
    expect(gh.seen.some((r) => r.url.endsWith("/commits/release"))).toBe(true);
    expect(gh.seen.some((r) => r.url === "https://api.github.com/repos/contoso/standards")).toBe(false);
  });

  it("refuses a repo address that isn't a GitHub repo, sending nothing", async () => {
    const db = (await open()).conn;
    const gh = fakeStandardsGitHub();
    const store = standardsStoreOn(db);
    const job = standardsJob({ store, reader: createStandardsReader({ fetch: gh.fetch }), source: async () => ({ repoUrl: "https://evil.example/x/y", branch: "" }), now: () => T, log: () => {} });
    expect((await job.syncNow()).ok).toBe(false);
    expect(gh.seen).toHaveLength(0);
  });
});

