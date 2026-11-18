// "Ask to collaborate" (step 13, CO-1): choose Cooptimizers ranked by tier (on this client that day, on this client,
// anyone else; PTO only as "away"), set a time in When (a day, a start and an end in my zone) and Check who is free:
// one line for me and each person (free, busy with the busy time, outside their hours, away, or couldn't read). Or let
// Find times suggest times when everyone is free; picking one fills When and checks it. The one path to the preview
// is the time in When. Nothing is sent here: the preview (every attendee named, who isn't free) goes to the write
// flow, which sends on confirm.
import { TextBox } from "./TextBox.tsx";
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import { useEffect, useRef, useState } from "react";
import type { CandidatesData, CandidateView, CheckData, SlotView, SuggestData, WritePreview } from "../actions/types.ts";
import { checkWords, zoneName } from "../plan/collab.ts";
import { DateField } from "./DatePicker.tsx";
import { TimeField } from "./TimeField.tsx";
import { COLLAB_LENGTHS, type CollabSettings } from "../config/schema.ts";
import { formatDuration } from "../week/format.ts";
import { call } from "./api.ts";
import type { HelpTarget } from "./menu.ts";
import { ItemLookup, NO_ITEM, type ItemValue } from "./ItemLookup.tsx";
import { availableFirst } from "../plan/presence.ts";
import { Avatar, usePhotos, usePresence } from "./Presence.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");
const dayShort = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const clockOf = (iso: string, tz: string) => {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
  return `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")}`;
};
const two = (n: number) => String(n).padStart(2, "0");
const hmOf = (m: number) => `${two(Math.floor(m / 60))}:${two(m % 60)}`;
const minOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
/** The time in When as ISO times with my offset. */
const isoAt = (day: string, hm: string, tz: string) => Temporal.PlainDate.from(day).toZonedDateTime({ timeZone: tz, plainTime: hm }).toString({ timeZoneName: "never" });
/** CO-1: what's wrong with the time in When, in the words the server uses; null when it can be checked. */
export function whenProblem(day: string, start: string, end: string, tz: string, now: Temporal.ZonedDateTime): string | null {
  const len = minOf(end) - minOf(start);
  if (len <= 0) return "The end is before the start. Pick a later end";
  if (len < 15 || len > 120) return "A help session is 15 minutes to 2 hours. Change the end or the length";
  if (Temporal.Instant.compare(Temporal.Instant.from(isoAt(day, start, tz)), now.toInstant()) < 0) return "That start has passed. Pick a later start";
  return null;
}
/** CO-1 defaults: today, the next half hour, my usual length (tomorrow when the next half hour is past midnight). */
export function whenDefaults(now: Temporal.ZonedDateTime, minutes: number): { day: string; start: string; end: string } {
  const next = Math.floor((now.hour * 60 + now.minute) / 30) * 30 + 30;
  const day = next >= 24 * 60 ? now.toPlainDate().add({ days: 1 }) : now.toPlainDate();
  const s = next % (24 * 60);
  return { day: day.toString(), start: hmOf(s), end: hmOf(Math.min(s + minutes, 24 * 60 - 1)) };
}
const TIER_HEAD: Record<1 | 2 | 3, (client: string) => string> = {
  1: (c) => `On ${c} in this range`,
  2: (c) => `Work on ${c}`,
  3: () => "Anyone else at Cooptimize",
};

export function HelpFinder({ target, clientName, settings, tz, now, onPreview, onClose }: { target: HelpTarget; clientName: string; settings: CollabSettings; tz: string; /** The clock in my zone (pinned by ?now= for checks). */ now: () => Temporal.ZonedDateTime; onPreview: (p: WritePreview) => void; onClose: () => void }) {
  const back = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => () => back.current?.focus?.(), []);
  useReturnFocus();
  // CO-1: When (a day, a start and an end in my zone) and its answer, cleared whenever the time or the people change.
  const [when, setWhenState] = useState(() => whenDefaults(now(), settings.meetingMinutes));
  const [answer, setAnswer] = useState<(CheckData & { key: string }) | null>(null);
  const minutes = minOf(when.end) - minOf(when.start);
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
      const s = await call<SuggestData>("collab.suggest", { clientKey: target.clientKey, from: range.from, to: range.to, minutes: Math.min(120, Math.max(15, Math.round(minutes / 15) * 15)), ...(chosen.length ? { people: chosen } : {}) });
      setSlots(s);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const keyOf = (w: typeof when, people: readonly string[]) => JSON.stringify([w.day, w.start, w.end, [...people].sort()]);
  const setWhen = (w: typeof when) => {
    setWhenState(w);
    setAnswer(null);
  };
  const problem = whenProblem(when.day, when.start, when.end, tz, now());
  const check = async (w = when, people = chosen) => {
    if (!people.length || whenProblem(w.day, w.start, w.end, tz, now())) return;
    setBusy("Checking who is free…");
    setError(null);
    const key = keyOf(w, people);
    try {
      const r = await call<CheckData>("collab.check", { clientKey: target.clientKey, start: isoAt(w.day, w.start, tz), end: isoAt(w.day, w.end, tz), people });
      setAnswer({ ...r, key });
      requestAnimationFrame(() => document.querySelector(".help-answer")?.scrollIntoView({ block: "nearest" }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const current = answer && answer.key === keyOf(when, chosen) ? answer : null;
  const words = current ? checkWords(current) : null;
  // Picking a suggestion fills When (and Who) with it and checks it at once.
  const pick = (s: SlotView) => {
    setSlot(s);
    const a = Temporal.Instant.from(s.start).toZonedDateTimeISO(tz), b = Temporal.Instant.from(s.end).toZonedDateTimeISO(tz);
    const w = { day: a.toPlainDate().toString(), start: hmOf(a.hour * 60 + a.minute), end: hmOf(b.hour * 60 + b.minute) };
    const people = s.people.map((p) => p.email);
    setWhen(w);
    setChosen(people);
    void check(w, people);
  };
  const preview = async () => {
    if (!current) return;
    setBusy("Preparing the preview…");
    setError(null);
    try {
      const r = await call<{ preview: WritePreview }>("collab.preview_invite", {
        clientKey: target.clientKey, title: subject.title, start: isoAt(when.day, when.start, tz), end: isoAt(when.day, when.end, tz), people: chosen, teams,
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
    setAnswer(null);
  };
  const today = now().toPlainDate().toString();
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
          <CloseButton onClose={onClose} />
        </div>

        <div className="help-row">
          <span className="help-label">About</span>
          <ItemLookup clientKey={target.clientKey} value={about} onChange={setAbout} label="What the help is about" />
        </div>
        <fieldset className="help-people">
          <legend>
            Who <span className="muted">{chosen.length ? `${chosen.length} chosen` : "choose who to ask"}</span>
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

        <fieldset className="help-when">
          <legend>
            When <span className="muted">times in {zoneName(tz)}</span>
          </legend>
          <div className="help-row">
            <DateField value={when.day} onChange={(d) => d && setWhen({ ...when, day: d })} label="Day" today={today} clearable={false} />
            <TimeField value={when.start} onChange={(t) => t && setWhen({ ...when, start: t, end: hmOf(Math.min(minOf(t) + Math.max(minutes, 15), 24 * 60 - 1)) })} label="Start" />
            <span>to</span>
            <TimeField value={when.end} onChange={(t) => t && setWhen({ ...when, end: t })} label="End" />
          </div>
          <div className="chips" role="radiogroup" aria-label="Length">
            {COLLAB_LENGTHS.map((m) => (
              <button key={m} type="button" className="chip-btn" role="radio" aria-checked={minutes === m} onClick={() => setWhen({ ...when, end: hmOf(Math.min(minOf(when.start) + m, 24 * 60 - 1)) })}>
                {formatDuration(m)}
              </button>
            ))}
          </div>
          <div className="help-row">
            <button type="button" className="help-check" disabled={!!busy || !!problem || !chosen.length} onClick={() => void check()}>
              Check who is free
            </button>
            {problem ? <span className="help-warn">{problem}</span> : !chosen.length ? <span className="muted">Choose who to ask first</span> : null}
          </div>
          {words && current && (
            <div className="help-answer" role="status" aria-label="Who is free">
              <strong>{words.summary}</strong>
              <ul>
                <li className={current.me.state === "free" ? "free" : "not-free"}>{words.me}</li>
                {words.people.map((p) => (
                  <li key={p.email} className={p.free ? "free" : "not-free"}>{p.text}</li>
                ))}
              </ul>
              {current.problems.map((p) => (
                <p key={p} className="muted help-problem">{p}</p>
              ))}
            </div>
          )}
        </fieldset>

        <details className="help-find" open={!!slots}>
          <summary>Or let FocusTime find a time</summary>
          <div className="help-row">
            <span className="help-label">Between</span>
            {range && (
              <>
                <DateField value={range.from} onChange={(d) => d && setRange({ ...range, from: d, to: d > range.to ? d : range.to })} label="From" today={today} clearable={false} />
                <span>and</span>
                <DateField value={range.to} onChange={(d) => d && setRange({ ...range, to: d < range.from ? range.from : d })} label="To" today={today} clearable={false} />
                <button type="button" className="mini" disabled={!!busy} onClick={() => void loadCandidates(range)}>Update people</button>
              </>
            )}
          </div>
          <div className="help-row">
            <button type="button" className="help-check" disabled={!!busy || !range} onClick={() => void find()}>
              Find times
            </button>
            <span className="muted">{formatDuration(Math.min(120, Math.max(15, Math.round(minutes / 15) * 15)))}, the length in When</span>
          </div>
          {slots && (
            <div className="help-slots">
              <p className="muted help-problem">Times when everyone is free inside their own working hours and yours. Free/busy only, no event details. Pick one to put it in When.</p>
              {!slots.slots.length && <p>No time works for everyone in that range. Try other days, a shorter length, or other people.</p>}
              <ul>
                {slots.slots.map((s) => (
                  <li key={s.start + s.people.map((p) => p.email).join()}>
                    <label>
                      <input type="radio" name="help-slot" checked={slot === s} onChange={() => pick(s)} />{" "}
                      <strong>
                        {dayShort(s.date)}, {clockOf(s.start, tz)}–{clockOf(s.end, tz)}
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
            </div>
          )}
        </details>

        {current && (
          <div className="help-invite">
            <label className="help-note">
              Note <span className="muted">optional, goes in the invite</span>
              <TextBox minRows={2} maxRows={6} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where you're stuck, what to look at" />
            </label>
            <label>
              <input type="checkbox" checked={teams} onChange={(e) => setTeams(e.target.checked)} /> Teams meeting
            </label>
          </div>
        )}

        {error && <p className="set-problem" role="alert">{error}</p>}
        <div className="wd-actions help-foot">
          <button type="button" className="commit" disabled={!current || !!busy} onClick={() => void preview()}>
            Preview invite
          </button>
          <button type="button" className="mini quiet" onClick={onClose}>
            Cancel
          </button>
          {busy ? <span className="muted" role="status">{busy}</span> : <span className="muted">{current ? "Nothing is sent until you confirm the preview." : "Check who is free first. Nothing is sent until you confirm the preview."}</span>}
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
