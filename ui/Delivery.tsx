// The Delivery view (step 16, D278 to D282): features and epics I own, per followed client, with stories done and open,
// who works on them, a three-week trend from local daily snapshots and a plain on-track signal. Read-only: the row ⋯
// menu uses existing actions, and the only write it can start is Set target date, through the DevOps write flow.
import type React from "react";
import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import type { DeliveryClient, DeliveryRow, DeliveryState, WeekLoadData } from "../actions/types.ts";
import { call } from "./api.ts";
import { DevOpsAction, useDevOpsWrite } from "./DevOpsWrite.tsx";
import { copy } from "./FollowUps.tsx";
import { clientColor } from "./labels.ts";
import { deliveryRowMenu, type MenuStep } from "./menu.ts";
import { MenuCtx } from "./Menus.tsx";
import { openWorkItem, WorkLink } from "./WorkLink.tsx";

const SIGNAL: Record<NonNullable<DeliveryRow["signal"]["level"]>, string> = { on_track: "On track", watch: "Watch", at_risk: "At risk" };
const FLAG: Record<DeliveryRow["flags"][number], string> = { needs_breakdown: "Needs stories", needs_features: "Needs features", no_target_date: "" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });

export function Delivery({ data, onClose, onChanged }: { data: WeekLoadData; onClose: () => void; onChanged: () => void }) {
  const [state, setState] = useState<DeliveryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<{ id: number; text: string } | null>(null);
  const briefArea = useRef<HTMLTextAreaElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const dw = useDevOpsWrite();

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      setState(await call<DeliveryState>("delivery.load", refresh ? { refresh: true } : {}));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Delivery");
    } finally {
      setBusy(false);
    }
  }, []);
  // Reload after a DevOps write (a new target date) so the row shows it.
  useEffect(() => void load(), [load, dw?.version]);
  useEffect(() => head.current?.focus(), []);

  const ops = {
    brief: async (k: string, id: number) => {
      try {
        const r = await call<{ markdown: string; descriptionRead: boolean }>("feature.brief", { clientKey: k, itemId: id });
        setBrief({ id, text: r.markdown });
        await new Promise((res) => setTimeout(res, 0));
        const ok = await copy(r.markdown, briefArea.current);
        setNotice(ok ? `Coop brief for #${id} copied${r.descriptionRead ? "" : " (the description couldn't be read)"}` : "Copy didn't work: the brief is selected below, press Ctrl+C");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not build the brief");
      }
    },
    addToWeek: async (k: string, row: DeliveryRow) => {
      if (!state) return;
      try {
        await call("weekplan.add", { weekStart: state.weekStart, clientKey: k, itemId: row.id, tier: "nice" });
        setNotice(`${row.title} is on this week's plan as a nice to have`);
        onChanged();
        void load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add it to this week");
      }
    },
  };

  const clients = state?.clients ?? [];
  const total = clients.reduce((n, c) => n + c.rows.length, 0);
  return (
    <main className="delivery" aria-label="Delivery">
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Delivery <span className="muted">{state ? (total ? plural(total, "feature or epic", "features and epics") : "Nothing assigned to you") : ""}</span>
        </h2>
        <button type="button" className="top-btn" disabled={busy} onClick={() => void load(true)} title="Read DevOps again">
          {busy ? "Reading…" : "Refresh"}
        </button>
        <button type="button" className="top-btn" onClick={onClose} title="Back (Esc)">
          Back
        </button>
      </div>
      <p className="muted follow-ups-note">Features and epics assigned to you in DevOps. Counts are saved once a day to show a three-week trend. Nothing here changes DevOps unless you set a target date.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {brief && <textarea ref={briefArea} className="brief-text" readOnly value={brief.text} aria-label={`Coop brief for #${brief.id}`} rows={6} />}
      {!state && !error && <p className="muted">Reading DevOps…</p>}
      {state && !clients.length && <p className="muted">No followed clients with DevOps this week.</p>}
      {clients.map((c) => (
        <ClientSection key={c.clientKey} c={c} colors={data.clients} ops={ops} />
      ))}
    </main>
  );
}

type Ops = { brief: (k: string, id: number) => Promise<void>; addToWeek: (k: string, row: DeliveryRow) => Promise<void> };

function ClientSection({ c, colors, ops }: { c: DeliveryClient; colors: WeekLoadData["clients"]; ops: Ops }) {
  const failed = c.status !== "ok";
  return (
    <section className="co-section dl-client" style={{ "--c": clientColor(c.clientKey, colors) } as CSSProperties} aria-label={c.clientName}>
      <h3>
        <span className="dl-swatch" aria-hidden="true" />
        {c.clientName} <span className="muted">{failed ? "" : c.rows.length ? plural(c.rows.length, "item", "items") : "none assigned to you"}</span>
        {c.fromCache && !failed && <span className="muted dl-cached">from the last good read</span>}
      </h3>
      {failed && <p className="muted">{c.message ?? "DevOps couldn't be read for this client"}</p>}
      {c.rows.length > 0 && (
        <ul className="dl-list">
          {c.rows.map((r) => (
            <Row key={r.id} k={c.clientKey} r={r} ops={ops} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ k, r, ops }: { k: string; r: DeliveryRow; ops: Ops }) {
  const { env, open: openMenu } = useContext(MenuCtx);
  const dw = useDevOpsWrite();
  const noun = r.tier === "epic" ? ["feature", "features"] as const : ["story", "stories"] as const;
  const total = r.done + r.open;
  const target = () => dw?.targetDate({ clientKey: k, itemId: r.id, title: r.title, current: r.targetDate });
  const menu = (): MenuStep =>
    deliveryRowMenu(
      { title: r.title, tier: r.tier, targetDate: r.targetDate, open: r.open, onWeek: r.onWeek, canWrite: !!dw?.can(k), hasLink: !!r.url },
      {
        open: () => void openWorkItem(k, r.url),
        brief: () => void ops.brief(k, r.id),
        help: () => env?.openHelp({ clientKey: k, title: `#${r.id} ${r.title}`, url: r.url, itemId: r.id, pinned: null }),
        addToWeek: () => void ops.addToWeek(k, r),
        targetDate: target,
        enableWrites: () => dw?.enable(k),
      },
    );
  const show = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(e.type === "click" ? { x: b.right, y: b.bottom + 4 } : { x: e.clientX, y: e.clientY }, menu());
  };
  const extras = [
    r.unassigned ? `${r.unassigned} unassigned` : "",
    r.unsized ? `${r.unsized} without a size` : "",
    r.stale ? `${r.stale} quiet for 14 days` : "",
  ].filter(Boolean);
  const flags = r.flags.map((f) => FLAG[f]).filter(Boolean);
  // The meta line already says "No target date" and the count line "No stories yet": no need to repeat them.
  const quietReason = !r.signal.level && (r.signal.reason === "No target date" || total === 0);
  return (
    <li className="dl-row" onContextMenu={(e) => env && show(e)}>
      <div className="dl-main">
        <span className="dl-title">
          {r.signal.level && <span className={`status-pill ${r.signal.level}`}>{SIGNAL[r.signal.level]}</span>}
          <WorkLink clientKey={k} url={r.url}>{r.title}</WorkLink>
        </span>
        <span className="dl-meta muted">
          <span>{r.type} · {r.state} ·</span>
          {r.targetDate ? (
            <span>Target {monthDay(r.targetDate)}</span>
          ) : (
            <>
              <span>No target date</span> <DevOpsAction clientKey={k} label="Set target date" onRun={() => target()} />
            </>
          )}
          {r.onWeek && <span>· on this week's plan</span>}
        </span>
        {!quietReason && <span className="dl-reason">{r.signal.reason}</span>}
        <span className="dl-facts">
          <span className="dl-count">
            {total ? `${r.done} of ${plural(total, noun[0], noun[1])} done` : `No ${noun[1]} yet`}
            {total > 0 && <Progress done={r.done} total={total} />}
          </span>
          {r.people.length > 0 && <span className="dl-people" title={`Who has open ${noun[1]}`}>{r.people.map((p) => `${p.name} ${p.count}`).join(" · ")}</span>}
          {extras.length > 0 && <span className="dl-extras muted">{extras.join(" · ")}</span>}
          {flags.map((f) => (
            <span key={f} className="dl-flag">{f}</span>
          ))}
        </span>
      </div>
      <Trend points={r.trend} noun={noun[1]} />
      {env && (
        <button type="button" className="more" aria-label={`More for ${r.title}`} onClick={show}>
          ⋯
        </button>
      )}
    </li>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <span className="dl-bar" role="img" aria-label={`${done} of ${total} done`}>
      <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
    </span>
  );
}

/** Open count over the last three weeks, one point per snapshot day (D280). A single series: no legend, the label names it. */
function Trend({ points, noun }: { points: DeliveryRow["trend"]; noun: string }) {
  const W = 132, H = 34, P = 4;
  if (points.length < 2)
    return (
      <span className="dl-trend dl-trend-empty muted" title="One snapshot is saved each day you open Delivery">
        {points.length ? "Trend starts today" : "No trend yet"}
      </span>
    );
  const last = Temporal.PlainDate.from(points[points.length - 1]!.date);
  const first = last.subtract({ days: 21 });
  const max = Math.max(1, ...points.map((p) => p.open));
  const x = (d: string) => P + ((Temporal.PlainDate.from(d).since(first).days) / 21) * (W - 2 * P);
  const y = (n: number) => H - P - (n / max) * (H - 2 * P);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.open).toFixed(1)}`).join(" ");
  const a = points[0]!, b = points[points.length - 1]!;
  return (
    <span className="dl-trend">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Open ${noun}, last three weeks: ${a.open} on ${monthDay(a.date)}, ${b.open} on ${monthDay(b.date)}`}>
        <line className="dl-base" x1={P} x2={W - P} y1={H - P} y2={H - P} />
        <path className="dl-line" d={line} />
        {points.map((p) => (
          <g key={p.date}>
            <circle className="dl-dot" cx={x(p.date)} cy={y(p.open)} r={p === b ? 3 : 2} />
            {/* A larger hit area than the dot, for the hover tooltip. */}
            <circle className="dl-hit" cx={x(p.date)} cy={y(p.open)} r={7}>
              <title>{`${monthDay(p.date)}: ${p.open} open, ${p.done} done`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <span className="dl-trend-label muted">Open {noun}, 3 weeks</span>
    </span>
  );
}
