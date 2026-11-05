// "Ask to collaborate" (step 13): pick a length and a range, see Cooptimizers ranked by tier (on this client that day,
// on this client, anyone else; PTO only as "away"), choose people or let FocusTime choose the top tier, get up to five
// times when everyone is free inside their own working hours, then preview the invite. Nothing is sent here: the
// preview (every attendee named, "they will receive an invite") goes to the write flow, which sends on confirm.
import { useEffect, useRef, useState } from "react";
import type { CandidatesData, CandidateView, SlotView, SuggestData, WritePreview } from "../actions/types.ts";
import { COLLAB_LENGTHS, type CollabSettings } from "../config/schema.ts";
import { formatDuration } from "../week/format.ts";
import { call } from "./api.ts";
import type { HelpTarget } from "./menu.ts";
import { ItemLookup, NO_ITEM, type ItemValue } from "./ItemLookup.tsx";
import { availableFirst } from "../plan/presence.ts";
import { Avatar, usePhotos, usePresence } from "./Presence.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const dayShort = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const clock = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
const TIER_HEAD: Record<1 | 2 | 3, (client: string) => string> = {
  1: (c) => `On ${c} in this range`,
  2: (c) => `Work on ${c}`,
  3: () => "Anyone else at Cooptimize",
};

export function HelpFinder({ target, clientName, settings, tz, onPreview, onClose }: { target: HelpTarget; clientName: string; settings: CollabSettings; tz: string; onPreview: (p: WritePreview) => void; onClose: () => void }) {
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => () => back.current?.focus?.(), []);
  const [minutes, setMinutes] = useState(settings.meetingMinutes);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [cands, setCands] = useState<CandidatesData | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [slots, setSlots] = useState<SuggestData | null>(null);
  const [slot, setSlot] = useState<SlotView | null>(null);
  const [note, setNote] = useState("");
  const [teams, setTeams] = useState(settings.teams);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Step 15.2: what the help is about, through the shared lookup (starts on the target's item, when it has one).
  const [about, setAbout] = useState<ItemValue>(() => (target.itemId ? { itemId: target.itemId, title: target.title.replace(/^#\d+\s+/, ""), url: target.url, text: "" } : { ...NO_ITEM }));
  const subject =
    about.itemId !== null && about.itemId !== target.itemId ? { title: `#${about.itemId} ${about.title ?? ""}`.trim(), url: about.url, itemId: about.itemId }
    : about.itemId === null && target.itemId !== null && !about.text.trim() ? { title: target.title.replace(/^#\d+\s+/, ""), url: null, itemId: null }
    : about.itemId === null && about.text.trim() ? { title: about.text.trim(), url: null, itemId: null }
    : { title: target.title, url: target.url, itemId: target.itemId };

  const loadCandidates = async (r?: { from: string; to: string }) => {
    setBusy("Reading who works on it…");
    setError(null);
    try {
      const c = await call<CandidatesData>("collab.candidates", { clientKey: target.clientKey, ...(r ?? (target.pinned ? { pinned: target.pinned } : {})) });
      setCands(c);
      setRange({ from: c.from, to: c.to });
      setChosen((x) => x.filter((e) => c.candidates.some((k) => k.email === e)));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => void loadCandidates(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const find = async () => {
    if (!range) return;
    setBusy("Checking free/busy…");
    setError(null);
    setSlot(null);
    try {
      const s = await call<SuggestData>("collab.suggest", { clientKey: target.clientKey, from: range.from, to: range.to, minutes, ...(chosen.length ? { people: chosen } : {}) });
      setSlots(s);
      setSlot(s.slots[0] ?? null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const preview = async () => {
    if (!slot) return;
    setBusy("Preparing the preview…");
    setError(null);
    try {
      const r = await call<{ preview: WritePreview }>("collab.preview_invite", {
        clientKey: target.clientKey, title: subject.title, start: slot.start, end: slot.end, people: slot.people.map((p) => p.email), teams,
        ...(subject.url ? { url: subject.url } : {}), ...(subject.itemId ? { itemId: subject.itemId } : {}), ...(target.pickId ? { pickId: target.pickId } : {}), ...(target.timeboxId ? { timeboxId: target.timeboxId } : {}), ...(note.trim() ? { note: note.trim() } : {}),
      });
      onClose();
      onPreview(r.preview);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const toggle = (email: string) => {
    setChosen((x) => (x.includes(email) ? x.filter((e) => e !== email) : x.length >= 8 ? x : [...x, email]));
    setSlots(null);
    setSlot(null);
  };
  // Step 16.3: presence for everyone listed (one read, every 2 minutes while open); Available now first in each tier.
  const presence = usePresence({ emails: (cands?.candidates ?? []).map((c) => c.email) });
  const photos = usePhotos({ emails: (cands?.candidates ?? []).map((c) => c.email) });
  const byTier = ([1, 2, 3] as const).map((t) => ({ t, list: availableFirst((cands?.candidates ?? []).filter((c) => c.tier === t), (c) => presence.wordFor(c)) })).filter((g) => g.list.length);

  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="cap-dialog help-dialog"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Ask to collaborate ${target.title}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="cap-dialog-head">
          <h2>Ask to collaborate</h2>
          <span className="muted">
            {clientName}: {subject.title}
          </span>
        </div>

        <div className="help-row">
          <span className="help-label">About</span>
          <ItemLookup clientKey={target.clientKey} value={about} onChange={setAbout} label="What the help is about" />
        </div>
        <div className="help-row">
          <span className="help-label">Length</span>
          <div className="chips" role="radiogroup" aria-label="Length">
            {COLLAB_LENGTHS.map((m) => (
              <button key={m} type="button" className="chip-btn" role="radio" aria-checked={minutes === m} onClick={() => { setMinutes(m); setSlots(null); setSlot(null); }}>
                {formatDuration(m)}
              </button>
            ))}
          </div>
        </div>
        <div className="help-row">
          <span className="help-label">Between</span>
          {range && (
            <>
              <input type="date" aria-label="From" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value, to: e.target.value > range.to ? e.target.value : range.to })} />
              <span>and</span>
              <input type="date" aria-label="To" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              <button type="button" className="mini" disabled={!!busy} onClick={() => void loadCandidates(range)}>Update people</button>
            </>
          )}
        </div>

        <fieldset className="help-people">
          <legend>
            Who <span className="muted">{chosen.length ? `${chosen.length} chosen; all of them must be free` : "none chosen: FocusTime picks the best-placed person free at each time"}</span>
          </legend>
          {byTier.map(({ t, list }) => (
            <div key={t} className="help-tier">
              <h3>{TIER_HEAD[t](clientName)}</h3>
              <ul>
                {list.map((c) => (
                  <li key={c.email}>
                    <label>
                      <input type="checkbox" checked={chosen.includes(c.email)} onChange={() => toggle(c.email)} /> <Avatar name={c.name} photo={photos.photoFor(c.email)} word={presence.wordFor(c)} />{c.name}{" "}
                      <span className="muted">{who(c, clientName)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {cands && !cands.candidates.length && <p className="muted">No Cooptimize teammates found.</p>}
        </fieldset>
        {cands?.problems.map((p) => (
          <p key={p} className="muted help-problem">{p}</p>
        ))}

        <div className="wd-actions">
          <button type="button" className="commit" disabled={!!busy || !range} onClick={() => void find()}>
            Find times
          </button>
          {busy && <span className="muted" role="status">{busy}</span>}
        </div>

        {slots && (
          <fieldset className="help-slots">
            <legend>
              Times <span className="muted">everyone free inside their own working hours and yours; free/busy only, no event details</span>
            </legend>
            {!slots.slots.length && <p>No time works for everyone in that range. Try other days, a shorter length, or other people.</p>}
            <ul>
              {slots.slots.map((s) => (
                <li key={s.start + s.people.map((p) => p.email).join()}>
                  <label>
                    <input type="radio" name="help-slot" checked={slot === s} onChange={() => setSlot(s)} />{" "}
                    <strong>
                      {dayShort(s.date)}, {clock(s.start, tz)} to {clock(s.end, tz)}
                    </strong>{" "}
                    with{" "}
                    {s.people.map((p, i) => (
                      <span key={p.email}>
                        {i > 0 && ", "}
                        <Avatar name={p.name} photo={photos.photoFor(p.email)} word={presence.wordFor(p)} size={20} />
                        {p.hoursUnknown ? `${p.name} (hours unknown)` : p.name}
                      </span>
                    ))}{" "}
                    <span className="muted">{tierWord(s.tier, clientName)}</span>
                    {s.inFocus && <span className="muted"> · in your {clientName} focus block</span>}
                    {s.alsoFree.length > 0 && <span className="muted"> · also free: {s.alsoFree.join(", ")}</span>}
                    {s.overTimebox > 0 && <span className="help-warn"> · over your timebox by {formatDuration(s.overTimebox)}</span>}
                  </label>
                </li>
              ))}
            </ul>
            {slots.problems.map((p) => (
              <p key={p} className="muted help-problem">{p}</p>
            ))}
          </fieldset>
        )}

        {slot && (
          <div className="help-invite">
            <label className="help-note">
              Note <span className="muted">optional, goes in the invite</span>
              <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where you're stuck, what to look at" />
            </label>
            <label>
              <input type="checkbox" checked={teams} onChange={(e) => setTeams(e.target.checked)} /> Teams meeting
            </label>
          </div>
        )}

        {error && <p className="set-problem" role="alert">{error}</p>}
        <div className="wd-actions">
          <button type="button" className="commit" disabled={!slot || !!busy} onClick={() => void preview()}>
            Preview invite
          </button>
          <button type="button" className="mini quiet" onClick={onClose}>
            Cancel
          </button>
          <span className="muted">Nothing is sent until you confirm the preview.</span>
        </div>
      </div>
    </div>
  );
}

function who(c: CandidateView, client: string): string {
  const parts: string[] = [];
  if (c.onClient.length) parts.push(`on ${client} ${c.onClient.map((d) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short" })).join(", ")}`);
  if (c.away.length) parts.push(`away ${c.away.map((d) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short" })).join(", ")}`);
  return parts.join(" · ");
}
const tierWord = (t: 1 | 2 | 3, client: string) => (t === 1 ? `(on ${client} that day)` : t === 2 ? `(works on ${client})` : "(Cooptimize)");
