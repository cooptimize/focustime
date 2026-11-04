import { describe, expect, it } from "vitest";
import type { DataverseConfig } from "../config/schema.ts";
import { matchMe } from "./dispatch.ts";

const DV = { myEmail: "ana@cooptimize.example" } as DataverseConfig;
const ID = "dddddddd-0000-4000-8000-0000000000a1";

function ctx(users: Record<string, string>, opts: { failing?: boolean } = {}) {
  const asked: string[] = [];
  return {
    asked,
    c: {
      signedInAs: async () => ({ email: "ana@cooptimize.example", upn: "ana.s@cooptimize.example" }),
      makeDataverse: () =>
        ({
          resolveUserId: async (e: string) => {
            asked.push(e);
            if (opts.failing) return { ok: false, message: "Dataverse can't be reached", reason: "failed" };
            return users[e] ? { ok: true, id: users[e] } : { ok: false, message: "none", reason: "none" };
          },
        }) as never,
    },
  };
}

describe("finding me in Dataverse (A2)", () => {
  it("by email first", async () => {
    const t = ctx({ "ana@cooptimize.example": ID });
    expect(await matchMe(t.c, DV, "UTC")).toEqual({ ok: true, id: ID });
    expect(t.asked).toEqual(["ana@cooptimize.example"]);
  });

  it("then by UPN", async () => {
    const t = ctx({ "ana.s@cooptimize.example": ID });
    expect(await matchMe(t.c, DV, "UTC")).toEqual({ ok: true, id: ID });
    expect(t.asked).toEqual(["ana@cooptimize.example", "ana.s@cooptimize.example"]);
  });

  it("says so plainly when nobody matches", async () => {
    expect(await matchMe(ctx({}).c, DV, "UTC")).toEqual({ ok: false, reason: "none", message: "No Cooptimize staff record matches ana@cooptimize.example. Ask the FocusTime team." });
  });

  it("stops at an answer that isn't 'not found' (Dataverse down)", async () => {
    const t = ctx({}, { failing: true });
    expect(await matchMe(t.c, DV, "UTC")).toEqual({ ok: false, reason: "failed", message: "Couldn't reach Dataverse. Try again, or tell the FocusTime team." });
    expect(t.asked).toHaveLength(1);
  });
});
