// GD-2: the client boundary's pure rules. The audience from real membership (guests, outside tenants and automation
// accounts aren't Cooptimizers); the matcher (whole words, any case, names and aliases from the directory, never inside
// a link or an email address); replace; the exit check (records and links count there; Internal skips it).
// Fictional clients only.
import { describe, expect, it } from "vitest";
import { aChatMember, aClientEntry, HOME_TENANT } from "../test/builders/index.ts";
import { ANOTHER, chatAudience, exitCheck, highlightMatches, mentionedClients, mentionMatches, nameList, replaceMentions, type AudienceRules } from "./boundary.ts";

const rules: AudienceRules = { homeTenant: HOME_TENANT, automation: [], domains: ["contoso.example"] };
const dir = [
  aClientEntry({ key: "Northwind", names: ["Northwind Traders"], aliases: ["NWT"], projects: ["NW Portal"], itemIds: [4410] }),
  aClientEntry({ key: "Fabrikam", names: ["Fabrikam"], aliases: [], projects: ["Fab Ops"], itemIds: [901] }),
  aClientEntry({ key: "Adatum", names: ["Adatum"], projects: ["Adatum Web"], itemIds: [500] }),
];
const names = (t: string, o: { records?: boolean } = {}) => mentionedClients(t, "Adatum", dir, o).map((m) => m.key);

describe("the audience, from the chat's members", () => {
  it("every member a Cooptimizer: internal", () => {
    expect(chatAudience([aChatMember(), aChatMember()], rules)).toBe("internal");
  });

  it("one guest, one outside tenant or one outside address makes it client-facing", () => {
    expect(chatAudience([aChatMember(), aChatMember({ guest: true })], rules)).toBe("client_facing");
    expect(chatAudience([aChatMember(), aChatMember({ external: true })], rules)).toBe("client_facing");
    expect(chatAudience([aChatMember(), aChatMember({ email: "kim@fabrikam.example" })], rules)).toBe("client_facing");
    expect(chatAudience([aChatMember(), aChatMember({ tenantId: null })], rules)).toBe("client_facing");
  });

  it("an automation account isn't a Cooptimizer, so it never makes a chat internal", () => {
    const bot = aChatMember();
    expect(chatAudience([aChatMember(), bot], { ...rules, automation: [bot.userId!] })).toBe("client_facing");
    expect(chatAudience([aChatMember(), bot], { ...rules, notCooptimizer: (id) => id === bot.userId })).toBe("client_facing");
  });

  it("no members known, or no home tenant: client-facing (the safe side)", () => {
    expect(chatAudience([], rules)).toBe("client_facing");
    expect(chatAudience(null, rules)).toBe("client_facing");
    expect(chatAudience([aChatMember()], { ...rules, homeTenant: null })).toBe("client_facing");
  });

  it("membership is read each time: a guest added later makes the same chat client-facing", () => {
    const members = [aChatMember(), aChatMember()];
    expect(chatAudience(members, rules)).toBe("internal");
    expect(chatAudience([...members, aChatMember({ guest: true })], rules)).toBe("client_facing");
  });
});

describe("the matcher", () => {
  it("whole words, any case, names, keys and aliases", () => {
    expect(names("Same as northwind traders did")).toEqual(["Northwind"]);
    expect(names("ask NWT about it")).toEqual(["Northwind"]);
    expect(names("nwt, fabrikam and us")).toEqual(["Northwind", "Fabrikam"]);
    expect(names("Fabrikam's numbers")).toEqual(["Fabrikam"]);
  });

  it("not inside a longer word", () => {
    expect(names("the Northwinds of the world, Fabrikams, unwt")).toEqual([]);
  });

  it("names inside links and email addresses don't count", () => {
    expect(names("see https://contoso.example/sites/Fabrikam/notes and www.northwind.example/x")).toEqual([]);
    expect(names("write to kim@fabrikam.example")).toEqual([]);
  });

  it("the client's own name is never another client", () => {
    expect(names("Adatum asked for this")).toEqual([]);
  });

  it("a chat message's numbers and projects aren't mentions; at an exit (records) they are", () => {
    expect(names("off by 4410 rows in Fab Ops")).toEqual([]);
    expect(names("off by 4410 rows in Fab Ops", { records: true })).toEqual(["Northwind", "Fabrikam"]);
    // A date, a time, an amount or a version isn't an item id.
    expect(names("on 2026-4410, $4410, v1.4410", { records: true })).toEqual([]);
  });
});

describe("GD-3: what a held message matched", () => {
  const dir = [aClientEntry({ key: "contoso", names: ["Contoso"], projects: [], itemIds: [] }), aClientEntry({ key: "Harbor", names: ["Harbor Health"], aliases: ["HH"], projects: ["Wing Portal"], itemIds: [4410], exactCase: true })];
  it("gives the word as the message has it, the longer name winning", () => {
    expect(mentionMatches("Same as Harbor Health last month", "contoso", dir)).toEqual([{ key: "Harbor", word: "Harbor Health" }]);
    expect(mentionMatches("harbor health, as written only", "contoso", dir)).toEqual([]);
  });
  it("never matches item ids, projects, codes or text in links", () => {
    for (const t of ["01J has weight on the other lines", "This screenshot is 04JS", "Image attached", "off by 4410 and #4410", "see https://x.example/Harbor%20Health/a", "Wing Portal"]) expect(mentionMatches(t, "contoso", dir)).toEqual([]);
  });
  it("its own names never count", () => expect(mentionMatches("Contoso again", "contoso", dir)).toEqual([]));
  it("marks only text between tags, whole words, and keeps entities", () => {
    expect(highlightMatches('<p>Harbor Health &amp; <a href="https://x.example/Harbor Health">Harbor Healthy</a></p>', ["Harbor Health"])).toBe('<p><mark class="held-match">Harbor Health</mark> &amp; <a href="https://x.example/Harbor Health">Harbor Healthy</a></p>');
    expect(highlightMatches("<p>AT&amp;T says</p>", ["AT&T"])).toBe('<p><mark class="held-match">AT&amp;T</mark> says</p>');
    expect(highlightMatches("<p>plain</p>", [])).toBe("<p>plain</p>");
  });
});

describe("replace", () => {
  it("each other client's words become \"another client\", longest first; mine and the rest stay", () => {
    expect(replaceMentions("Like Northwind Traders and NWT did for Adatum", "Adatum", dir).text).toBe(`Like ${ANOTHER} and ${ANOTHER} did for Adatum`);
  });

  it("leaves names inside links and addresses alone in words, but a link naming a client goes whole", () => {
    const r = replaceMentions("Fabrikam: https://contoso.example/Fabrikam/notes", "Adatum", dir);
    expect(r.text).toBe(`${ANOTHER}: ${ANOTHER}'s link`);
    expect(r.count).toBe(2);
    expect(replaceMentions("mail kim@contoso.example", "Adatum", dir)).toEqual({ text: "mail kim@contoso.example", count: 0 });
  });
});

describe("the exit check", () => {
  it("names what would go out, with the replaced text; nothing to flag is null", () => {
    expect(exitCheck(["Same fix as #4410", "Fine"], "Adatum", dir)).toEqual({ names: ["Northwind Traders"], replaced: [`Same fix as ${ANOTHER}`, "Fine"] });
    expect(exitCheck(["https://contoso.example/fabrikam/x"], "Adatum", dir)?.names).toEqual(["Fabrikam"]);
    expect(exitCheck(["Fine"], "Adatum", dir)).toBeNull();
  });

  it("Internal targets skip it", () => {
    expect(exitCheck(["Northwind and Fabrikam both"], "Cooptimize", dir, { internal: true })).toBeNull();
  });

  it("names read in plain words", () => {
    expect(nameList(["A"])).toBe("A");
    expect(nameList(["A", "B", "C"])).toBe("A, B and C");
  });
});
