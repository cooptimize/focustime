// Step 17.5: the opening's loader timing and what a source says while loading; BR-1: the pass and the 8 second line.
import { describe, expect, it } from "vitest";
import type { SourceSummary } from "../../actions/types.ts";
import type { ClientWork } from "../../week/types.ts";
import { openingAt, passWait, sourceLines, waitingLine } from "./opening.ts";

const src = (source: SourceSummary["source"], status: SourceSummary["status"]) => ({ source, status, fetchedAt: null, fromCache: false, itemCount: 0 }) as SourceSummary;
const client = (status: ClientWork["status"]) => ({ status }) as ClientWork;

describe("the loader", () => {
  it("never shows when the first load finishes within 400 ms", () => {
    for (const now of [0, 200, 399, 400, 2000]) expect(openingAt(now, 350).loader).toBe(false);
    expect(openingAt(1000, 400)).toEqual({ loader: false, revealAt: 400 });
  });
  it("shows from 400 ms while loading", () => {
    expect(openingAt(399, null).loader).toBe(false);
    expect(openingAt(400, null)).toEqual({ loader: true, revealAt: null });
    expect(openingAt(5000, null).loader).toBe(true);
  });
  it("once shown, stays at least 600 ms", () => {
    expect(openingAt(420, 410)).toEqual({ loader: true, revealAt: 1000 });
    expect(openingAt(999, 410).loader).toBe(true);
    expect(openingAt(1000, 410).loader).toBe(false);
    // A slow load reveals as soon as it's done.
    expect(openingAt(3000, 3000)).toEqual({ loader: false, revealAt: 3000 });
  });
});

describe("the mark's pass and the 8 second line (BR-1)", () => {
  it("waits for every block to be lit, never more than one pass's lighting", () => {
    expect(passWait(0)).toBe(0); // not shown yet
    expect(passWait(400)).toBe(960); // the pass just started
    expect(passWait(400 + 500)).toBe(460);
    expect(passWait(400 + 960)).toBe(0); // all lit
    expect(passWait(400 + 1400)).toBe(0); // dimming: the move lights them again
    expect(passWait(400 + 1600 + 100)).toBe(860); // the next pass
  });
  it("names at most two things still waited on, then how many more", () => {
    const w = (...names: string[]) => names.map((name) => ({ name, state: "waiting" as const }));
    expect(waitingLine(w("Outlook"))).toBe("Still waiting on Outlook");
    expect(waitingLine(w("Outlook", "Google"))).toBe("Still waiting on Outlook and Google");
    expect(waitingLine(sourceLines(null, null))).toBe("Still waiting on Dataverse, Outlook and 2 more");
    expect(waitingLine([{ name: "Outlook", state: "done" }, { name: "Google", state: "failed" }])).toBeNull();
  });
});

describe("source lines while loading", () => {
  it("every source waits until the week arrives", () => {
    expect(sourceLines(null, null).map((l) => `${l.name} ${l.state}`)).toEqual(["Dataverse waiting", "Outlook waiting", "Google waiting", "DevOps waiting"]);
  });
  it("a failed source shows failed, never done, and doesn't hold the others back", () => {
    const lines = sourceLines([src("dataverse", "ok"), src("outlook", "unreachable"), src("google", "auth_required")], [client("ok"), client("not_set_up")]);
    expect(lines.map((l) => `${l.name} ${l.state}`)).toEqual(["Dataverse done", "Outlook failed", "Google failed", "DevOps done"]);
  });
  it("DevOps fails when a client's fetch fails or Dataverse couldn't find them", () => {
    expect(sourceLines([src("dataverse", "ok")], [client("ok"), client("auth_failed")]).at(-1)).toEqual({ name: "DevOps", state: "failed" });
    expect(sourceLines([src("dataverse", "error")], null).map((l) => l.state)).toEqual(["failed", "failed"]);
  });
});
