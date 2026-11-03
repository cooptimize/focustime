import { describe, expect, it } from "vitest";
import type { ClientWork, WorkItem } from "../week/types.ts";
import { devopsSummary, isDevOpsUrl, topWork, workByClient, workStatusLabel } from "./work.ts";

const item = (id: number): WorkItem => ({ id, title: `T${id}`, type: "Task", state: "Active", stateCategory: "InProgress", order: id, parentId: null, changedAt: "", url: `https://dev.azure.com/o/p/_workitems/edit/${id}` });
const cw = (clientKey: string, ids: number[], over: Partial<ClientWork> = {}): ClientWork => ({ clientKey, clientName: clientKey, status: "ok", fetchedAt: null, fromCache: false, items: ids.map(item), ...over });

describe("work shown on a block", () => {
  it("looks up only the block's own client, by exact key", () => {
    const m = workByClient([cw("Adatum", [1, 2]), cw("T&W", [3])]);
    expect(m.get("Adatum")?.items.map((i) => i.id)).toEqual([1, 2]);
    expect(m.get("adatum")).toBeUndefined();
    expect(m.get("Proseware")).toBeUndefined();
  });

  it("top 3 in board order plus +N more", () => {
    expect(topWork(cw("A", [1, 2, 3, 4, 5]))).toMatchObject({ more: 2 });
    expect(topWork(cw("A", [1, 2, 3, 4, 5])).top.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(topWork(cw("A", [1]))).toMatchObject({ more: 0 });
    expect(topWork(undefined)).toEqual({ top: [], more: 0 });
  });

  it("opens only Azure DevOps links", () => {
    expect(isDevOpsUrl("https://dev.azure.com/o/p/_workitems/edit/1")).toBe(true);
    expect(isDevOpsUrl("https://dev.azure.com.evil.example/x")).toBe(false);
    expect(isDevOpsUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("DevOps status summary", () => {
  it("counts live clients", () => {
    expect(devopsSummary([cw("A", []), cw("B", [], { status: "auth_failed" })])).toEqual({ label: "1 of 2 live", level: "partial" });
    expect(devopsSummary([cw("A", [])])?.level).toBe("live");
    expect(devopsSummary([cw("A", [], { status: "unreachable" })])?.level).toBe("down");
    expect(devopsSummary(null)).toBeNull();
  });
  it("labels cached and failure states plainly", () => {
    expect(workStatusLabel(cw("A", [], { status: "auth_failed", fromCache: true }))).toBe("cached (PAT expired or invalid)");
    expect(workStatusLabel(cw("A", [], { status: "identity_missing" }))).toBe("identity missing");
  });
});
