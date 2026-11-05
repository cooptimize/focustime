// NV-1: the Inbox badge counts what needs me: Needs you, and my follow-ups and promises due today or overdue.
import { describe, expect, it } from "vitest";
import { aDayPromise, aFollowUpView } from "../test/builders/index.ts";
import { duePromises, inboxBadge } from "./inboxcount.ts";

const TODAY = "2026-11-05";

describe("the Inbox badge", () => {
  it("Needs you plus follow-ups and promises due today or overdue", () => {
    const data = {
      followUps: [aFollowUpView({ id: 1, due: TODAY }), aFollowUpView({ id: 2, due: "2026-11-03" }), aFollowUpView({ id: 3, due: "2026-11-09" }), aFollowUpView({ id: 4, due: null })],
      promises: [aDayPromise({ id: 1, dueDate: TODAY }), aDayPromise({ id: 2, dueDate: "2026-11-04", overdue: true }), aDayPromise({ id: 3, dueDate: "2026-11-06" })],
    };
    expect(inboxBadge(3, data, TODAY)).toBe(3 + 2 + 2);
  });
  it("open follow-ups not yet due, closed ones and no count yet add nothing", () => {
    expect(inboxBadge(null, { followUps: [aFollowUpView({ due: "2026-11-20" }), aFollowUpView({ due: TODAY, closedAt: "2026-11-05T10:00:00Z" })], promises: [] }, TODAY)).toBe(0);
    expect(duePromises(undefined, TODAY)).toBe(0);
  });
});
