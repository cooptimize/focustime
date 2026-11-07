// TB-1: each environment's Teams app id (the manifest's id), fixed so an upload replaces the app instead of adding
// another. Public ids, nothing secret. scripts/teams-package.ts builds the package with them; IN-1's invite links to
// the app in Teams with them, only where the bot is set up.
export const TEAMS_APP_IDS = { dev: "6f84bb2c-364d-4d76-8a62-153904d0551a", prod: "6e436eed-8f64-43ec-805a-6e68b7e70a5c" } as const;
export type TeamsEnv = keyof typeof TEAMS_APP_IDS;
