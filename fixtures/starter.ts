// The starter config as the tests know it: working hours in US Eastern, the zone most fixtures and expected values
// were written in. Product code takes the zone from the person's settings or the host clock (config/starter.ts).
import { starterToml } from "../config/starter.ts";

export const FIXTURE_ZONE = "America/New_York";
export const STARTER_TOML = starterToml(FIXTURE_ZONE);
