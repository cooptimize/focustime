// SA-4: the tab names (places.ts) follow the address ids the first download carries (paths.ts), one for one, in order.
import { describe, expect, it } from "vitest";
import { CLIENT_TABS, PART_TABS } from "./places.ts";
import { CLIENT_TAB_IDS, PART_TAB_IDS } from "./paths.ts";

describe("Admin's tab names and ids", () => {
  it("a client's tabs", () => expect(CLIENT_TABS.map(([t]) => t)).toEqual([...CLIENT_TAB_IDS]));
  for (const p of Object.keys(PART_TAB_IDS) as (keyof typeof PART_TAB_IDS)[]) it(p, () => expect(PART_TABS[p].map(([t]) => t)).toEqual([...PART_TAB_IDS[p]]));
});
