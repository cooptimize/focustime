// SA-3 test 10: each line of What FocusTime keeps reads its number from the code's own constant, and no number is
// typed a second time in the lines' source.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HISTORY_DAYS } from "../../assistant/types.ts";
import { ORG_SPECS } from "../../config/org.ts";
import { TRANSCRIPT_DAYS } from "../../plan/meetings.ts";
import { HARD_DELETE_AFTER_DAYS as STORE_DAYS } from "../../store/user-data.ts";
import { KEEP_LINES, KEEP_NUMBERS } from "./keeps.ts";

describe("SA-3: What FocusTime keeps about you", () => {
  it("each number is the code's own constant", () => {
    const line = (id: string) => KEEP_LINES.find((l) => l.id === id)!.kept;
    expect(KEEP_NUMBERS.HARD_DELETE_AFTER_DAYS).toBe(STORE_DAYS);
    expect(line("plan")).toContain(`${STORE_DAYS} days`);
    // The chat messages' days are the admin's Rule (conv.retention_days, what the poll deletes by); the line names it.
    expect(line("chats")).toContain(`(${ORG_SPECS["conv.retention_days"].builtin} unless they changed it)`);
    expect(line("transcripts")).toContain(`${TRANSCRIPT_DAYS} days`);
    expect(line("assistant")).toContain(`${HISTORY_DAYS} days`);
  });
  it("no number is typed in the lines themselves", () => {
    const src = readFileSync(new URL("./keeps.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export const KEEP_LINES"));
    expect(body).not.toMatch(/\b\d+\s*(days|weeks|months|hours)\b/);
  });
  it("every line says how long it is kept and links to where it is controlled", () => {
    for (const l of KEEP_LINES) {
      expect(l.kept.length, l.id).toBeGreaterThan(0);
      expect(!!l.link.href || !!l.link.section, l.id).toBe(true);
    }
  });
});
