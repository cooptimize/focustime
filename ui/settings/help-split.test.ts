import { describe, expect, it } from "vitest";
import { splitHelp } from "./parts.tsx";

describe("SA-2: a help line keeps to two phone lines, the rest word for word", () => {
  it("leaves a short line alone and ends a long one at a sentence or a clause, losing no word", () => {
    expect(splitHelp("Used for capacity.")).toEqual(["Used for capacity.", null]);
    const long = "Today's and your next working day's empty blocks offer to-dos: unfinished ones first, then your backlog. Nothing is planned until you keep it.";
    const [h, r] = splitHelp(long);
    expect(h.length).toBeLessThanOrEqual(80);
    expect(`${h} ${r}`).toBe(long);
    const one = "Off: a push says only what kind of thing it is (Promises due). On: client names and work item titles too, on the lock screen.";
    const [h2, r2] = splitHelp(one);
    expect(`${h2} ${r2}`).toBe(one);
    const report = "Friday afternoon (and Sunday evening if you like) when some of your features have no update yet for Monday's report. Off until you turn it on.";
    const [h3, r3] = splitHelp(report);
    expect(h3.length).toBeLessThanOrEqual(80);
    expect(`${h3} ${r3}`).toBe(report);
  });
});
