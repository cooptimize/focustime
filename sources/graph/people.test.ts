import { describe, expect, it } from "vitest";
import { attendeesIn, createPeopleReader, inDomain } from "./people.ts";

describe("Who suggestions from my meetings (step 13.5)", () => {
  const rows = [
    { subject: "SECRET-SUBJECT", attendees: [{ emailAddress: { address: "Dana@wc.example", name: "Dana Ruiz" } }, { emailAddress: { address: "me@cooptimize.org", name: "Me" } }] },
    { attendees: [{ emailAddress: { address: "dana@wc.example", name: "Dana Ruiz" } }, { emailAddress: { address: "lee@eu.wc.example", name: "Lee" } }, { emailAddress: { address: "x@other.example", name: "X" } }] },
  ];
  it("keeps only the client's domain (and its subdomains), unique, most frequent first", () => {
    expect(attendeesIn(rows, "wc.example")).toEqual([{ name: "Dana Ruiz", email: "dana@wc.example" }, { name: "Lee", email: "lee@eu.wc.example" }]);
    expect(inDomain("a@notwc.example", "wc.example")).toBe(false);
  });
  it("asks Graph only for attendees and logs counts only, never subjects or addresses", async () => {
    const urls: string[] = [];
    const logs: string[] = [];
    const r = createPeopleReader({
      fetch: (async (u: string) => (urls.push(String(u)), new Response(JSON.stringify({ value: rows }), { status: 200 }))) as typeof fetch,
      token: async () => "TOKEN-X",
      invalidate: () => {},
      log: (e) => void logs.push(JSON.stringify(e)),
    });
    const people = await r.attendees("wc.example", "2026-09-01T00:00:00Z", "2026-11-15T00:00:00Z");
    expect(people).toHaveLength(2);
    expect(new URL(urls[0]!).searchParams.get("$select")).toBe("attendees");
    expect(logs.join()).not.toMatch(/SECRET|dana|TOKEN/i);
  });
});
