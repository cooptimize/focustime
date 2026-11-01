import { describe, expect, it } from "vitest";
import { parseDue, parseTag, suggest, type CaptureClient } from "./capture.ts";

// Sunday Nov 1, 2026 is "today" unless a test says otherwise; Thu Nov 5 is PTO in real life but rules don't care.
const SUN = "2026-11-01";
const WED = "2026-11-04";
const clients: CaptureClient[] = [
  { clientKey: "W&C", clientName: "Woodard & Curran" },
  { clientKey: "CSC", clientName: "CSC Steel" },
  { clientKey: "Quiddity", clientName: "Quiddity" },
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
    expect(parseTag("@csc ask about the schema", clients)).toEqual({ clientKey: "CSC", text: "ask about the schema" });
    expect(parseTag("ask @W&C about timesheets", clients)).toEqual({ clientKey: "W&C", text: "ask about timesheets" });
    expect(parseTag("note for @quiddity.", clients)).toEqual({ clientKey: "Quiddity", text: "note for." });
    expect(parseTag("@woodard renewal", clients)).toEqual({ clientKey: "W&C", text: "renewal" }); // a unique prefix of the name
  });
  it("an unknown or ambiguous tag stays as text, untagged", () => {
    expect(parseTag("@nobody hello", clients)).toEqual({ clientKey: null, text: "@nobody hello" });
    expect(parseTag("@c hello", clients)).toEqual({ clientKey: null, text: "@c hello" }); // CSC and Cooptimize
    expect(parseTag("email me at tanner@example.com", clients)).toEqual({ clientKey: null, text: "email me at tanner@example.com" });
  });
});

describe("routing suggestions (rules, no AI)", () => {
  it("a promise becomes a loop with who, what and a due date", () => {
    expect(suggest("Told Dana I'd send the export by Thursday", null, WED, clients)).toMatchObject({ kind: "loop", who: "Dana", what: "Send the export", due: "2026-11-05" });
    expect(suggest("I'll review Mark's PR tomorrow", null, WED, clients)).toMatchObject({ kind: "loop", due: "2026-11-05", what: "Review Mark's PR" });
    expect(suggest("promised Priya the numbers", "CSC", WED, clients)).toMatchObject({ kind: "loop", who: "Priya", clientKey: "CSC" });
    // A due date alone ("by Friday") reads as a commitment; who falls back to the tagged client.
    expect(suggest("status update by Friday", "W&C", WED, clients)).toMatchObject({ kind: "loop", who: "Woodard & Curran", due: "2026-11-06" });
    expect(suggest("I will call the vendor", null, WED, clients)).toMatchObject({ kind: "loop", who: "", due: null });
  });
  it("work to do for a client becomes a draft story", () => {
    expect(suggest("need to add paging to the resource API", "W&C", WED, clients)).toMatchObject({ kind: "draft", clientKey: "W&C", title: "Add paging to the resource API" });
    expect(suggest("story: export timesheets as CSV", "W&C", WED, clients)).toMatchObject({ kind: "draft", title: "Export timesheets as CSV" });
    expect(suggest("todo retry failed syncs", "CSC", WED, clients)).toMatchObject({ kind: "draft", title: "Retry failed syncs" });
    // Tagged with a client and not a promise: work for that client.
    expect(suggest("schema manager git support edge cases", "CSC", WED, clients)).toMatchObject({ kind: "draft", clientKey: "CSC" });
    // Work words but no client: a draft needs one, so it's suggested with the client still to choose.
    expect(suggest("need to fix the build", null, WED, clients)).toMatchObject({ kind: "draft", clientKey: null });
  });
  it("a promise wins over work words", () => {
    expect(suggest("I'll need to fix the build by Monday", "CSC", WED, clients)).toMatchObject({ kind: "loop", due: "2026-11-09" });
  });
  it("anything else is a personal note, tagged when a client was", () => {
    expect(suggest("interesting idea about caching", null, WED, clients)).toMatchObject({ kind: "note", clientKey: null, text: "interesting idea about caching" });
    expect(suggest("their CFO prefers email", "Quiddity", WED, clients)).toMatchObject({ kind: "draft" });
    expect(suggest("fyi: their CFO prefers email", "Quiddity", WED, clients)).toMatchObject({ kind: "note", clientKey: "Quiddity", text: "Their CFO prefers email" });
  });
  it("offers the other two kinds as alternatives, every time", () => {
    expect(suggest("Told Dana I'd send it", null, WED, clients).others).toEqual(["draft", "note"]);
    expect(suggest("just a thought", null, WED, clients).others).toEqual(["loop", "draft"]);
  });
});
