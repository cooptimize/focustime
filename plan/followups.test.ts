import { describe, expect, it } from "vitest";
import { detectFollowUps, isBlocked, reviewHeadsUps, slipDraft, watchedIds, type DetectInput, type FollowUpLike, type WorkState } from "./followups.ts";
import type { Pick } from "./types.ts";
import type { WorkItem } from "../week/types.ts";

const T = (hm: string, d = "2026-11-02") => `${d}T${hm}:00-05:00[America/New_York]`;
const pick = (over: Partial<Pick>): Pick => ({
  id: 1, date: "2026-11-02", half: "PM", clientKey: "Adatum", kind: "item", itemId: 101, draftId: null, title: "Export report", itemType: "User Story", itemUrl: null,
  size: "M", status: "planned", carriedFrom: null, carriedFromDate: null, followUpId: null, notes: null, position: 1, createdAt: T("08:00"), updatedAt: T("08:00"), ...over,
});
const item = (over: Partial<WorkItem>): WorkItem => ({ id: 101, title: "Export report", type: "User Story", state: "Active", stateCategory: "InProgress", level: "story", order: 1, parentId: null, changedAt: "2026-11-02T13:00:00Z", url: "https://dev.azure.com/o/p/_workitems/edit/101", ...over });
const work = (items: WorkItem[], over: Partial<WorkState> = {}): WorkState => ({ clientKey: "Adatum", status: "ok", fromCache: false, items, ...over });
const followUp = (over: Partial<FollowUpLike>): FollowUpLike => ({ id: 1, kind: "devops_update", clientKey: "Adatum", itemId: 101, ruleKey: "devops_update:1", refAt: T("15:00"), detail: null, openedAt: T("17:15"), closedAt: null, closedBy: null, ...over });

function input(over: Partial<DetectInput> = {}): DetectInput {
  const picks = over.picks ?? [];
  return {
    today: "2026-11-02",
    picks,
    pick: (id) => picks.find((p) => p.id === id) ?? null,
    committedAt: () => T("08:30"),
    movedTo: () => null,
    work: [],
    followUps: [],
    internal: new Set(["Cooptimize"]),
    clientName: (k) => (k === "Adatum" ? "Adatum" : k),
    ...over,
  };
}

describe("follow-up rule: pick done, DevOps not updated (step 7)", () => {
  const done = pick({ status: "done", updatedAt: T("15:00") });
  it("opens when the item is still in an open state and hasn't changed since the tick", () => {
    const r = detectFollowUps(input({ picks: [done], work: [work([item({ changedAt: "2026-11-02T18:00:00Z" })])] }));
    expect(r.open).toEqual([expect.objectContaining({ kind: "devops_update", ruleKey: "devops_update:1", who: "Adatum", what: "Update DevOps #101: Export report", itemId: 101, refAt: T("15:00") })]);
  });
  it("doesn't open when I already updated the item after the tick, it is resolved, or it isn't known", () => {
    expect(detectFollowUps(input({ picks: [done], work: [work([item({ changedAt: "2026-11-02T20:30:00Z", changedByMe: true })])] })).open).toEqual([]);
    // Someone else's change after the tick isn't my update (Q42).
    expect(detectFollowUps(input({ picks: [done], work: [work([item({ changedAt: "2026-11-02T20:30:00Z", changedByMe: false })])] })).open).toHaveLength(1);
    expect(detectFollowUps(input({ picks: [done], work: [work([item({ stateCategory: "Resolved", state: "Resolved" })])] })).open).toEqual([]);
    expect(detectFollowUps(input({ picks: [done], work: null })).open).toEqual([]);
    expect(detectFollowUps(input({ picks: [done], work: [work([])] })).open).toEqual([]);
    // Intentions and future days have no DevOps item to update.
    expect(detectFollowUps(input({ picks: [pick({ status: "done", kind: "intention", itemId: null })], work: [work([item({})])] })).open).toEqual([]);
  });
  it("opens once: a follow-up already there (open or closed) for that pick, or open for that item, stops another", () => {
    const w = [work([item({ changedAt: "2026-11-02T18:00:00Z" })])];
    expect(detectFollowUps(input({ picks: [done], work: w, followUps: [followUp({ closedAt: T("17:30"), closedBy: "me" })] })).open).toEqual([]);
    const again = pick({ id: 2, date: "2026-11-02", status: "done", updatedAt: T("16:00") });
    expect(detectFollowUps(input({ picks: [again], work: w, followUps: [followUp({})] })).open).toEqual([]);
  });
  it("closes when a later fetch shows the item completed, or changed by me after the follow-up opened (Q42)", () => {
    const open = [followUp({})];
    const completed = work([], { watched: [item({ state: "Closed", stateCategory: "Completed", changedAt: "2026-11-02T22:00:00Z" })] });
    expect(detectFollowUps(input({ picks: [done], work: [completed], followUps: open })).close).toEqual([{ id: 1, note: "DevOps #101 is Closed" }]);
    const changed = work([item({ changedAt: "2026-11-02T22:30:00Z", changedByMe: true })]);
    expect(detectFollowUps(input({ picks: [done], work: [changed], followUps: open })).close).toEqual([{ id: 1, note: "DevOps #101 was updated" }]);
  });
  it("stays open when someone else changed the item, or I changed it before the follow-up opened (Q42)", () => {
    const open = [followUp({})];
    expect(detectFollowUps(input({ picks: [done], work: [work([item({ changedAt: "2026-11-02T22:30:00Z", changedByMe: false })])], followUps: open })).close).toEqual([]);
    expect(detectFollowUps(input({ picks: [done], work: [work([item({ changedAt: "2026-11-02T22:30:00Z" })])], followUps: open })).close).toEqual([]);
    // Opened 5:15 PM (22:15Z); my change at 21:00Z was before it.
    expect(detectFollowUps(input({ picks: [done], work: [work([item({ changedAt: "2026-11-02T21:00:00Z", changedByMe: true })])], followUps: open })).close).toEqual([]);
  });
  it("stays open on a cached or failed fetch, or while nothing changed", () => {
    const open = [followUp({})];
    const completed = item({ state: "Closed", stateCategory: "Completed" });
    expect(detectFollowUps(input({ picks: [done], work: [work([], { watched: [completed], fromCache: true })], followUps: open })).close).toEqual([]);
    expect(detectFollowUps(input({ picks: [done], work: [work([], { status: "auth_failed", watched: [completed] })], followUps: open })).close).toEqual([]);
    expect(detectFollowUps(input({ picks: [done], work: [work([item({ changedAt: "2026-11-02T19:00:00Z" })])], followUps: open })).close).toEqual([]);
  });
  it("closes when the pick is no longer ticked done", () => {
    expect(detectFollowUps(input({ picks: [pick({ status: "planned" })], followUps: [followUp({})] })).close).toEqual([{ id: 1, note: "The pick is no longer marked done" }]);
  });
});

describe("follow-up rule: slipped work owes the client a heads-up", () => {
  const moved = pick({ id: 5, status: "moved", updatedAt: T("17:10") });
  const dropped = pick({ id: 6, itemId: null, kind: "intention", title: "Review the mapping", status: "dropped", updatedAt: T("17:12") });
  const target = pick({ id: 9, date: "2026-11-04", half: "PM", carriedFrom: 5 });
  const movedTo = (id: number) => (id === 5 ? target : null);

  it("opens one follow-up per client and day with a copyable plain-text draft naming each item and its new plan", () => {
    const r = detectFollowUps(input({ picks: [moved, dropped], movedTo }));
    expect(r.open).toHaveLength(1);
    expect(r.open[0]).toMatchObject({ kind: "slip", clientKey: "Adatum", who: "Adatum", what: "Heads-up to Adatum about the slip (2 items)", detail: { picks: [5, 6], date: "2026-11-02" } });
    expect(r.open[0]!.draft).toBe(
      ["Hi Adatum, a quick heads-up on my plan for Mon, Nov 2:", "- #101 Export report: moving to Wed, Nov 4 (afternoon)", "- Review the mapping: off my plan for now; I'll come back with a new date", "I'll keep you posted."].join("\n"),
    );
  });
  it("only for committed days, changes after the commit, and clients other than Cooptimize", () => {
    expect(detectFollowUps(input({ picks: [moved], committedAt: () => null })).open).toEqual([]);
    expect(detectFollowUps(input({ picks: [pick({ id: 5, status: "moved", updatedAt: T("08:10") })] })).open).toEqual([]);
    expect(detectFollowUps(input({ picks: [pick({ id: 5, status: "moved", clientKey: "Cooptimize", updatedAt: T("17:10") })] })).open).toEqual([]);
  });
  it("adds later slips to the open follow-up for that client and day; once told, a new slip opens a new one", () => {
    const told = followUp({ id: 3, kind: "slip", itemId: null, ruleKey: "slip:2026-11-02:Adatum:5", detail: { picks: [5], date: "2026-11-02" } });
    const r = detectFollowUps(input({ picks: [moved, dropped], movedTo, followUps: [told] }));
    expect(r.open).toEqual([]);
    expect(r.update).toEqual([expect.objectContaining({ id: 3, what: "Heads-up to Adatum about the slip (2 items)", detail: { picks: [5, 6], date: "2026-11-02" } })]);
    const closed = { ...told, closedAt: T("17:20"), closedBy: "me" as const };
    const r2 = detectFollowUps(input({ picks: [moved, dropped], movedTo, followUps: [closed] }));
    expect(r2.update).toEqual([]);
    expect(r2.open).toEqual([expect.objectContaining({ ruleKey: "slip:2026-11-02:Adatum:6", detail: { picks: [6], date: "2026-11-02" } })]);
  });
  it("keeps each client's draft to its own items", () => {
    const other = pick({ id: 7, clientKey: "T&W", itemId: 7001, title: "Pump curve", status: "dropped", updatedAt: T("17:12") });
    const r = detectFollowUps(input({ picks: [moved, other], movedTo }));
    expect(r.open.map((l) => [l.clientKey, l.draft!.includes("Pump curve"), l.draft!.includes("Export report")])).toEqual([
      ["Adatum", false, true],
      ["T&W", true, false],
    ]);
  });
  it("names the slip in the draft template", () => {
    expect(slipDraft("T&W", "2026-11-03", [pick({ itemId: 7, title: "X", status: "dropped" })], () => null)).toContain("- #7 X: off my plan for now");
  });
});

describe("follow-up rule: a blocked item assigned to me", () => {
  it("is blocked by its state or a tag", () => {
    expect(isBlocked("10-Blocked", [])).toBe(true);
    expect(isBlocked("Active", ["Blocked by vendor"])).toBe(true);
    expect(isBlocked("Active", ["Unblocker"])).toBe(false);
  });
  it("opens 'Nudge on blocker' from a fresh fetch, once while blocked", () => {
    const w = [work([item({ id: 202, title: "Waiting on API keys", blocked: true })])];
    const items = [...w[0]!.items];
    const r = detectFollowUps(input({ work: w }));
    expect(r.open).toEqual([expect.objectContaining({ kind: "blocked", ruleKey: "blocked:Adatum:202:1", what: "Nudge on blocker for #202: Waiting on API keys", itemId: 202 })]);
    expect(detectFollowUps(input({ work: [work(items, { fromCache: true })] })).open).toEqual([]);
    const nudged = followUp({ id: 4, kind: "blocked", itemId: 202, ruleKey: "blocked:Adatum:202:1", closedAt: T("17:20"), closedBy: "me" });
    // Nudged by hand and still blocked: quiet for 3 workdays, then a new nudge (Q43).
    expect(detectFollowUps(input({ work: w, followUps: [nudged] })).open).toEqual([]);
    // Closed Mon Nov 2: Tue, Wed are 2 workdays; Thu is the 3rd. A weekend in between doesn't count.
    expect(detectFollowUps(input({ today: "2026-11-04", work: w, followUps: [nudged] })).open).toEqual([]);
    expect(detectFollowUps(input({ today: "2026-11-05", work: w, followUps: [nudged] })).open.map((l) => l.ruleKey)).toEqual(["blocked:Adatum:202:2"]);
    const friday = { ...nudged, closedAt: T("17:20", "2026-11-06") };
    expect(detectFollowUps(input({ today: "2026-11-10", work: w, followUps: [friday] })).open).toEqual([]);
    expect(detectFollowUps(input({ today: "2026-11-11", work: w, followUps: [friday] })).open).toHaveLength(1);
    // Workdays come from the caller (working hours): with Mon to Thu only, Fri doesn't count.
    const monThu = (d: string) => Temporal.PlainDate.from(d).dayOfWeek <= 4;
    const wednesday = { ...nudged, closedAt: T("17:20", "2026-11-04") };
    expect(detectFollowUps(input({ today: "2026-11-09", work: w, followUps: [wednesday] })).open).toHaveLength(1);
    expect(detectFollowUps(input({ today: "2026-11-09", work: w, followUps: [wednesday], isWorkday: monThu })).open).toEqual([]);
    expect(detectFollowUps(input({ today: "2026-11-10", work: w, followUps: [wednesday], isWorkday: monThu })).open).toHaveLength(1);
    // Unblocked (closed by the signal) and blocked again: a new follow-up.
    expect(detectFollowUps(input({ work: w, followUps: [{ ...nudged, closedBy: "signal" }] })).open.map((l) => l.ruleKey)).toEqual(["blocked:Adatum:202:2"]);
  });
  it("closes when a later fetch shows it no longer blocked or completed", () => {
    const open = [followUp({ id: 4, kind: "blocked", itemId: 202, ruleKey: "blocked:Adatum:202:1" })];
    expect(detectFollowUps(input({ work: [work([item({ id: 202, blocked: false })])], followUps: open })).close).toEqual([{ id: 4, note: "DevOps #202 is no longer blocked" }]);
    expect(detectFollowUps(input({ work: [work([], { watched: [item({ id: 202, state: "Done", stateCategory: "Completed" })] })], followUps: open })).close).toEqual([{ id: 4, note: "DevOps #202 is Done" }]);
    expect(detectFollowUps(input({ work: [work([item({ id: 202, blocked: true })])], followUps: open })).close).toEqual([]);
  });
});

describe("follow-up rule: asked a client about priorities (step 8)", () => {
  const asked = followUp({ id: 7, kind: "priorities", clientKey: "T&W", itemId: null, ruleKey: "priorities:2026-11-09:T&W", refAt: null });
  it("closes when a fresh fetch shows open work assigned to me for that client again", () => {
    const w = work([item({ id: 7001 })], { clientKey: "T&W" });
    expect(detectFollowUps(input({ work: [w], followUps: [asked] })).close).toEqual([{ id: 7, note: "Work is assigned to you at T&W again" }]);
  });
  it("stays open while nothing is assigned, or DevOps can't say", () => {
    expect(detectFollowUps(input({ work: [work([], { clientKey: "T&W" })], followUps: [asked] })).close).toEqual([]);
    expect(detectFollowUps(input({ work: [work([item({ id: 7001 })], { clientKey: "T&W", fromCache: true })], followUps: [asked] })).close).toEqual([]);
    expect(detectFollowUps(input({ work: null, followUps: [asked] })).close).toEqual([]);
  });
});

describe("watched items", () => {
  it("lists the items of open DevOps follow-ups per client, so a fetch can read them by id", () => {
    const followUps = [followUp({}), followUp({ id: 2, kind: "blocked", itemId: 202 }), followUp({ id: 3, kind: "blocked", itemId: 303, closedAt: T("18:00") }), followUp({ id: 4, kind: "slip", itemId: null }), followUp({ id: 5, clientKey: "T&W", itemId: 7 })];
    expect(watchedIds(followUps)).toEqual({ Adatum: [101, 202], "T&W": [7] });
  });
});

describe("heads-up rule (step 13.5): only when the client would notice", () => {
  // Wed Nov 4 is a future day while it is Mon Nov 2.
  const wed = (over: Partial<Pick>) => pick({ id: 20, date: "2026-11-04", half: "AM", status: "moved", updatedAt: T("10:00"), ...over });
  const to = (id: number, date: string, half: Pick["half"] = "AM", over: Partial<Pick> = {}) => pick({ id, date, half, carriedFrom: 20, status: "planned", ...over });

  it("moving a future pick to another day of the same week never opens one", () => {
    const thu = to(21, "2026-11-05");
    expect(detectFollowUps(input({ picks: [wed({}), thu], movedTo: (id) => (id === 20 ? thu : null) })).open).toEqual([]);
  });
  it("committed client work moved to another week opens one, with its origin", () => {
    const next = to(21, "2026-11-10");
    const r = detectFollowUps(input({ picks: [wed({}), next], movedTo: (id) => (id === 20 ? next : null) }));
    expect(r.open).toHaveLength(1);
    expect(r.open[0]!.origin).toEqual({ trigger: "Moved out of the week", items: [{ itemId: 101, title: "Export report" }], at: T("10:00") });
    expect(r.open[0]!.draft).toContain("- #101 Export report: moving to Tue, Nov 10 (morning)");
  });
  it("dropping a future pick opens one only when the item is no longer planned anywhere that week", () => {
    const gone = wed({ status: "dropped" });
    expect(detectFollowUps(input({ picks: [gone] })).open[0]!.origin!.trigger).toBe("Dropped from the week");
    const stillFriday = pick({ id: 30, date: "2026-11-06", half: "AM", status: "planned" });
    expect(detectFollowUps(input({ picks: [gone, stillFriday] })).open).toEqual([]);
  });
  it("a pick that slips on or after its own day opens one", () => {
    const today = pick({ id: 5, status: "moved", updatedAt: T("17:10") });
    const target = pick({ id: 9, date: "2026-11-03", carriedFrom: 5 });
    const r = detectFollowUps(input({ picks: [today, target], movedTo: (id) => (id === 5 ? target : null) }));
    expect(r.open[0]!.origin).toMatchObject({ trigger: "Slipped on its day", items: [{ itemId: 101, title: "Export report" }] });
    const late = pick({ id: 5, date: "2026-10-30", status: "moved", updatedAt: T("09:00") });
    expect(detectFollowUps(input({ picks: [late, target], movedTo: (id) => (id === 5 ? target : null) })).open[0]!.origin!.trigger).toBe("Slipped after its day");
  });
  it("planned picks (reordered, resized) never open one", () => {
    expect(detectFollowUps(input({ picks: [pick({ position: 3, updatedAt: T("17:00") }), pick({ id: 2, size: "L", updatedAt: T("17:01") })] })).open).toEqual([]);
  });
  it("lists each item once, with its latest status (the live T&W case: moved twice, re-added and dropped)", () => {
    const fri1 = pick({ id: 9, date: "2026-11-06", half: "AM", carriedFrom: 6 });
    const fri2 = pick({ id: 11, date: "2026-11-06", half: "AM", carriedFrom: 10 });
    const picks = [
      pick({ id: 6, status: "moved", updatedAt: T("17:43") }),
      pick({ id: 10, status: "moved", updatedAt: T("17:44") }),
      pick({ id: 12, status: "dropped", updatedAt: T("17:45") }),
      fri1,
      fri2,
    ];
    const movedTo = (id: number) => (id === 6 ? fri1 : id === 10 ? fri2 : null);
    const draft = slipDraft("T&W", "2026-11-02", picks.slice(0, 3), movedTo, picks);
    expect(draft.split("\n").filter((l) => l.startsWith("- "))).toEqual(["- #101 Export report: moving to Fri, Nov 6 (morning)"]);
    const r = detectFollowUps(input({ picks, movedTo }));
    expect(r.open[0]!.what).toBe("Heads-up to Adatum about the slip");
  });
  it("redrafts an open heads-up whose draft repeats items, even with nothing new", () => {
    const fri = pick({ id: 9, date: "2026-11-06", half: "AM", carriedFrom: 6 });
    const picks = [pick({ id: 6, status: "moved", updatedAt: T("17:43") }), pick({ id: 12, status: "dropped", updatedAt: T("17:45") }), fri];
    const open = followUp({ id: 1, kind: "slip", itemId: null, ruleKey: "slip:2026-11-02:Adatum:6", detail: { picks: [6, 12], date: "2026-11-02" } });
    const r = detectFollowUps(input({ picks, movedTo: (id) => (id === 6 ? fri : null), followUps: [{ ...open, draft: "old\n- dup\n- dup" }] }));
    expect(r.update).toEqual([expect.objectContaining({ id: 1, what: "Heads-up to Adatum about the slip" })]);
    expect(r.update[0]!.draft.match(/^- /gm)).toHaveLength(1);
  });
  it("review lists open heads-ups that wouldn't open under the new rule; it closes none", () => {
    // Made on Sun Nov 1 for Mon Nov 2: moved to Friday the same week, then a re-added copy dropped while Friday still has it.
    const S = (hm: string) => T(hm, "2026-11-01");
    const fri = pick({ id: 9, date: "2026-11-06", half: "AM", carriedFrom: 6 });
    const picks = [pick({ id: 6, status: "moved", updatedAt: S("11:43") }), pick({ id: 12, status: "dropped", updatedAt: S("11:45") }), fri];
    const open = followUp({ id: 1, kind: "slip", itemId: null, ruleKey: "slip:2026-11-02:Adatum:6", detail: { picks: [6, 12], date: "2026-11-02" } });
    const i = input({ today: "2026-11-01", picks, movedTo: (id) => (id === 6 ? fri : null), followUps: [open] });
    expect(reviewHeadsUps(i)).toEqual([{ id: 1, reason: "Moved within the same week before its day; nothing left the week" }]);
    expect(detectFollowUps(i).close).toEqual([]);
    // Redrafting it never gives it a trigger it didn't have (found live: a made-up "Slipped").
    const re = detectFollowUps(input({ today: "2026-11-01", picks, movedTo: (id) => (id === 6 ? fri : null), followUps: [{ ...open, draft: "old\n- dup\n- dup" }] }));
    expect(re.update).toEqual([expect.objectContaining({ id: 1, origin: null })]);
    // One that still qualifies isn't listed.
    const late = pick({ id: 6, status: "moved", updatedAt: T("17:43") });
    expect(reviewHeadsUps(input({ picks: [late, fri], movedTo: (id) => (id === 6 ? fri : null), followUps: [open] }))).toEqual([]);
  });
});
