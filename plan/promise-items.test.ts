// CV-3: likely items for Link existing… on a promise, by rules only: #id first, mine next, then matched words, then
// recency; at most 5, each with a reason; a typed query narrows the same list.
import { describe, expect, it } from "vitest";
import { aWorkItem } from "../test/builders/index.ts";
import { likelyItems, wordsOf } from "./promise-items.ts";

const ME = "sam@contoso.example";
const open = (o: Parameters<typeof aWorkItem>[0]) => aWorkItem({ assignedTo: null, assignedToMe: false, ...o });
const items = [
  open({ id: 11, title: "October filter drops the last day", changedAt: "2026-11-01T10:00:00Z" }),
  open({ id: 12, title: "Shipments report October totals", changedAt: "2026-11-03T10:00:00Z", assignedToEmail: ME }),
  open({ id: 13, title: "Movement dashboard refresh", changedAt: "2026-11-04T10:00:00Z" }),
  open({ id: 14, title: "BOM bridging on a measure change", changedAt: "2026-10-20T10:00:00Z" }),
  open({ id: 15, title: "Vendor portal login", changedAt: "2026-11-04T12:00:00Z", assignedToMe: true }),
];

describe("likely items for a promise", () => {
  it("drops stopwords and short words, and meets plurals", () => {
    expect(wordsOf("I'll fix the October totals tonight, see #4417")).toEqual(["october", "total", "4417"]);
  });

  it("puts a #id first, then mine, then the most matched words, with reasons", () => {
    const r = likelyItems({ texts: ["I'll check the October totals and the filter", "The October filter drops the last day? Also #14"], items, myEmail: ME });
    expect(r.map((x) => x.id)).toEqual([14, 12, 11]);
    expect(r.map((x) => x.reason)).toEqual(["Mentioned as #14", "Assigned to you · matches october, totals", "Matches october, filter, drops"]);
  });

  it("shows my items when nothing matches, and a typed query narrows by title or #id", () => {
    expect(likelyItems({ texts: ["I'll call them back"], items, myEmail: ME }).map((x) => [x.id, x.reason])).toEqual([[15, "Assigned to you"], [12, "Assigned to you"]]);
    expect(likelyItems({ texts: ["October"], items, myEmail: ME, query: "dashboard" }).map((x) => x.id)).toEqual([13]);
    expect(likelyItems({ texts: [], items, myEmail: ME, query: "#11" }).map((x) => x.id)).toEqual([11]);
  });

  it("keeps at most 5 and ranks the conversation's likely item first", () => {
    const many = Array.from({ length: 9 }, (_, n) => open({ id: 100 + n, title: `Export step ${n}` }));
    expect(likelyItems({ texts: ["the export"], items: many, myEmail: null })).toHaveLength(5);
    expect(likelyItems({ texts: ["the export"], items: many, myEmail: null, suggestedId: 108 })[0]).toMatchObject({ id: 108, reason: "Likely for this conversation · matches export" });
  });
});
