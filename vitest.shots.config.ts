// CI-3: the screenshot scripts in e2e/shot-scripts/, run only on purpose, never by `npm test` or CI. The app's test
// config (vite.config.ts: the workers, the run's temp folder, the UI built once) with only these files included.
// Usage: <STEP>_SHOTS=screenshots/<step> npm run shots -- e2e/shot-scripts/<step>-shots.ts (each file's header names
// its variable; FOCUSTIME_SHOTS for some). Then scripts/shots-branch.ts puts the folder on shots/<step>.
import type { UserConfig } from "vite";
import base from "./vite.config.ts";

const config: UserConfig = { ...base, test: { ...base.test, include: ["e2e/shot-scripts/*.ts"] } };
export default config;
