// Follow-ups (step 6c, step 7, step 13.5): what I owe people. Opened by rules (pick done but DevOps not updated, slipped
// work, a blocked item, a flex session) or by hand; closed by a DevOps signal or "Close the loop" with an optional how
// and note. Not needed closes one quietly; Snooze hides one until a day; Delete is only for ones I added. Local only:
// nothing is posted anywhere; heads-up drafts are copied by hand.
import { DevOpsAction } from "./DevOpsWrite.tsx";
import { useContext, useEffect, useRef, useState } from "react";
import { ItemLookup, NO_ITEM, type ItemValue } from "./ItemLookup.tsx";
import { parseItemRef } from "../plan/lookup.ts";
import { DevOpsWork } from "./work.ts";
import { WorkLink } from "./WorkLink.tsx";
import type { FollowUpView, PeopleData } from "../actions/types.ts";
import type { CaptureClient } from "../plan/capture.ts";
import { CLOSE_HOW, type CloseHow } from "../plan/types.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";
import type { IsoDate } from "../week/types.ts";
import { call } from "./api.ts";

const zoned = (iso: string, tz: string) => (iso.includes("[") ? Temporal.ZonedDateTime.from(iso) : Temporal.Instant.from(iso).toZonedDateTimeISO(tz)).withTimeZone(tz);
const dayOf = (z: Temporal.ZonedDateTime) => z.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const clock = (z: Temporal.ZonedDateTime) => `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
const when = (iso: string, tz: string) => {
  const z = zoned(iso, tz);
  return `${dayOf(z)}, ${clock(z)}`;
};
const plainDay = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
/** "Tue, Nov 3, 3:00 PM to 6:00 PM": the session a follow-up came from. */
const span = (s: { start: string; end: string }, tz: string) => {
  const a = zoned(s.start, tz);
  const b = zoned(s.end, tz);
  return `${dayOf(a)}, ${clock(a)} to ${clock(b)}`;
};

const KIND_LABEL: Record<string, string> = { devops_update: "DevOps update", slip: "Heads-up", blocked: "Blocker", flex_update: "Flex session", manual: "Added by me", capture: "Captured", priorities: "Priorities" };
export const HOW_LABEL: Record<CloseHow, string> = { teams: "Teams", email: "Email", devops: "DevOps", call: "Call" };

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
export function DueBadge({ l }: { l: Pick<FollowUpView, "dueState"> }) {
  if (!l.dueState) return null;
  return <span className={`due-badge ${l.dueState.level}`}>{l.dueState.text}</span>;
}

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
export function FollowUpRow({ l, timeZone, today, clients, onChanged }: { l: FollowUpView; timeZone: string; today: IsoDate; clients: readonly CaptureClient[]; onChanged: (msg?: string) => void }) {
  const [mode, setMode] = useState<"none" | "close" | "snooze" | "edit">("none");
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState("");
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
  return (
    <li className={`follow-up${l.closedAt ? " closed" : ""}${l.isNew && !l.closedAt ? " new" : ""}${l.dueState ? ` due-${l.dueState.level}` : ""}`}>
      <div className="follow-up-main">
        <span className="follow-up-kind">{KIND_LABEL[l.kind] ?? "Follow-up"}</span>
        <DueBadge l={l} />
        {l.isNew && !l.closedAt && <span className="follow-up-new">New today</span>}
        <span className="follow-up-who">{l.hasWho ? l.who : "No one named"}</span>
        <span className="follow-up-what">{l.what}</span>
        {(l.kind === "manual" || l.kind === "capture") && <LinkedItem l={l} />}
        <span className="muted follow-up-when">
          {l.clientName && l.who !== l.clientName ? `${l.clientName} · ` : ""}
          {l.session ? `Flex session ${span(l.session, timeZone)} · ` : ""}opened {when(l.openedAt, timeZone)}
          {l.channel && !l.closedAt ? ` · on ${HOW_LABEL[l.channel as CloseHow] ?? l.channel}` : ""}
          {l.snoozedUntil && !l.closedAt ? ` · snoozed until ${plainDay(l.snoozedUntil)}` : ""}
          {closedText ? ` · ${closedText}` : ""}
        </span>
        {l.origin && (
          <span className="follow-up-origin">
            Why: {l.origin.trigger}
            {l.origin.items.length ? ` (${l.origin.items.map((i) => (i.itemId ? `#${i.itemId} ${i.title}` : i.title)).join(", ")})` : ""} · {when(l.origin.at, timeZone)}
          </span>
        )}
        {l.draft && showDraft && (
          <div className="follow-up-draft">
            <textarea ref={area} readOnly value={l.draft} rows={Math.min(8, l.draft.split("\n").length + 1)} aria-label="Heads-up draft" />
          </div>
        )}
      </div>
      <div className="follow-up-actions">
        {l.draft && (
          <>
            <button type="button" className="mini" aria-expanded={showDraft} onClick={() => setShowDraft((v) => !v)}>
              {showDraft ? "Hide draft" : "Draft"}
            </button>
            <button
              type="button"
              className="mini"
              onClick={async () => {
                setShowDraft(true);
                setCopied((await copy(l.draft!, area.current)) ? "Copied" : "Selected, press Ctrl C");
              }}
            >
              {copied ?? "Copy heads-up"}
            </button>
          </>
        )}
        {!l.closedAt && mode === "none" && l.kind === "devops_update" && l.itemId !== null && l.clientKey && (
          // Step 14: one click to the state picker (completed state preselected); the loop closes after read back.
          <DevOpsAction clientKey={l.clientKey} label="Mark done in DevOps" className="mini primary" onRun={(w) => w.markDone({ clientKey: l.clientKey!, itemId: l.itemId!, title: l.what, followUpId: l.id })} />
        )}
        {!l.closedAt && mode === "none" && (
          <>
            <button type="button" className={`mini${l.kind === "devops_update" ? "" : " primary"}`} onClick={() => { setMode("close"); setNote(""); }}>
              Close the loop
            </button>
            <span className="fu-more">
              <button type="button" className="mini quiet" aria-haspopup="menu" aria-expanded={menu} aria-label={`More for: ${l.what}`} onClick={() => setMenu((v) => !v)}>
                ⋯
              </button>
              {menu && (
                <span className="fu-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setMenu(false))}>
                  <button type="button" role="menuitem" autoFocus onClick={() => void run("followup.not_needed", {}, "Closed as not needed")}>Not needed</button>
                  <button type="button" role="menuitem" onClick={() => { setMode("snooze"); setMenu(false); }}>Snooze…</button>
                  <button type="button" role="menuitem" onClick={() => { setMode("edit"); setMenu(false); }}>Edit…</button>
                  {l.byHand && <button type="button" role="menuitem" className="danger" onClick={() => void run("followup.delete", {}, "Deleted")}>Delete</button>}
                </span>
              )}
            </span>
          </>
        )}
        {mode === "close" && (
          <form
            className="follow-up-close"
            onSubmit={(e) => {
              e.preventDefault();
              void run("followup.close", { note: note.trim() || null, ...(how ? { how } : {}) }, "Loop closed");
            }}
          >
            <span className="cap-size" role="group" aria-label="How (optional)">
              {CLOSE_HOW.map((h) => (
                <button key={h} type="button" className="mini" aria-pressed={how === h} onClick={() => setHow(how === h ? null : h)}>{HOW_LABEL[h]}</button>
              ))}
            </span>
            <input autoFocus value={note} maxLength={500} placeholder="Note (optional)" onChange={(e) => setNote(e.target.value)} aria-label="Note" />
            <button type="submit" className="mini primary">Close the loop</button>
            <button type="button" className="mini" onClick={() => setMode("none")}>Cancel</button>
          </form>
        )}
        {mode === "snooze" && (
          <form className="follow-up-close" onSubmit={(e) => { e.preventDefault(); void run("followup.snooze", { until }, `Snoozed until ${plainDay(until)}`); }}>
            <button type="button" className="mini" onClick={() => setUntil(tomorrowOf(today))} aria-pressed={until === tomorrowOf(today)}>Tomorrow</button>
            <button type="button" className="mini" onClick={() => setUntil(nextMondayOf(today))} aria-pressed={until === nextMondayOf(today)}>Next Monday</button>
            <input type="date" value={until} min={tomorrowOf(today)} onChange={(e) => setUntil(e.target.value)} aria-label="Snooze until" />
            <button type="submit" className="mini primary">Snooze</button>
            <button type="button" className="mini" onClick={() => setMode("none")}>Cancel</button>
          </form>
        )}
        {error && <span className="set-problem" role="alert">{error}</span>}
      </div>
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

/** A free-text Who with suggestions from usePeople (a datalist: typing anything else is fine). */
export function WhoInput({ value, onChange, clientKey, id }: { value: string; onChange: (v: string) => void; clientKey: string | null; id: string }) {
  const people = usePeople(clientKey);
  const names = [...new Set([...(people?.attendees ?? []), ...(people?.teammates ?? [])].map((x) => x.name))];
  // Attendees from that client's meetings first when a client is chosen; Cooptimizers first otherwise.
  const ordered = clientKey && clientKey !== INTERNAL_CLIENT ? names : [...new Set([...(people?.teammates ?? []).map((x) => x.name), ...names])];
  return (
    <>
      <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={100} placeholder="Name (optional)" list={id} aria-label="Who" />
      <datalist id={id}>
        {ordered.map((n) => <option key={n} value={n} />)}
      </datalist>
    </>
  );
}

/** Clients for the form: followed clients plus Cooptimize. */
export function formClients(clients: readonly CaptureClient[]): CaptureClient[] {
  return clients.some((c) => c.clientKey === INTERNAL_CLIENT) ? [...clients] : [...clients, { clientKey: INTERNAL_CLIENT, clientName: INTERNAL_CLIENT }];
}

/** Add or edit a follow-up: client (default the selected block's), who with suggestions, what, channel, due. */
export function FollowUpForm({ clients, initial, defaultClient = null, onSaved, onCancel }: { clients: readonly CaptureClient[]; initial?: FollowUpView; defaultClient?: string | null; onSaved: () => void; onCancel: () => void }) {
  const all = formClients(clients);
  const [clientKey, setClient] = useState<string | null>(initial ? initial.clientKey : defaultClient && all.some((c) => c.clientKey === defaultClient) ? defaultClient : null);
  const [who, setWho] = useState(initial?.hasWho && initial.who !== initial.clientName ? initial.who : "");
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
  const formId = useRef(`fu-who-${Math.random().toString(36).slice(2, 8)}`);
  return (
    <form
      className="follow-up-add"
      onSubmit={async (e) => {
        e.preventDefault();
        const typed = item.itemId ?? (clientKey ? parseItemRef(item.text) : null);
        // Plain text that isn't an item stays with what I owe.
        const extra = !typed && item.text.trim() ? ` · ${item.text.trim()}` : "";
        const input = { clientKey, who: who.trim() || null, what: `${what}${extra}`.slice(0, 200), channel: channel || null, due: due || null, ...(typed || initial ? { itemId: typed } : {}) };
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
        Who <WhoInput value={who} onChange={setWho} clientKey={clientKey} id={formId.current} />
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
export function Fading({ text, onGone, ms = 4000 }: { text: string | null; onGone: () => void; ms?: number }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onGone, ms);
    return () => clearTimeout(t);
  }, [text, onGone, ms]);
  return text ? <p className="co-notice fading" role="status">{text}</p> : null;
}
