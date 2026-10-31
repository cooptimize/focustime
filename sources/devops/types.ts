// What the Dataverse → DevOps path hands over. Lives in memory for one fetch only; never cached,
// logged or returned to the UI. The PAT is wrapped so it cannot be serialized by accident.
import type { Pat } from "./pat.ts";

export type DevOpsTarget = {
  accountId: string;
  clientKey: string;
  clientName: string;
  org: string | null;
  /** Project name when set, else the project ID; used in API paths. */
  project: string | null;
  projectName: string | null;
  /** My identity in this client's DevOps (Account Worker coop_devopsemail). */
  email: string | null;
  pat: Pat | null;
  /** Set when the target cannot be used safely, e.g. two accounts share one client key. */
  problem?: string;
};

export type TargetsResult = { ok: true; targets: DevOpsTarget[] } | { ok: false; message: string };
