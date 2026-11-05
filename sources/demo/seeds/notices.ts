// P1: this morning's notifications in ⋯ › Notifications: the day's plan (read) and the follow-ups due (new).
import { notices } from "../../../plan/notify.ts";
import type { DemoSeed } from "./types.ts";

export const noticesSeed: DemoSeed = {
  name: "notices",
  owner: "DM-1 (P1)",
  seed: async ({ ctx, day }) => {
    const plan = ctx.plan;
    if (!plan) return;
    const at = Temporal.Instant.from(ctx.now()).toString();
    const planned = notices.planDay(day(0), at);
    const due = notices.followUps(day(0), [{ id: 1, what: "Reply about the proposal timeline", overdue: true }, { id: 2, what: "Send the export spec for review", overdue: false }], at)!;
    const first = await plan.addNotice({ key: planned.key, kind: planned.kind, title: planned.title, body: planned.body, route: planned.route });
    await plan.readNotices([first]);
    await plan.addNotice({ key: due.key, kind: due.kind, title: due.title, body: due.body, route: due.route });
  },
};
