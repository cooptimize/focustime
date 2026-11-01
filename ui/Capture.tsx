// Quick capture (step 9): one text box, Enter saves at once to the local store (works offline). Rules (no AI)
// suggest a loop, a draft story or a note; one click confirms, or change it first. Unsorted captures wait in the
// Capture view's inbox, next to the notes per client.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { CaptureFeatures, CaptureState, WeekLoadData } from "../actions/types.ts";
import { parseTag, suggest, tagCompletions, type CaptureClient, type CaptureKind } from "../plan/capture.ts";
import type { Capture, Note, Size } from "../plan/types.ts";
import type { IsoDate } from "../week/types.ts";
import { call } from "./api.ts";
import { clientColor } from "./labels.ts";

const KIND_NAME: Record<CaptureKind, string> = { loop: "Loop", draft: "Draft story", note: "Note" };
const SAVE_AS: Record<CaptureKind, string> = { loop: "Save as loop", draft: "Save as draft story", note: "Save as note" };
const plainDay = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const when = (z: string, tz: string) => {
  const t = Temporal.ZonedDateTime.from(z).withTimeZone(tz);
  return `${t.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${t.toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};

/** Followed clients to tag (Open half-day choices and DevOps clients), or the configured ones when those aren't known. */
export function captureClients(data: WeekLoadData): CaptureClient[] {
  const m = new Map<string, string>();
  for (const c of data.planClients) m.set(c.clientKey, c.clientName);
  for (const c of data.devops ?? []) if (!m.has(c.clientKey)) m.set(c.clientKey, c.clientName);
  if (!m.size) for (const k of Object.keys(data.clients)) m.set(k, k);
  return [...m].map(([clientKey, clientName]) => ({ clientKey, clientName })).sort((a, b) => a.clientName.localeCompare(b.clientName));
}

function ClientSelect({ value, clients, onChange, required, label }: { value: string | null; clients: CaptureClient[]; onChange: (k: string | null) => void; required?: boolean; label: string }) {
  return (
    <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{required ? "Choose a client…" : "No client"}</option>
      {clients.map((c) => (
        <option key={c.clientKey} value={c.clientKey}>
          {c.clientName}
        </option>
      ))}
    </select>
  );
}

/** The routing choice for one capture: the suggestion preselected, the other two one click away, fields editable. */
export function SortCapture({ capture, clients, today, onDone, startOpen = false }: { capture: Capture; clients: CaptureClient[]; today: IsoDate; onDone: (msg: string) => void; startOpen?: boolean }) {
  const s = useMemo(() => suggest(capture.text, capture.clientKey, today, clients), [capture.text, capture.clientKey, today, clients]);
  const [kind, setKind] = useState<CaptureKind>(s.kind);
  const [edit, setEdit] = useState(startOpen);
  const [client, setClient] = useState<string | null>(capture.clientKey);
  const [who, setWho] = useState(s.who);
  const [what, setWhat] = useState(s.what);
  const [due, setDue] = useState(s.due ?? "");
  const [title, setTitle] = useState(s.title);
  const [size, setSize] = useState<Size>("M");
  const [text, setText] = useState(s.text);
  const [feature, setFeature] = useState<number | null>(null);
  const [features, setFeatures] = useState<CaptureFeatures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A draft's features come from DevOps (read-only) for the chosen client; none to pick when DevOps can't say.
  useEffect(() => {
    setFeature(null);
    setFeatures(null);
    if (kind !== "draft" || !client) return;
    let live = true;
    call<CaptureFeatures>("capture.features", { clientKey: client }).then((f) => live && setFeatures(f), () => live && setFeatures({ clientKey: client, status: "unavailable", features: [] }));
    return () => {
      live = false;
    };
  }, [kind, client]);

  const save = async (as: CaptureKind | "dismissed") => {
    setBusy(true);
    setError(null);
    try {
      const input =
        as === "loop" ? { who, what, ...(due ? { due } : {}), clientKey: client } :
        as === "draft" ? { clientKey: client, title, size, ...(feature ? { parentItemId: feature } : {}) } :
        as === "note" ? { clientKey: client, text } : {};
      await call("capture.route", { id: capture.id, as, ...input });
      onDone(as === "dismissed" ? "Dismissed" : as === "loop" ? `Loop saved${who ? `: owed to ${who}` : ""}${due ? `, due ${plainDay(due)}` : ""}` : as === "draft" ? `Draft story saved for ${clients.find((c) => c.clientKey === client)?.clientName ?? client}` : "Note saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const blocked = kind === "draft" && !client ? "Choose a client for the draft story" : kind === "loop" && !what.trim() ? "Say what you owe" : null;
  const summary =
    kind === "loop" ? `${who ? `Owed to ${who}: ` : ""}${what}${due ? ` · due ${plainDay(due)}` : ""}` :
    kind === "draft" ? `${client ? `${clients.find((c) => c.clientKey === client)?.clientName ?? client}: ` : "Client to choose: "}${title} · ${size}` :
    `${client ? `${clients.find((c) => c.clientKey === client)?.clientName ?? client}: ` : ""}${text}`;

  return (
    <div className="cap-sort">
      <div className="cap-kinds" role="group" aria-label="Sort as">
        {(["loop", "draft", "note"] as const).map((k) => (
          <button key={k} type="button" className="chip-btn" aria-pressed={kind === k} onClick={() => setKind(k)} title={k === s.kind ? "Suggested by the rules" : undefined}>
            {KIND_NAME[k]}
            {k === s.kind && <span className="cap-suggested">suggested</span>}
          </button>
        ))}
        <button type="button" className="mini quiet" onClick={() => setEdit((x) => !x)} aria-expanded={edit}>
          {edit ? "Hide details" : "Change details"}
        </button>
      </div>
      {!edit && <p className="cap-summary">{summary}</p>}
      {edit && (
        <div className="cap-fields">
          {kind === "loop" && (
            <>
              <label>Who <input value={who} onChange={(e) => setWho(e.target.value)} maxLength={100} placeholder="Name (optional)" /></label>
              <label className="wide">What <input value={what} onChange={(e) => setWhat(e.target.value)} maxLength={200} /></label>
              <label>Due <input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
              <label>Client <ClientSelect label="Client" value={client} clients={clients} onChange={setClient} /></label>
            </>
          )}
          {kind === "draft" && (
            <>
              <label>Client <ClientSelect label="Client" value={client} clients={clients} onChange={setClient} required /></label>
              <label className="wide">Title <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
              <span className="cap-size" role="group" aria-label="Size">
                {(["S", "M", "L"] as const).map((z) => (
                  <button key={z} type="button" className="mini" aria-pressed={size === z} onClick={() => setSize(z)}>{z}</button>
                ))}
              </span>
              {client && (
                <label className="wide">
                  Under feature{" "}
                  <select aria-label="Under feature" value={feature ?? ""} onChange={(e) => setFeature(e.target.value ? Number(e.target.value) : null)} disabled={!features || features.status !== "ok"}>
                    <option value="">{!features ? "Loading features…" : features.status !== "ok" ? "No feature (DevOps unavailable)" : "No feature"}</option>
                    {features?.status === "ok" && features.features.map((f) => <option key={f.id} value={f.id}>#{f.id} {f.title}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
          {kind === "note" && (
            <>
              <label>Client <ClientSelect label="Client" value={client} clients={clients} onChange={setClient} /></label>
              <label className="wide">Text <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} /></label>
            </>
          )}
        </div>
      )}
      <div className="cap-acts">
        <button type="button" className="top-btn primary" disabled={busy || !!blocked} title={blocked ?? undefined} onClick={() => void save(kind)} data-cap-save>
          {SAVE_AS[kind]}
        </button>
        <button type="button" className="mini quiet" disabled={busy} onClick={() => void save("dismissed")}>Dismiss</button>
        {blocked && edit && <span className="muted">{blocked}</span>}
        {blocked && !edit && <button type="button" className="mini" onClick={() => setEdit(true)}>{blocked}</button>}
        {error && <span className="set-problem" role="alert">{error}</span>}
      </div>
    </div>
  );
}

/** The capture box: Enter saves at once; @ completes a followed client; the saved capture can be sorted right away. */
export function CaptureBox({ data, onChanged, autoFocus }: { data: WeekLoadData; onChanged: () => void; autoFocus?: boolean }) {
  const clients = useMemo(() => captureClients(data), [data]);
  const [text, setText] = useState("");
  const [client, setClient] = useState<string | null>(null);
  const [saved, setSaved] = useState<Capture | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const done = useMemo(() => tagCompletions(text, clients), [text, clients]);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => setPick(0), [done.length]);

  const complete = (c: CaptureClient) => {
    setText((t) => t.replace(/@([^\s@]*)$/, `@${c.clientKey.includes(" ") ? c.clientName.split(/\s+/)[0] : c.clientKey} `));
    input.current?.focus();
  };
  const submit = async () => {
    const tagged = parseTag(text, clients);
    const body = tagged.text.trim();
    if (!body) return;
    try {
      const r = await call<{ capture: Capture }>("capture.add", { text: body, ...((client ?? tagged.clientKey) ? { clientKey: client ?? tagged.clientKey } : {}) });
      setSaved(r.capture);
      setText("");
      setClient(null);
      setError(null);
      setNotice("Saved to the inbox");
      onChanged();
      // The suggestion's save button takes focus, so a second Enter confirms it.
      setTimeout(() => document.querySelector<HTMLButtonElement>(".cap-box [data-cap-save]")?.focus(), 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (done.length && (e.key === "Tab" || (e.key === "Enter" && /@[^\s@]*$/.test(text)))) {
      e.preventDefault();
      complete(done[pick]!);
    } else if (done.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setPick((p) => (p + (e.key === "ArrowDown" ? 1 : done.length - 1)) % done.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };
  return (
    <div className="cap-box">
      <div className="cap-input">
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          maxLength={1000}
          placeholder="Capture anything. @client to tag. Enter saves."
          aria-label="Quick capture"
          aria-autocomplete="list"
          aria-expanded={done.length > 0}
        />
        <ClientSelect label="Tag a client" value={client} clients={clients} onChange={setClient} />
      </div>
      {done.length > 0 && (
        <ul className="cap-complete" role="listbox" aria-label="Clients">
          {done.map((c, i) => (
            <li key={c.clientKey} role="option" aria-selected={i === pick}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => complete(c)} style={{ "--c": clientColor(c.clientKey, data.clients) } as CSSProperties}>
                <span className="swatch" /> {c.clientName} <span className="muted">@{c.clientKey}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="set-problem" role="alert">{error}</p>}
      {saved && (
        <div className="cap-saved">
          <p className="cap-text">
            <span className="cap-tag">{notice ?? "Saved"}</span> {saved.text}
            {saved.clientKey && <span className="muted"> · {clients.find((c) => c.clientKey === saved.clientKey)?.clientName ?? saved.clientKey}</span>}
          </p>
          <SortCapture key={saved.id} capture={saved} clients={clients} today={data.planDay.date} onDone={(m) => { setSaved(null); setNotice(m); onChanged(); input.current?.focus(); }} />
        </div>
      )}
      {!saved && notice && notice !== "Saved to the inbox" && <p className="co-notice" role="status">{notice}</p>}
    </div>
  );
}

/** The capture box over any view (N, the top-bar button, the command menu, or the global key via coopilot-open). */
export function CaptureDialog({ data, onClose, onChanged, onOpenView }: { data: WeekLoadData; onClose: () => void; onChanged: () => void; onOpenView: () => void }) {
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => () => back.current?.focus?.(), []);
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="cap-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Quick capture"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="cap-dialog-head">
          <h2>Quick capture</h2>
          <span className="muted">Saved at once, even offline. Sort it now, or later in Capture.</span>
          <button type="button" className="mini quiet" onClick={onOpenView} title="The inbox and notes per client">
            Open Capture{data.captures > 0 ? ` (${data.captures} to sort)` : ""}
          </button>
          <button type="button" className="mini quiet" onClick={onClose} aria-label="Close">Esc</button>
        </div>
        <CaptureBox data={data} onChanged={onChanged} autoFocus />
      </div>
    </div>
  );
}

/** Notes per client (step 9), searchable and deletable; in the Inbox (step 10), folded until opened. */
export function NotesSection({ data, version }: { data: WeekLoadData; version: number }) {
  const clients = useMemo(() => captureClients(data), [data]);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("*");
  const tz = data.hours.timeZone;
  const load = useCallback(async () => {
    try {
      setNotes((await call<CaptureState>("capture.load", { ...(query.trim() ? { query } : {}), ...(filter === "*" ? {} : { clientKey: filter === "-" ? "" : filter }) })).notes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notes");
    }
  }, [query, filter]);
  useEffect(() => {
    const id = setTimeout(() => void load(), 150);
    return () => clearTimeout(id);
  }, [load, version]);
  const name = (k: string | null) => (k ? (clients.find((c) => c.clientKey === k)?.clientName ?? k) : null);
  const del = async (n: Note) => {
    try {
      await call("note.delete", { id: n.id });
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    }
  };
  return (
    <>
      <div className="cap-filter">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
        <select aria-label="Notes for" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="*">All clients</option>
          <option value="-">No client</option>
          {clients.map((c) => <option key={c.clientKey} value={c.clientKey}>{c.clientName}</option>)}
        </select>
      </div>
      {error && <p className="set-problem" role="alert">{error}</p>}
      {notes && !notes.length && <p className="muted">{query || filter !== "*" ? "No notes match." : "No notes yet."}</p>}
      <ul className="cap-notes">
        {notes?.map((n) => (
          <li key={n.id} style={{ "--c": clientColor(n.clientKey ?? undefined, data.clients) } as CSSProperties}>
            <span className="cap-note-client">{name(n.clientKey) ?? "No client"}</span>
            <span className="cap-note-text">{n.text}</span>
            <span className="muted">{when(n.createdAt, tz)}</span>
            <button type="button" className="mini quiet" onClick={() => void del(n)} aria-label={`Delete note: ${n.text}`}>Delete</button>
          </li>
        ))}
      </ul>
    </>
  );
}

export { when as captureWhen };
