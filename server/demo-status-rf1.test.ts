// RF-1: status.load carries the Status tab's dot: when the next report goes out, my zone, the server's clock, and when
// the dot turns amber and red from my own week (the demo's focus blocks and its day off).
import { describe, expect, it } from "vitest";
import { dispatch, type ActionContext } from "../actions/dispatch.ts";
import type { StatusLoad } from "../plan/status-types.ts";
import { dotTone } from "../plan/status-dot.ts";
import { useNoOutbound } from "../test/no-outbound.ts";
import { createDemoContext, seedDemo } from "./demo.ts";

async function load(now: string): Promise<StatusLoad> {
  const ctx: ActionContext = createDemoContext({ now: () => now, demo: { on: true, set: async () => {} } });
  await seedDemo(ctx);
  const r = await dispatch(ctx, { action: "status.load", input: {} });
  if (!r.ok) throw new Error(r.error);
  return r.data as StatusLoad;
}
const local = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO("America/New_York").toPlainDateTime().toString().slice(0, 16);

describe("Status's dot (RF-1)", () => {
  const net = useNoOutbound();

  it("Monday: the demo's Thursday is a day off, so Tuesday is amber and Wednesday red; no dot yet", async () => {
    const l = await load("2026-11-02T14:30:00Z");
    expect(l).toMatchObject({ sendsAt: "2026-11-09T12:00:00Z", zone: "America/New_York", serverNow: "2026-11-02T14:30:00Z" });
    expect(l.needsYou).toBeGreaterThan(0);
    expect(l.dot && { amber: local(l.dot.amberFrom!), red: local(l.dot.redFrom), until: l.dot.until }).toEqual({ amber: "2026-11-03T09:00", red: "2026-11-04T09:00", until: "2026-11-09T12:00:00Z" });
    expect(dotTone(l.dot, l.needsYou, l.serverNow!)).toBe("none");
    expect(dotTone(l.dot, l.needsYou, "2026-11-03T15:00:00Z")).toBe("amber");
    expect(dotTone(l.dot, l.needsYou, "2026-11-04T15:00:00Z")).toBe("red");
    net.expectNone();
  });
});
