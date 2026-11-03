import { describe, expect, it } from "vitest";
import { ActionRefusal } from "../api.ts";
import { isValidation, plain, same } from "./autosave.tsx";

describe("Settings saves itself: the pure parts", () => {
  it("a validation message loses the config key it names", () => {
    expect(plain("Must be at least the Watch value (meeting_watch_minutes)")).toBe("Must be at least the Watch value");
    expect(plain("risk.meeting_at_risk_minutes: must be a whole number")).toBe("must be a whole number");
    expect(plain("Like 12:00-12:30 (or empty)")).toBe("Like 12:00-12:30 (or empty)");
  });
  it("only a refusal of the values is a validation error; anything else can be retried", () => {
    expect(isValidation(new ActionRefusal("At least the Watch value", 422, [{ field: "risk.x", message: "m" }]))).toBe(true);
    expect(isValidation(new ActionRefusal("FocusTime answered 503", 503))).toBe(false);
    expect(isValidation(new TypeError("Failed to fetch"))).toBe(false);
  });
  it("unchanged means the same value, however it was built", () => {
    expect(same(["a", "b"], ["a", "b"])).toBe(true);
    expect(same({ S: 30 }, { S: 35 })).toBe(false);
  });
});
