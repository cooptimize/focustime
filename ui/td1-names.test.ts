// TD-1: labels only. A planned piece of work on a block reads "to-do" (the code name stays pick); the command menu
// finds its commands by the new word, by "todo", and by the old word.
import { describe, expect, it } from "vitest";
import { ACTIONS, type ActionSpec } from "../actions/registry.ts";
import { saysPick } from "../scripts/words-guard.ts";
import { filterCommands, type MenuItem } from "./menu.ts";

const commands = (ACTIONS as readonly ActionSpec[]).map<MenuItem>((a) => ({ id: a.name, action: a.name, group: a.group, label: a.title, ...(a.aka ? { aka: a.aka } : {}) }));
const labels = (q: string) => filterCommands(commands, q).map((i) => i.label);

describe("TD-1 names", () => {
  it("the commands read to-do, and their action names keep pick", () => {
    const move = commands.find((c) => c.action === "pick.move")!;
    expect(move.label).toBe("Move to-do");
    expect(move.group).toBe("To-dos");
    expect(commands.find((c) => c.action === "timer.next")!.label).toBe("Next to-do");
  });
  it("the command menu finds them by to-do, todo and pick", () => {
    for (const q of ["next to-do", "next todo", "next pick"]) expect(labels(q)).toContain("Next to-do");
    for (const q of ["move to-do", "move pick", "drop picks"]) expect(labels(q).some((l) => l === "Move to-do" || l === "Drop to-do")).toBe(true);
  });
  it("no command title or summary says pick in the to-do sense", () => {
    for (const a of ACTIONS as readonly ActionSpec[]) expect(saysPick(`${a.title}. ${a.summary}`), a.name).toBe(false);
  });
});
