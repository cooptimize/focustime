// MC-1: Admin › Clients › <client> › Meetings. The client's registered weekly calls (only these, and meetings
// FocusTime scheduled, are ever read): Register a meeting from a recurring series on my calendar or a pasted Teams join
// link, with a name, a role (Weekly status call or Planning) and its reviewers (me and the client's leads by default).
// Automatic when Cooptimize organizes it, Upload when the client does (detected from the organizer; Upload is always
// allowed, Automatic only for a Cooptimize organizer). The server checks the admin on every action.
import { useCallback, useEffect, useState } from "react";
import { ActionRefusal, call } from "../api.ts";
import { SignInAgainButton } from "../Reopen.tsx";
import type { SeriesView } from "../../plan/meeting-views.ts";

type ListData = { meetings: SeriesView[]; people: { id: string; name: string }[] };
type Candidate = { eventId: string; subject: string; organizerName: string | null; organizer: "home" | "other" | "unknown"; when: string; outside: number; match: boolean };
const errText = (e: unknown) => (e instanceof ActionRefusal || e instanceof Error ? e.message : "Something went wrong");
/** MC-1c: a refusal in plain words, kept with its code so the form can answer it (Sign in again, Try again). */
type Problem = { text: string; code: string | null };
const problemOf = (e: unknown): Problem => ({ text: errText(e), code: e instanceof ActionRefusal ? (e.code ?? null) : null });
/** Codes that come from reading my calendar (shown beside the calendar list or the link, not the Register button). */
const GRAPH_CODES = new Set(["signin", "consent", "graph_refused", "busy", "setup", "missing"]);

function ProblemLine({ p, retry }: { p: Problem; retry?: () => void }) {
  return (
    <p className="set-problem mtg-problem" role="alert">
      <span>{p.text}</span>
      {p.code === "signin" && <SignInAgainButton />}
      {p.code === "busy" && retry && <button type="button" className="mini" onClick={retry}>Try again</button>}
    </p>
  );
}
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const ROLES = [["status", "Weekly status call"], ["planning", "Planning"]] as const;

export function MeetingsField({ clientKey, clientName }: { clientKey: string; clientName: string }) {
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const load = useCallback(() => call<ListData>("meeting.list", { clientKey }).then((d) => (setData(d), setError(null)), (e: unknown) => setError(errText(e))), [clientKey]);
  useEffect(() => void load(), [load]);
  const act = async (action: string, input: Record<string, unknown>, done: string) => {
    setSaved(null);
    try {
      await call(action, input);
      setSaved(done);
      await load();
      return true;
    } catch (e) {
      setSaved(errText(e));
      return false;
    }
  };
  return (
    <div className="set-field dchat mtg-admin" role="group" aria-label={`Meetings for ${clientName}`}>
      <div className="dchat-head">
        <span className="set-label">Meetings</span>
        <span className="muted dchat-hint">{clientName}'s weekly calls. After each one, its reviewers get proposals from the transcript to confirm. FocusTime reads no other meeting.</span>
        <span className="set-mark" role="status" aria-live="polite">{saved}</span>
      </div>
      {error && <p className="set-problem">{error}</p>}
      {data && data.meetings.length === 0 && !adding && <p className="muted dchat-none">No meetings yet.</p>}
      {data?.meetings.map((m) => <SeriesCard key={m.id} m={m} people={data.people} act={act} />)}
      {adding && data ? (
        <RegisterForm clientKey={clientKey} clientName={clientName} people={data.people} onDone={async (line) => (setAdding(false), setSaved(line), await load())} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" className="mini" onClick={() => setAdding(true)} disabled={!data}>Register a meeting</button>
      )}
    </div>
  );
}

function SeriesCard({ m, people, act }: { m: SeriesView; people: ListData["people"]; act: (action: string, input: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const [add, setAdd] = useState("");
  const others = people.filter((p) => !m.reviewers.some((r) => r.id === p.id));
  const reviewers = (ids: string[]) => void act("meeting.update", { seriesId: m.id, reviewers: ids }, "Reviewers saved");
  return (
    <div className="dchat-card mtg-card">
      <div className="mtg-card-head">
        <strong>{m.name}</strong>
        <span className="muted">{m.when}</span>
      </div>
      {m.lastRead && <p className="mtg-last-read muted" aria-label="Last read">{m.lastRead}</p>}
      <div className="mtg-card-grid">
        <label>
          <span className="set-label">Role</span>
          <select value={m.role} onChange={(e) => void act("meeting.update", { seriesId: m.id, role: e.target.value }, "Role saved")}>
            {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>
          <span className="set-label">Transcript</span>
          <select value={m.source} onChange={(e) => void act("meeting.update", { seriesId: m.id, source: e.target.value }, e.target.value === "upload" ? "Reviewers upload it" : "Read after each call")}>
            <option value="automatic" disabled={m.organizer !== "home"}>Automatic (read after the call)</option>
            <option value="upload">Upload (a reviewer uploads it)</option>
          </select>
          <span className="set-hint">
            {m.organizer === "home" ? "Organized at Cooptimize, so FocusTime can read its transcript after each call." : "Organized outside Cooptimize: FocusTime reads only its time and invite, never its transcript. Reviewers upload it from the meeting's recap."}
            {m.source !== m.detected ? " Changed from what FocusTime detected." : ""}
          </span>
        </label>
      </div>
      <div className="mtg-reviewers">
        <span className="set-label">Reviewers</span>
        <span className="mtg-chips">
          {m.reviewers.map((r) => (
            <span key={r.id} className="mtg-chip">
              {r.name}
              {m.reviewers.length > 1 && <button type="button" className="chip-x" aria-label={`Remove ${r.name}`} onClick={() => reviewers(m.reviewers.filter((x) => x.id !== r.id).map((x) => x.id))}>×</button>}
            </span>
          ))}
        </span>
        <select aria-label="Add a reviewer" value={add} onChange={(e) => (setAdd(""), e.target.value && reviewers([...m.reviewers.map((x) => x.id), e.target.value]))}>
          <option value="">Add a reviewer…</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="set-hint">Reviewers confirm the proposals. Cooptimize attendees ({m.attendees}) can look, not confirm.</span>
      </div>
      <button type="button" className="mini quiet dchat-purge" onClick={() => window.confirm(`Stop reading ${m.name}? Stored transcripts go at 30 days as usual; what was confirmed stays.`) && void act("meeting.remove", { seriesId: m.id }, `Stopped reading ${m.name}`)}>
        Stop reading
      </button>
    </div>
  );
}

function RegisterForm({ clientKey, clientName, people, onDone, onCancel }: { clientKey: string; clientName: string; people: ListData["people"]; onDone: (line: string) => Promise<void>; onCancel: () => void }) {
  const [how, setHow] = useState<"calendar" | "link">("calendar");
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [candError, setCandError] = useState<Problem | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState("");
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState("10:00");
  const [minutes, setMinutes] = useState(30);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"status" | "planning">("status");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [needPattern, setNeedPattern] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (how !== "calendar" || cands) return;
    setCandError(null);
    call<{ candidates: Candidate[] }>("meeting.candidates", { clientKey }).then((r) => setCands(r.candidates), (e: unknown) => setCandError(problemOf(e)));
  }, [how, cands, clientKey, tries]);
  const picked = cands?.find((c) => c.eventId === eventId) ?? null;
  // Where a refusal shows: beside the calendar list, under the link, or by Register (anything else).
  const graphProblem = how === "calendar" && !!problem && GRAPH_CODES.has(problem.code ?? "");
  const linkProblem = how === "link" && !!problem && (GRAPH_CODES.has(problem.code ?? "") || /link|weekday/i.test(problem.text));
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const input: Record<string, unknown> = { clientKey, role, ...(name.trim() ? { name: name.trim() } : {}) };
      if (how === "calendar") input.eventId = eventId;
      else Object.assign(input, { joinUrl: joinUrl.trim(), ...(needPattern ? { weekday, start, minutes } : {}) });
      const r = await call<{ meeting: SeriesView }>("meeting.register", input);
      await onDone(`Registered ${r.meeting.name}: ${r.meeting.source === "automatic" ? "read after each call" : "reviewers upload the transcript"}`);
    } catch (e) {
      if (e instanceof ActionRefusal && e.status === 422) setNeedPattern(true);
      // The error stays until the next try; everything typed stays as it was.
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dchat-card mtg-register" role="group" aria-label={`Register a meeting for ${clientName}`}>
      <span className="st-toggle" role="group" aria-label="Where it comes from">
        <button type="button" className="ms-btn" aria-pressed={how === "calendar"} onClick={() => setHow("calendar")}>From my calendar</button>
        <button type="button" className="ms-btn" aria-pressed={how === "link"} onClick={() => setHow("link")}>Paste a Teams link</button>
      </span>
      {how === "calendar" ? (
        <div className="mtg-cands">
          {candError && <ProblemLine p={candError} retry={() => setTries((n) => n + 1)} />}
          {!cands && !candError && <p className="muted">Reading your calendar's recurring Teams meetings…</p>}
          {cands?.length === 0 && <p className="muted">No recurring Teams meetings with people from outside Cooptimize on your calendar. Paste its join link instead.</p>}
          {cands?.map((c) => (
            <label key={c.eventId} className={`mtg-cand${c.match ? " match" : ""}`}>
              <input type="radio" name={`mtg-cand-${clientKey}`} checked={eventId === c.eventId} onChange={() => setEventId(c.eventId)} />
              <span className="mtg-cand-name">{c.subject}</span>
              <span className="muted">{c.when} · {c.organizer === "home" ? `${c.organizerName ?? "Cooptimize"} organizes it at Cooptimize` : `${c.organizerName ?? "Someone outside Cooptimize"} organizes it`} · {c.outside} from outside</span>
            </label>
          ))}
          {problem && graphProblem && <ProblemLine p={problem} />}
        </div>
      ) : (
        <div className="mtg-link">
          <label>
            <span className="set-label">Teams join link</span>
            <input value={joinUrl} onChange={(e) => setJoinUrl(e.target.value)} placeholder="https://teams.microsoft.com/l/meetup-join/…" maxLength={4000} aria-invalid={!!problem && linkProblem} />
          </label>
          {problem && linkProblem && <ProblemLine p={problem} />}
          {needPattern && (
            <span className="mtg-pattern">
              <select aria-label="Weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select>
              <input aria-label="Start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              <select aria-label="Length" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>{[15, 30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select>
            </span>
          )}
        </div>
      )}
      <div className="mtg-card-grid">
        <label>
          <span className="set-label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={picked?.subject ?? `${clientName} weekly call`} maxLength={200} />
        </label>
        <label>
          <span className="set-label">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as "status" | "planning")}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      </div>
      <p className="set-hint">Reviewers: you and {clientName}'s leads, to start ({people.length} FocusTime users to choose from after). FocusTime decides Automatic or Upload from the organizer; you can change it after.</p>
      {problem && !graphProblem && !linkProblem && <ProblemLine p={problem} />}
      <span className="set-row-actions">
        <button type="button" className="mini primary" disabled={busy || (how === "calendar" ? !eventId : !joinUrl.trim())} onClick={() => void submit()}>{busy ? "Registering…" : "Register"}</button>
        <button type="button" className="mini quiet" onClick={onCancel}>Cancel</button>
      </span>
    </div>
  );
}
