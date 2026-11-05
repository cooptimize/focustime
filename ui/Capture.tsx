// Quick capture (step 9): one text box, Enter saves at once to the local store (works offline). Rules (no AI)
// suggest a follow-up, a draft story or a draft feature (step 13.5); one click confirms, or change it first. Unsorted
// captures wait in the Inbox.
import { CloseButton } from "./CloseButton.tsx";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { CaptureFeatures, WeekLoadData } from "../actions/types.ts";
import { boxKind, suggest, tagCompletions, takeTag, type BoxKind, type CaptureClient, type CaptureKind } from "../plan/capture.ts";
import { CLOSE_HOW, type Capture, type Size } from "../plan/types.ts";
import type { IsoDate } from "../week/types.ts";
import { call } from "./api.ts";
import { Fading, formClients, HOW_LABEL } from "./FollowUps.tsx";
import { PersonPicker, type PersonValue } from "./PersonPicker.tsx";
import { ItemLookup, NO_ITEM, parentPool, type ItemValue } from "./ItemLookup.tsx";
import { clientColor } from "./labels.ts";
import { keyAction, onLastLine, savedText, TOAST_MS } from "./capturebox.ts";
import { CreateDraftCtx } from "./createdraft-ctx.ts";

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

/**
 * Sorting one capture in the Inbox (step 15.4): the same kind chips as the capture box (Sort later · Follow-up · Draft
 * story · Draft feature), the rules' choice highlighted, and each kind's fields inline, as in the box. Sort later
 * leaves it in the Inbox.
 */
/** Sorting one capture in the Inbox; onCancel (U5) folds it back into its row, which has Dismiss in its ⋯. */
export function SortCapture({ capture, clients, today, onDone, onCancel }: { capture: Capture; clients: CaptureClient[]; today: IsoDate; onDone: (msg: string) => void; onCancel?: () => void }) {
  const s = useMemo(() => suggest(capture.text, capture.clientKey, today, clients), [capture.text, capture.clientKey, today, clients]);
  const suggested = useMemo(() => boxKind(capture.text, capture.clientKey, today, clients), [capture.text, capture.clientKey, today, clients]);
  const [chosen, setChosen] = useState<BoxKind | null>(null);
  const kind = chosen ?? suggested;
  const [client, setClient] = useState<string | null>(capture.clientKey);
  // CV-3: Who through the PersonPicker; the rules' name starts it as plain text (it offers to link an exact match).
  const [who, setWho] = useState<PersonValue>({ who: s.who, whoRef: null });
  const [what, setWhat] = useState(s.what);
  const [due, setDue] = useState(s.due ?? "");
  const [title, setTitle] = useState(s.title);
  const [size, setSize] = useState<Size>("M");
  const [channel, setChannel] = useState("");
  const [item, setItem] = useState<ItemValue>(NO_ITEM);
  const [parent, setParent] = useState<ItemValue>(NO_ITEM);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const features = useClientFeatures(client, kind === "draft" || kind === "draft_feature");
  const pool = useMemo(() => parentPool(kind === "draft_feature" ? features?.epics : features?.features, kind === "draft_feature" ? "epic" : "feature"), [features, kind]);
  useEffect(() => setParent(NO_ITEM), [client, kind]);

  const save = async (as: CaptureKind | "dismissed") => {
    setBusy(true);
    setError(null);
    try {
      const input =
        as === "follow_up" ? { who: who.who, ...(who.whoRef && who.who.trim() ? { whoRef: who.whoRef } : {}), what, ...(due ? { due } : {}), clientKey: client, ...(channel ? { channel } : {}), ...(client && item.itemId ? { itemId: item.itemId } : {}) } :
        as === "draft" ? { clientKey: client, title, size, ...(parent.itemId ? { parentItemId: parent.itemId } : {}) } :
        as === "draft_feature" ? { clientKey: client, title, ...(parent.itemId ? { parentItemId: parent.itemId } : {}), ...(target ? { targetDate: target } : {}) } : {};
      await call("capture.route", { id: capture.id, as, ...input });
      const cname = clients.find((c) => c.clientKey === client)?.clientName ?? client;
      onDone(as === "dismissed" ? "Dismissed" : as === "follow_up" ? `Follow-up saved${who.who.trim() ? `: owed to ${who.who.trim()}` : ""}${due ? `, due ${plainDay(due)}` : ""}` : as === "draft" ? `Draft story saved for ${cname}` : `Draft feature saved for ${cname}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const blocked = kind === "later" ? null : kind !== "follow_up" && !client ? `Choose a client for the ${BOX_NAME[kind].toLowerCase()}` : kind === "follow_up" && !what.trim() ? "Say what you owe" : null;
  const parentWord = kind === "draft" ? "feature" : "epic";

  return (
    <div className="cap-sort">
      <div className="cap-kinds cap-box-kinds" role="radiogroup" aria-label="Sort as">
        {BOX_KINDS.map((k) => (
          <button key={k} type="button" role="radio" className="chip-btn" aria-checked={kind === k} data-kind={k} onClick={() => setChosen(k)} title={k === suggested && !chosen ? "Suggested by the rules" : undefined}>
            {BOX_NAME[k]}
            {k === suggested && !chosen && k !== "later" && <span className="cap-suggested">suggested</span>}
          </button>
        ))}
      </div>
      {kind !== "later" && (
        <div className="cap-fields cap-box-fields" role="group" aria-label={`${BOX_NAME[kind]} details`}>
          <label>Client <ClientSelect label="Client" value={client} clients={kind === "follow_up" ? formClients(clients) : clients} onChange={setClient} required={kind !== "follow_up"} /></label>
          {kind === "follow_up" ? (
            <>
              <label className="wide">What <input value={what} onChange={(e) => setWhat(e.target.value)} maxLength={200} /></label>
              <label>Who <PersonPicker value={who} onChange={setWho} clientKey={client} /></label>
              <label>
                Channel{" "}
                <select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="">Any</option>
                  {CLOSE_HOW.map((h) => <option key={h} value={h}>{HOW_LABEL[h]}</option>)}
                </select>
              </label>
              <label>Due <input type="date" aria-label="Due" value={due} onChange={(e) => setDue(e.target.value)} /></label>
              <label className="wide">Linked item <ItemLookup clientKey={client} value={item} onChange={setItem} label="Linked item" /></label>
            </>
          ) : (
            <>
              <label className="wide">Title <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
              <label className="wide">
                Under {parentWord}{" "}
                <ItemLookup clientKey={client} value={parent} onChange={setParent} label={`Parent ${parentWord}`} pool={(features?.status === "ok" ? pool : undefined) ?? NO_POOL} placeholder={!client ? undefined : !features ? `Loading ${parentWord}s…` : features.status !== "ok" ? `No ${parentWord} (DevOps unavailable)` : `Search open ${parentWord}s, or leave empty`} />
              </label>
              {kind === "draft" ? (
                <span className="cap-size" role="group" aria-label="Size">
                  {(["S", "M", "L"] as const).map((z) => (
                    <button key={z} type="button" className="mini" aria-pressed={size === z} onClick={() => setSize(z)}>{z}</button>
                  ))}
                </span>
              ) : (
                <label>Target date <input type="date" aria-label="Target date" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
              )}
            </>
          )}
        </div>
      )}
      <div className="cap-acts">
        {kind !== "later" ? (
          <button type="button" className="top-btn primary" disabled={busy || !!blocked} title={blocked ?? undefined} onClick={() => void save(kind)} data-cap-save>
            {SAVE_AS[kind]}
          </button>
        ) : (
          <span className="muted">Stays in the Inbox until you sort it</span>
        )}
        {onCancel ? (
          <button type="button" className="mini quiet" disabled={busy} onClick={onCancel}>Cancel</button>
        ) : (
          <button type="button" className="mini quiet" disabled={busy} onClick={() => void save("dismissed")}>Dismiss</button>
        )}
        {blocked && <span className="muted">{blocked}</span>}
        {error && <span className="set-problem" role="alert">{error}</span>}
      </div>
    </div>
  );
}

const TIP_KEY = "focustime.hint.capturetag";
const tipSeen = () => {
  try {
    return localStorage.getItem(TIP_KEY) === "1";
  } catch {
    return true;
  }
};

/** A client's open features and epics from DevOps (read-only), for a draft's parent; null while loading. */
export function useClientFeatures(client: string | null, on: boolean): CaptureFeatures | null {
  const [features, setFeatures] = useState<CaptureFeatures | null>(null);
  useEffect(() => {
    setFeatures(null);
    if (!on || !client) return;
    let live = true;
    call<CaptureFeatures>("capture.features", { clientKey: client }).then((f) => live && setFeatures(f), () => live && setFeatures({ clientKey: client, status: "unavailable", features: [], epics: [] }));
    return () => {
      live = false;
    };
  }, [client, on]);
  return features;
}

const NO_POOL = { items: [], children: [] };
const BOX_KINDS: readonly BoxKind[] = ["later", "follow_up", "draft", "draft_feature"];
const BOX_NAME: Record<BoxKind, string> = { later: "Sort later", ...KIND_NAME };

/**
 * The capture box (step 15.3: the one way to add something new). Enter saves at once; Shift+Enter is a new line (CP-1:
 * a small textarea that grows to about four lines); the ↵ button saves too. One client chip (step 15.2): filled from
 * the selected block when the box opens, @nickname sets it, a click chooses another. CP-1: the chip is the client a
 * capture is saved to, always; it never changes on its own after a save, and the Saved toast names it, with Undo.
 * Under the box, kind chips: the rules highlight one while I type; a click or Tab picks another. Each kind's fields open
 * inline, and Enter saves as that kind. Sort later saves an unsorted capture for the Inbox. A draft gets its AI version
 * in the background; Ctrl or Cmd+Enter saves it and opens the create preview at once.
 */
export function CaptureBox({ data, onChanged, autoFocus, defaultClient = null, initialKind = null, large = false, onOpenedDraft }: { data: WeekLoadData; onChanged: () => void; autoFocus?: boolean; defaultClient?: string | null; initialKind?: BoxKind | null; large?: boolean; /** CP-1: the create preview opened from here (the dialog closes itself). */ onOpenedDraft?: () => void }) {
  const clients = useMemo(() => captureClients(data), [data]);
  const known = (k: string | null) => (k && clients.some((c) => c.clientKey === k) ? k : null);
  const today = data.planDay.date;
  const [text, setText] = useState("");
  const [client, setClient] = useState<string | null>(() => known(defaultClient));
  const [choosing, setChoosing] = useState(false);
  const [tip, setTip] = useState(() => !tipSeen());
  const [chosen, setChosen] = useState<BoxKind | null>(initialKind);
  // CV-3: the PersonPicker's value once touched; until then the rules' name from the text (plain, offered to link).
  const [who, setWho] = useState<PersonValue | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [channel, setChannel] = useState("");
  const [item, setItem] = useState<ItemValue>(NO_ITEM);
  const [parent, setParent] = useState<ItemValue>(NO_ITEM);
  const [size, setSize] = useState<Size>("M");
  const [target, setTarget] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ captureId: number; text: string; body: string; client: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const openDraft = useContext(CreateDraftCtx);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const done = useMemo(() => tagCompletions(text, clients), [text, clients]);
  const clearNotice = useMemo(() => () => setNotice(null), []);
  const suggested = useMemo(() => boxKind(text, client, today, clients), [text, client, today, clients]);
  const kind = chosen ?? suggested;
  const s = useMemo(() => suggest(text, client, today, clients), [text, client, today, clients]);
  const features = useClientFeatures(client, kind === "draft" || kind === "draft_feature");
  const pool = useMemo(() => parentPool(kind === "draft_feature" ? features?.epics : features?.features, kind === "draft_feature" ? "epic" : "feature"), [features, kind]);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => setPick(0), [done.length]);
  // CP-1: the box grows with its text up to its max height (CSS), then scrolls.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [saved]);
  // A parent belongs to one client and one kind.
  useEffect(() => setParent(NO_ITEM), [client, kind]);

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
  // CP-1: the client chip stays as it is after a save: what I see is where the next one goes.
  const reset = () => {
    setText("");
    setChosen(initialKind);
    setWho(null);
    setDue(null);
    setChannel("");
    setItem(NO_ITEM);
    setParent(NO_ITEM);
    setSize("M");
    setTarget("");
  };
  const whoNow: PersonValue = who ?? { who: s.who, whoRef: null };
  const whoName = whoNow.who.trim();
  const dueNow = due ?? s.due ?? "";
  const blocked = (kind === "draft" || kind === "draft_feature") && !client ? `A ${BOX_NAME[kind].toLowerCase()} needs a client: choose one with the client chip or type @` : null;

  const submit = async (open = false) => {
    const body = text.trim();
    if (!body || busy) return;
    // CP-1: the chip is the client, always (an @tag counts only once it is the chip).
    const key = client;
    if (blocked) return void setError(blocked);
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ capture: Capture }>("capture.add", { text: body, ...(key ? { clientKey: key } : {}) });
      const cn = key ? clientName(key) : null;
      let msg = savedText("later", cn);
      let draftId: number | null = null;
      if (kind !== "later") {
        const sg = suggest(body, key, today, clients);
        const input =
          kind === "follow_up" ? { clientKey: key, who: whoNow.who, ...(whoNow.whoRef && whoName ? { whoRef: whoNow.whoRef } : {}), what: sg.what || body, ...(dueNow ? { due: dueNow } : {}), ...(channel ? { channel } : {}), ...(key && item.itemId ? { itemId: item.itemId } : {}) } :
          kind === "draft" ? { clientKey: key, title: sg.title || body, size, ...(parent.itemId ? { parentItemId: parent.itemId } : {}) } :
          { clientKey: key, title: sg.title || body, ...(parent.itemId ? { parentItemId: parent.itemId } : {}), ...(target ? { targetDate: target } : {}) };
        try {
          const routed = await call<{ capture: Capture }>("capture.route", { id: r.capture.id, as: kind, ...input });
          msg = savedText(kind, cn, kind === "follow_up" ? `${whoName ? `, owed to ${whoName}` : ""}${dueNow ? `, due ${plainDay(dueNow)}` : ""}` : "");
          if (kind !== "follow_up") draftId = routed.capture.routedId;
        } catch (e) {
          // The capture itself is saved; it waits in the Inbox to sort.
          msg = `${savedText("later", cn)}; not sorted: ${e instanceof Error ? e.message : "that didn't work"}`;
        }
      }
      reset();
      setNotice(null);
      setSaved({ captureId: r.capture.id, text: msg, body, client: key });
      onChanged();
      if (draftId !== null && open && openDraft) {
        // The preview prepares it (once) and shows "AI still writing…" until it is ready.
        openDraft(draftId);
        onOpenedDraft?.();
      } else {
        if (draftId !== null) void call("draft.prepare", { id: draftId }).then(onChanged, () => undefined);
        input.current?.focus();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  /** CP-1: the toast's Undo: the capture and what it made go, and its text comes back into the box. */
  const undo = async () => {
    const sv = saved;
    if (!sv) return;
    setSaved(null);
    try {
      await call("capture.undo", { id: sv.captureId });
      setText((t) => t || sv.body);
      if (sv.client !== client) setClient(sv.client);
      setNotice("Undone");
      onChanged();
      input.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not undo");
    }
  };
  const cycle = (dir: 1 | -1) => setChosen(BOX_KINDS[(BOX_KINDS.indexOf(kind) + dir + BOX_KINDS.length) % BOX_KINDS.length]!);
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (done.length && (e.key === "Tab" || (e.key === "Enter" && /@[^\s@]*$/.test(text)))) {
      e.preventDefault();
      complete(done[pick]!);
    } else if (done.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setPick((p) => (p + (e.key === "ArrowDown" ? 1 : done.length - 1)) % done.length);
    } else if (e.key === "Tab" && !e.shiftKey && text.trim()) {
      // Tab changes the kind while there is text; with an empty box it moves on as usual.
      e.preventDefault();
      cycle(1);
    } else if (e.key === "ArrowDown" && kind !== "later" && onLastLine(text, e.currentTarget.selectionEnd)) {
      e.preventDefault();
      fieldsRef.current?.querySelector<HTMLElement>("input:not([disabled]), select, button")?.focus();
    } else {
      const a = keyAction(e.nativeEvent);
      if (!a) return;
      e.preventDefault();
      void submit(a === "save_open");
    }
  };
  // Enter in a one-line field saves too (not in the lookups' own lists, which handle Enter first).
  const onFieldKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && !e.shiftKey && !e.defaultPrevented && (t.tagName === "INPUT" || t.tagName === "SELECT") && t.getAttribute("aria-expanded") !== "true") {
      e.preventDefault();
      void submit(e.ctrlKey || e.metaKey);
    }
  };
  return (
    <div className={`cap-box${large ? " large" : ""}`}>
      <div className="cap-input">
        <div className="cap-field">
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(e) => (onText(e.target.value), setError(null))}
          onKeyDown={onKey}
          maxLength={1000}
          placeholder="Capture anything…"
          aria-label="Quick capture"
          aria-autocomplete="list"
          aria-expanded={done.length > 0}
          aria-describedby="cap-kind-hint"
        />
        <button type="button" className="cap-send" aria-label="Save" title="Save (Enter)" disabled={busy || !text.trim()} onMouseDown={(e) => e.preventDefault()} onClick={() => void submit()}>
          ↵
        </button>
        </div>
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
      <div className="cap-kinds cap-box-kinds" role="radiogroup" aria-label="Save as">
        {BOX_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            className="chip-btn"
            aria-checked={kind === k}
            data-kind={k}
            tabIndex={-1}
            title={k === suggested && !chosen && text.trim() ? "Suggested by the rules" : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (setChosen(k), input.current?.focus())}
          >
            {BOX_NAME[k]}
            {k === suggested && !chosen && k !== "later" && text.trim() && <span className="cap-suggested">suggested</span>}
          </button>
        ))}
        <span className="muted cap-kind-hint" id="cap-kind-hint">
          {text.trim() ? `Tab changes the kind${kind !== "later" ? " · ↓ to its details" : ""} · Enter saves${kind === "draft" || kind === "draft_feature" ? " · Ctrl+Enter saves and opens the preview" : ""}` : "Enter saves · Shift+Enter for a new line"}
        </span>
      </div>
      {kind !== "later" && text.trim() && (
        <div className="cap-fields cap-box-fields" ref={fieldsRef} onKeyDown={onFieldKey} aria-label={`${BOX_NAME[kind]} details`} role="group">
          {kind === "follow_up" && (
            <>
              <label>Who <PersonPicker value={whoNow} onChange={setWho} clientKey={client} /></label>
              <label>
                Channel{" "}
                <select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="">Any</option>
                  {CLOSE_HOW.map((h) => <option key={h} value={h}>{HOW_LABEL[h]}</option>)}
                </select>
              </label>
              <label>Due <input type="date" aria-label="Due" value={dueNow} onChange={(e) => setDue(e.target.value)} /></label>
              <label className="wide">Linked item <ItemLookup clientKey={client} value={item} onChange={setItem} label="Linked item" /></label>
            </>
          )}
          {kind === "draft" && (
            <>
              <label className="wide">
                Under feature{" "}
                <ItemLookup clientKey={client} value={parent} onChange={setParent} label="Parent feature" pool={(features?.status === "ok" ? pool : undefined) ?? NO_POOL} placeholder={!client ? undefined : !features ? "Loading features…" : features.status !== "ok" ? "No feature (DevOps unavailable)" : "Search open features, or leave empty"} />
              </label>
              <span className="cap-size" role="group" aria-label="Size">
                {(["S", "M", "L"] as const).map((z) => (
                  <button key={z} type="button" className="mini" aria-pressed={size === z} onClick={() => setSize(z)}>{z}</button>
                ))}
              </span>
            </>
          )}
          {kind === "draft_feature" && (
            <>
              <label className="wide">
                Under epic{" "}
                <ItemLookup clientKey={client} value={parent} onChange={setParent} label="Parent epic" pool={(features?.status === "ok" ? pool : undefined) ?? NO_POOL} placeholder={!client ? undefined : !features ? "Loading epics…" : features.status !== "ok" ? "No epic (DevOps unavailable)" : "Search open epics, or leave empty"} />
              </label>
              <label>Target date <input type="date" aria-label="Target date" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
            </>
          )}
          {blocked && <span className="muted cap-blocked">{blocked}</span>}
        </div>
      )}
      {tip && (
        <p className="cap-tip">
          Tip: type @ and a client's nickname to tag it. <button type="button" className="link-btn" onClick={dismissTip}>Got it</button>
        </p>
      )}
      {error && <p className="set-problem" role="alert">{error}</p>}
      {saved ? (
        <p className="cap-toast" role="status">
          <span>{saved.text}</span>
          <span aria-hidden="true">·</span>
          <button type="button" className="link-btn" onClick={() => void undo()}>Undo</button>
        </p>
      ) : (
        <Fading text={notice} onGone={clearNotice} />
      )}
    </div>
  );
}

/** The capture box over any view (N, the top-bar button, the command menu, or the global key via focustime-open). */
export function CaptureDialog({ data, onClose, onChanged, onOpenView, defaultClient = null, initialKind = null }: { data: WeekLoadData; onClose: () => void; onChanged: () => void; onOpenView: () => void; defaultClient?: string | null; initialKind?: BoxKind | null }) {
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => () => back.current?.focus?.(), []);
  // P1: a full-screen sheet on the phone; UI-3: closed with the same × as everywhere (a 44 px target).
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
          <span className="muted">Saved at once, even offline. Sort it now with a kind, or later in the Inbox.</span>
          <button type="button" className="mini quiet" onClick={onOpenView} title="Captures to sort and follow-ups">
            Open Inbox{data.captures > 0 ? ` (${data.captures} to sort)` : ""}
          </button>
          <CloseButton onClose={onClose} />
        </div>
        <CaptureBox data={data} onChanged={onChanged} autoFocus defaultClient={defaultClient} initialKind={initialKind} onOpenedDraft={onClose} />
      </div>
    </div>
  );
}

export { when as captureWhen };
