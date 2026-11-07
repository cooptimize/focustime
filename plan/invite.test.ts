// IN-1: the invite's message and links. The message says what FocusTime is, links to this environment's app and gives
// the first three steps; the Teams app only when it's set up. Links carry the recipients' addresses, the subject and
// the message, nothing else; a person's first name replaces the token, "all" in one email to several.
import { describe, expect, it } from "vitest";
import { inviteTemplate, mailtoLink, matchesFilter, NAME_TOKEN, outlookComposeLink, partlySetUp, personalize, setupCounts, teamsAppLink, teamsChatLink, type SetupMarks } from "./invite.ts";

const APP = "https://focustime-dev.example.com/";
const TEAMS_ID = "6f84bb2c-364d-4d76-8a62-153904d0551a";

describe("the invite message", () => {
  it("says what FocusTime is, links to the app given, and lists the three first steps", () => {
    const m = inviteTemplate({ appUrl: APP, teamsAppLink: null, from: "Ada Admin" });
    expect(m).toContain(`Hi ${NAME_TOKEN},`);
    expect(m).toContain(`Open it here: ${APP}`);
    expect(m).toMatch(/1\. Sign in.*\n2\. Connect DevOps in Settings › DevOps\.\n3\. Look at Week/s);
    expect(m).not.toMatch(/teams\.microsoft\.com/);
    expect(m.trim().endsWith("Ada")).toBe(true);
    expect(m).not.toContain("—");
  });

  it("adds the Teams app only when its id is configured", () => {
    expect(teamsAppLink(null)).toBeNull();
    expect(teamsAppLink("not-an-id")).toBeNull();
    const link = teamsAppLink(TEAMS_ID)!;
    expect(link).toBe(`https://teams.microsoft.com/l/app/${TEAMS_ID}`);
    expect(inviteTemplate({ appUrl: APP, teamsAppLink: link, from: "Ada" })).toContain(`add FocusTime in Teams: ${link}`);
  });

  it("puts the first name in for one person and 'all' for one email to several", () => {
    const m = `Hi ${NAME_TOKEN}, welcome ${NAME_TOKEN}`;
    expect(personalize(m, "Cy Person")).toBe("Hi Cy, welcome Cy");
    expect(personalize(m, null)).toBe("Hi all, welcome all");
  });
});

describe("the links", () => {
  it("Teams: a 1:1 chat with that person, the message prefilled, nothing else in the link", () => {
    const href = teamsChatLink("cy@cooptimize.example", "Hi Cy,\nOpen it & go");
    const u = new URL(href);
    expect(u.origin + u.pathname).toBe("https://teams.microsoft.com/l/chat/0/0");
    expect([...u.searchParams.keys()]).toEqual(["users", "message"]);
    expect(u.searchParams.get("users")).toBe("cy@cooptimize.example");
    expect(u.searchParams.get("message")).toBe("Hi Cy,\nOpen it & go");
    expect(() => teamsChatLink("not an address", "x")).toThrow();
  });

  it("Outlook: one email to everyone with the subject and body; mailto as the fallback", () => {
    const u = new URL(outlookComposeLink(["a@x.example", "b@x.example", "nope"], "Try FocusTime", "Hi all,\nline"));
    expect(u.origin + u.pathname).toBe("https://outlook.office.com/mail/deeplink/compose");
    expect([...u.searchParams.keys()]).toEqual(["to", "subject", "body"]);
    expect(u.searchParams.get("to")).toBe("a@x.example;b@x.example");
    expect(u.searchParams.get("body")).toBe("Hi all,\nline");
    const mail = mailtoLink(["a@x.example", "b@x.example"], "Try FocusTime", "Hi all,\nline");
    expect(mail).toBe("mailto:a%40x.example,b%40x.example?subject=Try%20FocusTime&body=Hi%20all%2C%0Aline");
    expect(() => outlookComposeLink(["nope"], "s", "b")).toThrow();
  });
});

describe("setup marks", () => {
  const full: SetupMarks = { signedIn: true, devops: true, calendar: true, teams: true };
  const partly: SetupMarks = { signedIn: true, devops: false, calendar: true, teams: null };
  const never: SetupMarks = { signedIn: false, devops: false, calendar: false, teams: null };
  it("partly set up: signed in with something left; an unknown Teams app doesn't count against anyone", () => {
    expect(partlySetUp(full)).toBe(false);
    expect(partlySetUp({ ...full, teams: null })).toBe(false);
    expect(partlySetUp({ ...full, teams: false })).toBe(true);
    expect(partlySetUp(partly)).toBe(true);
    expect(partlySetUp(never)).toBe(false);
  });
  it("filters and plain counts", () => {
    const all = [full, partly, never];
    expect(all.filter((m) => matchesFilter(m, "not_signed_in"))).toEqual([never]);
    expect(all.filter((m) => matchesFilter(m, "partly"))).toEqual([partly]);
    expect(all.filter((m) => matchesFilter(m, "all"))).toHaveLength(3);
    expect(setupCounts(all).text).toBe("2 of 3 signed in · 1 set up partly");
    expect(setupCounts([full]).text).toBe("1 of 1 signed in");
  });
});
