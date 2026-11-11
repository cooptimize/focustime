// PL-1: the "From last week" proposal and Watching rows, shared by Commit mode and the Board's From last week group.
// The proposal is read with weekplan.proposal (which writes nothing); each row is accepted with weekplan.carry_decide
// (Keep, Watch, Drop) or all at once with weekplan.carry_accept_all. Watching rows show the feature's type icon and
// the eye, the state ("No movement this week · Check in with Dana", amber; "Movement not known yet", muted) and the
// 30-minute check-in, movable and removable (the row stays). Take one on a "Not yours yet" row is PV-1's write.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { CarryRow, ProposalData, WatchView } from "../plan/carry.ts";
import type { IsoDate } from "../week/types.ts";
import { call } from "./api.ts";
import { BreakDown } from "./DetailPanel.tsx";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { clientColor } from "./labels.ts";
import { TypeIcon } from "./TypeIcon.tsx";
import { WorkLink } from "./WorkLink.tsx";

/** The eye: a Watching row's mark beside its type icon. */
export function EyeIcon({ title }: { title?: string }) {
  return (
    <svg className="eye-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} aria-label={title}>
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

/** The proposal for a week, read again whenever `version` changes; `act` runs a decision and reloads. */
export function useProposal(weekStart: IsoDate, version: unknown, onChanged: () => void) {
  const [data, setData] = useState<ProposalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await call<ProposalData>("weekplan.proposal", { weekStart }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read last week's plan");
    }
  }, [weekStart]);
  useEffect(() => {
    void load();
  }, [load, version]);
  const act = useCallback(
    async (action: string, input: Record<string, unknown>) => {
      try {
        await call(action, { weekStart, ...input });
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work");
      }
      await load();
      onChanged();
    },
    [weekStart, load, onChanged],
  );
  return { data, error, act, reload: load };
}

const WHY_WORDS = { owner: "you own it", lead: "you lead this client", chosen: "you chose to watch it" } as const;
const KIND_WORDS: Record<CarryRow["kind"], string> = {
  finished: "Finished last week",
  carry: "Carry over as a must",
  watch: "Watching",
  part_done: "Your part is done",
  not_yours: "Not yours yet",
  needs_stories: "Needs stories",
};

const halfWords = (d: IsoDate, h: "AM" | "PM") => `${Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short" })} ${h}`;

function Row({ row, act, onRefresh }: { row: CarryRow; act: (action: string, input: Record<string, unknown>) => Promise<void>; onRefresh: () => void }) {
  const env = useDevOpsWrite();
  const key = { clientKey: row.clientKey, itemId: row.itemId };
  const decide = (decision: "keep" | "drop" | "watch") => void act("weekplan.carry_decide", { ...key, decision });
  const note =
    row.kind === "carry"
      ? `${row.stories.length} open ${row.stories.length === 1 ? "story" : "stories"} of yours`
      : row.kind === "watch" || row.kind === "needs_stories"
        ? row.why ? WHY_WORDS[row.why] : null
        : row.kind === "part_done"
          ? "your stories are done"
          : row.kind === "not_yours"
            ? `${row.stories.length} open ${row.stories.length === 1 ? "story" : "stories"}, none yours`
            : null;
  return (
    <li className={`carry-row kind-${row.kind}`} data-kind={row.kind}>
      <span className="carry-main">
        {row.itemType && <TypeIcon clientKey={row.clientKey} type={row.itemType} decorative />}
        {row.kind === "watch" && <EyeIcon />}
        <WorkLink clientKey={row.clientKey} url={row.url} className="carry-title" title={row.title}>
          {row.title}
        </WorkLink>
      </span>
      <span className="carry-kind">
        {KIND_WORDS[row.kind]}
        {note && <span className="muted"> · {note}</span>}
      </span>
      <span className="carry-acts">
        {row.kind === "carry" && (
          <>
            <button type="button" className="mini primary" onClick={() => decide("keep")}>Keep</button>
            <button type="button" className="link-btn" onClick={() => decide("watch")} title="Keep it moving without doing its stories, with a 30-minute check-in">Watch instead</button>
          </>
        )}
        {row.kind === "watch" && <button type="button" className="mini primary" onClick={() => decide("watch")}>Watch</button>}
        {row.kind === "part_done" && <button type="button" className="mini" onClick={() => decide("watch")} title="Watch it this week, with a 30-minute check-in">Keep watching</button>}
        {row.kind === "needs_stories" && (
          <>
            <button type="button" className="mini primary" onClick={() => decide("keep")} title="Keep it as a must; break it down in Plan">Keep</button>
            <BreakDown clientKey={row.clientKey} item={{ id: row.itemId, title: row.title, ...(row.itemType ? { type: row.itemType } : {}) }} />
          </>
        )}
        {row.kind === "not_yours" &&
          (env?.can(row.clientKey) && row.stories[0] ? (
            <button
              type="button"
              className="mini"
              title={`Assign #${row.stories[0].id} ${row.stories[0].title} to you in DevOps (${row.stories[0].assignedTo ?? "unassigned"} now)`}
              onClick={() => void env.begin(row.clientKey, [{ kind: "assign", itemId: row.stories[0]!.id }], ({ confirmed }) => (confirmed ? onRefresh() : undefined))}
            >
              Take one
            </button>
          ) : env && row.stories[0] ? (
            <button type="button" className="link-btn" onClick={() => env.enable(row.clientKey)}>Enable DevOps writes to take one</button>
          ) : null)}
        <button type="button" className="link-btn carry-drop" onClick={() => decide("drop")} title={row.kind === "finished" ? "Done with it: hide it this week" : "Not this week: it won't be offered again this week"}>
          {row.kind === "finished" ? "Dismiss" : "Drop"}
        </button>
      </span>
    </li>
  );
}

const FOLD_KEY = "focustime.carry.open";
const readOpen = () => {
  try {
    return localStorage.getItem(FOLD_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * "From last week": per client, last week's features as proposal rows; Accept all, or row by row. Folded to one line
 * by default (a "4 to plan" button that opens it) so the Board and Commit stay calm; open or closed is remembered here.
 */
export function ProposalSection({ data, act, onRefresh, colors, title = "From last week", children }: { data: ProposalData; act: (action: string, input: Record<string, unknown>) => Promise<void>; onRefresh: () => void; colors: Record<string, string>; title?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(readOpen);
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(FOLD_KEY, o ? "0" : "1");
      } catch {
        // Not remembered: fine.
      }
      return !o;
    });
  const rows = data.clients.flatMap((c) => c.rows);
  const plannable = rows.filter((r) => r.kind === "carry" || r.kind === "watch" || r.kind === "needs_stories").length;
  if (!rows.length && !children) return null;
  return (
    <section className="carry" aria-label={title}>
      <header className="carry-head">
        <h2 className="section-label">{title}</h2>
        {rows.length > 0 && (
          <button type="button" className="link-btn carry-fold" aria-expanded={open} onClick={toggle} title={open ? "Hide these rows" : "Review last week's features"}>
            {plannable ? `${plannable} to place` : "Nothing to place"}
            {open && data.counts.finished ? ` · ${data.counts.finished} finished` : ""}
          </button>
        )}
        {open && rows.length > 0 && <span className="muted">nothing is added until you accept</span>}
        {open && plannable > 0 && data.access === "plan" && (
          <button type="button" className="mini primary carry-all" onClick={() => void act("weekplan.carry_accept_all", {})} title="Keep every carried must and Needs stories row, and watch every Watching row">
            Accept all
          </button>
        )}
      </header>
      {open &&
        data.clients.map((c) => (
          <div key={c.clientKey} className="carry-client" style={{ "--c": clientColor(c.clientKey, colors) } as CSSProperties}>
            <h3 className="carry-client-name">
              <span className="swatch" aria-hidden="true" />
              {c.clientName}
            </h3>
            <ul className="carry-rows">
              {c.rows.map((r) => (
                <Row key={r.itemId} row={r} act={act} onRefresh={onRefresh} />
              ))}
            </ul>
          </div>
        ))}
      {open && data.unknown > 0 && <p className="muted carry-unknown">DevOps can't say yet about {data.unknown} of last week's {data.unknown === 1 ? "feature" : "features"}; they'll show once it can.</p>}
      {children}
    </section>
  );
}

/** Watching rows: the feature, why, the state, and the 30-minute check-in (move, remove; the row stays). */
export function WatchingList({ watching, act, colors, nameOf, days }: { watching: readonly WatchView[]; act: (action: string, input: Record<string, unknown>) => Promise<void>; colors: Record<string, string>; nameOf: (k: string) => string; days: readonly { date: IsoDate; half: "AM" | "PM"; label: string }[] }) {
  if (!watching.length) return null;
  return (
    <section className="watching" aria-label="Watching">
      <header className="carry-head">
        <h2 className="section-label">Watching</h2>
        <span className="muted">keeping these moving without doing their stories</span>
      </header>
      <ul className="carry-rows">
        {watching.map((w) => (
          <WatchRow key={`${w.clientKey}:${w.itemId}`} w={w} act={act} color={clientColor(w.clientKey, colors)} client={nameOf(w.clientKey)} days={days} />
        ))}
      </ul>
    </section>
  );
}

function WatchRow({ w, act, color, client, days }: { w: WatchView; act: (action: string, input: Record<string, unknown>) => Promise<void>; color: string; client: string; days: readonly { date: IsoDate; half: "AM" | "PM"; label: string }[] }) {
  const key = { clientKey: w.clientKey, itemId: w.itemId };
  const quiet = w.state.kind === "quiet";
  const at = w.pick ? `${halfWords(w.pick.date, w.pick.half as "AM" | "PM")}` : w.checkin ? halfWords(w.checkin.date, w.checkin.half) : null;
  return (
    <li className={`carry-row watch-row${quiet ? " quiet" : ""}`} style={{ "--c": color } as CSSProperties}>
      <span className="carry-main">
        <span className="swatch" aria-hidden="true" />
        {w.itemType && <TypeIcon clientKey={w.clientKey} type={w.itemType} decorative />}
        <EyeIcon title="Watching" />
        <WorkLink clientKey={w.clientKey} url={w.url} className="carry-title" title={w.title}>
          {w.title}
        </WorkLink>
      </span>
      <span className="carry-kind">
        {client} · {WHY_WORDS[w.why]}
        {w.state.kind === "quiet" && (
          <span className="watch-quiet" role="status">
            {" "}· {w.state.text}
            {w.state.checkInWith ? ` · Check in with ${w.state.checkInWith}` : ""}
          </span>
        )}
        {w.state.kind === "unknown" && <span className="muted"> · {w.state.text}</span>}
        {w.state.kind === "moving" && <span className="muted"> · Moving this week</span>}
      </span>
      <span className="carry-acts">
        {w.checkin && at ? (
          <>
            <span className={`checkin-chip inline${w.pick ? " real" : ""}`} title={w.pick ? "A to-do on that day" : "Reserved; it becomes a to-do when that day is planned"}>
              <EyeIcon />
              <span className="cc-word">Check-in</span>
              <span className="cc-min">
                {at} · {w.checkin.minutes}m
              </span>
            </span>
            <select className="watch-move" aria-label={`Move the check-in on ${w.title}`} value="" onChange={(e) => {
              const [date, half] = e.target.value.split(" ");
              if (date && half) void act("weekplan.watch_checkin", { ...key, to: { date, half } });
            }}>
              <option value="">Move…</option>
              {days.map((d) => (
                <option key={`${d.date} ${d.half}`} value={`${d.date} ${d.half}`}>
                  {d.label}
                </option>
              ))}
            </select>
            <button type="button" className="link-btn" onClick={() => void act("weekplan.watch_checkin", { ...key, to: null })} title="Remove the check-in; keep watching it">
              Remove check-in
            </button>
          </>
        ) : (
          days[0] && (
            <button type="button" className="link-btn" onClick={() => void act("weekplan.watch_checkin", { ...key, to: { date: days[0]!.date, half: days[0]!.half } })} title="A 30-minute check-in in its first half-day">
              Add a check-in
            </button>
          )
        )}
        <button type="button" className="link-btn carry-drop" onClick={() => void act("weekplan.watch_remove", key)}>
          Stop watching
        </button>
      </span>
    </li>
  );
}

/** The half-days a check-in can move to: Monday to Friday of the week, from today on. */
export function checkinDays(week: { days: readonly { date: IsoDate; kind: string }[] }, today: IsoDate): { date: IsoDate; half: "AM" | "PM"; label: string }[] {
  return week.days
    .filter((d) => d.kind !== "weekend" && d.date >= today)
    .flatMap((d) => (["AM", "PM"] as const).map((half) => ({ date: d.date, half, label: halfWords(d.date, half) })));
}
