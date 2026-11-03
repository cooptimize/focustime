import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { HttpError } from "../calendar/http.ts";
import { FAKE_WRITE_TOKEN, fakeGraph } from "./test-fakes.ts";
import { createBody, createGraphWriter, MARKER_PROP, matches, OwnershipError, type OutlookFields } from "./write.ts";

const F: OutlookFields = { subject: "Adatum: #4512 Import mapping", body: "https://dev.azure.com/adatum/p/_workitems/edit/4512", start: "2026-11-03T15:00:00Z", end: "2026-11-03T16:30:00Z", showAs: "busy", reminder: false };
function setup() {
  const g = fakeGraph();
  const logs: LogRecord[] = [];
  let invalidated = 0;
  const w = createGraphWriter({ fetch: g.fetch, token: async () => FAKE_WRITE_TOKEN, invalidate: () => invalidated++, log: (r) => logs.push(r) });
  return { g, w, logs, invalidated: () => invalidated };
}

describe("Graph writer", () => {
  it("creates a Busy event with no attendees, no reminder, a text body and the marker", async () => {
    const { g, w } = setup();
    const r = await w.create(F, "tb-1", "tb-1:1");
    expect(r.existed).toBe(false);
    const post = g.calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ subject: F.subject, showAs: "busy", isReminderOn: false, attendees: [], body: { contentType: "text" }, transactionId: "tb-1:1", singleValueExtendedProperties: [{ id: MARKER_PROP, value: "tb-1" }] });
    expect(post.body).toMatchObject({ start: { dateTime: "2026-11-03T15:00:00", timeZone: "UTC" } });
    expect(g.calls.every((c) => c.prefer?.includes('IdType="ImmutableId"'))).toBe(true);
    expect(matches(await w.get(r.id), F, "tb-1").ok).toBe(true);
  });

  it("an idempotent retry finds the marked event instead of creating a second one", async () => {
    const { g, w } = setup();
    g.sw.loseCreateResponse = true;
    await expect(w.create(F, "tb-1", "tb-1:1")).rejects.toThrow();
    expect(g.events.size).toBe(1);
    const again = await w.create(F, "tb-1", "tb-1:1");
    expect(again.existed).toBe(true);
    expect(g.events.size).toBe(1);
    expect(g.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("refuses to update or delete an event without the FocusTime marker, and changes nothing", async () => {
    const { g, w } = setup();
    const id = g.seed({ start: F.start, end: F.end });
    const before = structuredClone(g.events.get(id));
    await expect(w.update(id, "tb-1", F, false)).rejects.toBeInstanceOf(OwnershipError);
    await expect(w.remove(id, "tb-1")).rejects.toBeInstanceOf(OwnershipError);
    expect(g.events.get(id)).toEqual(before);
    expect(g.calls.some((c) => c.method === "PATCH" || c.method === "DELETE")).toBe(false);
  });

  it("refuses an event marked for another timebox", async () => {
    const { g, w } = setup();
    const id = g.seed({ start: F.start, end: F.end, marker: "tb-other" });
    await expect(w.remove(id, "tb-1")).rejects.toBeInstanceOf(OwnershipError);
    expect(g.events.has(id)).toBe(true);
  });

  it("update patches only what changed and returns the prior values", async () => {
    const { g, w } = setup();
    const { id } = await w.create(F, "tb-1", "tb-1:1");
    const moved = { ...F, start: "2026-11-03T17:00:00Z", end: "2026-11-03T18:00:00Z" };
    const was = await w.update(id, "tb-1", moved, false);
    expect(was.start).toBe(F.start);
    expect(Object.keys(g.calls.find((c) => c.method === "PATCH")!.body as object).sort()).toEqual(["end", "start"]);
    expect(matches(await w.get(id), moved, "tb-1").ok).toBe(true);
  });

  it("read back notices a change that didn't land", async () => {
    const { g, w } = setup();
    const { id } = await w.create(F, "tb-1", "tb-1:1");
    g.sw.ignorePatch = true;
    const moved = { ...F, start: "2026-11-03T17:00:00Z" };
    await w.update(id, "tb-1", moved, false);
    expect(matches(await w.get(id), moved, "tb-1")).toEqual({ ok: false, differs: ["start"] });
  });

  it("delete of an already deleted event counts as done", async () => {
    const { g, w } = setup();
    const { id } = await w.create(F, "tb-1", "tb-1:1");
    await expect(w.remove(id, "tb-1")).resolves.toBe("deleted");
    expect(g.events.size).toBe(0);
    await expect(w.remove(id, "tb-1")).resolves.toBe("already_gone");
  });

  it("retries once after a 401 with a fresh token; a 403 is an HttpError with the status only", async () => {
    const { g, w, invalidated } = setup();
    g.sw.failNext = { method: "GET", status: 401 };
    await w.calendar();
    expect(invalidated()).toBe(1);
    g.sw.failNext = { method: "POST", status: 403 };
    const err = await w.create(F, "tb-2", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(403);
    expect(String((err as Error).message)).not.toContain(FAKE_WRITE_TOKEN);
  });

  it("never logs the token or bodies", async () => {
    const { w, logs } = setup();
    await w.create(F, "tb-1", "tb-1:1");
    const text = JSON.stringify(logs);
    expect(text).not.toContain(FAKE_WRITE_TOKEN);
    expect(text).not.toContain(F.subject);
    expect(text).not.toContain("dev.azure.com");
  });

  it("the create body carries exactly the fields FocusTime owns", () => {
    expect(Object.keys(createBody(F, "m", "t")).sort()).toEqual(["attendees", "body", "end", "isReminderOn", "showAs", "singleValueExtendedProperties", "start", "subject", "transactionId"]);
  });
});
