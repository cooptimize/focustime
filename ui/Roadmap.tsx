// The Roadmap view (step 16, D278 to D282): features and epics I own, per followed client, with stories done and open,
// who works on them, a three-week trend from local daily snapshots and a plain on-track signal. Read-only: the row ⋯
// menu uses existing actions, and the only write it can start is Set target date, through the DevOps write flow.
import { TypeIcon } from "./TypeIcon.tsx";
import { ModeArea } from "./ModeSwitch.tsx";
import type React from "react";
import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import type { AheadState, RoadmapClient, RoadmapRow, RoadmapState, RoadmapStory, WeekLoadData } from "../actions/types.ts";
import { DEFAULT_FILTER, filterRows, stateCounts, STATE_MEANING, STATE_ORDER, STATE_WORDS, type RoadmapFilter, type RoadmapSort, type RoadmapStateKind } from "../plan/roadmap.ts";
import { call } from "./api.ts";
import { overbooked } from "../plan/ahead.ts";
import { DevOpsAction, useDevOpsWrite } from "./DevOpsWrite.tsx";
import { clientColor } from "./labels.ts";
import { openCoopBrief, roadmapRowMenu, type MenuStep } from "./menu.ts";
import { MenuCtx } from "./Menus.tsx";
import { openWorkItem, WorkLink } from "./WorkLink.tsx";
import { createContext } from "react";
import { Avatar, usePhotos, usePresence } from "./Presence.tsx";

/** Step 16.3: presence for the people on the Roadmap (by display name: DevOps gives names only), read once for the view. */
const PresenceCtx = createContext<(p: { name: string; email: string | null }) => { word: import("../plan/presence.ts").PresenceWord | null; photo: string | null }>(() => ({ word: null, photo: null }));

const FLAG: Record<RoadmapRow["flags"][number], string> = { needs_breakdown: "", needs_features: "", no_target_date: "" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthDay = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const GROUP_WORDS: Record<RoadmapStory["group"], string> = { blocked: "Blocked", active: "In progress", new: "Not started", done: "Done" };
const FILTER_KEY = "focustime.roadmap.filter";

/** Step 17: the filters persist for the session (per window), never beyond it. */
function loadFilter(): RoadmapFilter {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY);
    if (!raw) return DEFAULT_FILTER;
    const v = JSON.parse(raw) as Partial<RoadmapFilter>;
    return {
      relation: v.relation === "owned" || v.relation === "contributing" ? v.relation : "both",
      states: Array.isArray(v.states) ? v.states.filter((x): x is RoadmapStateKind => (STATE_ORDER as readonly string[]).includes(x)) : [],
      clients: Array.isArray(v.clients) ? v.clients.filter((x): x is string => typeof x === "string") : [],
      q: typeof v.q === "string" ? v.q.slice(0, 200) : "",
      sort: v.sort === "target" ? "target" : "risk",
      overbooked: v.overbooked === true,
    };
  } catch {
    return DEFAULT_FILTER;
  }
}
function saveFilter(f: RoadmapFilter) {
  try {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(f));
  } catch {
    /* private window: the filter just doesn't persist */
  }
}

/** A state as a badge: the word, a shape mark and the state's full-strength color (never color alone). */
export function StateBadge({ state, small }: { state: RoadmapStateKind; small?: boolean }) {
  return (
    <span className={`rm-badge st-${state}${small ? " small" : ""}`} title={STATE_MEANING[state]}>
      <span className="rm-mark" aria-hidden="true" />
      {STATE_WORDS[state]}
    </span>
  );
}

export function Roadmap({ data, switcher, onChanged }: { data: WeekLoadData; switcher?: React.ReactNode; onChanged: () => void }) {
  const [state, setState] = useState<RoadmapState | null>(null);
  // Step 17: weeks 1 to 4 from Plan ahead, for the Over-booked weeks filter (read after the rows; never blocks them).
  const [ahead, setAhead] = useState<AheadState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilterRaw] = useState<RoadmapFilter>(loadFilter);
  const setFilter = (f: RoadmapFilter) => {
    setFilterRaw(f);
    saveFilter(f);
  };
  const head = useRef<HTMLHeadingElement>(null);
  const dw = useDevOpsWrite();

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      setState(await call<RoadmapState>("roadmap.load", refresh ? { refresh: true } : {}));
      setError(null);
      void call<AheadState>("roadmap.ahead", {}).then(setAhead, () => setAhead(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Roadmap");
    } finally {
      setBusy(false);
    }
  }, []);
  // Reload after a DevOps write (a new target date) so the row shows it.
  useEffect(() => void load(), [load, dw?.version]);
  useEffect(() => head.current?.focus(), []);

  const ops: Ops = {
    // NV-1: the Coop brief opens Break down's side panel (it copies there).
    brief: async (k: string, id: number, title = "") => void openCoopBrief(k, { id, title }),
    addToWeek: async (k: string, row: RoadmapRow) => {
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
  const counts = stateCounts(clients, filter);
  const over = ahead ? overbooked(ahead.clients, ahead.cells) : null;
  const extra = (k: string) => (r: RoadmapRow) =>
    !filter.overbooked || !over || over.items.has(`${k}:${r.id}`) || (r.tier === "epic" && !!clients.find((c) => c.clientKey === k)?.rows.some((f) => f.parentId === r.id && over.items.has(`${k}:${f.id}`)));
  const shown = clients.map((c) => ({ c, rows: filterRows(c.clientKey, c.rows, filter, extra(c.clientKey)) }));
  const total = clients.reduce((n, c) => n + c.rows.length, 0);
  const visible = shown.reduce((n, x) => n + x.rows.length, 0);
  const anyFilter = filter.states.length || filter.clients.length || filter.q.trim() || filter.relation !== "both" || filter.overbooked;
  // Step 16.4: people are matched to Cooptimizers on the server, by email (name only without one); only a match has one.
  const emails = [...new Set(clients.flatMap((c) => c.rows.flatMap((r) => [...r.people.map((p) => p.email), ...r.stories.map((s) => s.email)]).filter((e): e is string => !!e)))];
  const presence = usePresence({ emails, me: true });
  const photos = usePhotos({ emails, me: true });
  const wordOf = useCallback((p: { name: string; email: string | null }) => ({ word: p.name === "You" ? presence.me : p.email ? presence.wordFor({ email: p.email }) : null, photo: p.name === "You" ? photos.me : photos.photoFor(p.email) }), [presence, photos]);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <PresenceCtx.Provider value={wordOf}>
    <main className="roadmap" aria-label="Roadmap">
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Roadmap <span className="muted">{state ? (total ? (visible === total ? plural(total, "feature or epic", "features and epics") : `${visible} of ${total} shown`) : "Nothing of yours yet") : ""}</span>
        </h2>
        <button type="button" className="top-btn" disabled={busy} onClick={() => void load(true)} title="Read DevOps again">
          {busy ? "Reading…" : "Refresh"}
        </button>
        <ModeArea>{switcher}</ModeArea>
      </div>
      {state && total > 0 && (
        <div className="rm-summary" role="group" aria-label="Show only" title={`The first state that applies wins, in this order. Stalled after ${state.thresholds.stalledDays} days; Watch within ${plural(state.thresholds.watchWeeks, "week", "weeks")} of the target date (Settings › Roadmap).`}>
          {STATE_ORDER.filter((k) => counts[k] > 0 || filter.states.includes(k)).map((k) => (
            <button key={k} type="button" className={`rm-sum st-${k}`} title={STATE_MEANING[k]} aria-pressed={filter.states.includes(k)} onClick={() => setFilter({ ...filter, states: toggle(filter.states, k) })}>
              <span className="rm-sum-n">{counts[k]}</span>
              <span className="rm-sum-w"><span className="rm-mark" aria-hidden="true" />{STATE_WORDS[k]}</span>
            </button>
          ))}
          {over && (over.weeks > 0 || filter.overbooked) && (
            <button type="button" className="rm-sum rm-over" aria-pressed={filter.overbooked} onClick={() => setFilter({ ...filter, overbooked: !filter.overbooked })} title="Weeks 1 to 4 where a client's musts take more blocks than it has: show the features in them">
              <span className="rm-sum-n">{over.weeks}</span>
              <span className="rm-sum-w"><span className="rm-mark" aria-hidden="true" />Over-booked {over.weeks === 1 ? "week" : "weeks"}</span>
            </button>
          )}
        </div>
      )}
      {state && total > 0 && (
        <div className="rm-filters">
          <span className="rm-seg" role="group" aria-label="Whose">
            {(["both", "owned", "contributing"] as const).map((r) => (
              <button key={r} type="button" aria-pressed={filter.relation === r} onClick={() => setFilter({ ...filter, relation: r })}>
                {r === "both" ? "Both" : r === "owned" ? "Owned" : "Contributing"}
              </button>
            ))}
          </span>
          <span className="rm-chips" role="group" aria-label="Clients">
            {clients.map((c) => (
              <button key={c.clientKey} type="button" className="rm-chip" style={{ "--c": clientColor(c.clientKey, data.clients) } as CSSProperties} aria-pressed={filter.clients.includes(c.clientKey)} onClick={() => setFilter({ ...filter, clients: toggle(filter.clients, c.clientKey) })}>
                <span className="dl-swatch" aria-hidden="true" />
                {c.clientName}
              </button>
            ))}
          </span>
          <input className="rm-search" type="search" placeholder="Search titles or #id" aria-label="Search the Roadmap" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          <label className="rm-sort">
            Sort
            <select value={filter.sort} onChange={(e) => setFilter({ ...filter, sort: e.target.value as RoadmapSort })}>
              <option value="risk">By risk</option>
              <option value="target">By target date</option>
            </select>
          </label>
          {anyFilter ? (
            <button type="button" className="mini quiet" onClick={() => setFilter({ ...DEFAULT_FILTER, sort: filter.sort })}>
              Clear filters
            </button>
          ) : null}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {!state && !error && <p className="muted">Reading DevOps…</p>}
      {state && !clients.length && <p className="muted">No followed clients with DevOps this week.</p>}
      {state && total > 0 && visible === 0 && <p className="muted">Nothing matches these filters.</p>}
      {shown.map(({ c, rows }) => (rows.length || (!anyFilter && (c.status !== "ok" || !c.rows.length)) ? <ClientSection key={c.clientKey} c={c} rows={rows} colors={data.clients} ops={ops} /> : null))}
    </main>
    </PresenceCtx.Provider>
  );
}

type Ops = { brief: (k: string, id: number, title?: string) => Promise<void>; addToWeek: (k: string, row: RoadmapRow) => Promise<void> };

function ClientSection({ c, rows, colors, ops }: { c: RoadmapClient; rows: RoadmapRow[]; colors: WeekLoadData["clients"]; ops: Ops }) {
  const failed = c.status !== "ok";
  return (
    <section className="co-section dl-client" style={{ "--c": clientColor(c.clientKey, colors) } as CSSProperties} aria-label={c.clientName}>
      <h3>
        <span className="dl-swatch" aria-hidden="true" />
        {c.clientName} <span className="muted">{failed ? "" : c.rows.length ? plural(rows.length, "item", "items") : "nothing of yours"}</span>
        {c.fromCache && !failed && <span className="muted dl-cached">from the last good read</span>}
      </h3>
      {failed && <p className="muted">{c.message ?? "DevOps couldn't be read for this client"}</p>}
      {rows.length > 0 && (
        <ul className="dl-list">
          {rows.map((r) => (
            <Row key={r.id} k={c.clientKey} name={c.clientName} r={r} ops={ops} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ k, name, r, ops }: { k: string; name: string; r: RoadmapRow; ops: Ops }) {
  const wordOf = useContext(PresenceCtx);
  const { env, open: openMenu } = useContext(MenuCtx);
  const dw = useDevOpsWrite();
  const [open, setOpen] = useState(false);
  const noun = r.tier === "epic" ? ["feature", "features"] as const : ["story", "stories"] as const;
  const total = r.done + r.open;
  const owned = r.relation === "owned";
  const target = () => dw?.targetDate({ clientKey: k, itemId: r.id, title: r.title, current: r.targetDate });
  const menu = (): MenuStep =>
    roadmapRowMenu(
      { id: r.id, clientName: name, title: r.title, tier: r.tier, targetDate: r.targetDate, open: r.open, onWeek: r.onWeek, canWrite: !!dw?.can(k), hasLink: !!r.url, owned },
      {
        open: () => void openWorkItem(k, r.url),
        brief: () => void ops.brief(k, r.id, r.title),
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
  const extras = [r.unassigned ? `${r.unassigned} unassigned` : "", r.unsized ? `${r.unsized} without a size` : ""].filter(Boolean);
  const flags = r.flags.map((f) => FLAG[f]).filter(Boolean);
  const groups = (["blocked", "active", "new", "done"] as const).map((g) => ({ g, list: r.stories.filter((s) => s.group === g) })).filter((x) => x.list.length);
  const storiesId = `rm-stories-${k}-${r.id}`;
  return (
    <li className={`dl-row rm-row st-${r.status.state}`} onContextMenu={(e) => env && show(e)}>
      <div className="rm-top">
        <button type="button" className="rm-expand" aria-expanded={open} aria-controls={storiesId} aria-label={`${open ? "Hide" : "Show"} ${noun[1]} of ${r.title}`} onClick={() => setOpen(!open)} disabled={!r.stories.length}>
          {open ? "▾" : "▸"}
        </button>
        <StateBadge state={r.status.state} />
        <div className="dl-main">
          <span className="dl-title">
            <WorkLink clientKey={k} url={r.url}>{r.title}</WorkLink>
            {!owned && <span className="rm-rel" title="The parent of a story assigned to you">Contributing</span>}
          </span>
          <span className="rm-reason">{r.status.reason}</span>
          <span className="dl-meta muted">
            <span><TypeIcon clientKey={k} type={r.type} /> {r.state} ·</span>
            {r.targetDate ? (
              <span>Target {monthDay(r.targetDate)}</span>
            ) : owned ? (
              <>
                <span>No target date</span> <DevOpsAction clientKey={k} label="Set target date" onRun={() => target()} />
              </>
            ) : (
              <span>No target date</span>
            )}
            {r.onWeek && <span>· on this week's plan</span>}
            {r.status.trendBuilding && r.open > 0 && <span className="rm-building" title="Fewer than 7 days of daily counts: no pace yet">Trend building</span>}
          </span>
          <span className="dl-facts">
            {total > 0 && (
              <span className="dl-count">
                {`${r.done} of ${plural(total, noun[0], noun[1])} done`}
                <Progress done={r.done} total={total} />
              </span>
            )}
            {r.people.length > 0 && (
              <span className="dl-people" title={`Who has open ${noun[1]}`}>
                {r.people.map((p, i) => (
                  <span key={p.email ?? p.name} className="dl-person">
                    {i > 0 && " · "}
                    <Avatar name={p.name} photo={wordOf(p).photo} word={wordOf(p).word} size={20} />
                    {p.name} {p.count}
                  </span>
                ))}
              </span>
            )}
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
      </div>
      {open && (
        <div id={storiesId} className="rm-stories">
          {groups.map(({ g, list }) => (
            <div key={g} className={`rm-group g-${g}`}>
              <h4>{GROUP_WORDS[g]} <span className="muted">{list.length}</span></h4>
              <ul>
                {list.map((s) => (
                  <li key={s.id}>
                    <span className="rm-story-title"><WorkLink clientKey={k} url={s.url}>{s.title}</WorkLink></span>
                    <span className="muted rm-story-state">{s.state}</span>
                    <span className="rm-story-who">
                      {s.assignee ? (
                        <>
                          <Avatar name={s.assignee} photo={wordOf({ name: s.assignee, email: s.email }).photo} word={wordOf({ name: s.assignee, email: s.email }).word} size={18} />
                          {s.assignee}
                        </>
                      ) : (
                        <span className="muted">Unassigned</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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

/** Open count over the last three weeks, one point per snapshot day (D280). A single series: no legend; its title names it (U5). */
function Trend({ points, noun }: { points: RoadmapRow["trend"]; noun: string }) {
  const W = 132, H = 34, P = 4;
  if (points.length < 2)
    return (
      <span className="dl-trend dl-trend-empty muted" title="One snapshot is saved each day you open Roadmap">
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
    <span className="dl-trend" title={`Open ${noun}, last 3 weeks`}>
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
    </span>
  );
}
