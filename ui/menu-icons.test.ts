// RS-1: an item's own icon wins, then its words, then its action; the command menu and the ⋯ menus are checked whole
// in ui/menu.test.ts.
import { describe, expect, it } from "vitest";
import { menuIcon } from "./menu-icons.ts";

describe("menu icons", () => {
  it("an item's own icon wins; a destructive word reads as remove even on an action with another icon", () => {
    expect(menuIcon({ label: "Anything", icon: "pin" })).toBe("pin");
    expect(menuIcon({ label: "Remove time", action: "timebox.remove" })).toBe("remove");
    expect(menuIcon({ label: "Undo", action: "pick.undo" })).toBe("undo");
    expect(menuIcon({ label: "Start focus: Review the spec", action: "timer.start" })).toBe("focus");
    expect(menuIcon({ label: "Something new nobody mapped" })).toBe("dot");
    expect(menuIcon({ label: "Something new nobody mapped", next: {} })).toBe("next");
  });
});
