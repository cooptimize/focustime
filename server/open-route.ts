// Step 15.5, A2: a clicked notification opens FocusTime on its view. The route is kept in the person's own store
// (validated, for 2 minutes) until their window takes it when it loads or gains focus, so it survives a restart and
// never reaches anyone else's window.
import { parseRoute } from "../plan/notify.ts";
import type { PlanStore } from "../store/plan-store.ts";

export const OPEN_ROUTE_KEY = "open_route";
const KEEP_MS = 120_000;

type Kept = { route: string; at: string };

/** Keeps a route for the person's window; false for anything that isn't a FocusTime route. */
export async function keepRoute(plan: PlanStore, route: string, now: Temporal.Instant): Promise<boolean> {
  if (!parseRoute(route)) return false;
  (await plan.setState(OPEN_ROUTE_KEY, { route, at: now.toString() }));
  return true;
}

/** The kept route, taken once; null when none, or it is older than 2 minutes. */
export async function takeRoute(plan: PlanStore, now: Temporal.Instant): Promise<string | null> {
  const k = (await plan.getState<Kept>(OPEN_ROUTE_KEY));
  if (!k) return null;
  (await plan.setState(OPEN_ROUTE_KEY, null));
  const age = now.epochMilliseconds - Temporal.Instant.from(k.at).epochMilliseconds;
  return age >= 0 && age < KEEP_MS && parseRoute(k.route) ? k.route : null;
}
