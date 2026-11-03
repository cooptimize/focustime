import { describe, expect, it } from "vitest";
import { createFeedbackDevOps, FeedbackFailure, type FeedbackTarget } from "./feedback.ts";
import { PARENT_REL, WIT_API } from "../../plan/devopswrite.ts";

const TARGET: FeedbackTarget = { org: "contoso", project: "Contoso Internal", parentId: 496 };
const TOKEN = "secret-token-value";
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A pretend dev.azure.com: answers by path. */
function fakeDevOps(answers: Record<string, { status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const logs: unknown[] = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = new URL(url).pathname;
    const hit = Object.entries(answers).find(([k]) => decodeURIComponent(path).endsWith(k));
    const a = hit?.[1] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status ?? 200, headers: { "content-type": "application/json; charset=utf-8" } });
  }) as typeof fetch;
  const d = createFeedbackDevOps({ fetch: fetchFn, log: (r) => logs.push(r), token: async () => TOKEN, target: TARGET });
  return { d, calls, logs };
}

const payload = { title: "Idea: Show free hours", description: "Show free hours\n\nFrom Person 1 (person1@contoso.example)\nEnvironment: prod", tags: ["FocusTime feedback", "Idea"] };

describe("feedback DevOps calls (F1)", () => {
  it("creates the story with its parent link to the feature in one call", async () => {
    const { d, calls } = fakeDevOps({ "/_apis/wit/workitems/$User Story": { body: { id: 701, rev: 1 } } });
    const r = await d.create("User Story", payload, "Contoso Internal", "Contoso Internal\\Iteration 1");
    expect(r).toEqual({ id: 701, rev: 1 });
    const c = calls[0]!;
    expect(c.method).toBe("POST");
    expect(c.url).toBe(`https://dev.azure.com/contoso/Contoso%20Internal/_apis/wit/workitems/$User%20Story?api-version=${WIT_API}`);
    expect(c.headers["content-type"]).toBe("application/json-patch+json");
    expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(c.body).toEqual([
      { op: "add", path: "/fields/System.Title", value: payload.title },
      { op: "add", path: "/fields/System.Description", value: expect.stringContaining("Show free hours") },
      { op: "add", path: "/fields/System.Tags", value: "FocusTime feedback; Idea" },
      { op: "add", path: "/fields/System.AreaPath", value: "Contoso Internal" },
      { op: "add", path: "/fields/System.IterationPath", value: "Contoso Internal\\Iteration 1" },
      { op: "add", path: "/relations/-", value: { rel: PARENT_REL, url: "https://dev.azure.com/contoso/_apis/wit/workItems/496" } },
    ]);
    expect(PARENT_REL).toBe("System.LinkTypes.Hierarchy-Reverse");
  });

  it("checks with validateOnly, which saves nothing", async () => {
    const { d, calls } = fakeDevOps({ "/_apis/wit/workitems/$User Story": { body: { rev: -1 } } });
    await d.create("User Story", payload, "Contoso Internal", "Contoso Internal", true);
    expect(calls[0]!.url).toContain("validateOnly=true");
  });

  it("reads the item back with its parent", async () => {
    const { d } = fakeDevOps({
      "/_apis/wit/workitems/701": { body: { id: 701, rev: 1, fields: { "System.Title": payload.title, "System.WorkItemType": "User Story" }, relations: [{ rel: PARENT_REL, url: "https://dev.azure.com/contoso/_apis/wit/workItems/496" }] } },
    });
    expect(await d.read(701)).toEqual({ id: 701, rev: 1, title: payload.title, type: "User Story", parentId: 496, url: "https://dev.azure.com/contoso/Contoso%20Internal/_workitems/edit/701" });
  });

  it("reads the story type from the process and the default iteration from the default team", async () => {
    const { d } = fakeDevOps({
      "/_apis/work/processconfiguration": { body: { requirementBacklog: { workItemTypes: [{ name: "Product Backlog Item" }] } } },
      "/_apis/projects/Contoso Internal": { body: { defaultTeam: { name: "Contoso Internal Team" } } },
      "/Contoso Internal Team/_apis/work/teamsettings": { body: { defaultIteration: { path: "\\Iteration 1" } } },
    });
    expect(await d.storyType()).toBe("Product Backlog Item");
    expect(await d.defaultIteration()).toBe("Contoso Internal\\Iteration 1");
  });

  it("falls back to the project when the team has no default iteration", async () => {
    const { d } = fakeDevOps({
      "/_apis/projects/Contoso Internal": { body: { defaultTeam: { name: "Contoso Internal Team" } } },
      "/Contoso Internal Team/_apis/work/teamsettings": { body: { defaultIteration: null } },
    });
    expect(await d.defaultIteration()).toBe("Contoso Internal");
  });

  it("gives null for a missing parent and a plain failure for refusals", async () => {
    const { d } = fakeDevOps({ "/_apis/wit/workitems/$User Story": { status: 403 } });
    expect(await d.parent()).toBeNull();
    const e = await d.create("User Story", payload, "a", "b").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FeedbackFailure);
    expect((e as FeedbackFailure).kind).toBe("forbidden");
  });

  it("never logs the token or the text", async () => {
    const { d, logs } = fakeDevOps({ "/_apis/wit/workitems/$User Story": { body: { id: 1, rev: 1 } } });
    await d.create("User Story", payload, "a", "b");
    const text = JSON.stringify(logs);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("Show free hours");
    expect(logs).toEqual([expect.objectContaining({ source: "devops", op: "feedback_create", status: 200 })]);
  });

  it("refuses a target that isn't valid", () => {
    expect(() => createFeedbackDevOps({ fetch, log: () => {}, token: async () => "", target: { ...TARGET, org: "bad org/x" } })).toThrow();
  });
});
