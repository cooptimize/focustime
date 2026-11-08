import { describe, expect, it } from "vitest";
import { parseDue, boxKind, parseTag, suggest, takeTag, type CaptureClient } from "./capture.ts";

// Sunday Nov 1, 2026 is "today" unless a test says otherwise; Thu Nov 5 is PTO in real life but rules don't care.
const SUN = "2026-11-01";
const WED = "2026-11-04";
const clients: CaptureClient[] = [
  { clientKey: "T&W", clientName: "Tailspin & Wingtip" },
  { clientKey: "Adatum", clientName: "Adatum Steel" },
  { clientKey: "Proseware", clientName: "Proseware" },
  { clientKey: "Cooptimize", clientName: "Cooptimize" },
];

describe("due dates", () => {
  it("weekdays: the coming one, today when it is that day", () => {
    expect(parseDue("send it by Thursday", WED)).toMatchObject({ date: "2026-11-05", phrase: "by Thursday" });
    expect(parseDue("by thu", WED)?.date).toBe("2026-11-05");
    expect(parseDue("by Wednesday", WED)?.date).toBe("2026-11-04");
    expect(parseDue("by Monday", WED)?.date).toBe("2026-11-09");
    expect(parseDue("next Tuesday", WED)?.date).toBe("2026-11-10");
  });
  it("today, tonight, tomorrow, end of day and end of week", () => {
    expect(parseDue("call back tomorrow", WED)).toMatchObject({ date: "2026-11-05", phrase: "tomorrow" });
    expect(parseDue("tonight", WED)?.date).toBe(WED);
    expect(parseDue("by EOD", WED)?.date).toBe(WED);
    expect(parseDue("by end of week", WED)?.date).toBe("2026-11-06");
    expect(parseDue("by EOW", SUN)?.date).toBe("2026-11-06");
    expect(parseDue("next week", WED)?.date).toBe("2026-11-09");
  });
  it("numeric and month dates: this year, or next year once passed", () => {
    expect(parseDue("by 11/14", WED)).toMatchObject({ date: "2026-11-14", phrase: "by 11/14" });
    expect(parseDue("due 1/5", WED)?.date).toBe("2027-01-05");
    expect(parseDue("11/14/2027", WED)?.date).toBe("2027-11-14");
    expect(parseDue("by Nov 20", WED)?.date).toBe("2026-11-20");
    expect(parseDue("by December 3rd", WED)?.date).toBe("2026-12-03");
    expect(parseDue("on 2026-11-12", WED)?.date).toBe("2026-11-12");
  });
  it("nothing that isn't a date: no 13/40, no version numbers, no bare words", () => {
    expect(parseDue("fix 13/40 rows", WED)).toBeNull();
    expect(parseDue("upgrade to 2.1", WED)).toBeNull();
    expect(parseDue("monday morning standup notes", WED)?.date).toBe("2026-11-09"); // a weekday word alone is still a day
    expect(parseDue("just a thought", WED)).toBeNull();
  });
});

describe("client tags", () => {
  it("@nickname by key or name, any case, and takes the tag out of the text", () => {
    expect(parseTag("@adatum ask about the schema", clients)).toEqual({ clientKey: "Adatum", text: "ask about the schema" });
    expect(parseTag("ask @T&W about timesheets", clients)).toEqual({ clientKey: "T&W", text: "ask about timesheets" });
    expect(parseTag("note for @proseware.", clients)).toEqual({ clientKey: "Proseware", text: "note for." });
    expect(parseTag("@tailspin renewal", clients)).toEqual({ clientKey: "T&W", text: "renewal" }); // a unique prefix of the name
  });
  it("an unknown or ambiguous tag stays as text, untagged", () => {
    expect(parseTag("@nobody hello", clients)).toEqual({ clientKey: null, text: "@nobody hello" });
    expect(parseTag("@c hello", clients)).toEqual({ clientKey: null, text: "@c hello" }); // too short to be sure
    expect(parseTag("email me at avery@example.com", clients)).toEqual({ clientKey: null, text: "email me at avery@example.com" });
  });
});

describe("takeTag: a finished @tag sets the client chip while typing (step 15.2)", () => {
  it("takes a known tag out once a space follows it, keeping the rest and the trailing space", () => {
    expect(takeTag("@adatum ", clients)).toEqual({ clientKey: "Adatum", text: "" });
    expect(takeTag("ask @adatum ", clients)).toEqual({ clientKey: "Adatum", text: "ask " });
    expect(takeTag("ask @T&W about ", clients)).toEqual({ clientKey: "T&W", text: "ask about " });
  });
  it("waits while the tag is still being typed, and leaves unknown tags and email addresses alone", () => {
    expect(takeTag("ask @adat", clients)).toBeNull();
    expect(takeTag("ask @nobody ", clients)).toBeNull();
    expect(takeTag("mail avery@example.com ", clients)).toBeNull();
    expect(takeTag("plain text ", clients)).toBeNull();
  });
});

describe("routing suggestions (rules, no AI)", () => {
  it("a promise becomes a follow-up with who, what and a due date", () => {
    expect(suggest("Told Dana I'd send the export by Thursday", null, WED, clients)).toMatchObject({ kind: "follow_up", who: "Dana", what: "Send the export", due: "2026-11-05" });
    expect(suggest("I'll review Mark's PR tomorrow", null, WED, clients)).toMatchObject({ kind: "follow_up", due: "2026-11-05", what: "Review Mark's PR" });
    expect(suggest("promised Priya the numbers", "Adatum", WED, clients)).toMatchObject({ kind: "follow_up", who: "Priya", clientKey: "Adatum" });
    // A due date alone ("by Friday") reads as a commitment; with no name, Who stays empty (Q84), even with a client.
    expect(suggest("status update by Friday", "T&W", WED, clients)).toMatchObject({ kind: "follow_up", who: "", clientKey: "T&W", due: "2026-11-06" });
    expect(suggest("I'll send the release notes @coop", "Cooptimize", WED, clients).who).toBe("");
    expect(suggest("I will call the vendor", null, WED, clients)).toMatchObject({ kind: "follow_up", who: "", due: null });
  });
  it("work to do for a client becomes a draft story", () => {
    expect(suggest("need to add paging to the resource API", "T&W", WED, clients)).toMatchObject({ kind: "draft", clientKey: "T&W", title: "Add paging to the resource API" });
    expect(suggest("story: export timesheets as CSV", "T&W", WED, clients)).toMatchObject({ kind: "draft", title: "Export timesheets as CSV" });
    expect(suggest("todo retry failed syncs", "Adatum", WED, clients)).toMatchObject({ kind: "draft", title: "Retry failed syncs" });
    // Tagged with a client and not a promise: work for that client.
    expect(suggest("schema manager git support edge cases", "Adatum", WED, clients)).toMatchObject({ kind: "draft", clientKey: "Adatum" });
    // Work words but no client: a draft needs one, so it's suggested with the client still to choose.
    expect(suggest("need to fix the build", null, WED, clients)).toMatchObject({ kind: "draft", clientKey: null });
  });
  it("a promise wins over work words", () => {
    expect(suggest("I'll need to fix the build by Monday", "Adatum", WED, clients)).toMatchObject({ kind: "follow_up", due: "2026-11-09" });
  });
  it("feature words read as a draft feature (step 13.5)", () => {
    expect(suggest("feature: self-service onboarding", "T&W", WED, clients)).toMatchObject({ kind: "draft_feature", title: "Self-service onboarding" });
    expect(suggest("new feature for bulk export", "Adatum", WED, clients)).toMatchObject({ kind: "draft_feature", title: "Bulk export" });
  });
  it("there are no notes any more: anything else is a draft story (step 13.5)", () => {
    expect(suggest("interesting idea about caching", null, WED, clients)).toMatchObject({ kind: "draft", clientKey: null, title: "Interesting idea about caching" });
    expect(suggest("fyi: their CFO prefers email", "Proseware", WED, clients)).toMatchObject({ kind: "draft" });
  });
  it("offers the other two kinds as alternatives, every time", () => {
    expect(suggest("Told Dana I'd send it", null, WED, clients).others).toEqual(["draft", "draft_feature"]);
    expect(suggest("just a thought", null, WED, clients).others).toEqual(["follow_up", "draft_feature"]);
  });
});

describe("boxKind: the chip the capture box highlights while I type (step 15.3)", () => {
  const T = "2026-11-02";
  const k = (text: string, client: string | null = null) => boxKind(text, client, T, clients);
  it("nothing typed, or nothing the rules recognize: Sort later", () => {
    expect(k("")).toBe("later");
    expect(k("   ")).toBe("later");
    expect(k("pallet labels look odd")).toBe("later");
  });
  it("a promise or a due date after by is a follow-up", () => {
    expect(k("told Dana I'd send the export")).toBe("follow_up");
    expect(k("send the export by Friday")).toBe("follow_up");
  });
  it("feature words are a draft feature; work words are a draft story", () => {
    expect(k("feature: bulk import")).toBe("draft_feature");
    expect(k("story: retry failed syncs")).toBe("draft");
    expect(k("need to add paging", "Adatum")).toBe("draft");
  });
});

describe("boxKind: Deployment (WK-3)", () => {
  const k = (text: string) => boxKind(text, null, "2026-11-02", clients);
  it("deploy, release, go-live and cutover words highlight Deployment", () => {
    expect(k("deploy the sales model Saturday")).toBe("deployment");
    expect(k("release 4.2 Friday night")).toBe("deployment");
    expect(k("go-live for the portal")).toBe("deployment");
    expect(k("cutover weekend")).toBe("deployment");
  });
  it("a promise still wins: telling someone about a release is a follow-up", () => {
    expect(k("told Dana I'd send the release notes")).toBe("follow_up");
  });
});
