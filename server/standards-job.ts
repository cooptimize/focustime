// KB-1: the standards sync, one app job. At startup, then hourly while FocusTime is in use (the scheduler's slow pass), and
// from an admin's Sync now. An idle server never wakes for it (D431: wake is null). A failure keeps the last good copy and
// records the error for Admin › Standards. Logs carry counts and outcomes only.
import type { Logger } from "../log/logger.ts";
import { parseRepoUrl, STANDARDS_EVERY_MS, validBranch } from "../plan/standards.ts";
import { StandardsReadError, type StandardsReader } from "../sources/github/standards.ts";
import type { StandardsStore, StandardsSyncResult, StandardsWarning } from "../store/standards-store.ts";

export const STANDARDS_JOB = "standards_sync";
export type StandardsSource = { repoUrl: string; branch: string };

export function standardsJob(d: { store: StandardsStore; reader: StandardsReader; source: () => Promise<StandardsSource>; now: () => Temporal.Instant; log: Logger }) {
  let lastCheck: Temporal.Instant | null = null;
  let running: Promise<StandardsSyncResult> | null = null;

  async function sync(): Promise<StandardsSyncResult> {
    const { repoUrl, branch } = await d.source();
    const at = () => d.now().toString();
    const fail = async (error: string): Promise<StandardsSyncResult> => {
      await d.store.failed(repoUrl, branch, at(), error);
      d.log({ source: "server", op: "sync", kind: "failed" });
      return { ok: false, changed: false, error };
    };
    const repo = parseRepoUrl(repoUrl);
    if (!repo) return fail("The repo address isn't a https://github.com/<owner>/<repo> address");
    if (!validBranch(branch)) return fail("The branch name isn't valid");
    try {
      const prior = await d.store.state();
      // A new address or branch reads in full even if the commit looks the same.
      const known = prior && prior.repoUrl === repoUrl && prior.branch === branch ? prior.commit : null;
      const r = await d.reader.read(repo, branch, known);
      if (!r.changed) {
        await d.store.checked(repoUrl, branch, at());
        d.log({ source: "server", op: "sync", kind: "unchanged" });
        return { ok: true, changed: false, error: null };
      }
      const warnings: StandardsWarning[] = [...r.duplicates.map((x) => ({ kind: "duplicate_id" as const, ...x })), ...r.incomplete.map((x) => ({ kind: "incomplete" as const, ...x }))];
      await d.store.replace({ repoUrl, branch, commit: r.commit, at: at(), articles: r.articles, warnings });
      d.log({ source: "server", op: "sync", kind: "updated", count: r.articles.length });
      return { ok: true, changed: true, error: null };
    } catch (e) {
      return fail(e instanceof StandardsReadError ? e.message : "The sync failed");
    }
  }

  /** One sync at a time: a Sync now during the hourly check shares its result. */
  const once = () => (running ??= sync().finally(() => (running = null)));
  return {
    name: STANDARDS_JOB,
    /** At startup and on each slow pass: reads only when an hour has passed since the last check. */
    async run(): Promise<void> {
      const now = d.now();
      if (lastCheck && Temporal.Instant.compare(lastCheck.add({ milliseconds: STANDARDS_EVERY_MS }), now) > 0) return;
      lastCheck = now;
      await once();
    },
    /** Admin's Sync now. */
    async syncNow(): Promise<StandardsSyncResult> {
      lastCheck = d.now();
      return once();
    },
    /** Never wakes an idle server: the next use catches up. */
    wake: async (): Promise<Temporal.Instant | null> => null,
    lastCheck: () => lastCheck,
  };
}
