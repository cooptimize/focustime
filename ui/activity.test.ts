import { describe, expect, it } from "vitest";
import { clampIdleMinutes, createActivity, PING_GAP_MS } from "./activity.ts";

const MIN = 60_000;
function page(o: { visible?: boolean; reply?: number | null } = {}) {
  let t = 1_000_000;
  let visible = o.visible ?? true;
  const pings: number[] = [];
  const a = createActivity({ now: () => t, visible: () => visible, ping: async () => (pings.push(t), o.reply ?? null) });
  return { a, pings, at: (ms: number) => void (t += ms), hide: () => void (visible = false), show: () => void (visible = true) };
}

describe("real use on the page (HK-3)", () => {
  it("a visible page with no input yet isn't in use; input makes it so for N minutes", () => {
    const p = page();
    expect(p.a.use()).toBe("background");
    p.a.input();
    expect(p.a.use()).toBe("active");
    p.at(9 * MIN);
    expect(p.a.use()).toBe("active");
    p.at(MIN + 1);
    expect(p.a.use()).toBe("background");
  });

  it("a hidden tab never counts, even right after input", () => {
    const p = page();
    p.a.input();
    p.hide();
    expect(p.a.use()).toBe("background");
    p.show();
    expect(p.a.use()).toBe("active");
  });

  it("a background call never counts, whatever the input", () => {
    const p = page();
    p.a.input();
    expect(p.a.use(true)).toBe("background");
  });

  it("input reports itself at most once a minute, and never while hidden", async () => {
    const p = page();
    p.a.input();
    p.at(1000);
    p.a.input();
    expect(p.pings).toHaveLength(1);
    p.at(PING_GAP_MS);
    p.a.input();
    expect(p.pings).toHaveLength(2);
    p.hide();
    p.at(PING_GAP_MS);
    p.a.input();
    expect(p.pings).toHaveLength(2);
  });

  it("takes the Rule's minutes from the server, within 5 to 60", async () => {
    const p = page({ reply: 30 });
    p.a.input();
    await Promise.resolve();
    await Promise.resolve();
    expect(p.a.idleMinutes()).toBe(30);
    p.at(29 * MIN);
    expect(p.a.active()).toBe(true);
    expect([clampIdleMinutes(1), clampIdleMinutes(90), clampIdleMinutes("x"), clampIdleMinutes(12.4)]).toEqual([5, 60, 10, 12]);
  });
});
