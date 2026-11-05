// NV-1: Today's urgent strip: each urgent kind, mine only, and nothing (hidden) when empty.
import { describe, expect, it } from "vitest";
import { aDayPromise } from "../test/builders/index.ts";
import type { UrgentAsk } from "../actions/types.ts";
import { urgentLines } from "./urgent.ts";

const TODAY = "2026-11-05";
const anUrgentAsk = (o: Partial<UrgentAsk> = {}): UrgentAsk => ({ chatId: "c1", messageId: "m1", clientKey: "contoso", clientName: "Contoso", title: "Login is down for the client", at: "2026-11-05T14:00:00Z", ...o });

describe("the urgent strip", () => {
  it("shows a conversation that needs me now, a promise overdue and a promise due today, in that order", () => {
    const lines = urgentLines([anUrgentAsk()], [aDayPromise({ id: 2, dueDate: TODAY, dueAt: "2026-11-05T20:00:00Z" }), aDayPromise({ id: 3, dueDate: "2026-11-03", overdue: true, what: "Reply to Lee", toName: "Lee" })], TODAY);
    expect(lines.map((l) => [l.kind, l.who, l.what])).toEqual([
      ["conversation", "Contoso", "Login is down for the client"],
      ["promise", "Lee", "Reply to Lee"],
      ["promise", "Dana", "Send the export"],
    ]);
  });
  it("leaves out promises due later; a promise to nobody named shows its client", () => {
    expect(urgentLines([], [aDayPromise({ dueDate: "2026-11-06" })], TODAY)).toEqual([]);
    expect(urgentLines([], [aDayPromise({ dueDate: TODAY, toName: null })], TODAY)[0]!.who).toBe("Contoso");
  });
  it("is empty (the strip hides) with nothing urgent", () => {
    expect(urgentLines([], [], TODAY)).toEqual([]);
  });
});
