// RB-1: the code view log keeps who, when, the client, the repo, the path and what happened, never content; the
// daily purge removes rows past 12 months.
import { expect, it } from "vitest";
import { forEachDriver } from "../test/db.ts";
import { codeViewsStoreOn } from "./code-views-store.ts";
import { purgeRetention, RETENTION_RULES } from "./retention.ts";

const NOW = Temporal.Instant.from("2026-11-20T12:00:00Z");
const REPO = "11111111-2222-4333-8444-555555555555";

await forEachDriver("code views", ({ open }) => {
  it("adds and lists rows, newest first, by client and person, and counts the last 30 days", async () => {
    const db = (await open()).conn;
    let t = NOW.subtract({ hours: 24 * 40 });
    const store = codeViewsStoreOn(db, () => t);
    await store.add({ actorId: "AAAA0000-0000-4000-8000-000000000001", actorName: "Ana", clientKey: "Contoso", repoId: REPO, repoName: "models", path: "/old.tmdl", event: "file_opened" });
    t = NOW;
    await store.add({ actorId: "aaaa0000-0000-4000-8000-000000000001", actorName: "Ana", clientKey: "Contoso", repoId: REPO, repoName: "models", path: "/", event: "repo_opened" });
    await store.add({ actorId: "bbbb0000-0000-4000-8000-000000000002", actorName: "Ben", clientKey: "Fabrikam", repoId: REPO, repoName: "etl", path: "/", event: "find_used" });
    expect((await store.list()).map((v) => v.event)).toEqual(["find_used", "repo_opened", "file_opened"]);
    expect((await store.list({ clientKey: "Contoso" })).length).toBe(2);
    expect((await store.list({ actorId: "AAAA0000-0000-4000-8000-000000000001" })).length).toBe(2);
    expect(await store.counts(NOW.subtract({ hours: 24 * 30 }).toString())).toEqual([{ clientKey: "Contoso", views: 1 }, { clientKey: "Fabrikam", views: 1 }]);
    await expect(store.add({ actorId: "x", actorName: "x", clientKey: "x", repoId: REPO, repoName: "x", path: "/", event: "deleted" as never })).rejects.toThrow();
  });
  it("the purge removes rows past 12 months and keeps the rest", async () => {
    const db = (await open()).conn;
    let t = NOW.subtract({ hours: 24 * 366 });
    const store = codeViewsStoreOn(db, () => t);
    await store.add({ actorId: "a", actorName: "Ana", clientKey: "Contoso", repoId: REPO, repoName: "models", path: "/a", event: "file_opened" });
    t = NOW.subtract({ hours: 24 * 364 });
    await store.add({ actorId: "a", actorName: "Ana", clientKey: "Contoso", repoId: REPO, repoName: "models", path: "/b", event: "file_opened" });
    const { counts } = await purgeRetention(db, NOW, RETENTION_RULES.filter((r) => r.name === "code_views"));
    expect(counts.code_views).toBe(1);
    expect((await store.list()).map((v) => v.path)).toEqual(["/b"]);
  });
});
