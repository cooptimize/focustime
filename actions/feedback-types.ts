// F1, FB-1: what Send feedback's actions return, shared with the window (no Node imports here).
/** FB-1: Send feedback's setup for the person asking: their own write PAT for the target's client, the parent there. */
export type FeedbackSetup =
  | { state: "ready"; clientName: string; parentId: number; parentTitle: string; storyType: string }
  /** No write PAT (or one that no longer fits) for the client the feedback project belongs to. */
  | { state: "no_pat"; clientName: string }
  /** DevOps refused the person's read of the project (401 or 403). */
  | { state: "no_access"; clientName: string; project: string }
  | { state: "not_set_up"; reason: string };

/** Where "Turn on DevOps writes" goes. */
export const WRITES_HREF = "#/settings/clients";

/** The setup in one line, the same in Settings and the dialog. */
export function setupLine(s: FeedbackSetup): string {
  if (s.state === "ready") return `Set up: stories go under Feature #${s.parentId} (${s.parentTitle}) as ${s.storyType}, created as you with your DevOps write PAT for ${s.clientName}.`;
  if (s.state === "no_pat") return `Turn on DevOps writes for ${s.clientName}: feedback is sent with your own DevOps write PAT.`;
  if (s.state === "no_access") return `Your DevOps account can't reach ${s.project}; ask an admin to add you.`;
  return `Not set up: ${s.reason}.`;
}

export type FeedbackStatus = { setup: FeedbackSetup; line: string; destination: string; limit: number; sentToday: number };
/** The write framework's preview of the create, as the dialog shows it (the held preview's own id stays on the server). */
export type FeedbackWriteView = { identity: string; org: string; project: string; visibility: string; links: string[]; notes: string[] };
export type FeedbackPreview = { previewId: string; title: string; description: string; tags: string[]; destination: string; setUp: boolean; setup: FeedbackSetup; message: string | null; remaining: number; write: FeedbackWriteView | null };
export type FeedbackSent = { sent: true; id: number; url: string; confirmed: boolean; message: string };
