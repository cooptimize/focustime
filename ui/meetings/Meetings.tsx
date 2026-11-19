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
import { openBreakDown } from "../menu.ts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { ActionRefusal, call, uploadMeetingTranscript } from "../api.ts";
import { useDevOpsWrite, type DevOpsChange } from "../DevOpsWrite.tsx";
import type { OccurrenceView, OtherCallView, SeriesView } from "../../plan/meeting-views.ts";
import type { CaptureClient } from "../../plan/capture.ts";
import { lengthLabel, OTHER_CALL_DAYS, suggestClient } from "../../plan/calls.ts";
import { callBatch, proposalWords, toReview, type Proposal } from "../../plan/meetings.ts";
import { rememberCallsList as remember, rememberedCallsList as remembered, requestFetch, requestRerun, takeFetch, takeRerun, takeReviewCall, type MineData } from "./calls.ts";
import { useMenu } from "../Menus.tsx";
import type { MenuItem, MenuStep } from "../menu.ts";
import { CALL_ACTIONS, CALL_BAR, CALL_FILTERS, CALL_LIST, CALL_ROW, CALL_STATE, CALLS_TEXT, ADD_TEXT, CHAT_NO_SPEAKERS, CLOSE_TEXT, FETCH_WORDS, LIST_TEXT, PAGE_TEXT, POCKET_TEXT, rerunLine, SECTION_HEAD, TRANSCRIPT_TEXT, type CallFilter, type FetchOutcome, type ProposalCheck } from "../../plan/call-words.ts";
import { callClientChoices, callRows, chipClients, closedAtOf, closedLine, closedList, outcomeOfCall, weekOf, filterCounts, firstToOpen, hiddenList, hiddenMissing, LIST_FILTERS, openList, otherRowKey, hideKeyOf, type CallHides, type CallRow, type CheckState, type Entry, type ListedRecording, type ListFilter, type SeriesEntry } from "../../plan/call-list.ts";
import { ClosedRow, HiddenRow, NeedsRow, SeriesRow, TickBar, WeekRow, whenOf, type RowStatus } from "./CallsList.tsx";
import { pocketRows } from "../../plan/call-list-pocket.ts";
import { POCKET_CALL_WORDS as PW, recordingLine } from "../../plan/pocket-words.ts";
import { PocketAddressForm } from "./PocketAddress.tsx";
import { goesWith, lengthWords, longerThanCall } from "../../plan/pocket-match.ts";
import type { PocketView } from "../../actions/pocket-types.ts";
import type { PocketListView as PocketList } from "../../actions/pocket-types.ts";
import type { CallsAt } from "../nav.ts";
import { globalKeyAllowed, isTypingTarget, topOverlay } from "../keys.ts";
import { useNarrow } from "../PanelShell.tsx";
import { clientColor } from "../labels.ts";
import { Icon } from "../icons.tsx";
import { forgetCallOptions, useNewOptions } from "./GapFields.tsx";
import { opensItself, ProposalRow } from "./Proposal.tsx";
import "./calls.css";

type Review = { meeting: SeriesView; occurrence: OccurrenceView; proposals: Proposal[]; transcript: { lines: number; speakers: number } | null; /** MC-2: what was said (at most 5 lines); null before MC-2 or once the transcript is gone. */ summary?: string[] | null; /** PK-1: from a Pocket export: numbered speakers, no times. */ pocket?: boolean; /** MC-2b: brought in from a Pocket recording: by me, or by another reviewer. */ pocketFrom?: "mine" | "reviewer" | null; /** MC-2c: Teams gave a chat call's transcript without speaker names. */ noSpeakers?: boolean; canConfirm: boolean; canWrite: boolean; checks: Record<string, ProposalCheck> };

const errText = (e: unknown) => (e instanceof ActionRefusal || e instanceof Error ? e.message : "Something went wrong");
const dayLabel = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
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
  /** MC-5: now (the app's clock), for Add a call's start. */
  nowMs?: number;
};

/** MC-3: the Calls tab: the list by day on the left, the open call (or its setup, or Add a call) beside it. */
export function CallsPage({ at, onGo, onChanged, colors, today, zone, phone = false, undoable, clients = [], blockClientAt = () => null, nowMs = Date.now() }: CallsPageProps) {
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
  // MC-2b: whether my Pocket is connected (what FocusTime kept; Pocket isn't asked), and my last list, in this page's
  // memory only while Calls is open. PK-4: the list is asked for as Calls opens, on Refresh and on Check Pocket again;
  // the server answers from its 5-minute hold when it can.
  const [pocketOn, setPocketOn] = useState<boolean | null>(null);
  const [pocket, setPocket] = useState<PocketList | null>(null);
  const [pocketBusy, setPocketBusy] = useState(false);
  const [pocketErr, setPocketErr] = useState<string | null>(null);
  const [addressOpen, setAddressOpen] = useState(false);
  const [pocketNote, setPocketNote] = useState<string | null>(null);
  // MC-4: which of my calendar's calls have a transcript in Teams (this page's memory only, while Calls is open), my
  // hides, the ticked rows, Review from a row's progress, the repeating meetings opened and the client I chose on a row.
  const [check, setCheck] = useState<Record<string, CheckState> | null>(null);
  const [checkInfo, setCheckInfo] = useState<{ failed: boolean; off: boolean; unchecked: number; busy: boolean }>({ failed: false, off: false, unchecked: 0, busy: false });
  const [hides, setHides] = useState<CallHides | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [chosen, setChosen] = useState<Record<string, string>>({});
  // MC-5: tick boxes show only once Select calls is chosen in the header's menu.
  const [selecting, setSelecting] = useState(false);
  // MC-5: a recording chosen in Add a call for a listed call it fits (Review that call): chosen there to start.
  const [startRec, setStartRec] = useState<{ key: string; id: string } | null>(null);
  const getPocket = useCallback(async () => {
    setPocketBusy(true);
    setPocketErr(null);
    try {
      setPocket(await call<PocketList>("meeting.pocket_list", {}));
    } catch (e) {
      // One quiet line at the list's head; the list and Teams' marks show without it.
      setPocketErr(errText(e));
    } finally {
      setPocketBusy(false);
    }
  }, []);
  useEffect(() => {
    // PK-4: with Pocket connected, my recordings are asked for as Calls opens (never on a schedule).
    void call<PocketView>("pocket.status", {}).then(
      (v) => (setPocketOn(v.connected), v.connected ? void getPocket() : undefined),
      () => setPocketOn(false),
    );
  }, [getPocket]);
  /** MC-4: asks Teams which calls have a transcript: as Calls opens, on Refresh (refresh), or the next ones (more). */
  const runCheck = useCallback(async (o: { refresh?: boolean; more?: boolean } = {}) => {
    setCheckInfo((c) => ({ ...c, busy: true }));
    try {
      const d = await call<{ answers: Record<string, CheckState>; unchecked: number; off: boolean; failed: boolean }>("meeting.calls_check", o);
      setCheck((c) => ({ ...(o.refresh ? {} : c ?? {}), ...d.answers }));
      setCheckInfo({ failed: d.failed, off: d.off, unchecked: d.unchecked, busy: false });
    } catch {
      // The list still shows; one quiet line says the check failed, with Check again.
      setCheck((c) => c ?? {});
      setCheckInfo((c) => ({ ...c, failed: true, busy: false }));
    }
  }, []);
  const loadHides = useCallback(() => call<{ keys: string[]; series: string[] }>("meeting.call_hides", {}).then((h) => setHides({ keys: new Set(h.keys), series: new Set(h.series) }), () => setHides({ keys: new Set(), series: new Set() })), []);
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
    void loadHides();
    let live = true;
    void loadOthers().then((d) => {
      // MC-4: once my calendar's calls are read, Teams is asked which have a transcript (never on a schedule).
      if (live && d) void runCheck();
      const want = asked;
      if (!live || !want) return;
      // WK-6: by the meeting itself when its key is known, else by its start and end.
      const hit = (want.key ? d?.calls.find((c) => c.key === want.key) : undefined) ?? d?.calls.find((c) => Date.parse(c.startAt) === Date.parse(want.start) && Date.parse(c.endAt) === Date.parse(want.end));
      // Found: wanted stays set, so nothing opens by itself in its place. A render already committed (the calendar's
      // calls arriving) can run its effects after this and before the setup's own render; it must still see a call wanted.
      if (hit?.occurrenceId) go({ occurrence: hit.occurrenceId });
      else if (hit) setSetupKey(otherRowKey(hit));
      else (wanted.current = null), setMissing(true);
    });
    return () => {
      live = false;
    };
    // Once, as Calls opens (loadMine, loadOthers and go never change; asked is taken once).
  }, [loadMine, loadOthers, loadHides, runCheck, go, asked]);

  // The list's filter and client: the address's, else the ones this browser remembered (written into the address).
  const show: ListFilter = at.show ?? "open";
  const client = at.client ?? null;
  useEffect(() => {
    if (at.show !== undefined || at.client !== undefined) return remember(at.show, at.client);
    const r = remembered();
    if (r.show || r.client !== undefined) go({ ...r, occurrence: atRef.current.occurrence, ...pick(atRef.current) }, true);
  }, [at.show, at.client, go]);

  /** A filter or client chosen: remembered at once (so an address without them doesn't bring back the old ones). */
  const setList = (f: ListFilter, c: string | null) => {
    remember(f, c ?? undefined);
    onGoRef.current({ occurrence: at.occurrence, ...pick(at), ...(f !== "open" ? { show: f } : {}), ...(c !== null ? { client: c } : {}) });
  };
  // Without the calls FocusTime keeps there is no list: my calendar's calls alone would read as nothing to review.
  // MC-4: a calendar call's client is only a suggestion: from its title, else its focus block, but never from the block
  // when everyone on it is at Cooptimize ("Which client?").
  const suggest = useCallback((c: OtherCallView) => suggestClient(c.name, clients, blockClientAt(c.startAt), c.allHome), [clients, blockClientAt]);
  const rows = useMemo(() => (data ? callRows({ meetings: data.meetings, occurrences: data.occurrences, others: others?.calls ?? null, today, zone, addPocket: pocketRows(pocket?.recordings ?? null, zone), check, hides, suggest }) : []), [data, others, today, zone, pocket, check, hides, suggest]);
  const gone = useMemo(() => hiddenMissing(rows, hides), [rows, hides]);
  // MC-5: my recordings from the list already held, newest first, that aren't yet a call's transcript (one that goes with
  // a call that has a transcript is taken to be its), each with the listed call it fits.
  const recChoices = useMemo<RecChoice[]>(() => {
    const done = (data?.occurrences ?? []).filter((o) => o.hasTranscript);
    return (pocket?.recordings ?? [])
      .filter((x) => !done.some((o) => goesWith(spanOf(x), o)) && !hides?.keys.has(`pocket:${x.id}`))
      .map((x) => ({ rec: x, fits: rows.find((r) => r.bucket !== "hidden" && r.pocket.some((p) => p.id === x.id)) ?? null }));
  }, [pocket, data, rows, hides]);
  const goneCount = gone.keys.length + gone.series.length;
  const counts = useMemo(() => filterCounts(rows, client, goneCount, hides?.series), [rows, client, goneCount, hides]);
  const nameOfClient = useCallback((k: string) => clients.find((c) => c.clientKey === k)?.clientName ?? k, [clients]);
  const chips = useMemo(() => chipClients(rows, nameOfClient), [rows, nameOfClient]);
  const open = useMemo(() => openList(rows, client, today), [rows, client, today]);
  const setupRow = setupKey ? rows.find((r) => r.key === setupKey && (r.other || r.recording)) ?? null : null;
  const clientOn = (r: CallRow) => chosen[r.key] ?? r.suggested;
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
    requestAnimationFrame(() => document.querySelector<HTMLElement>(on ? "[data-calls-show]" : "[data-calls-menu] button")?.focus());
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
      if (e.key === "x") {
        const k = t?.closest<HTMLElement>("[data-calls-list] [data-call-row]")?.getAttribute("data-call-row");
        if (k) (e.preventDefault(), xRef.current(k));
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

  // ---- MC-4: Hide, Put back, Skip all and close, Review from a row, ticks ----
  const say = (e: unknown) => setRowStatus((x) => ({ ...x, _page: { busy: null, error: errText(e), occurrenceId: null } }));
  const hideItems = async (items: { keys?: string[]; series?: string[] }, text: string) => {
    try {
      await call("meeting.call_hide", items);
      await loadHides();
      setTicked(new Set());
      undoable?.(text, async () => {
        await call("meeting.call_unhide", items);
        await loadHides();
      });
    } catch (e) {
      say(e);
    }
  };
  const putBack = async (items: { keys?: string[]; series?: string[] }) => {
    try {
      await call("meeting.call_unhide", items);
      await loadHides();
    } catch (e) {
      say(e);
    }
  };
  const hideRows = (rs: readonly CallRow[]) => {
    const keys = rs.map(hideKeyOf).filter((k): k is string => !!k);
    if (keys.length) void hideItems({ keys }, CLOSE_TEXT.hidden(keys.length));
  };
  // MC-4: bumped when the list closes or reopens calls, so a call's page open beside it reads itself again.
  const [closedStamp, setClosedStamp] = useState(0);
  const skipAllCalls = async (ids: readonly number[]) => {
    if (!ids.length) return;
    try {
      const d = await call<{ calls: { occurrenceId: number; skipped: { id: number; was: "open" | "failed" }[] }[] }>("meeting.skip_all", { occurrenceIds: ids });
      setTicked(new Set());
      await loadMine();
      changed();
      setClosedStamp((n) => n + 1);
      // One call closed from the list: its closed page is what shows beside it, not the next call in line.
      if (ids.length === 1 && !narrow) go({ occurrence: ids[0]! }, true);
      const items = d.calls.flatMap((c) => c.skipped);
      undoable?.(ids.length === 1 ? LIST_TEXT.skippedClosed(items.length) : LIST_TEXT.skippedClosedMany(ids.length, items.length), async () => {
        if (items.length) await call("meeting.unskip_all", { items });
        await loadMine();
        changed();
        setClosedStamp((n) => n + 1);
      });
    } catch (e) {
      say(e);
    }
  };
  /** Review from a row: with a client and a Teams transcript, the transcript is fetched and read with no setup; else the setup or the client choice. */
  const reviewRow = async (r: CallRow) => {
    const c = r.other;
    const key = clientOn(r);
    if (!c || r.recording || !key || r.check !== "yes") return openRow(r);
    setRowStatus((x) => ({ ...x, [r.key]: { busy: CLOSE_TEXT.reviewing, error: null, occurrenceId: null } }));
    let occ: number | null = null;
    try {
      occ = (await call<{ occurrenceId: number }>("meeting.call_start", { key: c.key, startAt: c.startAt, endAt: c.endAt, clientKey: key })).occurrenceId;
      const f = await call<{ outcome: string; message: string }>("meeting.call_fetch", { occurrenceId: occ });
      changed();
      if (f.outcome !== "found") {
        setRowStatus((x) => ({ ...x, [r.key]: { busy: null, error: FETCH_WORDS[f.outcome as Exclude<FetchOutcome, "found">] ?? f.message, occurrenceId: occ } }));
        await loadMine();
        return;
      }
      setRowStatus((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== r.key)));
      await Promise.all([loadMine(), loadOthers()]);
      fromList.current = narrow;
      go({ occurrence: occ });
    } catch (e) {
      setRowStatus((x) => ({ ...x, [r.key]: { busy: null, error: errText(e), occurrenceId: occ } }));
    }
  };
  const tickRow = (k: string, on: boolean) => setTicked((t) => { const n = new Set(t); if (on) n.add(k); else n.delete(k); return n; });
  const tickedRows = rows.filter((r) => ticked.has(r.key) && r.bucket === "open");
  const tickedHide = tickedRows.filter((r) => !!hideKeyOf(r));
  const tickedClose = tickedRows.filter((r) => r.occurrenceId !== null && r.left?.open);
  const seriesTicked = (e: SeriesEntry) => e.rows.every((r) => ticked.has(r.key));
  // MC-5: X skips all and closes at once; the app's own message says what it did, with Undo (no browser dialog).
  const askSkipAll = (r: CallRow) => {
    if (!r.occurrenceId || !r.left?.open) return;
    void skipAllCalls([r.occurrenceId]);
  };
  /** MC-5: Needs you's one button: the call's page with its transcript choice, or the failed pass tried again there. */
  const rowAction = (r: CallRow, kind: "upload" | "pocket" | "retry") => {
    if (!r.occurrenceId) return;
    if (kind === "retry") requestRerun(r.occurrenceId);
    setAdding(false);
    setSetupKey(null);
    fromList.current = narrow;
    go({ occurrence: r.occurrenceId, ...(kind === "upload" ? { view: "upload" as const } : {}) });
  };
  // X: hides the row in focus, or on a call with proposals skips all and closes it (with Undo). Never while typing.
  const xRef = useRef<(k: string) => void>(() => {});
  xRef.current = (k: string) => {
    const r = rows.find((x) => x.key === k);
    if (!r || r.bucket !== "open") return;
    if (r.occurrenceId !== null) askSkipAll(r);
    else if (r.other) hideRows([r]);
  };
  const weekRow = (r: CallRow, inSeries = false) => (
    <WeekRow key={r.key} r={r} open={openKey === r.key} zone={zone} today={today} colors={colors} selecting={selecting} ticked={ticked.has(r.key)} onTick={(on) => tickRow(r.key, on)} onOpen={() => void reviewRow(r)}
      clients={clients} client={clientOn(r)} onClient={(k) => setChosen((x) => ({ ...x, [r.key]: k }))} onHide={() => hideRows([r])}
      status={rowStatus[r.key] ?? null} onUpload={() => { const st = rowStatus[r.key]; if (st?.occurrenceId) go({ occurrence: st.occurrenceId, view: "upload" }); }} inSeries={inSeries} />
  );
  const entryRow = (e: Entry, label: string) => e.kind === "one" ? weekRow(e.row) : (
    <SeriesRow key={e.key} e={e} weekLabel={label} expanded={expanded.has(e.key)} onExpand={(on) => setExpanded((x) => { const n = new Set(x); if (on) n.add(e.key); else n.delete(e.key); return n; })}
      onHideEvery={() => void hideItems({ series: [e.seriesKey] }, CLOSE_TEXT.hiddenEvery(e.name))} onHideWeek={() => hideRows(e.rows)}
      selecting={selecting} ticked={seriesTicked(e)} onTick={(on) => setTicked((t) => { const n = new Set(t); for (const r of e.rows) if (on) n.add(r.key); else n.delete(r.key); return n; })}>
      {e.rows.map((r) => weekRow(r, true))}
    </SeriesRow>
  );
  const closedRows = show === "closed" ? closedList(rows, client) : [];
  const hiddenRows = show === "hidden" ? hiddenList(rows, client) : [];
  const nothingHere = show === "open" ? !open.needs.length && !open.weeks.length && !open.foldCount : show === "closed" ? !closedRows.length : !hiddenRows.length && !goneCount;

  // MC-5: the header's dots menu: Refresh, Check Pocket (with when it was last checked), Select calls, Hide the list.
  const headMenu = useMenu((): MenuStep => ({
    title: CALLS_TEXT.heading,
    items: [
      { id: "calls-refresh", label: LIST_TEXT.refresh, icon: "refresh", ...(checkInfo.busy ? { disabled: CLOSE_TEXT.reviewing } : {}), run: () => (void loadOthers(), void runCheck({ refresh: true }), pocketOn ? void getPocket() : undefined) },
      ...(pocketOn ? [{ id: "calls-pocket", label: LIST_TEXT.checkPocket, icon: "mic" as const, ...(pocket ? { hint: LIST_TEXT.checkedAt(timeOf(pocket.at, zone)) } : {}), ...(pocketBusy ? { disabled: PW.getting } : {}), run: () => (setPocketNote(null), void getPocket()) }] : []),
      { id: "calls-select", label: selecting ? LIST_TEXT.selectDone : LIST_TEXT.select, run: () => (setSelecting((x) => !x), setTicked(new Set())) },
      ...(!twoStep ? [{ id: "calls-hide-list", label: LIST_TEXT.hideList, run: () => fold(true) }] : []),
    ],
  }));
  const list = (
    <section className="calls-list" aria-labelledby="calls-title" data-calls-list="" ref={listRef}>
      <header className="calls-head">
        <div className="calls-title">
          <h1 id="calls-title" title={LIST_TEXT.headingHint}>{CALLS_TEXT.heading}</h1>
        </div>
        <span className="calls-head-actions">
          <button type="button" className="mini" onClick={() => (setSetupKey(null), setAdding(true), at.occurrence ? go({ occurrence: null }) : undefined)} aria-expanded={adding} data-calls-add="">{CALLS_TEXT.add}</button>
          <span data-calls-menu="">{headMenu.button(LIST_TEXT.menu)}</span>
        </span>
      </header>
      {data && (
        <div className="seg calls-filters" role="group" aria-label="Show">
        {LIST_FILTERS.map((f) => (
          <button key={f} type="button" className={`seg-btn${show === f ? " on" : ""}`} aria-pressed={show === f} title={f === "hidden" ? `${CALL_LIST.filterHint[f]}. ${LIST_TEXT.hiddenHint}` : CALL_LIST.filterHint[f]} onClick={() => setList(f, client)} data-calls-filter={f}>
            {CALL_LIST.filters[f]}{counts[f] > 0 && <> <span className="seg-count">{counts[f]}</span></>}
          </button>
        ))}
      </div>
      )}
      {data && chips.length > 1 && (
        // MC-5: one row labelled Client: All, each client with its square, then No client only when some call has none.
        <div className="ib4-chips calls-chips" role="group" aria-labelledby="calls-client-label">
          <span id="calls-client-label" className="calls-chips-label">{LIST_TEXT.client}</span>
          <button type="button" className={`ib4-chip${client === null ? " on" : ""}`} aria-pressed={client === null} onClick={() => setList(show, null)}>
            {LIST_TEXT.all}
          </button>
          {chips.map((c) => (
            <button key={c.key || "none"} type="button" className={`ib4-chip${client === c.key ? " on" : ""}${c.key ? "" : " ib4-chip-none"}`} aria-pressed={client === c.key} onClick={() => setList(show, client === c.key ? null : c.key)} style={c.key ? ({ "--c": clientColor(c.key, colors) } as CSSProperties) : undefined} data-chip={c.key ? undefined : "no-client"}>
              {c.key && <span className="swatch calls-sq" aria-hidden="true" />}
              {c.key ? c.name : LIST_TEXT.noClient}
            </button>
          ))}
        </div>
      )}
      {data && pocketOn === false && (
        <p className="calls-pocket muted" data-calls-pocket=""><a href="#/settings/connections/pocket">{LIST_TEXT.connect}</a></p>
      )}
      {data && pocketOn && (pocketErr || (pocket && (pocket.counts.address > 0 || pocket.more)) || addressOpen || pocketNote) && (
        // MC-5: Pocket's one quiet line, only when there is something to do (its counts are in Settings › Connections › Pocket).
        <div className="calls-pocket" data-calls-pocket="">
          {pocketErr ? (
            <span className="muted" role="status" title={pocketErr} data-pocket-failed="">
              {LIST_TEXT.pocketFailed} <button type="button" className="link-btn" disabled={pocketBusy} onClick={() => void getPocket()}>{LIST_TEXT.checkAgain}</button>
            </span>
          ) : pocket && pocket.counts.address > 0 && !addressOpen ? (
            <span className="muted" role="status" data-pocket-line="">
              {pocketNote ? `${pocketNote} ` : ""}{LIST_TEXT.leftOut(pocket.counts.address)}{" "}
              {pocket.canSetAddress && <button type="button" className="link-btn" onClick={() => (setPocketNote(null), setAddressOpen(true))} data-pocket-set-address="">{LIST_TEXT.setAddress}</button>}
            </span>
          ) : pocketNote && !addressOpen ? (
            <span className="muted" role="status" data-pocket-line="">{pocketNote}</span>
          ) : null}
          {/* Something to know: Pocket had more than FocusTime reads at once. */}
          {!pocketErr && pocket?.more && !addressOpen && <span className="muted" role="status" data-pocket-more="">{PW.more}</span>}
          {addressOpen && (
            <PocketAddressForm
              onCancel={() => setAddressOpen(false)}
              onSaved={() => (setAddressOpen(false), setPocketNote(PW.addressSaved), void getPocket())}
            />
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
        ) : rows.length > 0 && nothingHere ? (
          <p className="muted calls-note">{CALL_LIST.noneHere}</p>
        ) : null}
        {show === "open" && checkInfo.failed && (
          <p className="muted calls-note calls-check-line" role="status" data-calls-check="failed">
            {CLOSE_TEXT.checkFailed} <button type="button" className="link-btn" onClick={() => void runCheck({ refresh: true })}>{CLOSE_TEXT.checkAgain}</button>
          </p>
        )}
        {show === "open" && checkInfo.off && <p className="muted calls-note calls-check-line" role="status" data-calls-check="off">{CLOSE_TEXT.tenantOff}</p>}
        {show === "open" && !checkInfo.failed && checkInfo.unchecked > 0 && (
          <p className="muted calls-note calls-check-line" role="status" data-calls-check="more">
            {CLOSE_TEXT.notChecked(checkInfo.unchecked)} <button type="button" className="link-btn" disabled={checkInfo.busy} onClick={() => void runCheck({ more: true })}>{CLOSE_TEXT.checkMore(Math.min(40, checkInfo.unchecked))}</button>
          </p>
        )}
        {rowStatus._page?.error && <p className="error-line calls-note" role="alert">{rowStatus._page.error}</p>}
        {selecting && ticked.size > 0 && <TickBar hide={tickedHide.length} close={tickedClose.length} onHide={() => hideRows(tickedHide)} onClose={() => void skipAllCalls(tickedClose.map((r) => r.occurrenceId!))} onClear={() => setTicked(new Set())} onDone={() => (setSelecting(false), setTicked(new Set()))} />}
        {show === "open" && open.needs.length > 0 && (
          <section className="calls-day calls-needs" aria-labelledby="calls-needs" data-section="needs">
            <h2 id="calls-needs" className="calls-day-head">{CLOSE_TEXT.needs} <span className="calls-head-count">{open.needs.length}</span></h2>
            <ul className="calls-rows calls-cards">
              {open.needs.map((r) => <NeedsRow key={r.key} r={r} open={openKey === r.key} zone={zone} today={today} colors={colors} selecting={selecting} phone={phone} ticked={ticked.has(r.key)} onTick={(on) => tickRow(r.key, on)} onOpen={() => openRow(r)} onAction={(k) => rowAction(r, k)} onSkipAll={() => void skipAllCalls([r.occurrenceId!])} />)}
            </ul>
          </section>
        )}
        {show === "open" && open.weeks.map((w) => (
          <section key={w.week} className="calls-day" aria-labelledby={`calls-week-${w.week}`} data-section={`week-${w.week}`}>
            <h2 id={`calls-week-${w.week}`} className="calls-day-head">
              {w.label}
              {w.closed > 0 && <button type="button" className="link-btn calls-head-note" onClick={() => setList("closed", client)}>{CLOSE_TEXT.closedCount(w.closed)}</button>}
              {w.stillOpen > 0 && <span className="calls-head-note amber" data-still-open="">{CLOSE_TEXT.stillOpen(w.stillOpen)}</span>}
            </h2>
            {w.entries.length > 0 && <ul className="calls-rows">{w.entries.map((e) => entryRow(e, w.label))}</ul>}
          </section>
        ))}
        {show === "open" && open.foldCount > 0 && (
          <Fold id="no-transcript" title={CLOSE_TEXT.fold(open.foldCount)} hint={LIST_TEXT.foldHint}>
            <ul className="calls-rows">{open.fold.map((e) => entryRow(e, ""))}</ul>
          </Fold>
        )}
        {show === "closed" && closedRows.length > 0 && (
          <ul className="calls-rows" data-section="closed">
            {closedRows.map((r) => <ClosedRow key={r.key} r={r} open={openKey === r.key} zone={zone} today={today} colors={colors} onOpen={() => openRow(r)} />)}
          </ul>
        )}
        {show === "hidden" && (
          <>
            {hiddenRows.length > 0 && (
              <ul className="calls-rows" data-section="hidden">
                {hiddenRows.flatMap((r, i) => {
                  const every = !!r.seriesKey && !!hides?.series.has(r.seriesKey);
                  // A series hidden for every one is one row, at its newest call.
                  if (every && hiddenRows.findIndex((x) => x.seriesKey === r.seriesKey) !== i) return [];
                  const count = every ? hiddenRows.filter((x) => x.seriesKey === r.seriesKey).length : 1;
                  return [<HiddenRow key={r.key} r={r} every={every} count={count} zone={zone} today={today} onPutBack={() => void putBack(every ? { series: [r.seriesKey!] } : { keys: [hideKeyOf(r)!] })} />];
                })}
              </ul>
            )}
            {goneCount > 0 && client === null && (
              <p className="muted calls-note" data-hidden-gone="">
                {CLOSE_TEXT.hiddenGone(goneCount)} <button type="button" className="link-btn" onClick={() => void putBack({ ...(gone.keys.length ? { keys: gone.keys } : {}), ...(gone.series.length ? { series: gone.series } : {}) })}>{CLOSE_TEXT.putBackAll}</button>
              </p>
            )}
          </>
        )}
        {data && !othersErr && !others && <p className="muted calls-note" role="status">{CALL_LIST.loading}</p>}
        {data && (
          <Fold id="client-calls" title={CALL_LIST.clientCalls(registered.length)} hint={CALL_LIST.clientCallsSub}>
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
      </div>
    </section>
  );

  let beside: React.ReactNode;
  if (adding)
    beside = (
      <div className="calls-beside-pad">
        <AddCall clients={clients} today={today} nowMs={nowMs} zone={zone} pocketOn={pocketOn} recs={recChoices}
          onCancel={() => (setAdding(false), requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-calls-add]")?.focus()))}
          onAdded={(id, file) => (setAdding(false), (uploadFor = file ? { occurrenceId: id, file } : null), changed(), go({ occurrence: id }))}
          onReviewThat={(row, recId) => (setAdding(false), setStartRec({ key: row.key, id: recId }), openRow(row))} />
      </div>
    );
  else if (at.occurrence)
    beside = <ReviewScreen key={`${at.occurrence}:${closedStamp}`} pocketRecs={rows.find((x) => x.occurrenceId === at.occurrence)?.pocket ?? []} anyRecs={recChoices.map((x) => x.rec)} phone={phone} startRec={startRec?.key === `o${at.occurrence}` ? startRec.id : null} pocketOn={pocketOn} people={rows.find((x) => x.occurrenceId === at.occurrence)?.people ?? null} zone={zone} quiet={openedByItself.current === at.occurrence} id={at.occurrence} view={at.view ?? null} line={at.line ?? null} filter={at.filter ?? null} focus={at.proposal ?? null} colors={colors} today={today} undoable={undoable} {...(twoStep ? { onBack: backToList } : {})} onPlace={(p) => go({ occurrence: at.occurrence, ...p })} onChanged={changed} />;
  else if (setupRow?.other)
    beside = (
      <div className="calls-beside-pad">
        {twoStep && <BackHead onBack={backToList} title="" />}
        <CallSetup
          key={setupRow.key}
          call={setupRow.other}
          clients={clients}
          suggested={clientOn(setupRow)}
          zone={zone}
          pocket={setupRow.pocket}
          startRec={startRec?.key === setupRow.key ? startRec.id : null}
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
        {loaded && !rows.length ? (
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
function Fold({ id, title, hint, children }: { id: string; title: string; /** MC-5: what the line under it said, now on its hover. */ hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="calls-fold" data-calls-fold={id}>
      <button type="button" className="link-btn" aria-expanded={open} aria-controls={`calls-fold-${id}`} title={hint} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? "open" : "closed"} /> {title}
      </button>
      {open && (
        <div id={`calls-fold-${id}`} className="calls-fold-body">
          {children}
        </div>
      )}
    </div>
  );
}


/** "Tue, Nov 10 · 2:00 PM · 45 min": a call's day, start and length in my zone. */
const whenLine = (startAt: string, endAt: string, zone: string) => {
  const d = new Date(startAt);
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone })} · ${lengthLabel(Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000))}`;
};

/** MC-2c: a chat call's day, start and end ("Tue, Nov 10 · 2:00 PM to 2:45 PM"), or its start alone when its end isn't known. */
const chatWhen = (c: Pick<OtherCallView, "startAt" | "endAt" | "endKnown">, zone: string) => {
  const d = new Date(c.startAt);
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone })} · ${t(c.startAt)}${c.endKnown ? ` to ${t(c.endAt)}` : ""}`;
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
function CallSetup({ call: c, clients, suggested, zone, pocket = [], startRec = null, onCancel, onStarted }: { call: OtherCallView; clients: CaptureClient[]; suggested: string | null; zone: string; /** MC-2b: my Pocket recordings that go with it. */ pocket?: ListedRecording[]; /** MC-5: the recording chosen in Add a call. */ startRec?: string | null; onCancel: () => void; onStarted: (occurrenceId: number, then: "teams" | "upload" | "none") => void }) {
  const [client, setClient] = useState(suggested ?? "");
  const [source, setSource] = useState<"teams" | "upload" | "pocket">(pocket.length ? "pocket" : c.teams ? "teams" : "upload");
  const [choice, setChoice] = useState<PocketChoice>(() => firstChoice(pocket.filter((r) => !startRec || r.id === startRec).concat(pocket)));
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
      {/* MC-2c: a chat call: its start and end (or its start alone), where it came from, never a people count. */}
      <p className="muted">{c.chat ? `${chatWhen(c, zone)} · ${CALL_LIST.fromChat}` : `${whenLine(c.startAt, c.endAt, zone)} · ${CALLS_TEXT.people(c.people)}`}</p>
      <label className="mtg-setup-field" htmlFor="mtg-setup-client">{CALLS_TEXT.setupClient}</label>
      <ClientPick id="mtg-setup-client" clients={callClientChoices(clients, c.chat)} value={client} suggested={suggested} onChange={setClient} />
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
async function bringPocket(occurrenceId: number, v: PocketChoice, move = false): Promise<{ ask?: "whole" | "replace"; length?: string }> {
  const r = await call<{ ask?: "whole" | "replace"; length?: string }>("meeting.pocket_bring", { recordingId: v.id, occurrenceId, part: v.whole !== null ? "all" : v.part, ...(v.replace ? { replace: true } : {}), ...(move ? { move: true } : {}) });
  return r.ask ? r : {};
}

/**
 * MC-2b: the setup's Pocket part: the recording (a choice when two go with the call, the longer overlap first), its
 * start and length, which part comes in when it runs more than 10 minutes past the call, what the server said back,
 * and who will see it, all before Continue.
 */
function PocketFields({ recs, call: c, zone, value, onChange, who, named = false, listed = false }: { recs: readonly ListedRecording[]; call: { startAt: string; endAt: string }; zone: string; value: PocketChoice; onChange: (v: PocketChoice) => void; who: string; /** The one recording is already named above (the setup's source option). */ named?: boolean; /** MC-5: every recording as a choice with its title, when and length, even one alone. */ listed?: boolean }) {
  const rec = recs.find((r) => r.id === value.id) ?? recs[0];
  if (!rec) return null;
  const longer = longerThanCall(spanOf(rec), c);
  return (
    <div className="mtg-pocket-pick" data-pocket-pick="">
      {(recs.length > 1 || listed) && (
        <fieldset className="mtg-setup-source mtg-recs" data-rec-pick="">
          <legend className={listed ? "sr-only" : undefined}>{PW.pick}</legend>
          {recs.map((r) => (
            <label key={r.id}>
              <input type="radio" name="mtg-pocket-rec" checked={r.id === rec.id} onChange={() => onChange({ ...firstChoice([r]), replace: value.replace })} />
              <span><strong>{r.title || PW.rowKind}</strong><span className="muted">{recordingLine(whenShort(r.startAt, zone), lengthLabel(r.minutes))}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      {recs.length === 1 && !named && !listed && <p className="muted">{rec.title ? `${rec.title} · ` : ""}{recordingLine(whenShort(rec.startAt, zone), lengthLabel(rec.minutes))}</p>}
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
      {/* On a call's page the line under the title already says who sees it (listed): only what the AI does. */}
      {(who || listed) && <p className="mtg-pocket-who" data-pocket-who="">{who ? `${who} ` : ""}{PW.ai}</p>}
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

/** MC-5: one of my recordings Add a call offers: not yet a call's transcript; the listed call it fits, if one does. */
export type RecChoice = { rec: ListedRecording; fits: CallRow | null };

/** MC-5: a file chosen in Add a call, uploaded on the call's page once it is added (so the date question can be asked there). */
let uploadFor: { occurrenceId: number; file: File } | null = null;
const takeUpload = (occurrenceId: number): File | null => {
  const f = uploadFor?.occurrenceId === occurrenceId ? uploadFor.file : null;
  if (f) uploadFor = null;
  return f;
};

/** MC-5: the last half hour before now in my zone ("10:30" at 10:47), and its day. */
function lastHalfHour(nowMs: number, zone: string): { date: string; start: string } {
  const z = Temporal.Instant.fromEpochMilliseconds(nowMs).toZonedDateTimeISO(zone);
  const t = Temporal.PlainTime.from({ hour: z.hour, minute: z.minute - (z.minute % 30) });
  return { date: z.toPlainDate().toString(), start: t.toString({ smallestUnit: "minute" }) };
}

/**
 * MC-5: Add a call, one panel, one step. Only I see it. Transcript: Pocket recording (only when connected; chosen to start
 * when there is one to offer), A file, or Later. A recording fills Name from its title and Day, Starts and Length from
 * itself; one that fits a listed call says which, with Review that call. About is always mine to choose. One recording's
 * transcript is read only on Add and review; Add a call asks Pocket nothing more.
 */
function AddCall({ clients, today, nowMs, zone, pocketOn, recs, onCancel, onAdded, onReviewThat }: { clients: CaptureClient[]; today: string; nowMs: number; zone: string; pocketOn: boolean | null; recs: readonly RecChoice[]; onCancel: () => void; onAdded: (occurrenceId: number, file: File | null) => void; onReviewThat: (row: CallRow, recId: string) => void }) {
  const at = lastHalfHour(nowMs, zone);
  const [mode, setMode] = useState<Choice>(pocketOn && recs.length ? "pocket" : "file");
  const [recId, setRecId] = useState<string>(recs.find((x) => !x.fits)?.rec.id ?? recs[0]?.rec.id ?? "");
  const rec = mode === "pocket" ? recs.find((x) => x.rec.id === recId) ?? null : null;
  const [name, setName] = useState(rec?.rec.title ?? "");
  const [named, setNamed] = useState(false);
  const [date, setDate] = useState(at.date > today ? today : at.date);
  const [start, setStart] = useState(at.start);
  const [minutes, setMinutes] = useState(30);
  const [client, setClient] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  // A call kept by a first press whose recording then failed: a second press brings the recording to it, never a second call.
  const kept = useRef<{ recId: string; id: number } | null>(null);
  const min = Temporal.PlainDate.from(today).subtract({ days: 13 }).toString();
  // The recording's title is the name until I type one.
  useEffect(() => {
    if (!named) setName(rec?.rec.title ?? "");
  }, [rec?.rec.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = !!name.trim() && !!client && (mode !== "pocket" || !!rec) && (mode !== "file" || !!file);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "pocket" && rec) {
        const id = kept.current?.recId === rec.rec.id ? kept.current.id : (await call<{ occurrenceId: number }>("meeting.pocket_add", { recordingId: rec.rec.id, name: name.trim(), clientKey: client })).occurrenceId;
        kept.current = { recId: rec.rec.id, id };
        await bringPocket(id, { id: rec.rec.id, part: "all", whole: null, replace: false });
        return onAdded(id, null);
      }
      const r = await call<{ occurrenceId: number }>("meeting.call_add", { name: name.trim(), date, start, minutes, clientKey: client });
      onAdded(r.occurrenceId, mode === "file" ? file : null);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  const choices: Choice[] = [...(pocketOn ? (["pocket"] as const) : []), "file", "later"];
  const takeFile = (fs: FileList | null | undefined) => {
    const f = fs?.length === 1 ? fs[0]! : null;
    if (fs && fs.length > 1) setErr(POCKET_TEXT.oneAtATime);
    if (f) (setFile(f), setErr(null));
  };
  const fields = (
    <div className="mtg-add-grid">
      <label>{ADD_TEXT.name}<input value={name} maxLength={200} required onChange={(e) => (setName(e.target.value), setNamed(true))} data-add-name="" /></label>
      {/* MC-6: a chosen recording's time is said once, on its own line in the list above. */}
      {mode === "pocket" ? null : (
        <>
          <label>{ADD_TEXT.day}<input type="date" value={date} min={min} max={today} required onChange={(e) => setDate(e.target.value)} /></label>
          <label>{ADD_TEXT.starts}<input type="time" value={start} required onChange={(e) => setStart(e.target.value)} data-add-start="" /></label>
          <label>{ADD_TEXT.length}
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{lengthLabel(m)}</option>)}
            </select>
          </label>
        </>
      )}
      <span className={`mtg-add-field${client ? "" : " needed"}`}>
        <label htmlFor="mtg-add-client">{ADD_TEXT.about}{!client && <span className="mtg-needed">{PAGE_TEXT.needed}</span>}</label>
        <ClientPick id="mtg-add-client" clients={clients} value={client} suggested={null} onChange={setClient} />
      </span>
    </div>
  );
  return (
    <form className="mtg-setup mtg-add mc5" aria-labelledby="mtg-add-title" onSubmit={(e) => (e.preventDefault(), ready && void save())} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())} data-add-call="">
      <span className="mtg-add-head">
        <h3 id="mtg-add-title">{ADD_TEXT.title}</h3>
        <span className="muted" title={ADD_TEXT.onlyYouFull}>{ADD_TEXT.onlyYou}</span>
      </span>
      <span className="mtg-choices-head">
        <span className="set-label">{PAGE_TEXT.transcript}</span>
        <ChoiceSeg choices={choices} value={mode} onChange={(c) => (setMode(c), setErr(null))} />
        {pocketOn === false && <a className="mtg-connect" href="#/settings/connections/pocket">{PAGE_TEXT.connect}</a>}
      </span>
      {mode === "pocket" && (recs.length ? (
        <fieldset className="mtg-setup-source mtg-recs" data-rec-pick="">
          <legend className="sr-only">{PW.pick}</legend>
          {recs.map(({ rec: r, fits }) => (
            <label key={r.id} className={fits ? "fits" : undefined}>
              <input type="radio" name="mtg-add-rec" checked={r.id === recId} onChange={() => setRecId(r.id)} />
              <span>
                <strong>{r.title || PW.rowKind}</strong>
                <span className="muted">{recordingLine(whenShort(r.startAt, zone), lengthLabel(r.minutes))}</span>
                {fits && (
                  <span className="mtg-rec-fits">
                    {PAGE_TEXT.fits(fits.name)}{" "}
                    <button type="button" className="link-btn" onClick={() => onReviewThat(fits, r.id)} data-review-that="">{PAGE_TEXT.reviewThat}</button>
                  </span>
                )}
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="muted">{PAGE_TEXT.noRecordings}</p>
      ))}
      {mode === "pocket" && rec && <p className="mtg-pocket-who" data-pocket-who="">{PW.ai}</p>}
      {mode === "file" && (
        <div className={`mtg-drop mtg-dropzone${dropping ? " dropping" : ""}`} data-drop=""
          onDragOver={(e) => [...e.dataTransfer.types].includes("Files") && (e.preventDefault(), setDropping(true))} onDragLeave={() => setDropping(false)}
          onDrop={(e) => (e.preventDefault(), setDropping(false), takeFile(e.dataTransfer.files))}>
          <label className="mtg-drop-words">
            {file ? file.name : PAGE_TEXT.drop}
            <input type="file" accept={ACCEPT} onChange={(e) => (takeFile(e.target.files), (e.target.value = ""))} data-add-file="" />
          </label>
          <span className="mtg-drop-kinds">{PAGE_TEXT.kinds}</span>
        </div>
      )}
      {fields}
      {err && <p className="error-line" role="alert">{err}</p>}
      <span className="mtg-setup-actions">
        <button type="submit" className="mini primary" disabled={busy || !ready} data-add-save="">{busy ? ADD_TEXT.adding : mode === "later" ? ADD_TEXT.add : ADD_TEXT.addReview}</button>
        <button type="button" className="mini quiet" disabled={busy} onClick={onCancel}>{CALLS_TEXT.cancel}</button>
      </span>
    </form>
  );
}

type ReviewProps = { id: number; /** MC-5: on the phone Skip all's words are short (its full words are its label). */ phone?: boolean; /** MC-5: every recording of mine not yet a call's transcript: a hand-added call may take any. */ anyRecs?: readonly ListedRecording[]; /** MC-5: the recording chosen in Add a call. */ startRec?: string | null; /** MC-5: everyone on the call, where my calendar said. */ people?: number | null; /** MC-5: whether my Pocket is connected (null: not known yet). */ pocketOn?: boolean | null; /** MC-2b: my Pocket recordings that go with this call (from my last press). */ pocketRecs?: readonly ListedRecording[]; zone: string; /** MC-3: opened by Calls itself, not by the person: the focus stays where it was. */ quiet?: boolean; view: CallView | null; line: number | null; filter: Exclude<CallFilter, "all"> | null; focus: number | null; colors: Record<string, string>; today: string; undoable?: ((text: string, undo: () => Promise<unknown>) => void) | undefined; /** MC-3: only when the list and the call are two steps: Back to the list. */ onBack?: () => void; onPlace: (at?: CallPlace) => void; onChanged?: (() => void) | undefined };
function ReviewScreen(props: ReviewProps) {
  const { id, pocketRecs = [], anyRecs = [], startRec = null, pocketOn = null, zone, quiet = false, view, line, filter, focus, colors, today, undoable, onBack, onPlace, onChanged } = props;
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
  // MC-5: open proposals stay open while the page is; one opens by itself when DevOps needs an empty field or refused it.
  const [openProps, setOpenProps] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    if (!r) return;
    const auto = r.proposals.filter((p) => opensItself(p, r.checks[String(p.id)], rowErr[p.id] ?? null)).map((p) => p.id);
    if (auto.some((x) => !openProps.has(x))) setOpenProps((s) => new Set([...s, ...auto]));
  }, [r, rowErr]); // eslint-disable-line react-hooks/exhaustive-deps
  // MC-5: Propose again and Get it from Teams (the menu, the failed pass's Try again, the transcript choices), and one upload.
  const run = useCallRun(r?.occurrence ?? null, load);
  const up = useTranscriptUpload(r ? { seriesId: r.meeting.id, date: r.occurrence.date, hasTranscript: r.occurrence.hasTranscript } : null, load);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // MC-5: a file chosen in Add a call is uploaded here once the call is read (a date question is asked here).
  useEffect(() => {
    const f = r ? takeUpload(r.occurrence.id) : null;
    if (f) up.pick(f);
  }, [r?.occurrence.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // MC-1d: "Upload a transcript" from a meeting's menu lands here: on a call with a transcript the file button opens.
  const menu = useMenu((): MenuStep => {
    const items: MenuItem[] = [];
    if (r && run.canRerun) items.push({ id: "call-rerun", label: CALL_ACTIONS.rerun, icon: "refresh", ...(run.busy ? { disabled: "Busy" } : {}), run: () => void run.rerun() });
    if (r?.meeting.teams && !r.occurrence.hasTranscript) items.push({ id: "call-teams", label: CALL_ACTIONS.fromTeams, ...(run.busy ? { disabled: "Busy" } : {}), run: () => void run.fromTeams() });
    items.push({ id: "call-upload", label: CALL_ACTIONS.upload, icon: "attach", ...(up.busy ? { disabled: "Reading…" } : {}), run: () => fileRef.current?.click() });
    if (r && !r.meeting.call && r.occurrence.state !== "no_transcript" && !r.occurrence.hasTranscript) items.push({ id: "call-none", label: "No transcript this week", run: () => void call("meeting.no_transcript", { occurrenceId: r.occurrence.id }).then(load, (e: unknown) => setNote(errText(e))) });
    return { title: r?.meeting.name ?? "Call", items };
  });

  if (error) return (<><BackHead onBack={onBack} title="Call" /><p className="error-line" role="alert">{error}</p></>);
  if (!r) return (<><BackHead onBack={onBack} title="Call" /><p className="muted">Loading…</p></>);
  const m = r.meeting;
  const o = r.occurrence;
  const color = clientColor(m.clientKey, colors);
  const editable = r.canConfirm;
  const can = !!w?.can(m.clientKey);
  const open = r.proposals.filter(toReview);
  const counts = { all: open.length, gap: 0, commitment: 0, comment: 0 } as Record<CallFilter, number>;
  for (const p of open) counts[p.body.kind]++;
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
        await call<{ message: string }>("meeting.keep", { proposalId: p.id });
        last = proposalWords(p.body);
        kept.push(p.id);
      } catch (e) {
        setRowErr((x) => ({ ...x, [p.id]: errText(e) }));
      }
    }
    setBusy(false);
    await load();
    if (kept.length) undoable?.(kept.length === 1 ? CALL_ROW.undoKept(last) : CALL_ROW.undoKeptMany(kept.length), async () => {
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
    // MC-6: one Undo message at a time: a Skip says what it skipped, one or several, and replaces the last message.
    const one = ps.find((p) => p.id === done[0]);
    if (on && done.length > 0) undoable?.(done.length === 1 && one ? CALL_ROW.undoSkipped(proposalWords(one.body)) : CALL_ROW.undoSkippedMany(done.length), async () => {
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
  // MC-4: closed once nothing is undecided; Skip all and close from the head, with Undo; an open call from before this
  // week says when its transcript goes (30 days after the call).
  const closedAt = closedAtOf(r.proposals.map((p) => ({ state: p.state, decidedAt: p.decidedAt ?? null })));
  const seeSkipped = KINDS.some((k) => unfolded.has(`${k}:skipped`));
  const goesOn = weekOf(o.date, today) !== "this" ? dayLabel(Temporal.PlainDate.from(o.date).add({ days: 30 }).toString()) : null;
  const skipAllHere = async () => {
    setBusy(true);
    try {
      const d = await call<{ calls: { skipped: { id: number; was: "open" | "failed" }[] }[] }>("meeting.skip_all", { occurrenceIds: [o.id] });
      const items = d.calls.flatMap((c) => c.skipped);
      await load();
      undoable?.(LIST_TEXT.skippedClosed(items.length), async () => {
        if (items.length) await call("meeting.unskip_all", { items });
        await load();
      });
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const decided = r.proposals.length - open.length;
  const people = m.call ? props.people ?? null : m.attendees || null;
  const who = m.call === "hand" ? PAGE_TEXT.who.hand : m.call === "chat" ? PAGE_TEXT.who.chat : m.call ? PAGE_TEXT.who.calendar : PAGE_TEXT.who.registered;
  const origin = r.pocket ? { text: PAGE_TEXT.origin.pocket, hint: r.pocketFrom ? `${r.pocketFrom === "mine" ? PW.fromMine : PW.fromReviewer} ${PW.unnamed}` : POCKET_TEXT.note } : m.call === "hand" ? { text: PAGE_TEXT.origin.hand, hint: null } : m.call === "chat" ? { text: CALL_LIST.fromChat, hint: r.noSpeakers ? CHAT_NO_SPEAKERS : null } : null;
  const shownFilters = CALL_FILTERS.filter((f) => counts[f.key] > 0);
  const skipWords = open.length === r.proposals.length ? CLOSE_TEXT.skipAllClose : CLOSE_TEXT.skipLastClose(open.length);
  // A call with no transcript, or one waiting on it or marked as having none this week (as the old upload box showed): the choices.
  const noTranscript = editable && ((!r.transcript && !o.hasTranscript) || o.state === "needs_upload" || o.state === "waiting" || o.state === "no_transcript");
  const isOpen = (p: Proposal) => openProps.has(p.id);
  const setOpen = (p: Proposal, on: boolean) => setOpenProps((x) => { const n = new Set(x); if (on) n.add(p.id); else n.delete(p.id); return n; });
  const row = (p: Proposal, live: boolean) => (
    <ProposalRow key={p.id} p={p} check={live ? checkOf(p) : undefined} err={live ? rowErr[p.id] ?? null : null} ticked={live && ticked.has(p.id)} editable={editable} can={can} busy={busy} clientKey={m.clientKey} opts={opts} today={today}
      open={isOpen(p)} onOpen={(on) => setOpen(p, on)} onTick={(on) => tick(p, on)} onEdit={(patch) => void edit(p, patch)} onSend={() => void send([p])} onSendBreakDown={() => void send([p], { breakDown: true })} onKeep={() => void keep([p])} onSkip={(on) => void skip([p], on)} onEnable={() => w?.enable(m.clientKey)}
      onQuote={r.transcript ? (n) => onPlace({ view: "transcript", line: n }) : undefined} />
  );

  return (
    <>
      <div className="mtg-sticky" ref={stickyRef}>
        <header className="mtg-head" data-call-head="">
          {onBack && <button type="button" className="mini quiet mtg-back" onClick={onBack} aria-label={CALL_LIST.back} data-calls-back=""><Icon name="back" /> <span className="mtg-back-word">{CALLS_TEXT.heading}</span></button>}
          <h2 tabIndex={-1} title={m.name}>{m.name}</h2>
          <span className="mtg-head-acts">
            {r.transcript && (
              <span className="seg mtg-switch" role="group" aria-label="This call">
                <button type="button" className={`seg-btn${view !== "transcript" ? " on" : ""}`} aria-pressed={view !== "transcript"} onClick={() => onPlace(filter ? { filter } : undefined)}>{TRANSCRIPT_TEXT.tabProposals}</button>
                <button type="button" className={`seg-btn${view === "transcript" ? " on" : ""}`} aria-pressed={view === "transcript"} onClick={() => onPlace({ view: "transcript" })}>{TRANSCRIPT_TEXT.tab}</button>
              </span>
            )}
            {editable && open.length > 0 && closedAt === null && (
              <button type="button" className="mini" disabled={busy} onClick={() => void skipAllHere()} aria-label={skipWords} title={skipWords} data-call-act="skip-all">{props.phone ? (open.length === r.proposals.length ? LIST_TEXT.skipAll : LIST_TEXT.skipLast(open.length)) : skipWords}</button>
            )}
            {editable && <span data-call-menu="">{menu.button(PAGE_TEXT.menu)}</span>}
          </span>
          <p className="mtg-meta" data-call-meta="">
            <span className="swatch calls-sq" style={{ "--c": color } as CSSProperties} aria-hidden="true" />
            <span>{m.clientName}</span>
            {!m.call && <span>{m.roleLabel}</span>}
            <span>{whenOf(o.startAt, zone)}</span>
            {people ? <span>{CALLS_TEXT.people(people)}</span> : null}
            {origin && <span title={origin.hint ?? undefined} data-call-origin="">{origin.text}</span>}
            <span title={who.full}>{who.short}</span>
          </p>
        </header>
        {view !== "transcript" && open.length > 0 && closedAt === null && (
          <div className="mtg-show" data-show-row="">
            <span className="mtg-show-chips" role="group" aria-label={PAGE_TEXT.show}>
              {shownFilters.map((f) => (
                <button key={f.key} type="button" className={`ib4-chip${(filter ?? "all") === f.key ? " on" : ""}`} aria-pressed={(filter ?? "all") === f.key} onClick={() => onPlace(f.key === "all" ? undefined : { filter: f.key })} data-show={f.key}>
                  {/* All's number is the decided line's "of N": said once. */}
                  {f.label}{f.key !== "all" && <> <span className="seg-count">{counts[f.key]}</span></>}
                </button>
              ))}
            </span>
            {goesOn && <span className="calls-amber" data-transcript-goes="">{LIST_TEXT.goes(goesOn)}</span>}
            <span className="mtg-decided" role="status" data-decided="">
              {PAGE_TEXT.decided(decided, r.proposals.length)}
              <span className="calls-left-bar" aria-hidden="true"><span style={{ width: `${Math.round((decided / Math.max(1, r.proposals.length)) * 100)}%` }} /></span>
            </span>
          </div>
        )}
      </div>
      {run.msg && <p className="muted mtg-run-line" role="status">{run.msg}</p>}
      {up.ask && !noTranscript && <DateAsk text={up.ask.text} onAnswer={up.answer} />}
      {up.msg && !up.ask && !noTranscript && <p className="muted mtg-run-line" role="status">{up.msg}</p>}
      {editable && r.transcript && dragging && !noTranscript && (
        <div className="mtg-drop mtg-drop-replace dropping" {...dropProps(up)}>{POCKET_TEXT.dropReplace}</div>
      )}
      {editable && <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => (up.pick(e.target.files?.[0]), (e.target.value = ""))} data-call-file="" />}
      {view !== "transcript" && r.proposals.length > 0 && closedAt !== null && (
        // MC-4: a closed call says when it closed and what came of it; what was skipped is one press away, and putting one back opens the call again.
        <section className="mtg-closed" aria-labelledby="mtg-closed-head" data-closed-page="">
          <h3 id="mtg-closed-head">{CLOSE_TEXT.closedAt(whenOf(closedAt, zone))}</h3>
          <p>{closedLine({ at: closedAt, done: outcomeOfCall(r.proposals.map((p) => ({ kind: p.body.kind, state: p.state }))), noTranscript: false })}</p>
          {skipped > 0 && (
            <button type="button" className="link-btn" data-see-skipped="" aria-expanded={seeSkipped} title={editable ? CLOSE_TEXT.putBackOpens : undefined} onClick={() => setUnfolded((u) => { const n = new Set(u); for (const k of KINDS) if (seeSkipped) n.delete(`${k}:skipped`); else n.add(`${k}:skipped`); return n; })}>
              {seeSkipped ? CLOSE_TEXT.hideSkipped : CLOSE_TEXT.seeSkipped(skipped)}
            </button>
          )}
        </section>
      )}
      {!editable && <p className="muted mtg-look">{PAGE_TEXT.onlyLook(m.reviewers.map((x) => x.name))}</p>}
      {view !== "transcript" && r.summary && r.summary.length > 0 && (
        // MC-2: what was discussed and decided, above the proposals, on every call.
        <section className="mtg-summary" aria-labelledby="mtg-summary-head">
          <h3 id="mtg-summary-head">{CALLS_TEXT.summary}</h3>
          <ul>{r.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </section>
      )}
      {o.state === "failed" && (
        <section className="mtg-failed" role="status" aria-label={CALL_STATE.aiFailed}>
          <h3>{CALL_STATE.aiFailed}</h3>
          {o.aiMessage && <p>{o.aiMessage.replace(`${CALL_STATE.aiFailed}: `, "").replace(/^./, (c) => c.toUpperCase())}</p>}
          {o.aiNext && <p className="muted">{o.aiNext}</p>}
          {editable && run.canRerun && <button type="button" className="mini primary" disabled={!!run.busy} onClick={() => void run.rerun()}>{run.busy === "rerun" ? "Proposing…" : CALL_ROW.tryAgain}</button>}
        </section>
      )}
      {note && <p className="error-line" role="alert">{note}</p>}
      {o.state === "waiting" && <p className="muted mtg-run-line" title={PAGE_TEXT.waitingHint}>{PAGE_TEXT.waiting}</p>}
      {noTranscript && (
        <TranscriptChoices series={m} occ={o} recs={m.call === "hand" ? anyRecs : pocketRecs} startRec={startRec} pocketOn={pocketOn} zone={zone} up={up} dragging={dragging} start={view === "upload" ? "file" : null} onTeams={() => void run.fromTeams()} teamsBusy={run.busy === "teams"} teamsRefused={run.refused} onDone={load} />
      )}
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
            <section key={kind} className="mtg-group" style={{ "--c": color } as CSSProperties} aria-label={SECTION_HEAD[kind]} data-group={kind}>
              <h3 className="mtg-sec-head">
                <span>{SECTION_HEAD[kind]}</span>
                {editable && selectable.length > 1 && (
                  <button type="button" className="mini quiet" aria-pressed={allOn} onClick={() => setTicked((s) => { const n = new Set(s); for (const p of selectable) if (allOn) n.delete(p.id); else n.add(p.id); return n; })}>
                    {allOn ? CALL_BAR.clear : CALL_ROW.selectAll}
                  </button>
                )}
              </h3>
              {rows.map((p) => row(p, true))}
              {folds.map((f) => {
                const key = `${kind}:${f.k}`;
                const isOpenFold = unfolded.has(key);
                return (
                  <div key={key} className="mtg-fold">
                    <button type="button" className="link-btn" aria-expanded={isOpenFold} onClick={() => setUnfolded((u) => { const n = new Set(u); if (isOpenFold) n.delete(key); else n.add(key); return n; })}>
                      <Icon name={isOpenFold ? "open" : "closed"} /> {f.k === "done" ? CALL_ROW.done(f.ps.length) : CALL_ROW.skipped(f.ps.length)}
                    </button>
                    {isOpenFold && f.ps.map((p) => row(p, false))}
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
function useTranscriptUpload(target: { seriesId: number; date: string; hasTranscript: boolean } | null, onDone: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ file: File; text: string } | null>(null);
  const send = async (f: File, dateOk = false) => {
    if (!target) return;
    setBusy(true);
    setMsg(null);
    setAsk(null);
    try {
      const r = await uploadMeetingTranscript<UploadAnswer>(target.seriesId, target.date, f, { dateOk });
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
    if (target?.hasTranscript && !window.confirm(POCKET_TEXT.replace)) return;
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
type Upload = ReturnType<typeof useTranscriptUpload>;

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
 * MC-1d: Propose again (the AI pass once more on the stored transcript; it replaces the open proposals, the done, skipped
 * and failed ones stay; MC-1e: the same thing again is left out) and MC-2's Get it from Teams (one try with my sign-in,
 * for this call only). MC-5: they live in the call's menu, the failed pass's Try again and the transcript choices; one
 * line says what came of them. Asked for from a meeting's menu (or Needs you's Try again), each runs here once.
 */
function useCallRun(occ: OccurrenceView | null, onDone: () => Promise<void>) {
  const [busy, setBusy] = useState<"rerun" | "teams" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** After a refusal the file is the way on: Teams is no longer the main button. */
  const [refused, setRefused] = useState(false);
  const fromTeams = async () => {
    if (!occ) return;
    setBusy("teams");
    setMsg(null);
    try {
      const r = await call<{ outcome: string; message: string }>("meeting.call_fetch", { occurrenceId: occ.id });
      setMsg(r.message);
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
    if (!occ) return;
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
  const id = occ?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    if (takeRerun(id)) void rerun();
    if (takeFetch(id)) void fromTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const canRerun = !!occ && occ.hasTranscript && occ.state !== "waiting" && occ.state !== "fetching";
  return { busy, msg, refused, fromTeams, rerun, canRerun };
}

type Choice = "teams" | "pocket" | "file" | "later";

/** MC-5: the transcript choices as a segmented control (Add a call's, and a call's page with no transcript). */
export function ChoiceSeg({ choices, value, onChange }: { choices: readonly Choice[]; value: Choice; onChange: (c: Choice) => void }) {
  return (
    <span className="seg mtg-choice" role="group" aria-label={PAGE_TEXT.transcript} data-transcript-choice="">
      {choices.map((c) => (
        <button key={c} type="button" className={`seg-btn${value === c ? " on" : ""}`} aria-pressed={value === c} onClick={() => onChange(c)} data-choice={c}>{PAGE_TEXT.choice[c]}</button>
      ))}
    </span>
  );
}

/** MC-5: A file: one drop area with its words, the file kinds in small type under it. */
function DropFile({ up, dragging, children }: { up: Upload; dragging: boolean; children?: React.ReactNode }) {
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <div className={`mtg-drop mtg-dropzone${dragging ? " dropping" : ""}`} {...dropProps(up)} data-drop="">
      <label className={`mtg-drop-words${up.busy ? " disabled" : ""}`}>
        {up.busy ? "Reading…" : dragging ? POCKET_TEXT.dropHere : PAGE_TEXT.drop}
        <input ref={ref} type="file" accept={ACCEPT} disabled={up.busy} onChange={(e) => (up.pick(e.target.files?.[0]), (e.target.value = ""))} />
      </label>
      <span className="mtg-drop-kinds">{PAGE_TEXT.kinds}</span>
      {children}
    </div>
  );
}

/**
 * MC-5: a call with no transcript shows Add a call's choices instead of the old box: From Teams (a Teams meeting FocusTime
 * may ask), Pocket recording (when connected: my recordings that fit the call), A file. Pocket not connected: a quiet link.
 */
function TranscriptChoices({ series, occ, recs, startRec = null, pocketOn, zone, up, dragging, start, onTeams, teamsBusy, teamsRefused, onDone }: { series: SeriesView; occ: OccurrenceView; recs: readonly ListedRecording[]; startRec?: string | null; pocketOn: boolean | null; zone: string; up: Upload; dragging: boolean; start: "file" | null; onTeams: () => void; teamsBusy: boolean; teamsRefused: boolean; onDone: () => Promise<void> }) {
  const choices: Choice[] = [...(series.teams ? (["teams"] as const) : []), ...(pocketOn ? (["pocket"] as const) : []), "file"];
  const first: Choice = start ?? (pocketOn && recs.length ? "pocket" : series.teams ? "teams" : "file");
  const [c, setC] = useState<Choice>(first);
  // A hand-added call: my recordings that fit it first, then the others (it takes the chosen one's time).
  const sorted = useMemo(() => [...recs].sort((a, b) => Number(goesWith(spanOf(b), occ)) - Number(goesWith(spanOf(a), occ)) || b.startAt.localeCompare(a.startAt)), [recs, occ]);
  const [choice, setChoice] = useState<PocketChoice>(() => firstChoice(sorted.filter((r) => !startRec || r.id === startRec).concat(sorted)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (dragging) setC("file");
  }, [dragging]);
  const chosen = sorted.find((r) => r.id === choice.id) ?? null;
  const moves = series.call === "hand" && !!chosen && !goesWith(spanOf(chosen), occ);
  const bring = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await bringPocket(occ.id, moves ? { ...choice, part: "all" } : choice, moves);
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
    <section className="mtg-choices" aria-label={PAGE_TEXT.transcript} data-no-transcript="">
      <span className="mtg-choices-head">
        <span className="set-label">{PAGE_TEXT.transcript}</span>
        <ChoiceSeg choices={choices} value={c} onChange={setC} />
        {pocketOn === false && <a className="mtg-connect" href="#/settings/connections/pocket">{PAGE_TEXT.connect}</a>}
      </span>
      {c === "teams" && (
        <span className="mtg-choice-body">
          <button type="button" className={`mini${teamsRefused ? "" : " primary"}`} disabled={teamsBusy} onClick={onTeams} title={CALLS_TEXT.sourceTeamsHint} data-get-teams="">{teamsBusy ? "Asking Teams…" : PAGE_TEXT.getTeams}</button>
        </span>
      )}
      {c === "pocket" && (
        <div className="mtg-choice-body" data-pocket-bring="">
          {recs.length ? (
            <>
              <PocketFields recs={sorted} call={moves && chosen ? chosen : occ} zone={zone} value={choice} onChange={setChoice} who="" listed />
              {moves && chosen && <p className="mtg-run-line" role="note" data-takes-time="">{PAGE_TEXT.takesTime(whenLine(chosen.startAt, chosen.endAt, zone))}</p>}
              {err && <p className="error-line" role="alert">{err}</p>}
              <span><button type="button" className="mini primary" disabled={busy} onClick={() => void bring()} data-use-recording="">{busy ? PW.bringing : choice.replace ? PW.replaceYes : PAGE_TEXT.useRecording}</button></span>
            </>
          ) : (
            <p className="muted">{PAGE_TEXT.noRecordings}</p>
          )}
        </div>
      )}
      {c === "file" && (
        <DropFile up={up} dragging={dragging}>
          {up.msg && !up.ask && <p className="muted" role="status">{up.msg}</p>}
        </DropFile>
      )}
      {up.ask && <DateAsk text={up.ask.text} onAnswer={up.answer} />}
    </section>
  );
}
