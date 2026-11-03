// A4: the wrapped data key is kept once; a second replica's keep returns the first one's.
import { expect, it } from "vitest";
import { forEachDriver } from "../test/db.ts";
import { appKeyStore } from "./app-keys.ts";

await forEachDriver("app keys (A4)", ({ driver, open }) => {
  it("keeps the first wrapping and hands it to everyone after", async () => {
    if (driver === "sqlite") return; // app_keys is SQL Server's (the hosted app); the demo has no data key.
    const db = (await open()).conn;
    const now = () => Temporal.Instant.from("2026-11-03T12:00:00Z");
    const a = appKeyStore(db, "data-key", now);
    expect(await a.load()).toBeNull();
    expect(await a.keep('{"kid":"k1","value":"first"}')).toBe('{"kid":"k1","value":"first"}');
    expect(await appKeyStore(db, "data-key", now).keep('{"kid":"k1","value":"second"}')).toBe('{"kid":"k1","value":"first"}');
  });
});
