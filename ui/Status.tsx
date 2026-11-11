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
// the features I worked on with no update of mine float to Needs your update with an "AI suggests" line (or a plain
// "Worked on" line with AI off) to Use, Edit or Dismiss; holidays join the PTO; the phone can do all of it.
import { TextBox } from "./TextBox.tsx";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ComponentProps, type KeyboardEvent } from "react";
import type { CatalogFeature, NoUpdateFeature, ReportClientRef, ReportFeature, StatusClient, StatusComment, StatusFeature, StatusLoad, StatusReport, StatusReportAnswer } from "../plan/status-types.ts";
import type { DevOpsPreview, DevOpsResult } from "../actions/types.ts";
import { call } from "./api.ts";
import type { DotSchedule } from "../plan/status-dot.ts";
import { CellPopover, FilterList } from "./CellPopover.tsx";
import { CloseButton } from "./CloseButton.tsx";
import { MentionFlag, Modal } from "./DevOpsWrite.tsx";
import { clientColor } from "./labels.ts";
import { Stamp } from "./Stamp.tsx";
import { stampText } from "./stamp.ts";
import { ModeArea } from "./ModeSwitch.tsx";
import { WorkLink } from "./WorkLink.tsx";
import { byRank, closeLine, enterLine, needsLabel, pendingLabel, pendingLines, previewFeatures, type Line } from "./status-lines.ts";

export type { Line } from "./status-lines.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

type Refused = { itemId: number | null; error: string; code: string | null; key?: string };
type Batch = { previews: DevOpsPreview[]; nothing: string[]; refused: Refused[] };
/** A line that went to DevOps: its write (for Undo) and how it ended. */
type Pushed = { key: string; clientKey: string; itemId: number; text: string; kind: Line["kind"]; ok: boolean; message: string; writeId: number | null; undone?: boolean };
/** SR-3: one suggested line for a feature I worked on: the AI's, or the plain template. */
type Suggestion = { itemId: number; text: string; source: "ai" | "template" };
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
const BATCH = 10;
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
/** SR-3: the suggestion state the rows read: by "client:item", and which are dismissed. */
type SuggestView = { by: Record<string, Suggestion>; loading: Record<string, boolean>; dismissed: ReadonlySet<string>; onDismiss: (clientKey: string, itemId: number) => void };

export function StatusView(p: ComponentProps<typeof StatusBody>) {
  return (
    <ZoneCtx.Provider value={p.tz}>
      <StatusBody {...p} />
    </ZoneCtx.Provider>
  );
}

function StatusBody({ tz, switcher, colors, readOnly, version, onChanged, group, phone }: { /** IB-2: the person's time zone. */ tz: string; switcher?: React.ReactNode; colors: Record<string, string>; readOnly: boolean; version: unknown; onChanged: () => void; /** SR-3: open on Needs your update (the nudge). */ group?: "needs" | undefined; phone?: boolean }) {
  const [data, setData] = useState<StatusLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">(readOnly ? "preview" : "edit");
  const [lines, setLines] = useState<Line[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<Record<string, boolean>>({});
  const [draftNote, setDraftNote] = useState<Record<string, string>>({});
  const [push, setPush] = useState<{ batches: { clientKey: string; batch: Batch; lines: Line[] }[]; busy: boolean; results: Pushed[] | null } | null>(null);
  const [pushed, setPushed] = useState<Pushed[]>([]);
  const [undoing, setUndoing] = useState<{ p: Pushed; preview: DevOpsPreview | null; busy: boolean; error: string | null; done: string | null } | null>(null);
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
  const refresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };
  const shownReport = onReport && report?.clientKey === scope ? report : null;
  const known: Known | null = onReport ? (shownReport ? reportKnown(shownReport) : null) : data;

  // SR-3: Needs your update, by client: the features and an "AI suggests" line for each, asked once per page per client.
  const needs: { clientKey: string; ids: number[] }[] = useMemo(() => (onReport ? (shownReport ? [{ clientKey: shownReport.clientKey, ids: shownReport.needsYou.map((f) => f.id) }] : []) : (data?.clients ?? []).map((c) => ({ clientKey: c.clientKey, ids: c.features.filter((f) => f.needsYou).map((f) => f.id) }))).filter((n) => n.ids.length), [onReport, shownReport, data]);
  useEffect(() => {
    if (readOnly) return;
    for (const n of needs) {
      const ask = n.ids.filter((id) => !asked.current.has(`${n.clientKey}:${id}`));
      if (!ask.length) continue;
      for (const id of ask) asked.current.add(`${n.clientKey}:${id}`);
      setSuggLoading((s) => ({ ...s, ...Object.fromEntries(ask.map((id) => [`${n.clientKey}:${id}`, true])) }));
      void call<SuggestAnswer>("status.suggest", { clientKey: n.clientKey, itemIds: ask.slice(0, 40) }).then(
        (r) => {
          setSugg((s) => ({ ...s, ...Object.fromEntries(r.suggestions.filter((x) => x.text.trim()).map((x) => [`${n.clientKey}:${x.itemId}`, x])) }));
          const note = r.ai !== "ok" ? (r.message ?? "") : r.namesRemoved ? `${r.namesRemoved}: a suggestion had one, and "another client" is written instead.` : "";
          setSuggNote((m) => ({ ...m, [n.clientKey]: note }));
        },
        (e) => setSuggNote((m) => ({ ...m, [n.clientKey]: errText(e) })),
      ).finally(() => setSuggLoading((s) => ({ ...s, ...Object.fromEntries(ask.map((id) => [`${n.clientKey}:${id}`, false])) })));
    }
  }, [needs, readOnly]);
  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);
  const suggestView: SuggestView = { by: sugg, loading: suggLoading, dismissed: dismissedSet, onDismiss: (k, id) => setDismissed((d) => (d.includes(`${k}:${id}`) ? d : [...d, `${k}:${id}`])) };

  // The nudge opens Status on Needs your update: scroll there once it's on screen.
  const scrolled = useRef(false);
  useEffect(() => {
    if (group !== "needs" || scrolled.current) return;
    const el = document.querySelector<HTMLElement>(".st-needs");
    if (el) {
      scrolled.current = true;
      el.scrollIntoView({ block: "start" });
      el.querySelector<HTMLElement>("[data-add-line]")?.focus({ preventScroll: true });
    }
  }, [group, data, report]);

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

  // Push all pushes the lines of the view on screen (a line on a feature the other view shows waits there).
  const onScreen = (l: Line) => !!known?.clients.some((c) => c.clientKey === l.clientKey && [...c.features, ...c.also].some((f) => f.id === l.itemId));
  const ready = pendingLines(lines, commentText).filter(onScreen);

  // AI: one request per client (Draft on one feature asks for that feature only); a draft lands in a new line.
  const draft = async (c: StatusClient, ids: number[] | null) => {
    const k = ids ? `${c.clientKey}:${ids.join(",")}` : c.clientKey;
    setDrafting((d) => ({ ...d, [k]: true }));
    setDraftNote((n) => ({ ...n, [c.clientKey]: "" }));
    try {
      const r = await call<{ ai: string; message: string | null; drafts: { itemId: number; text: string }[]; namesRemoved?: string }>("status.draft", { clientKey: c.clientKey, ...(ids ? { itemIds: ids } : {}) });
      if (r.ai !== "ok") setDraftNote((n) => ({ ...n, [c.clientKey]: r.message ?? "AI couldn't draft this time" }));
      // GD-2: the check after generation replaced another client's name; say so on the draft.
      if (r.ai === "ok" && r.namesRemoved) setDraftNote((n) => ({ ...n, [c.clientKey]: `${r.namesRemoved}: the AI's draft had one, and "another client" is written instead. Edit freely.` }));
      const got = r.drafts.filter((d) => d.text.trim());
      if (r.ai === "ok" && !got.length) setDraftNote((n) => ({ ...n, [c.clientKey]: "Nothing to draft from: no story activity, notes or captures this week" }));
      setLines((ls) => [...ls, ...got.filter((d) => !ls.some((l) => l.itemId === d.itemId && l.from === "ai" && l.text === d.text)).map((d) => ({ key: newKey(), clientKey: c.clientKey, itemId: d.itemId, kind: "comment" as const, commentId: null, text: d.text, from: "ai" as const }))]);
    } catch (e) {
      setDraftNote((n) => ({ ...n, [c.clientKey]: errText(e) }));
    } finally {
      setDrafting((d) => ({ ...d, [k]: false }));
    }
  };

  const change1 = (l: Line, extra: Record<string, unknown> = {}) => ({ key: l.key, kind: l.kind, itemId: l.itemId, ...(l.kind === "comment_delete" ? {} : { text: l.text.trim() }), ...(l.kind !== "comment" ? { commentId: l.commentId } : {}), ...extra });
  // Push all: preview every line, a client at a time in batches of 10, then show them together, grouped by feature.
  const startPush = async () => {
    setOpen(null);
    const byClient = new Map<string, Line[]>();
    for (const l of ready) (byClient.get(l.clientKey) ?? byClient.set(l.clientKey, []).get(l.clientKey)!).push(l);
    setPush({ batches: [], busy: true, results: null });
    const batches: { clientKey: string; batch: Batch; lines: Line[] }[] = [];
    try {
      for (const [clientKey, ls] of byClient) {
        for (let i = 0; i < ls.length; i += BATCH) {
          const part = ls.slice(i, i + BATCH);
          try {
            const batch = await call<Batch>("devops.preview", { clientKey, changes: part.map((l) => change1(l)) });
            batches.push({ clientKey, batch, lines: part });
          } catch (e) {
            batches.push({ clientKey, batch: { previews: [], nothing: [], refused: part.map((l) => ({ itemId: l.itemId, error: errText(e), code: null, key: l.key })) }, lines: part });
          }
        }
      }
      setPush({ batches, busy: false, results: null });
    } catch (e) {
      setError(errText(e));
      setPush(null);
    }
  };
  // GD-2: the flag's one click for a batch: preview it again with "another client" written, and keep the boxes in step.
  const replacePush = async (i: number) => {
    if (!push) return;
    const b = push.batches[i]!;
    setPush({ ...push, busy: true });
    try {
      const batch = await call<Batch>("devops.preview", { clientKey: b.clientKey, changes: b.lines.map((l) => change1(l, l.kind === "comment_delete" ? {} : { mentions: "replace" })) });
      const after = new Map(batch.previews.map((p) => [p.key, p.fields[0]?.after ?? null]));
      const lines2 = b.lines.map((l) => (l.kind !== "comment_delete" && after.get(l.key) ? { ...l, text: after.get(l.key)!, from: "me" as const } : l));
      setLines((ls) => ls.map((l) => lines2.find((x) => x.key === l.key) ?? l));
      setPush({ ...push, busy: false, batches: push.batches.map((x, j) => (j === i ? { ...x, batch, lines: lines2 } : x)) });
    } catch (e) {
      setError(errText(e));
      setPush({ ...push, busy: false });
    }
  };
  const confirmPush = async () => {
    if (!push) return;
    setPush({ ...push, busy: true });
    const results: Pushed[] = [];
    for (const b of push.batches) {
      const ids = b.batch.previews.map((p) => p.previewId);
      if (!ids.length) continue;
      let r: { results: (DevOpsResult | { error: string; status: number })[] } | null = null;
      try {
        // GD-2: lines I wrote go as written once I've seen the flag (the button says so).
        r = await call("devops.confirm", { previewIds: ids, ...(b.batch.previews.some((p) => p.mentions?.length) ? { mentionsOk: true } : {}) });
      } catch (e) {
        for (const p of b.batch.previews) {
          const l = b.lines.find((x) => x.key === p.key)!;
          results.push({ key: l.key, clientKey: l.clientKey, itemId: l.itemId, text: l.text, kind: l.kind, ok: false, message: errText(e), writeId: null });
        }
        continue;
      }
      b.batch.previews.forEach((p, i) => {
        const l = b.lines.find((x) => x.key === p.key)!;
        const res = r!.results[i]!;
        results.push("error" in res ? { key: l.key, clientKey: l.clientKey, itemId: l.itemId, text: l.text, kind: l.kind, ok: false, message: res.error, writeId: null } : { key: l.key, clientKey: l.clientKey, itemId: l.itemId, text: l.text, kind: l.kind, ok: res.confirmed, message: res.message, writeId: res.entry.id });
      });
    }
    setPush({ ...push, busy: false, results });
    // A line that went in leaves the boxes; one that didn't stays, with its reason, for Retry.
    const ok = new Set(results.filter((x) => x.ok).map((x) => x.key));
    setLines((ls) => ls.filter((l) => !ok.has(l.key)));
    setPushed((p) => [...results.filter((x) => x.ok || x.writeId !== null), ...p.filter((x) => !results.some((y) => y.key === x.key))]);
    await load();
    onChanged();
  };
  // Retry a write that went out but wasn't read back (the write framework checks first and never posts twice).
  const retry = async (p: Pushed) => {
    if (p.writeId === null) return;
    try {
      const r = await call<DevOpsResult>("devops.retry", { id: p.writeId });
      setPushed((all) => all.map((x) => (x.key === p.key ? { ...x, ok: r.confirmed, message: r.message } : x)));
      if (r.confirmed) setLines((ls) => ls.filter((l) => l.key !== p.key));
      await load();
    } catch (e) {
      setPushed((all) => all.map((x) => (x.key === p.key ? { ...x, message: errText(e) } : x)));
    }
  };
  const startUndo = async (p: Pushed) => {
    setUndoing({ p, preview: null, busy: true, error: null, done: null });
    try {
      const r = await call<{ preview?: DevOpsPreview; nothing?: string }>("devops.preview", { clientKey: p.clientKey, change: { kind: "undo", writeId: p.writeId } });
      setUndoing({ p, preview: r.preview ?? null, busy: false, error: r.nothing ?? null, done: null });
    } catch (e) {
      setUndoing({ p, preview: null, busy: false, error: errText(e), done: null });
    }
  };
  const confirmUndo = async () => {
    if (!undoing?.preview) return;
    setUndoing({ ...undoing, busy: true });
    try {
      const r = await call<DevOpsResult>("devops.confirm", { previewId: undoing.preview.previewId });
      setUndoing({ ...undoing, busy: false, done: r.message, error: r.confirmed ? null : r.message });
      if (r.confirmed) setPushed((all) => all.map((x) => (x.key === undoing.p.key ? { ...x, undone: true } : x)));
      await load();
      onChanged();
    } catch (e) {
      setUndoing({ ...undoing, busy: false, error: errText(e) });
    }
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

  const counts = useMemo(() => (data ? liveCounts(data, lines) : null), [data, lines]);
  const scopeSwitch = teams && teams.length > 0 ? <ScopeSwitch scope={onReport ? scope : "mine"} teams={teams} onPick={(v) => { setScope(v); setPush(null); setOpen(null); }} /> : null;
  const shownMode = readOnly ? "preview" : mode;
  const toggle = !readOnly && (
    <span className="st-toggle" data-tour="st-toggle" role="group" aria-label="Show">
      <button type="button" className="ms-btn" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>Edit</button>
      <button type="button" className="ms-btn" aria-pressed={mode === "preview"} onClick={() => (setOpen(null), setMode("preview"))}>Preview</button>
    </span>
  );
  const pushBar = !readOnly && (
    <>
      {ready.length > 0 && <span className="st-pending-count">{pendingLabel(ready.length)}</span>}
      <button type="button" className="commit" data-tour="st-push" disabled={!ready.length || !!push} onClick={() => void startPush()}>Push all</button>
    </>
  );

  if (onReport) {
    const r = shownReport;
    const needsN = r?.needsYou.length ?? 0;
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
        <p className="muted st-intro">The whole report as Kat will send it Monday, for everyone on the team. Anyone on the team can add lines; Kat sends the email, not FocusTime.</p>
        {error && <p className="error-line" role="alert">{error}</p>}
        {!r ? (
          <p className="muted">Reading the report…</p>
        ) : (
          <>
            <div className="st-bar st-report-bar">
              <p className="st-count" role="status">
                {reportCountLine(r)}
                {needsN > 0 && <span className="st-needs-count"> · {needsLabel(needsN)}</span>}
              </p>
              <span className="st-push">
                <span className="muted st-fresh">Refreshed {when(r.refreshedAt, tz)}</span>
                <button type="button" className="mini quiet" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? "Refreshing…" : "Refresh"}</button>
                {pushBar}
              </span>
            </div>
            {pushed.length > 0 && <PushedList pushed={pushed} data={known} onRetry={(p) => void retry(p)} onUndo={(p) => void startUndo(p)} onClear={() => setPushed([])} />}
            <ReportSection r={r} color={clientColor(r.clientKey, colors)} mode={shownMode} readOnly={readOnly} lines={lines.filter((l) => l.clientKey === r.clientKey)} ops={ops} sugg={suggestView} suggNote={suggNote[r.clientKey] ?? ""} onAddFeature={(f) => void addFeature(f)} />
          </>
        )}
        {push && <PushDialog push={push} data={known} onConfirm={() => void confirmPush()} onReplace={(i) => void replacePush(i)} onClose={() => setPush(null)} />}
        {undoing && <UndoDialog u={undoing} onConfirm={() => void confirmUndo()} onClose={() => setUndoing(null)} />}
      </main>
    );
  }

  return (
    <main className={`status-view${phone ? " st-phone" : ""}`} aria-label="Status">
      <header className="page-head">
        <div className="ph-title">
          <h2>{data?.title ?? "Status report"}</h2>
          <span className="muted st-sends">{data?.sends ?? "Kat sends it Monday 7:00 AM"}</span>
        </div>
        <ModeArea>
          {toggle}
          {switcher}
        </ModeArea>
      </header>
      {scopeSwitch}
      <p className="muted st-intro">What Monday's report will show for your features, a heading each with this week's comments. Add your own lines here; Kat sends the email, not FocusTime.</p>
      {error && <p className="error-line" role="alert">{error}</p>}
      {!data ? (
        <p className="muted">Reading this week's comments…</p>
      ) : (
        <>
          <div className="st-bar">
            <p className="st-count" role="status">
              {counts!.line}
              {data.needsYou > 0 && <span className="st-needs-count"> · {needsLabel(data.needsYou)}</span>}
            </p>
            {!readOnly && <span className="st-push">{pushBar}</span>}
          </div>
          {pushed.length > 0 && <PushedList pushed={pushed} data={known ?? data} onRetry={(p) => void retry(p)} onUndo={(p) => void startUndo(p)} onClear={() => setPushed([])} />}
          {!data.clients.length && <p className="muted">No clients with DevOps this week. The features you plan or work on show here.</p>}
          {data.clients.map((c) => (
            <ClientSection key={c.clientKey} c={c} color={clientColor(c.clientKey, colors)} mode={shownMode} lines={lines.filter((l) => l.clientKey === c.clientKey)} drafting={drafting} draftNote={draftNote[c.clientKey] ?? ""} ops={ops} sugg={suggestView} suggNote={suggNote[c.clientKey] ?? ""} onDraft={(ids) => void draft(c, ids)} />
          ))}
        </>
      )}
      {push && <PushDialog push={push} data={data} onConfirm={() => void confirmPush()} onReplace={(i) => void replacePush(i)} onClose={() => setPush(null)} />}
      {undoing && <UndoDialog u={undoing} onConfirm={() => void confirmUndo()} onClose={() => setUndoing(null)} />}
    </main>
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

/** "2 features in the report · 2 active with no update yet". */
function reportCountLine(r: StatusReport): string {
  const n = r.features.length;
  const u = r.noUpdate.filter((f) => f.thisWeek !== null).length;
  return `${n === 1 ? "1 feature" : `${n} features`} in the report · ${u === 1 ? "1 active feature" : `${u} active features`} with no update yet`;
}

/**
 * SR-2: the client's report. Preview reads as Kat's email (a heading per feature in backlog order, each comment a
 * bullet with its author as DevOps shows it, then Upcoming PTO and Holidays). Edit is SR-1's editor on every feature in
 * it: + Add a line on any, Edit on my own in the window; others' comments are read only, as in DevOps. SR-3: Needs
 * your update at the top, features I added in their stack-rank place, Add a feature over the whole project.
 */
function ReportSection({ r, color, mode, readOnly, lines, ops, sugg, suggNote, onAddFeature }: {
  r: StatusReport; color: string; mode: "edit" | "preview"; readOnly: boolean; lines: Line[]; ops: LineOps; sugg: SuggestView; suggNote: string; onAddFeature: (f: CatalogFeature) => void;
}) {
  const c = reportClient(r);
  const writable = !readOnly && r.canWrite;
  const needsIds = new Set(r.needsYou.map((f) => f.id));
  const owner = (f: ReportFeature) => ({ owner: f.owner, authorAs: r.authorAs });
  if (mode === "preview") {
    const list = previewFeatures<ReportFeature>(r.features, [...r.needsYou, ...r.added, ...r.noUpdate], lines);
    return (
      <section className="st-client st-report st-email" style={{ "--c": color } as CSSProperties} aria-label={`${r.clientName} report`}>
        <header className="st-client-head"><h3 className="carry-client-name"><span className="swatch" aria-hidden="true" />{r.clientName}</h3></header>
        {r.window.note && <p className="muted st-sent">{r.window.note}</p>}
        {r.message && <p className="set-problem">{r.message}</p>}
        {r.status === "ok" && !list.length && <p className="muted">No feature has a comment since Kat's last send yet, so Monday's report has no features so far.</p>}
        <div className="st-features">
          {list.map((f) => <FeatureBlock key={f.id} c={c} f={f} mode="preview" lines={lines.filter((l) => l.itemId === f.id)} drafting={false} ops={ops} onDraft={null} report={owner(f)} />)}
        </div>
        <PtoBlock pto={r.pto} />
      </section>
    );
  }
  // Edit: the features I worked on first; the report's own and the ones I added in stack rank; then PTO and No update yet.
  const body = [...r.features.filter((f) => !needsIds.has(f.id)), ...r.added.filter((f) => !needsIds.has(f.id))].sort(byRank);
  const addedIds = new Set(r.added.map((f) => f.id));
  // Already on screen (with their own + Add a line), so not offered again.
  const shownIds = new Set([...r.features, ...r.needsYou, ...r.added, ...r.noUpdate].map((f) => f.id));
  return (
    <section className="st-client st-report" style={{ "--c": color } as CSSProperties} aria-label={`${r.clientName} report`}>
      <header className="st-client-head">
        <h3 className="carry-client-name"><span className="swatch" aria-hidden="true" />{r.clientName}</h3>
        {writable && r.status === "ok" && <AddFeature catalog={r.catalog} shown={shownIds} onPick={onAddFeature} />}
      </header>
      {r.window.note && <p className="muted st-sent">{r.window.note}</p>}
      {r.message && <p className="set-problem">{r.message}</p>}
      {!r.canWrite && r.status === "ok" && <p className="muted st-note">Read only: add your DevOps write access for {r.clientName} in <a href="#/settings/devops/devops-write">Settings › DevOps</a> to add lines here.</p>}
      {r.needsYou.length > 0 && <NeedsGroup c={c} features={r.needsYou} lines={lines} ops={ops} sugg={sugg} note={suggNote} writable={writable} report={owner} />}
      {r.status === "ok" && !body.length && !r.needsYou.length && <p className="muted">No feature has a comment since Kat's last send yet, so Monday's report has no features so far.</p>}
      <div className="st-features">
        {body.map((f) => (
          <FeatureBlock key={f.id} c={c} f={f} mode="edit" lines={lines.filter((l) => l.itemId === f.id)} drafting={false} ops={ops} onDraft={null} report={owner(f)} writableOverride={writable} added={addedIds.has(f.id)} />
        ))}
      </div>
      <PtoBlock pto={r.pto} />
      {r.noUpdate.some((f) => !needsIds.has(f.id)) && <NoUpdateList r={r} c={c} writable={writable} lines={lines} ops={ops} skip={needsIds} />}
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
      <button ref={btn} type="button" className="mini st-add-feature" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>+ Add a feature</button>
      {open && (
        <CellPopover anchor={btn.current} title="Add a feature" sub="Any of this client's features, whoever owns it" onSave={close} onCancel={close} saveLabel="Done" className="ah-pop-list st-add-pop">
          <FilterList label="Add a feature" placeholder="Title or #id" options={options} current={null} empty="No feature matches" onPick={(k) => { const f = catalog.find((x) => String(x.id) === k); close(); if (f) onPick(f); }} />
        </CellPopover>
      )}
    </>
  );
}

/** SR-3: the features I worked on with no update of mine since the window opened, each with a suggested line. */
function NeedsGroup({ c, features, lines, ops, sugg, note, writable, report, drafting, onDraft }: {
  c: StatusClient; features: StatusFeature[]; lines: Line[]; ops: LineOps; sugg: SuggestView; note: string; writable: boolean;
  report?: (f: ReportFeature) => { owner: string | null; authorAs: string | null }; drafting?: Record<string, boolean>; onDraft?: (ids: number[]) => void;
}) {
  return (
    <section className="st-needs" aria-label="Needs your update">
      <header className="st-needs-head">
        <h4>Needs your update</h4>
        <span className="muted">You worked on {features.length === 1 ? "this" : "these"} since Kat's last send and haven't added a line yet.</span>
      </header>
      {note && <p className="muted st-note" role="status">{note}</p>}
      <div className="st-features">
        {features.map((f) => (
          <FeatureBlock key={f.id} c={c} f={f} mode="edit" lines={lines.filter((l) => l.itemId === f.id)} drafting={!!drafting?.[`${c.clientKey}:${f.id}`]} ops={ops} onDraft={onDraft && c.ai === "ok" ? () => onDraft([f.id]) : null} {...(report ? { report: report(f as ReportFeature) } : {})} writableOverride={writable} sugg={sugg} />
        ))}
      </div>
    </section>
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

/** Active this week with nothing in the window: folded, each with its owner and + Add a line (SR-1's editor). */
function NoUpdateList({ r, c, writable, lines, ops, skip }: { r: StatusReport; c: StatusClient; writable: boolean; lines: Line[]; ops: LineOps; skip: ReadonlySet<number> }) {
  const rows = r.noUpdate.filter((f) => !skip.has(f.id));
  const open = lines.some((l) => rows.some((f) => f.id === l.itemId));
  return (
    <details className="st-also st-noupdate" open={open || undefined}>
      <summary>No update yet ({rows.length})</summary>
      <p className="muted st-note">Worked on this week (on someone's week or with story activity) but no comment since Kat's last send, so Monday's report leaves them out.</p>
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

/** The count at the top as Monday's report counts it; lines not pushed yet are counted beside Push all (SR-3). */
function liveCounts(d: StatusLoad, _lines: Line[]): { line: string } {
  return { line: d.countLine };
}

function ClientSection({ c, color, mode, lines, drafting, draftNote, ops, sugg, suggNote, onDraft }: {
  c: StatusClient; color: string; mode: "edit" | "preview"; lines: Line[]; drafting: Record<string, boolean>; draftNote: string; ops: LineOps; sugg: SuggestView; suggNote: string; onDraft: (ids: number[] | null) => void;
}) {
  const zone = useContext(ZoneCtx);
  const sent = c.window.source === "kat" && c.window.katSentAt ? `Kat last sent ${c.clientName}'s report ${when(c.window.katSentAt, zone)}` : c.window.note;
  const canDraft = mode === "edit" && c.canWrite && c.ai === "ok" && c.features.length > 0;
  const needs = mode === "edit" ? c.features.filter((f) => f.needsYou) : [];
  const rest = mode === "edit" ? c.features.filter((f) => !f.needsYou) : c.features;
  return (
    <section className={`st-client${mode === "preview" ? " st-email" : ""}`} style={{ "--c": color } as CSSProperties} aria-label={c.clientName}>
      <header className="st-client-head">
        <h3 className="carry-client-name">
          <span className="swatch" aria-hidden="true" />
          {c.clientName}
        </h3>
        {canDraft && (
          <button type="button" className="mini" disabled={!!drafting[c.clientKey]} onClick={() => onDraft(null)} title={`Suggested lines for every ${c.clientName} feature, from this week's activity (one AI request)`}>
            {drafting[c.clientKey] ? "Drafting…" : "Draft all"}
          </button>
        )}
      </header>
      {sent && <p className="muted st-sent">{sent}</p>}
      {c.status !== "ok" ? <p className="set-problem">{c.message}</p> : c.message && <p className="set-problem">{c.message}</p>}
      {draftNote && <p className="muted st-note" role="status">{draftNote}</p>}
      {mode === "edit" && !c.canWrite && c.features.length > 0 && <p className="muted st-note">Read only: add your DevOps write access for {c.clientName} in <a href="#/settings/devops/devops-write">Settings › DevOps</a> to write here.</p>}
      {c.status === "ok" && !c.features.length && <p className="muted">Nothing planned or worked on for {c.clientName} this week.</p>}
      {needs.length > 0 && <NeedsGroup c={c} features={needs} lines={lines} ops={ops} sugg={sugg} note={suggNote} writable={c.canWrite} drafting={drafting} onDraft={(ids) => onDraft(ids)} />}
      <div className="st-features">
        {rest.map((f) => (
          <FeatureBlock key={f.id} c={c} f={f} mode={mode} lines={lines.filter((l) => l.itemId === f.id)} drafting={!!drafting[`${c.clientKey}:${f.id}`] || !!drafting[c.clientKey]} ops={ops} onDraft={() => onDraft([f.id])} />
        ))}
      </div>
      {mode === "edit" && c.also.length > 0 && (
        <details className="st-also">
          <summary>Also assigned to you ({c.also.length})</summary>
          <p className="muted st-note">Not on this week's plan and no story touched. They show in Monday's report only if someone comments.</p>
          <div className="st-features">
            {c.also.map((f) => (
              <FeatureBlock key={f.id} c={c} f={f} mode={mode} lines={lines.filter((l) => l.itemId === f.id)} drafting={false} ops={ops} onDraft={null} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** SR-3: "+ Add a line": Tab from it goes to the next feature's, Shift+Tab to the previous one's. */
function AddLineButton({ onAdd, label = "+ Add a line" }: { onAdd: () => void; label?: string }) {
  return (
    <button type="button" className="mini st-add" data-add-line="" data-tour="st-add" onClick={onAdd} onKeyDown={(e) => { if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey && moveToAdd(e.currentTarget, e.shiftKey)) e.preventDefault(); }}>
      {label}
    </button>
  );
}

function FeatureBlock({ c, f, mode, lines, drafting, ops, onDraft, report, writableOverride, added, sugg }: {
  c: StatusClient; f: StatusFeature; mode: "edit" | "preview"; lines: Line[]; drafting: boolean; ops: LineOps; onDraft: (() => void) | null;
  /** SR-2: on the client report, authors as DevOps shows them, the owner, and who a new line shows as. */
  report?: { owner: string | null; authorAs: string | null };
  writableOverride?: boolean;
  /** SR-3: added with Add a feature (Remove takes it out while it has no line). */
  added?: boolean;
  sugg?: SuggestView;
}) {
  const zone = useContext(ZoneCtx);
  const comments = f.thisWeek ?? [];
  const newLines = lines.filter((l) => l.kind === "comment");
  const editOf = (id: number) => lines.find((l) => l.kind === "comment_edit" && l.commentId === id);
  const delOf = (id: number) => lines.find((l) => l.kind === "comment_delete" && l.commentId === id);
  const empty = !comments.length && !newLines.some((l) => l.text.trim());
  const writable = mode === "edit" && (writableOverride ?? c.canWrite);

  if (mode === "preview") {
    // As Monday's email reads: the heading, then each comment as a bullet and its author; lines not pushed yet in italics.
    const kept = comments.filter((cm) => !delOf(cm.id));
    return (
      <article className="st-feature" aria-label={f.title}>
        <h4><WorkLink clientKey={c.clientKey} url={f.url} className="st-title">{f.title}</WorkLink></h4>
        {f.thisWeek === null ? (
          <p className="set-problem st-line">Comments couldn't be read</p>
        ) : kept.length || newLines.some((l) => l.text.trim()) ? (
          <ul className="st-bullets">
            {kept.map((cm) => {
              const e = editOf(cm.id);
              return <li key={cm.id} className={e ? "st-pending" : ""}>{e ? e.text : cm.text} <span className="st-author">· {cm.author}</span></li>;
            })}
            {newLines.filter((l) => l.text.trim()).map((l) => <li key={l.key} className="st-pending">{l.text} <span className="st-author">· {report?.authorAs ? `${report.authorAs}, not pushed yet` : "you, not pushed yet"}</span></li>)}
          </ul>
        ) : (
          <p className="st-none">No update yet</p>
        )}
      </article>
    );
  }

  const s = sugg && f.needsYou ? sugg.by[`${c.clientKey}:${f.id}`] : undefined;
  const sLoading = !!(sugg && f.needsYou && sugg.loading[`${c.clientKey}:${f.id}`]);
  const showSugg = writable && !!sugg && !!f.needsYou && !sugg.dismissed.has(`${c.clientKey}:${f.id}`) && !newLines.some((l) => l.from === "ai" || l.text.trim());
  return (
    <article className={`st-feature${empty ? " st-empty" : ""}${f.needsYou ? " st-mine" : ""}`} aria-label={f.title} data-feature={f.id}>
      <div className="st-feature-head">
        <h4><WorkLink clientKey={c.clientKey} url={f.url} className="st-title">{f.title}</WorkLink></h4>
        <span className="muted st-meta">#{f.id} · {f.state}{report ? ` · ${report.owner ? `Owner ${report.owner}` : "No owner"}` : ""}</span>
        {f.needsYou && f.you && <span className="st-worked" title={`You worked on this: ${f.you.line}`}>You worked on this</span>}
        {f.thisWeek !== null && (comments.length ? <span className="st-has">{comments.length === 1 ? "1 update" : `${comments.length} updates`}</span> : <span className="st-badge">No update yet</span>)}
      </div>
      {f.needsYou && f.you && <p className="muted st-why">{f.you.line}</p>}
      {f.thisWeek === null && <p className="set-problem st-line">This feature's comments couldn't be read. Try again in a minute.</p>}
      {comments.length > 0 && (
        <ul className="st-comments" aria-label="This week">
          {comments.map((cm) => {
            const e = editOf(cm.id);
            const d = delOf(cm.id);
            const mineEditable = writable && cm.editable;
            return (
              <li key={cm.id} className={`st-comment who-${cm.who}${d ? " st-deleting" : ""}`}>
                {e && ops.open === e.key ? (
                  <LineBox line={e} label={`Edit your comment on ${f.title}`} ops={ops} {...(report ? { authorAs: report.authorAs } : {})} />
                ) : (
                  <>
                    {mineEditable && !d ? (
                      <button type="button" className="st-text st-text-edit" title="Click to edit your comment" onClick={() => ops.edit(c, f, cm)}>{e ? e.text : cm.text}</button>
                    ) : (
                      <span className="st-text">{cm.text}</span>
                    )}
                    <span className="st-by">
                      <span className="st-author">{report ? `${cm.author}${cm.who === "mine" ? " (you)" : ""}` : cm.who === "mine" ? "You" : cm.author}{cm.who === "coop" ? " · Coop" : ""}</span>
                      <span className="muted"> · <Stamp at={cm.at} tz={zone ?? Temporal.Now.timeZoneId()} /></span>
                      {e && <span className="st-pending-tag">Edited, not pushed yet</span>}
                      {d && <span className="st-pending-tag">Deleted when you push</span>}
                      {mineEditable && !d && <button type="button" className="link-btn" onClick={() => ops.edit(c, f, cm)}>Edit</button>}
                      {mineEditable && !d && <button type="button" className="link-btn" onClick={() => ops.del(c, f, cm)}>Delete</button>}
                      {e && <button type="button" className="link-btn" onClick={() => ops.remove(e.key)}>Undo edit</button>}
                      {d && <button type="button" className="link-btn" onClick={() => ops.remove(d.key)}>Keep it</button>}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {showSugg && (s || sLoading) && <SuggestionCard s={s ?? null} loading={sLoading} onUse={() => s && ops.add(c, f, s.text, s.source === "ai" ? "ai" : "me", false)} onEdit={() => s && ops.add(c, f, s.text, s.source === "ai" ? "ai" : "me", true)} onDismiss={() => sugg!.onDismiss(c.clientKey, f.id)} />}
      {writable && (
        <div className="st-new">
          {newLines.map((l) => <LineRow key={l.key} line={l} label={`New line for ${f.title}`} ops={ops} {...(report ? { authorAs: report.authorAs } : {})} />)}
          <span className="st-adds">
            <AddLineButton onAdd={() => ops.add(c, f)} />
            {onDraft && c.ai === "ok" && <button type="button" className="mini quiet" data-tour="st-draft" disabled={drafting} onClick={onDraft}>{drafting ? "Drafting…" : "Draft"}</button>}
            {added && !newLines.some((l) => l.text.trim()) && ops.unadd && <button type="button" className="link-btn" onClick={() => ops.unadd!(c.clientKey, f.id)}>Remove from the report</button>}
          </span>
        </div>
      )}
      {f.hints.length > 0 && (c.ai !== "ok" || !writable ? (
        <div className="st-hints">
          <p className="st-hints-head">This week</p>
          <ul>{f.hints.map((h) => <li key={h}>{h}</li>)}</ul>
        </div>
      ) : (
        <details className="st-hints">
          <summary>What a draft uses ({f.hints.length})</summary>
          <ul>{f.hints.map((h) => <li key={h}>{h}</li>)}</ul>
        </details>
      ))}
      {f.lastWeek.length > 0 && (
        <details className="st-last">
          <summary>Last week ({f.lastWeek.length})</summary>
          <ul>{f.lastWeek.map((cm) => <li key={cm.id}>{cm.text} <span className="st-author">· {cm.who === "mine" ? "You" : cm.author}</span></li>)}</ul>
        </details>
      )}
    </article>
  );
}

/** SR-3: "AI suggests" (or the plain "Worked on" line with AI off): Use fills a line, Edit opens it, Dismiss hides it. */
function SuggestionCard({ s, loading, onUse, onEdit, onDismiss }: { s: Suggestion | null; loading: boolean; onUse: () => void; onEdit: () => void; onDismiss: () => void }) {
  if (!s) return <div className="st-sugg st-sugg-loading" role="status"><span className="st-sugg-label">AI suggests</span><span className="muted">Writing a suggestion…</span></div>;
  return (
    <div className={`st-sugg${s.source === "template" ? " st-sugg-template" : ""}`} role="group" aria-label={s.source === "ai" ? "AI suggests" : "Suggested line"}>
      <span className="st-sugg-label">{s.source === "ai" ? "AI suggests" : "Suggested line"}</span>
      <p className="st-sugg-text">{s.text}</p>
      <span className="st-sugg-actions">
        <button type="button" className="mini" disabled={loading} onClick={onUse}>Use</button>
        <button type="button" className="mini quiet" disabled={loading} onClick={onEdit}>Edit</button>
        <button type="button" className="link-btn" onClick={onDismiss}>Dismiss</button>
      </span>
    </div>
  );
}

/** A new line: its box while open, else a pending row (click to edit), until Push all. */
function LineRow({ line, label, ops, authorAs }: { line: Line; label: string; ops: LineOps; authorAs?: string | null }) {
  if (ops.open === line.key) return <LineBox line={line} label={label} ops={ops} {...(authorAs !== undefined ? { authorAs } : {})} />;
  if (!line.text.trim()) return null;
  return (
    <div className={`st-pending-line${line.from === "ai" ? " st-suggested" : ""}`}>
      <button type="button" className="st-text st-text-edit" title="Click to edit" aria-label={`${label}: ${line.text}. Click to edit`} onClick={() => ops.setOpen(line.key)}>{line.text}</button>
      <span className="st-box-foot">
        <span className="st-pending-tag">{line.from === "ai" ? "Suggested, not pushed yet" : "Not pushed yet"}</span>
        <button type="button" className="link-btn" onClick={() => ops.remove(line.key)}>Remove</button>
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
  // the next feature's + Add a line (Shift+Tab: the previous one's).
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
    <div className={`st-box${line.from === "ai" ? " st-suggested" : ""}${line.kind === "comment_edit" ? " st-editing" : ""}`}>
      <TextBox ref={ref} aria-label={label} minRows={1} maxRows={10} maxLength={4000} value={line.text} placeholder="What moved this week, and what's next" onChange={(e) => ops.change(line.key, { text: e.target.value, from: "me" })} onKeyDown={keys} onEnter={() => ops.enter(line.key)} />
      {flag && <MentionFlag names={flag.names} where="this client's status report" onReplace={() => ops.change(line.key, { text: flag.replaced, from: "me" })} />}
      <span className="st-box-foot">
        <span className="muted">{line.kind === "comment_edit" ? "Edits your comment · Enter when done" : line.from === "ai" ? "Suggested: edit it before you push" : "Enter for the next line · Shift+Enter for a new line in this one · Esc to close"}{authorAs !== undefined ? ` · Shows as ${authorAs ?? "your DevOps name"}` : ""}</span>
        <button type="button" className="link-btn" onClick={() => ops.remove(line.key)}>{line.kind === "comment_edit" ? "Cancel edit" : "Remove"}</button>
      </span>
    </div>
  );
}

function featureTitle(data: Known | null, clientKey: string, itemId: number): string {
  const c = data?.clients.find((x) => x.clientKey === clientKey);
  return [...(c?.features ?? []), ...(c?.also ?? [])].find((f) => f.id === itemId)?.title ?? `#${itemId}`;
}

const OP_LABEL: Record<string, string> = { comment: "new comment", comment_edit: "edit your comment", comment_delete: "delete your comment" };

function PushDialog({ push, data, onConfirm, onReplace, onClose }: { push: { batches: { clientKey: string; batch: Batch; lines: Line[] }[]; busy: boolean; results: Pushed[] | null }; data: Known | null; onConfirm: () => void; onReplace: (batch: number) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), [push.busy]);
  const n = push.batches.reduce((s, b) => s + b.batch.previews.length, 0);
  const refused = push.batches.flatMap((b) => b.batch.refused.map((r) => ({ b, r })));
  const name = (k: string) => data?.clients.find((c) => c.clientKey === k)?.clientName ?? k;
  const result = (key: string | undefined) => push.results?.find((r) => r.key === key) ?? null;
  const flagged = push.batches.some((b) => b.batch.previews.some((p) => p.mentions?.length));
  const label = n === 1 ? "Push 1 line to DevOps" : `Push ${n} lines to DevOps`;
  // SR-3: grouped by client, then by feature, in the order the lines were written.
  const clients = [...new Set(push.batches.map((b) => b.clientKey))];
  return (
    <Modal label={label} busy={push.busy} onClose={onClose} wide>
      <div className="cap-dialog-head">
        <h2>{push.results ? "Pushed to DevOps" : label}</h2>
        <CloseButton onClose={onClose} disabled={push.busy} />
      </div>
      {!push.batches.length && push.busy && <p className="muted">Checking each line with DevOps…</p>}
      <div className="dw-rows">
        {clients.map((k) => {
          const bs = push.batches.map((b, i) => ({ b, i })).filter(({ b }) => b.clientKey === k);
          const p0 = bs.flatMap(({ b }) => b.batch.previews)[0];
          const rows = bs.flatMap(({ b, i }) => [
            ...b.batch.previews.map((p) => ({ itemId: b.lines.find((l) => l.key === p.key)?.itemId ?? 0, p, r: null as Refused | null, l: b.lines.find((l) => l.key === p.key) ?? null, i })),
            ...b.batch.refused.map((r) => ({ itemId: b.lines.find((l) => l.key === r.key)?.itemId ?? r.itemId ?? 0, p: null as DevOpsPreview | null, r, l: b.lines.find((l) => l.key === r.key) ?? null, i })),
          ]);
          if (!rows.length) return null;
          const items = [...new Set(rows.map((x) => x.itemId))];
          return (
            <section key={k} className="st-push-client" aria-label={name(k)}>
              <h3>{name(k)}</h3>
              {p0 && <p className="muted dw-note">DevOps · {p0.org} · {p0.project} · writes as {p0.identity}</p>}
              {p0 && <p className="wd-visibility"><strong>Who can see it:</strong> {p0.visibility}</p>}
              {items.map((id) => {
                const mine = rows.filter((x) => x.itemId === id);
                return (
                  <div key={id} className="st-push-feature" role="group" aria-label={featureTitle(data, k, id)}>
                    <h4>{mine.find((x) => x.p)?.p?.item ?? `#${id} ${featureTitle(data, k, id)}`} <span className="muted">· {mine.length === 1 ? "1 line" : `${mine.length} lines`}</span></h4>
                    {mine.map(({ p, r: refusal, l, i }) => {
                      if (p) {
                        const res = result(p.key);
                        return (
                          <div key={p.previewId} className={`dw-row${res?.ok ? " done" : ""}`}>
                            <p className="st-push-op muted">{OP_LABEL[p.op] ?? p.op}</p>
                            {p.op === "comment_edit" ? (
                              <table className="wd-fields"><tbody>
                                <tr><th scope="row">Now</th><td>{p.fields[0]?.before ?? ""}</td></tr>
                                <tr className="changed"><th scope="row">After</th><td>{p.fields[0]?.after ?? ""}</td></tr>
                              </tbody></table>
                            ) : p.op === "comment_delete" ? (
                              <p className="st-preview-text st-deleted-text">{p.fields[0]?.before ?? ""}</p>
                            ) : (
                              <p className="st-preview-text">{p.fields[0]?.after ?? ""}</p>
                            )}
                            {p.mentions?.length && !push.results ? <MentionFlag names={p.mentions} where={`${name(k)}'s DevOps and Monday's report`} disabled={push.busy} onReplace={() => onReplace(i)} /> : null}
                            {res && <p className={res.ok ? "dw-ok" : "set-problem"} role={res.ok ? "status" : "alert"}>{res.message}</p>}
                          </div>
                        );
                      }
                      return (
                        <div key={refusal!.key ?? refusal!.error} className="dw-row st-refused">
                          <p className="st-push-op muted">{l ? OP_LABEL[l.kind] : "a line"} · not pushed</p>
                          {l && <p className="st-preview-text">{l.text}</p>}
                          <p className="set-problem" role="alert">{refusal!.error}</p>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      {refused.length > 0 && !push.results && <p className="muted">{refused.length === 1 ? "1 line can't be pushed" : `${refused.length} lines can't be pushed`}: {refused.length === 1 ? "it stays" : "they stay"} in {refused.length === 1 ? "its box" : "their boxes"} to fix.</p>}
      <div className="wd-actions">
        {!push.results ? (
          <button ref={first} type="button" className="commit" disabled={push.busy || !n} onClick={onConfirm}>{push.busy ? "Writing and checking…" : flagged ? `${label} as written` : label}</button>
        ) : null}
        <button type="button" className="mini quiet" disabled={push.busy} onClick={onClose}>{push.results ? "Close" : "Not now"}</button>
        <span className="muted">Each line is its own write, logged in Settings &gt; Data with Undo.</span>
      </div>
    </Modal>
  );
}

function PushedList({ pushed, data, onRetry, onUndo, onClear }: { pushed: Pushed[]; data: Known | null; onRetry: (p: Pushed) => void; onUndo: (p: Pushed) => void; onClear: () => void }) {
  return (
    <section className="st-pushed" aria-label="Pushed">
      <header className="st-pushed-head">
        <h3>Pushed just now</h3>
        <button type="button" className="link-btn" onClick={onClear}>Hide</button>
      </header>
      <ul>
        {pushed.map((p) => (
          <li key={p.key} className={p.ok ? "ok" : "bad"}>
            <span className="st-pushed-what">{featureTitle(data, p.clientKey, p.itemId)}: {p.kind === "comment_delete" ? "deleted " : ""}{p.text.length > 90 ? `${p.text.slice(0, 89)}…` : p.text}</span>
            <span className={p.ok ? "muted" : "set-problem"}>{p.undone ? "Undone" : p.message}</span>
            {!p.ok && p.writeId !== null && <button type="button" className="mini" onClick={() => onRetry(p)}>Retry</button>}
            {p.ok && !p.undone && p.writeId !== null && <button type="button" className="mini quiet" onClick={() => onUndo(p)}>Undo</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function UndoDialog({ u, onConfirm, onClose }: { u: { p: Pushed; preview: DevOpsPreview | null; busy: boolean; error: string | null; done: string | null }; onConfirm: () => void; onClose: () => void }) {
  const p = u.preview;
  return (
    <Modal label={p?.summary ?? "Undo"} busy={u.busy} onClose={onClose}>
      <div className="cap-dialog-head">
        <h2>{p?.summary ?? "Undo"}</h2>
        <CloseButton onClose={onClose} disabled={u.busy} />
      </div>
      {p && (
        <>
          <p className="muted dw-note">{p.item} · DevOps · {p.org} · {p.project}</p>
          <table className="wd-fields"><tbody>
            <tr><th scope="row">Now</th><td>{p.fields[0]?.before ?? "(none)"}</td></tr>
            <tr className="changed"><th scope="row">After</th><td>{p.fields[0]?.after ?? "(none)"}</td></tr>
          </tbody></table>
          {p.notes.map((n) => <p key={n} className="muted dw-note">{n}</p>)}
        </>
      )}
      {u.error && <p className="set-problem" role="alert">{u.error}</p>}
      {u.done && !u.error && <p className="dw-ok" role="status">{u.done}</p>}
      <div className="wd-actions">
        {p && !u.done && <button type="button" className="commit" disabled={u.busy} onClick={onConfirm}>{u.busy ? "Undoing…" : "Undo in DevOps"}</button>}
        <button type="button" className="mini quiet" disabled={u.busy} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/** RF-1: what the Status tab needs for its dot: how many features need my update, and when the dot turns amber and red. */
export type StatusNeeds = { needs: number; dot: DotSchedule | null; sendsAt: string | null; zone: string | null; /** The server's clock minus the browser's. */ skewMs: number };

/**
 * WD-1, RF-1: SR-3's Needs your update (features I worked on this week with no update of mine) and the dot's schedule.
 * Read once, then again when `version` changes; null until read or when Status can't load.
 */
export function useStatusNeeds(version: unknown): StatusNeeds | null {
  const [n, setN] = useState<StatusNeeds | null>(null);
  // RF-1: read again a minute after the report goes out, so the next week's list and dot replace this one's.
  const [after, setAfter] = useState(0);
  const sendsAt = n?.sendsAt ?? null;
  const skew = n?.skewMs ?? 0;
  // RF-1 review: the list changes as I work, so read it again every 30 minutes while the window is shown, and when it
  // comes back into view after 10 minutes or more (status.load reads DevOps, so not as often as the Inbox's count).
  useEffect(() => {
    let last = Date.now();
    const again = () => {
      if (document.hidden || Date.now() - last < 10 * 60_000) return;
      last = Date.now();
      setAfter((k) => k + 1);
    };
    const id = window.setInterval(() => !document.hidden && (last = Date.now(), setAfter((k) => k + 1)), 30 * 60_000);
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, []);
  useEffect(() => {
    if (!sendsAt) return;
    const wait = Date.parse(sendsAt) - (Date.now() + skew) + 60_000;
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    const t = window.setTimeout(() => setAfter((k) => k + 1), wait);
    return () => window.clearTimeout(t);
  }, [sendsAt, skew]);
  useEffect(() => {
    let live = true;
    call<StatusLoad>("status.load", {}).then(
      (d) => live && setN({ needs: d.clients.reduce((k, c) => k + c.features.filter((f) => f.needsYou).length, 0), dot: d.dot ?? null, sendsAt: d.sendsAt ?? null, zone: d.zone ?? null, skewMs: d.serverNow ? Date.parse(d.serverNow) - Date.now() : 0 }),
      () => live && setN(null),
    );
    return () => {
      live = false;
    };
  }, [version, after]);
  return n;
}
