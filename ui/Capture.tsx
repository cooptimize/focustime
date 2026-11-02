// Quick capture (step 9): one text box, Enter saves at once to the local store (works offline). Rules (no AI)
// suggest a follow-up, a draft story or a draft feature (step 13.5); one click confirms, or change it first. Unsorted
// captures wait in the Inbox.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { CaptureFeatures, WeekLoadData } from "../actions/types.ts";
import { parseTag, suggest, tagCompletions, takeTag, type CaptureClient, type CaptureKind } from "../plan/capture.ts";
import { CLOSE_HOW, type Capture, type Size } from "../plan/types.ts";
import type { IsoDate } from "../week/types.ts";
import { call } from "./api.ts";
import { Fading, formClients, HOW_LABEL, WhoInput } from "./FollowUps.tsx";
import { clientColor } from "./labels.ts";

const KIND_NAME: Record<CaptureKind, string> = { follow_up: "Follow-up", draft: "Draft story", draft_feature: "Draft feature" };
const SAVE_AS: Record<CaptureKind, string> = { follow_up: "Save as follow-up", draft: "Save as draft story", draft_feature: "Save as draft feature" };
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
  const [channel, setChannel] = useState("");
  const [feature, setFeature] = useState<number | null>(null);
  const [features, setFeatures] = useState<CaptureFeatures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const whoId = useRef(`cap-who-${capture.id}`);
  // A draft's features (or a draft feature's epics) come from DevOps (read-only) for the chosen client; none to pick
  // when DevOps can't say.
  useEffect(() => {
    setFeature(null);
    setFeatures(null);
    if (kind === "follow_up" || !client) return;
    let live = true;
    call<CaptureFeatures>("capture.features", { clientKey: client }).then((f) => live && setFeatures(f), () => live && setFeatures({ clientKey: client, status: "unavailable", features: [], epics: [] }));
    return () => {
      live = false;
    };
  }, [kind, client]);

  const save = async (as: CaptureKind | "dismissed") => {
    setBusy(true);
    setError(null);
    try {
      const input =
        as === "follow_up" ? { who, what, ...(due ? { due } : {}), clientKey: client, ...(channel ? { channel } : {}) } :
        as === "draft" ? { clientKey: client, title, size, ...(feature ? { parentItemId: feature } : {}) } :
        as === "draft_feature" ? { clientKey: client, title, ...(feature ? { parentItemId: feature } : {}) } : {};
      await call("capture.route", { id: capture.id, as, ...input });
      const cname = clients.find((c) => c.clientKey === client)?.clientName ?? client;
      onDone(as === "dismissed" ? "Dismissed" : as === "follow_up" ? `Follow-up saved${who ? `: owed to ${who}` : ""}${due ? `, due ${plainDay(due)}` : ""}` : as === "draft" ? `Draft story saved for ${cname}` : `Draft feature saved for ${cname}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const blocked = kind !== "follow_up" && !client ? `Choose a client for the ${KIND_NAME[kind].toLowerCase()}` : kind === "follow_up" && !what.trim() ? "Say what you owe" : null;
  const cn = client ? `${clients.find((c) => c.clientKey === client)?.clientName ?? client}: ` : "Client to choose: ";
  const summary =
    kind === "follow_up" ? `${who ? `Owed to ${who}: ` : ""}${what}${due ? ` · due ${plainDay(due)}` : ""}` :
    kind === "draft" ? `${cn}${title} · ${size}` : `${cn}${title}`;
  const parents = kind === "draft" ? features?.features : features?.epics;
  const parentWord = kind === "draft" ? "feature" : "epic";

  return (
    <div className="cap-sort">
      <div className="cap-kinds" role="group" aria-label="Sort as">
        {(["follow_up", "draft", "draft_feature"] as const).map((k) => (
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
          {kind === "follow_up" && (
            <>
              <label>Client <ClientSelect label="Client" value={client} clients={formClients(clients)} onChange={setClient} /></label>
              <label>Who <WhoInput value={who} onChange={setWho} clientKey={client} id={whoId.current} /></label>
              <label className="wide">What <input value={what} onChange={(e) => setWhat(e.target.value)} maxLength={200} /></label>
              <label>
                Channel{" "}
                <select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="">Any</option>
                  {CLOSE_HOW.map((h) => <option key={h} value={h}>{HOW_LABEL[h]}</option>)}
                </select>
              </label>
              <label>Due <input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            </>
          )}
          {kind !== "follow_up" && (
            <>
              <label>Client <ClientSelect label="Client" value={client} clients={clients} onChange={setClient} required /></label>
              <label className="wide">Title <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
              {kind === "draft" && (
                <span className="cap-size" role="group" aria-label="Size">
                  {(["S", "M", "L"] as const).map((z) => (
                    <button key={z} type="button" className="mini" aria-pressed={size === z} onClick={() => setSize(z)}>{z}</button>
                  ))}
                </span>
              )}
              {client && (
                <label className="wide">
                  Under {parentWord}{" "}
                  <select aria-label={`Under ${parentWord}`} value={feature ?? ""} onChange={(e) => setFeature(e.target.value ? Number(e.target.value) : null)} disabled={!features || features.status !== "ok"}>
                    <option value="">{!features ? `Loading ${parentWord}s…` : features.status !== "ok" ? `No ${parentWord} (DevOps unavailable)` : `No ${parentWord}`}</option>
                    {features?.status === "ok" && parents?.map((f) => <option key={f.id} value={f.id}>#{f.id} {f.title}</option>)}
                  </select>
                </label>
              )}
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

const TIP_KEY = "coopilot.hint.capturetag";
const tipSeen = () => {
  try {
    return localStorage.getItem(TIP_KEY) === "1";
  } catch {
    return true;
  }
};

/**
 * The capture box: Enter saves at once. One client chip (step 15.2): pre-filled from the selected block, @nickname sets
 * it and leaves the text, a click chooses another client. The saved capture can be sorted right away.
 */
export function CaptureBox({ data, onChanged, autoFocus, defaultClient = null }: { data: WeekLoadData; onChanged: () => void; autoFocus?: boolean; defaultClient?: string | null }) {
  const clients = useMemo(() => captureClients(data), [data]);
  const known = (k: string | null) => (k && clients.some((c) => c.clientKey === k) ? k : null);
  const [text, setText] = useState("");
  const [client, setClient] = useState<string | null>(() => known(defaultClient));
  const [choosing, setChoosing] = useState(false);
  const [tip, setTip] = useState(() => !tipSeen());
  const [saved, setSaved] = useState<Capture | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const done = useMemo(() => tagCompletions(text, clients), [text, clients]);
  const clearNotice = useMemo(() => () => setNotice(null), []);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => setPick(0), [done.length]);

  const complete = (c: CaptureClient) => {
    setClient(c.clientKey);
    setText((t) => t.replace(/(^|\s)@[^\s@]*$/, "$1"));
    input.current?.focus();
  };
  const onText = (v: string) => {
    const t = takeTag(v, clients);
    if (t) {
      setClient(t.clientKey);
      setText(t.text);
    } else setText(v);
  };
  const dismissTip = () => {
    setTip(false);
    try {
      localStorage.setItem(TIP_KEY, "1");
    } catch {
      /* the tip shows again next time */
    }
  };
  const clientName = (k: string) => clients.find((c) => c.clientKey === k)?.clientName ?? k;
  const submit = async () => {
    const tagged = parseTag(text, clients);
    const body = tagged.text.trim();
    if (!body) return;
    try {
      const r = await call<{ capture: Capture }>("capture.add", { text: body, ...((tagged.clientKey ?? client) ? { clientKey: tagged.clientKey ?? client } : {}) });
      setSaved(r.capture);
      setText("");
      setClient(known(defaultClient));
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
          onChange={(e) => onText(e.target.value)}
          onKeyDown={onKey}
          maxLength={1000}
          placeholder="Capture anything…"
          aria-label="Quick capture"
          aria-autocomplete="list"
          aria-expanded={done.length > 0}
        />
        <button
          type="button"
          className={`chip-btn cap-client${client ? "" : " none"}`}
          style={{ "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties}
          aria-expanded={choosing}
          aria-label={client ? `Client: ${clientName(client)}. Change` : "Choose a client"}
          title={client ? "Change the client" : "Tag a client (or type @ and a nickname)"}
          onClick={() => setChoosing((x) => !x)}
        >
          {client ? <><span className="swatch" /> {clientName(client)}</> : "No client"}
        </button>
      </div>
      {choosing && (
        <div className="client-chooser cap-choose" role="group" aria-label="Client">
          {clients.map((c) => (
            <button key={c.clientKey} type="button" className="chip-btn" aria-pressed={client === c.clientKey} style={{ "--c": clientColor(c.clientKey, data.clients) } as CSSProperties} onClick={() => (setClient(c.clientKey), setChoosing(false), input.current?.focus())}>
              <span className="swatch" />
              {c.clientName}
            </button>
          ))}
          <button type="button" className="chip-btn" aria-pressed={!client} onClick={() => (setClient(null), setChoosing(false), input.current?.focus())}>
            No client
          </button>
        </div>
      )}
      {tip && !saved && (
        <p className="cap-tip">
          Tip: type @ and a client's nickname to tag it. <button type="button" className="link-btn" onClick={dismissTip}>Got it</button>
        </p>
      )}
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
      {!saved && notice !== "Saved to the inbox" && <Fading text={notice} onGone={clearNotice} />}
    </div>
  );
}

/** The capture box over any view (N, the top-bar button, the command menu, or the global key via coopilot-open). */
export function CaptureDialog({ data, onClose, onChanged, onOpenView, defaultClient = null }: { data: WeekLoadData; onClose: () => void; onChanged: () => void; onOpenView: () => void; defaultClient?: string | null }) {
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => () => back.current?.focus?.(), []);
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="cap-dialog"
        data-overlay="modal"
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
          <span className="muted">Saved at once, even offline. Sort it now, or later in the Inbox.</span>
          <button type="button" className="mini quiet" onClick={onOpenView} title="Captures to sort and follow-ups">
            Open Inbox{data.captures > 0 ? ` (${data.captures} to sort)` : ""}
          </button>
          <button type="button" className="mini quiet" onClick={onClose} aria-label="Close">Esc</button>
        </div>
        <CaptureBox data={data} onChanged={onChanged} autoFocus defaultClient={defaultClient} />
      </div>
    </div>
  );
}

export { when as captureWhen };
