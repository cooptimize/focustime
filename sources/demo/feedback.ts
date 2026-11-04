// F1: the demo's (and e2e's) pretend DevOps for Send feedback: the same calls as sources/devops/feedback.ts, answered
// from memory. Nothing leaves FocusTime. `parent: "missing"` or "wrong_type" shows the not-set-up state.
import type { FeedbackDevOps, FeedbackTarget, CreatedItem } from "../devops/feedback.ts";
import { FeedbackFailure } from "../devops/feedback.ts";
import type { FeedbackPayload } from "../../plan/feedback.ts";

export const DEMO_FEEDBACK_TARGET: FeedbackTarget = { org: "demo", project: "Demo Internal", parentId: 496 };
export type DemoFeedbackParent = "ok" | "missing" | "wrong_type";

export function createDemoFeedbackDevOps(o: { parent?: DemoFeedbackParent | undefined; failCreate?: boolean | undefined } = {}): FeedbackDevOps & { created: (FeedbackPayload & { id: number; area: string; iteration: string })[] } {
  const t = DEMO_FEEDBACK_TARGET;
  const created: (FeedbackPayload & { id: number; area: string; iteration: string })[] = [];
  let next = 9001;
  return {
    target: t,
    created,
    parent: async () =>
      o.parent === "missing" ? null : { id: t.parentId, type: o.parent === "wrong_type" ? "Epic" : "Feature", title: "FocusTime (demo feature)", areaPath: t.project, project: t.project },
    storyType: async () => "User Story",
    defaultIteration: async () => `${t.project}\\Iteration 1`,
    create: async (_type, p, area, iteration, validateOnly = false) => {
      if (validateOnly) return { id: null, rev: null };
      if (o.failCreate) throw new FeedbackFailure("error", "DevOps refused it (HTTP 500)", 500);
      const id = next++;
      created.push({ ...p, id, area, iteration });
      return { id, rev: 1 };
    },
    read: async (id): Promise<CreatedItem> => {
      const c = created.find((x) => x.id === id);
      if (!c) throw new FeedbackFailure("not_found", "Not found in DevOps", 404);
      return { id, rev: 1, title: c.title, type: "User Story", parentId: t.parentId, url: "" };
    },
  };
}
