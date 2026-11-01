import { describe, expect, it } from "vitest";
import { rebuildFrom, syncDecision, timeboxFrom, type SeenEvent } from "./outlooksync.ts";
import { outlookFields, type Fields } from "./timebox.ts";

const TZ = "America/Chicago";
const UID = "tb-0b6c1d2e-3f40-4152-8a6b-7c8d9e0f1a2b";
const last: Fields = outlookFields({ title: "#4512 Import mapping", url: "https://dev.azure.com/wc/p/_workitems/edit/4512", start: "2026-11-03T09:00:00-06:00", end: "2026-11-03T10:30:00-06:00" }, "W&C");
const seen = (over: Partial<SeenEvent> = {}): SeenEvent => ({ id: "EV1", subject: last.subject, start: last.start, end: last.end, showAs: "busy", marker: UID, ...over });

describe("two-way sync for Coopilot events", () => {
  it("does nothing when neither side changed (the body isn't compared)", () => {
    expect(syncDecision(last, seen(), { ...last, body: "different" })).toEqual({ kind: "none" });
  });

  it("follows Outlook when only Outlook changed: time, title, show as", () => {
    const d = syncDecision(last, seen({ start: "2026-11-03T16:00:00Z", end: "2026-11-03T17:00:00Z", subject: "W&C: Import mapping v2", showAs: "tentative" }), last);
    expect(d.kind).toBe("adopt");
    if (d.kind !== "adopt") return;
    expect(d.changed).toEqual(["time", "title", "show as"]);
    expect(timeboxFrom(d.fields, "W&C", TZ)).toEqual({ date: "2026-11-03", start: "2026-11-03T10:00:00-06:00", end: "2026-11-03T11:00:00-06:00", title: "Import mapping v2", showAs: "tentative" });
  });

  it("removes the timebox when the event was deleted in Outlook and Coopilot didn't change it", () => {
    expect(syncDecision(last, null, last)).toEqual({ kind: "adopt_delete" });
    // Deleted in Outlook and removed in Coopilot too: nothing left to do.
    expect(syncDecision(last, null, null)).toEqual({ kind: "none" });
  });

  it("both changed since the last sync: a conflict, nothing overwritten", () => {
    const mine = { ...last, start: "2026-11-03T15:30:00Z", end: "2026-11-03T17:00:00Z" };
    const d = syncDecision(last, seen({ subject: "W&C: renamed in Outlook" }), mine);
    expect(d).toMatchObject({ kind: "conflict", changed: ["title"], outlook: { subject: "W&C: renamed in Outlook" } });
    // Moved in Coopilot, deleted in Outlook.
    expect(syncDecision(last, null, mine)).toMatchObject({ kind: "conflict", outlook: null });
    // Removed in Coopilot, changed in Outlook.
    expect(syncDecision(last, seen({ showAs: "free" }), null)).toMatchObject({ kind: "conflict" });
  });

  it("an Outlook version that can't be a timebox (over 8 hours) gives no timebox fields", () => {
    expect(timeboxFrom({ ...last, start: "2026-11-03T13:00:00Z", end: "2026-11-03T23:00:00Z" }, "W&C", TZ)).toBeNull();
  });
});

describe("Q69: rebuild a Coopilot event's record from its marker", () => {
  const clients = [{ key: "W&C", name: "Woodard & Curran" }, { key: "CSC", name: "CSC" }];
  it("finds the client from the subject and keeps the marker as the uid", () => {
    expect(rebuildFrom(seen({ subject: "Woodard & Curran: #4512 Import mapping" }), clients, TZ, "Cooptimize")).toMatchObject({ uid: UID, clientKey: "W&C", title: "#4512 Import mapping", date: "2026-11-03", start: "2026-11-03T09:00:00-06:00", outlook: true, showAs: "busy" });
    expect(rebuildFrom(seen({ subject: "W&C: #4512 Import mapping" }), clients, TZ, "Cooptimize")).toMatchObject({ clientKey: "W&C", title: "#4512 Import mapping" });
  });
  it("falls back to the subject's prefix, else Internal", () => {
    expect(rebuildFrom(seen({ subject: "Acme: kickoff" }), clients, TZ, "Cooptimize")).toMatchObject({ clientKey: "Acme", title: "kickoff" });
    expect(rebuildFrom(seen({ subject: "Deep work" }), clients, TZ, "Cooptimize")).toMatchObject({ clientKey: "Cooptimize", title: "Deep work" });
  });
});
