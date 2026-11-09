// TB-3: the phrases the Assistant answers with no AI call (they were the Teams bot's own quick commands).
import { expect, it } from "vitest";
import { quickOf } from "./quick.ts";

it("knows them in everyday words, and nothing else", () => {
  expect(["What's next?", "whats next", "next", "WHAT IS NEXT"].map(quickOf)).toEqual(["next", "next", "next", "next"]);
  expect(["today", "Today!", "my day"].map(quickOf)).toEqual(["today", "today", "today"]);
  expect(["help", "?", "commands", "What can you do?"].map(quickOf)).toEqual(["help", "help", "help", "help"]);
  expect(["open FocusTime", "Open Focus Time", "<at>FocusTime</at> open"].map(quickOf)).toEqual(["open", "open", "open"]);
  expect(["what's next week look like", "move my 2pm", "today I want to do the export", ""].map(quickOf)).toEqual([null, null, null, null]);
});
