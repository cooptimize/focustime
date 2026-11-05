import { describe, expect, it } from "vitest";
import { clientIdentities, identityIndex, nameKey, stripLogin, type IdentityPerson, type IdentityRow } from "./identities.ts";

const DANA: IdentityPerson = { id: "p-dana", name: "Dana Reyes", emails: ["dana@cooptimize.example"] };
const SAM: IdentityPerson = { id: "p-sam", name: "Sam Ortiz", emails: ["sam@cooptimize.example"] };
const SAM2: IdentityPerson = { id: "p-sam2", name: "Sam Ortiz", emails: ["sam.o@cooptimize.example"] };
const LEE: IdentityPerson = { id: "p-lee", name: "Lee Park", emails: ["lee@cooptimize.example"] };
const row = (o: Partial<IdentityRow> & Pick<IdentityRow, "email" | "personId" | "source">): IdentityRow => ({ clientKey: "Fabrikam", name: null, ...o });

describe("client-login names (AH-3)", () => {
  it("strips the prefixes and suffixes clients put on outside logins, and says when it did", () => {
    for (const n of ["Ext-Dana Reyes", "EXT_Dana Reyes", "ext.Dana Reyes", "X-Dana Reyes", "Ext Dana Reyes", "Dana Reyes (External)", "Dana Reyes [Contractor]", "Dana Reyes - Ext", "Dana Reyes_ext", "Guest: Dana Reyes"]) expect(stripLogin(n), n).toEqual({ base: "Dana Reyes", stripped: true });
    expect(stripLogin("Dana Reyes")).toEqual({ base: "Dana Reyes", stripped: false });
    // A first name that starts like a prefix stays whole.
    expect(stripLogin("Xavier Extons").stripped).toBe(false);
    expect(stripLogin("Ext").stripped).toBe(false);
  });
  it("compares names without case, accents or a Last, First order", () => {
    expect(nameKey("Reyes, Dana")).toBe(nameKey("dana  reyes"));
    expect(nameKey("José Núñez")).toBe("jose nunez");
  });
});

describe("the identity index (AH-3)", () => {
  it("maps a Dataverse identity and a confirmed link to the person on that client only; an admin's removal hides a Dataverse one", () => {
    const ix = identityIndex(
      [
        row({ email: "Ext-Dana@Fabrikam.example", personId: "p-dana", source: "dataverse" }),
        row({ email: "ext-sam@fabrikam.example", personId: "p-sam", source: "link", name: "Ext-Sam Ortiz" }),
        row({ email: "lee.x@fabrikam.example", personId: "p-lee", source: "dataverse" }),
        row({ email: "lee.x@fabrikam.example", personId: "p-lee", source: "unlink" }),
      ],
      [DANA, SAM, LEE],
    );
    expect(ix.personOf("Fabrikam", "ext-dana@fabrikam.example")?.name).toBe("Dana Reyes");
    expect(ix.personOf("Fabrikam", "ext-sam@fabrikam.example")?.name).toBe("Sam Ortiz");
    expect(ix.personOf("Contoso", "ext-dana@fabrikam.example")).toBeNull();
    expect(ix.personOf("Fabrikam", "lee.x@fabrikam.example")).toBeNull();
    // Their own address is them on every client.
    expect(ix.personOf("Contoso", "DANA@cooptimize.example")?.id).toBe("p-dana");
    expect(ix.emailsOf("Fabrikam", "p-dana").sort()).toEqual(["dana@cooptimize.example", "ext-dana@fabrikam.example"]);
    expect(ix.emailsOf("Contoso", "p-dana")).toEqual(["dana@cooptimize.example"]);
    expect(ix.linked.map((l) => [l.email, l.source])).toEqual([["ext-dana@fabrikam.example", "dataverse"], ["ext-sam@fabrikam.example", "link"]]);
  });
  it("ignores links to people who aren't Cooptimizers (any more)", () => {
    const ix = identityIndex([row({ email: "ext-gone@fabrikam.example", personId: "p-gone", source: "link" })], [DANA]);
    expect(ix.personOf("Fabrikam", "ext-gone@fabrikam.example")).toBeNull();
  });
});

describe("a client's identities: counts, suggestions, unmatched (AH-3)", () => {
  const assignees = [
    { email: "ext-dana@fabrikam.example", name: "Ext-Dana Reyes" },
    { email: "lee.park@fabrikam.example", name: "Lee Park" },
    { email: "ext-sam@fabrikam.example", name: "Ext-Sam Ortiz" },
    { email: "ext-kim@fabrikam.example", name: "Ext-Kim Lo" },
    { email: "pat@fabrikam.example", name: "Pat Client" },
    { email: "dana@cooptimize.example", name: "Dana Reyes" },
  ];
  it("suggests exactly one Cooptimizer by name; never applies it; counts linked ones; the rest that look like logins are unmatched", () => {
    const ix = identityIndex([row({ email: "ext-dana@fabrikam.example", personId: "p-dana", source: "dataverse" })], [DANA, SAM, SAM2, LEE]);
    const c = clientIdentities(ix, "Fabrikam", assignees);
    expect(c.suggestions.map((s) => [s.name, s.personName])).toEqual([["Lee Park", "Lee Park"]]);
    // Two Sam Ortizes: not sure, so no suggestion.
    expect(c.unmatched.map((u) => u.name)).toEqual(["Ext-Sam Ortiz", "Ext-Kim Lo"]);
    expect(c).toMatchObject({ looks: 4, linked: 1 });
    // A suggestion isn't a link.
    expect(ix.personOf("Fabrikam", "lee.park@fabrikam.example")).toBeNull();
  });
  it("doesn't suggest again what an admin removed, and counts a linked identity that has nothing assigned now", () => {
    const ix = identityIndex(
      [row({ email: "lee.park@fabrikam.example", personId: "p-lee", source: "unlink" }), row({ email: "ext-sam@fabrikam.example", personId: "p-sam", source: "link" })],
      [DANA, SAM, LEE],
    );
    const c = clientIdentities(ix, "Fabrikam", [{ email: "lee.park@fabrikam.example", name: "Lee Park" }]);
    expect(c.suggestions).toEqual([]);
    expect(c.unmatched.map((u) => u.name)).toEqual(["Lee Park"]);
    expect(c).toMatchObject({ looks: 2, linked: 1 });
  });
});
