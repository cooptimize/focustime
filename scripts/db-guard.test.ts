import { describe, expect, it } from "vitest";
import { portIsContainer, resetRefusal } from "./db-guard.ts";

describe("npm run db:reset's guard (HK-3)", () => {
  it("resets only focustime_dev", () => {
    expect(resetRefusal("focustime_dev")).toBeNull();
    for (const name of ["focustime", "focustime_test_admin_1", "focustime_dev2", "FOCUSTIME_DEV", "master", "", "focustime_dev;DROP"]) expect(resetRefusal(name)).toMatch(/^Refusing to reset/);
    expect(resetRefusal("focustime")).toContain("the service's database");
  });
  it("goes ahead only when port 14330 is the local container's", () => {
    expect(portIsContainer("1433/tcp -> 127.0.0.1:14330\n")).toBe(true);
    expect(portIsContainer("1433/tcp -> 0.0.0.0:14330")).toBe(true);
    expect(portIsContainer("")).toBe(false);
    expect(portIsContainer("1433/tcp -> 127.0.0.1:14331")).toBe(false);
    expect(portIsContainer("1433/tcp -> 127.0.0.1:143300")).toBe(false);
    expect(portIsContainer("Error: no container with name or ID \"focustime-sqlserver\" found")).toBe(false);
  });
});
