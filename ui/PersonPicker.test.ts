// CV-2: what the PersonPicker shows as you type: every typed word starts a word of the name (accents ignored), the
// "Everyone at Cooptimize" group capped until you type, and the link offer only when exactly one person matches.
import { describe, expect, it } from "vitest";
import type { PeoplePickerData, PickerPerson } from "../actions/people-picker.ts";
import { exactMatch, filterGroups } from "./PersonPicker.tsx";
import { suggest } from "../plan/capture.ts";
import { aPickerPerson } from "../test/builders/index.ts";

const coop = (name: string, id = name.toLowerCase().replace(/\W/g, "")): PickerPerson => ({ name, ref: { kind: "cooptimizer", id, name }, email: `${id}@contoso.example`, external: false });
const data: PeoplePickerData = {
  problems: [],
  groups: [
    { key: "conversation", label: "In this conversation", people: [{ name: "Blake Novak", ref: { kind: "external", memberId: "b1", name: "Blake Novak" }, email: null, external: true }, coop("Evan Ford")] },
    { key: "client", label: "On Contoso Supply", people: [coop("Lena Hart")] },
    { key: "everyone", label: "Everyone at Cooptimize", people: [coop("José Ruiz"), ...Array.from({ length: 40 }, (_, i) => coop(`Person ${i}`))] },
  ],
};

describe("PersonPicker", () => {
  it("narrows by the start of each word, ignoring case and accents; caps Everyone until you type", () => {
    expect(filterGroups(data, "").map((g) => [g.key, g.people.length])).toEqual([["conversation", 2], ["client", 1], ["everyone", 30]]);
    expect(filterGroups(data, "nov").flatMap((g) => g.people.map((p) => p.name))).toEqual(["Blake Novak"]);
    expect(filterGroups(data, "jose r").flatMap((g) => g.people.map((p) => p.name))).toEqual(["José Ruiz"]);
    expect(filterGroups(data, "person 3").flatMap((g) => g.people.map((p) => p.name))).toEqual(["Person 3", "Person 30", "Person 31", "Person 32", "Person 33", "Person 34", "Person 35", "Person 36", "Person 37", "Person 38", "Person 39"]);
    expect(filterGroups(data, "zzz")).toEqual([]);
  });

  it("offers to link plain text only when exactly one person has that name", () => {
    expect(exactMatch(data, " evan ford ")?.ref).toEqual({ kind: "cooptimizer", id: "evanford", name: "Evan Ford" });
    expect(exactMatch(data, "Evan")).toBeNull();
    const twice: PeoplePickerData = { problems: [], groups: [{ key: "everyone", label: "x", people: [coop("Sam Lee", "a"), coop("Sam Lee", "b")] }] };
    expect(exactMatch(twice, "Sam Lee")).toBeNull();
  });
});

describe("CV-3: Capture's Who", () => {
  it("starts from the rules' name as plain text and offers the link only when it matches exactly one person", () => {
    const people: PeoplePickerData = { problems: [], groups: [{ key: "everyone", label: "Everyone at Cooptimize", people: [aPickerPerson({ name: "Evan Ford" }), aPickerPerson({ name: "Dana Lee" }), aPickerPerson({ name: "Dana Lee" })] }] };
    const who = (text: string) => suggest(text, null, "2026-11-05", []).who;
    expect(exactMatch(people, who("Told Evan Ford I'd send the totals"))?.name).toBe("Evan Ford");
    expect(exactMatch(people, who("Promised Dana Lee the export"))).toBeNull(); // two people with that name: no offer
    expect(exactMatch(people, who("Owe Sam a call"))).toBeNull();
  });
});
