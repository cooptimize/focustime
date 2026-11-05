// F1, FB-1: the demo's (and e2e's) pretend DevOps for Send feedback, answered from memory. Nothing leaves FocusTime.
// `parent: "missing"` or "wrong_type" shows the not-set-up state; "no_pat" and "no_access" show those states; "fail"
// refuses the create.
import { randomUUID } from "node:crypto";
import type { FeedbackPayload } from "../../plan/feedback.ts";
import type { FeedbackBackend } from "../../actions/feedback-actions.ts";
import type { FeedbackSetup } from "../../actions/feedback-types.ts";

export type FeedbackTarget = { org: string; project: string; parentId: number };
export type ParentItem = { id: number; type: string; title: string; areaPath: string; project: string };
export type CreatedItem = { id: number; rev: number; title: string; type: string; parentId: number | null; url: string };
export class DemoFeedbackFailure extends Error {}

export const DEMO_FEEDBACK_TARGET: FeedbackTarget = { org: "demo", project: "Demo Internal", parentId: 496 };
export type DemoFeedbackParent = "ok" | "missing" | "wrong_type" | "no_pat" | "no_access" | "fail";

export function createDemoFeedbackDevOps(o: { parent?: DemoFeedbackParent | undefined; failCreate?: boolean | undefined } = {}) {
  const t = DEMO_FEEDBACK_TARGET;
  const created: (FeedbackPayload & { id: number; area: string })[] = [];
  let next = 9001;
  return {
    target: t,
    created,
    state: o.parent ?? "ok",
    parent: async (): Promise<ParentItem | null> =>
      o.parent === "missing" ? null : { id: t.parentId, type: o.parent === "wrong_type" ? "Epic" : "Feature", title: "FocusTime (demo feature)", areaPath: t.project, project: t.project },
    storyType: async () => "User Story",
    parentTypes: async () => ["Feature"],
    create: async (p: FeedbackPayload, area: string): Promise<{ id: number; rev: number }> => {
      if (o.failCreate || o.parent === "fail") throw new DemoFeedbackFailure("DevOps refused it (HTTP 500)");
      const id = next++;
      created.push({ ...p, id, area });
      return { id, rev: 1 };
    },
    read: async (id: number): Promise<CreatedItem> => {
      const c = created.find((x) => x.id === id);
      if (!c) throw new DemoFeedbackFailure("Not found in DevOps");
      return { id, rev: 1, title: c.title, type: "User Story", parentId: t.parentId, url: "" };
    },
  };
}
export type DemoFeedbackDevOps = ReturnType<typeof createDemoFeedbackDevOps>;

/** FB-1: Send feedback in the demo: the same dialog and checks against this pretend backlog; the preview says so. */
const DEMO_CLIENT = "Internal";

export function demoFeedbackBackend(d: DemoFeedbackDevOps): FeedbackBackend {
  const tokens = new Map<string, FeedbackPayload>();
  async function check(): Promise<FeedbackSetup> {
    if (d.state === "no_pat") return { state: "no_pat", clientName: DEMO_CLIENT };
    if (d.state === "no_access") return { state: "no_access", clientName: DEMO_CLIENT, project: d.target.project };
    const parent = await d.parent();
    if (!parent) return { state: "not_set_up", reason: `Feature #${d.target.parentId} isn't there, or your DevOps account can't see it` };
    if (!(await d.parentTypes()).includes(parent.type)) return { state: "not_set_up", reason: `#${parent.id} is a ${parent.type}, not at the feature level of this process` };
    return { state: "ready", clientName: DEMO_CLIENT, parentId: parent.id, parentTitle: parent.title, storyType: await d.storyType() };
  }
  return {
    demo: true,
    env: "demo",
    check,
    preview: async (p) => {
      const setup = await check();
      if (setup.state !== "ready") return { setup, write: null, token: null, refused: null };
      const token = randomUUID();
      tokens.set(token, p);
      return { setup, write: { identity: "You (the demo person)", org: d.target.org, project: d.target.project, visibility: "Only in this demo: nothing leaves FocusTime.", links: [`Adds a parent link to #${d.target.parentId}`], notes: [] }, token, refused: null };
    },
    confirm: async (token) => {
      const p = tokens.get(token);
      tokens.delete(token);
      if (!p) return { ok: false, message: "That preview expired" };
      try {
        const made = await d.create(p, d.target.project);
        const back = await d.read(made.id);
        return { ok: true, id: made.id, url: back.url, confirmed: back.title === p.title && back.parentId === d.target.parentId };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "Something went wrong sending it" };
      }
    },
  };
}
