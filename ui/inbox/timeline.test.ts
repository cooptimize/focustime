// IB-2: Everything's rules: every status in one list by latest activity, both directions, day groups, the status chips
// and the new-since divider. Fictional data.
import { describe, expect, it } from "vitest";
import { STATUS_ORDER, statusOf, type InboxItemView, type InboxView } from "../../plan/inbox-items.ts";
import { chatterItem } from "./data.ts";
import { byActivity, clientCountsFor, detailTag, dividerBefore, flatOrder, groupRows, inStatuses, isNewSince, sliceGroups, STATUS_TAG, statusCounts } from "./model.ts";

const TODAY = "2026-11-08";
const row = (key: string, at: string, views: InboxView[], o: Partial<InboxItemView> = {}): InboxItemView => ({ key, kind: "conversation", clientKey: "contoso", at, views, title: key, who: null, where: null, due: null, dueAt: null, itemId: null, late: false, done: false, snoozedUntil: null, ...o });
const name = (k: string) => k;
const items = [
  row("v1", "2026-11-08T15:00:00Z", ["needs_you"]),
  row("v2", "2026-11-08T12:00:00Z", ["teammates"], { clientKey: "fabrikam" }),
  row("c3", "2026-11-07T20:00:00-05:00[America/New_York]", ["promises", "in_progress"], { kind: "promise" }),
  row("k4", "2026-11-07T23:00:00Z", ["captures"], { kind: "capture", clientKey: null }),
  row("d5", "2026-11-06T10:00:00Z", ["captures"], { kind: "draft" }),
  row("c6", "2025-12-31T10:00:00Z", ["waiting"], { kind: "commitment" }),
  row("v7", "2026-11-06T09:00:00Z", ["done"], { done: true }),
  row("h8", "2026-11-05T09:00:00Z", ["chatter"]),
];
const DEFAULTS: InboxView[] = ["needs_you", "promises", "waiting", "in_progress", "captures", "teammates", "done"];

describe("Everything", () => {
  it("lists rows from every status, ordered by latest activity across stamp formats", () => {
    const keys = byActivity(inStatuses(items, [...DEFAULTS, "chatter"], []), "newest").map((r) => r.key);
    expect(keys).toEqual(["v1", "v2", "c3", "k4", "d5", "v7", "h8", "c6"]);
    expect(new Set(keys).size).toBe(items.length);
  });
  it("sorts both ways, and a tie keeps one order", () => {
    expect(byActivity(items, "oldest")[0]!.key).toBe("c6");
    expect(byActivity(items, "oldest").at(-1)!.key).toBe("v1");
    const tie = [row("v9", "2026-11-01T00:00:00Z", ["done"]), row("v2", "2026-11-01T00:00:00Z", ["done"])];
    expect(byActivity(tie, "newest").map((r) => r.key)).toEqual(["v2", "v9"]);
  });
  it("each row has one status tag, whichever views it's in", () => {
    expect(statusOf(["promises", "in_progress"])).toBe("in_progress");
    expect(statusOf(["needs_you", "promises", "in_progress"])).toBe("needs_you");
    expect(statusOf(["done"])).toBe("done");
    for (const v of STATUS_ORDER) expect(STATUS_TAG[v].text).toBeTruthy();
    expect(STATUS_TAG.promises.text).toBe("Promise");
    expect(STATUS_TAG.captures.text).toBe("Capture");
  });
  it("the extra tag only says what the status doesn't", () => {
    expect(detailTag(row("v1", items[0]!.at, ["needs_you"], { conversationView: "needs" }), TODAY)).toBeNull();
    expect(detailTag(row("f1", items[0]!.at, ["needs_you", "promises"], { kind: "promise", late: true, due: "2026-11-06" }), TODAY)?.text).toBe("2 days late");
  });
  it("chatter is a row with status Chatter", () => {
    const r = chatterItem({ key: "hc:x", clientKey: "contoso", clientName: "Contoso", chatId: "x", title: "Lunch?", messages: [{} as never, {} as never], lastAt: "2026-11-08T10:00:00Z" });
    expect(r.views).toEqual(["chatter"]);
    expect(r.where).toBe("2 messages");
  });
});

describe("day headings", () => {
  const G = (sort: "newest" | "oldest") => ({ tz: "America/New_York", sort });
  it("Today, Yesterday, older days and another year, newest first", () => {
    const g = groupRows(items, "day", name, TODAY, G("newest"));
    expect(g.map((x) => x.label)).toEqual(["Today", "Yesterday", "Fri, Nov 6", "Thu, Nov 5", "Wed, Dec 31, 2025"]);
    expect(g[1]!.rows.map((r) => r.key)).toEqual(["c3", "k4"]);
  });
  it("oldest first turns the days and the rows around", () => {
    const g = groupRows(items, "day", name, TODAY, G("oldest"));
    expect(g[0]!.label).toBe("Wed, Dec 31, 2025");
    expect(g.at(-1)!.label).toBe("Today");
    expect(g.at(-1)!.rows.map((r) => r.key)).toEqual(["v2", "v1"]);
  });
  it("the day is the person's: late evening UTC+0 is still yesterday's in New York", () => {
    const g = groupRows([row("v1", "2026-11-08T03:30:00Z", ["done"])], "day", name, TODAY, G("newest"));
    expect(g[0]!.label).toBe("Yesterday");
  });
  it("status groups follow the rail's order", () => {
    expect(groupRows(items, "status", name, TODAY, G("newest")).map((x) => x.label).slice(0, 3)).toEqual(["Needs you", "Waiting on", "In progress"]);
  });
});

describe("the status chips", () => {
  it("filter, and a chip's count is what it alone would show", () => {
    expect(inStatuses(items, ["needs_you"], []).map((r) => r.key)).toEqual(["v1"]);
    expect(inStatuses(items, ["captures", "waiting"], []).map((r) => r.key)).toEqual(["k4", "d5", "c6"]);
    const c = statusCounts(items, []);
    expect(c.captures).toBe(2);
    expect(c.chatter).toBe(1);
    expect(c.promises).toBe(1);
    expect(c.in_progress).toBe(1);
  });
  it("combine with clients (a row with no client only under All)", () => {
    expect(inStatuses(items, DEFAULTS, ["fabrikam"]).map((r) => r.key)).toEqual(["v2"]);
    expect(statusCounts(items, ["fabrikam"]).teammates).toBe(1);
    expect(statusCounts(items, ["contoso"]).captures).toBe(1);
    expect(clientCountsFor(items, DEFAULTS).get("contoso")).toBe(5);
  });
  it("Chatter off by default leaves its rows out", () => {
    expect(inStatuses(items, DEFAULTS, []).some((r) => r.key === "h8")).toBe(false);
    expect(inStatuses(items, [...DEFAULTS, "chatter"], []).some((r) => r.key === "h8")).toBe(true);
  });
});

describe("new since you last looked", () => {
  const SINCE = "2026-11-08T10:00:00Z";
  const newest = byActivity(items, "newest");
  const oldest = byActivity(items, "oldest");
  it("goes above the first older row when newest first", () => expect(dividerBefore(newest, SINCE, "newest")).toBe("c3"));
  it("goes above the first new row when oldest first", () => expect(dividerBefore(oldest, SINCE, "oldest")).toBe("v2"));
  it("moves when the marker does", () => expect(dividerBefore(newest, "2026-11-08T13:00:00Z", "newest")).toBe("v2"));
  it("isn't there with no marker, nothing new, or everything new", () => {
    expect(dividerBefore(newest, null, "newest")).toBeNull();
    expect(dividerBefore(newest, "2026-11-09T00:00:00Z", "newest")).toBeNull();
    expect(dividerBefore(newest, "2020-01-01T00:00:00Z", "newest")).toBeNull();
  });
  it("marks exactly what's after it", () => {
    expect(isNewSince(items[0]!, SINCE)).toBe(true);
    expect(isNewSince(items[3]!, SINCE)).toBe(false);
    expect(isNewSince(items[0]!, null)).toBe(false);
  });
});

describe("loading a long list", () => {
  it("slices across groups without losing the order", () => {
    const groups = groupRows(items, "day", name, TODAY, { tz: "UTC", sort: "newest" });
    const all = flatOrder(groups).map((r) => r.key);
    expect(flatOrder(sliceGroups(groups, 3)).map((r) => r.key)).toEqual(all.slice(0, 3));
    expect(flatOrder(sliceGroups(groups, 100)).map((r) => r.key)).toEqual(all);
  });
});
