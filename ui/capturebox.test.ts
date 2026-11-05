// CP-1: the capture box's keys and its toast.
import { describe, expect, it } from "vitest";
import { keyAction, onLastLine, savedText } from "./capturebox.ts";

const key = (o: Partial<{ key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }>) => ({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, ...o });

describe("capture box keys (CP-1)", () => {
  it("Enter saves, Shift+Enter is a new line, Ctrl or Cmd+Enter saves and opens the preview", () => {
    expect(keyAction(key({}))).toBe("save");
    expect(keyAction(key({ shiftKey: true }))).toBeNull();
    expect(keyAction(key({ ctrlKey: true }))).toBe("save_open");
    expect(keyAction(key({ metaKey: true }))).toBe("save_open");
    expect(keyAction(key({ key: "a" }))).toBeNull();
    // An IME still composing keeps its Enter.
    expect(keyAction(key({ isComposing: true }))).toBeNull();
  });

  it("↓ leaves the box only from its last line", () => {
    expect(onLastLine("one line", 3)).toBe(true);
    expect(onLastLine("first\nsecond", 2)).toBe(false);
    expect(onLastLine("first\nsecond", 8)).toBe(true);
  });

  it("the toast names the client the capture went to", () => {
    expect(savedText("draft", "Northwind")).toBe("Saved to Northwind as a draft story");
    expect(savedText("draft_feature", "Northwind")).toBe("Saved to Northwind as a draft feature");
    expect(savedText("follow_up", "Northwind", ", owed to Dana")).toBe("Saved to Northwind as a follow-up, owed to Dana");
    expect(savedText("later", null)).toBe("Saved to Captures");
    expect(savedText("later", "Northwind")).toBe("Saved to Northwind");
  });
});
