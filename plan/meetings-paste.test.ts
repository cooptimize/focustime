// MC-7: what the two pasted kinds change.
import { describe, expect, it } from "vitest";
import { pastedAs, speakersNamed, TRANSCRIPT_KINDS } from "./meetings.ts";

describe("MC-7: the pasted kinds", () => {
  it("are kinds a stored transcript may have", () => {
    expect(TRANSCRIPT_KINDS).toContain("pasted");
    expect(TRANSCRIPT_KINDS).toContain("pasted_notes");
  });
  it("say what was pasted, and nothing for the other sources", () => {
    expect(pastedAs("pasted")).toBe("transcript");
    expect(pastedAs("pasted_notes")).toBe("notes");
    expect(pastedAs("teams")).toBeNull();
    expect(pastedAs(undefined)).toBeNull();
  });
  it("a pasted transcript's names are names unless a voice is numbered; notes have no speakers", () => {
    expect(speakersNamed("pasted", ["Alex Rivera", "Dana Brooks"])).toBe(true);
    expect(speakersNamed("pasted", ["Speaker 1", "Speaker 2"])).toBe(false);
    expect(speakersNamed("pasted_notes", [""])).toBe(false);
    expect(speakersNamed("teams", ["Speaker 1"])).toBe(true);
    expect(speakersNamed("pocket", ["Alex"])).toBe(false);
  });
});
