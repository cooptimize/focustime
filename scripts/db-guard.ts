// HK-3: what `npm run db:reset` may drop. Only focustime_dev, and only on the local container: port 14330 must be the
// one `podman port focustime-sqlserver` publishes. The service's database (focustime) and the tests' own
// (focustime_test_*, made and dropped by the tests) are never reset here. Pure, for scripts/db.ts and its test.

export const RESETTABLE = "focustime_dev";
export const LOCAL_PORT = 14330;
export const CONTAINER = "focustime-sqlserver";

/** Why a reset of this database is refused, or null when it may go ahead. */
export function resetRefusal(name: string): string | null {
  if (name === RESETTABLE) return null;
  if (name === "focustime") return "Refusing to reset focustime: it is the service's database (your plan)";
  return `Refusing to reset ${name}: npm run db:reset resets only ${RESETTABLE}`;
}

/**
 * Whether `podman port <container>` output says the container publishes 1433 on localhost:14330
 * ("1433/tcp -> 127.0.0.1:14330"). Anything else (another server on the port, no container) is no.
 */
export function portIsContainer(podmanPortOutput: string): boolean {
  return podmanPortOutput
    .split("\n")
    .map((l) => l.trim())
    .some((l) => /^1433\/tcp\s*->\s*(127\.0\.0\.1|localhost|0\.0\.0\.0|\[?::1?\]?):(\d+)$/.test(l) && l.endsWith(`:${LOCAL_PORT}`));
}
