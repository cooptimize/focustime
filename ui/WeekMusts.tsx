// Musts per client for a week (step 11): "Fabrikam: 2 of 4 musts done" from DevOps state, local done marks and done picks,
// against the current list (not the original). In this week, the on-track question: musts left against the client's
// blocks left, worded as a question. In Check-in, "Anything shifted?" swaps musts in or out in one click each.
import { useContext, useState, type CSSProperties } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { borrowedForWeek, weekBudget } from "../plan/weekplan.ts";
import { blocksLeft, onTrack, pickDoneFrom, progressLabel, weekList } from "../plan/weeklist.ts";
import type { IsoDate } from "../week/types.ts";
import { call } from "./api.ts";
import { clientColor } from "./labels.ts";
import { MenuCtx } from "./Menus.tsx";
import { WorkLink } from "./WorkLink.tsx";

type HeadsUp = { weekStart: IsoDate; clientKey: string; itemId: number; title: string; trigger?: "dropped" | "demoted" };

/** The week's list, progress and (when the loaded week is that week) the on-track question per client. */
export function weekMusts(data: WeekLoadData, weekStart: IsoDate, now: string | null) {
  const features = data.weekFeatures.filter((f) => f.weekStart === weekStart);
  const loaded = data.weekStart === weekStart;
  const list = weekList(features, data.devops, [], loaded ? pickDoneFrom(data.plan) : undefined);
  const fits = loaded ? weekBudget(data.week, features, { borrowedMinutes: borrowedForWeek(data.borrowed, weekStart) }) : [];
  const names = new Map([...data.planClients.map((c) => [c.clientKey, c.clientName] as const), ...(data.devops ?? []).map((c) => [c.clientKey, c.clientName] as const), ...fits.map((f) => [f.clientKey, f.clientName] as const)]);
  const rows = list.progress
    .filter((p) => p.musts > 0 || p.nice > 0)
    .map((p) => {
      const fit = fits.find((f) => f.clientKey === p.clientKey);
      return { ...p, name: names.get(p.clientKey) ?? p.clientKey, track: now && fit ? onTrack(p, blocksLeft(fit.blocks, now)) : null };
    });
  return { items: list.items, rows };
}

/** One line per client with musts: progress, and the on-track question when given `now`. */
export function WeekMusts({ data, weekStart, now, title, onPlanWeek, className = "" }: { data: WeekLoadData; weekStart: IsoDate; now: string | null; title: string; onPlanWeek?: () => void; className?: string }) {
  const { rows } = weekMusts(data, weekStart, now);
  const shown = rows.filter((r) => r.musts > 0);
  if (!shown.length) return null;
  return (
    <section className={`week-musts ${className}`} aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {shown.map((r) => (
          <li key={r.clientKey} style={{ "--c": clientColor(r.clientKey, data.clients) } as CSSProperties}>
            <span className="swatch" aria-hidden="true" />
            <strong>{r.name}:</strong> {progressLabel(r)}
            {r.track && r.track.kind !== "none" && r.track.kind !== "done" && <span className={`wm-track ${r.track.kind}`}>{r.track.text}</span>}
          </li>
        ))}
      </ul>
      {onPlanWeek && (
        <button type="button" className="link-btn" onClick={onPlanWeek}>
          Open Plan the week
        </button>
      )}
    </section>
  );
}

/** Check-in: "Anything shifted?" Each client's open musts and nice to haves, swapped in one click; no reason asked. */
export function AnythingShifted({ data, weekStart, now, onChanged }: { data: WeekLoadData; weekStart: IsoDate; now: string; onChanged: () => void }) {
  const { items, rows } = weekMusts(data, weekStart, now);
  const [offer, setOffer] = useState<HeadsUp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { env } = useContext(MenuCtx);
  const shown = rows.filter((r) => r.musts > 0 || r.nice > 0);
  if (!shown.length) return null;
  const swap = async (id: number, itemId: number, tier: "must" | "nice") => {
    try {
      const r = await call<{ headsUp: HeadsUp | null }>("weekplan.set_tier", { id, tier });
      setError(null);
      setNotice(`#${itemId} is now ${tier === "must" ? "a must" : "a nice to have"}`);
      setOffer(r.headsUp);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    }
  };
  const headsUp = async (h: HeadsUp) => {
    try {
      await call("weekplan.headsup", h);
      setNotice(`Follow-up opened: heads-up to ${rows.find((r) => r.clientKey === h.clientKey)?.name ?? h.clientKey}`);
      setOffer(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    }
  };
  return (
    <section className="co-section shifted" aria-label="Anything shifted?">
      <h3>Anything shifted? <span className="muted">Swap musts in or out of the week; no reason needed</span></h3>
      {error && <p className="set-problem" role="alert">{error}</p>}
      {offer ? (
        <p className="co-notice" role="status">
          #{offer.itemId} is out of the musts. Let them know?{" "}
          <button type="button" className="mini" onClick={() => void headsUp(offer)}>Open a heads-up follow-up</button>{" "}
          <button type="button" className="mini quiet" onClick={() => setOffer(null)}>Not needed</button>
        </p>
      ) : (
        notice && <p className="co-notice" role="status">{notice}</p>
      )}
      {shown.map((r) => {
        // A story under a listed feature takes the feature's tier (step 16.4): only the feature is swapped.
        const nested = (i: (typeof items)[number]) => i.level === "story" && i.parentId != null && items.some((f) => f.level === "feature" && f.clientKey === i.clientKey && f.itemId === i.parentId);
        const mine = items.filter((i) => i.clientKey === r.clientKey && !i.done && !nested(i));
        return (
          <div key={r.clientKey} className="shifted-client" style={{ "--c": clientColor(r.clientKey, data.clients) } as CSSProperties}>
            <p className="shifted-head">
              <span className="swatch" aria-hidden="true" /> <strong>{r.name}</strong> {progressLabel(r)}
              {r.track && r.track.kind !== "none" && <span className={`wm-track ${r.track.kind}`}>{r.track.text}</span>}
            </p>
            <ul className="shifted-list">
              {mine.map((i) => (
                <li key={i.id}>
                  <span className={`shifted-tier ${i.tier}`}>{i.tier === "must" ? "Must" : "Nice"}</span>
                  <WorkLink clientKey={i.clientKey} url={i.url}>#{i.itemId} {i.title}</WorkLink>
                  <button type="button" className="mini" onClick={() => void swap(i.id, i.itemId, i.tier === "must" ? "nice" : "must")}>
                    {i.tier === "must" ? "Make nice to have" : "Make a must"}
                  </button>
                  {env && <button type="button" className="mini quiet" onClick={() => env.openHelp({ clientKey: i.clientKey, title: `#${i.itemId} ${i.title}`, url: i.url, itemId: i.itemId, pinned: null })}>Needs help…</button>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
