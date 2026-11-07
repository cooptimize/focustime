// AS-2: the server-side resolver. It finds my to-dos by their parent feature, items by #id or title, and never chooses
// between two that fit.
import { describe, expect, it } from "vitest";
import { aPick, anAheadItem } from "../test/builders/index.ts";
import { resolve, type ResolveClient } from "./resolve.ts";

const story = (id: number, title: string, parentId: number) => anAheadItem({ id, title, type: "User Story", level: "child", rung: 2, parentId });
const nwt: ResolveClient = {
  clientKey: "nwt",
  items: [anAheadItem({ id: 700, title: "Freshness Alert", type: "Feature" }), story(701, "Flag late alerts", 700), story(702, "Alert banner", 700), anAheadItem({ id: 800, title: "Exports", type: "Feature" }), story(801, "CSV export", 800)],
};
const fab: ResolveClient = { clientKey: "fab", items: [anAheadItem({ id: 900, title: "Invoice export", type: "Feature" }), story(901, "Stored procedure fields for XYZ", 900)] };
const WED = "2026-11-04";
const picks = [
  aPick({ id: 1, clientKey: "nwt", itemId: 701, title: "Flag late alerts", date: WED, half: "PM" }),
  aPick({ id: 2, clientKey: "nwt", itemId: 702, title: "Alert banner", date: WED, half: "AM" }),
  aPick({ id: 3, clientKey: "nwt", itemId: 801, title: "CSV export", date: WED, half: "PM" }),
  aPick({ id: 4, clientKey: "fab", itemId: 901, title: "Stored procedure fields for XYZ", date: WED, half: "PM" }),
];
const mine = () => true;

describe("resolve (AS-2)", () => {
  it("the stories under the Freshness Alert feature are my to-dos whose item's parent is that feature, in one client", () => {
    const r = resolve("on wednesday I wasn't able to work on the user stories under the freshness alert feature. can you move those to friday on my board?", [nwt, fab], picks, mine);
    expect(r.picks.map((m) => m.pick.id)).toEqual([1, 2]);
    expect(r.picks[0]!.feature).toEqual({ id: 700, title: "Freshness Alert" });
    expect(r.clients).toEqual(["nwt"]);
    expect(r.ambiguous).toBeNull();
  });

  it("a reply that names the feature resolves it too", () => {
    expect(resolve("Cant you read that the Feature name theyre under is freshness alert", [nwt, fab], picks, mine).picks.map((m) => m.pick.id)).toEqual([1, 2]);
  });

  it("finds an item by #id and by \"the user story for …\"", () => {
    expect(resolve("what's the state of #801", [nwt, fab], picks, mine).items.map((i) => i.id)).toEqual([801]);
    const r = resolve("Mark the user story for XYZ as complete and add a comment", [nwt, fab], picks, mine);
    expect(r.items.map((i) => [i.clientKey, i.id])).toEqual([["fab", 901]]);
    expect(r.clients).toEqual(["fab"]);
  });

  it("matches in two clients come back with both clients", () => {
    const other: ResolveClient = { clientKey: "nw", items: [anAheadItem({ id: 300, title: "Freshness Alert", type: "Feature" }), story(301, "Nightly check", 300)] };
    const r = resolve("move the freshness alert stories to friday", [nwt, other], [...picks, aPick({ id: 9, clientKey: "nw", itemId: 301, title: "Nightly check", date: WED })], mine);
    expect(r.clients.sort()).toEqual(["nw", "nwt"]);
  });

  it("never guesses between two that fit a phrase", () => {
    const r = resolve("mark the story for export as done", [nwt, fab], picks, mine);
    expect(r.items).toEqual([]);
    expect(r.ambiguous?.options.map((o) => o.id).sort()).toEqual([801, 900]);
  });

  it("one-word titles and another person's clients never match by words alone", () => {
    expect(resolve("move my exports to friday", [nwt], picks, mine).items).toEqual([]);
    expect(resolve("the freshness alert feature", [nwt], picks, (k) => k !== "nwt").picks).toEqual([]);
  });
});
