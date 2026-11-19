// The closed set of log fields (and VM-7's three closed words): the console line and Application Insights carry only
// these fields, and a refused Azure answer's three facts only as words from their fixed lists.
import { afterEach, describe, expect, it, vi } from "vitest";
import { envelopeOf } from "./appinsights.ts";
import { BODY_WORDS, CAUSE_WORDS, CHALLENGE_WORDS, closedWords, LOG_FIELDS, stderrLogger, type LogRecord } from "./logger.ts";

type Env = { data: { baseData: { properties: Record<string, string> } } };
const printed = (r: LogRecord): string => {
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  stderrLogger(r);
  const line = String(spy.mock.calls[0]?.[0] ?? "");
  spy.mockRestore();
  return line;
};
const sent = (r: LogRecord) => (envelopeOf(r, "k", new Date(0), "focustime") as Env).data.baseData.properties;

describe("the log's closed set", () => {
  afterEach(() => vi.restoreAllMocks());

  it("names every field, VM-7's challenge, cause and body among them, and no other", () => {
    expect([...LOG_FIELDS]).toEqual(["source", "op", "status", "durationMs", "count", "kind", "client", "action", "ref", "challenge", "cause", "body"]);
    expect([...CHALLENGE_WORDS]).toEqual(["invalid_token", "insufficient_claims", "insufficient_scope", "other", "none"]);
    expect([...CAUSE_WORDS]).toEqual(["gateway", "service", "other", "none"]);
    expect([...BODY_WORDS]).toEqual(["json_with_code", "json_no_code", "not_json", "empty"]);
  });

  it("prints and sends the three words of a refused Azure answer", () => {
    const r: LogRecord = { source: "azure", op: "instanceView", status: 403, durationMs: 40, kind: "none", challenge: "insufficient_scope", cause: "gateway", body: "empty" };
    expect(printed(r)).toMatch(/ azure instanceView status=403 ms=40 kind=none challenge=insufficient_scope cause=gateway body=empty\n$/);
    expect(sent(r)).toEqual({ source: "azure", op: "instanceView", status: "403", kind: "none", challenge: "insufficient_scope", cause: "gateway", body: "empty" });
  });

  it("still refuses any other field: a header, a body, a token or an id passed along is never printed or sent", () => {
    const r = { source: "azure", op: "instanceView", status: 403, headers: { "x-ms-request-id": "00000000-0000-4000-8000-00000000beef" }, responseBody: "made-up body", token: "FAKE-TOKEN-1", requestId: "00000000-0000-4000-8000-00000000beef" } as unknown as LogRecord;
    const line = printed(r);
    const props = sent(r);
    for (const bad of ["beef", "made-up", "FAKE-TOKEN", "headers", "responseBody", "token", "requestId"]) {
      expect(line).not.toContain(bad);
      expect(JSON.stringify(props)).not.toContain(bad);
    }
    expect(Object.keys(props).every((k) => (LOG_FIELDS as readonly string[]).includes(k))).toBe(true);
  });

  it("a word not on its list is other (challenge, cause) or left out (body)", () => {
    const r = { source: "azure", op: "instanceView", challenge: "Bearer error=x principal 9", cause: "203.0.113.7", body: "the whole body" } as unknown as LogRecord;
    expect(closedWords(r)).toEqual({ challenge: "other", cause: "other" });
    expect(printed(r)).not.toMatch(/principal|203\.0|whole/);
    expect(JSON.stringify(sent(r))).not.toMatch(/principal|203\.0|whole/);
  });
});
