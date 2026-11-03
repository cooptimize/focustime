import { describe, expect, it } from "vitest";
import { syncDecision, timeboxFrom, type SeenEvent } from "./outlooksync.ts";
import { outlookFields, type Fields } from "./timebox.ts";

const TZ = "America/Chicago";
const UID = "tb-0b6c1d2e-3f40-4152-8a6b-7c8d9e0f1a2b";
const last: Fields = outlookFields({ title: "#4512 Import mapping", url: "https://dev.azure.com/tw/p/_workitems/edit/4512", start: "2026-11-03T09:00:00-06:00", end: "2026-11-03T10:30:00-06:00" }, "T&W");
const seen = (over: Partial<SeenEvent> = {}): SeenEvent => ({ id: "EV1", subject: last.subject, start: last.start, end: last.end, showAs: "busy", marker: UID, ...over });

describe("two-way sync for FocusTime events", () => {
  it("does nothing when neither side changed (the body isn't compared)", () => {
    expect(syncDecision(last, seen(), { ...last, body: "different" })).toEqual({ kind: "none" });
  });

  it("follows Outlook when only Outlook changed: time, title, show as", () => {
    const d = syncDecision(last, seen({ start: "2026-11-03T16:00:00Z", end: "2026-11-03T17:00:00Z", subject: "T&W: Import mapping v2", showAs: "tentative" }), last);
    expect(d.kind).toBe("adopt");
    if (d.kind !== "adopt") return;
    expect(d.changed).toEqual(["time", "title", "show as"]);
    expect(timeboxFrom(d.fields, "T&W", TZ)).toEqual({ date: "2026-11-03", start: "2026-11-03T10:00:00-06:00", end: "2026-11-03T11:00:00-06:00", title: "Import mapping v2", showAs: "tentative" });
  });

  it("deleted in Outlook: the timebox is kept and asks (step 13.5), whether or not FocusTime changed it", () => {
    expect(syncDecision(last, null, last)).toEqual({ kind: "removed_in_outlook" });
    // Deleted in Outlook and removed in FocusTime too: nothing left to do.
    expect(syncDecision(last, null, null)).toEqual({ kind: "none" });
  });

  it("both changed since the last sync: a conflict, nothing overwritten", () => {
    const mine = { ...last, start: "2026-11-03T15:30:00Z", end: "2026-11-03T17:00:00Z" };
    const d = syncDecision(last, seen({ subject: "T&W: renamed in Outlook" }), mine);
    expect(d).toMatchObject({ kind: "conflict", changed: ["title"], outlook: { subject: "T&W: renamed in Outlook" } });
    // Moved in FocusTime, deleted in Outlook: kept and asks too, never a re-create.
    expect(syncDecision(last, null, mine)).toEqual({ kind: "removed_in_outlook" });
    // Removed in FocusTime, changed in Outlook.
    expect(syncDecision(last, seen({ showAs: "free" }), null)).toMatchObject({ kind: "conflict" });
  });

  it("an Outlook version that can't be a timebox (over 8 hours) gives no timebox fields", () => {
    expect(timeboxFrom({ ...last, start: "2026-11-03T13:00:00Z", end: "2026-11-03T23:00:00Z" }, "T&W", TZ)).toBeNull();
  });
});

