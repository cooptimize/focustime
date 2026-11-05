// FB-1: Send feedback for a signed-in person: the write framework's create (actions/devops-write-actions.ts,
// feedbackWrites), with their own write PAT for the client the feedback project belongs to. The held preview's id never
// leaves the server; Send confirms it through devops.confirm, which checks the PAT again, writes, reads back and logs.
import { devopsWriteAction, feedbackWrites, type DevOpsWriteContext, type FeedbackCheck, type FeedbackWriteTarget } from "./devops-write-actions.ts";
import type { FeedbackBackend } from "./feedback-actions.ts";
import { setupLine, type FeedbackSetup } from "./feedback-types.ts";
import type { DevOpsResult } from "./types.ts";
import { workItemUrl } from "../sources/devops/normalize.ts";

export function setupOf(c: FeedbackCheck): FeedbackSetup {
  if (c.state === "ready") return { state: "ready", clientName: c.clientName, parentId: c.parentId, parentTitle: c.parentTitle, storyType: c.storyType };
  if (c.state === "no_pat") return { state: "no_pat", clientName: c.clientName };
  if (c.state === "no_access") return { state: "no_access", clientName: c.clientName, project: c.project };
  return { state: "not_set_up", reason: c.reason };
}

export function devopsFeedbackBackend(o: {
  write: DevOpsWriteContext;
  /** The org.feedback Rule (bootstrapped from the app config's [feedback]); null when nothing is set. */
  target: () => Promise<FeedbackWriteTarget | null>;
  /** The person's clients (clientAccounts()) and Cooptimize Internal's key (its why "internal"). */
  clients: () => Promise<{ keys: string[]; internal: string | null }>;
  env: string;
}): FeedbackBackend {
  const fw = feedbackWrites(o.write, o.clients);
  return {
    demo: false,
    env: o.env,
    check: async () => setupOf(await fw.check(await o.target())),
    preview: async (p) => {
      const r = await fw.preview(await o.target(), p);
      const v = r.preview;
      return { setup: setupOf(r.check), write: v ? { identity: v.identity, org: v.org, project: v.project, visibility: v.visibility, links: v.links, notes: v.notes } : null, token: v?.previewId ?? null, refused: r.refused };
    },
    confirm: async (token) => {
      const r = await devopsWriteAction(o.write, "devops.confirm", { previewId: token });
      if (!r.ok) return { ok: false, message: r.error };
      const d = r.data as DevOpsResult;
      const id = d.entry.itemId;
      // Created (whatever the read back said): from here it exists.
      if (id !== null && (d.confirmed || d.entry.status === "unconfirmed")) return { ok: true, id, url: d.url ?? workItemUrl(d.entry.org, d.entry.project, id), confirmed: d.confirmed };
      // Refused by DevOps: when it's the project itself the person can't reach, say that.
      const again = await fw.check(await o.target()).catch(() => null);
      if (again?.state === "no_access") return { ok: false, message: setupLine(setupOf(again)) };
      return { ok: false, message: d.message };
    },
  };
}
