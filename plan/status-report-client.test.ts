// SR-2: the client report's pure rules: Kat's watermark exactly (an empty one is 1900-01-01, an edit brings an older
// comment in), backlog order and the comment order, authors as DevOps shows them, which features are read, No update
// yet, and the PTO lines.
import { describe, expect, it } from "vitest";
import { aReportComment, aReportItem } from "../test/builders/index.ts";
import { clientReportWindow, KAT_EPOCH, noUpdateYet, ptoRuns, ptoWhen, reportBody, reportCandidates, reportHeader } from "./status-report.ts";

const NOW = Temporal.Instant.from("2026-11-05T15:00:00Z"); // Thursday 10:00 AM in New York
const SENT = "2026-11-02T12:04:00Z";
const nobody = () => false;

describe("the client report's window (SR-2)", () => {
  it("is Kat's watermark as it is, even one older than SR-1's 35 days", () => {
    expect(clientReportWindow({ ok: true, sentAt: SENT }, NOW)).toEqual({ since: SENT, source: "kat", katSentAt: SENT });
    expect(clientReportWindow({ ok: true, sentAt: "2026-08-03T11:00:00Z" }, NOW).since).toBe("2026-08-03T11:00:00Z");
  });
  it("an empty watermark covers everything (1900-01-01)", () => {
    expect(clientReportWindow({ ok: true, sentAt: null }, NOW)).toEqual({ since: KAT_EPOCH, source: "never", katSentAt: null });
    expect(KAT_EPOCH).toBe("1900-01-01T00:00:00Z");
  });
  it("only an unreadable one falls back to Monday 7:00 AM ET, and says it's unknown", () => {
    expect(clientReportWindow({ ok: false }, NOW)).toMatchObject({ since: "2026-11-02T12:00:00Z", source: "unknown" });
    expect(clientReportWindow({ ok: true, sentAt: "garbage" }, NOW)).toMatchObject({ source: "unknown" });
  });
  it("the header names Monday, Kat's time and the last send", () => {
    expect(reportHeader("2026-11-09", clientReportWindow({ ok: true, sentAt: SENT }, NOW), "America/Chicago")).toBe("Draft for Monday, Nov 9 · Kat sends it at 7:00 AM · last sent Nov 2");
    expect(reportHeader("2026-11-09", clientReportWindow({ ok: true, sentAt: null }, NOW), "America/Chicago")).toBe("Draft for Monday, Nov 9 · Kat sends it at 7:00 AM · not sent yet");
  });
});

describe("the report's features and comments (SR-2)", () => {
  const a = aReportItem({ id: 10, order: 300 });
  const b = aReportItem({ id: 11, order: 100 });
  const c = aReportItem({ id: 12, order: null });
  const story = aReportItem({ id: 20, level: "child", parentId: 10 });

  it("filters by the comment's modified date: an edited older comment is in, an unedited one isn't", () => {
    const comments = {
      10: [aReportComment({ id: 1, createdAt: "2026-10-28T10:00:00Z", modifiedAt: "2026-11-03T09:00:00Z" })],
      11: [aReportComment({ id: 2, createdAt: "2026-10-28T10:00:00Z", modifiedAt: "2026-10-28T10:00:00Z" })],
      12: [aReportComment({ id: 3, createdAt: "2026-11-02T12:04:00Z" })], // exactly at the watermark: in
    };
    const body = reportBody([a, b, c, story], comments, SENT, nobody, true);
    expect(body.map((x) => x.item.id)).toEqual([10, 12]);
    expect(body[0]!.comments.map((x) => x.id)).toEqual([1]);
  });
  it("an empty watermark covers every comment", () => {
    const comments = { 11: [aReportComment({ id: 4, createdAt: "2019-01-01T00:00:00Z" })] };
    expect(reportBody([b], comments, KAT_EPOCH, nobody, true).map((x) => x.item.id)).toEqual([11]);
  });
  it("is in backlog stack-rank order (unset last), each feature's comments oldest first", () => {
    const comments = {
      10: [aReportComment({ id: 5, createdAt: "2026-11-04T10:00:00Z" }), aReportComment({ id: 6, createdAt: "2026-11-03T10:00:00Z" })],
      11: [aReportComment({ id: 7, createdAt: "2026-11-03T10:00:00Z" })],
      12: [aReportComment({ id: 8, createdAt: "2026-11-03T10:00:00Z" })],
    };
    const body = reportBody([a, b, c], comments, SENT, nobody, true);
    expect(body.map((x) => x.item.id)).toEqual([11, 10, 12]);
    expect(body[1]!.comments.map((x) => x.id)).toEqual([6, 5]);
  });
  it("shows authors as DevOps shows them, mine and Coop's included, and only mine editable", () => {
    const comments = {
      10: [
        aReportComment({ id: 1, authorName: "Ext-Dana Reyes", authorUnique: "ext-dana@client.example", createdAt: "2026-11-03T10:00:00Z" }),
        aReportComment({ id: 2, authorName: "Lee Lead", authorUnique: "lee@contoso.example", createdAt: "2026-11-03T11:00:00Z" }),
        aReportComment({ id: 3, authorName: "Lee Lead", authorUnique: "lee@contoso.example", text: "[Coop update v1]\nDone.", createdAt: "2026-11-03T12:00:00Z" }),
      ],
    };
    const body = reportBody([a], comments, SENT, (u) => u === "lee@contoso.example", true);
    expect(body[0]!.comments.map((x) => [x.authorName, x.who, x.editable])).toEqual([["Ext-Dana Reyes", "teammate", false], ["Lee Lead", "mine", true], ["Lee Lead", "coop", false]]);
  });
  it("reads active features first, then those changed since the watermark, then other open ones, up to the cap", () => {
    const items = [
      { ...aReportItem({ id: 1, order: 1 }), changedAt: "2026-10-01T00:00:00Z" },
      { ...aReportItem({ id: 2, order: 2 }), changedAt: "2026-11-03T00:00:00Z" },
      { ...aReportItem({ id: 3, order: 3, stateCategory: "Completed" }), changedAt: "2026-10-01T00:00:00Z" },
      { ...aReportItem({ id: 4, order: 4 }), changedAt: "2026-10-01T00:00:00Z" },
      { ...aReportItem({ id: 5, order: 5, stateCategory: "Completed" }), changedAt: "2026-11-04T00:00:00Z" },
    ];
    expect(reportCandidates(items, SENT, new Set([4]))).toEqual([4, 2, 5, 1]);
    expect(reportCandidates(items, SENT, new Set([4]), 2)).toEqual([4, 2]);
  });
});

describe("No update yet (SR-2)", () => {
  it("lists features active this week (planned, or a story with activity) that aren't in the report, with owners", () => {
    const items = [
      aReportItem({ id: 10, order: 2 }),
      aReportItem({ id: 11, order: 1 }),
      aReportItem({ id: 12, order: 3 }),
      aReportItem({ id: 13, order: 4 }),
      aReportItem({ id: 20, level: "child", parentId: 11 }),
      aReportItem({ id: 21, level: "task", parentId: 20 }),
    ];
    const owners: Record<number, string> = { 11: "Sam Park", 12: "Dana Reyes" };
    const out = noUpdateYet({ items, inReport: new Set([10]), planned: [10, 12], activity: [21], ownerName: (id) => owners[id] ?? null });
    expect(out.map((x) => [x.item.id, x.owner, x.why])).toEqual([[11, "Sam Park", "activity"], [12, "Dana Reyes", "planned"]]);
  });
});

describe("Upcoming PTO and Holidays (SR-2)", () => {
  it("groups each person's days into runs (a weekend doesn't break one), sorted by date then name", () => {
    const runs = ptoRuns([
      { name: "Sam", date: "2026-11-13" }, { name: "Sam", date: "2026-11-16" },
      { name: "Ana", date: "2026-11-10" }, { name: "Ana", date: "2026-11-11" }, { name: "Ana", date: "2026-11-20" },
      { name: "Bo", date: "2026-11-10" },
    ]);
    expect(runs).toEqual([
      { name: "Ana", from: "2026-11-10", to: "2026-11-11", days: 2 },
      { name: "Bo", from: "2026-11-10", to: "2026-11-10", days: 1 },
      { name: "Sam", from: "2026-11-13", to: "2026-11-16", days: 2 },
      { name: "Ana", from: "2026-11-20", to: "2026-11-20", days: 1 },
    ]);
    expect(ptoWhen(runs[0]!)).toBe("Tue, Nov 10 to Wed, Nov 11");
    expect(ptoWhen(runs[1]!)).toBe("Tue, Nov 10");
  });
});
