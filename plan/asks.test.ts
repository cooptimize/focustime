// AP-1: the Asks rules, table-driven: each request phrase, a mention of a Cooptimizer, a question mark, an
// attachment, acknowledgements, internal authors and my own messages; plain text from Teams HTML; titles; polling.
import { describe, expect, it } from "vitest";
import { aChatMember, aMessage, CLIENT_TENANT, HOME_TENANT } from "../test/builders/index.ts";
import { askTitle, backoffUntil, DEFAULT_ASK_SETTINGS, DEFAULT_REQUEST_PHRASES, hasPhrase, isAcknowledgement, matchAsk, plainText, ruleLabel } from "./asks.ts";

const ME = "00000000-0000-4000-8000-0000000000aa";
const coop = aChatMember({ userId: "00000000-0000-4000-8000-0000000000bb", displayName: "Jordan" });
const client = aChatMember({ userId: "00000000-0000-4000-8000-0000000000cc", external: true, displayName: "Dana" });
const facts = { homeTenant: HOME_TENANT, me: ME, members: [coop, client], settings: DEFAULT_ASK_SETTINGS };
const match = (o: Parameters<typeof aMessage>[0]) => matchAsk(aMessage(o), facts);

describe("which messages are asks (AP-1)", () => {
  it.each(DEFAULT_REQUEST_PHRASES.map((p) => [p, `Hi team, ${p} on the sales dashboard`]))("request phrase %s", (phrase, text) => {
    expect(match({ text })).toEqual({ rule: "phrase", detail: phrase });
  });

  it.each([
    ["@mentions a Cooptimizer", { mentionedUserIds: [coop.userId!] }, "mention"],
    ["a question mark", { text: "Is the refresh done" + "?" }, "question"],
    ["an image", { text: "see this", hasImage: true }, "attachment"],
    ["a file", { text: "", hasFile: true }, "attachment"],
    ["an image with only thanks", { text: "thanks", hasImage: true }, "attachment"],
  ] as [string, Parameters<typeof aMessage>[0], string][])("%s", (_why, o, rule) => {
    expect(match(o)?.rule).toBe(rule);
  });

  it.each([
    ["thanks", "thanks"],
    ["thank you!", "thank you!"],
    ["Sounds good 👍", "Sounds good 👍"],
    ["ok", "OK."],
    ["great, thanks", "Great, thanks!!"],
    ["reaction-only (no text)", ""],
    ["a plain statement", "The new numbers are in"],
    ["mentions a client person only", "fyi"],
  ])("not an ask: %s", (_why, text) => {
    expect(match({ text, mentionedUserIds: [client.userId!] })).toBeNull();
  });

  it("an acknowledgement with a request is still an ask", () => {
    expect(match({ text: "thanks, can you also add the region?" })?.rule).toBe("question");
    expect(match({ text: "ok please resend" })).toEqual({ rule: "phrase", detail: "please" });
  });

  it.each([
    ["an internal author", { authorTenant: HOME_TENANT, text: "can you look?" }],
    ["my own message", { authorId: ME, authorTenant: CLIENT_TENANT, text: "can you look?" }],
    ["no author (a system message)", { authorId: null, text: "can you look?" }],
  ] as const)("never an ask: %s", (_why, o) => {
    expect(match(o)).toBeNull();
  });

  it("the author's tenant comes from the members when the message has none; a guest is external", () => {
    expect(match({ authorId: client.userId, authorTenant: null, text: "please check" })?.rule).toBe("phrase");
    expect(match({ authorId: coop.userId, authorTenant: null, text: "please check" })).toBeNull();
    const guest = aChatMember({ userId: "00000000-0000-4000-8000-0000000000dd", guest: true });
    expect(matchAsk(aMessage({ authorId: guest.userId, authorTenant: HOME_TENANT, text: "please check" }), { ...facts, members: [coop, guest] })?.rule).toBe("phrase");
  });

  it("phrases match whole words in any case; the lists are the person's", () => {
    expect(hasPhrase("Please ADD the column", "add")).toBe(true);
    expect(hasPhrase("my address changed", "add")).toBe(false);
    expect(hasPhrase("It doesn’t look right", "doesn't look right")).toBe(true);
    expect(matchAsk(aMessage({ text: "kindly resend" }), { ...facts, settings: { ...DEFAULT_ASK_SETTINGS, requestPhrases: ["kindly"] } })).toEqual({ rule: "phrase", detail: "kindly" });
    expect(isAcknowledgement("cheers", ["cheers"])).toBe(true);
  });

  it.each([
    [{ rule: "mention", detail: null }, "mentions a Cooptimizer"],
    [{ rule: "question", detail: null }, "asks a question"],
    [{ rule: "phrase", detail: "not working" }, 'says "not working"'],
    [{ rule: "attachment", detail: "image" }, "has an image"],
    [{ rule: "attachment", detail: "file" }, "has a file"],
  ] as const)("rule label %j", (m, label) => {
    expect(ruleLabel(m)).toBe(label);
  });
});

describe("message text, titles and polling (AP-1)", () => {
  it.each([
    ["html", "html", "<p>Hi <at id=\"0\">Jordan</at>,</p><p>the total is &lt;0 &amp; wrong&nbsp;now</p>", "Hi Jordan,\nthe total is <0 & wrong now"],
    ["html with a break and an entity number", "html", "line one<br>line two &#39;x&#39;", "line one\nline two 'x'"],
    ["text", "text", "plain\r\ntext ", "plain\ntext"],
  ])("plain text from %s", (_why, type, content, want) => {
    expect(plainText(content, type)).toBe(want);
  });

  it("the title is the first line, at most 80 characters", () => {
    expect(askTitle("\n  Refresh failed in prod  \nmore detail")).toBe("Refresh failed in prod");
    const long = askTitle("The weekly revenue report for the northeast region shows totals that do not match the finance export at all");
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
    expect(askTitle("")).toBe("Ask from Teams");
  });

  it.each([
    ["Retry-After wins", 30, 3, "2026-11-04T15:00:30.000Z"],
    ["Retry-After is capped at an hour", 7200, 1, "2026-11-04T16:00:00.000Z"],
    ["no Retry-After: a minute", null, 1, "2026-11-04T15:01:00.000Z"],
    ["no Retry-After: doubling", null, 3, "2026-11-04T15:04:00.000Z"],
  ])("back off: %s", (_why, ra, failures, want) => {
    expect(backoffUntil("2026-11-04T15:00:00Z", ra, failures)).toBe(want);
  });
});

