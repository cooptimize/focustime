// Timeboxes in the window (step 12, redesigned in step 13.6): a timebox's details in Plan the day's agenda, the
// Timebox… dialog, timeboxes on the week cards (drag to move and resize), and the write flow: every Outlook
// change is previewed in a dialog (target, account, calendar, exact fields, who can see it) and confirmed; the result
// is read back before it says so. With "don't ask again" (confirm_own off) changes to my own timebox events confirm
// right after the preview, still logged and undoable.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import type { InviteView, TimeboxView, WritePreview, WriteResult, WriteState } from "../actions/types.ts";
import { minutesOf, SHOW_AS_LABEL, SHOW_AS_VALUES, TIMEBOX_SNAP, type OutlookShowAs } from "../plan/timebox.ts";
import { REMOVED_IN_OUTLOOK } from "../plan/outlooksync.ts";
import { useMenu } from "./Menus.tsx";
import { timeboxMenu, timeStep, type HelpTarget } from "./menu.ts";
import { dragTimes, type DragMode } from "../plan/picktime.ts";
import type { IsoDate, Slot } from "../week/types.ts";
import { formatDuration } from "../week/format.ts";
import { call } from "./api.ts";
import { clientColor } from "./labels.ts";
import type { TimeboxTarget } from "./menu.ts";
import { NOTICE_EVENT } from "./WorkLink.tsx";

const notify = (message: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: message }));
const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;

export type TimeboxEnv = {
  timeboxes: readonly TimeboxView[];
  settings: { outlookDefault: boolean; confirmOwn: boolean; enabled: boolean };
  colors: Record<string, string>;
  tz: string;
  /** Write access, read once when needed (null until known). */
  access: WriteState | null;
  loadAccess: () => void;
  /** After a local change: reload the week. */
  changed: () => void;
  /** Bring Outlook in step with a timebox (preview first). */
  sync: (uid: string) => Promise<void>;
  /** Step 13.6 (D247): several at once, in one combined preview. */
  syncMany: (uids: string[]) => Promise<void>;
  /** Undo a logged write (preview first), or retry one that didn't confirm. */
  undo: (id: number) => Promise<void>;
  retry: (id: number) => Promise<void>;
  open: (t: TimeboxTarget) => void;
  startFocus: (tb: TimeboxView) => void;
  connectWrite: () => void;
  /** Step 13: "Needs help from…", and the help invites to show on items. */
  help: (t: HelpTarget) => void;
  invites: readonly InviteView[];
};
export const TimeboxCtx = createContext<TimeboxEnv | null>(null);
export const useTimeboxes = () => useContext(TimeboxCtx);

const clock = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
const range = (t: { start: string; end: string }, tz: string) => `${clock(t.start, tz)} to ${clock(t.end, tz)}`;
/** A local time on `date` at `minutes` past midnight, with the zone's offset. */
function at(date: IsoDate, minutes: number, tz: string): string {
  return Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: tz }).add({ minutes }).toString({ timeZoneName: "never", smallestUnit: "second" });
}

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
type BatchRow = { preview: WritePreview; result: WriteResult | { error: string; status: number } | null };
type Batch = { rows: BatchRow[]; busy: boolean; error: string | null };
/** The preview dialog and its state, owned by App. `sync`, `undo` and `retry` start it; `onDone` reloads. */
export function useWriteFlow(onDone: () => void) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  // Step 13.6 (D247): one dialog for several events; each is confirmed, read back, logged and undoable on its own.
  const confirmBatch = useCallback(
    async (rows: BatchRow[]) => {
      setBatch({ rows, busy: true, error: null });
      try {
        let next: BatchRow[];
        if (rows.some((r) => r.result)) {
          // Trying again: a logged write that didn't confirm is retried by its log entry (never written twice).
          next = [];
          for (const r of rows) {
            const res = r.result;
            if (res && "entry" in res && !res.confirmed && res.entry.status !== "refused") next.push({ ...r, result: await call<WriteResult>("write.retry", { id: res.entry.id }).catch((e: unknown) => ({ error: errText(e), status: 0 })) });
            else next.push(r);
          }
        } else {
          const out = await call<{ results: (WriteResult | { error: string; status: number })[] }>("write.confirm", { previewIds: rows.map((r) => r.preview.previewId) });
          next = rows.map((r, k) => ({ ...r, result: out.results[k] ?? null }));
        }
        onDone();
        const ok = next.filter((r) => r.result && "confirmed" in r.result && r.result.confirmed).length;
        if (ok === next.length) {
          setBatch(null);
          notify(ok === 1 ? "On Outlook" : `${ok} events on Outlook`);
        } else setBatch({ rows: next, busy: false, error: null });
      } catch (e) {
        setBatch({ rows, busy: false, error: errText(e) });
      }
    },
    [onDone],
  );
  const beginMany = useCallback(
    async (uids: string[]) => {
      if (!uids.length) return;
      try {
        const r = await call<{ previews: WritePreview[]; nothing: string[]; alreadyGone: string[] }>("write.preview", { uids });
        if (r.alreadyGone.length) onDone();
        if (!r.previews.length) return void notify(r.alreadyGone.length ? "Already gone from Outlook" : "Outlook is already up to date");
        const rows = r.previews.map((preview) => ({ preview, result: null }));
        if (r.previews.every((p) => p.auto)) return void (await confirmBatch(rows));
        setBatch({ rows, busy: false, error: null });
      } catch (e) {
        notify(`Saved in Coopilot. ${errText(e)}`);
      }
    },
    [confirmBatch, onDone],
  );
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
    async (input: { uid: string } | { undo: number } | { event: { id: string; start?: string; end?: string; showAs?: string } }) => {
      try {
        const r = await call<{ preview?: WritePreview; nothing?: true; alreadyGone?: true }>("write.preview", input);
        if (r.alreadyGone) {
          onDone();
          return void notify("Already gone from Outlook");
        }
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
  const dialog = flow ? (
    <WriteDialog flow={flow} onConfirm={() => void confirm(flow.preview)} onRetry={() => flow.result && void retry(flow.result.entry.id, flow.preview)} onClose={() => setFlow(null)} />
  ) : batch ? (
    <BatchWriteDialog batch={batch} onConfirm={() => void confirmBatch(batch.rows)} onClose={() => setBatch(null)} />
  ) : null;
  return {
    sync: (uid: string) => begin({ uid }),
    syncMany: (uids: string[]) => beginMany(uids),
    undo: (id: number) => begin({ undo: id }),
    retry: (id: number) => retry(id),
    /** Step 13: one of my own events (time and show as only), previewed first. */
    edit: (event: { id: string; start?: string; end?: string; showAs?: string }) => begin({ event }),
    /** A preview made elsewhere (a help invite). */
    show: (p: WritePreview) => setFlow({ preview: p, result: null, busy: false, error: null }),
    dialog,
  };
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
        data-overlay="modal"
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
        {p.kind === "invite" && p.attendees.length > 0 && (
          <div className="wd-people" role="note">
            <strong>{p.op === "delete" ? "These people get a cancellation:" : "These people get an invite by email:"}</strong>
            <ul>
              {p.attendees.map((a) => (
                <li key={a.email}>
                  {a.name} <span className="muted">{a.email}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
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
              {busy ? "Writing and checking…" : p.kind === "invite" ? (p.op === "delete" ? "Cancel the invite" : "Send invite") : p.op === "create" ? "Put on Outlook" : p.op === "update" ? "Update Outlook" : "Remove from Outlook"}
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

/**
 * The combined preview (step 13.6, D247): every event that will go on Outlook, each with its fields, then one
 * confirm. Each is written, read back and logged on its own, so each has its own result and its own undo.
 */
function BatchWriteDialog({ batch, onConfirm, onClose }: { batch: Batch; onConfirm: () => void; onClose: () => void }) {
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    return () => back.current?.focus?.();
  }, []);
  const { rows, busy, error } = batch;
  const p0 = rows[0]!.preview;
  const done = (r: BatchRow) => !!r.result && "confirmed" in r.result && r.result.confirmed;
  const left = rows.filter((r) => !done(r)).length;
  const retryable = rows.filter((r) => r.result && "entry" in r.result && !r.result.confirmed && r.result.entry.status !== "refused").length;
  const tried = rows.some((r) => r.result);
  const creates = rows.every((r) => r.preview.op === "create");
  const label = (n: number) => (creates ? `Put ${n === 1 ? "it" : `all ${n}`} on Outlook` : `Make ${n === 1 ? "this change" : `all ${n} changes`} on Outlook`);
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="cap-dialog write-dialog batch"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${rows.length} Outlook changes`}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="cap-dialog-head">
          <h2>{creates ? `Put ${rows.length === 1 ? "1 timebox" : `${rows.length} timeboxes`} on Outlook` : `${rows.length} Outlook changes`}</h2>
        </div>
        <dl className="wd-where">
          <dt>Where</dt>
          <dd>
            {p0.system} · {p0.account} · {p0.calendar}
          </dd>
        </dl>
        <ol className="wd-batch">
          {rows.map((r) => {
            const p = r.preview;
            const res = r.result;
            return (
              <li key={p.previewId} className={done(r) ? "ok" : res ? "bad" : ""}>
                <p className="wd-batch-head">
                  <strong>{p.summary}</strong>
                  {done(r) && <span className="muted"> · {(res as WriteResult).message}</span>}
                  {res && !done(r) && <span className="set-problem"> · {"error" in res ? res.error : res.message}</span>}
                </p>
                <table className="wd-fields">
                  <tbody>
                    {p.fields.map((f) => (
                      <tr key={f.label} className={f.changed && p.op === "update" ? "changed" : ""}>
                        <th scope="row">{f.label}</th>
                        {p.op !== "create" && <td>{f.before ?? ""}</td>}
                        {p.op !== "delete" && <td>{f.after ?? ""}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            );
          })}
        </ol>
        <p className="wd-visibility">
          <strong>Who can see them:</strong> {p0.visibility}
        </p>
        {error && (
          <p className="set-problem" role="alert">
            {error}
          </p>
        )}
        {tried && left > 0 && <p className="set-problem" role="alert">{left === 1 ? "One change didn't go through." : `${left} changes didn't go through.`} The others are done. Try again, or use Retry in Settings &gt; Data.</p>}
        <div className="wd-actions">
          <button ref={first} type="button" className="commit" disabled={busy || left === 0 || (tried && retryable === 0)} onClick={onConfirm}>
            {busy ? "Writing and checking…" : tried ? "Try the rest again" : label(rows.length)}
          </button>
          <button type="button" className="mini quiet" disabled={busy} onClick={onClose}>
            {tried ? "Close" : "Not now"}
          </button>
          <span className="muted">Each one is logged in Settings &gt; Data, with its own Undo.</span>
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
        data-overlay="modal"
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

// ---------- a timebox's details (Plan the day agenda) ----------

export function TimeboxDetails({ tb, env, clientName, today, onRemoved }: { tb: TimeboxView; env: TimeboxEnv; clientName: string; today: boolean; onRemoved: () => void }) {
  useEffect(() => env.loadAccess(), []);
  const canWrite = env.access?.access === "write";
  const [title, setTitle] = useState(tb.title);
  useEffect(() => setTitle(tb.title), [tb.id, tb.title]);
  return (
    <div className="tb-details" style={{ "--c": clientColor(tb.clientKey, env.colors) } as CSSProperties}>
      <span className="swatch" aria-hidden="true" />
      <strong>{range(tb, env.tz)}</strong>
      <span className="tb-retitle">
        {clientName}:{" "}
        <input
          aria-label="Timebox title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title.trim() !== tb.title && void timeboxChange(env, "timebox.update", { id: tb.id, title: title.trim() })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setTitle(tb.title);
          }}
        />
      </span>
      <span className="muted">{formatDuration(minutesOf(tb))}</span>
      <label className="tb-show">
        Show as{" "}
        <select value={tb.showAs} onChange={(e) => void timeboxChange(env, "timebox.update", { id: tb.id, showAs: e.target.value })}>
          {SHOW_AS_VALUES.map((v) => (
            <option key={v} value={v}>
              {SHOW_AS_LABEL[v]}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="mini" onClick={() => env.help({ clientKey: tb.clientKey, title: tb.title, url: tb.url, itemId: tb.itemId, pickId: tb.pickId, timeboxId: tb.id, pinned: tb.date })}>
        Needs help from…
      </button>
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
      {tb.onOutlook && !tb.sync && !tb.conflict && <span className="muted">On Outlook</span>}
      {tb.outlookNote && !tb.conflict && tb.outlookNote !== REMOVED_IN_OUTLOOK && <span className="tb-note">{tb.outlookNote}</span>}
      {tb.outlookNote === REMOVED_IN_OUTLOOK && !tb.conflict && <RemovedChoice tb={tb} env={env} onRemoved={onRemoved} />}
      {tb.conflict && <ConflictChoice tb={tb} env={env} clientName={clientName} />}
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

/** Its event was deleted in Outlook (step 13.5): the timebox stays here with Put on Outlook off; Keep or Remove it. */
function RemovedChoice({ tb, env, onRemoved }: { tb: TimeboxView; env: TimeboxEnv; onRemoved: () => void }) {
  const choose = async (keep: "local" | "remove") => {
    try {
      if (keep === "remove") onRemoved();
      await call("timebox.resolve", { id: tb.id, keep });
      env.changed();
      notify(keep === "local" ? "Kept in Coopilot only" : "Timebox removed");
    } catch (e) {
      notify(errText(e));
    }
  };
  return (
    <div className="tb-conflict" role="group" aria-label="Removed in Outlook">
      <p>
        <strong>Removed in Outlook</strong> <span className="muted">Kept here with Put on Outlook off. It won't be put back on its own.</span>
      </p>
      <button type="button" className="mini" onClick={() => void choose("local")}>Keep</button>
      <button type="button" className="mini" onClick={() => void choose("remove")}>Remove</button>
    </div>
  );
}

/** Both sides changed since the last sync (step 13): both versions, and a choice. Nothing is overwritten until then. */
export function ConflictChoice({ tb, env, clientName }: { tb: TimeboxView; env: TimeboxEnv; clientName: string }) {
  const c = tb.conflict!;
  const theirs = c.outlook;
  const choose = async (keep: "coopilot" | "outlook") => {
    try {
      const r = await call<{ timebox: TimeboxView | null; uid?: string; sync: string | null }>("timebox.resolve", { id: tb.id, keep });
      env.changed();
      if (r.sync) await env.sync(tb.uid);
      else notify(keep === "outlook" ? "Took Outlook's version" : "Kept Coopilot's version");
    } catch (e) {
      notify(errText(e));
    }
  };
  return (
    <div className="tb-conflict" role="group" aria-label="Changed in Coopilot and in Outlook">
      <p>
        <strong>Changed in both places</strong> <span className="muted">({c.changed.join(", ")}). Nothing was overwritten.</span>
      </p>
      <dl>
        <dt>Coopilot</dt>
        <dd>
          {clientName}: {tb.title} · {range(tb, env.tz)} · {SHOW_AS_LABEL[tb.showAs]}
        </dd>
        <dt>Outlook</dt>
        <dd>{theirs ? `${theirs.subject} · ${range(theirs, env.tz)} · ${SHOW_AS_LABEL[theirs.showAs as OutlookShowAs] ?? theirs.showAs}` : "Deleted in Outlook"}</dd>
      </dl>
      <button type="button" className="mini" onClick={() => void choose("coopilot")}>
        Keep Coopilot's
      </button>
      <button type="button" className="mini" onClick={() => void choose("outlook")}>
        {theirs ? "Use Outlook's" : "Remove the timebox too"}
      </button>
    </div>
  );
}

/** "Help: Tue 1:00 PM with Ana": a help invite on an item (step 13). */
export function InviteChips({ match }: { match: (i: InviteView) => boolean }): ReactNode {
  const env = useTimeboxes();
  if (!env) return null;
  const list = env.invites.filter((i) => i.status === "sent" && match(i));
  if (!list.length) return null;
  return list.map((i) => {
    const s = Temporal.Instant.from(i.start).toZonedDateTimeISO(env.tz);
    const day = s.toPlainDate().toLocaleString("en-US", { weekday: "short" });
    return (
      <span key={i.uid} className="help-chip" title={`Help session ${range(i, env.tz)} with ${i.names.join(", ")}${i.teams ? " (Teams)" : ""}`}>
        Help {day} {clock(i.start, env.tz)} · {i.names.join(", ")}
      </span>
    );
  });
}

// ---------- the week cards ----------

/**
 * Timeboxes inside a card's timeline, in client color (Coopilot's own Outlook events show only here, once). Step 13:
 * drag to move, the bottom edge to resize (15 minute steps); right-click or Enter for its menu (by tier).
 */
/** Timed picks and timeboxes as bands; `bounds` is what the strip covers (the view range, or the block's working hours on the compact ruler, D276). */
export function TimeboxBands({ slot, pos, bounds = slot.view }: { slot: Slot; pos: (iso: string) => number; bounds?: { start: string; end: string } }): ReactNode {
  const env = useTimeboxes();
  if (!env || !env.settings.enabled) return null;
  const a = ms(bounds.start), b = ms(bounds.end);
  const here = env.timeboxes.filter((t) => t.date === slot.date && !t.removedAt && ms(t.end) > a && ms(t.start) < b);
  return here.map((t) => <Band key={`tb-${t.id}`} t={t} env={env} bounds={bounds} pos={pos} />);
}

function Band({ t, env, bounds, pos }: { t: TimeboxView; env: TimeboxEnv; bounds: { start: string; end: string }; pos: (iso: string) => number }) {
  // Step 14.5 (D259): a pick's timebox opens the same time editor as its row; others keep the timebox menu.
  const menu = useMenu((m) => {
    const p = t.pickId !== null ? m.planWeek?.[t.date]?.picks.find((x) => x.id === t.pickId) : undefined;
    return p ? timeStep(m, p) : timeboxMenu(m, t);
  });
  const [drag, setDrag] = useState<{ mode: DragMode; y0: number; h: number; d: number } | null>(null);
  const moved = useRef(false);
  const a = ms(bounds.start), b = ms(bounds.end);
  const spanMin = (b - a) / 60_000;
  const live = drag ? dragTimes(drag.mode, t.start, t.end, drag.d) ?? { start: t.start, end: t.end } : { start: t.start, end: t.end };
  const top = pos(new Date(Math.max(ms(live.start), a)).toISOString()), bottom = pos(new Date(Math.min(ms(live.end), b)).toISOString());
  const down = (ev: PointerEvent, mode: DragMode) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    moved.current = false;
    const parent = (ev.currentTarget as HTMLElement).closest(".timeline, .ruler") as HTMLElement | null;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({ mode, y0: ev.clientY, h: parent?.getBoundingClientRect().height ?? 1, d: 0 });
  };
  const move = (ev: PointerEvent) => {
    if (!drag) return;
    const d = ((ev.clientY - drag.y0) / drag.h) * spanMin;
    if (Math.abs(d) >= TIMEBOX_SNAP / 2) moved.current = true;
    setDrag({ ...drag, d });
  };
  const up = () => {
    if (!drag) return;
    const next = dragTimes(drag.mode, t.start, t.end, drag.d);
    setDrag(null);
    if (next) void timeboxChange(env, "timebox.update", { id: t.id, start: next.start, end: next.end });
  };
  const label = `${t.pickId !== null ? "" : "Timebox: "}${t.title}, ${range(t, env.tz)}${t.onOutlook ? ", on Outlook" : ""}${t.conflict ? ", changed in both places" : t.outlookNote ? `, ${t.outlookNote}` : ""}`;
  return (
    <div
      className={`tbox${drag ? " dragging" : ""}${t.conflict ? " conflict" : ""}${t.sync ? " out-of-step" : ""}${t.outlook ? " on-outlook" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      style={{ top: `${top * 100}%`, height: `${(bottom - top) * 100}%`, "--c": clientColor(t.clientKey, env.colors) } as CSSProperties}
      title={`${label}\nClick to change the time. Drag to move, either edge to resize.`}
      onPointerDown={(ev) => down(ev, "move")}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
      onClick={(ev) => {
        ev.stopPropagation();
        if (moved.current) moved.current = false;
        else menu.onContextMenu(ev);
      }}
      onDoubleClick={(ev) => ev.stopPropagation()}
      onContextMenu={menu.onContextMenu}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === "ContextMenu") {
          ev.preventDefault();
          ev.stopPropagation();
          const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
          menu.onContextMenu({ preventDefault() {}, stopPropagation() {}, currentTarget: ev.currentTarget, type: "contextmenu", clientX: r.left + 8, clientY: r.top + 8 } as never);
        }
      }}
    >
      <span className="tbox-edge top" onPointerDown={(ev) => down(ev, "start")} aria-hidden="true" />
      <span className="tbox-label">
        {t.conflict ? "⚠ " : ""}
        {t.title}
      </span>
      {(drag || t.outlook) && <span className="tbox-time">{drag ? range(live, env.tz) : "Outlook"}</span>}
      <span className="tbox-edge" onPointerDown={(ev) => down(ev, "end")} aria-hidden="true" />
    </div>
  );
}

/**
 * Compact cards (no timeline): timeboxes without a pick that start in this half-day (week list items, plain client
 * time). A pick's timebox shows on the pick's own row instead (step 14.5, D259).
 */
export function TimeboxList({ slot }: { slot: Slot }): ReactNode {
  const env = useTimeboxes();
  if (!env || !env.settings.enabled) return null;
  const a = ms(slot.view.start), b = ms(slot.view.end);
  const here = env.timeboxes.filter((t) => t.pickId === null && t.date === slot.date && !t.removedAt && ms(t.start) >= a && ms(t.start) < b);
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
