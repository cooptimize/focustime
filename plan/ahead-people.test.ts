// AH-5: the assignee list's rules: real people from a team members answer, one entry per person (a client login is
// its Cooptimizer), me first, then people assigned here, then by name; search by name or domain; short names.
import { describe, expect, it } from "vitest";
import { assignPeople, searchPeople, shortName, teamPeople } from "./ahead-people.ts";

describe("teamPeople", () => {
  it("keeps people, drops groups, service accounts and deleted identities", () => {
    expect(
      teamPeople([
        { identity: { displayName: "Morgan Lee", uniqueName: "Morgan.Lee@Northwind.example" } },
        { identity: { displayName: "[Portal]\\\\Portal Team", uniqueName: "vstfs:///Classification/TeamProject/x", isContainer: true } },
        { identity: { displayName: "Readers", uniqueName: "readers@northwind.example", descriptor: "vssgp.Uy0xLTk" } },
        { identity: { displayName: "Portal Build Service", uniqueName: "00000002-0000-8888-8000-000000000000" } },
        { identity: { displayName: "Gone", uniqueName: "gone@northwind.example", isDeletedInOrigin: true } },
        { identity: null },
      ]),
    ).toEqual([{ email: "morgan.lee@northwind.example", name: "Morgan Lee" }]);
  });
});

describe("assignPeople", () => {
  const base = {
    mine: ["me@cooptimize.example", "ext-me@northwind.example"],
    myName: "Alex Rivera",
    cooptimizers: [{ email: "dana@cooptimize.example", name: "Dana Reyes" }],
    loginOf: (e: string) => (e === "ext-dana@northwind.example" ? "dana@cooptimize.example" : null),
    isCooptimizer: (e: string) => e.endsWith("@cooptimize.example"),
  };
  it("folds client logins into their person, orders me, assigned, then by name, and marks who's outside", () => {
    const list = assignPeople({
      ...base,
      project: [{ email: "ext-me@northwind.example", name: "Ext-Alex" }, { email: "ext-dana@northwind.example", name: "Ext-Dana" }, { email: "zoe@northwind.example", name: "Zoe Park" }, { email: "ari@northwind.example", name: "ari bell" }],
      assignees: [{ email: "zoe@northwind.example", name: "Zoe Park" }],
    });
    expect(list.map((p) => [p.name, p.email, p.external, p.me, p.assigned])).toEqual([
      ["Alex Rivera", "me@cooptimize.example", false, true, false],
      ["Zoe Park", "zoe@northwind.example", true, false, true],
      ["ari bell", "ari@northwind.example", true, false, false],
      ["Dana Reyes", "dana@cooptimize.example", false, false, false],
    ]);
  });
  it("searches by name words or domain; 'me' finds me", () => {
    const list = assignPeople({ ...base, project: [{ email: "zoe@northwind.example", name: "Zoe Park" }], assignees: [] });
    expect(searchPeople(list, "park z").map((p) => p.name)).toEqual(["Zoe Park"]);
    expect(searchPeople(list, "northwind").map((p) => p.name)).toEqual(["Zoe Park"]);
    expect(searchPeople(list, "me").map((p) => p.name)).toEqual(["Alex Rivera"]);
    expect(searchPeople(list, "").length).toBe(3);
  });
  it("shortName is first name and last initial", () => {
    expect(shortName("Tanner Spaulding")).toBe("Tanner S.");
    expect(shortName("Mary Ann van der Berg")).toBe("Mary B.");
    expect(shortName("Cher")).toBe("Cher");
  });
});
