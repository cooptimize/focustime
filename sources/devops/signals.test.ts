// DS-1: the DevOps reads behind Draft stories, on a fake dev.azure.com: one feature's fields as plain text, its epic,
// every child (any state), its comments newest first on the preview comments API, with the company read PAT only;
// a story is refused (features only); the example pool reads the client's own project with the stories under it.
import { describe, expect, it } from "vitest";
import { createSnapshotStore } from "../../host/local/snapshots.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDevOpsSource } from "./source.ts";
import { fakeDevOps, target } from "./test-fakes.ts";

function setup() {
  const ado = fakeDevOps({ contoso: "planweek" });
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  const seen: string[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    seen.push(`${init?.method ?? "GET"} ${u.pathname}${u.search}`);
    if (u.pathname.endsWith("/_apis/wit/workItems/210/comments")) return json({ totalCount: 2, comments: [{ text: "<p>Old</p>", createdDate: "2026-10-01T00:00:00Z" }, { text: "<div>[Coop update v1]<br>Stories proposed</div>", createdDate: "2026-11-01T00:00:00Z" }] });
    if (u.pathname.endsWith("/_apis/wit/wiql")) {
      const q = (JSON.parse(String(init?.body)) as { query: string }).query;
      if (/\[System\.Parent\] = 210/.test(q)) return json({ workItems: [{ id: 211 }, { id: 212 }, { id: 201 }] });
      if (/\[System\.ChangedDate\] >=/.test(q)) return json({ workItems: [{ id: 210 }, { id: 220 }] });
      if (/\[System\.Parent\] IN \(210, 220\)/.test(q)) return json({ workItems: [{ id: 211 }, { id: 212 }, { id: 202 }] });
    }
    return ado.fetch(input, init);
  }) as typeof globalThis.fetch;
  const src = createDevOpsSource({ fetch, log: () => {}, snapshots: createSnapshotStore(mkdtempSync(join(tmpdir(), "signals-"))), timeZone: "America/New_York", targets: async () => ({ ok: true, targets: [target("contoso", "contoso")] }), retryDelayMs: 0 });
  return { src, seen, calls: ado.calls };
}

describe("Draft stories reads", () => {
  it("reads one feature's fields, epic, children and comments", async () => {
    const { src, seen, calls } = setup();
    const r = await src.featureSignals("contoso", 210);
    if (!r.ok) throw new Error(r.message);
    expect(r.value.feature).toMatchObject({ id: 210, title: "Dana's feature", type: "Feature", parentId: 230, description: "Export the weekly report & email it.\n- CSV" });
    expect(r.value.epic).toMatchObject({ id: 230, title: "Dana's epic" });
    expect(r.value.children.map((c) => [c.id, c.state])).toEqual([[211, "Closed"], [212, "New"], [201, "Active"]]);
    expect(r.value.comments.map((c) => c.text)).toEqual(["[Coop update v1]\nStories proposed", "Old"]);
    expect(r.value.storyType).toBe("User Story");
    expect(seen.some((s) => s.includes("/comments?") && s.includes("order=desc") && s.includes("api-version=7.1-preview.4") && !s.includes("api-version=7.1&"))).toBe(true);
    // Only reads, with the company read PAT from Dataverse.
    expect(calls.every((c) => c.method === "GET" || c.url.includes("/wiql") || c.url.includes("/workitemsbatch"))).toBe(true);
    expect(new Set(calls.map((c) => c.authorization)).size).toBe(1);
  });

  it("refuses an item whose type isn't broken down (a story)", async () => {
    const { src } = setup();
    const r = await src.featureSignals("contoso", 201);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/^#201 is a User Story, which isn't broken down in /);
  });

  it("reads the example pool from the client's own project, with the stories under each feature", async () => {
    const { src, seen } = setup();
    const r = await src.exemplarPool("contoso", { months: 12 });
    if (!r.ok) throw new Error(r.message);
    expect(r.value.map((c) => [c.id, c.stories.map((s) => s.title)])).toEqual([[210, ["Done story", "Unassigned story"]], [220, ["My story under an unassigned feature"]]]);
    expect(seen.filter((s) => s.startsWith("POST") && s.includes("wiql")).length).toBeGreaterThanOrEqual(2);
    // An hour in memory: a second read asks DevOps nothing.
    const n = seen.length;
    await src.exemplarPool("contoso", { months: 12 });
    expect(seen.length).toBe(n);
  });
});
