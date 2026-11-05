// CP-1: the Saved toast's Undo. It removes the capture and what it made only while nothing else has happened to it;
// the AI version arriving later doesn't count as a change.
import { describe, expect, it } from "vitest";
import { createPlanStore } from "./plan-store.ts";

const NOW = "2026-11-05T15:00:00Z";
let clock = NOW;
const store = () => createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from(clock).toZonedDateTimeISO("America/New_York") });

describe("undoCapture (CP-1)", () => {
  it("removes an unsorted capture, a fresh follow-up or a fresh draft, and its capture", async () => {
    clock = NOW;
    const s = store();
    const a = await s.addCapture({ text: "sort me later", clientKey: "contoso" });
    expect(await s.undoCapture(a.id)).toEqual({ removed: "capture" });
    expect(await s.getCapture(a.id)).toBeNull();

    const b = await s.addCapture({ text: "Told Dana I'd send it", clientKey: "contoso" });
    const fb = await s.routeCapture(b.id, { as: "follow_up", clientKey: "contoso", who: "Dana", what: "Send it", due: null });
    expect(await s.undoCapture(b.id)).toEqual({ removed: "follow_up" });
    expect((await s.openFollowUps()).some((f) => f.id === fb.routedId)).toBe(false);

    const c = await s.addCapture({ text: "csv export", clientKey: "contoso" });
    const dc = await s.routeCapture(c.id, { as: "draft", clientKey: "contoso", parentItemId: null, title: "csv export", size: "M" });
    // The AI version landing afterwards is not "something else happened".
    await s.setDraftAi(dc.routedId!, { state: "ready", title: "Export as CSV", description: null, acceptance: null, type: "User Story", parentId: 437, parentReason: null, note: null, ranAt: NOW });
    expect(await s.undoCapture(c.id)).toEqual({ removed: "draft" });
    expect(await s.getDraft(dc.routedId!)).toBeNull();
    expect(await s.getCapture(c.id)).toBeNull();
  });

  it("leaves a draft I edited, and a follow-up I closed, and says why", async () => {
    clock = NOW;
    const s = store();
    const c = await s.addCapture({ text: "csv export", clientKey: "contoso" });
    const dc = await s.routeCapture(c.id, { as: "draft", clientKey: "contoso", parentItemId: null, title: "csv export", size: "M" });
    clock = "2026-11-05T15:01:00Z";
    await s.updateDraft(dc.routedId!, { title: "CSV export" });
    await expect(s.undoCapture(c.id)).rejects.toThrow(/changed since/);
    expect(await s.getDraft(dc.routedId!)).not.toBeNull();

    const b = await s.addCapture({ text: "Told Dana I'd send it", clientKey: "contoso" });
    const fb = await s.routeCapture(b.id, { as: "follow_up", clientKey: "contoso", who: "Dana", what: "Send it", due: null });
    await s.closeFollowUp(fb.routedId!, null);
    await expect(s.undoCapture(b.id)).rejects.toThrow(/changed since/);
    expect(await s.getCapture(b.id)).not.toBeNull();
  });

  it("a capture that's gone says so", async () => {
    const s = store();
    await expect(s.undoCapture(99)).rejects.toThrow(/already gone/);
  });
});
