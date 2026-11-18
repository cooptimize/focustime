// SA-3 test 1: every setting on main (the snapshot taken before SA-3 moved anything) is on exactly one page after,
// under the same id, with the same stored key and the same default. Only plan_share and keep_open went, and neither
// had a row. The browser test (e2e/settings/panel-shell.test.ts) checks each id is drawn in its section.
import { describe, expect, it } from "vitest";
import main from "./stored-keys-main.json" with { type: "json" };
import { SECTIONS, SETTINGS } from "./registry.ts";
import { STORED } from "./stored-keys.ts";

describe("SA-3: every setting keeps its id, key and default", () => {
  it("every id on main is in the registry once, in one of the eleven sections (or a client's page)", () => {
    const ids = SETTINGS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of main.settings) {
      const now = SETTINGS.filter((x) => x.id === d.id);
      expect(now.length, d.id).toBe(1);
      expect(SECTIONS.some((s) => s.id === now[0]!.section), d.id).toBe(true);
    }
    expect(SECTIONS.filter((s) => !s.parent).length).toBe(11);
  });
  it("each stored key and its default are main's", () => {
    for (const d of main.settings) expect(STORED[d.id] ?? null, d.id).toEqual(d.stored);
  });
  it("the seven notice kinds without a switch on main have one now, on by default", () => {
    const seven = ["story-taken", "sent-to-you", "send-answered", "send-cant-lead", "assigned", "dates-moved", "item-edited"].map((k) => `notify-${k}`);
    for (const id of seven) {
      expect(main.settings.some((d) => d.id === id), id).toBe(false);
      expect(SETTINGS.find((d) => d.id === id)?.section, id).toBe("notifications");
      expect(STORED[id]?.default, id).toBe(true);
    }
  });
});
