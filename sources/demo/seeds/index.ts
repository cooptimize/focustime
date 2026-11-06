// DM-1: every demo seed, in the order they run on a fresh demo session (and again on Reset demo). One file per
// feature; a step that needs demo data adds its own file here and one line below (docs/demo/README.md). Order
// matters only where a seed reads what an earlier one made (the week plan before the unfinished picks, say).
import { aheadSeed } from "./ahead.ts";
import { assistantSeed } from "./assistant.ts";
import { capturesSeed } from "./captures.ts";
import { conversationsSeed } from "./conversations.ts";
import { followupsSeed } from "./followups.ts";
import { historySeed } from "./history.ts";
import { inboxSeed } from "./inbox.ts";
import { noticesSeed } from "./notices.ts";
import { statusSeed } from "./status.ts";
import { teamSeed } from "./team.ts";
import type { DemoSeed } from "./types.ts";
import { unfinishedSeed } from "./unfinished.ts";
import { weekPlanSeed } from "./week-plan.ts";

export type { DemoSeed, DemoSeedEnv } from "./types.ts";

export const DEMO_SEEDS: readonly DemoSeed[] = [
  weekPlanSeed,
  teamSeed,
  followupsSeed,
  capturesSeed,
  unfinishedSeed,
  aheadSeed,
  noticesSeed,
  historySeed,
  conversationsSeed,
  inboxSeed,
  assistantSeed,
  statusSeed,
];
