// Timeboxes in the window (step 12): the day strip in Plan the day (drag a pick or a must onto it, move and resize by
// dragging or with the arrow keys), the Timebox… dialog, timeboxes on the week cards, and the write flow: every Outlook
// change is previewed in a dialog (target, account, calendar, exact fields, who can see it) and confirmed; the result
// is read back before it says so. With "don't ask again" (confirm_own off) changes to my own timebox events confirm
// right after the preview, still logged and undoable.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { TimeboxView, WritePreview, WriteResult, WriteState } from "../actions/types.ts";
import { minutesOf, snap, TIMEBOX_MAX, TIMEBOX_MIN, TIMEBOX_SNAP } from "../plan/timebox.ts";
import type { Day, IsoDate, Slot } from "../week/types.ts";
import { formatDuration } from "../week/format.ts";
import { call } from "./api.ts";
import { clientColor } from "./labels.ts";
import type { TimeboxTarget } from "./menu.ts";
import { NOTICE_EVENT } from "./WorkLink.tsx";

const notify = (message: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: message }));
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;
/** What a dragged pick or item carries. */
export const DRAG_TYPE = "application/x-coopilot-timebox";
export type DragPayload = { pickId: number; minutes: number } | { clientKey: string; itemId: number | null; title: string; url: string | null; minutes: number };

export type TimeboxEnv = {
  timeboxes: readonly TimeboxView[];
  settings: { outlookDefault: boolean; confirmOwn: boolean };
  colors: Record<string, string>;
  tz: string;
  /** Write access, read once when needed (null until known). */
  access: WriteState | null;
  loadAccess: () => void;
  /** After a local change: reload the week. */
  changed: () => void;
  /** Bring Outlook in step with a timebox (preview first). */
  sync: (uid: string) => Promise<void>;
  /** Undo a logged write (preview first), or retry one that didn't confirm. */
  undo: (id: number) => Promise<void>;
  retry: (id: number) => Promise<void>;
  open: (t: TimeboxTarget) => void;
  startFocus: (tb: TimeboxView) => void;
  connectWrite: () => void;
};
export const TimeboxCtx = createContext<TimeboxEnv | null>(null);
export const useTimeboxes = () => useContext(TimeboxCtx);

const clock = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
const range = (t: { start: string; end: string }, tz: string) => `${clock(t.start, tz)} to ${clock(t.end, tz)}`;
/** A local time on `date` at `minutes` past midnight, with the zone's offset. */
function at(date: IsoDate, minutes: number, tz: string): string {
  return Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: tz }).add({ minutes }).toString({ timeZoneName: "never", smallestUnit: "second" });
}
const minuteOfDay = (iso: string, date: IsoDate, tz: string) => Math.round((ms(iso) - Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: tz }).epochMilliseconds) / 60_000);

/** Run a timebox action, then bring Outlook along when the timebox is (or was) on it. */
export async function timeboxChange(env: TimeboxEnv, action: string, input: Record<string, unknown>): Promise<TimeboxView | null> {
  try {
    const r = await call<{ timebox: TimeboxView | null; uid?: string; sync: string | null }>(action, input);
    env.changed();
    const uid = r.timebox?.uid ?? r.uid;
    if (r.sync && uid) await env.sync(uid);
    return r.timebox;
  } catch (e) {
    notify(errText(e));
    return null;
  }
}

// ---------- the write flow ----------

type Flow = { preview: WritePreview; result: WriteResult | null; busy: boolean; error: string | null };
/** The preview dialog and its state, owned by App. `sync`, `undo` and `retry` start it; `onDone` reloads. */
export function useWriteFlow(onDone: () => void) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const confirm = useCallback(
    async (p: WritePreview) => {
      setFlow((f) => (f ? { ...f, busy: true, error: null } : { preview: p, result: null, busy: true, error: null }));
      try {
        const r = await call<WriteResult>("write.confirm", { previewId: p.previewId });
        onDone();
        if (r.confirmed) {
          setFlow(null);
          notify(r.message);
        } else setFlow({ preview: p, result: r, busy: false, error: null });
      } catch (e) {
        setFlow({ preview: p, result: null, busy: false, error: errText(e) });
      }
    },
    [onDone],
  );
  const begin = useCallback(
    async (input: { uid: string } | { undo: number }) => {
      try {
        const r = await call<{ preview?: WritePreview; nothing?: true }>("write.preview", input);
        if (!r.preview) return;
        if (r.preview.auto) return void (await confirm(r.preview));
        setFlow({ preview: r.preview, result: null, busy: false, error: null });
      } catch (e) {
        notify(`Saved in Coopilot. ${errText(e)}`);
      }
    },
    [confirm],
  );
  const retry = useCallback(
    async (id: number, p?: WritePreview) => {
      if (p) setFlow((f) => (f ? { ...f, busy: true } : f));
      try {
        const r = await call<WriteResult>("write.retry", { id });
        onDone();
        if (r.confirmed) {
          setFlow(null);
          notify(r.message);
        } else if (p) setFlow({ preview: p, result: r, busy: false, error: null });
        else notify(r.message);
      } catch (e) {
        if (p) setFlow((f) => (f ? { ...f, busy: false, error: errText(e) } : f));
        else notify(errText(e));
      }
    },
    [onDone],
  );
  const dialog = flow ? <WriteDialog flow={flow} onConfirm={() => void confirm(flow.preview)} onRetry={() => flow.result && void retry(flow.result.entry.id, flow.preview)} onClose={() => setFlow(null)} /> : null;
  return { sync: (uid: string) => begin({ uid }), undo: (id: number) => begin({ undo: id }), retry: (id: number) => retry(id), dialog };
}

function WriteDialog({ flow, onConfirm, onRetry, onClose }: { flow: Flow; onConfirm: () => void; onRetry: () => void; onClose: () => void }) {
  const { preview: p, result, busy, error } = flow;
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    return () => back.current?.focus?.();
  }, []);
  const showBefore = p.op !== "create";
  const showAfter = p.op !== "delete";
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="cap-dialog write-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={p.summary}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="cap-dialog-head">
          <h2>{p.summary}</h2>
        </div>
        <dl className="wd-where">
          <dt>Where</dt>
          <dd>
            {p.system} · {p.account} · {p.calendar}
          </dd>
        </dl>
        <table className="wd-fields">
          <thead>
            <tr>
              <th scope="col">Field</th>
              {showBefore && <th scope="col">{p.op === "delete" ? "Removed" : "Now"}</th>}
              {showAfter && <th scope="col">{p.op === "create" ? "Will be" : "After"}</th>}
            </tr>
          </thead>
          <tbody>
            {p.fields.map((f) => (
              <tr key={f.label} className={f.changed && p.op === "update" ? "changed" : ""}>
                <th scope="row">{f.label}</th>
                {showBefore && <td>{f.before ?? ""}</td>}
                {showAfter && <td>{f.after ?? ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="wd-visibility">
          <strong>Who can see it:</strong> {p.visibility}
        </p>
        {result && !result.confirmed && (
          <p className="set-problem" role="alert">
            {result.message}
          </p>
        )}
        {error && (
          <p className="set-problem" role="alert">
            {error}
          </p>
        )}
        <div className="wd-actions">
          {result && !result.confirmed ? (
            result.entry.status === "refused" ? null : (
              <button ref={first} type="button" className="commit" disabled={busy} onClick={onRetry}>
                {busy ? "Checking…" : "Retry"}
              </button>
            )
          ) : (
            <button ref={first} type="button" className="commit" disabled={busy} onClick={onConfirm}>
              {busy ? "Writing and checking…" : p.op === "create" ? "Put on Outlook" : p.op === "update" ? "Update Outlook" : "Remove from Outlook"}
            </button>
          )}
          <button type="button" className="mini quiet" disabled={busy} onClick={onClose}>
            {result ? "Close" : "Not now"}
          </button>
          <span className="muted">Logged in Settings &gt; Data, with Undo.</span>
        </div>
      </div>
    </div>
  );
}

// ---------- Timebox… dialog ----------

const LENGTHS = [15, 30, 45, 60, 90, 120, 150, 180, 240];
export function TimeboxDialog({ target, defaultMinutes, title, env, onClose }: { target: TimeboxTarget; defaultMinutes: number; title: string; env: TimeboxEnv; onClose: () => void }) {
  const tz = env.tz;
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => () => back.current?.focus?.(), []);
  useEffect(() => env.loadAccess(), []);
  // Default start: the next quarter hour from now on today, else 9:00.
  const today = Temporal.Now.zonedDateTimeISO(tz);
  const startDefault = target.date === today.toPlainDate().toString() ? Math.max(9 * 60, Math.ceil((today.hour * 60 + today.minute) / TIMEBOX_SNAP) * TIMEBOX_SNAP) : 9 * 60;
  const [start, setStart] = useState(() => `${String(Math.floor(startDefault / 60) % 24).padStart(2, "0")}:${String(startDefault % 60).padStart(2, "0")}`);
  const [length, setLength] = useState(() => (LENGTHS.includes(defaultMinutes) ? defaultMinutes : 60));
  const [outlook, setOutlook] = useState(env.settings.outlookDefault);
  const [error, setError] = useState<string | null>(null);
  const canWrite = env.access?.access === "write";
  const save = async () => {
    const [h, m] = start.split(":").map(Number);
    const s = (h ?? 0) * 60 + (m ?? 0);
    const input: Record<string, unknown> = { date: target.date, start: at(target.date, s, tz), end: at(target.date, s + length, tz), outlook };
    if ("pickId" in target) input.pickId = target.pickId;
    else Object.assign(input, { clientKey: target.clientKey, itemId: target.itemId, title: target.title, ...(target.url ? { url: target.url } : {}) });
    try {
      const r = await call<{ timebox: TimeboxView; sync: string | null }>("timebox.add", input);
      env.changed();
      onClose();
      notify(`Timeboxed ${range(r.timebox, tz)}`);
      if (r.sync) await env.sync(r.timebox.uid);
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="cap-dialog tb-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Timebox ${title}`}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="cap-dialog-head">
          <h2>Timebox</h2>
          <span className="muted">{title} · {Temporal.PlainDate.from(target.date).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" })}</span>
        </div>
        <div className="tb-fields">
          <label>
            Start
            <input type="time" step={TIMEBOX_SNAP * 60} value={start} onChange={(e) => setStart(e.target.value)} autoFocus required />
          </label>
          <label>
            Length
            <select value={length} onChange={(e) => setLength(Number(e.target.value))}>
              {LENGTHS.map((l) => (
                <option key={l} value={l}>
                  {formatDuration(l)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <OutlookToggle on={outlook} onChange={setOutlook} env={env} canWrite={canWrite} />
        {error && <p className="set-problem" role="alert">{error}</p>}
        <div className="wd-actions">
          <button type="submit" className="commit">Timebox</button>
          <button type="button" className="mini quiet" onClick={onClose}>Cancel</button>
          {outlook && canWrite && <span className="muted">You'll see exactly what goes on Outlook before anything is written.</span>}
        </div>
      </form>
    </div>
  );
}

/** "Put on Outlook": a switch that explains itself when Coopilot can't write yet. */
function OutlookToggle({ on, onChange, env, canWrite }: { on: boolean; onChange: (v: boolean) => void; env: TimeboxEnv; canWrite: boolean }) {
  const a = env.access;
  return (
    <div className="tb-outlook">
      <label>
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} /> Put on Outlook <span className="muted">a Busy event only you are on, titled with the client and item</span>
      </label>
      {on && a && !canWrite && (
        <p className="tb-explain" role="note">
          {a.access === "not_set_up" ? "Outlook isn't set up, so this timebox stays in Coopilot." : `${a.message}`}{" "}
          {(a.access === "read_only" || a.access === "not_connected") && (
            <button type="button" className="mini" onClick={env.connectWrite}>
              Reconnect Outlook
            </button>
          )}
        </p>
      )}
    </div>
  );
}

// ---------- the day strip (Plan the day) ----------

type Drag = { id: number; mode: "move" | "start" | "end"; x0: number; s0: number; e0: number; s: number; e: number };
/**
 * One row for the day: hours across, meetings as grey marks, timeboxes in client color. Drop a pick or a must here to
 * timebox it; drag a timebox to move it, its edges to resize (15 minute steps). Keys: ← → move, Shift+← → resize,
 * Delete removes, Enter opens its details.
 */
export function DayStrip({ day, now, titleOf }: { day: Day; now: string; titleOf: (clientKey: string) => string }) {
  const env = useTimeboxes();
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [nudge, setNudge] = useState<{ id: number; s: number; e: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  if (!env) return null;
  const tz = env.tz;
  const date = day.date;
  const slots: Slot[] = [day.am, day.pm, ...(day.eve ? [day.eve] : [])];
  const boxes = env.timeboxes.filter((t) => t.date === date && !t.removedAt);
  // Range: the working day's view, widened to whole hours and to anything timeboxed outside it.
  const startsAt = Math.min(...slots.map((s) => minuteOfDay(s.view.start, date, tz)), ...boxes.map((b) => minuteOfDay(b.start, date, tz)));
  const endsAt = Math.max(...slots.map((s) => minuteOfDay(s.view.end, date, tz)), ...boxes.map((b) => minuteOfDay(b.end, date, tz)));
  const lo = Math.floor(startsAt / 60) * 60;
  const hi = Math.max(lo + 60, Math.ceil(endsAt / 60) * 60);
  const span = hi - lo;
  const pct = (m: number) => `${((m - lo) / span) * 100}%`;
  const minuteAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return lo + ((clientX - r.left) / r.width) * span;
  };
  const events = slots.flatMap((s) => s.events.map((p) => p.event)).filter((e, i, a) => !e.allDay && a.findIndex((x) => x.id === e.id) === i);
  const nowMin = minuteOfDay(now, date, tz);

  const commit = (id: number, s: number, e: number) => void timeboxChange(env, "timebox.update", { id, start: at(date, s, tz), end: at(date, e, tz) });
  const onDrop = (ev: DragEvent) => {
    const raw = ev.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    ev.preventDefault();
    const p = JSON.parse(raw) as DragPayload;
    const s = Math.max(lo, Math.min(hi - TIMEBOX_MIN, snap(minuteAt(ev.clientX))));
    const len = Math.max(TIMEBOX_MIN, Math.min(TIMEBOX_MAX, snap(p.minutes)));
    const input: Record<string, unknown> = { date, start: at(date, s, tz), end: at(date, Math.min(s + len, 24 * 60), tz) };
    if ("pickId" in p) input.pickId = p.pickId;
    else Object.assign(input, { clientKey: p.clientKey, itemId: p.itemId, title: p.title, ...(p.url ? { url: p.url } : {}) });
    void timeboxChange(env, "timebox.add", input).then((t) => t && setSelected(t.id));
  };
  const down = (ev: PointerEvent, t: TimeboxView, mode: Drag["mode"]) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    const s = minuteOfDay(t.start, date, tz), e = minuteOfDay(t.end, date, tz);
    setSelected(t.id);
    setDrag({ id: t.id, mode, x0: ev.clientX, s0: s, e0: e, s, e });
  };
  const move = (ev: PointerEvent) => {
    if (!drag) return;
    const r = ref.current!.getBoundingClientRect();
    const d = snap(((ev.clientX - drag.x0) / r.width) * span);
    let s = drag.s0, e = drag.e0;
    if (drag.mode === "move") {
      s = Math.max(0, Math.min(24 * 60 - (drag.e0 - drag.s0), drag.s0 + d));
      e = s + (drag.e0 - drag.s0);
    } else if (drag.mode === "start") s = Math.max(0, Math.min(drag.e0 - TIMEBOX_MIN, drag.s0 + d));
    else e = Math.min(24 * 60, Math.max(drag.s0 + TIMEBOX_MIN, drag.e0 + d));
    setDrag({ ...drag, s, e });
  };
  const up = () => {
    if (!drag) return;
    if (drag.s !== drag.s0 || drag.e !== drag.e0) commit(drag.id, drag.s, drag.e);
    setDrag(null);
  };
  const key = (ev: KeyboardEvent, t: TimeboxView) => {
    const s0 = nudge?.id === t.id ? nudge.s : minuteOfDay(t.start, date, tz);
    const e0 = nudge?.id === t.id ? nudge.e : minuteOfDay(t.end, date, tz);
    let s = s0, e = e0;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      const d = ev.key === "ArrowLeft" ? -TIMEBOX_SNAP : TIMEBOX_SNAP;
      if (ev.shiftKey) e = Math.max(s + TIMEBOX_MIN, Math.min(24 * 60, e + d));
      else if (s + d >= 0 && e + d <= 24 * 60) (s += d), (e += d);
    } else if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      setSelected(null);
      return void timeboxChange(env, "timebox.remove", { id: t.id });
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      return setSelected(t.id);
    } else return;
    ev.preventDefault();
    ev.stopPropagation();
    setNudge({ id: t.id, s, e });
    // One change (and at most one Outlook preview) once the keys stop.
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setNudge(null);
      commit(t.id, s, e);
    }, 700);
  };
  const sel = boxes.find((b) => b.id === selected) ?? null;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => lo + i * 60);

  return (
    <section className="tb-strip-wrap" aria-label="Timeboxes for the day">
      <div className="tb-strip-head">
        <h3>Timeboxes</h3>
        <span className="muted">Drag a pick or a must here (or use Timebox… in its menu). Drag to move, edges to resize; ← → and Shift + ← → with a timebox focused.</span>
      </div>
      <div
        ref={ref}
        className={`tb-strip${drag ? " dragging" : ""}`}
        onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
        onDrop={onDrop}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
      >
        {hours.map((h, i) => (
          <span key={h} className={`tb-hour${i === 0 ? " first" : i === hours.length - 1 ? " last" : ""}`} style={{ left: pct(h) }}>
            {Temporal.PlainTime.from({ hour: Math.floor(h / 60) % 24 }).toLocaleString("en-US", { hour: "numeric" })}
          </span>
        ))}
        {events.map((e) => (
          <span key={e.id} className={`tb-meeting${e.isPersonal ? " personal" : ""}`} style={{ left: pct(minuteOfDay(e.start, date, tz)), width: `${((minuteOfDay(e.end, date, tz) - minuteOfDay(e.start, date, tz)) / span) * 100}%` }} title={`${e.title} · ${range(e, tz)}`} aria-hidden="true" />
        ))}
        {nowMin > lo && nowMin < hi && <span className="tb-now" style={{ left: pct(nowMin) }} aria-hidden="true" />}
        {boxes.map((t) => {
          const live = drag?.id === t.id ? drag : nudge?.id === t.id ? nudge : null;
          const s = live ? live.s : minuteOfDay(t.start, date, tz);
          const e = live ? live.e : minuteOfDay(t.end, date, tz);
          const style = { left: pct(s), width: `${((e - s) / span) * 100}%`, "--c": clientColor(t.clientKey, env.colors) } as CSSProperties;
          const label = `${titleOf(t.clientKey)}: ${t.title}, ${range({ start: at(date, s, tz), end: at(date, e, tz) }, tz)}`;
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              className={`tb-box${selected === t.id ? " selected" : ""}${t.sync ? " out-of-step" : ""}`}
              style={style}
              aria-label={label}
              title={label}
              onPointerDown={(ev) => down(ev, t, "move")}
              onFocus={() => setSelected(t.id)}
              onKeyDown={(ev) => key(ev, t)}
            >
              <span className="tb-edge start" onPointerDown={(ev) => down(ev, t, "start")} aria-hidden="true" />
              <span className="tb-label">
                {t.onOutlook && <span className="tb-ol" title="On Outlook">O</span>}
                {t.title}
              </span>
              <span className="tb-edge end" onPointerDown={(ev) => down(ev, t, "end")} aria-hidden="true" />
            </div>
          );
        })}
      </div>
      {sel && <TimeboxDetails tb={sel} env={env} clientName={titleOf(sel.clientKey)} today={Temporal.Instant.from(now).toZonedDateTimeISO(tz).toPlainDate().toString() === date} onRemoved={() => setSelected(null)} />}
    </section>
  );
}

function TimeboxDetails({ tb, env, clientName, today, onRemoved }: { tb: TimeboxView; env: TimeboxEnv; clientName: string; today: boolean; onRemoved: () => void }) {
  useEffect(() => env.loadAccess(), []);
  const canWrite = env.access?.access === "write";
  return (
    <div className="tb-details" style={{ "--c": clientColor(tb.clientKey, env.colors) } as CSSProperties}>
      <span className="swatch" aria-hidden="true" />
      <strong>{range(tb, env.tz)}</strong>
      <span>
        {clientName}: {tb.title}
      </span>
      <span className="muted">{formatDuration(minutesOf(tb))}</span>
      {today && (
        <button type="button" className="mini" onClick={() => env.startFocus(tb)}>
          Start focus
        </button>
      )}
      <label className="tb-ol-toggle">
        <input type="checkbox" checked={tb.outlook} onChange={(e) => void timeboxChange(env, "timebox.set_outlook", { id: tb.id, on: e.target.checked })} /> Put on Outlook
      </label>
      {tb.sync && canWrite && (
        <button type="button" className="mini" onClick={() => void env.sync(tb.uid)}>
          {tb.sync === "create" ? "Put on Outlook now" : tb.sync === "update" ? "Update Outlook" : "Remove from Outlook"}
        </button>
      )}
      {tb.onOutlook && !tb.sync && <span className="muted">On Outlook</span>}
      {tb.sync && env.access && !canWrite && (
        <span className="tb-explain">
          {env.access.access === "not_set_up" ? "Outlook isn't set up; kept in Coopilot." : "Saved in Coopilot. To put it on Outlook, reconnect Outlook and allow calendar changes."}{" "}
          {(env.access.access === "read_only" || env.access.access === "not_connected") && (
            <button type="button" className="mini" onClick={env.connectWrite}>
              Reconnect Outlook
            </button>
          )}
        </span>
      )}
      <button
        type="button"
        className="mini quiet"
        onClick={() => {
          onRemoved();
          void timeboxChange(env, "timebox.remove", { id: tb.id });
        }}
      >
        Remove
      </button>
    </div>
  );
}

/** A drag handle for a pick or item: drop it on the day strip to timebox it. */
export function DragHandle({ payload, label }: { payload: DragPayload; label: string }) {
  return (
    <span
      className="tb-handle"
      draggable
      title={`Drag onto the timeboxes row to timebox ${label}`}
      aria-hidden="true"
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      ⠿
    </span>
  );
}

// ---------- the week cards ----------

/** Timeboxes inside a card's timeline, in client color (Coopilot's own Outlook events show only here, once). */
export function TimeboxBands({ slot, pos }: { slot: Slot; pos: (iso: string) => number }): ReactNode {
  const env = useTimeboxes();
  if (!env) return null;
  const a = ms(slot.view.start), b = ms(slot.view.end);
  const here = env.timeboxes.filter((t) => t.date === slot.date && !t.removedAt && ms(t.end) > a && ms(t.start) < b);
  return here.map((t) => {
    const s = Math.max(ms(t.start), a), e = Math.min(ms(t.end), b);
    const top = pos(new Date(s).toISOString()), bottom = pos(new Date(e).toISOString());
    return (
      <div key={`tb-${t.id}`} className="tbox" style={{ top: `${top * 100}%`, height: `${(bottom - top) * 100}%`, "--c": clientColor(t.clientKey, env.colors) } as CSSProperties} title={`Timebox: ${t.title}\n${range(t, env.tz)}${t.onOutlook ? " · on Outlook" : ""}`}>
        <span className="tbox-label">{t.title}</span>
      </div>
    );
  });
}

/** Compact cards (no timeline): the timeboxes that start in this half-day, as a short list in client color. */
export function TimeboxList({ slot }: { slot: Slot }): ReactNode {
  const env = useTimeboxes();
  if (!env) return null;
  const a = ms(slot.view.start), b = ms(slot.view.end);
  const here = env.timeboxes.filter((t) => t.date === slot.date && !t.removedAt && ms(t.start) >= a && ms(t.start) < b);
  if (!here.length) return null;
  return (
    <ul className="ev-list tb-list" aria-label="Timeboxes">
      {here.map((t) => (
        <li key={t.id} style={{ "--c": clientColor(t.clientKey, env.colors) } as CSSProperties} title={`Timebox: ${t.title}\n${range(t, env.tz)}${t.onOutlook ? " · on Outlook" : ""}`}>
          <span className="ev-time">{clock(t.start, env.tz).replace(/ [AP]M$/, "")}</span>
          <span className="ev-title">{t.title}</span>
        </li>
      ))}
    </ul>
  );
}
