// MC-1, MC-2, MC-3: Calls, a tab (#/calls…; every #/meetings… address before it lands here). MC-3: one list of the
// calls I was on by day, newest first (a registered client call's occurrences, the calls I or someone on them asked
// FocusTime to review, the calls I added, and my own calendar's calls in my last 14 days that nobody has read yet, read
// when Calls opens and kept only in this page's memory), each with its state in words, filters with counts and the
// Inbox's client chips; the call I choose opens beside the list. A call nobody has read opens its setup there (the
// client it is about, suggested and my choice; where its transcript comes from), and nothing is read until Continue.
// The review: "Update <client>'s plan · <meeting> <date>", one row per proposal with the words it came from. MC-1e:
// made like the rest of the app. Nothing is ticked to start; each row has its own main button (Create in DevOps, Add
// comment, Add to Promises or Note with this call) and Skip. A new item is edited with the New form's fields; DevOps
// changes go only through the one DevOps preview (ui/DevOpsWrite.tsx), for one row or for the ticked ones (10 at a
// time); a promise is saved at once with Undo. A filter, one count, folded skipped and done rows, headers that stay in
// view, and a way from a transcript line back to its proposals. An attendee who isn't a reviewer can look, not act.
// Below 900 px (and on the phone) the list and the call are two steps, with Back. Only the list's filter, its client and
// whether the list is folded are kept in this browser; nothing of a call is.
import { isFeatureTier } from "../../plan/needed.ts";
import { BreakDownButton } from "../BreakDownPanel.tsx";
import { openBreakDown } from "../menu.ts";
import { TextBox } from "../TextBox.tsx";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { ActionRefusal, call, uploadMeetingTranscript } from "../api.ts";
import { useDevOpsWrite, type DevOpsChange } from "../DevOpsWrite.tsx";
import type { OccurrenceView, OtherCallView, SeriesView } from "../../plan/meeting-views.ts";
import type { CaptureClient } from "../../plan/capture.ts";
import { lengthLabel, OTHER_CALL_DAYS, suggestClient } from "../../plan/calls.ts";
import { callBatch, proposalWords, toReview, type Proposal, type Quote } from "../../plan/meetings.ts";
import { rememberCallsList as remember, rememberedCallsList as remembered, requestFetch, takeFetch, takeRerun, takeReviewCall, type MineData } from "./calls.ts";
import { CALL_ACTIONS, CALL_BAR, CALL_FILTERS, CALL_LIST, CALL_ROW, CALL_STATE, CALLS_TEXT, POCKET_TEXT, rerunLine, SECTION_HEAD, TRANSCRIPT_TEXT, type CallFilter, type ProposalCheck } from "../../plan/call-words.ts";
import { byDay, callRows, chipClients, dayHeading, filterCounts, filterRows, firstToOpen, LIST_FILTERS, otherRowKey, type CallRow, type ListedRecording, type ListFilter } from "../../plan/call-list.ts";
import { pocketRows } from "../../plan/call-list-pocket.ts";
import { gotLine, othersLeftOut, POCKET_CALL_WORDS as PW, recordingLine } from "../../plan/pocket-words.ts";
import { lengthWords, longerThanCall } from "../../plan/pocket-match.ts";
import type { PocketView } from "../../actions/pocket-types.ts";
import type { CallsAt } from "../nav.ts";
import { globalKeyAllowed, isTypingTarget, topOverlay } from "../keys.ts";
import { useNarrow } from "../PanelShell.tsx";
import { clientColor } from "../labels.ts";
import { Icon } from "../icons.tsx";
import { RepeatMark } from "./CallMark.tsx";
import { forgetCallOptions, GapFields, useNewOptions } from "./GapFields.tsx";

type Review = { meeting: SeriesView; occurrence: OccurrenceView; proposals: Proposal[]; transcript: { lines: number; speakers: number } | null; /** MC-2: what was said (at most 5 lines); null before MC-2 or once the transcript is gone. */ summary?: string[] | null; /** PK-1: from a Pocket export: numbered speakers, no times. */ pocket?: boolean; /** MC-2b: brought in from a Pocket recording: by me, or by another reviewer. */ pocketFrom?: "mine" | "reviewer" | null; canConfirm: boolean; canWrite: boolean; checks: Record<string, ProposalCheck> };

const errText = (e: unknown) => (e instanceof ActionRefusal || e instanceof Error ? e.message : "Something went wrong");
const dayLabel = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const NOTE: Record<"decision" | "next_step" | "status", string> = { decision: "Decision", next_step: "Next step", status: "Status" };
const KINDS = ["gap", "commitment", "comment"] as const;

type CallView = "transcript" | "upload";
export type CallPlace = { view?: CallView; line?: number; filter?: Exclude<CallFilter, "all">; proposal?: number };

/** MC-3: whether this browser keeps Calls' list hidden. Never anything of a call. */
const FOLD_KEY = "focustime.calls.folded";
function foldedAtFirst(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === "1";
  } catch {
    return false;
  }
}

/** "2:00 PM": a call's start in my zone. */
/** A call's start in the person's own zone (its day heading is in that zone too). */
const timeOf = (iso: string, zone: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });

export type CallsPageProps = {
  at: CallsAt;
  /** Go to another place in Calls (replace: no new history entry, for what Calls picks by itself). */
  onGo: (next: CallsAt, opts?: { replace?: boolean }) => void;
  onChanged?: () => void;
  colors: Record<string, string>;
  today: string;
  zone: string;
  phone?: boolean;
  undoable?: (text: string, undo: () => Promise<unknown>) => void;
  /** MC-2: the clients a call can be about (mine, with Internal). */
  clients?: CaptureClient[];
  /** MC-2: the focus block's client a moment falls in, for the suggestion. */
  blockClientAt?: (iso: string) => string | null;
};

/** MC-3: the Calls tab: the list by day on the left, the open call (or its setup, or Add a call) beside it. */
export function CallsPage({ at, onGo, onChanged, colors, today, zone, phone = false, undoable, clients = [], blockClientAt = () => null }: CallsPageProps) {
  const narrow = useNarrow() || phone;
  const [data, setData] = useState<MineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [others, setOthers] = useState<{ calls: OtherCallView[]; days: number } | null>(null);
  const [othersErr, setOthersErr] = useState<string | null>(null);
  // A call nobody has read, its setup open beside the list (in memory only: such a call has no id to put in an address).
  const [setupKey, setSetupKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [missing, setMissing] = useState(false);
  const [folded, setFolded] = useState(foldedAtFirst);
  // MC-2b: whether my Pocket is connected (what FocusTime kept; Pocket isn't asked), and my last press's list, in this
  // page's memory only while Calls is open.
  const [pocketOn, setPocketOn] = useState<boolean | null>(null);
  const [pocket, setPocket] = useState<{ recordings: ListedRecording[]; others: number; more: boolean; at: string } | null>(null);
  const [pocketBusy, setPocketBusy] = useState(false);
  const [pocketErr, setPocketErr] = useState<string | null>(null);
  useEffect(() => {
    void call<PocketView>("pocket.status", {}).then((v) => setPocketOn(v.connected), () => setPocketOn(false));
  }, []);
  const getPocket = async () => {
    setPocketBusy(true);
    setPocketErr(null);
    try {
      setPocket(await call<{ recordings: ListedRecording[]; others: number; more: boolean; at: string }>("meeting.pocket_list", {}));
    } catch (e) {
      setPocketErr(errText(e));
    } finally {
      setPocketBusy(false);
    }
  };
  const loadMine = useCallback(() => call<MineData>("meeting.mine", {}).then((d) => (setData(d), setError(null)), (e: unknown) => setError(errText(e))), []);
  const loadOthers = useCallback(
    () =>
      call<{ calls: OtherCallView[]; days: number }>("meeting.calls", {}).then(
        (d) => (setOthers(d), setOthersErr(null), d),
        (e: unknown) => (setOthersErr(errText(e)), null),
      ),
    [],
  );
  const changed = useCallback(() => {
    void loadMine();
    onChanged?.();
  }, [loadMine, onChanged]);
  const atRef = useRef(at);
  atRef.current = at;
  // App hands a new onGo on each of its renders; go stays the same, so nothing below runs again because of it.
  const onGoRef = useRef(onGo);
  onGoRef.current = onGo;
  const go = useCallback((next: Partial<CallsAt> & { occurrence: number | null }, replace = false) => onGoRef.current({ ...(atRef.current.show ? { show: atRef.current.show } : {}), ...(atRef.current.client !== undefined ? { client: atRef.current.client } : {}), ...next }, { replace }), []);
  // Review this call from a meeting's menu: taken as Calls opens, so nothing else opens first; its setup opens beside
  // the list once my calendar's calls are read (matched by its start and end).
  const [asked] = useState(takeReviewCall);
  // While it is matched against my calendar, nothing else opens by itself.
  const wanted = useRef<{ start: string; end: string; key?: string } | null>(asked);
  useEffect(() => {
    void loadMine();
    let live = true;
    void loadOthers().then((d) => {
      const want = asked;
      if (!live || !want) return;
      // WK-6: by the meeting itself when its key is known, else by its start and end.
      const hit = (want.key ? d?.calls.find((c) => c.key === want.key) : undefined) ?? d?.calls.find((c) => Date.parse(c.startAt) === Date.parse(want.start) && Date.parse(c.endAt) === Date.parse(want.end));
      wanted.current = null;
      if (hit?.occurrenceId) go({ occurrence: hit.occurrenceId });
      else if (hit) setSetupKey(otherRowKey(hit));
      else setMissing(true);
    });
    return () => {
      live = false;
    };
    // Once, as Calls opens (loadMine, loadOthers and go never change; asked is taken once).
  }, [loadMine, loadOthers, go, asked]);

  // The list's filter and client: the address's, else the ones this browser remembered (written into the address).
  const show: ListFilter = at.show ?? "all";
  const client = at.client ?? null;
  useEffect(() => {
    if (at.show !== undefined || at.client !== undefined) return remember(at.show, at.client);
    const r = remembered();
    if (r.show || r.client !== undefined) go({ ...r, occurrence: atRef.current.occurrence, ...pick(atRef.current) }, true);
  }, [at.show, at.client, go]);

  /** A filter or client chosen: remembered at once (so an address without them doesn't bring back the old ones). */
  const setList = (f: ListFilter, c: string | null) => {
    remember(f, c ?? undefined);
    onGoRef.current({ occurrence: at.occurrence, ...pick(at), ...(f !== "all" ? { show: f } : {}), ...(c !== null ? { client: c } : {}) });
  };
  // Without the calls FocusTime keeps there is no list: my calendar's calls alone would read as nothing to review.
  const { rows, older } = useMemo(() => (data ? callRows({ meetings: data.meetings, occurrences: data.occurrences, others: others?.calls ?? null, today, zone, addPocket: pocketRows(pocket?.recordings ?? null, zone) }) : { rows: [], older: [] }), [data, others, today, zone, pocket]);
  const shown = useMemo(() => filterRows(rows, show, client), [rows, show, client]);
  const counts = useMemo(() => filterCounts(rows, client), [rows, client]);
  const chips = useMemo(() => chipClients(rows), [rows]);
  const setupRow = setupKey ? [...rows, ...older].find((r) => r.key === setupKey && (r.other || r.recording)) ?? null : null;
  // Calls with no call named: the newest call that needs me opens, else the newest call (side by side only; when
  // narrow the list is the first step).
  const loaded = !!data && (!!others || !!othersErr);
  // After I close a call or a setup myself (Cancel, Esc, Back), nothing else opens in its place.
  const closedByMe = useRef(false);
  const focusRow = useRef<string | null>(null);
  const [, setFocusTick] = useState(0);
  // The call Calls opened by itself: its page leaves the focus where the person put it (the tab, the list).
  const openedByItself = useRef<number | null>(null);
  // In two steps, a call opened from the list: its Back is the browser's, so history doesn't gain a step each way.
  const fromList = useRef(false);
  useEffect(() => {
    if (at.occurrence || setupKey || adding || !loaded || narrow || wanted.current || closedByMe.current) return;
    const first = firstToOpen(rows);
    if (first?.occurrenceId) (openedByItself.current = first.occurrenceId), go({ occurrence: first.occurrenceId }, true);
    else if (first?.other) setSetupKey(first.key);
  }, [loaded, narrow, rows, at.occurrence, setupKey, adding, go]);
  // The open call's row is in view in the list (a row already in view stays where it is).
  const openKeyNow = at.occurrence ? `o${at.occurrence}` : setupKey;
  useEffect(() => {
    if (openKeyNow) document.querySelector<HTMLElement>(`[data-call-row="${openKeyNow}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [openKeyNow, loaded]);

  const openRow = (r: CallRow) => {
    setAdding(false);
    setMissing(false);
    if (r.occurrenceId) {
      setSetupKey(null);
      fromList.current = narrow;
      const up = r.state.label === CALL_STATE.upload;
      go({ occurrence: r.occurrenceId, ...(up ? { view: "upload" as const } : {}) });
    } else {
      setSetupKey(r.key);
      if (at.occurrence) go({ occurrence: null });
    }
  };
  const openKey = at.occurrence ? `o${at.occurrence}` : setupRow ? setupRow.key : null;
  const besideOpen = !!at.occurrence || !!setupRow || adding;
  const backToList = useCallback(() => {
    const k = openKeyRef.current;
    closedByMe.current = true;
    setSetupKey(null);
    setAdding(false);
    if (atRef.current.occurrence && fromList.current) history.back();
    else if (atRef.current.occurrence) go({ occurrence: null }, true);
    fromList.current = false;
    focusRow.current = k;
    setFocusTick((n) => n + 1);
  }, [go]);
  const openKeyRef = useRef(openKey);
  openKeyRef.current = openKey;
  const fold = (on: boolean) => {
    setFolded(on);
    try {
      localStorage.setItem(FOLD_KEY, on ? "1" : "0");
    } catch {
      /* a convenience only */
    }
    requestAnimationFrame(() => document.querySelector<HTMLElement>(on ? "[data-calls-show]" : "[data-calls-hide]")?.focus());
  };

  // J and K move through the list and Enter opens (a row is a button), as in the Inbox; never while typing. Esc, when
  // the list and the call are two steps, goes back to the list.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(t) || !globalKeyAllowed(e, t, topOverlay(document))) return;
      if (e.key === "Escape" && narrow && besideOpen && !t?.closest(".mtg-setup, dialog, [data-overlay]")) {
        e.preventDefault();
        backToList();
        return;
      }
      if (e.key !== "j" && e.key !== "k") return;
      const list = [...document.querySelectorAll<HTMLElement>("[data-calls-list] [data-call-row]")].filter((b) => b.offsetParent !== null);
      if (!list.length) return;
      e.preventDefault();
      const cur = list.indexOf(t?.closest<HTMLElement>("[data-call-row]") ?? list.find((b) => b.getAttribute("aria-current")) ?? list[0]!);
      const nextAt = cur < 0 ? 0 : Math.min(list.length - 1, Math.max(0, cur + (e.key === "j" ? 1 : -1)));
      list[nextAt]!.focus();
      list[nextAt]!.scrollIntoView?.({ block: "nearest" });
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [narrow, besideOpen, backToList]);

  const tryAgain = () => {
    setError(null);
    setOthersErr(null);
    void loadMine();
    void loadOthers();
  };
  const twoStep = narrow;
  // On the phone the page scrolls under its sticky top bar, so a day's heading sticks under the bar.
  const listRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    const bar = phone ? el?.closest(".app.phone")?.querySelector<HTMLElement>(":scope > .topbar") : null;
    if (el && bar) el.style.setProperty("--mtg-top", `${bar.getBoundingClientRect().height}px`);
  });
  const showList = twoStep ? !besideOpen : !folded;
  // Back to the list puts focus on the row it came from once that row is drawn (the browser's Back lands a moment later).
  useEffect(() => {
    const k = focusRow.current;
    const el = k ? document.querySelector<HTMLElement>(`[data-call-row="${k}"]`) : null;
    if (el) (focusRow.current = null), el.focus();
  });
  const showBeside = twoStep ? besideOpen : true;
  const registered = data?.meetings.filter((m) => !m.call) ?? [];

  const list = (
    <section className="calls-list" aria-labelledby="calls-title" data-calls-list="" ref={listRef}>
      <header className="calls-head">
        <div className="calls-title">
          <h1 id="calls-title">{CALLS_TEXT.heading}</h1>
          <span className="muted">{CALL_LIST.sub}</span>
        </div>
        <span className="calls-head-actions">
          <button type="button" className="mini" onClick={() => (setSetupKey(null), setAdding(true), at.occurrence ? go({ occurrence: null }) : undefined)} aria-expanded={adding}>{CALLS_TEXT.add}</button>
          {!twoStep && (
            <button type="button" className="mini quiet icon-only" data-calls-hide="" onClick={() => fold(true)} aria-label={CALL_LIST.hideList} title={CALL_LIST.hideList}>
              <Icon name="back" />
            </button>
          )}
        </span>
      </header>
      {data && (
        <div className="seg calls-filters" role="group" aria-label="Show">
        {LIST_FILTERS.map((f) => (
          <button key={f} type="button" className={`seg-btn${show === f ? " on" : ""}`} aria-pressed={show === f} title={CALL_LIST.filterHint[f]} onClick={() => setList(f, client)} data-calls-filter={f}>
            {CALL_LIST.filters[f]} <span className="seg-count">{counts[f]}</span>
          </button>
        ))}
      </div>
      )}
      {data && chips.length > 1 && (
        <div className="ib4-chips calls-chips" role="group" aria-label="Clients">
          <button type="button" className={`ib4-chip${client === null ? " on" : ""}`} aria-pressed={client === null} onClick={() => setList(show, null)}>
            {CALL_LIST.allClients}
          </button>
          {chips.map((c) => (
            <button key={c.key || "none"} type="button" className={`ib4-chip${client === c.key ? " on" : ""}${c.key ? "" : " ib4-chip-none"}`} aria-pressed={client === c.key} onClick={() => setList(show, client === c.key ? null : c.key)} style={c.key ? ({ "--c": clientColor(c.key, colors) } as CSSProperties) : undefined} data-chip={c.key ? undefined : "no-client"}>
              {c.key && <span className="dot" aria-hidden="true" />}
              {c.name}
            </button>
          ))}
        </div>
      )}
      {data && pocketOn !== null && (
        <div className="calls-pocket" data-calls-pocket="">
          {pocketOn ? (
            <>
              <button type="button" className="mini" disabled={pocketBusy} onClick={() => void getPocket()} data-pocket-get="">{pocketBusy ? PW.getting : PW.get}</button>
              <span className="muted" role="status">
                {pocket ? gotLine(pocket.recordings.length, timeOf(pocket.at, zone)) : ""}
                {pocket?.others ? ` ${othersLeftOut(pocket.others)}` : ""}
                {pocket?.more ? ` ${PW.more}` : ""}
              </span>
              {pocketErr && <span className="error-line" role="alert">{pocketErr}</span>}
            </>
          ) : (
            <span className="muted">{PW.connectLine.slice(0, PW.connectLine.indexOf(PW.connectLink))}<a href="#/settings/connections/pocket">{PW.connectLink}</a>.</span>
          )}
        </div>
      )}
      <div className="calls-scroll">
        {missing && <p className="muted calls-note" role="status">{CALLS_TEXT.notFound}</p>}
        {(error || othersErr) && (
          <p className="error-line calls-note" role="alert">
            {error ? (data ? error : CALL_LIST.failedMine) : CALL_LIST.failedOthers}{" "}
            <button type="button" className="link-btn" onClick={tryAgain}>{CALL_LIST.tryAgain}</button>
          </p>
        )}
        {!data && !error ? (
          <p className="muted calls-note" role="status">{CALL_LIST.loading}</p>
        ) : data && !rows.length && (others || othersErr) ? (
          <p className="muted calls-note">{CALL_LIST.none(others?.days ?? OTHER_CALL_DAYS)}</p>
        ) : rows.length > 0 && !shown.length ? (
          <p className="muted calls-note">{CALL_LIST.noneHere}</p>
        ) : null}
        {byDay(shown).map((d) => (
          <section key={d.day} className="calls-day" aria-labelledby={`calls-day-${d.day}`} data-day={d.day}>
            <h2 id={`calls-day-${d.day}`} className="calls-day-head">{dayHeading(d.day, today)}</h2>
            <ul className="calls-rows">
              {d.rows.map((r) => <CallRowButton key={r.key} r={r} open={openKey === r.key} colors={colors} zone={zone} onOpen={() => openRow(r)} />)}
            </ul>
          </section>
        ))}
        {data && !othersErr && !others && <p className="muted calls-note" role="status">{CALL_LIST.loading}</p>}
        {older.length > 0 && (
          <Fold id="older" title={CALL_LIST.older(older.length)} sub={CALL_LIST.olderSub}>
            <ul className="calls-rows">
              {older.map((r) => <CallRowButton key={r.key} r={r} open={openKey === r.key} colors={colors} zone={zone} onOpen={() => openRow(r)} withDay={dayLabel(r.day)} />)}
            </ul>
          </Fold>
        )}
        {data && (
          <Fold id="client-calls" title={CALL_LIST.clientCalls(registered.length)} sub={CALL_LIST.clientCallsSub}>
            {registered.length === 0 && <p className="muted">{CALLS_TEXT.noClientCalls}</p>}
            <ul className="calls-series">
              {registered.map((m) => {
                const occs = data.occurrences.filter((o) => o.seriesId === m.id);
                return (
                  <li key={m.id} style={{ "--c": clientColor(m.clientKey, colors) } as CSSProperties} data-series="">
                    <span className="calls-series-name"><span className="swatch" aria-hidden="true" />{m.name}</span>
                    <span className="muted">{m.clientName} · {m.roleLabel} · {m.when} · {m.source === "automatic" ? CALL_LIST.readAfter : CALL_LIST.uploadedByReviewer}</span>
                    <span className="muted">{CALL_LIST.reviewers(m.reviewers.map((x) => x.name))}</span>
                    {!occs.length && <span className="muted">{CALL_LIST.noneLately}</span>}
                  </li>
                );
              })}
            </ul>
          </Fold>
        )}
        {others && <p className="muted calls-privacy">{CALL_LIST.privacy}</p>}
      </div>
    </section>
  );

  let beside: React.ReactNode;
  if (adding)
    beside = (
      <div className="calls-beside-pad">
        <AddCall clients={clients} today={today} onCancel={() => (setAdding(false), requestAnimationFrame(() => document.querySelector<HTMLElement>(".calls-head-actions .mini")?.focus()))} onAdded={(id) => (setAdding(false), changed(), go({ occurrence: id, view: "upload" }))} />
      </div>
    );
  else if (at.occurrence)
    beside = <ReviewScreen key={at.occurrence} pocketRecs={rows.find((x) => x.occurrenceId === at.occurrence)?.pocket ?? []} zone={zone} quiet={openedByItself.current === at.occurrence} id={at.occurrence} view={at.view ?? null} line={at.line ?? null} filter={at.filter ?? null} focus={at.proposal ?? null} colors={colors} today={today} undoable={undoable} {...(twoStep ? { onBack: backToList } : {})} onPlace={(p) => go({ occurrence: at.occurrence, ...p })} onChanged={changed} />;
  else if (setupRow?.other)
    beside = (
      <div className="calls-beside-pad">
        {twoStep && <BackHead onBack={backToList} title="" />}
        <CallSetup
          key={setupRow.key}
          call={setupRow.other}
          clients={clients}
          suggested={suggestClient(setupRow.other.name, clients, blockClientAt(setupRow.other.startAt))}
          zone={zone}
          pocket={setupRow.pocket}
          onCancel={backToList}
          onStarted={(id, then) => {
            setSetupKey(null);
            changed();
            void loadOthers();
            if (then === "teams") requestFetch(id);
            go({ occurrence: id, ...(then === "upload" ? { view: "upload" as const } : {}) });
          }}
        />
      </div>
    );
  else if (setupRow?.recording)
    beside = (
      <div className="calls-beside-pad">
        {twoStep && <BackHead onBack={backToList} title="" />}
        <PocketAddSetup
          key={setupRow.key}
          rec={setupRow.recording}
          clients={clients}
          suggested={blockClientAt(setupRow.recording.startAt)}
          zone={zone}
          onCancel={backToList}
          onAdded={(id) => {
            setSetupKey(null);
            changed();
            go({ occurrence: id });
          }}
        />
      </div>
    );
  else
    beside = (
      <div className="calls-beside-pad calls-empty">
        {loaded && !rows.length && !older.length ? (
          <>
            <p>{CALL_LIST.emptyBeside}</p>
            <button type="button" className="mini primary" onClick={() => setAdding(true)}>{CALLS_TEXT.add}</button>
          </>
        ) : error && !data ? (
          <p className="muted">{CALL_LIST.failedMine}</p>
        ) : !loaded ? (
          <p className="muted" role="status">{CALL_LIST.loading}</p>
        ) : null}
      </div>
    );

  return (
    <main className={`calls-page${twoStep ? " two-step" : ""}${!twoStep && folded ? " folded" : ""}`} aria-label={CALLS_TEXT.heading} data-calls-page="">
      {showList && list}
      {showBeside && (
        <section className="mtg-view calls-beside" aria-label={adding ? CALLS_TEXT.add : "Call"} tabIndex={-1}>
          {!twoStep && folded && (
            <button type="button" className="mini quiet calls-show-list" data-calls-show="" onClick={() => fold(false)}>
              <Icon name="next" /> {CALL_LIST.showList}
            </button>
          )}
          {beside}
        </section>
      )}
    </main>
  );
}

/** The parts of a place that are the call's own (its view, line, filter, proposal), to keep when the list changes. */
const pick = (a: CallsAt): Omit<CallsAt, "occurrence" | "show" | "client"> => ({ ...(a.view ? { view: a.view } : {}), ...(a.line ? { line: a.line } : {}), ...(a.filter ? { filter: a.filter } : {}), ...(a.proposal ? { proposal: a.proposal } : {}) });

/** A fold at the list's foot (the Inbox's and the call page's own: a link button with its count, the body under it). */
function Fold({ id, title, sub, children }: { id: string; title: string; sub: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="calls-fold" data-calls-fold={id}>
      <button type="button" className="link-btn" aria-expanded={open} aria-controls={`calls-fold-${id}`} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? "open" : "closed"} /> {title}
      </button>
      {open && (
        <div id={`calls-fold-${id}`} className="calls-fold-body">
          <p className="muted">{sub}</p>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * One call in the list: two lines. First, when it started, its name and its state in words. Second, the client it is
 * about with its color (or No client yet), how long, how many people, where its transcript came from, and the weekly
 * mark on a registered call. The whole row is one button that opens the call beside the list.
 */
function CallRowButton({ r, open, colors, zone, onOpen, withDay }: { r: CallRow; open: boolean; colors: Record<string, string>; zone: string; onOpen: () => void; withDay?: string }) {
  const color = r.clientKey ? clientColor(r.clientKey, colors) : null;
  const bits = [r.clientName ?? CALL_LIST.noClient, lengthLabel(r.minutes), r.people !== null ? CALLS_TEXT.people(r.people) : null, r.source].filter(Boolean);
  return (
    <li>
      <button type="button" className={`calls-row${open ? " open" : ""}${r.state.needsMe ? " needs" : ""}`} aria-current={open ? "true" : undefined} data-call-row={r.key} data-bucket={r.bucket} onClick={onOpen} style={color ? ({ "--c": color } as CSSProperties) : undefined}>
        <span className="calls-row-one">
          <span className="calls-time">{withDay ? `${withDay} · ` : ""}{timeOf(r.startAt, zone)}</span>
          <span className="calls-name">{r.name}</span>
          <span className={`calls-state${r.state.needsMe ? " needs" : ""}`}>{r.state.label}</span>
        </span>
        <span className="calls-row-two">
          <span className={`swatch${color ? "" : " none"}`} aria-hidden="true" />
          <span className="calls-meta">{bits.join(" · ")}</span>
          {r.weekly && (
            <span className="calls-weekly">
              <RepeatMark />
              {CALL_LIST.weekly} · {r.weekly}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** "Tue, Nov 10 · 2:00 PM · 45 min": a call's day, start and length in my zone. */
const whenLine = (startAt: string, endAt: string, zone: string) => {
  const d = new Date(startAt);
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone })} · ${lengthLabel(Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000))}`;
};

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
function CallSetup({ call: c, clients, suggested, zone, pocket = [], onCancel, onStarted }: { call: OtherCallView; clients: CaptureClient[]; suggested: string | null; zone: string; /** MC-2b: my Pocket recordings that go with it. */ pocket?: ListedRecording[]; onCancel: () => void; onStarted: (occurrenceId: number, then: "teams" | "upload" | "none") => void }) {
  const [client, setClient] = useState(suggested ?? "");
  const [source, setSource] = useState<"teams" | "upload" | "pocket">(pocket.length ? "pocket" : c.teams ? "teams" : "upload");
  const [choice, setChoice] = useState<PocketChoice>(() => firstChoice(pocket));
  // The call kept by a first Continue whose Pocket recording asked again (no line times): the second goes to it.
  const [kept, setKept] = useState<number | null>(null);
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
      if (source === "pocket") {
        const id = kept ?? (await call<{ occurrenceId: number }>("meeting.call_start", { key: c.key, startAt: c.startAt, endAt: c.endAt, clientKey: client })).occurrenceId;
        setKept(id);
        const r = await bringPocket(id, choice);
        if (r.ask === "whole") return setChoice((x) => ({ ...x, whole: r.length ?? "" })), setBusy(false);
        if (r.ask === "replace") return setChoice((x) => ({ ...x, replace: true })), setBusy(false);
        return onStarted(id, "none");
      }
      const r = await call<{ occurrenceId: number; existed: boolean }>("meeting.call_start", { key: c.key, startAt: c.startAt, endAt: c.endAt, clientKey: client });
      onStarted(r.occurrenceId, source === "teams" && !r.existed ? "teams" : "upload");
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return (
    <div className="mtg-setup" role="region" aria-labelledby="mtg-setup-title" ref={ref} onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), e.stopPropagation(), onCancel())}>
      <h3 id="mtg-setup-title" tabIndex={-1}>{CALLS_TEXT.setupTitle(c.name)}</h3>
      <p className="muted">{whenLine(c.startAt, c.endAt, zone)} · {CALLS_TEXT.people(c.people)}</p>
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
        {pocket.length > 0 && (
          <label>
            <input type="radio" name="mtg-source" value="pocket" checked={source === "pocket"} onChange={() => setSource("pocket")} data-source="pocket" />
            <span><strong>{PW.source}</strong><span className="muted">{pocket.length === 1 ? `${pocket[0]!.title ? `${pocket[0]!.title} · ` : ""}${recordingLine(whenShort(pocket[0]!.startAt, zone), lengthLabel(pocket[0]!.minutes))}` : PW.pick}</span></span>
          </label>
        )}
      </fieldset>
      {source === "pocket" && <PocketFields recs={pocket} call={c} zone={zone} value={choice} onChange={setChoice} who={PW.seeCall} named />}
      {err && <p className="error-line" role="alert">{err}</p>}
      <span className="mtg-setup-actions">
        <button type="button" className="mini primary" disabled={busy || !client} onClick={() => void start()}>{busy ? "Starting…" : source === "pocket" && choice.replace ? PW.replaceYes : CALLS_TEXT.start}</button>
        <button type="button" className="mini quiet" disabled={busy} onClick={onCancel}>{CALLS_TEXT.cancel}</button>
      </span>
    </div>
  );
}

/** MC-2b: which of my recordings, which part of it, and what the server asked back (no line times, a transcript there). */
type PocketChoice = { id: string; part: "call" | "all"; whole: string | null; replace: boolean };
const firstChoice = (recs: readonly ListedRecording[]): PocketChoice => ({ id: recs[0]?.id ?? "", part: "call", whole: null, replace: false });
/** "Mon, Nov 16 · 10:58 AM": a recording's start in my zone. */
const whenShort = (iso: string, zone: string) => `${new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone })} · ${timeOf(iso, zone)}`;
const spanOf = (r: ListedRecording) => ({ id: r.id, startAt: r.startAt, seconds: (Date.parse(r.endAt) - Date.parse(r.startAt)) / 1000 });

/** One press of Continue with my Pocket recording: one call to Pocket on the server, or a question back. */
async function bringPocket(occurrenceId: number, v: PocketChoice): Promise<{ ask?: "whole" | "replace"; length?: string }> {
  const r = await call<{ ask?: "whole" | "replace"; length?: string }>("meeting.pocket_bring", { recordingId: v.id, occurrenceId, part: v.whole !== null ? "all" : v.part, ...(v.replace ? { replace: true } : {}) });
  return r.ask ? r : {};
}

/**
 * MC-2b: the setup's Pocket part: the recording (a choice when two go with the call, the longer overlap first), its
 * start and length, which part comes in when it runs more than 10 minutes past the call, what the server said back,
 * and who will see it, all before Continue.
 */
function PocketFields({ recs, call: c, zone, value, onChange, who, named = false }: { recs: readonly ListedRecording[]; call: { startAt: string; endAt: string }; zone: string; value: PocketChoice; onChange: (v: PocketChoice) => void; who: string; /** The one recording is already named above (the setup's source option). */ named?: boolean }) {
  const rec = recs.find((r) => r.id === value.id) ?? recs[0];
  if (!rec) return null;
  const longer = longerThanCall(spanOf(rec), c);
  return (
    <div className="mtg-pocket-pick" data-pocket-pick="">
      {recs.length > 1 && (
        <fieldset className="mtg-setup-source">
          <legend>{PW.pick}</legend>
          {recs.map((r) => (
            <label key={r.id}>
              <input type="radio" name="mtg-pocket-rec" checked={r.id === rec.id} onChange={() => onChange({ ...firstChoice([r]), replace: value.replace })} />
              <span><strong>{r.title || PW.rowKind}</strong><span className="muted">{recordingLine(whenShort(r.startAt, zone), lengthLabel(r.minutes))}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      {recs.length === 1 && !named && <p className="muted">{rec.title ? `${rec.title} · ` : ""}{recordingLine(whenShort(rec.startAt, zone), lengthLabel(rec.minutes))}</p>}
      {longer && value.whole === null && (
        <fieldset className="mtg-setup-source" data-pocket-part="">
          <legend>{PW.partAsk(lengthWords(spanOf(rec).seconds), lengthWords((Date.parse(c.endAt) - Date.parse(c.startAt)) / 1000))}</legend>
          <label>
            <input type="radio" name="mtg-pocket-part" checked={value.part === "call"} onChange={() => onChange({ ...value, part: "call" })} />
            <span>{PW.part}</span>
          </label>
          <label>
            <input type="radio" name="mtg-pocket-part" checked={value.part === "all"} onChange={() => onChange({ ...value, part: "all" })} />
            <span>{PW.all}</span>
          </label>
        </fieldset>
      )}
      {value.whole !== null && <p role="status" className="mtg-pocket-ask">{PW.whole(value.whole)}</p>}
      {value.replace && <p role="status" className="mtg-pocket-ask">{PW.replaceAsk}</p>}
      <p className="mtg-pocket-who" data-pocket-who="">{who} {PW.ai}</p>
    </div>
  );
}

/** MC-2b: a recording that goes with no call: a name (its title, mine to change), a client, and Continue. Only I see it. */
function PocketAddSetup({ rec, clients, suggested, zone, onCancel, onAdded }: { rec: ListedRecording; clients: CaptureClient[]; suggested: string | null; zone: string; onCancel: () => void; onAdded: (occurrenceId: number) => void }) {
  const [name, setName] = useState(rec.title);
  const [client, setClient] = useState(suggested && clients.some((x) => x.clientKey === suggested) ? suggested : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [kept, setKept] = useState<number | null>(null);
  const first = useRef<HTMLInputElement | null>(null);
  useEffect(() => first.current?.focus(), []);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const id = kept ?? (await call<{ occurrenceId: number }>("meeting.pocket_add", { recordingId: rec.id, name: name.trim(), clientKey: client })).occurrenceId;
      setKept(id);
      await bringPocket(id, { id: rec.id, part: "all", whole: null, replace: false });
      onAdded(id);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return (
    <form className="mtg-setup mtg-add" aria-labelledby="mtg-padd-title" onSubmit={(e) => (e.preventDefault(), void save())} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())} data-pocket-add="">
      <h3 id="mtg-padd-title">{PW.addTitle}</h3>
      <p className="muted">{PW.rowKind} · {recordingLine(whenShort(rec.startAt, zone), lengthLabel(rec.minutes))}</p>
      <div className="mtg-add-grid">
        <label>{PW.addName}<input ref={first} value={name} maxLength={200} required disabled={kept !== null} onChange={(e) => setName(e.target.value)} /></label>
        <span className="mtg-add-field"><label htmlFor="mtg-padd-client">{PW.addClient}</label><ClientPick id="mtg-padd-client" clients={clients} value={client} suggested={suggested} onChange={setClient} /></span>
      </div>
      <p className="mtg-pocket-who" data-pocket-who="">{PW.seeMe} {PW.ai}</p>
      {err && <p className="error-line" role="alert">{err}</p>}
      <span className="mtg-setup-actions">
        <button type="submit" className="mini primary" disabled={busy || !name.trim() || !client}>{busy ? PW.bringing : CALLS_TEXT.start}</button>
        <button type="button" className="mini quiet" disabled={busy} onClick={onCancel}>{CALLS_TEXT.cancel}</button>
      </span>
    </form>
  );
}

/** MC-2b: on a call I review with no transcript yet, my Pocket recordings that go with it, brought in on a press. */
function PocketBringBox({ recs, occ, series, zone, onDone }: { recs: readonly ListedRecording[]; occ: OccurrenceView; series: SeriesView; zone: string; onDone: () => Promise<void> }) {
  const [choice, setChoice] = useState<PocketChoice>(() => firstChoice(recs));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const who = series.call === "hand" ? PW.seeMe : series.call ? PW.seeCall : PW.seeClient;
  const bring = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await bringPocket(occ.id, choice);
      if (r.ask === "whole") setChoice((x) => ({ ...x, whole: r.length ?? "" }));
      else if (r.ask === "replace") setChoice((x) => ({ ...x, replace: true }));
      else await onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mtg-setup mtg-pocket-box" aria-labelledby="mtg-pocket-head" data-pocket-bring="">
      <h3 id="mtg-pocket-head">{PW.bringHead}</h3>
      <PocketFields recs={recs} call={occ} zone={zone} value={choice} onChange={setChoice} who={who} />
      {err && <p className="error-line" role="alert">{err}</p>}
      <span className="mtg-setup-actions">
        <button type="button" className="mini primary" disabled={busy} onClick={() => void bring()}>{busy ? PW.bringing : choice.replace ? PW.replaceYes : PW.bring}</button>
      </span>
    </section>
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
        <span className="mtg-add-field"><label htmlFor="mtg-add-client">{CALLS_TEXT.addClient}</label><ClientPick id="mtg-add-client" clients={clients} value={client} suggested={null} onChange={setClient} /></span>
      </div>
      {err && <p className="error-line" role="alert">{err}</p>}
      <span className="mtg-setup-actions">
        <button type="submit" className="mini primary" disabled={busy || !name.trim() || !client}>{busy ? "Adding…" : CALLS_TEXT.addSave}</button>
        <button type="button" className="mini quiet" disabled={busy} onClick={onCancel}>{CALLS_TEXT.cancel}</button>
      </span>
    </form>
  );
}

function ReviewScreen({ id, pocketRecs = [], zone, quiet = false, view, line, filter, focus, colors, today, undoable, onBack, onPlace, onChanged }: { id: number; /** MC-2b: my Pocket recordings that go with this call (from my last press). */ pocketRecs?: readonly ListedRecording[]; zone: string; /** MC-3: opened by Calls itself, not by the person: the focus stays where it was. */ quiet?: boolean; view: CallView | null; line: number | null; filter: Exclude<CallFilter, "all"> | null; focus: number | null; colors: Record<string, string>; today: string; undoable?: ((text: string, undo: () => Promise<unknown>) => void) | undefined; /** MC-3: only when the list and the call are two steps: Back to the list. */ onBack?: () => void; onPlace: (at?: CallPlace) => void; onChanged?: (() => void) | undefined }) {
  const w = useDevOpsWrite();
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
    if (quiet) return;
    if ((view !== "transcript" || !line) && !focus) document.querySelector<HTMLElement>(".mtg-view h2")?.focus();
  }, [r, view, line, focus, quiet]);
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

  if (error) return (<><BackHead onBack={onBack} title="Call" /><p className="error-line" role="alert">{error}</p></>);
  if (!r) return (<><BackHead onBack={onBack} title="Call" /><p className="muted">Loading…</p></>);
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
  const send = async (ps: Proposal[], o: { breakDown?: boolean } = {}) => {
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
      // RQ-1: Create and break down: once the feature is confirmed and written, Break down opens on it with Run
      // started. Cancelled or refused, nothing opens.
      const made = res.confirmed ? res.created?.[0] : undefined;
      const one = go[0]?.body;
      if (o.breakDown && made && one?.kind === "gap") openBreakDown(m.clientKey, { id: made.itemId, title: one.title, type: one.type, autoRun: true });
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
        <BackHead onBack={onBack} title={`Update ${m.clientName}'s plan`} sub={`${m.name} · ${dayLabel(o.date)}`} />
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
      {r.pocket && <p className="mtg-pocket-note" role="note">{r.pocketFrom ? `${r.pocketFrom === "mine" ? PW.fromMine : PW.fromReviewer} ${PW.unnamed}` : POCKET_TEXT.note}</p>}
      {view !== "transcript" && r.summary && r.summary.length > 0 && (
        // MC-2: what was discussed and decided, above the proposals, on every call.
        <section className="mtg-summary" aria-labelledby="mtg-summary-head">
          <h3 id="mtg-summary-head">{CALLS_TEXT.summary}</h3>
          <ul>{r.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </section>
      )}
      {view !== "transcript" && <p className="muted mtg-intro">
        {r.transcript ? (r.pocket ? `From the transcript (${r.transcript.lines} lines). ` : `From the transcript (${r.transcript.lines} lines, ${r.transcript.speakers} people). `) : ""}
        {editable && r.proposals.length === 0 ? "" : editable ? "Each row has its own button: new items and comments go to DevOps through the usual preview, promises are kept at once. Tick rows to do several together, or skip what isn't right." : m.call ? `Only ${m.reviewers.map((x) => x.name).join(", ")}, who asked FocusTime to review this call, can act on it. You can look.` : `Only this call's reviewers (${m.reviewers.map((x) => x.name).join(", ")}) can act on it. You can look.`}
        {editable && m.call ? ` ${m.call === "hand" ? CALLS_TEXT.whoSeesHand : CALLS_TEXT.whoSees}` : ""}
      </p>}
      {editable && !r.transcript && pocketRecs.length > 0 && <PocketBringBox key={pocketRecs.map((x) => x.id).join()} recs={pocketRecs} occ={o} series={m} zone={zone} onDone={load} />}
      {editable && <CallActions series={m} occ={o} onDone={load} focusUpload={view === "upload"} dropHere={!showUpload} dragging={dragging} />}
      {o.state === "failed" && (
        <section className="mtg-failed" role="status" aria-label={CALL_STATE.aiFailed}>
          <h3>{CALL_STATE.aiFailed}</h3>
          {o.aiMessage && <p>{o.aiMessage.replace(`${CALL_STATE.aiFailed}: `, "").replace(/^./, (c) => c.toUpperCase())}</p>}
          {o.aiNext && <p className="muted">{o.aiNext}</p>}
        </section>
      )}
      {note && <p className="error-line" role="alert">{note}</p>}
      {showUpload && <UploadBox series={m} occ={o} onDone={load} dragging={dragging} pocketOffered={editable && !r.transcript && pocketRecs.length > 0} />}
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
              {rows.map((p) => <ProposalRow key={p.id} p={p} check={checkOf(p)} err={rowErr[p.id] ?? null} ticked={ticked.has(p.id)} editable={editable} can={can} busy={busy} clientKey={m.clientKey} opts={opts} today={today} onTick={(on) => tick(p, on)} onEdit={(patch) => void edit(p, patch)} onSend={() => void send([p])} onSendBreakDown={() => void send([p], { breakDown: true })} onKeep={() => void keep([p])} onSkip={(on) => void skip([p], on)} onEnable={() => w?.enable(m.clientKey)} onShowLines={r.transcript ? (n) => onPlace({ view: "transcript", line: n }) : undefined} />)}
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

/**
 * A call's header. MC-3: Calls is a tab and the call sits beside the list, so Back shows only when the list and the
 * call are two steps (a narrow window, the phone); the browser's Back returns to where the call was opened from.
 */
function BackHead({ onBack, title, sub }: { onBack?: (() => void) | undefined; title: string; sub?: string }) {
  return (
    <header className="page-head">
      <div className="ph-title">
        {onBack && <button type="button" className="mini quiet" onClick={onBack} aria-label={CALL_LIST.back} data-calls-back=""><Icon name="back" /> {CALLS_TEXT.heading}</button>}
        {title && <h2 tabIndex={-1}>{title}</h2>}
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

function ProposalRow({ p, check, err, ticked, editable, can, busy, clientKey, opts, today, onTick, onEdit, onSend, onSendBreakDown, onKeep, onSkip, onEnable, onShowLines }: { p: Proposal; check: ProposalCheck | undefined; err: string | null; ticked: boolean; editable: boolean; can: boolean; busy: boolean; clientKey: string; opts: ReturnType<typeof useNewOptions>; today: string; onTick: (on: boolean) => void; onEdit: (patch: Record<string, unknown>) => void; onSend: () => void; onSendBreakDown?: () => void; onKeep: () => void; onSkip: (on: boolean) => void; onEnable: () => void; onShowLines?: ((line: number) => void) | undefined }) {
  const b = p.body;
  // RQ-1: a new item at the feature tier (the lowest portfolio level of the client's process, never a type's name).
  const featureTier = b.kind === "gap" && isFeatureTier(opts?.levels, b.type);
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
        {live && needs.length > 0 && <p id={`mtg-need-${p.id}`} className="mtg-need" role="status">{CALL_ROW.needs(needs.map((n) => n.name), b.kind === "gap" ? b.type : null)}</p>}
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
            <>
              <button type="button" className="mini primary" disabled={busy || stuck} aria-describedby={needs.length ? `mtg-need-${p.id}` : undefined} title={stuck ? "Fill in what's needed first" : "Opens the DevOps preview; nothing is written until you confirm it"} onClick={onSend}>{mainLabel}</button>
              {featureTier && onSendBreakDown && !failed && (
                <button type="button" className="mini" disabled={busy || stuck} aria-describedby={needs.length ? `mtg-need-${p.id}` : undefined} title={stuck ? "Fill in what's needed first" : CALL_ROW.createAndBreakDownWhy} onClick={onSendBreakDown}>{CALL_ROW.createAndBreakDown}</button>
              )}
            </>
          ) : (
            <button type="button" className="mini quiet dw-enable" onClick={onEnable} title="DevOps is read-only for this client until you add your own write PAT in Settings › DevOps">Enable DevOps writes</button>
          ))}
          {live && <button type="button" className="mini quiet" disabled={busy} onClick={() => onSkip(true)}>{CALL_ROW.skip}</button>}
          {p.state === "skipped" && <button type="button" className="mini quiet" disabled={busy} onClick={() => onSkip(false)}>{CALL_ROW.bringBack}</button>}
          {/* RQ-1: a feature created from this call can be broken down from its row. */}
          {p.state === "confirmed" && featureTier && b.kind === "gap" && p.result?.itemId ? <BreakDownButton clientKey={clientKey} item={{ id: p.result.itemId, title: b.title, type: b.type }} short /> : null}
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
  const [refused, setRefused] = useState(false);
  const fromTeams = async () => {
    setBusy("teams");
    setMsg(null);
    try {
      const r = await call<{ outcome: string; message: string }>("meeting.call_fetch", { occurrenceId: occ.id });
      setMsg(r.message);
      // After a refusal the upload is the way on: Teams is no longer the main button.
      setRefused(r.outcome !== "found");
      await onDone();
    } catch (e) {
      setRefused(true);
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
        {series.teams && !occ.hasTranscript && (
          <button type="button" className={`mini${!refused ? " primary" : ""}`} disabled={!!busy || up.busy} onClick={() => void fromTeams()} title={CALLS_TEXT.sourceTeamsHint}>
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

function UploadBox({ series, occ, onDone, dragging = false, pocketOffered = false }: { series: SeriesView; occ: OccurrenceView; onDone: () => Promise<void>; dragging?: boolean; /** MC-2b: my Pocket recording is offered above: no export tip. */ pocketOffered?: boolean }) {
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
        {series.call ? (series.teams ? "Download it from the meeting's recap in Teams, or ask the organizer to send it." : series.organizer === "other" ? "This call is organized outside Cooptimize, so FocusTime doesn't ask Teams for it. In Teams, open the meeting's recap and download the transcript; if you can't, ask the organizer to send it." : "Download it from the meeting's recap in Teams, or wherever it was recorded.") : series.source === "upload" ? "This call is organized outside Cooptimize, so FocusTime never reads it. In Teams, open the meeting's recap and download the transcript; if you can't, ask the organizer to send it." : "Download it from the meeting's recap in Teams."} {pocketOffered ? "" : `${POCKET_TEXT.pocketHow} `}{series.call === "hand" ? "It's kept 30 days, for you only." : series.call ? "It's kept 30 days, for you and the Cooptimizers on the invite only." : "It's kept 30 days, for this call's reviewers and attendees only."}
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
