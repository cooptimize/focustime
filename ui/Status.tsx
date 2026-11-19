// SR-1: Week › Status. A preview of Monday's status report (Kat sends it; FocusTime never does) and the comments that
// feed it, across my clients. Edit (the default) has a box per feature: new lines (each its own DevOps comment, its own
// bullet on Monday), in-place edits of my own comments in the window, and Draft (AI, one request per client). Preview
// reads like the email. Nothing is written until Push all: one preview of every line and edit across clients, then the
// write framework's own writes, each read back, logged and undoable, with a result per line and Retry.
// SR-2: a switch at the top, My features · <Client> report, for everyone on a client's team: the client's whole Monday
// report as Kat will send it (status.report, checked on the server), No update yet and Upcoming PTO and Holidays, with
// the same lines, Push all and Undo.
// SR-3: a report you can finish. Lines are typed in place (Enter adds the next, Shift+Enter a new line in the same
// comment, Esc closes, Tab goes to the next feature's + Add a line) and wait as pending until Push all; my own comments
// in the window are edited by clicking them and can be deleted; Add a feature brings in any of the client's features;
// the features I worked on with no update of mine float to the top with a suggested line (or a plain "Worked on" line
// with AI off); holidays join the PTO; the phone can do all of it.
// ST-1: every line under a feature is in one of three states (ui/status-states.ts): On the report (in DevOps now),
// Ready to push (mine, not in DevOps yet) or Suggested (written for me; nothing happens until I add it). A feature has
// two labelled parts, On Monday's report and Not on it yet; Suggest a line (once Draft) gives a suggestion, never a line
// to push; one bar at the foot pushes what is ready; Preview shows only what is On the report.
import { TextBox } from "./TextBox.tsx";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ComponentProps, type KeyboardEvent } from "react";
import type { CatalogFeature, NoUpdateFeature, ReportClientRef, ReportFeature, StatusClient, StatusComment, StatusFeature, StatusLoad, StatusReport, StatusReportAnswer } from "../plan/status-types.ts";
import { call } from "./api.ts";
import { useDevOpsChanged, useDevOpsFresh } from "./DevOpsFresh.tsx";
import { CellPopover, FilterList } from "./CellPopover.tsx";
import { MentionFlag, useDevOpsWrite, type DevOpsChange } from "./DevOpsWrite.tsx";
import { partsLine, partsOf } from "../plan/preview-parts.ts";
import { clientColor } from "./labels.ts";
import { stampText } from "./stamp.ts";
import { ModeArea } from "./ModeSwitch.tsx";
import { WorkLink } from "./WorkLink.tsx";
import { byRank, closeLine, enterLine, pendingLines, previewFeatures, type Line } from "./status-lines.ts";
import { LINE_NOTE, LINE_STATES, STATE_KEY, STATE_NAME, ST_WORDS, mondayWords, sendsWords } from "./status-states.ts";
import { Icon } from "./icons.tsx";

export type { Line } from "./status-lines.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

/** A line that went to DevOps: its write (for Undo) and how it ended. */
type Pushed = { key: string; clientKey: string; itemId: number; text: string; kind: Line["kind"]; ok: boolean; message: string; writeId: number | null; undone?: boolean };
/** SR-3: one suggested line for a feature: the AI's (status.suggest, or Suggest a line), or the plain template. */
type Suggestion = { itemId: number; text: string; source: "ai" | "template"; /** GD-2: said inside the suggestion. */ namesRemoved?: string };
type SuggestAnswer = { clientKey: string; ai: string; message: string | null; suggestions: Suggestion[]; namesRemoved?: string };

const STORE = "focustime.status.lines";
const SCOPE = "focustime.status.scope";
const ADDED = "focustime.status.added";
const DISMISSED = "focustime.status.dismissed";

/** What the push machinery needs to know of the features on screen (either view). */
type Known = { clients: { clientKey: string; clientName: string; features: StatusFeature[]; also: StatusFeature[] }[] };
const reportKnown = (r: StatusReport): Known => ({ clients: [{ clientKey: r.clientKey, clientName: r.clientName, features: [...r.features, ...r.noUpdate, ...r.needsYou, ...r.added], also: [] }] });
/** The client report as SR-1's sections read a client (AI drafting isn't offered on the client report). */
const reportClient = (r: StatusReport): StatusClient => ({
  clientKey: r.clientKey, clientName: r.clientName, status: r.status, ...(r.message ? { message: r.message } : {}),
  window: { since: r.window.since, source: r.window.source === "kat" ? "kat" : "fallback", katSentAt: r.window.katSentAt, prevSince: r.window.since, note: r.window.note },
  canWrite: r.canWrite, ai: "off", aiNote: null, features: r.features, also: [],
});

/** localStorage, read and written in try/catch: a convenience only (a private window just forgets). */
function stored<T>(key: string, fallback: T, ok: (v: unknown) => v is T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, v: unknown | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* blocked storage: this page only */
  }
}
const savedScope = () => {
  try {
    return localStorage.getItem(SCOPE) ?? "mine";
  } catch {
    return "mine";
  }
};
const saveScope = (v: string) => {
  try {
    localStorage.setItem(SCOPE, v);
  } catch {
    /* a convenience only */
  }
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Unsent lines survive a reload in this browser only (a convenience; never the record). */
function savedLines(report: string): Line[] {
  const v = stored<{ report?: string; lines?: Line[] } | null>(STORE, null, (x): x is { report?: string; lines?: Line[] } => isObj(x));
  return v?.report === report && Array.isArray(v.lines) ? v.lines.filter((l) => l && typeof l.key === "string" && typeof l.text === "string") : [];
}
const saveLines = (report: string, lines: Line[]) => store(STORE, lines.length ? { report, lines } : null);
/** SR-3: features added by hand, per report date and client, until pushed or removed (this browser only). */
function savedAdded(report: string): Record<string, number[]> {
  const v = stored<{ report?: string; added?: Record<string, number[]> } | null>(ADDED, null, (x): x is { report?: string; added?: Record<string, number[]> } => isObj(x));
  return v?.report === report && isObj(v.added) ? v.added : {};
}
function savedDismissed(report: string): string[] {
  const v = stored<{ report?: string; keys?: string[] } | null>(DISMISSED, null, (x): x is { report?: string; keys?: string[] } => isObj(x));
  return v?.report === report && Array.isArray(v.keys) ? v.keys.filter((k) => typeof k === "string") : [];
}

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

/** IB-2: when it happened, in the shared words, in the person's own time zone (ZoneCtx, from Week). */
const ZoneCtx = createContext<string | undefined>(undefined);
const when = (iso: string, zone?: string) => stampText(iso, zone ?? Temporal.Now.timeZoneId());

/** SR-3: Tab from a line box (or a + Add a line) goes to the next feature's + Add a line; Shift+Tab to the previous. */
function moveToAdd(from: HTMLElement, back: boolean): boolean {
  // Only the ones on screen: a folded list (Also assigned, No update yet) is skipped until it is opened.
  const all = [...document.querySelectorAll<HTMLElement>("[data-add-line]")].filter((b) => b === from || b.getClientRects().length > 0);
  const feature = from.closest("[data-feature]");
  const mine = all.findIndex((b) => b === from || (!!feature && b.closest("[data-feature]") === feature));
  const pos = mine >= 0 ? mine : all.findIndex((b) => from.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const next = back ? all[(pos < 0 ? all.length : pos) - 1] : all[mine >= 0 ? mine + 1 : Math.max(pos, 0)];
  if (!next) return false;
  next.focus();
  next.scrollIntoView({ block: "nearest" });
  return true;
}

/** Everything a feature row can do; one object so the sections stay readable. */
export type LineOps = {
  open: string | null;
  add: (c: StatusClient, f: StatusFeature, text?: string, from?: Line["from"], open?: boolean) => void;
  edit: (c: StatusClient, f: StatusFeature, cm: StatusComment) => void;
  del: (c: StatusClient, f: StatusFeature, cm: StatusComment) => void;
  change: (key: string, patch: Partial<Line>) => void;
  remove: (key: string) => void;
  setOpen: (key: string | null) => void;
  enter: (key: string) => void;
  close: (key: string) => void;
  unadd?: (clientKey: string, itemId: number) => void;
};
/** ST-1: the suggestions the rows read, by "client:item": Add, Edit, Dismiss, and Suggest a line. */
type SuggestView = {
  by: Record<string, Suggestion>;
  loading: Record<string, boolean>;
  dismissed: ReadonlySet<string>;
  onAdd: (c: StatusClient, f: StatusFeature, s: Suggestion, open: boolean) => void;
  onDismiss: (clientKey: string, itemId: number) => void;
  /** Suggest a line for one feature (status.draft); null when AI isn't on for the client or the row is read only. */
  onSuggest: ((c: StatusClient, f: StatusFeature) => void) | null;
  suggesting: Record<string, boolean>;
};
const skey = (clientKey: string, itemId: number) => `${clientKey}:${itemId}`;
/** The suggestion a feature shows: there, not dismissed. */
const shownSugg = (v: SuggestView | undefined, c: StatusClient, f: StatusFeature) => (v && !v.dismissed.has(skey(c.clientKey, f.id)) ? v.by[skey(c.clientKey, f.id)] : undefined);

export function StatusView(p: ComponentProps<typeof StatusBody>) {
  return (
    <ZoneCtx.Provider value={p.tz}>
      <StatusBody {...p} />
    </ZoneCtx.Provider>
  );
}

function StatusBody({ tz, switcher, colors, readOnly, version, onChanged, group, phone }: { /** IB-2: the person's time zone. */ tz: string; switcher?: React.ReactNode; colors: Record<string, string>; readOnly: boolean; version: unknown; onChanged: () => void; /** SR-3: open on the features that need an update (the nudge). */ group?: "needs" | undefined; phone?: boolean }) {
  const [data, setData] = useState<StatusLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">(readOnly ? "preview" : "edit");
  const [lines, setLines] = useState<Line[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<Record<string, boolean>>({});
  const [draftNote, setDraftNote] = useState<Record<string, string>>({});
  // OP-1: Push runs through the app's one preview (one client's lines per preview, 10 at most); `push` is true while it does.
  const [push, setPush] = useState(false);
  const [pushed, setPushed] = useState<Pushed[]>([]);
  const writes = useDevOpsWrite();
  const loaded = useRef<string | null>(null);
  // SR-2: which view, and the clients whose report I may open (none: no switch).
  const [scope, setScopeState] = useState<string>(savedScope);
  const [teams, setTeams] = useState<ReportClientRef[] | null>(null);
  const [report, setReport] = useState<StatusReport | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // SR-3: added features, suggestions and dismissals.
  const [added, setAdded] = useState<Record<string, number[]>>({});
  const [sugg, setSugg] = useState<Record<string, Suggestion>>({});
  const [suggLoading, setSuggLoading] = useState<Record<string, boolean>>({});
  const [suggNote, setSuggNote] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);
  // ST-1: Show (Needs an update · All), set once the page knows whether anything needs one; Preview's Show them.
  const [show, setShow] = useState<"needs" | "all" | null>(group === "needs" ? "needs" : null);
  const [showReady, setShowReady] = useState(false);
  const asked = useRef(new Set<string>());
  const onReport = scope !== "mine" && !!teams?.some((t) => t.clientKey === scope);
  const setScope = (v: string) => {
    setScopeState(v);
    saveScope(v);
  };

  const restore = (reportDate: string) => {
    if (loaded.current !== reportDate) {
      loaded.current = reportDate;
      setLines(savedLines(reportDate));
      const a = savedAdded(reportDate);
      addedRef.current = a;
      setAdded(a);
      setDismissed(savedDismissed(reportDate));
    }
  };
  // A saved client view waits for the list of my teams before reading anything.
  const waiting = teams === null && scope !== "mine";
  const addedRef = useRef(added);
  const load = useCallback(async (refresh = false) => {
    if (waiting) return;
    try {
      if (onReport) {
        const extra = addedRef.current[scope] ?? [];
        const r = await call<StatusReportAnswer>("status.report", { clientKey: scope, ...(refresh ? { refresh: true } : {}), ...(extra.length ? { added: extra } : {}) });
        setTeams(r.clients);
        if (r.report) {
          const was = loaded.current;
          restore(r.report.reportDate);
          // Saved added features from an earlier visit: read the report again with them.
          const now = addedRef.current[scope] ?? [];
          if (was !== r.report.reportDate && now.length && !extra.length) {
            const again = await call<StatusReportAnswer>("status.report", { clientKey: scope, added: now });
            setReport(again.report);
            setError(null);
            return;
          }
        }
        setReport(r.report);
        setError(null);
        return;
      }
      const d = await call<StatusLoad>("status.load", {});
      setData(d);
      setError(null);
      restore(d.reportDate);
    } catch (e) {
      setError(errText(e));
    }
  }, [onReport, scope, waiting]);
  useEffect(() => {
    void call<StatusReportAnswer>("status.report", {}).then((r) => setTeams(r.clients), () => setTeams([]));
  }, [version]);
  useEffect(() => {
    void load();
  }, [load, version]);
  const date = onReport ? report?.reportDate : data?.reportDate;
  useEffect(() => {
    if (date) saveLines(date, lines);
  }, [date, lines]);
  useEffect(() => {
    if (date) store(ADDED, Object.values(added).some((a) => a.length) ? { report: date, added } : null);
  }, [date, added]);
  useEffect(() => {
    if (date) store(DISMISSED, dismissed.length ? { report: date, keys: dismissed } : null);
  }, [date, dismissed]);
  // DV-2: Refresh is the shared check (for the clients on screen), with its answer; a client's change rereads quietly.
  const fresh = useDevOpsFresh();
  const [said, setSaid] = useState<string | null>(null);
  const refresh = async () => {
    setRefreshing(true);
    const keys = onReport ? [scope] : (data?.clients.map((c) => c.clientKey) ?? undefined);
    const r = fresh ? await fresh.refresh(keys) : null;
    await load(!fresh);
    setRefreshing(false);
    if (r) {
      setSaid(r.line);
      window.setTimeout(() => setSaid((x) => (x === r.line ? null : x)), 6000);
    }
  };
  // Status reads each feature's comments from DevOps on the person's own request, so a move rereads at most every 5 minutes.
  useDevOpsChanged(onReport ? [scope] : (data?.clients.map((c) => c.clientKey) ?? null), () => void load(), { gapMs: 5 * 60_000 });
  const shownReport = onReport && report?.clientKey === scope ? report : null;
  const known: Known | null = onReport ? (shownReport ? reportKnown(shownReport) : null) : data;

  // SR-3: the features that need my update, by client, and a suggested line for each, asked once per page per client.
  const needs: { clientKey: string; ids: number[] }[] = useMemo(() => (onReport ? (shownReport ? [{ clientKey: shownReport.clientKey, ids: shownReport.needsYou.map((f) => f.id) }] : []) : (data?.clients ?? []).map((c) => ({ clientKey: c.clientKey, ids: c.features.filter((f) => f.needsYou).map((f) => f.id) }))).filter((n) => n.ids.length), [onReport, shownReport, data]);
  useEffect(() => {
    if (readOnly) return;
    for (const n of needs) {
      const ask = n.ids.filter((id) => !asked.current.has(skey(n.clientKey, id)));
      if (!ask.length) continue;
      for (const id of ask) asked.current.add(skey(n.clientKey, id));
      setSuggLoading((s) => ({ ...s, ...Object.fromEntries(ask.map((id) => [skey(n.clientKey, id), true])) }));
      void call<SuggestAnswer>("status.suggest", { clientKey: n.clientKey, itemIds: ask.slice(0, 40) }).then(
        (r) => {
          // GD-2: the check after generation replaced another client's name; the note goes in the suggestion itself.
          setSugg((s) => ({ ...s, ...Object.fromEntries(r.suggestions.filter((x) => x.text.trim() && !s[skey(n.clientKey, x.itemId)]).map((x) => [skey(n.clientKey, x.itemId), { ...x, ...(r.namesRemoved && x.source === "ai" ? { namesRemoved: r.namesRemoved } : {}) }])) }));
          setSuggNote((m) => ({ ...m, [n.clientKey]: r.ai !== "ok" ? (r.message ?? "") : "" }));
        },
        (e) => setSuggNote((m) => ({ ...m, [n.clientKey]: errText(e) })),
      ).finally(() => setSuggLoading((s) => ({ ...s, ...Object.fromEntries(ask.map((id) => [skey(n.clientKey, id), false])) })));
    }
  }, [needs, readOnly]);

  const commentText = (id: number): string | null => known?.clients.flatMap((c) => [...c.features, ...c.also]).flatMap((f) => f.thisWeek ?? []).find((x) => x.id === id)?.text ?? null;
  const change = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => {
    setLines((ls) => ls.filter((l) => l.key !== key));
    setOpen((o) => (o === key ? null : o));
  };
  const add = (c: StatusClient, f: StatusFeature, text = "", from: Line["from"] = "me", openIt = true) => {
    const key = newKey();
    setLines((ls) => [...ls, { key, clientKey: c.clientKey, itemId: f.id, kind: "comment", commentId: null, text, from }]);
    if (openIt) setOpen(key);
  };
  const edit = (c: StatusClient, f: StatusFeature, cm: StatusComment) => {
    const had = lines.find((l) => (l.kind === "comment_edit" || l.kind === "comment_delete") && l.commentId === cm.id);
    if (had) return void (had.kind === "comment_edit" && setOpen(had.key));
    const key = newKey();
    setLines((ls) => [...ls, { key, clientKey: c.clientKey, itemId: f.id, kind: "comment_edit", commentId: cm.id, text: cm.text, from: "me" }]);
    setOpen(key);
  };
  const del = (c: StatusClient, f: StatusFeature, cm: StatusComment) =>
    setLines((ls) => [...ls.filter((l) => !(l.kind === "comment_edit" && l.commentId === cm.id)), ...(ls.some((l) => l.kind === "comment_delete" && l.commentId === cm.id) ? [] : [{ key: newKey(), clientKey: c.clientKey, itemId: f.id, kind: "comment_delete" as const, commentId: cm.id, text: cm.text, from: "me" as const }])]);
  const enter = (key: string) => {
    const r = enterLine(lines, key, newKey());
    if (r.lines.length !== lines.length) setLines(r.lines);
    setOpen(r.open);
  };
  const close = (key: string) => {
    setLines((ls) => closeLine(ls, key, commentText));
    setOpen((o) => (o === key ? null : o));
  };
  const unadd = (clientKey: string, itemId: number) => {
    const next = { ...addedRef.current, [clientKey]: (addedRef.current[clientKey] ?? []).filter((x) => x !== itemId) };
    addedRef.current = next;
    setAdded(next);
    setLines((ls) => ls.filter((l) => !(l.clientKey === clientKey && l.itemId === itemId && l.kind === "comment")));
    setReport((r) => (r && r.clientKey === clientKey ? { ...r, added: r.added.filter((f) => f.id !== itemId) } : r));
  };
  const ops: LineOps = { open, add, edit, del, change, remove, setOpen, enter, close, unadd };

  // Push sends the lines of the view on screen (a line on a feature the other view shows waits there).
  const onScreen = (l: Line) => !!known?.clients.some((c) => c.clientKey === l.clientKey && [...c.features, ...c.also].some((f) => f.id === l.itemId));
  const ready = pendingLines(lines, commentText).filter(onScreen);

  // ST-1: Suggest a line (once Draft): one AI request per client, or for one feature. What comes back is Suggested, never
  // a line to push: it waits in its feature's box until Add.
  const draft = async (c: StatusClient, ids: number[] | null) => {
    const k = ids ? `${c.clientKey}:${ids.join(",")}` : c.clientKey;
    setDrafting((d) => ({ ...d, [k]: true }));
    setDraftNote((n) => ({ ...n, [c.clientKey]: "" }));
    try {
      const r = await call<{ ai: string; message: string | null; drafts: { itemId: number; text: string }[]; namesRemoved?: string }>("status.draft", { clientKey: c.clientKey, ...(ids ? { itemIds: ids } : {}) });
      if (r.ai !== "ok") setDraftNote((n) => ({ ...n, [c.clientKey]: r.message ?? "AI couldn't suggest a line this time" }));
      const got = r.drafts.filter((d) => d.text.trim());
      if (r.ai === "ok" && !got.length) setDraftNote((n) => ({ ...n, [c.clientKey]: ST_WORDS.nothingToSuggest }));
      setSugg((s) => ({ ...s, ...Object.fromEntries(got.map((d) => [skey(c.clientKey, d.itemId), { itemId: d.itemId, text: d.text, source: "ai" as const, ...(r.namesRemoved ? { namesRemoved: r.namesRemoved } : {}) }])) }));
      // A new suggestion shows again on a feature where the last one was dismissed.
      setDismissed((ds) => ds.filter((x) => !got.some((d) => x === skey(c.clientKey, d.itemId))));
    } catch (e) {
      setDraftNote((n) => ({ ...n, [c.clientKey]: errText(e) }));
    } finally {
      setDrafting((d) => ({ ...d, [k]: false }));
    }
  };
  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);
  const dismiss = (k: string, id: number) => setDismissed((d) => (d.includes(skey(k, id)) ? d : [...d, skey(k, id)]));
  // Add makes it Ready to push (Edit: opened as my line with its text); either way the suggestion is used up.
  const addSugg = (c: StatusClient, f: StatusFeature, s: Suggestion, openIt: boolean) => {
    add(c, f, s.text, s.source === "ai" ? "ai" : "me", openIt);
    dismiss(c.clientKey, f.id);
  };
  const suggestView: SuggestView = { by: sugg, loading: suggLoading, dismissed: dismissedSet, onAdd: addSugg, onDismiss: dismiss, onSuggest: readOnly ? null : (c, f) => void draft(c, [f.id]), suggesting: drafting };
  /** Add all: every suggestion showing for the client becomes Ready to push. */
  const addAll = (c: StatusClient, features: StatusFeature[]) => {
    for (const f of features) {
      const s = shownSugg(suggestView, c, f);
      if (s) addSugg(c, f, s, false);
    }
  };

  const change1 = (l: Line): DevOpsChange => (l.kind === "comment" ? { key: l.key, kind: "comment", itemId: l.itemId, text: l.text.trim() } : l.kind === "comment_edit" ? { key: l.key, kind: "comment_edit", itemId: l.itemId, commentId: l.commentId!, text: l.text.trim() } : { key: l.key, kind: "comment_delete", itemId: l.itemId, commentId: l.commentId! });
  const nameOf = (k: string) => known?.clients.find((c) => c.clientKey === k)?.clientName ?? k;
  // OP-1: Push is the app's one preview: a client at a time, 10 lines at most in each preview, in the order the lines
  // were written. Each line is its own write. What happened to each comes back here, to "Pushed just now".
  const startPush = () => {
    if (!writes || !ready.length) return;
    setOpen(null);
    setPush(true);
    const parts = partsOf(ready, (l) => l.clientKey);
    const sent = new Map(ready.map((l) => [l.key, l]));
    writes.series(
      parts.map((p) => ({ clientKey: p.clientKey, changes: p.items.map(change1) })),
      (end) => {
        const results: Pushed[] = [
          ...end.results.flatMap((r) => {
            const l = r.key ? sent.get(r.key) : undefined;
            // GD-2: a line sent with "another client" written shows as it went.
            return l ? [{ key: l.key, clientKey: l.clientKey, itemId: l.itemId, text: l.kind === "comment_delete" ? l.text : (r.after ?? l.text), kind: l.kind, ok: r.confirmed, message: r.message, writeId: r.writeId }] : [];
          }),
          ...end.refused.flatMap((r) => {
            const l = sent.get(r.key);
            return l ? [{ key: l.key, clientKey: l.clientKey, itemId: l.itemId, text: l.text, kind: l.kind, ok: false, message: r.error, writeId: null }] : [];
          }),
        ];
        setPush(false);
        // A part whose preview couldn't be made (no write access, DevOps unreachable) says why.
        if (end.errors.length) setError(end.errors.join(" "));
        if (!results.length) return;
        // A line that went in leaves Not on it yet; one that didn't stays Ready to push, with its reason, for Retry.
        const ok = new Set(results.filter((x) => x.ok).map((x) => x.key));
        // GD-2: a line that didn't go in keeps the text it was sent with (after Replace, "another client").
        const sentText = new Map(results.filter((x) => !x.ok && x.kind !== "comment_delete").map((x) => [x.key, x.text]));
        setLines((ls) => ls.filter((l) => !ok.has(l.key)).map((l) => (sentText.has(l.key) ? { ...l, text: sentText.get(l.key)! } : l)));
        setPushed((p) => [...results, ...p.filter((x) => !results.some((y) => y.key === x.key))]);
        void load().then(onChanged);
      },
      { where: (k) => `${nameOf(k)}'s DevOps and Monday's report` },
    );
  };
  // Retry a write that went out but wasn't read back (the one preview's retry: it checks first and never posts twice).
  const retry = async (p: Pushed) => {
    if (p.writeId === null || !writes) return;
    const r = await writes.retry(p.writeId);
    if (!r) return;
    setPushed((all) => all.map((x) => (x.key === p.key ? { ...x, ok: r.confirmed, message: r.message } : x)));
    if (r.confirmed) setLines((ls) => ls.filter((l) => l.key !== p.key));
    await load();
  };
  // Undo is the line's own write undone, through the same preview.
  const startUndo = (p: Pushed) => {
    if (p.writeId === null || !writes) return;
    void writes.begin(p.clientKey, [{ kind: "undo", writeId: p.writeId }], (r) => {
      if (r.confirmed) setPushed((all) => all.map((x) => (x.key === p.key ? { ...x, undone: true } : x)));
      if (r.sent) void load().then(onChanged);
    });
  };
  // SR-3: Add a feature puts it in the report (in stack rank) with its line box open.
  const addFeature = async (f: CatalogFeature) => {
    if (!shownReport) return;
    const k = shownReport.clientKey;
    const next = { ...addedRef.current, [k]: [...new Set([...(addedRef.current[k] ?? []), f.id])] };
    addedRef.current = next;
    setAdded(next);
    const there = [...shownReport.features, ...shownReport.needsYou, ...shownReport.noUpdate, ...shownReport.added].some((x) => x.id === f.id);
    if (!there) await load();
    add(reportClient(shownReport), { id: f.id } as StatusFeature);
  };

  // ST-1: Show: Needs an update (the features I worked on with nothing of mine on the report) or All. It opens on Needs an
  // update when any feature needs one, else All; the counts are features.
  const needsCount = onReport ? (shownReport?.needsYou.length ?? 0) : (data?.clients.flatMap((c) => c.features).filter((f) => f.needsYou).length ?? 0);
  const allCount = onReport ? (shownReport ? new Set([...shownReport.features, ...shownReport.needsYou, ...shownReport.added, ...shownReport.noUpdate].map((f) => f.id)).size : 0) : (data?.clients.reduce((n, c) => n + c.features.length, 0) ?? 0);
  const ready0 = !!(onReport ? shownReport : data);
  useEffect(() => {
    if (ready0 && show === null) setShow(needsCount > 0 ? "needs" : "all");
  }, [ready0, show, needsCount]);
  const filter: "needs" | "all" = show === "needs" && needsCount > 0 ? "needs" : "all";
  // The nudge opens Status on the features that need an update: scroll there once they're on screen.
  const scrolled = useRef(false);
  useEffect(() => {
    if (group !== "needs" || scrolled.current) return;
    const el = document.querySelector<HTMLElement>(".st-feature.st-mine");
    if (el) {
      scrolled.current = true;
      el.scrollIntoView({ block: "start" });
      el.querySelector<HTMLElement>("[data-add-line]")?.focus({ preventScroll: true });
    }
  }, [group, data, report, filter]);

  const withUpdate = onReport ? (shownReport?.features.length ?? 0) : (data?.counts.withUpdate ?? 0);
  const ofFeatures = onReport ? allCount : (data?.counts.features ?? 0);
  const scopeSwitch = teams && teams.length > 0 ? <ScopeSwitch scope={onReport ? scope : "mine"} teams={teams} onPick={(v) => { setScope(v); setOpen(null); }} /> : null;
  const shownMode = readOnly ? "preview" : mode;
  const toggle = !readOnly && (
    <span className="st-toggle" data-tour="st-toggle" role="group" aria-label="Write or Preview">
      <button type="button" className="ms-btn" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>{ST_WORDS.write}</button>
      <button type="button" className="ms-btn" aria-pressed={mode === "preview"} onClick={() => (setOpen(null), setMode("preview"))}>{ST_WORDS.preview}</button>
    </span>
  );
  const showRow = shownMode === "edit" && ready0 && (
    <div className="st-show" data-show-row="">
      <span className="st-show-label">{ST_WORDS.show}</span>
      <span className="st-show-chips" role="group" aria-label={ST_WORDS.show}>
        {needsCount > 0 && (
          <button type="button" className={`ib4-chip${filter === "needs" ? " on" : ""}`} aria-pressed={filter === "needs"} onClick={() => setShow("needs")} data-show="needs">
            {ST_WORDS.needsUpdate} <span className="seg-count">{needsCount}</span>
          </button>
        )}
        <button type="button" className={`ib4-chip${filter === "all" ? " on" : ""}`} aria-pressed={filter === "all"} onClick={() => setShow("all")} data-show="all">
          {ST_WORDS.all} <span className="seg-count">{allCount}</span>
        </button>
      </span>
      <span className="st-updated" role="status" data-updated="">
        {ST_WORDS.updated(withUpdate, ofFeatures)}
        <span className="calls-left-bar" aria-hidden="true"><span style={{ width: `${Math.round((withUpdate / Math.max(1, ofFeatures)) * 100)}%` }} /></span>
      </span>
    </div>
  );
  // The key, once, under the header: the three states with a few words each.
  const key = shownMode === "edit" && ready0 && <StateKey />;
  // E: the one bar at the foot, only while something is Ready to push.
  const parts = partsOf(ready, (l) => l.clientKey);
  const partsSaid = partsLine(ready.length, parts.length, new Set(parts.map((p) => p.clientKey)).size, "line");
  const byClient = parts.reduce<{ name: string; n: number }[]>((out, p) => {
    const name = nameOf(p.clientKey);
    const at = out.find((x) => x.name === name);
    if (at) at.n += p.items.length;
    else out.push({ name, n: p.items.length });
    return out;
  }, []);
  const footBar = !readOnly && ready.length > 0 && (
    <div className="bl-bulk st-foot" role="region" aria-label={ST_WORDS.ready(ready.length)} data-foot-bar="">
      <strong className="st-pending-count">{ST_WORDS.ready(ready.length)}</strong>
      <span className="muted st-foot-clients">{ST_WORDS.forClients(byClient)}</span>
      {partsSaid && <span className="muted st-parts">{partsSaid}</span>}
      <button type="button" className="mini primary st-push-btn" data-tour="st-push" disabled={push || !writes} onClick={startPush}>{ST_WORDS.push}</button>
    </div>
  );
  // F: Preview's one line while lines are Ready to push: how many, Show them, Push.
  const previewTop = shownMode === "preview" && !readOnly && ready.length > 0 && (
    <p className="st-preview-top" role="status" data-preview-top="">
      <span>{ST_WORDS.notOnYet(ready.length)}</span>
      <button type="button" className="link-btn" aria-pressed={showReady} onClick={() => setShowReady(!showReady)}>{showReady ? ST_WORDS.hideThem : ST_WORDS.showThem}</button>
      <button type="button" className="mini primary" disabled={push || !writes} onClick={startPush}>{ST_WORDS.push}</button>
    </p>
  );
  const pushedList = pushed.length > 0 && <PushedList pushed={pushed} data={known} onRetry={(p) => void retry(p)} onUndo={startUndo} onClear={() => setPushed([])} />;
  const previewReady = shownMode === "preview" && showReady;

  if (onReport) {
    const r = shownReport;
    return (
      <main className={`status-view${phone ? " st-phone" : ""}`} aria-label="Status">
        <header className="page-head">
          <div className="ph-title">
            <h2>{r ? `${r.clientName} report` : "Client report"}</h2>
            {r && <span className="muted st-sends">{r.header}</span>}
          </div>
          <ModeArea>
            {toggle}
            {switcher}
          </ModeArea>
        </header>
        {scopeSwitch}
        {error && <p className="error-line" role="alert">{error}</p>}
        {!r ? (
          <p className="muted">Reading the report…</p>
        ) : (
          <>
            <div className="st-report-tools">
              <span className="muted st-fresh">Refreshed {when(r.refreshedAt, tz)}</span>
              <button type="button" className="mini quiet" disabled={refreshing} onClick={() => void refresh()} title="Check DevOps now (R)">{refreshing ? "Refreshing…" : "Refresh"}</button>
              {said && <span className="muted st-refreshed" role="status">{said}</span>}
            </div>
            {showRow}
            {key}
            {previewTop}
            {pushedList}
            <ReportSection r={r} color={clientColor(r.clientKey, colors)} mode={shownMode} readOnly={readOnly} lines={lines.filter((l) => l.clientKey === r.clientKey)} ops={ops} sugg={suggestView} suggNote={suggNote[r.clientKey] ?? ""} onAddFeature={(f) => void addFeature(f)} filter={filter} showReady={previewReady} onAddAll={addAll} />
          </>
        )}
        {footBar}
      </main>
    );
  }

  return (
    <main className={`status-view${phone ? " st-phone" : ""}`} aria-label="Status">
      <header className="page-head">
        <div className="ph-title">
          <h2>{ST_WORDS.title}</h2>
          <span className="muted st-sends">{data ? ST_WORDS.forMonday(mondayWords(data.reportDate), sendsWords(data.sends)) : ""}</span>
        </div>
        <ModeArea>
          {toggle}
          {switcher}
        </ModeArea>
      </header>
      {scopeSwitch}
      {error && <p className="error-line" role="alert">{error}</p>}
      {!data ? (
        <p className="muted">Reading this week's comments…</p>
      ) : (
        <>
          {showRow}
          {key}
          {previewTop}
          {pushedList}
          {!data.clients.length && <p className="muted">No clients with DevOps this week. The features you plan or work on show here.</p>}
          {data.clients.map((c) => (
            <ClientSection key={c.clientKey} c={c} color={clientColor(c.clientKey, colors)} mode={shownMode} lines={lines.filter((l) => l.clientKey === c.clientKey)} drafting={drafting} draftNote={draftNote[c.clientKey] ?? ""} ops={ops} sugg={suggestView} suggNote={suggNote[c.clientKey] ?? ""} onDraft={(ids) => void draft(c, ids)} onAddAll={addAll} filter={filter} showReady={previewReady} />
          ))}
        </>
      )}
      {footBar}
    </main>
  );
}

/** ST-1: the key under the header: the three states, each in its own look, with a few words. */
function StateKey() {
  return (
    <ul className="st-key" aria-label="What each line is">
      {LINE_STATES.map((s) => (
        <li key={s} className={`st-key-item st-state-${s}`} data-state={s}>
          <span className="st-key-mark" aria-hidden="true" />
          <strong>{STATE_NAME[s]}</strong> <span className="muted">{STATE_KEY[s]}</span>
        </li>
      ))}
    </ul>
  );
}

/** SR-2: My features · <Client> report. With several clients, the report side is a picker of the clients I'm on. */
function ScopeSwitch({ scope, teams, onPick }: { scope: string; teams: ReportClientRef[]; onPick: (v: string) => void }) {
  const current = teams.find((t) => t.clientKey === scope) ?? null;
  return (
    <div className="st-scope" role="group" aria-label="Whose report">
      <button type="button" className="ms-btn" aria-pressed={scope === "mine"} onClick={() => onPick("mine")}>My features</button>
      {teams.length === 1 ? (
        <button type="button" className="ms-btn" aria-pressed={!!current} onClick={() => onPick(teams[0]!.clientKey)}>{teams[0]!.clientName} report</button>
      ) : (
        <select className={`st-scope-pick${current ? " on" : ""}`} aria-label="Client report" value={current?.clientKey ?? ""} onChange={(e) => e.target.value && onPick(e.target.value)}>
          {!current && <option value="">Client report…</option>}
          {teams.map((t) => <option key={t.clientKey} value={t.clientKey}>{t.clientName} report</option>)}
        </select>
      )}
    </div>
  );
}

/**
 * SR-2: the client's report. Preview reads as Kat's email (a heading per feature in backlog order, each comment a
 * bullet with its author as DevOps shows it, then Upcoming PTO and Holidays). Write is the same feature rows as My
 * features on every feature in it. SR-3: the features I worked on first, features I added in their stack-rank place,
 * Add a feature over the whole project. ST-1: Preview shows only what is On the report.
 */
function ReportSection({ r, color, mode, readOnly, lines, ops, sugg, suggNote, onAddFeature, filter, showReady, onAddAll }: {
  r: StatusReport; color: string; mode: "edit" | "preview"; readOnly: boolean; lines: Line[]; ops: LineOps; sugg: SuggestView; suggNote: string; onAddFeature: (f: CatalogFeature) => void;
  filter: "needs" | "all"; showReady: boolean; onAddAll: (c: StatusClient, features: StatusFeature[]) => void;
}) {
  const c = reportClient(r);
  const writable = !readOnly && r.canWrite;
  const needsIds = new Set(r.needsYou.map((f) => f.id));
  const owner = (f: ReportFeature) => ({ owner: f.owner, authorAs: r.authorAs });
  const zone = useContext(ZoneCtx);
  const sentTitle = r.window.source === "kat" && r.window.katSentAt ? `Kat last sent ${r.clientName}'s report ${when(r.window.katSentAt, zone)}` : (r.window.note ?? undefined);
  if (mode === "preview") {
    // ST-1: only what is in DevOps now; Show them adds the features that have only Ready to push lines, drawn as such.
    const list = showReady ? previewFeatures<ReportFeature>(r.features, [...r.needsYou, ...r.added, ...r.noUpdate], lines) : r.features;
    return (
      <section className="st-client st-report st-email" style={{ "--c": color } as CSSProperties} aria-label={`${r.clientName} report`}>
        <header className="st-client-head"><h3 className="carry-client-name" title={sentTitle}><span className="swatch" aria-hidden="true" />{r.clientName}</h3></header>
        {r.message && <p className="set-problem">{r.message}</p>}
        {r.status === "ok" && !list.length && <p className="muted">No feature has a comment since Kat's last send yet, so Monday's report has no features so far.</p>}
        <div className="st-features">
          {list.map((f) => <FeatureBlock key={f.id} c={c} f={f} mode="preview" lines={lines.filter((l) => l.itemId === f.id)} ops={ops} report={owner(f)} showReady={showReady} />)}
        </div>
        <PtoBlock pto={r.pto} />
      </section>
    );
  }
  // Write: the features I worked on first; the report's own and the ones I added in stack rank; then PTO and No update yet.
  const body = filter === "needs" ? [] : [...r.features.filter((f) => !needsIds.has(f.id)), ...r.added.filter((f) => !needsIds.has(f.id))].sort(byRank);
  const addedIds = new Set(r.added.map((f) => f.id));
  // Already on screen (with their own Write a line), so not offered again.
  const shownIds = new Set([...r.features, ...r.needsYou, ...r.added, ...r.noUpdate].map((f) => f.id));
  const updated = r.features.length;
  const suggs = writable ? [...r.needsYou, ...body].filter((f) => shownSugg(sugg, c, f)) : [];
  return (
    <section className="st-client st-report" style={{ "--c": color } as CSSProperties} aria-label={`${r.clientName} report`}>
      <header className="st-client-head">
        <h3 className="carry-client-name" title={sentTitle}><span className="swatch" aria-hidden="true" />{r.clientName}</h3>
        <span className="muted st-client-count">{ST_WORDS.clientUpdated(updated, shownIds.size)}</span>
        <span className="st-client-acts">
          {suggs.length >= 2 && <button type="button" className="mini" onClick={() => onAddAll(c, suggs)}>{ST_WORDS.addAll}</button>}
          {writable && r.status === "ok" && <AddFeature catalog={r.catalog} shown={shownIds} onPick={onAddFeature} />}
        </span>
      </header>
      {r.message && <p className="set-problem">{r.message}</p>}
      {!r.canWrite && r.status === "ok" && <p className="muted st-note">Read only: add your DevOps write access for {r.clientName} in <a href="#/settings/connections/devops-write">Settings › Connections › DevOps</a> to add lines here.</p>}
      {suggNote && <p className="muted st-note" role="status">{suggNote}</p>}
      {r.status === "ok" && !body.length && !r.needsYou.length && <p className="muted">No feature has a comment since Kat's last send yet, so Monday's report has no features so far.</p>}
      <div className="st-features">
        {r.needsYou.map((f) => (
          <FeatureBlock key={f.id} c={c} f={f} mode="edit" lines={lines.filter((l) => l.itemId === f.id)} ops={ops} report={owner(f as ReportFeature)} writableOverride={writable} sugg={sugg} />
        ))}
        {body.map((f) => (
          <FeatureBlock key={f.id} c={c} f={f} mode="edit" lines={lines.filter((l) => l.itemId === f.id)} ops={ops} report={owner(f)} writableOverride={writable} added={addedIds.has(f.id)} sugg={sugg} />
        ))}
      </div>
      {filter === "all" && <PtoBlock pto={r.pto} />}
      {filter === "all" && r.noUpdate.some((f) => !needsIds.has(f.id)) && <NoUpdateList r={r} c={c} writable={writable} lines={lines} ops={ops} skip={needsIds} />}
    </section>
  );
}

/** SR-3: Add a feature: AH-5's filterable list over every feature of the client, whoever owns it (title or #id). */
function AddFeature({ catalog, shown, onPick }: { catalog: CatalogFeature[]; shown: ReadonlySet<number>; onPick: (f: CatalogFeature) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => (setOpen(false), requestAnimationFrame(() => btn.current?.focus()));
  const options = catalog.filter((f) => !shown.has(f.id)).map((f) => ({ key: String(f.id), label: f.title, sub: `#${f.id} · ${f.state}${f.closed ? " (closed)" : ""} · ${f.owner ?? "No owner"}`, search: `${f.id} #${f.id} ${f.title}` }));
  return (
    <>
      <button ref={btn} type="button" className="mini st-add-feature" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="add" /> Add a feature</button>
      {open && (
        <CellPopover anchor={btn.current} title="Add a feature" sub="Any of this client's features, whoever owns it" onSave={close} onCancel={close} saveLabel="Done" className="ah-pop-list st-add-pop">
          <FilterList label="Add a feature" placeholder="Title or #id" options={options} current={null} empty="No feature matches" onPick={(k) => { const f = catalog.find((x) => String(x.id) === k); close(); if (f) onPick(f); }} />
        </CellPopover>
      )}
    </>
  );
}

function PtoBlock({ pto }: { pto: StatusReport["pto"] }) {
  return (
    <section className="st-pto" aria-label="Upcoming PTO and Holidays">
      <h4>Upcoming PTO and Holidays</h4>
      {pto.rows.length ? (
        <ul className="st-bullets">
          {pto.rows.map((x) => <li key={`${x.kind}${x.name}${x.when}`} className={x.kind === "holiday" ? "st-holiday" : undefined}>{x.name} <span className="st-author">· {x.when}</span></li>)}
        </ul>
      ) : pto.ptoRead || pto.holidaysRead ? (
        <p className="st-none">{pto.ptoRead && pto.holidaysRead ? `No one on the team is away and no holidays, ${pto.range}` : pto.ptoRead ? `No one on the team is away ${pto.range}` : `No holidays ${pto.range}`}</p>
      ) : null}
      {pto.notes.map((n) => <p key={n} className="set-problem st-line">{n}</p>)}
      <p className="muted st-note">{pto.source}.</p>
    </section>
  );
}

/** Active this week with nothing in the window: folded, each with its owner and Write a line. */
function NoUpdateList({ r, c, writable, lines, ops, skip }: { r: StatusReport; c: StatusClient; writable: boolean; lines: Line[]; ops: LineOps; skip: ReadonlySet<number> }) {
  const rows = r.noUpdate.filter((f) => !skip.has(f.id));
  const open = lines.some((l) => rows.some((f) => f.id === l.itemId));
  return (
    <details className="st-also st-noupdate" open={open || undefined}>
      <summary>{ST_WORDS.noUpdate} ({rows.length})</summary>
      <ul className="st-nu-list">
        {rows.map((f: NoUpdateFeature) => {
          const mine = lines.filter((l) => l.itemId === f.id && l.kind === "comment");
          return (
            <li key={f.id} className="st-nu" data-feature={f.id}>
              <span className="st-nu-head">
                <WorkLink clientKey={r.clientKey} url={f.url} className="st-title">{f.title}</WorkLink>
                <span className="muted st-meta">#{f.id} · {f.owner ? `Owner ${f.owner}` : "No owner"} · {f.active === "planned" ? "on this week's plan" : "story activity this week"}</span>
                {writable && f.thisWeek !== null && <AddLineButton onAdd={() => ops.add(c, f)} />}
              </span>
              {f.thisWeek === null && <span className="set-problem st-line">Its comments couldn't be read</span>}
              {mine.map((l) => <LineRow key={l.key} line={l} label={`New line for ${f.title}`} ops={ops} authorAs={r.authorAs} />)}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function ClientSection({ c, color, mode, lines, drafting, draftNote, ops, sugg, suggNote, onDraft, onAddAll, filter, showReady }: {
  c: StatusClient; color: string; mode: "edit" | "preview"; lines: Line[]; drafting: Record<string, boolean>; draftNote: string; ops: LineOps; sugg: SuggestView; suggNote: string; onDraft: (ids: number[] | null) => void;
  onAddAll: (c: StatusClient, features: StatusFeature[]) => void; filter: "needs" | "all"; showReady: boolean;
}) {
  const zone = useContext(ZoneCtx);
  // The time Kat last sent stays on hover of the client's name.
  const sent = c.window.source === "kat" && c.window.katSentAt ? `Kat last sent ${c.clientName}'s report ${when(c.window.katSentAt, zone)}` : (c.window.note ?? undefined);
  const canDraft = mode === "edit" && c.canWrite && c.ai === "ok" && c.features.length > 0;
  const needs = mode === "edit" ? c.features.filter((f) => f.needsYou) : [];
  const rest = mode === "edit" ? (filter === "needs" ? [] : c.features.filter((f) => !f.needsYou)) : c.features;
  if (mode === "edit" && filter === "needs" && !needs.length) return null;
  const updated = c.features.filter((f) => (f.thisWeek ?? []).length > 0).length;
  const suggs = mode === "edit" && c.canWrite ? [...needs, ...rest].filter((f) => shownSugg(sugg, c, f)) : [];
  return (
    <section className={`st-client${mode === "preview" ? " st-email" : ""}`} style={{ "--c": color } as CSSProperties} aria-label={c.clientName}>
      <header className="st-client-head">
        <h3 className="carry-client-name" title={sent}>
          <span className="swatch" aria-hidden="true" />
          {c.clientName}
        </h3>
        {mode === "edit" && c.features.length > 0 && <span className="muted st-client-count">{ST_WORDS.clientUpdated(updated, c.features.length)}</span>}
        <span className="st-client-acts">
          {suggs.length >= 2 && <button type="button" className="mini" onClick={() => onAddAll(c, suggs)}>{ST_WORDS.addAll}</button>}
          {canDraft && (
            <button type="button" className="mini" data-tour="st-draft" disabled={!!drafting[c.clientKey]} onClick={() => onDraft(null)} title={`A suggested line for every ${c.clientName} feature, from this week's activity (one AI request)`}>
              {drafting[c.clientKey] ? ST_WORDS.suggesting : ST_WORDS.suggestAll}
            </button>
          )}
        </span>
      </header>
      {c.status !== "ok" ? <p className="set-problem">{c.message}</p> : c.message && <p className="set-problem">{c.message}</p>}
      {mode === "edit" && draftNote && <p className="muted st-note" role="status">{draftNote}</p>}
      {mode === "edit" && suggNote && <p className="muted st-note" role="status">{suggNote}</p>}
      {mode === "edit" && !c.canWrite && c.features.length > 0 && <p className="muted st-note">Read only: add your DevOps write access for {c.clientName} in <a href="#/settings/connections/devops-write">Settings › Connections › DevOps</a> to write here.</p>}
      {c.status === "ok" && !c.features.length && <p className="muted">Nothing planned or worked on for {c.clientName} this week.</p>}
      <div className="st-features">
        {[...needs, ...rest].map((f) => (
          <FeatureBlock key={f.id} c={c} f={f} mode={mode} lines={lines.filter((l) => l.itemId === f.id)} ops={ops} sugg={sugg} showReady={showReady} suggesting={!!drafting[skey(c.clientKey, f.id)] || !!drafting[c.clientKey]} />
        ))}
      </div>
      {mode === "edit" && filter === "all" && c.also.length > 0 && (
        <details className="st-also">
          <summary>Also assigned to you ({c.also.length})</summary>
          <p className="muted st-note">Not on this week's plan and no story touched. They show in Monday's report only if someone comments.</p>
          <div className="st-features">
            {c.also.map((f) => (
              <FeatureBlock key={f.id} c={c} f={f} mode={mode} lines={lines.filter((l) => l.itemId === f.id)} ops={ops} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** Write a line (RS-1: the Add icon and the words): Tab from it goes to the next feature's, Shift+Tab to the previous one's. */
function AddLineButton({ onAdd, label = ST_WORDS.writeLine }: { onAdd: () => void; label?: string }) {
  return (
    <button type="button" className="mini st-add" data-add-line="" data-tour="st-add" onClick={onAdd} onKeyDown={(e) => { if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey && moveToAdd(e.currentTarget, e.shiftKey)) e.preventDefault(); }}>
      <Icon name="add" /> {label}
    </button>
  );
}

/** "Tue" for a comment's day, the full time on hover. */
function Day({ at }: { at: string }) {
  const zone = useContext(ZoneCtx) ?? Temporal.Now.timeZoneId();
  let day = "";
  try {
    day = Temporal.Instant.from(at).toZonedDateTimeISO(zone).toLocaleString("en-US", { weekday: "short" });
  } catch {
    day = "";
  }
  return <time dateTime={at} title={stampText(at, zone)}>{day}</time>;
}

/**
 * ST-1: a feature in two labelled parts. On Monday's report: what is in DevOps now, one sentence a line with who wrote
 * it and the day, Edit and Delete on mine. Not on it yet (Write only, on a slightly different ground under a dashed
 * rule): my Ready to push lines, then the suggestion, then Write a line and Suggest a line. The head: title, number and
 * state, one tag ("Needs an update"), and See last week's lines.
 */
function FeatureBlock({ c, f, mode, lines, ops, report, writableOverride, added, sugg, showReady, suggesting }: {
  c: StatusClient; f: StatusFeature; mode: "edit" | "preview"; lines: Line[]; ops: LineOps;
  /** SR-2: on the client report, authors as DevOps shows them, the owner, and who a new line shows as. */
  report?: { owner: string | null; authorAs: string | null };
  writableOverride?: boolean;
  /** SR-3: added with Add a feature (Remove takes it out while it has no line). */
  added?: boolean;
  sugg?: SuggestView;
  /** ST-1: Preview's Show them: the Ready to push lines drawn in place with their own look. */
  showReady?: boolean;
  suggesting?: boolean;
}) {
  const [last, setLast] = useState(false);
  const [basis, setBasis] = useState(false);
  const comments = f.thisWeek ?? [];
  const newLines = lines.filter((l) => l.kind === "comment");
  const editOf = (id: number) => lines.find((l) => l.kind === "comment_edit" && l.commentId === id);
  const delOf = (id: number) => lines.find((l) => l.kind === "comment_delete" && l.commentId === id);
  const writable = mode === "edit" && (writableOverride ?? c.canWrite);
  const readyLines = lines.filter((l) => l.text.trim() || ops.open === l.key);
  const authorOf = (cm: StatusComment) => cm.author;

  if (mode === "preview") {
    // ST-1: as Monday's email reads if it were sent now: only what is in DevOps. Show them draws the Ready to push lines
    // in place, in their own look, never as the report's own bullets.
    const shown = showReady ? lines.filter((l) => l.text.trim()) : [];
    return (
      <article className="st-feature" aria-label={f.title}>
        <h4><WorkLink clientKey={c.clientKey} url={f.url} className="st-title">{f.title}</WorkLink></h4>
        {f.thisWeek === null ? (
          <p className="set-problem st-line">Comments couldn't be read</p>
        ) : comments.length ? (
          <ul className="st-bullets">
            {comments.map((cm) => <li key={cm.id} data-state="on_report">{cm.text} <span className="st-author">· {authorOf(cm)}</span></li>)}
          </ul>
        ) : (
          <p className="st-none">{ST_WORDS.noUpdate}</p>
        )}
        {shown.length > 0 && (
          <div className="st-ready-list">
            {shown.map((l) => <ReadyLine key={l.key} line={l} />)}
          </div>
        )}
      </article>
    );
  }

  const s = writable ? shownSugg(sugg, c, f) : undefined;
  const sLoading = !!(writable && sugg && f.needsYou && sugg.loading[skey(c.clientKey, f.id)] && !s);
  const mineOnReport = comments.some((cm) => cm.who === "mine");
  const needsTag = !!f.needsYou && !mineOnReport && !readyLines.length;
  const canSuggest = writable && !!sugg?.onSuggest && c.ai === "ok";
  return (
    <article className={`st-feature${f.needsYou ? " st-mine" : ""}`} aria-label={f.title} data-feature={f.id}>
      <div className="st-feature-head">
        <h4><WorkLink clientKey={c.clientKey} url={f.url} className="st-title">{f.title}</WorkLink></h4>
        <span className="muted st-meta">#{f.id} · {f.state}{report ? ` · ${report.owner ? `Owner ${report.owner}` : "No owner"}` : ""}</span>
        {needsTag && <span className="st-badge" title={f.you ? `You worked on this: ${f.you.line}` : undefined}>{ST_WORDS.needsUpdate}</span>}
        {f.lastWeek.length > 0 && <button type="button" className="link-btn st-last-link" aria-expanded={last} onClick={() => setLast(!last)}>{last ? ST_WORDS.hideLastWeek : ST_WORDS.lastWeek}</button>}
      </div>
      {last && (
        <ul className="st-bullets st-last" aria-label="Last week's lines">
          {f.lastWeek.map((cm) => <li key={cm.id}>{cm.text} <span className="st-author">· {authorOf(cm)}, <Day at={cm.at} /></span></li>)}
        </ul>
      )}
      {f.thisWeek === null && <p className="set-problem st-line">This feature's comments couldn't be read. Try again in a minute.</p>}
      {f.thisWeek !== null && (
        <section className="st-part st-on" aria-label={ST_WORDS.onReport}>
          <h5 className="st-part-label">{ST_WORDS.onReport} <span className="st-part-count">· {ST_WORDS.onReportCount(comments.length)}</span></h5>
          {comments.length > 0 && (
            <ul className="st-bullets st-comments">
              {comments.map((cm) => {
                const mineEditable = writable && cm.editable;
                const busy = !!editOf(cm.id) || !!delOf(cm.id);
                return (
                  <li key={cm.id} className={`st-comment who-${cm.who}`} data-state="on_report">
                    <span className="st-text">{cm.text}</span>{" "}
                    <span className="st-by">
                      <span className="st-author">· {authorOf(cm)}, <Day at={cm.at} /></span>
                      {mineEditable && !busy && <button type="button" className="link-btn" onClick={() => ops.edit(c, f, cm)}>{ST_WORDS.edit}</button>}
                      {mineEditable && !busy && <button type="button" className="link-btn" onClick={() => ops.del(c, f, cm)}>{ST_WORDS.delete}</button>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {writable && f.thisWeek !== null && (
        <section className="st-part st-notyet" aria-label={ST_WORDS.notYet}>
          <h5 className="st-part-label">{ST_WORDS.notYet}</h5>
          {readyLines.map((l) => <LineRow key={l.key} line={l} label={l.kind === "comment_edit" ? `Edit your comment on ${f.title}` : `New line for ${f.title}`} ops={ops} {...(report ? { authorAs: report.authorAs } : {})} />)}
          {(s || sLoading) && <SuggestionCard s={s ?? null} hints={f.hints} open={basis} onBasis={() => setBasis(!basis)} onAdd={() => s && sugg!.onAdd(c, f, s, false)} onEdit={() => s && sugg!.onAdd(c, f, s, true)} onDismiss={() => sugg!.onDismiss(c.clientKey, f.id)} />}
          <span className="st-adds">
            <AddLineButton onAdd={() => ops.add(c, f)} />
            {canSuggest && <button type="button" className="mini quiet" disabled={!!suggesting} onClick={() => sugg!.onSuggest!(c, f)}>{suggesting ? ST_WORDS.suggesting : ST_WORDS.suggestLine}</button>}
            {added && !newLines.some((l) => l.text.trim()) && ops.unadd && <button type="button" className="link-btn" onClick={() => ops.unadd!(c.clientKey, f.id)}>Remove from the report</button>}
          </span>
          {!s && f.hints.length > 0 && <Basis hints={f.hints} />}
        </section>
      )}
      {!writable && f.hints.length > 0 && <Basis hints={f.hints} />}
    </article>
  );
}

/** What a suggestion is made from (what What a draft uses showed): this week's activity, folded. */
function Basis({ hints }: { hints: string[] }) {
  return (
    <details className="st-hints">
      <summary>{ST_WORDS.workedOn(hints.length)}</summary>
      <ul>{hints.map((h) => <li key={h}>{h}</li>)}</ul>
    </details>
  );
}

/** ST-1: a Suggested line: a dashed blue box, "Suggested", the text, one quiet link to what it was based on, Add, Edit, Dismiss. */
function SuggestionCard({ s, hints, open, onBasis, onAdd, onEdit, onDismiss }: { s: Suggestion | null; hints: string[]; open: boolean; onBasis: () => void; onAdd: () => void; onEdit: () => void; onDismiss: () => void }) {
  if (!s) return <div className="st-sugg st-state-suggested st-sugg-loading" role="status" data-state="suggested"><span className="st-sugg-label">{STATE_NAME.suggested}</span><span className="muted">{ST_WORDS.writing}</span></div>;
  return (
    <div className={`st-sugg st-state-suggested${s.source === "template" ? " st-sugg-template" : ""}`} role="group" aria-label={`${STATE_NAME.suggested}: ${s.text}`} data-state="suggested">
      <span className="st-sugg-label">{STATE_NAME.suggested}</span>
      <p className="st-sugg-text">{s.text}</p>
      <span className="st-sugg-actions">
        <button type="button" className="mini" onClick={onAdd}>{ST_WORDS.add}</button>
        <button type="button" className="mini quiet" onClick={onEdit}>{ST_WORDS.edit}</button>
        <button type="button" className="link-btn" onClick={onDismiss}>{ST_WORDS.dismiss}</button>
      </span>
      {s.namesRemoved && <p className="st-sugg-note" role="note">{s.namesRemoved}</p>}
      {hints.length > 0 && <button type="button" className="link-btn st-basis" aria-expanded={open} onClick={onBasis}>{ST_WORDS.basedOn(hints.length)}</button>}
      {open && hints.length > 0 && <ul className="st-basis-list">{hints.map((h) => <li key={h}>{h}</li>)}</ul>}
    </div>
  );
}

/** ST-1: a Ready to push line as Preview's Show them draws it: the amber edge and its name, never a report bullet. */
function ReadyLine({ line }: { line: Line }) {
  const note = line.kind === "comment_edit" ? LINE_NOTE.edit : line.kind === "comment_delete" ? LINE_NOTE.delete : null;
  return (
    <div className="st-pending-line st-state-ready" data-state="ready" aria-label={`${STATE_NAME.ready}: ${line.text}`}>
      <span className="st-text">{line.text}</span>
      <span className="st-box-foot"><span className="st-pending-tag">{STATE_NAME.ready}{note ? ` · ${note}` : ""}</span></span>
    </div>
  );
}

/** A Ready to push line: its box while open (edited in place), else the line with Remove, until Push. */
function LineRow({ line, label, ops, authorAs }: { line: Line; label: string; ops: LineOps; authorAs?: string | null }) {
  if (ops.open === line.key) return <LineBox line={line} label={label} ops={ops} {...(authorAs !== undefined ? { authorAs } : {})} />;
  if (!line.text.trim()) return null;
  const note = line.kind === "comment_edit" ? LINE_NOTE.edit : line.kind === "comment_delete" ? LINE_NOTE.delete : null;
  const del = line.kind === "comment_delete";
  return (
    <div className={`st-pending-line st-state-ready${del ? " st-deleting" : ""}`} data-state="ready">
      {del ? (
        <span className="st-text">{line.text}</span>
      ) : (
        <button type="button" className="st-text st-text-edit" title="Click to edit" aria-label={`${label}, ${STATE_NAME.ready}: ${line.text}. Click to edit`} onClick={() => ops.setOpen(line.key)}>{line.text}</button>
      )}
      <span className="st-box-foot">
        <span className="st-pending-tag">{STATE_NAME.ready}{note ? ` · ${note}` : ""}</span>
        <button type="button" className="link-btn" onClick={() => ops.remove(line.key)}>{del ? ST_WORDS.keep : ST_WORDS.remove}</button>
      </span>
    </div>
  );
}

function LineBox({ line, label, ops, authorAs }: { line: Line; label: string; ops: LineOps; /** SR-2: who the report will show as its author. */ authorAs?: string | null }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.focus({ preventScroll: false });
    t.setSelectionRange(t.value.length, t.value.length);
  }, []);
  // GD-2 point 6: these lines feed the client's status report; another client's name is flagged as I type (a pause).
  const [flag, setFlag] = useState<{ names: string[]; replaced: string } | null>(null);
  useEffect(() => {
    const text = line.text.trim();
    if (text.length < 3) return void setFlag(null);
    let live = true;
    const t = window.setTimeout(() => {
      call<{ names: string[]; replaced: string[] }>("boundary.check", { clientKey: line.clientKey, texts: [line.text] }).then(
        (r) => live && setFlag(r.names.length ? { names: r.names, replaced: r.replaced[0] ?? line.text } : null),
        () => live && setFlag(null),
      );
    }, 500);
    return () => ((live = false), window.clearTimeout(t));
  }, [line.text, line.clientKey]);
  // SR-3: Enter adds the line and opens the next (Shift+Enter: a new line in this comment); Esc closes; Tab goes on to
  // the next feature's Write a line (Shift+Tab: the previous one's).
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      ops.close(line.key);
      const id = line.itemId;
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-feature="${id}"] [data-add-line]`)?.focus());
      return;
    }
    if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (moveToAdd(e.currentTarget, e.shiftKey)) {
        e.preventDefault();
        ops.close(line.key);
      }
    }
  };
  return (
    <div className={`st-box st-state-ready${line.kind === "comment_edit" ? " st-editing" : ""}`} data-state="ready">
      <TextBox ref={ref} aria-label={label} minRows={1} maxRows={10} maxLength={4000} value={line.text} placeholder={ST_WORDS.placeholder} onChange={(e) => ops.change(line.key, { text: e.target.value, from: "me" })} onKeyDown={keys} onEnter={() => ops.enter(line.key)} />
      {flag && <MentionFlag names={flag.names} where="this client's status report" onReplace={() => ops.change(line.key, { text: flag.replaced, from: "me" })} />}
      <span className="st-box-foot">
        <span className="muted">{line.kind === "comment_edit" ? ST_WORDS.editHint : ST_WORDS.lineHint}{authorAs !== undefined ? ` · ${ST_WORDS.showsAs(authorAs)}` : ""}</span>
        <button type="button" className="link-btn" onClick={() => ops.remove(line.key)}>{line.kind === "comment_edit" ? "Cancel edit" : ST_WORDS.remove}</button>
      </span>
    </div>
  );
}

function featureTitle(data: Known | null, clientKey: string, itemId: number): string {
  const c = data?.clients.find((x) => x.clientKey === clientKey);
  return [...(c?.features ?? []), ...(c?.also ?? [])].find((f) => f.id === itemId)?.title ?? `#${itemId}`;
}

/** Pushed just now: each line in the state it is really in (On the report, or Ready to push with why), Undo and Retry. */
function PushedList({ pushed, data, onRetry, onUndo, onClear }: { pushed: Pushed[]; data: Known | null; onRetry: (p: Pushed) => void; onUndo: (p: Pushed) => void; onClear: () => void }) {
  return (
    <section className="st-pushed" aria-label="Pushed">
      <header className="st-pushed-head">
        <h3>Pushed just now</h3>
        <button type="button" className="link-btn" onClick={onClear}>Hide</button>
      </header>
      <ul>
        {pushed.map((p) => (
          <li key={p.key} className={p.ok ? "ok" : "bad"} data-state={!p.ok ? "ready" : p.undone || p.kind === "comment_delete" ? undefined : "on_report"}>
            <span className="st-pushed-what">{featureTitle(data, p.clientKey, p.itemId)}: {p.kind === "comment_delete" ? "deleted " : ""}{p.text.length > 90 ? `${p.text.slice(0, 89)}…` : p.text}</span>
            <span className={p.ok ? "muted" : "set-problem"}>{p.undone ? LINE_NOTE.undone : !p.ok ? `${STATE_NAME.ready} · ${LINE_NOTE.failed(p.message)}` : p.kind === "comment_delete" ? p.message : `${STATE_NAME.on_report} · ${p.message}`}</span>
            {!p.ok && p.writeId !== null && <button type="button" className="mini" onClick={() => onRetry(p)}>Retry</button>}
            {p.ok && !p.undone && p.writeId !== null && <button type="button" className="mini quiet" onClick={() => onUndo(p)}>Undo</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
