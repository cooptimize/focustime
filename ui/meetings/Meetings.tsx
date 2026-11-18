// MC-1: Calls (MC-2; Client calls before), over the page (#/meetings, #/meetings/<occurrence>). The list: the
// registered client calls I review or attend and their recent occurrences; MC-2: then Your other calls (the calls on my
// own calendar in my last 14 days that aren't registered, read when this opens and kept only in this page's memory),
// the calls I added, and Add a call. Review on one of them opens its setup (the client it is about, suggested and my
// choice; where its transcript comes from) and then the same page as a client call. The review: "Update <client>'s plan · <meeting> <date>", one row per
// proposal with the words it came from. MC-1e: made like the rest of the app. Nothing is ticked to start; each row has
// its own main button (Create in DevOps, Add comment, Add to Promises or Note with this call) and Skip. A new item is
// edited with the New form's fields; DevOps changes go only through the one DevOps preview (ui/DevOpsWrite.tsx), for
// one row or for the ticked ones (10 at a time); a promise is saved at once with Undo. A filter, one count, folded
// skipped and done rows, headers that stay in view, and a way from a transcript line back to its proposals. An
// attendee who isn't a reviewer can look, not act.
import { TextBox } from "../TextBox.tsx";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { ActionRefusal, call, uploadMeetingTranscript } from "../api.ts";
import { useReturnFocus } from "../CloseButton.tsx";
import { useDevOpsWrite, type DevOpsChange } from "../DevOpsWrite.tsx";
import type { OccurrenceView, OtherCallView, SeriesView } from "../../plan/meeting-views.ts";
import type { CaptureClient } from "../../plan/capture.ts";
import { lengthLabel, suggestClient } from "../../plan/calls.ts";
import { callBatch, proposalWords, toReview, type Proposal, type Quote } from "../../plan/meetings.ts";
import { callFrom, callLabel, rememberCallFrom, requestFetch, takeFetch, takeRerun, takeReviewCall, type MineData } from "./calls.ts";
import { CALL_ACTIONS, CALL_BAR, CALL_FILTERS, CALL_ROW, CALL_STATE, CALLS_TEXT, POCKET_TEXT, rerunLine, SECTION_HEAD, TRANSCRIPT_TEXT, type CallFilter, type ProposalCheck } from "../../plan/call-words.ts";
import { clientColor } from "../labels.ts";
import { Icon } from "../icons.tsx";
import { forgetCallOptions, GapFields, useNewOptions } from "./GapFields.tsx";

type Review = { meeting: SeriesView; occurrence: OccurrenceView; proposals: Proposal[]; transcript: { lines: number; speakers: number } | null; /** MC-2: what was said (at most 5 lines); null before MC-2 or once the transcript is gone. */ summary?: string[] | null; /** PK-1: from a Pocket export: numbered speakers, no times. */ pocket?: boolean; canConfirm: boolean; canWrite: boolean; checks: Record<string, ProposalCheck> };

const errText = (e: unknown) => (e instanceof ActionRefusal || e instanceof Error ? e.message : "Something went wrong");
const dayLabel = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const NOTE: Record<"decision" | "next_step" | "status", string> = { decision: "Decision", next_step: "Next step", status: "Status" };
const KINDS = ["gap", "commitment", "comment"] as const;

type CallView = "transcript" | "upload";
export type CallPlace = { view?: CallView; line?: number; filter?: Exclude<CallFilter, "all">; proposal?: number };
export function Meetings({ occurrence, view = null, line = null, filter = null, proposal = null, onOpen, onClose, onChanged, colors, today, undoable, clients = [], blockClientAt = () => null }: { occurrence: number | null; view?: CallView | null; line?: number | null; filter?: Exclude<CallFilter, "all"> | null; proposal?: number | null; onOpen: (id: number | null, at?: CallPlace) => void; onClose: () => void; onChanged?: () => void; colors: Record<string, string>; today: string; undoable?: (text: string, undo: () => Promise<unknown>) => void; /** MC-2: the clients a call can be about (mine, with Internal). */ clients?: CaptureClient[]; /** MC-2: the focus block's client a moment falls in, for the suggestion. */ blockClientAt?: (iso: string) => string | null }) {
  useReturnFocus();
  // MC-1e: Back returns to where the call was opened from (Day, Week or Calls); after a reload, Calls.
  const back = useCallback(() => {
    const from = occurrence ? callFrom(occurrence) : null;
    if (from && from !== location.hash) location.hash = from;
    else onOpen(null);
  }, [occurrence, onOpen]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement | null)?.closest("input, textarea, select, dialog, [data-overlay]") && !document.querySelector("[data-overlay=modal]") && (e.preventDefault(), occurrence ? back() : onClose());
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [occurrence, back, onClose]);
  return (
    <main className="mtg-view" aria-label={CALLS_TEXT.heading} tabIndex={-1}>
      {occurrence ? <ReviewScreen id={occurrence} view={view} line={line} filter={filter} focus={proposal} colors={colors} today={today} undoable={undoable} onBack={back} onPlace={(at) => onOpen(occurrence, at)} onChanged={onChanged} /> : <CallsList colors={colors} clients={clients} blockClientAt={blockClientAt} today={today} onOpen={(id, at) => (rememberCallFrom(id, "#/meetings"), onOpen(id, at))} onClose={onClose} onChanged={onChanged} />}
    </main>
  );
}

function CallsList({ colors, clients, blockClientAt, today, onOpen, onClose, onChanged }: { colors: Record<string, string>; clients: CaptureClient[]; blockClientAt: (iso: string) => string | null; today: string; onOpen: (id: number, at?: CallPlace) => void; onClose: () => void; onChanged?: (() => void) | undefined }) {
  const [data, setData] = useState<MineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => call<MineData>("meeting.mine", {}).then(setData, (e: unknown) => setError(errText(e))), []);
  useEffect(() => void load(), [load]);
  // MC-2: my other calls, read from my own calendar now; held in this component's memory only.
  const [others, setOthers] = useState<{ calls: OtherCallView[]; days: number } | null>(null);
  const [othersErr, setOthersErr] = useState<string | null>(null);
  const [setup, setSetup] = useState<OtherCallView | null>(null);
  const [adding, setAdding] = useState(false);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    call<{ calls: OtherCallView[]; days: number }>("meeting.calls", {}).then((d) => {
      if (!live) return;
      setOthers(d);
      // Review this call from a meeting's menu: its setup opens here (matched by its start and end).
      const want = takeReviewCall();
      if (want) {
        const hit = d.calls.find((c) => Date.parse(c.startAt) === Date.parse(want.start) && Date.parse(c.endAt) === Date.parse(want.end));
        if (hit?.occurrenceId) onOpen(hit.occurrenceId);
        else if (hit) setSetup(hit);
        else setMissing(true);
      }
    }, (e: unknown) => live && setOthersErr(errText(e)));
    return () => {
      live = false;
    };
  }, [onOpen]);
  const registered = data?.meetings.filter((m) => !m.call) ?? [];
  const occOf = (id: number | null) => (id && data ? data.occurrences.find((o) => o.id === id) ?? null : null);
  const seriesOf = (o: OccurrenceView | null) => (o && data ? data.meetings.find((m) => m.id === o.seriesId) ?? null : null);
  // The calls I added by hand, and calls kept by someone on them that my calendar list doesn't show (a hand-added one is mine only).
  const listed = new Set((others?.calls ?? []).map((c) => c.occurrenceId).filter((x): x is number => !!x));
  const kept = (data?.meetings.filter((m) => m.call) ?? []).flatMap((m) => data!.occurrences.filter((o) => o.seriesId === m.id && !listed.has(o.id)).map((o) => ({ m, o })));
  return (
    <>
      <header className="page-head">
        <div className="ph-title">
          <h2>{CALLS_TEXT.heading}</h2>
          <span className="muted">{CALLS_TEXT.sub}</span>
        </div>
        <span className="mtg-head-actions">
          <button type="button" className="mini" onClick={() => setAdding(true)} aria-expanded={adding}>{CALLS_TEXT.add}</button>
          <button type="button" className="mini" onClick={onClose}>Close</button>
        </span>
      </header>
      {adding && <AddCall clients={clients} today={today} onCancel={() => setAdding(false)} onAdded={(id) => (setAdding(false), onChanged?.(), onOpen(id, { view: "upload" }))} />}
      {setup && <CallSetup call={setup} clients={clients} suggested={suggestClient(setup.name, clients, blockClientAt(setup.startAt))} onCancel={() => setSetup(null)} onStarted={(id, teams) => { setSetup(null); onChanged?.(); if (teams) requestFetch(id); onOpen(id, teams ? undefined : { view: "upload" }); }} />}
      <section className="mtg-calls" aria-labelledby="mtg-client-calls">
        <header className="mtg-calls-head">
          <h3 id="mtg-client-calls">{CALLS_TEXT.clientCalls}</h3>
          <span className="muted">{CALLS_TEXT.clientCallsSub}</span>
        </header>
        {error && <p className="error-line" role="alert">{error}</p>}
        {!data && !error && <p className="muted">Loading…</p>}
        {data && registered.length === 0 && <p className="muted">{CALLS_TEXT.noClientCalls}</p>}
        {registered.map((m) => (
          <section key={m.id} className="mtg-series" style={{ "--c": clientColor(m.clientKey, colors) } as CSSProperties} aria-label={m.name}>
            <header className="mtg-series-head">
              <h4><span className="swatch" aria-hidden="true" /> {m.name}</h4>
              <span className="muted">{m.clientName} · {m.roleLabel} · {m.when} · {m.source === "automatic" ? "Transcript read after the call" : "Transcript uploaded by a reviewer"}</span>
            </header>
            <ul className="mtg-occs">
              {data!.occurrences.filter((o) => o.seriesId === m.id).map((o) => {
                const l = callLabel(o, m.mine.review);
                return (
                  <li key={o.id} className={l.needsMe ? "needs" : undefined}>
                    <span className="mtg-date">{dayLabel(o.date)}</span>
                    <span className="mtg-state">{l.label}</span>
                    <button type="button" className={`mini${l.needsMe ? " primary" : ""}`} onClick={() => onOpen(o.id)}>
                      {o.state === "needs_upload" && m.mine.review ? "Upload" : o.state === "ready" && m.mine.review && o.open ? "Review" : "Open"}
                    </button>
                  </li>
                );
              })}
              {!data!.occurrences.some((o) => o.seriesId === m.id) && <li className="muted">Nothing in the last five weeks.</li>}
            </ul>
          </section>
        ))}
      </section>
      <section className="mtg-calls" aria-labelledby="mtg-other-calls">
        <header className="mtg-calls-head">
          <h3 id="mtg-other-calls">{CALLS_TEXT.others}</h3>
          <span className="muted">{CALLS_TEXT.othersSub(others?.days ?? 14)}</span>
        </header>
        {missing && <p className="muted" role="status">{CALLS_TEXT.notFound}</p>}
        {othersErr && <p className="error-line" role="alert">{othersErr}</p>}
        {!others && !othersErr && <p className="muted">Loading…</p>}
        {others && others.calls.length === 0 && kept.length === 0 && <p className="muted">{CALLS_TEXT.noOthers(others.days)}</p>}
        <ul className="mtg-others">
          {kept.map(({ m, o }) => <OtherRow key={`k${o.id}`} name={m.name} when={whenLine(o.startAt, o.endAt)} detail={m.call === "hand" ? CALLS_TEXT.byHand : m.clientName} color={clientColor(m.clientKey, colors)} state={callLabel(o, m.mine.review)} onPress={() => onOpen(o.id)} pressLabel={CALLS_TEXT.open} />)}
          {(others?.calls ?? []).map((c) => {
            const o = occOf(c.occurrenceId);
            const sv = seriesOf(o);
            const st = o && sv ? callLabel(o, sv.mine.review) : null;
            return <OtherRow key={c.key} name={c.name} when={whenLine(c.startAt, c.endAt)} detail={CALLS_TEXT.people(c.people)} color={sv ? clientColor(sv.clientKey, colors) : null} state={st ?? { label: CALLS_TEXT.notReviewed, needsMe: false }} onPress={() => (o ? onOpen(o.id) : setSetup(c))} pressLabel={o ? CALLS_TEXT.open : CALLS_TEXT.review} />;
          })}
        </ul>
      </section>
    </>
  );
}

/** "Tue, Nov 10 · 2:00 PM · 45 min": a call's day, start and length in my zone. */
const whenLine = (startAt: string, endAt: string) => {
  const d = new Date(startAt);
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${lengthLabel(Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000))}`;
};

function OtherRow({ name, when, detail, color, state, onPress, pressLabel }: { name: string; when: string; detail: string; color: string | null; state: { label: string; needsMe: boolean }; onPress: () => void; pressLabel: string }) {
  return (
    <li className={`mtg-other${state.needsMe ? " needs" : ""}`} style={color ? ({ "--c": color } as CSSProperties) : undefined}>
      <span className="mtg-other-name">{color && <span className="swatch" aria-hidden="true" />}{name}</span>
      <span className="muted mtg-other-when">{when} · {detail}</span>
      <span className="mtg-state">{state.label}</span>
      <button type="button" className={`mini${state.needsMe || pressLabel === CALLS_TEXT.review ? " primary" : ""}`} onClick={onPress} aria-label={`${pressLabel}: ${name}`}>{pressLabel}</button>
    </li>
  );
}

/** The client choices: my clients (Internal among them), the suggestion first and marked; a call is about one client. */
function ClientPick({ clients, value, suggested, onChange, id }: { clients: CaptureClient[]; value: string; suggested: string | null; onChange: (k: string) => void; id: string }) {
  const sorted = [...clients].sort((a, b) => Number(b.clientKey === suggested) - Number(a.clientKey === suggested) || a.clientName.localeCompare(b.clientName));
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="" disabled>{CALLS_TEXT.pickClient}</option>
      {sorted.map((c) => <option key={c.clientKey} value={c.clientKey}>{c.clientName}{c.clientKey === suggested ? ` (${CALLS_TEXT.suggested})` : ""}</option>)}
    </select>
  );
}

/**
 * MC-2: the setup a call that isn't registered opens with: which client it is about (FocusTime suggests, I choose; one
 * client) and where its transcript comes from. Nothing is kept and nothing goes to AI until Continue.
 */
function CallSetup({ call: c, clients, suggested, onCancel, onStarted }: { call: OtherCallView; clients: CaptureClient[]; suggested: string | null; onCancel: () => void; onStarted: (occurrenceId: number, teams: boolean) => void }) {
  const [client, setClient] = useState(suggested ?? "");
  const [source, setSource] = useState<"teams" | "upload">(c.teams ? "teams" : "upload");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("h3")?.focus();
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  const start = async () => {
    if (!client) return setErr(CALLS_TEXT.pickClient);
    setBusy(true);
    setErr(null);
    try {
      const r = await call<{ occurrenceId: number; existed: boolean }>("meeting.call_start", { key: c.key, startAt: c.startAt, endAt: c.endAt, clientKey: client });
      onStarted(r.occurrenceId, source === "teams" && !r.existed);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return (
    <div className="mtg-setup" role="dialog" aria-modal="false" aria-labelledby="mtg-setup-title" ref={ref} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <h3 id="mtg-setup-title" tabIndex={-1}>{CALLS_TEXT.setupTitle(c.name)}</h3>
      <p className="muted">{whenLine(c.startAt, c.endAt)} · {CALLS_TEXT.people(c.people)}</p>
      <label className="mtg-setup-field" htmlFor="mtg-setup-client">{CALLS_TEXT.setupClient}</label>
      <ClientPick id="mtg-setup-client" clients={clients} value={client} suggested={suggested} onChange={setClient} />
      <p className="muted mtg-setup-hint">{CALLS_TEXT.setupClientHint}</p>
      <fieldset className="mtg-setup-source">
        <legend>{CALLS_TEXT.setupSource}</legend>
        <label className={c.teams ? undefined : "disabled"}>
          <input type="radio" name="mtg-source" value="teams" checked={source === "teams"} disabled={!c.teams} onChange={() => setSource("teams")} />
          <span><strong>{CALLS_TEXT.sourceTeams}</strong><span className="muted">{c.teams ? CALLS_TEXT.sourceTeamsHint : c.outside ? CALLS_TEXT.outsideHint : CALLS_TEXT.notTeamsHint}</span></span>
        </label>
        <label>
          <input type="radio" name="mtg-source" value="upload" checked={source === "upload"} onChange={() => setSource("upload")} />
          <span><strong>{CALLS_TEXT.sourceUpload}</strong><span className="muted">{CALLS_TEXT.sourceUploadHint}</span></span>
        </label>
      </fieldset>
      {err && <p className="error-line" role="alert">{err}</p>}
      <span className="mtg-setup-actions">
        <button type="button" className="mini primary" disabled={busy || !client} onClick={() => void start()}>{busy ? "Starting…" : CALLS_TEXT.start}</button>
        <button type="button" className="mini quiet" disabled={busy} onClick={onCancel}>{CALLS_TEXT.cancel}</button>
      </span>
    </div>
  );
}

/** MC-2: Add a call that isn't on my calendar: only I see it, and its transcript is uploaded. */
function AddCall({ clients, today, onCancel, onAdded }: { clients: CaptureClient[]; today: string; onCancel: () => void; onAdded: (occurrenceId: number) => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("10:00");
  const [minutes, setMinutes] = useState(30);
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const first = useRef<HTMLInputElement | null>(null);
  useEffect(() => first.current?.focus(), []);
  const min = Temporal.PlainDate.from(today).subtract({ days: 13 }).toString();
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await call<{ occurrenceId: number }>("meeting.call_add", { name: name.trim(), date, start, minutes, clientKey: client });
      onAdded(r.occurrenceId);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return (
    <form className="mtg-setup mtg-add" aria-labelledby="mtg-add-title" onSubmit={(e) => (e.preventDefault(), void save())} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}>
      <h3 id="mtg-add-title">{CALLS_TEXT.add}</h3>
      <p className="muted">{CALLS_TEXT.addSub}</p>
      <div className="mtg-add-grid">
        <label>{CALLS_TEXT.addName}<input ref={first} value={name} maxLength={200} required onChange={(e) => setName(e.target.value)} /></label>
        <label>{CALLS_TEXT.addDay}<input type="date" value={date} min={min} max={today} required onChange={(e) => setDate(e.target.value)} /></label>
        <label>{CALLS_TEXT.addStart}<input type="time" value={start} required onChange={(e) => setStart(e.target.value)} /></label>
        <label>{CALLS_TEXT.addLength}
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{lengthLabel(m)}</option>)}
          </select>
        </label>
        <label>{CALLS_TEXT.addClient}<ClientPick id="mtg-add-client" clients={clients} value={client} suggested={null} onChange={setClient} /></label>
      </div>
      {err && <p className="error-line" role="alert">{err}</p>}
      <span className="mtg-setup-actions">
        <button type="submit" className="mini primary" disabled={busy || !name.trim() || !client}>{busy ? "Adding…" : CALLS_TEXT.addSave}</button>
        <button type="button" className="mini quiet" disabled={busy} onClick={onCancel}>{CALLS_TEXT.cancel}</button>
      </span>
    </form>
  );
}

function ReviewScreen({ id, view, line, filter, focus, colors, today, undoable, onBack, onPlace, onChanged }: { id: number; view: CallView | null; line: number | null; filter: Exclude<CallFilter, "all"> | null; focus: number | null; colors: Record<string, string>; today: string; undoable?: ((text: string, undo: () => Promise<unknown>) => void) | undefined; onBack: () => void; onPlace: (at?: CallPlace) => void; onChanged?: (() => void) | undefined }) {
  const w = useDevOpsWrite();
  const backTo = backWord(callFrom(id));
  const [r, setR] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  // MC-1e: nothing is ticked to start.
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** A refusal from the preview, said on its own row (the row keeps everything typed). */
  const [rowErr, setRowErr] = useState<Record<number, string>>({});
  /** Folded groups opened: `${kind}:skipped` or `${kind}:done`. */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const load = useCallback(async () => {
    try {
      const d = await call<Review>("meeting.review", { occurrenceId: id });
      setR(d);
      // Ticks stay only on rows still to review.
      setTicked((t) => new Set([...t].filter((x) => d.proposals.some((p) => p.id === x && toReview(p)))));
      setError(null);
      // MC-1d: the marks on Day and Week follow what changed here (a rerun, an upload, a write).
      onChanged?.();
    } catch (e) {
      setError(errText(e));
    }
  }, [id, onChanged]);
  useEffect(() => void load(), [load]);
  const opts = useNewOptions(r?.meeting.clientKey ?? "", !!r?.canConfirm && r.proposals.some((p) => p.body.kind === "gap" && toReview(p)));
  // MC-1d: opening a call puts focus on its heading (a screen reader starts there), not on the page's body.
  const headed = useRef(false);
  useEffect(() => {
    if (!r || headed.current) return;
    headed.current = true;
    if ((view !== "transcript" || !line) && !focus) document.querySelector<HTMLElement>(".mtg-view h2")?.focus();
  }, [r, view, line, focus]);
  // MC-1e: a proposal asked for by the address (a transcript line's button): in view and focused, its fold opened.
  useEffect(() => {
    if (!r || !focus || view) return;
    const p = r.proposals.find((x) => x.id === focus);
    if (!p) return;
    if (!toReview(p)) setUnfolded((u) => new Set(u).add(`${p.body.kind}:${p.state === "skipped" ? "skipped" : "done"}`));
    requestAnimationFrame(() => {
      const el = document.getElementById(`mtg-prop-${p.id}`);
      el?.scrollIntoView({ block: "start" });
      el?.classList.add("jumped");
      setTimeout(() => el?.classList.remove("jumped"), 2500);
      el?.focus({ preventScroll: true });
    });
  }, [r, focus, view]);
  // MC-1e: the sticky header's height, so each section's header sticks right under it.
  const stickyRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = stickyRef.current;
    const host = el?.closest<HTMLElement>(".mtg-view");
    if (!el || !host) return;
    // On the phone the document scrolls (under its sticky top bar), so the headers stick under that bar instead.
    const set = () => {
      host.style.setProperty("--mtg-head-h", `${el.getBoundingClientRect().height}px`);
      const bar = host.closest(".app.phone")?.querySelector<HTMLElement>(":scope > .topbar");
      host.style.setProperty("--mtg-top", bar ? `${bar.getBoundingClientRect().height}px` : "-8px");
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  });
  // PK-1: a file dragged over the call's page shows where it goes; dropped elsewhere it does nothing.
  const dragging = usePageDrag(!!r?.canConfirm);

  if (error) return (<><BackHead onBack={onBack} to={backTo} title="Call" /><p className="error-line" role="alert">{error}</p></>);
  if (!r) return (<><BackHead onBack={onBack} to={backTo} title="Call" /><p className="muted">Loading…</p></>);
  const m = r.meeting;
  const o = r.occurrence;
  const color = clientColor(m.clientKey, colors);
  const editable = r.canConfirm;
  const showUpload = editable && (o.state === "needs_upload" || o.state === "waiting" || o.state === "no_transcript");
  const can = !!w?.can(m.clientKey);
  const open = r.proposals.filter(toReview);
  const counts = { all: open.length, gap: 0, commitment: 0, comment: 0 } as Record<CallFilter, number>;
  for (const p of open) counts[p.body.kind]++;
  const done = r.proposals.filter((p) => p.state === "confirmed").length;
  const skipped = r.proposals.filter((p) => p.state === "skipped").length;
  const shownKinds = filter ? [filter] : KINDS;
  const checkOf = (p: Proposal) => r.checks[String(p.id)];
  /** Can this row go to DevOps now: nothing needed, nothing the form can't fill, not above story level. */
  const ready = (p: Proposal) => !checkOf(p)?.needs?.length && !checkOf(p)?.cant && !checkOf(p)?.blocked;

  const edit = async (p: Proposal, patch: Record<string, unknown>) => {
    try {
      await call<{ proposal: Proposal }>("meeting.edit", { proposalId: p.id, ...patch });
      setRowErr((e) => (e[p.id] ? Object.fromEntries(Object.entries(e).filter(([k]) => Number(k) !== p.id)) : e));
      await load();
    } catch (e) {
      setNote(errText(e));
    }
  };
  /** DevOps changes, only through the one preview: one row, or the ticked ones (the first 10 in page order). */
  const send = async (ps: Proposal[]) => {
    if (!w || !ps.length) return;
    const go = callBatch(ps, () => true).now;
    const changes: DevOpsChange[] = go.map((p) => ({ kind: p.body.kind === "gap" ? "meeting_create" : "meeting_comment", proposalId: p.id, key: `p${p.id}` }));
    setBusy(true);
    setNote(null);
    setRowErr((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !go.some((p) => p.id === Number(k)))));
    await w.begin(m.clientKey, changes, (res) => {
      setBusy(false);
      if (res.refused?.length) setRowErr((e) => ({ ...e, ...Object.fromEntries(res.refused!.map((x) => [Number(x.key.slice(1)), x.error])) }));
      if (res.error) (go.length === 1 ? setRowErr((e) => ({ ...e, [go[0]!.id]: res.error! })) : setNote(res.error));
      if (res.confirmed) forgetCallOptions();
      void load();
    }, { inline: true });
  };
  const keep = async (ps: Proposal[]) => {
    setBusy(true);
    setNote(null);
    const kept: number[] = [];
    let last = "";
    for (const p of ps) {
      try {
        last = (await call<{ message: string }>("meeting.keep", { proposalId: p.id })).message;
        kept.push(p.id);
      } catch (e) {
        setRowErr((x) => ({ ...x, [p.id]: errText(e) }));
      }
    }
    setBusy(false);
    await load();
    if (kept.length) undoable?.(kept.length === 1 ? last : `${kept.length} promises kept`, async () => {
      for (const k of kept) await call("meeting.unkeep", { proposalId: k });
      await load();
    });
  };
  const skip = async (ps: Proposal[], on = true) => {
    setBusy(true);
    const done: number[] = [];
    for (const p of ps) await call("meeting.edit", { proposalId: p.id, skip: on }).then(() => done.push(p.id), (e: unknown) => setNote(errText(e)));
    setBusy(false);
    await load();
    // Several skipped at once can be taken back together.
    if (on && done.length > 1) undoable?.(CALL_ROW.skipped(done.length), async () => {
      for (const k of done) await call("meeting.edit", { proposalId: k, skip: false });
      await load();
    });
  };
  const tick = (p: Proposal, on: boolean) => setTicked((s) => { const n = new Set(s); if (on) n.add(p.id); else n.delete(p.id); return n; });
  const tickedRows = r.proposals.filter((p) => ticked.has(p.id) && toReview(p));
  const tickedDevops = tickedRows.filter((p) => p.body.kind !== "commitment");
  const batch = callBatch(tickedDevops, ready);
  const sendable = [...batch.now, ...batch.later];
  const tickedPromises = tickedRows.filter((p) => p.body.kind === "commitment");

  return (
    <>
      <div className="mtg-sticky" ref={stickyRef}>
        <BackHead onBack={onBack} to={backTo} title={`Update ${m.clientName}'s plan`} sub={`${m.name} · ${dayLabel(o.date)}`} />
        {r.transcript || r.proposals.length ? (
          <div className="mtg-filter-row">
            {view !== "transcript" && r.proposals.length > 0 && (
              <div className="seg mtg-filter" role="group" aria-label="Show">
                {CALL_FILTERS.map((f) => (
                  <button key={f.key} type="button" className={`seg-btn${(filter ?? "all") === f.key ? " on" : ""}`} aria-pressed={(filter ?? "all") === f.key} onClick={() => onPlace(f.key === "all" ? undefined : { filter: f.key })}>
                    {f.label} <span className="seg-count">{counts[f.key]}</span>
                  </button>
                ))}
              </div>
            )}
            {r.transcript && (
              <div className="seg mtg-switch" role="group" aria-label="This call">
                <button type="button" className={`seg-btn${view !== "transcript" ? " on" : ""}`} aria-pressed={view !== "transcript"} onClick={() => onPlace(filter ? { filter } : undefined)}>
                  {TRANSCRIPT_TEXT.tabProposals} <span className="seg-count">{open.length}</span>
                </button>
                <button type="button" className={`seg-btn${view === "transcript" ? " on" : ""}`} aria-pressed={view === "transcript"} onClick={() => onPlace({ view: "transcript" })}>
                  {TRANSCRIPT_TEXT.tab}
                </button>
              </div>
            )}
            {r.proposals.length > 0 && (
              <span className="muted mtg-count" role="status">
                {CALL_ROW.toReview(open.length)}{done ? ` · ${CALL_ROW.done(done)}` : ""}{skipped ? ` · ${CALL_ROW.skipped(skipped)}` : ""}
              </span>
            )}
          </div>
        ) : null}
      </div>
      {r.pocket && <p className="mtg-pocket-note" role="note">{POCKET_TEXT.note}</p>}
      {view !== "transcript" && r.summary && r.summary.length > 0 && (
        // MC-2: what was discussed and decided, above the proposals, on every call.
        <section className="mtg-summary" aria-labelledby="mtg-summary-head">
          <h3 id="mtg-summary-head">{CALLS_TEXT.summary}</h3>
          <ul>{r.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </section>
      )}
      {view !== "transcript" && <p className="muted mtg-intro">
        {r.transcript ? (r.pocket ? `From the transcript (${r.transcript.lines} lines). ` : `From the transcript (${r.transcript.lines} lines, ${r.transcript.speakers} people). `) : ""}
        {editable ? "Each row has its own button: new items and comments go to DevOps through the usual preview, promises are kept at once. Tick rows to do several together, or skip what isn't right." : m.call ? `Only ${m.reviewers.map((x) => x.name).join(", ")}, who asked FocusTime to review this call, can act on it. You can look.` : `Only this call's reviewers (${m.reviewers.map((x) => x.name).join(", ")}) can act on it. You can look.`}
        {editable && m.call ? ` ${m.call === "hand" ? CALLS_TEXT.whoSeesHand : CALLS_TEXT.whoSees}` : ""}
      </p>}
      {editable && <CallActions series={m} occ={o} onDone={load} focusUpload={view === "upload"} dropHere={!showUpload} dragging={dragging} />}
      {o.state === "failed" && (
        <section className="mtg-failed" role="status" aria-label={CALL_STATE.aiFailed}>
          <h3>{CALL_STATE.aiFailed}</h3>
          {o.aiMessage && <p>{o.aiMessage.replace(`${CALL_STATE.aiFailed}: `, "").replace(/^./, (c) => c.toUpperCase())}</p>}
          {o.aiNext && <p className="muted">{o.aiNext}</p>}
        </section>
      )}
      {note && <p className="error-line" role="alert">{note}</p>}
      {showUpload && <UploadBox series={m} occ={o} onDone={load} dragging={dragging} />}
      {o.state === "waiting" && <p className="muted">FocusTime looks for the transcript after the call, every 15 minutes for 3 hours, then hourly up to 12 hours.</p>}
      {view === "transcript" ? (
        <TranscriptView occurrenceId={o.id} startAt={o.startAt} proposals={r.proposals} line={line} onProposal={(pid) => onPlace({ proposal: pid })} />
      ) : (<>
        {shownKinds.map((kind) => {
          const all = r.proposals.filter((p) => p.body.kind === kind);
          if (!all.length) return null;
          const rows = all.filter(toReview);
          const folds = (["done", "skipped"] as const).map((k) => ({ k, ps: all.filter((p) => (k === "done" ? p.state === "confirmed" : p.state === "skipped")) })).filter((f) => f.ps.length);
          const selectable = rows.filter((p) => !checkOf(p)?.blocked);
          const allOn = selectable.length > 0 && selectable.every((p) => ticked.has(p.id));
          return (
            <section key={kind} className="mtg-group" style={{ "--c": color } as CSSProperties} aria-label={SECTION_HEAD[kind]}>
              <h3 className="mtg-sec-head">
                <span>{SECTION_HEAD[kind]} <span className="muted">{CALL_ROW.toReview(rows.length)}</span></span>
                {editable && selectable.length > 0 && (
                  <button type="button" className="mini quiet" aria-pressed={allOn} onClick={() => setTicked((s) => { const n = new Set(s); for (const p of selectable) if (allOn) n.delete(p.id); else n.add(p.id); return n; })}>
                    {allOn ? CALL_BAR.clear : CALL_ROW.selectAll}
                  </button>
                )}
              </h3>
              {rows.map((p) => <ProposalRow key={p.id} p={p} check={checkOf(p)} err={rowErr[p.id] ?? null} ticked={ticked.has(p.id)} editable={editable} can={can} busy={busy} clientKey={m.clientKey} opts={opts} today={today} onTick={(on) => tick(p, on)} onEdit={(patch) => void edit(p, patch)} onSend={() => void send([p])} onKeep={() => void keep([p])} onSkip={(on) => void skip([p], on)} onEnable={() => w?.enable(m.clientKey)} onShowLines={r.transcript ? (n) => onPlace({ view: "transcript", line: n }) : undefined} />)}
              {!rows.length && <p className="muted mtg-none">Nothing left to review here.</p>}
              {folds.map((f) => {
                const key = `${kind}:${f.k}`;
                const isOpen = unfolded.has(key);
                return (
                  <div key={key} className="mtg-fold">
                    <button type="button" className="link-btn" aria-expanded={isOpen} onClick={() => setUnfolded((u) => { const n = new Set(u); if (isOpen) n.delete(key); else n.add(key); return n; })}>
                      <Icon name={isOpen ? "open" : "closed"} /> {f.k === "done" ? CALL_ROW.done(f.ps.length) : CALL_ROW.skipped(f.ps.length)}
                    </button>
                    {isOpen && f.ps.map((p) => <ProposalRow key={p.id} p={p} check={undefined} err={null} ticked={false} editable={editable} can={can} busy={busy} clientKey={m.clientKey} opts={opts} today={today} onTick={() => {}} onEdit={() => {}} onSend={() => {}} onKeep={() => {}} onSkip={(on) => void skip([p], on)} onEnable={() => {}} onShowLines={r.transcript ? (n) => onPlace({ view: "transcript", line: n }) : undefined} />)}
                  </div>
                );
              })}
            </section>
          );
        })}
        {o.state === "ready" && !r.proposals.length && <p className="muted">Nothing to propose from this call.</p>}
        {editable && tickedRows.length > 0 && (
          <div className="bl-bulk mtg-bulk" role="toolbar" aria-label="Selected proposals">
            <strong>{CALL_BAR.selected(tickedRows.length)}</strong>
            {tickedDevops.length > 0 && (can ? (
              <button type="button" className="mini primary" disabled={busy || !sendable.length} onClick={() => void send(batch.now)}>{CALL_BAR.devops(batch.now.length)}</button>
            ) : (
              <button type="button" className="mini quiet dw-enable" onClick={() => w?.enable(m.clientKey)} title={CALL_BAR.noPat}>Enable DevOps writes</button>
            ))}
            {tickedPromises.length > 0 && <button type="button" className="mini" disabled={busy} onClick={() => void keep(tickedPromises)}>{CALL_BAR.promises(tickedPromises.filter((x) => x.body.kind === "commitment" && x.body.side === "cooptimize").length, tickedPromises.filter((x) => x.body.kind === "commitment" && x.body.side !== "cooptimize").length)}</button>}
            <button type="button" className="mini" disabled={busy} onClick={() => void skip(tickedRows)}>{CALL_BAR.skip}</button>
            <button type="button" className="mini quiet" disabled={busy} onClick={() => setTicked(new Set())}>{CALL_BAR.clear}</button>
            {can && batch.later.length > 0 && <span className="muted" role="note">{CALL_BAR.tenAtATime(sendable.length)}</span>}
            {can && batch.waiting.length > 0 && <span className="muted">{CALL_BAR.waiting(batch.waiting.length)}</span>}
          </div>
        )}
      </>)}
    </>
  );
}

/** PK-1: `sec` null (and `at` "") for a line with no time: a Pocket export's. */
type Line = { n: number; speaker: string; at: string; sec: number | null; text: string };

/**
 * MC-1d: the call's transcript, read only: every line with its speaker and time, the lines a proposal rests on marked,
 * and a filter. Loaded from the server when opened, held only in this component's memory (never browser storage or the
 * installed app's kept files), so closing the view drops it. A line in the address (a proposal's Show in transcript)
 * is scrolled to and focused.
 */
function TranscriptView({ occurrenceId, startAt, proposals, line, onProposal }: { occurrenceId: number; startAt: string; proposals: Proposal[]; line: number | null; /** MC-1e: back to a proposal, in view and focused. */ onProposal: (id: number) => void }) {
  // A line's time of day (the call's start plus its offset), so "1:05" never reads as five past one.
  const time = (sec: number) => new Date(Date.parse(startAt) + sec * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const [data, setData] = useState<{ lines: Line[]; gone: boolean; missing: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    let live = true;
    call<{ lines: Line[]; gone: boolean; missing: boolean }>("meeting.transcript", { occurrenceId }).then((d) => live && setData(d), (e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [occurrenceId]);
  // Which proposals rest on each line (their words, for the button's label).
  const marks = useMemo(() => {
    const m = new Map<number, { id: number; what: string }[]>();
    for (const p of proposals) for (const n of p.body.lines) m.set(n, [...(m.get(n) ?? []), { id: p.id, what: proposalWords(p.body) }]);
    return m;
  }, [proposals]);
  const [listAt, setListAt] = useState<number | null>(null);
  useEffect(() => {
    if (!data || !line) return;
    setQ("");
    const el = document.getElementById(`mtg-line-${line}`);
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  }, [data, line]);
  if (error) return <p className="error-line" role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!data.lines.length) return <p className="muted">{data.gone ? TRANSCRIPT_TEXT.gone : TRANSCRIPT_TEXT.missing}</p>;
  const needle = q.trim().toLowerCase();
  const shown = needle ? data.lines.filter((l) => l.text.toLowerCase().includes(needle) || l.speaker.toLowerCase().includes(needle)) : data.lines;
  return (
    <section className="mtg-transcript" aria-label={TRANSCRIPT_TEXT.tab}>
      <div className="mtg-tr-bar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={TRANSCRIPT_TEXT.filterHint} aria-label={TRANSCRIPT_TEXT.filter} />
        <span className="muted" role="status">{needle && !shown.length ? TRANSCRIPT_TEXT.none(q.trim()) : TRANSCRIPT_TEXT.count(shown.length, data.lines.length)}</span>
      </div>
      <p className="muted mtg-tr-who">{TRANSCRIPT_TEXT.who}</p>
      <ol className={`mtg-lines${data.lines.every((l) => l.sec === null) ? " untimed" : ""}`}>
        {shown.map((l) => {
          const on = marks.get(l.n);
          return (
            <li key={l.n} id={`mtg-line-${l.n}`} tabIndex={-1} className={`${on ? "marked" : ""}${line === l.n ? " at" : ""}`} {...(on ? { "aria-description": `${TRANSCRIPT_TEXT.marked}: ${on.map((x) => x.what).join("; ")}` } : {})}>
              {l.sec !== null && <span className="mtg-line-at" title={`${l.at} into the call`}>{time(l.sec)}</span>}
              <span className="mtg-who">{l.speaker}</span>
              <span className="mtg-line-text">{l.text}</span>
              {on && (
                // MC-1e: from the line to its proposal (a short list when several rest on it).
                <span className="mtg-line-mark">
                  {on.length === 1 ? (
                    <button type="button" className="mini quiet" onClick={() => onProposal(on[0]!.id)} aria-label={`${CALL_ROW.goToProposal}: ${on[0]!.what}`} title={on[0]!.what}>{CALL_ROW.showLine(1)}</button>
                  ) : (
                    <>
                      <button type="button" className="mini quiet" aria-expanded={listAt === l.n} aria-controls={`mtg-line-list-${l.n}`} onClick={() => setListAt(listAt === l.n ? null : l.n)}>{CALL_ROW.showLine(on.length)}</button>
                      {listAt === l.n && (
                        <ul className="mtg-line-list" id={`mtg-line-list-${l.n}`}>
                          {on.map((x) => <li key={x.id}><button type="button" className="link-btn" onClick={() => onProposal(x.id)}>{x.what}</button></li>)}
                        </ul>
                      )}
                    </>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** MC-1e: the place Back returns to, in words: where the call was opened from. */
const BACK_TO: [RegExp, string][] = [[/^#\/(day|today)(\/|$)/, "Day"], [/^#\/week(\/|$)/, "Week"], [/^#\/backlog(\/|$)/, "Backlog"], [/^#\/status(\/|$)/, "Status"], [/^#\/inbox(\/|$)/, "Inbox"]];
export const backWord = (hash: string | null): string => BACK_TO.find(([re]) => hash && re.test(hash))?.[1] ?? "Calls";

function BackHead({ onBack, title, sub, to = "Calls" }: { onBack: () => void; title: string; sub?: string; to?: string }) {
  return (
    <header className="page-head">
      <div className="ph-title">
        <button type="button" className="mini quiet" onClick={onBack} aria-label={`Back to ${to}`}><Icon name="back" /> {to}</button>
        <h2 tabIndex={-1}>{title}</h2>
        {sub && <span className="muted">{sub}</span>}
      </div>
    </header>
  );
}

function Quotes({ qs }: { qs: Quote[] | null }) {
  if (!qs) return <p className="muted mtg-quote-gone">The transcript's words are kept 30 days; these are gone.</p>;
  return (
    <div className="mtg-quotes">
      {qs.map((q) => (
        <blockquote key={q.n}>
          <span className="mtg-who">{q.speaker}{q.at ? ` · ${q.at}` : ""}</span> {q.text}
        </blockquote>
      ))}
    </div>
  );
}

function ProposalRow({ p, check, err, ticked, editable, can, busy, clientKey, opts, today, onTick, onEdit, onSend, onKeep, onSkip, onEnable, onShowLines }: { p: Proposal; check: ProposalCheck | undefined; err: string | null; ticked: boolean; editable: boolean; can: boolean; busy: boolean; clientKey: string; opts: ReturnType<typeof useNewOptions>; today: string; onTick: (on: boolean) => void; onEdit: (patch: Record<string, unknown>) => void; onSend: () => void; onKeep: () => void; onSkip: (on: boolean) => void; onEnable: () => void; onShowLines?: ((line: number) => void) | undefined }) {
  const b = p.body;
  const live = toReview(p);
  const main = proposalWords(b);
  const [text, setText] = useState(main);
  useEffect(() => setText(main), [main]);
  const field = b.kind === "gap" ? "title" : b.kind === "commitment" ? "what" : "text";
  const save = () => text.trim() && text.trim() !== main && onEdit({ [field]: text.trim() });
  const where =
    // PK-1: a Pocket export's promise whose words don't say whose it is names nobody.
    b.kind === "commitment" ? `${b.side === "unknown" ? CALL_ROW.noOwner : b.who}${b.toName ? ` to ${b.toName}` : ""}${b.due ? ` · due ${dayLabel(b.due)}` : ""} · ${b.side === "cooptimize" ? `in ${b.who.split(/\s+/)[0]}'s Promises` : "noted with this call"}`
    : b.kind === "comment" ? `${NOTE[b.note]} on #${b.itemId} ${b.itemTitle} (${b.itemType})`
    : null;
  const needs = check?.needs ?? [];
  const blocked = check?.blocked ?? null;
  const stuck = needs.length > 0 || !!check?.cant || !!blocked;
  const failed = p.state === "failed";
  const state = p.state === "confirmed" ? (p.result?.message ?? (b.kind === "commitment" ? (b.side === "cooptimize" ? "Added to Promises" : "Noted with this call") : "Done")) : p.state === "skipped" ? "Skipped" : null;
  const mainLabel = b.kind === "commitment" ? (b.side === "cooptimize" ? CALL_ROW.promise : CALL_ROW.note) : failed ? CALL_ROW.tryAgain : b.kind === "gap" ? CALL_ROW.create : CALL_ROW.comment;
  return (
    <article id={`mtg-prop-${p.id}`} tabIndex={-1} className={`mtg-prop ${p.state}${ticked ? " ticked" : ""}${stuck ? " stuck" : ""}`} aria-label={main}>
      <span className="mtg-tick">
        {editable && live && !blocked && <input type="checkbox" checked={ticked} onChange={(e) => onTick(e.target.checked)} aria-label={`Select: ${main}`} />}
      </span>
      <div className="mtg-prop-body">
        {editable && live ? (
          b.kind === "comment" ? <TextBox minRows={2} maxRows={8} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} aria-label="Comment" /> : <input value={text} maxLength={b.kind === "gap" ? 255 : 200} onChange={(e) => setText(e.target.value)} onBlur={save} aria-label={b.kind === "gap" ? "Title" : "What"} />
        ) : (
          <p className="mtg-main">{main}</p>
        )}
        {where && <p className="muted mtg-where">{where}</p>}
        {b.kind === "gap" && (live ? <GapFields b={b} id={p.id} clientKey={clientKey} opts={opts} today={today} editable={editable} check={check} onEdit={onEdit} /> : <p className="muted mtg-where">{b.type}{b.parentTitle ? ` under #${b.parentId} ${b.parentTitle}` : ""}</p>)}
        {live && needs.length > 0 && <p className="mtg-need" role="status">{CALL_ROW.needs(needs.map((n) => n.name))}</p>}
        {live && check?.cant && <p className="mtg-need" role="status">{check.cant}</p>}
        {live && blocked && <p className="mtg-need" role="note">{blocked}</p>}
        {"namesRemoved" in b && b.namesRemoved && <p className="names-removed">Another client's name was removed: "another client" is written instead.</p>}
        <Quotes qs={p.quotes} />
        {/* MC-1d: the jump to the lines this proposal rests on, in the Transcript view (while the transcript is kept). */}
        {onShowLines && b.lines.length > 0 && p.quotes && (
          <button type="button" className="mini quiet mtg-show-lines" onClick={() => onShowLines(Math.min(...b.lines))} aria-label={`${CALL_ACTIONS.showLines}: ${main}`}>
            {CALL_ACTIONS.showLines}
          </button>
        )}
        {failed && p.result?.message && <p className="mtg-state-line problem" role="alert">{p.result.message}</p>}
        {err && <p className="mtg-state-line problem" role="alert">{err}</p>}
        {state && <p className="mtg-state-line">{state}</p>}
      </div>
      {editable && (
        <div className="mtg-prop-actions">
          {live && !blocked && (b.kind === "commitment" ? (
            <button type="button" className="mini primary" disabled={busy} onClick={onKeep}>{mainLabel}</button>
          ) : can ? (
            <button type="button" className="mini primary" disabled={busy || stuck} title={stuck ? "Fill in what's needed first" : "Opens the DevOps preview; nothing is written until you confirm it"} onClick={onSend}>{mainLabel}</button>
          ) : (
            <button type="button" className="mini quiet dw-enable" onClick={onEnable} title="DevOps is read-only for this client until you add your own write PAT in Settings › DevOps">Enable DevOps writes</button>
          ))}
          {live && <button type="button" className="mini quiet" disabled={busy} onClick={() => onSkip(true)}>{CALL_ROW.skip}</button>}
          {p.state === "skipped" && <button type="button" className="mini quiet" disabled={busy} onClick={() => onSkip(false)}>{CALL_ROW.bringBack}</button>}
        </div>
      )}
    </article>
  );
}

/** The file picker's kinds: a Teams transcript, or (PK-1) a Pocket export. What a file is, the server decides by its content. */
const ACCEPT = ".vtt,.docx,.zip,.pdf,text/vtt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip,application/pdf";

/**
 * PK-1: while a file is dragged over the call's page, `dragging` is true (the upload area shows it will take it), and a
 * file dropped anywhere else on the page does nothing: the browser never leaves the page to open it. Only on a call's
 * page a reviewer may upload to; nothing else in the app changes.
 */
function usePageDrag(on: boolean): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!on) return;
    let depth = 0;
    const files = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const enter = (e: DragEvent) => {
      if (!files(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!files(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (!files(e)) return;
      // Outside the upload area: no drop here (the cursor says so), and the browser doesn't open the file.
      e.preventDefault();
      if (e.dataTransfer && !(e.target instanceof Element && e.target.closest(".mtg-drop"))) e.dataTransfer.dropEffect = "none";
    };
    const drop = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("dragend", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragend", drop);
    };
  }, [on]);
  return on && dragging;
}

type UploadAnswer = { lines?: number; proposals?: number; outcome?: string; ask?: { recorded: string; length: string | null; call: string } };

/**
 * One upload, by the picker or a drop: the file goes to the server, which decides what it is. PK-1: a Pocket recording
 * dated another day than the call isn't kept; the area asks (both dates and the recording's length) and sends the same
 * file again only on a yes. A drop onto a call that already has a transcript asks before replacing it; the picker
 * works as it always has.
 */
function useTranscriptUpload(series: SeriesView, occ: OccurrenceView, onDone: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ file: File; text: string } | null>(null);
  const send = async (f: File, dateOk = false) => {
    setBusy(true);
    setMsg(null);
    setAsk(null);
    try {
      const r = await uploadMeetingTranscript<UploadAnswer>(series.id, occ.date, f, { dateOk });
      if (r.ask) setAsk({ file: f, text: POCKET_TEXT.dateAsk(dayLabel(r.ask.recorded), r.ask.length, dayLabel(r.ask.call)) });
      else {
        setMsg(r.outcome && r.outcome !== "done" ? `Read ${r.lines ?? 0} lines. ${CALL_STATE.aiFailed}.` : POCKET_TEXT.read(r.lines ?? 0, r.proposals ?? 0));
        await onDone();
      }
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = (f: File | undefined) => f && void send(f);
  const dropped = (e: ReactDragEvent) => {
    e.preventDefault();
    // Not stopped here: the page's own drop handler then clears the dragging look (a browser sends no dragleave after a drop).
    if (busy) return;
    const fs = [...e.dataTransfer.files];
    if (fs.length !== 1) return setMsg(fs.length ? POCKET_TEXT.oneAtATime : null);
    if (occ.hasTranscript && !window.confirm(POCKET_TEXT.replace)) return;
    void send(fs[0]!);
  };
  const answer = (yes: boolean) => {
    if (!ask) return;
    if (yes) void send(ask.file, true);
    else {
      setAsk(null);
      setMsg(POCKET_TEXT.dateNoLine);
    }
  };
  return { busy, msg, ask, pick, dropped, answer };
}

/** The drop area's own handlers: it takes the file (the cursor shows a copy) and the page's guard leaves it alone. */
const dropProps = (u: ReturnType<typeof useTranscriptUpload>) => ({
  onDragOver: (e: ReactDragEvent) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = u.busy ? "none" : "copy";
  },
  onDrop: u.dropped,
});

/** PK-1: the recording's date isn't the call's: asked before anything is kept. */
function DateAsk({ text, onAnswer }: { text: string; onAnswer: (yes: boolean) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    // On a phone the bottom bar can cover its buttons: bring the whole question into the middle of the screen.
    ref.current?.scrollIntoView?.({ block: "center" });
  }, []);
  return (
    <div className="mtg-date-ask" role="alertdialog" aria-label="The recording's date" aria-describedby="mtg-date-ask-text" tabIndex={-1} ref={ref}>
      <p id="mtg-date-ask-text">{text}</p>
      <span className="mtg-upload-actions">
        <button type="button" className="mini primary" onClick={() => onAnswer(true)}>{POCKET_TEXT.dateYes}</button>
        <button type="button" className="mini quiet" onClick={() => onAnswer(false)}>{POCKET_TEXT.dateNo}</button>
      </span>
    </div>
  );
}

/**
 * MC-1d: a reviewer's two buttons on the call's page: Propose again (the AI pass once more on the stored transcript;
 * it replaces the open proposals, the done, skipped and failed ones stay; MC-1e: the same thing again is left out) and
 * Upload a transcript (a file in its place). PK-1: when the call's page shows no upload area, this is where a dragged
 * file is dropped.
 */
function CallActions({ series, occ, onDone, focusUpload = false, dropHere = false, dragging = false }: { series: SeriesView; occ: OccurrenceView; onDone: () => Promise<void>; focusUpload?: boolean; dropHere?: boolean; dragging?: boolean }) {
  const [busy, setBusy] = useState<"rerun" | "teams" | null>(null);
  const up = useTranscriptUpload(series, occ, onDone);
  // MC-1d: "Upload a transcript" from a meeting's menu lands here with the file button focused (the browser opens a
  // file picker only from a press, so the person presses it once more).
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (focusUpload) fileRef.current?.focus();
  }, [focusUpload]);
  // MC-1d: Propose again chosen from the meeting's menu runs here, once, where its result shows. MC-2: so does the
  // setup's Get it from Teams (the same one press).
  useEffect(() => {
    if (takeRerun(occ.id)) void rerun();
    if (takeFetch(occ.id)) void fromTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occ.id]);
  const [msg, setMsg] = useState<string | null>(null);
  /** MC-2: one try with my sign-in, for this call only; what came of it in plain words. */
  const fromTeams = async () => {
    setBusy("teams");
    setMsg(null);
    try {
      const r = await call<{ outcome: string; message: string }>("meeting.call_fetch", { occurrenceId: occ.id });
      setMsg(r.message);
      await onDone();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const rerun = async (ask = true) => {
    // It replaces the open proposals, with any words changed in them; the ones done or skipped stay.
    if (ask && occ.open > 0 && !window.confirm(`Propose again? The open proposals are replaced, with any words you changed. The ones done, skipped or failed stay, and the same thing again is left out.`)) return;
    setBusy("rerun");
    setMsg(null);
    try {
      const r = await call<{ outcome: string; proposals: number; added: number; same: number }>("meeting.rerun", { occurrenceId: occ.id });
      // MC-1e: how many are new, and how many were left out as the same as one already done, skipped or failed.
      setMsg(r.outcome === "done" ? rerunLine(r.added, r.same) : CALL_STATE.aiFailed);
      await onDone();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const canRerun = occ.hasTranscript && occ.state !== "waiting" && occ.state !== "fetching";
  const line = up.msg ?? msg;
  return (
    <>
      <div className={`mtg-actions${dropHere ? " mtg-drop" : ""}${dropHere && dragging ? " dropping" : ""}`} role="group" aria-label="This call" {...(dropHere ? dropProps(up) : {})}>
        {canRerun && (
          <button type="button" className={`mini${occ.state === "failed" ? " primary" : ""}`} disabled={!!busy || up.busy} onClick={() => void rerun()} title="The AI step once more on this call's transcript. It replaces the open proposals; the ones done, skipped or failed stay, and the same thing again is left out.">
            {busy === "rerun" ? "Proposing…" : CALL_ACTIONS.rerun}
          </button>
        )}
        {series.teams && (
          <button type="button" className={`mini${!occ.hasTranscript ? " primary" : ""}`} disabled={!!busy || up.busy} onClick={() => void fromTeams()} title={CALLS_TEXT.sourceTeamsHint}>
            {busy === "teams" ? "Asking Teams…" : CALL_ACTIONS.fromTeams}
          </button>
        )}
        <label className={`mini file-button${busy || up.busy ? " disabled" : ""}`} title={POCKET_TEXT.takes}>
          {up.busy ? "Reading…" : CALL_ACTIONS.upload}
          <input ref={fileRef} type="file" accept={ACCEPT} disabled={!!busy || up.busy} onChange={(e) => (up.pick(e.target.files?.[0]), (e.target.value = ""))} />
        </label>
        {dropHere && dragging && <span className="mtg-drop-hint" aria-hidden="true">{occ.hasTranscript ? POCKET_TEXT.dropReplace : POCKET_TEXT.dropHere}</span>}
        {line && !up.ask && <span className="muted" role="status">{line}</span>}
      </div>
      {up.ask && <DateAsk text={up.ask.text} onAnswer={up.answer} />}
    </>
  );
}

function UploadBox({ series, occ, onDone, dragging = false }: { series: SeriesView; occ: OccurrenceView; onDone: () => Promise<void>; dragging?: boolean }) {
  const up = useTranscriptUpload(series, occ, onDone);
  const [msg, setMsg] = useState<string | null>(null);
  const none = async () => {
    try {
      await call("meeting.no_transcript", { occurrenceId: occ.id });
      await onDone();
    } catch (e) {
      setMsg(errText(e));
    }
  };
  const line = up.msg ?? msg;
  return (
    <section className={`mtg-upload mtg-drop${dragging ? " dropping" : ""}`} aria-label="Upload the transcript" {...dropProps(up)}>
      <h3>{occ.state === "waiting" ? "Have the transcript already?" : "Upload the transcript"}</h3>
      <p className="muted">
        {series.call ? (series.teams ? "Use Get it from Teams above, or download it from the meeting's recap in Teams." : series.organizer === "other" ? "This call is organized outside Cooptimize, so FocusTime doesn't ask Teams for it. In Teams, open the meeting's recap and download the transcript; if you can't, ask the organizer to send it." : "Download it from the meeting's recap in Teams, or wherever it was recorded.") : series.source === "upload" ? "This call is organized outside Cooptimize, so FocusTime never reads it. In Teams, open the meeting's recap and download the transcript; if you can't, ask the organizer to send it." : "Download it from the meeting's recap in Teams."} {POCKET_TEXT.pocketHow} {series.call === "hand" ? "It's kept 30 days, for you only." : series.call ? "It's kept 30 days, for you and the Cooptimizers on the invite only." : "It's kept 30 days, for this call's reviewers and attendees only."}
      </p>
      <p className="muted">{POCKET_TEXT.takes}</p>
      {up.ask ? (
        <DateAsk text={up.ask.text} onAnswer={up.answer} />
      ) : (
        <span className="mtg-upload-actions">
          <label className={`mini primary file-button${up.busy ? " disabled" : ""}`}>
            {up.busy ? "Reading…" : POCKET_TEXT.choose}
            <input type="file" accept={ACCEPT} disabled={up.busy} onChange={(e) => (up.pick(e.target.files?.[0]), (e.target.value = ""))} />
          </label>
          <span className="muted mtg-drop-or">{dragging ? POCKET_TEXT.dropHere : POCKET_TEXT.orDrop}</span>
          {occ.state !== "no_transcript" && !series.call && <button type="button" className="mini quiet" onClick={() => void none()}>No transcript this week</button>}
        </span>
      )}
      {line && !up.ask && <p className="muted" role="status">{line}</p>}
    </section>
  );
}
