import { describe, expect, it } from "vitest";
import { splitHelp } from "./parts.tsx";

/** The words of both parts, the cut's "…" taken off, against the original's with punctuation ignored. */
const words = (x: string) => x.replace(/…/g, " ").replace(/[,:;]/g, "").split(/\s+/).filter(Boolean).join(" ");

describe("SA-2: a help line keeps to two phone lines, the rest word for word", () => {
  it("leaves a short line alone and ends a long one at a sentence or a clause, losing no word", () => {
    expect(splitHelp("Used for capacity.")).toEqual(["Used for capacity.", null]);
    const long = "Today's and your next working day's empty blocks offer to-dos: unfinished ones first, then your backlog. Nothing is planned until you keep it.";
    const [h, r] = splitHelp(long);
    expect(h.length).toBeLessThanOrEqual(80);
    expect(words(`${h} ${r}`)).toBe(words(long));
    const one = "Off: a push says only what kind of thing it is (Promises due). On: client names and work item titles too, on the lock screen.";
    const [h2, r2] = splitHelp(one);
    expect(words(`${h2} ${r2}`)).toBe(words(one));
    // A cut inside a sentence says so on both sides, and loses only the separator.
    const clause = "This is a test site. It sends nothing on its own: no reminders, notices, pushes or Teams messages from this test site.".slice(21);
    const [h4, r4] = splitHelp(clause);
    expect(h4).toBe("It sends nothing on its own…");
    expect(r4).toBe("…no reminders, notices, pushes or Teams messages from this test site.");
    const report = "Friday afternoon (and Sunday evening if you like) when some of your features have no update yet for Monday's report. Off until you turn it on.";
    const [h3, r3] = splitHelp(report);
    expect(h3.length).toBeLessThanOrEqual(80);
    expect(words(`${h3} ${r3}`)).toBe(words(report));
  });
});
