// CF-1 (F2) and its review: only a request to confirm my plan gets the plain answer; ordinary requests go to the model.
import { describe, expect, it } from "vitest";
import { asksToConfirm } from "./service.ts";

describe("asksToConfirm", () => {
  it("catches a request to confirm my day or week", () => {
    for (const t of ["Confirm my day", "confirm today", "Please confirm today's plan", "Can you confirm my plan for today?", "Confirm tomorrow", "confirm Tuesday"]) expect(asksToConfirm(t), t).toBe("day");
    for (const t of ["Confirm my week", "lock in my week", "Commit to next week's plan", "confirm the week", "Confirm this week"]) expect(asksToConfirm(t), t).toBe("week");
  });
  it("leaves ordinary requests that use the words alone", () => {
    for (const t of [
      "can you confirm the meeting time tomorrow",
      "Did I commit to anything for Fabrikam this week?",
      "Move today's to-dos to Friday, I'll confirm",
      "Send the export story to Dana for next week, I need to confirm with her",
      "Comment on 4417: confirm the Friday release with the client",
      "commit #4417 comment",
    ]) expect(asksToConfirm(t), t).toBeNull();
  });
});
