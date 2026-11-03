// F1: what Send feedback's actions return, shared with the window (no Node imports here).
export type FeedbackMode = "live" | "preview_only";
export type FeedbackSetup =
  | { state: "ready"; storyType: string; parentId: number; parentTitle: string; checkedAt: string }
  | { state: "not_set_up"; reason: string; checkedAt: string | null }
  /** The developer loop: nothing is checked or sent from this machine. */
  | { state: "local" };

export type FeedbackStatus = { mode: FeedbackMode; setup: FeedbackSetup; destination: string; limit: number; sentToday: number; notSetUp: string };
export type FeedbackPreview = { previewId: string; title: string; description: string; tags: string[]; destination: string; mode: FeedbackMode; setUp: boolean; message: string | null; remaining: number };
export type FeedbackSent = { sent: true; id: number; url: string; confirmed: boolean; message: string } | { sent: false; previewOnly: true; message: string };
