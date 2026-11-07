// CL-1 (rollback safety): settings a person saved under older builds still load on this one, and the old AI keys that
// ADM-1 stopped enforcing stay readable (the one-time org bootstrap reads them) without granting anything: AI for
// FocusTime, Allow AI and the caps come only from the team's settings.
import { describe, expect, it } from "vitest";
import { setValue } from "./edit.ts";
import { parseConfig } from "./schema.ts";
import { starterToml } from "./starter.ts";

const base = () => setValue(starterToml("America/New_York"), "dataverse", "my_email", "ana@cooptimize.example");

describe("old settings keys (CL-1)", () => {
  it("a person's pre-ADM-1 [ai] keys and AP-1's poll_minutes load with no errors and enforce nothing", () => {
    const text = `${base()}\n[ai]\nuse = true\nmonthly_cap_usd = 25\nallowed_clients = ["fabrikam"]\ndraft_months = 6\n\n[asks]\npoll_minutes = 5\n`;
    const r = parseConfig(text);
    expect(r.ok, JSON.stringify(r.ok ? null : r.errors)).toBe(true);
    if (!r.ok) return;
    // Still read, for the org bootstrap only.
    expect(r.config.ai).toMatchObject({ use: true, monthlyCapUsd: 25, allowedClients: ["fabrikam"], draftMonths: 6 });
    // Never enforced: the team's rules are off until an admin turns them on.
    expect(r.config.aiRules).toMatchObject({ on: false, allowedClients: [] });
  });

  it("a key or section this build doesn't know (a newer build's, or one a later cleanup removes) is ignored, not an error", () => {
    const text = `${base()}\n[ai]\nuse = false\nsome_later_key = 1\n\n[delivery_chats]\nprimary = "19:x@thread.v2"\n`;
    const r = parseConfig(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ignored).toEqual(expect.arrayContaining(["ai.some_later_key", "delivery_chats"]));
  });
});
