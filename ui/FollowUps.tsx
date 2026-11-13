// Follow-ups (step 6c, step 7, step 13.5): what I owe people. Opened by rules (pick done but DevOps not updated, slipped
// work, a blocked item, a flex session) or by hand; closed by a DevOps signal or "Close the loop" with an optional how
// and note. Not needed closes one quietly; Snooze hides one until a day; Delete is only for ones I added. Local only:
// nothing is posted anywhere; heads-up drafts are copied by hand.
import { TextBox } from "./TextBox.tsx";
import { DevOpsAction } from "./DevOpsWrite.tsx";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ItemLookup, NO_ITEM, type ItemValue } from "./ItemLookup.tsx";
import { parseItemRef } from "../plan/lookup.ts";
import { DevOpsWork } from "./work.ts";
import { WorkLink } from "./WorkLink.tsx";
import type { FollowUpView, PeopleData } from "../actions/types.ts";
import { PersonPicker, type PersonValue } from "./PersonPicker.tsx";
import type { CaptureClient } from "../plan/capture.ts";
import { CLOSE_HOW, type CloseHow } from "../plan/types.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";
import type { IsoDate } from "../week/types.ts";
import { call } from "./api.ts";
import { HOW_LABEL } from "./CloseLoop.tsx";
import { SendLoop } from "./SendLoop.tsx";
import { stampText } from "./stamp.ts";
import { Icon } from "./icons.tsx";
export { HOW_LABEL };

const zoned = (iso: string, tz: string) => (iso.includes("[") ? Temporal.ZonedDateTime.from(iso) : Temporal.Instant.from(iso).toZonedDateTimeISO(tz)).withTimeZone(tz);
const dayOf = (z: Temporal.ZonedDateTime) => z.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const clock = (z: Temporal.ZonedDateTime) => `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
const when = (iso: string, tz: string) => stampText(iso, tz);
const plainDay = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
/** "Tue, Nov 3, 3:00 PM to 6:00 PM": the session a follow-up came from. */
const span = (s: { start: string; end: string }, tz: string) => {
  const a = zoned(s.start, tz);
  const b = zoned(s.end, tz);
  return `${dayOf(a)}, ${clock(a)} to ${clock(b)}`;
};

const KIND_LABEL: Record<string, string> = { devops_update: "DevOps update", slip: "Heads-up", blocked: "Blocker", flex_update: "Flex session", manual: "Added by me", capture: "Captured", priorities: "Priorities" };

/** Copies text; falls back to selecting it when the clipboard isn't available. */
export async function copy(text: string, el: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    el?.focus();
    el?.select();
    return false;
  }
}

/** The due badge (step 13.5): always words, colored by how close it is; never small gray text. */
/**
 * A promise's due date in words. PS-1: where the badge stands alone (a card's chip), `about` names the promise ("to Jordan
 * Lee: Send the revised estimate") on hover and for a screen reader, so "Due today" never says only when.
 */
export function DueBadge({ l, about }: { l: Pick<FollowUpView, "dueState">; about?: string | undefined }) {
  if (!l.dueState) return null;
  return (
    <span className={`due-badge ${l.dueState.level}`} title={about ? `${l.dueState.text}: promise ${about}` : undefined}>
      {l.dueState.text}
      {about && <span className="sr-only">: promise {about}</span>}
    </span>
  );
}

/** PS-1: what a due chip's hover and screen reader text say it is about: "to Jordan Lee: Send the estimate". */
export const promiseAbout = (f: Pick<FollowUpView, "hasWho" | "who" | "what">) => `${f.hasWho ? `to ${f.who}` : ""}${f.hasWho ? ": " : ""}${f.what}`;

/** Runs one follow-up action; the caller reloads. Returns the error text, or null. */
async function act(action: string, input: Record<string, unknown>): Promise<string | null> {
  try {
    await call(action, input);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not do that";
  }
}

const tomorrowOf = (today: IsoDate) => Temporal.PlainDate.from(today).add({ days: 1 }).toString();
const nextMondayOf = (today: IsoDate) => {
  const t = Temporal.PlainDate.from(today);
  return t.add({ days: 8 - t.dayOfWeek }).toString();
};

/** One follow-up: due badge, who, what, where it came from; "Close the loop" and the ⋯ menu (Not needed, Snooze, Edit, Delete). */
/** compact (U2, Close out): the due badge, who and what, Close the loop and ⋯; no kind, "New today" or when. */
export function FollowUpRow({ l, timeZone, today, clients, onChanged, compact = false }: { l: FollowUpView; timeZone: string; today: IsoDate; clients: readonly CaptureClient[]; onChanged: (msg?: string) => void; compact?: boolean }) {
  const [mode, setMode] = useState<"none" | "close" | "snooze" | "edit">("none");
  const [menu, setMenu] = useState(false);
  const [how, setHow] = useState<CloseHow | null>((CLOSE_HOW as readonly string[]).includes(l.channel ?? "") ? (l.channel as CloseHow) : null);
  const [until, setUntil] = useState(tomorrowOf(today));
  const [showDraft, setShowDraft] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const run = async (action: string, input: Record<string, unknown>, msg: string) => {
    const e = await act(action, { id: l.id, ...input });
    setError(e);
    if (!e) {
      setMode("none");
      setMenu(false);
      onChanged(msg);
    }
  };
  const closedText = l.closedAt
    ? l.outcome === "not_needed"
      ? `Not needed · ${when(l.closedAt, timeZone)}`
      : `${l.closedBy === "signal" ? "Closed by DevOps" : "Loop closed"}${l.closeHow ? ` on ${HOW_LABEL[l.closeHow]}` : ""} · ${when(l.closedAt, timeZone)}${l.closeNote ? `: ${l.closeNote}` : ""}`
    : null;
  // U5: the row says who, what and when it's due; how and when it was opened is on hover. One action shows: Mark
  // done in DevOps for a DevOps update with an item, else Close the loop; the rest are in ⋯.
  const meta = [l.clientName && l.who !== l.clientName ? l.clientName : null, KIND_LABEL[l.kind] ?? "Promise", l.session ? `Flex session ${span(l.session, timeZone)}` : null, `opened ${when(l.openedAt, timeZone)}`, l.channel && !l.closedAt ? `on ${HOW_LABEL[l.channel as CloseHow] ?? l.channel}` : null].filter(Boolean).join(" · ");
  const devopsFirst = !l.closedAt && l.kind === "devops_update" && l.itemId !== null && !!l.clientKey;
  const state = [l.snoozedUntil && !l.closedAt ? `snoozed until ${plainDay(l.snoozedUntil)}` : null, closedText].filter(Boolean).join(" · ");
  return (
    <li title={meta} data-follow-up={l.id} className={`follow-up${mode === "close" || mode === "snooze" ? " has-form" : ""}${l.closedAt ? " closed" : ""}${l.isNew && !l.closedAt ? " new" : ""}${l.dueState ? ` due-${l.dueState.level}` : ""}`}>
      <div className="follow-up-main">
        <DueBadge l={l} />
        <span className="follow-up-who">{l.hasWho ? l.who : "No one named"}</span>
        <span className="follow-up-what">{l.what}</span>
        {(l.kind === "manual" || l.kind === "capture") && <LinkedItem l={l} />}
        {!compact && state && <span className="muted follow-up-when">{state}</span>}
        {!compact && l.origin && (
          <span className="follow-up-origin">
            Why: {l.origin.trigger}
            {l.origin.items.length ? ` (${l.origin.items.map((i) => (i.itemId ? `#${i.itemId} ${i.title}` : i.title)).join(", ")})` : ""} · {when(l.origin.at, timeZone)}
          </span>
        )}
        {l.draft && showDraft && (
          <div className="follow-up-draft">
            <TextBox ref={area} readOnly value={l.draft} minRows={2} maxRows={8} aria-label="Heads-up draft" />
          </div>
        )}
      </div>
      <div className="follow-up-actions">
        {copied && <span className="muted">{copied}</span>}
        {devopsFirst && mode === "none" && (
          // Step 14: one click to the state picker (completed state preselected); the loop closes after read back.
          <DevOpsAction clientKey={l.clientKey!} label="Mark done in DevOps" className="mini primary" onRun={(w) => w.markDone({ clientKey: l.clientKey!, itemId: l.itemId!, title: l.what, followUpId: l.id })} />
        )}
        {!l.closedAt && mode === "none" && (
          <>
            {!devopsFirst && (
              <button type="button" className="mini primary" onClick={() => setMode("close")}>
                Close the loop
              </button>
            )}
            <span className="fu-more">
              <button type="button" className="mini quiet icon-btn small" aria-haspopup="menu" aria-expanded={menu} aria-label={`More for: ${l.what}`} onClick={() => setMenu((v) => !v)}>
                <Icon name="more" />
              </button>
              {menu && (
                <span className="fu-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setMenu(false))}>
                  {devopsFirst && <button type="button" role="menuitem" autoFocus onClick={() => { setMode("close"); setMenu(false); }}>Close the loop…</button>}
                  {l.draft && <button type="button" role="menuitem" onClick={() => { setShowDraft((v) => !v); setMenu(false); }}>{showDraft ? "Hide the heads-up draft" : "Show the heads-up draft"}</button>}
                  {l.draft && (
                    <button type="button" role="menuitem" onClick={async () => { setShowDraft(true); setMenu(false); setCopied((await copy(l.draft!, area.current)) ? "Copied" : "Selected, press Ctrl C"); }}>
                      Copy heads-up
                    </button>
                  )}
                  <button type="button" role="menuitem" autoFocus={!devopsFirst} onClick={() => void run("followup.not_needed", {}, "Closed as not needed")}>Not needed</button>
                  <button type="button" role="menuitem" onClick={() => { setMode("snooze"); setMenu(false); }}>Snooze…</button>
                  <button type="button" role="menuitem" onClick={() => { setMode("edit"); setMenu(false); }}>Edit…</button>
                  {l.byHand && <button type="button" role="menuitem" className="danger" onClick={() => void run("followup.delete", {}, "Deleted")}>Delete</button>}
                </span>
              )}
            </span>
          </>
        )}
        {error && <span className="set-problem" role="alert">{error}</span>}
      </div>
      {mode === "close" && (
        // IB-1: the shared Close the loop on its own full-width row (never beside the text, so nothing scrolls sideways).
        <div className="follow-up-form-row">
          <SendLoop
            promiseKey={`f${l.id}`}
            who={l.hasWho ? l.who : null}
            initialHow={how}
            compact={compact}
            onClosed={(m) => {
              setMode("none");
              onChanged(m);
            }}
            closeWithout={async (v) => {
              const e = await act("followup.close", { id: l.id, note: v.note, ...(v.how ? { how: v.how } : {}) });
              if (!e) {
                setHow(v.how);
                setMode("none");
                onChanged("Loop closed");
              }
              return e;
            }}
            onCancel={() => setMode("none")}
          />
        </div>
      )}
      {mode === "snooze" && (
        <div className="follow-up-form-row">
          <form className="follow-up-snooze" onSubmit={(e) => { e.preventDefault(); void run("followup.snooze", { until }, `Snoozed until ${plainDay(until)}`); }}>
            <button type="button" className="mini" onClick={() => setUntil(tomorrowOf(today))} aria-pressed={until === tomorrowOf(today)}>Tomorrow</button>
            <button type="button" className="mini" onClick={() => setUntil(nextMondayOf(today))} aria-pressed={until === nextMondayOf(today)}>Next Monday</button>
            <input type="date" value={until} min={tomorrowOf(today)} onChange={(e) => setUntil(e.target.value)} aria-label="Snooze until" />
            <button type="submit" className="mini primary">Snooze</button>
            <button type="button" className="mini" onClick={() => setMode("none")}>Cancel</button>
          </form>
        </div>
      )}
      {mode === "edit" && (
        <FollowUpForm clients={clients} initial={l} onCancel={() => setMode("none")} onSaved={() => { setMode("none"); onChanged("Saved"); }} />
      )}
    </li>
  );
}

/** Who to suggest (step 13.5): Cooptimizers (minus the excluded), then people from my meetings with that client. */
export function usePeople(clientKey: string | null): PeopleData | null {
  const [p, setP] = useState<PeopleData | null>(null);
  useEffect(() => {
    let live = true;
    setP(null);
    call<PeopleData>("followup.people", clientKey ? { clientKey } : {}).then((r) => live && setP(r), () => live && setP({ teammates: [], attendees: [], problems: ["Suggestions unavailable"] }));
    return () => {
      live = false;
    };
  }, [clientKey]);
  return p;
}

/** Clients for the form: followed clients plus Cooptimize. */
export function formClients(clients: readonly CaptureClient[]): CaptureClient[] {
  return clients.some((c) => c.clientKey === INTERNAL_CLIENT) ? [...clients] : [...clients, { clientKey: INTERNAL_CLIENT, clientName: INTERNAL_CLIENT }];
}

/** Add or edit a follow-up: client (default the selected block's), who with suggestions, what, channel, due. */
export function FollowUpForm({ clients, initial, defaultClient = null, onSaved, onCancel }: { clients: readonly CaptureClient[]; initial?: FollowUpView; defaultClient?: string | null; onSaved: () => void; onCancel: () => void }) {
  const all = formClients(clients);
  const [clientKey, setClient] = useState<string | null>(initial ? initial.clientKey : defaultClient && all.some((c) => c.clientKey === defaultClient) ? defaultClient : null);
  // CV-2: Who as a person from the PersonPicker, or a plain name; an older follow-up keeps its text.
  const [who, setWho] = useState<PersonValue>({ who: initial?.hasWho && initial.who !== initial.clientName ? initial.who : "", whoRef: initial?.whoRef ?? null });
  const [what, setWhat] = useState(initial?.what ?? "");
  const [channel, setChannel] = useState<string>(initial?.channel ?? "");
  const [due, setDue] = useState(initial?.due ?? "");
  // Step 15.2: the item this follow-up is about, through the shared lookup.
  const work = useContext(DevOpsWork);
  const [item, setItem] = useState<ItemValue>(() => {
    if (!initial?.itemId) return { ...NO_ITEM };
    const cw = initial.clientKey ? work.get(initial.clientKey) : undefined;
    const w = [...(cw?.items ?? []), ...(cw?.children ?? []), ...(cw?.watched ?? []), ...(cw?.committed ?? [])].find((x) => x.id === initial.itemId);
    return { itemId: initial.itemId, title: w?.title ?? null, url: w?.url ?? null, text: "" };
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="follow-up-add"
      onSubmit={async (e) => {
        e.preventDefault();
        const typed = item.itemId ?? (clientKey ? parseItemRef(item.text) : null);
        // Plain text that isn't an item stays with what I owe.
        const extra = !typed && item.text.trim() ? ` · ${item.text.trim()}` : "";
        const input = { clientKey, who: who.who.trim() || null, whoRef: who.who.trim() ? who.whoRef : null, what: `${what}${extra}`.slice(0, 200), channel: channel || null, due: due || null, ...(typed || initial ? { itemId: typed } : {}) };
        const err = await act(initial ? "followup.edit" : "followup.add", initial ? { id: initial.id, ...input } : input);
        setError(err);
        if (!err) onSaved();
      }}
    >
      <label>
        Client{" "}
        <select aria-label="Client" value={clientKey ?? ""} onChange={(e) => setClient(e.target.value || null)}>
          <option value="">No client</option>
          {all.map((c) => <option key={c.clientKey} value={c.clientKey}>{c.clientName}</option>)}
        </select>
      </label>
      <label>
        Who <PersonPicker value={who} onChange={setWho} clientKey={clientKey} />
      </label>
      <label className="wide">
        What I owe <input autoFocus required maxLength={200} value={what} placeholder="e.g. Send the mapping notes" onChange={(e) => setWhat(e.target.value)} />
      </label>
      <label>
        Channel{" "}
        <select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">Any</option>
          {CLOSE_HOW.map((h) => <option key={h} value={h}>{HOW_LABEL[h]}</option>)}
        </select>
      </label>
      <label>
        Due <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      <label className="wide">
        Work item <ItemLookup clientKey={clientKey} value={item} onChange={setItem} />
      </label>
      <button type="submit" className="mini primary">{initial ? "Save" : "Add"}</button>
      <button type="button" className="mini" onClick={onCancel}>Cancel</button>
      {error && <span className="set-problem">{error}</span>}
    </form>
  );
}

/** Step 15.2: the DevOps item a follow-up I added is about, as a link when the item is loaded. */
function LinkedItem({ l }: { l: FollowUpView }) {
  const work = useContext(DevOpsWork);
  if (!l.itemId || !l.clientKey) return null;
  const cw = work.get(l.clientKey);
  const w = [...(cw?.items ?? []), ...(cw?.children ?? []), ...(cw?.watched ?? []), ...(cw?.committed ?? [])].find((x) => x.id === l.itemId);
  return (
    <span className="follow-up-item">
      {w ? <WorkLink clientKey={l.clientKey} url={w.url}>#{w.id} {w.title}</WorkLink> : `#${l.itemId}`}
    </span>
  );
}

/** A status line that fades on its own (step 13.5: no bar left behind). */
export function Fading({ text, onGone, ms = 4000 }: { text: ReactNode; onGone: () => void; ms?: number }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onGone, ms);
    return () => clearTimeout(t);
  }, [text, onGone, ms]);
  return text ? <p className="co-notice fading" role="status">{text}</p> : null;
}
