// The starter config as the tests know it: working hours in US Eastern, the zone most fixtures and expected values
// were written in. Product code takes the zone from the person's settings or the host clock (config/starter.ts).
import { starterToml } from "../config/starter.ts";

export const FIXTURE_ZONE = "America/New_York";
/** The fictional clients' colors the fixtures were written with (the product's starter has none: no-demo-leak). */
export const FIXTURE_CLIENT_COLORS = `
[clients]
"T&W" = "#1f9e8f"
Proseware = "#7b68ee"
Adatum = "#d2892a"
Cooptimize = "#4a7fd4"
`;
export const STARTER_TOML = `${starterToml(FIXTURE_ZONE)}${FIXTURE_CLIENT_COLORS}`;
