// Which clients are followed (step 6d), shared by week.load and settings.load.
import type { AppConfig } from "../config/schema.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import type { FollowOptions } from "../week/follow.ts";
import type { FocusPattern } from "../week/types.ts";

/**
 * What decides which clients are followed (step 6d): my Focus Time rows still running on or after today minus the
 * grace days, the standing-block clients and "Keep following". If that read fails with no cache, this week's rows
 * stand in, so the week's own clients are still followed.
 */
export async function followOptions(
  dv: Pick<DataverseSource, "following">,
  cfg: AppConfig,
  today: string,
  refresh: { refresh?: boolean },
  fallback: readonly FocusPattern[],
): Promise<{ patterns: readonly FocusPattern[]; options: FollowOptions; usable: boolean }> {
  const since = Temporal.PlainDate.from(today).subtract({ days: cfg.plan.followGraceDays }).toString();
  const r = await dv.following(since, refresh).catch(() => null);
  const usable = !!r && (r.status === "ok" || r.fromCache);
  return {
    usable,
    patterns: usable ? r!.items : fallback,
    options: {
      today,
      graceDays: cfg.plan.followGraceDays,
      always: cfg.week.standingBlocks.map((b) => b.clientKey),
      kept: Object.entries(cfg.clientSettings).filter(([, c]) => c.follow).map(([k]) => k),
    },
  };
}
