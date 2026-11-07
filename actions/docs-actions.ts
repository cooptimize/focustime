// DOC-1: who may open the Technical docs. Every signed-in Cooptimizer; not an automation account (an admin's flag), the
// same rule as the Teams bot and every picker. Guests never get this far: they are refused at sign-in (ADM-2). The demo's
// person is a fictional Cooptimizer and may read them.
//
// The pages themselves are bundled into the app's built files, which are served without a session like the rest of the
// UI (scripts/tech-docs.ts), so this check decides what the app shows, not who can fetch a file: the pages must never
// hold anything sensitive (docs/technical/README.md).
import type { ActionResponse } from "./types.ts";

export type DocsAccess = { allowed: true } | { allowed: false; why: "automation" | "unknown" };

export type DocsContext = {
  /** Whether an admin flagged me as an automation account. */
  automation: () => Promise<boolean>;
};

export async function docsAccessAction(ctx: DocsContext, input: unknown): Promise<ActionResponse> {
  if (input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input) || Object.keys(input).length)) return { ok: false, status: 400, error: "docs.access takes no input" };
  let automation: boolean;
  try {
    automation = await ctx.automation();
  } catch {
    // Who I am to the team can't be read just now: don't guess either way.
    return { ok: true, data: { allowed: false, why: "unknown" } satisfies DocsAccess };
  }
  return { ok: true, data: (automation ? { allowed: false, why: "automation" } : { allowed: true }) satisfies DocsAccess };
}
