// Settings (step 6b): every setting FocusTime owns, read from and written to the same validated config file. Values
// owned by Dataverse are shown read-only with where to change them. Secrets are entered in masked fields that go
// straight to the keyring; they are never shown again (only whether they are set, and an expiry date if entered).
import { AzureWriteLog, TeamsAccessLine, TeamsStatusLog, YouAccount } from "./Account.tsx";
import { responseLabel } from "../plan/rsvp.ts";
import { DevOpsWriteLog } from "./DevOpsWrite.tsx";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { FieldProblem, SettingsClient, SettingsData, SourceSummary } from "../actions/types.ts";
import { COLLAB_LENGTHS, TEXT_SIZES, THEME_NAMES, THEMES, type TextSize, type Theme } from "../config/schema.ts";
import { TEXT_SIZE_NAMES } from "./textsize.ts";
import type { ClientWork } from "../week/types.ts";
import type { FollowState } from "../week/follow.ts";
import { spanText, VIEW_RANGE_NAMES, VIEW_RANGES, WEEKDAY_KEYS, type ViewRange } from "../week/hours.ts";
import { ActionRefusal, call } from "./api.ts";
import { notConnected, SOURCE_NAMES, sourceActions, stateOf, type Calendar } from "./status.ts";
import { shortDate } from "./labels.ts";
import { BINAURAL, MAX_PLAYLISTS, playlistLink, SOUND_NAMES, SOUNDS, type Playlist, type SoundKind } from "../plan/focussound.ts";
import { sound } from "./sound.ts";
import { KIND_HINT, KIND_LABEL, RITUAL_KINDS, type NotifyKind, type QuietMode } from "../plan/notify.ts";
import { nextRituals } from "../plan/rituals.ts";
import { useTimeboxes } from "./Timeboxes.tsx";
import type { WriteLogView } from "../actions/types.ts";
import type { WriteEntry } from "../plan/timebox.ts";
import { version as APP_VERSION } from "../package.json";
import { InlineMoment } from "./brand/Opening.tsx";
import { Lockup } from "./brand/Brand.tsx";
import { NEUTRAL_ZONE, userZone } from "../week/zone.ts";

export const SETTINGS_SECTIONS = [
  ["you", "You"],
  ["hours", "Working hours"],
  ["standing", "Standing blocks"],
  ["planning", "Planning"],
  ["focus", "Focus"],
  ["notifications", "Notifications"],
  ["roadmap", "Roadmap"],
  ["risk", "Risk rules"],
  ["clients", "Clients"],
  ["connections", "Connections"],
  ["display", "Display"],
  ["data", "Data"],
  ["about", "About"],
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number][0];

type Props = {
  section: SettingsSectionId;
  onSection: (s: SettingsSectionId) => void;
  onClose: () => void;
  /** Called after any save, so the week reloads with the new settings. */
  onSaved: () => void;
  sources: SourceSummary[];
  /** DevOps per client from the week (step 6c): a client's own PAT or project problem shows here too. */
  devops: ClientWork[] | null;
  busy: Calendar | null;
  loading: boolean;
  onRefresh: () => void;
  onConnect: (c: Calendar) => void;
  onDisconnect: (c: Calendar) => void;
  /** Step 17.5: a calendar that just reconnected here (the fun moment). */
  reconnected?: Calendar | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  viewRange: ViewRange;
  setViewRange: (r: ViewRange) => void;
  /** Step 17.5: no opening and closing animation, no moving Lumen. */
  reduceMotion: boolean;
  setReduceMotion: (on: boolean) => void;
  /** U5 (D401): Default, Large or Larger. */
  textSize: TextSize;
  setTextSize: (s: TextSize) => void;
  /** U5.1 (D408): personal events shown on Week and Today. */
  showPersonal: boolean;
  setShowPersonal: (show: boolean) => void;
  /** Step 15 (D272): demo mode and its switch. */
  demo: boolean;
  setDemo: (on: boolean) => void;
  /** Clears an override (hours.clear_day) and reloads. */
  runTime: (action: string, input: Record<string, unknown>) => Promise<boolean>;
};

const DEVOPS_STATE: Record<ClientWork["status"], string> = { ok: "Live", identity_missing: "No identity", not_set_up: "Not set up", auth_failed: "PAT problem", no_access: "No access", unreachable: "Unreachable", error: "Error" };

const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } as const;
/** Zones the browser knows, for the time zone field (A1: each person sets their own). */
const ZONES: readonly string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();

/** Problems for one field (and its sub-fields, e.g. hours.mon[0] under hours.mon). */
const problemsFor = (all: FieldProblem[], field: string) => all.filter((p) => p.field === field || p.field.startsWith(`${field}[`) || p.field.startsWith(`${field}.`));

function Problems({ all, field }: { all: FieldProblem[]; field: string }) {
  const mine = problemsFor(all, field);
  if (!mine.length) return null;
  return (
    <span className="field-problem" role="alert">
      {mine.map((p) => p.message).join("; ")}
    </span>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="set-field">
      <span className="set-label">{label}</span>
      {children}
      {hint && <span className="set-hint">{hint}</span>}
    </label>
  );
}

function ReadOnly({ label, value, where }: { label: string; value: ReactNode; where: string }) {
  return (
    <div className="set-field readonly">
      <span className="set-label">{label}</span>
      <span className="set-value">{value || <span className="muted">not set</span>}</span>
      <span className="set-hint">{where}</span>
    </div>
  );
}

/** One save: the section's values, field problems back on refusal. */
function useSave(onSaved: (d: SettingsData) => void) {
  const [problems, setProblems] = useState<FieldProblem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const save = useCallback(
    async (section: string, values: unknown) => {
      setStatus("Saving…");
      try {
        const r = await call<{ settings: SettingsData; backup: string }>("settings.save", { section, values });
        setProblems([]);
        setStatus(`Saved. Backup: ${r.backup}`);
        onSaved(r.settings);
        return true;
      } catch (e) {
        setProblems(e instanceof ActionRefusal ? e.fields : []);
        setStatus(e instanceof ActionRefusal && e.fields.length ? "Not saved: fix the fields marked in red" : `Not saved: ${e instanceof Error ? e.message : "unknown error"}`);
        return false;
      }
    },
    [onSaved],
  );
  return { problems, status, save };
}

export function Settings(props: Props) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const reload = useCallback(async () => {
    try {
      setData(await call<SettingsData>("settings.load", {}));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settings could not load");
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => headRef.current?.focus(), [props.section]);
  const saved = useCallback(
    (d: SettingsData) => {
      setData(d);
      props.onSaved();
    },
    [props.onSaved], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const title = SETTINGS_SECTIONS.find(([id]) => id === props.section)![1];
  return (
    <main className="settings" aria-label="Settings">
      <nav className="set-nav" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map(([id, label]) => (
          <button key={id} type="button" className="set-tab" aria-current={props.section === id ? "page" : undefined} onClick={() => props.onSection(id)}>
            {label}
          </button>
        ))}
        <button type="button" className="set-tab close" onClick={props.onClose} title="Back (Esc)">
          Back
        </button>
      </nav>
      <section className="set-body">
        <h2 ref={headRef} tabIndex={-1}>
          {title}
        </h2>
        {data && props.section !== "about" && <p className="muted set-path">Saved to {data.configPath}</p>}
        {error && <p className="field-problem">{error}</p>}
        {data && data.problems.length > 0 && props.section !== "connections" && props.section !== "data" && (
          <div className="config-banner" role="alert">
            <strong>The config file has problems, so only Connections and Data work here until it is fixed by hand.</strong>
            <ul>
              {data.problems.map((p) => (
                <li key={p.field}>
                  <code>{p.field}</code> {p.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {data && <SectionBody {...props} data={data} onSavedData={saved} reload={reload} />}
      </section>
    </main>
  );
}

function SectionBody(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void; reload: () => Promise<void> }) {
  const d = p.data;
  switch (p.section) {
    case "you":
      return (
        <>
        <YouAccount />
        <VmStartForm {...p} />
        {d.you && (
        <div className="set-grid">
          <ReadOnly label="Email when signed out" value={d.you.email} where="Used only when signed out ([dataverse] my_email in config.toml)" />
          <ReadOnly label="Dataverse user" value={d.you.systemUserId ? "Found" : "Not found yet"} where="Change this in Dataverse" />
          <ReadOnly label="Environment" value={d.you.environmentUrl} where="Set in config.toml ([dataverse] environment_url)" />
          <ReadOnly label="Time zone" value={userZone(d.you)} where="Change it under Working hours" />
        </div>
        )}
        </>
      );
    case "hours":
      return d.hours ? <HoursForm {...p} /> : null;
    case "standing":
      return <StandingForm {...p} />;
    case "planning":
      return (
        <>
          <PlanningForm {...p} />
          <TimeboxForm {...p} />
          <CollabForm {...p} />
        </>
      );
    case "focus":
      return <FocusForm {...p} />;
    case "notifications":
      return <NotifyForm {...p} />;
    case "roadmap":
      return <RoadmapForm {...p} />;
    case "risk":
      return d.risk ? <RiskForm {...p} /> : null;
    case "clients":
      return (
        <div className="set-clients">
          {d.dataverseProblem && (
            <p className="set-problem" role="status">
              {d.dataverseProblem}{" "}
              <button type="button" className="link-btn" onClick={() => void p.reload()}>Refresh</button>
            </p>
          )}
          {d.clients.length === 0 && !d.dataverseProblem && <p className="muted">No clients yet. Your followed clients come from Dataverse (your Account Worker records and focus time).</p>}
          {followedFirst(d.clients).followed.map((c) => (
            <ClientCard key={c.key} c={c} d={d} p={p} />
          ))}
          {followedFirst(d.clients).other.length > 0 && (
            <details className="set-client-more">
              <summary>Not followed · {followedFirst(d.clients).other.length}</summary>
              {followedFirst(d.clients).other.map((c) => (
                <ClientCard key={c.key} c={c} d={d} p={p} />
              ))}
            </details>
          )}
        </div>
      );
    case "connections":
      return <Connections {...p} />;
    case "display":
      return (
        <div className="set-grid">
          <fieldset className="set-choice">
            <legend>Theme</legend>
            {THEMES.map((t) => (
              <label key={t}>
                <input type="radio" name="theme" checked={p.theme === t} onChange={() => p.setTheme(t)} /> {THEME_NAMES[t]}
              </label>
            ))}
            <span className="set-hint">Applies at once.</span>
          </fieldset>
          <fieldset className="set-choice">
            <legend>Text size</legend>
            {TEXT_SIZES.map((s) => (
              <label key={s}>
                <input type="radio" name="text-size" checked={p.textSize === s} onChange={() => p.setTextSize(s)} /> {TEXT_SIZE_NAMES[s]}
              </label>
            ))}
            <span className="set-hint">Ctrl + and Ctrl − change it; Ctrl 0 resets.</span>
          </fieldset>
          <fieldset className="set-choice">
            <legend>Timelines</legend>
            {VIEW_RANGES.map((r) => (
              <label key={r}>
                <input type="radio" name="range" checked={p.viewRange === r} onChange={() => p.setViewRange(r)} /> {VIEW_RANGE_NAMES[r]}
              </label>
            ))}
            <span className="set-hint">The default. V on Week changes it until you close FocusTime.</span>
          </fieldset>
          <fieldset className="set-choice">
            <legend>Personal events</legend>
            <label>
              <input type="checkbox" checked={p.showPersonal} onChange={(e) => p.setShowPersonal(e.target.checked)} /> Show personal events on Week and Today
            </label>
            <span className="set-hint">Hidden ones still count in risk and free time. G switches it.</span>
          </fieldset>
          <fieldset className="set-choice">
            <legend>Motion</legend>
            <label>
              <input type="checkbox" checked={p.reduceMotion} onChange={(e) => p.setReduceMotion(e.target.checked)} /> Reduce motion
            </label>
            <span className="set-hint">No opening or Close out animation; Lumen stays still.</span>
          </fieldset>
          <fieldset className="set-choice">
            <legend>Demo mode</legend>
            <label>
              <input type="checkbox" checked={p.demo} onChange={(e) => p.setDemo(e.target.checked)} /> Show demo data
            </label>
            <span className="set-hint">Fictional data; your own plan isn't touched.</span>
          </fieldset>
          <div className="set-field">
            <span className="set-label">Style guide</span>
            <a href="/styleguide" target="_blank" rel="noopener">
              Open the style guide
            </a>
            <span className="set-hint">Tokens and components in each theme.</span>
          </div>
        </div>
      );
    case "data":
      return <DataSection {...p} />;
    case "about":
      // Step 17.5: the lockup, the version and the credit line.
      return (
        <div className="brand-about">
          <Lockup width={320} />
          <p>Version {APP_VERSION}</p>
          <p className="set-hint">FocusTime is made by Cooptimize, for planning a week of client work.</p>
        </div>
      );
  }
}

/** "09:00-17:00, 20:00-22:00" ⇄ spans. */
const spansIn = (s: string) => s.split(/[,;]/).map((x) => x.replace(/\s+/g, "")).filter(Boolean);

function HoursForm(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void; reload: () => Promise<void> }) {
  const h = p.data.hours!;
  const [tz, setTz] = useState(userZone(h));
  const [lunch, setLunch] = useState(h.lunch ? spanText(h.lunch) : "");
  const [days, setDays] = useState(() => Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, h.weekdays[k].map(spanText).join(", ")])) as Record<string, string>);
  const { problems, status, save } = useSave(p.onSavedData);
  return (
    <form
      className="set-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save("hours", { timeZone: tz, lunch: lunch.replace(/\s+/g, ""), weekdays: Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, spansIn(days[k] ?? "")])) });
      }}
    >
      <p className="muted">Like 09:00-17:00; a second span is an evening. Empty is a day off.</p>
      <div className="set-days">
        {WEEKDAY_KEYS.map((k) => (
          <Field key={k} label={DAY_NAMES[k]}>
            <input value={days[k]} placeholder="day off" onChange={(e) => setDays({ ...days, [k]: e.target.value })} aria-invalid={problemsFor(problems, `hours.${k}`).length > 0} />
            <Problems all={problems} field={`hours.${k}`} />
          </Field>
        ))}
      </div>
      <div className="set-grid">
        <Field label="Lunch" hint="Like 12:00-12:30. Empty splits the day in the middle.">
          <input value={lunch} placeholder="none" onChange={(e) => setLunch(e.target.value)} />
          <Problems all={problems} field="hours.lunch" />
        </Field>
        <Field label="Time zone" hint="Where you work, as a Region/City name from the list.">
          <input value={tz} list="set-zones" onChange={(e) => setTz(e.target.value)} />
          <datalist id="set-zones">
            {ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <Problems all={problems} field="hours.time_zone" />
        </Field>
      </div>
      <SaveRow status={status} />
      <h3>One-day changes</h3>
      {h.overrides.length === 0 ? (
        <p className="muted">None. Set a day's own hours from its ⋯ menu in the week.</p>
      ) : (
        <ul className="set-list">
          {h.overrides.map((o) => (
            <li key={o.date}>
              <strong>{shortDate(o.date)}</strong>
              <span>{o.segments ? (o.segments.length ? o.segments.map(spanText).join(" + ") : "no working hours") : "usual hours"}</span>
              {o.lunch !== undefined && <span className="muted">lunch {o.lunch ? spanText(o.lunch) : "none"}</span>}
              <button type="button" className="mini quiet" onClick={() => void p.runTime("hours.clear_day", { date: o.date }).then(() => p.reload())}>
                Use usual hours
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function SaveRow({ status, label = "Save" }: { status: string | null; label?: string }) {
  return (
    <div className="set-save">
      <button type="submit" className="mini primary">
        {label}
      </button>
      {status && (
        <span className="muted" role="status">
          {status}
        </span>
      )}
    </div>
  );
}

function StandingForm(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const [rows, setRows] = useState(p.data.standingBlocks.map((b) => ({ day: b.day as string, half: b.half as string, client: b.clientKey })));
  const { problems, status, save } = useSave(p.onSavedData);
  const keys = p.data.clients.map((c) => c.key);
  return (
    <form
      className="set-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save("standing", { blocks: rows });
      }}
    >
      <p className="muted">Shown when Dataverse has no focus block there.</p>
      {rows.map((r, i) => (
        <div key={i} className="set-row">
          <select value={r.day} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))} aria-label="Day">
            {["Mon", "Tue", "Wed", "Thu"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select value={r.half} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, half: e.target.value } : x)))} aria-label="Half">
            <option>AM</option>
            <option>PM</option>
          </select>
          <select value={r.client} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, client: e.target.value } : x)))} aria-label="Client">
            {[...new Set([r.client, ...keys])].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button type="button" className="mini quiet" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            Remove
          </button>
          <Problems all={problems} field={`standing_blocks[${i}]`} />
        </div>
      ))}
      <button type="button" className="mini" onClick={() => setRows([...rows, { day: "Mon", half: "AM", client: keys[0] ?? "Internal" }])}>
        Add a standing block
      </button>
      <SaveRow status={status} />
    </form>
  );
}

function PlanningForm(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const pl = p.data.planning;
  const [types, setTypes] = useState(pl.pickablePortfolioTypes.join(", "));
  const [v, setV] = useState({ minS: pl.minSizes.S, minM: pl.minSizes.M, minL: pl.minSizes.L, carryDays: pl.carryDays, reminderOffsetMinutes: pl.reminderOffsetMinutes, focusMinutes: pl.focusMinutes, breakMinutes: pl.breakMinutes, endSound: pl.endSound, followGraceDays: pl.followGraceDays, closeoutReminderMinutes: pl.closeoutReminderMinutes, checkinReminderMinutes: pl.checkinReminderMinutes });
  const [nudges, setNudges] = useState({ weekNudgeThu: pl.weekNudgeThu, weekNudgeFri: pl.weekNudgeFri, weekNudgeMon: pl.weekNudgeMon });
  const { problems, status, save } = useSave(p.onSavedData);
  const num = (k: Exclude<keyof typeof v, "endSound">, label: string, field: string, hint: string, step = 5, max = 480) => (
    <Field label={label} hint={hint}>
      <input type="number" min={0} max={max} step={step} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
      <Problems all={problems} field={field} />
    </Field>
  );
  return (
    <form
      className="set-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save("planning", {
          pickablePortfolioTypes: types.split(",").map((x) => x.trim()).filter(Boolean),
          minSizes: { S: v.minS, M: v.minM, L: v.minL },
          carryDays: v.carryDays,
          reminderOffsetMinutes: v.reminderOffsetMinutes,
          focusMinutes: v.focusMinutes,
          breakMinutes: v.breakMinutes,
          endSound: v.endSound,
          followGraceDays: v.followGraceDays,
          closeoutReminderMinutes: v.closeoutReminderMinutes,
          checkinReminderMinutes: v.checkinReminderMinutes,
          ...nudges,
        });
      }}
    >
      <h3>Picks</h3>
      <div className="set-grid">
        {num("minS", "Shortest useful time, S (minutes)", "plan.min_s", "The least Timebox my day gives an S pick (S is 1h, M 2h, L 4h).")}
        {num("minM", "Shortest useful time, M (minutes)", "plan.min_m", "The same for M.")}
        {num("minL", "Shortest useful time, L (minutes)", "plan.min_l", "The same for L.")}
        <Field label="Portfolio types that can be picked" hint='Types above story level you pick directly, like "Recurring".'>
          <input value={types} onChange={(e) => setTypes(e.target.value)} />
          <Problems all={problems} field="plan.pickable_portfolio_types" />
        </Field>
        {num("carryDays", "Carry-over (days back)", "plan.carry_days", "Unfinished picks offered again. 0 turns it off.", 1, 30)}
        {num("reminderOffsetMinutes", "Reminder (minutes after the day starts)", "plan.reminder_offset_minutes", "Only when today isn't committed.", 5, 240)}
      </div>
      <h3>Check-in and Close out</h3>
      <div className="set-grid">
        {num("checkinReminderMinutes", "Check-in reminder (minutes after lunch)", "plan.checkin_reminder_minutes", "On a committed day. 0 is the end of lunch.", 5, 120)}
        {num("closeoutReminderMinutes", "Close out reminder (minutes before the day ends)", "plan.closeout_reminder_minutes", "Only if Close out isn't done.", 5, 120)}
      </div>
      <h3>Plan the week</h3>
      <div className="set-grid">
        {([
          ["weekNudgeThu", "week_nudge_thu", "Thursday nudge", "For next week. Empty turns it off."],
          ["weekNudgeFri", "week_nudge_fri", "Friday nudge", "For next week, if still not committed."],
          ["weekNudgeMon", "week_nudge_mon", "Monday nudge", "For this week, if still not committed."],
        ] as const).map(([k, toml, label, hint]) => (
          <Field key={k} label={label} hint={hint}>
            <input type="time" value={nudges[k]} onChange={(e) => setNudges({ ...nudges, [k]: e.target.value })} />
            <Problems all={problems} field={`plan.${toml}`} />
          </Field>
        ))}
      </div>
      <h3>Clients followed</h3>
      <div className="set-grid">
        {num("followGraceDays", "Keep following after focus time ends (days)", "plan.follow_grace_days", "Clients stay followed this long after focus time ends.", 1, 90)}
      </div>
      <h3>Plan ahead rituals</h3>
      <AheadRituals />
      <h3>Focus timer</h3>
      <div className="set-grid">
        {num("focusMinutes", "Focus length (minutes)", "plan.focus_minutes", "The default for a plain timer. A pick suggests its size instead.", 5, 240)}
        {num("breakMinutes", "Break length (minutes)", "plan.break_minutes", "Offered when a session ends. 0 for none.", 5, 60)}
        <Field label="End sound" hint="With the notification when a session ends.">
          <label className="set-check">
            <input type="checkbox" checked={v.endSound} onChange={(e) => setV({ ...v, endSound: e.target.checked })} /> Play a sound
          </label>
          <Problems all={problems} field="plan.end_sound" />
        </Field>
      </div>
      <SaveRow status={status} />
    </form>
  );
}

/** Step 17: when the Plan ahead rituals come next. Their switches are in Settings > Notifications. */
function AheadRituals() {
  const today = Temporal.Now.plainDateISO().toString();
  const n = nextRituals(today);
  const day = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <ul className="set-rituals">
      <li>
        <strong>Look ahead 4 weeks</strong> every other Thursday, offered after Done in Plan the week. Next: {day(n.lookAhead)}.
      </li>
      <li>
        <strong>Direction review</strong> (8 to 12 weeks) on the first Thursday of each month. Next: {day(n.direction)}.
      </li>
      <li className="muted">Both open Plan ahead; switch them in Notifications.</li>
    </ul>
  );
}

/** Settings > Planning > Timeboxes (step 12): Put on Outlook by default, and asking before changing my own events. */
function TimeboxForm(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const [v, setV] = useState(p.data.timebox);
  const { problems, status, save } = useSave(p.onSavedData);
  return (
    <form
      className="set-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save("timebox", v);
      }}
    >
      <h3>Timeboxes</h3>
      <div className="set-grid">
        <Field label="Use timeboxing" hint="Off hides the time controls; timeboxes are kept.">
          <label className="set-check">
            <input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> Use timeboxing
          </label>
          <Problems all={problems} field="timebox.enabled" />
        </Field>
        <Field label="Put on Outlook" hint="Every new event shows a preview first.">
          <label className="set-check">
            <input type="checkbox" checked={v.outlookDefault} onChange={(e) => setV({ ...v, outlookDefault: e.target.checked })} /> On by default
          </label>
          <Problems all={problems} field="timebox.outlook_default" />
        </Field>
        <Field label="Changes to my own timebox events" hint="Off: no question; every change is still logged and can be undone.">
          <label className="set-check">
            <input type="checkbox" checked={!v.confirmOwn} onChange={(e) => setV({ ...v, confirmOwn: !e.target.checked })} /> Don't ask again for my own timeboxes
          </label>
          <Problems all={problems} field="timebox.confirm_own" />
        </Field>
      </div>
      <SaveRow status={status} />
    </form>
  );
}

/** Settings > Planning > Help sessions (step 13): length, Teams, how many workdays "Needs help from…" searches. */
function CollabForm(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const c = p.data.collab;
  const [v, setV] = useState({ meetingMinutes: c.meetingMinutes, teams: c.teams, daysAhead: c.daysAhead, exclude: [...c.exclude] });
  const [adding, setAdding] = useState("");
  const { problems, status, save } = useSave(p.onSavedData);
  return (
    <form
      className="set-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save("collab", v);
      }}
    >
      <h3>Help sessions</h3>
      <div className="set-grid">
        <Field label="Default length" hint="Where Needs help from… starts.">
          <select value={v.meetingMinutes} onChange={(e) => setV({ ...v, meetingMinutes: Number(e.target.value) })}>
            {COLLAB_LENGTHS.map((m) => (
              <option key={m} value={m}>{m} minutes</option>
            ))}
          </select>
          <Problems all={problems} field="collab.meeting_minutes" />
        </Field>
        <Field label="Teams meeting" hint="You can turn it off per invite.">
          <label className="set-check">
            <input type="checkbox" checked={v.teams} onChange={(e) => setV({ ...v, teams: e.target.checked })} /> On by default
          </label>
          <Problems all={problems} field="collab.teams" />
        </Field>
        <Field label="Days to search" hint="Workdays from today, for items not pinned to a day.">
          <input type="number" min={1} max={10} step={1} value={v.daysAhead} onChange={(e) => setV({ ...v, daysAhead: Number(e.target.value) })} />
          <Problems all={problems} field="collab.days_ahead" />
        </Field>
        <Field label="People to exclude" hint="Never suggested as helpers or as Who. By name or email.">
          <ul className="set-list">
            {v.exclude.map((x, i) => (
              <li key={`${x}:${i}`}>
                <span>{x}</span>
                <button type="button" className="mini quiet" aria-label={`Remove ${x}`} onClick={() => setV({ ...v, exclude: v.exclude.filter((_, j) => j !== i) })}>Remove</button>
              </li>
            ))}
          </ul>
          <span className="set-inline">
            <input value={adding} maxLength={200} placeholder="Name or email" aria-label="Add a person to exclude" onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (adding.trim()) setV({ ...v, exclude: [...v.exclude, adding.trim()] }), setAdding("");
                }
              }} />
            <button type="button" className="mini" disabled={!adding.trim()} onClick={() => { setV({ ...v, exclude: [...v.exclude, adding.trim()] }); setAdding(""); }}>Add</button>
          </span>
          <Problems all={problems} field="collab.exclude" />
        </Field>
        <ReadOnly label="Invites go only to" value={c.domains.join(", ") || "No domain yet"} where="Set in config.toml ([collab] domains)" />
      </div>
      <SaveRow status={status} />
    </form>
  );
}

/** Settings > Focus (step 10): the default sound, volume, fade, what a break sounds like, media pause, playlists. */
function FocusForm(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const f = p.data.focus;
  const [v, setV] = useState({ sound: f.sound, volume: f.volume, fadeSeconds: f.fadeSeconds, onBreak: f.onBreak, pauseMedia: f.pauseMedia, teamsStatus: f.teamsStatus, plainFocusStatus: f.plainFocusStatus });
  const [lists, setLists] = useState<Playlist[]>(f.playlists);
  const [media, setMedia] = useState<{ players: boolean; spotify: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const { problems, status, save } = useSave(p.onSavedData);
  useEffect(() => {
    call<{ players: boolean; spotify: boolean }>("media.status", {}).then(setMedia, () => setMedia(null));
  }, []);
  const preview = async () => {
    if (v.sound === "none") return;
    await sound.unlock();
    sound.setVolume(v.volume);
    sound.play(v.sound, 1);
    setPreviewing(true);
    setTimeout(() => {
      sound.stop(1);
      setPreviewing(false);
    }, 6000);
  };
  const badLink = (u: string) => !!u.trim() && !playlistLink(u);
  return (
    <form
      className="set-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save("focus", { ...v, playlists: lists.filter((l) => l.name.trim() || l.url.trim()) });
      }}
    >
      <h3>Teams status</h3>
      <p className="muted">Set while focus runs, back to automatic after. A change you make in Teams wins.</p>
      <div className="set-grid">
        <Field label="Set Teams status during focus" hint="Logged in Data › Teams status log.">
          <label className="set-check">
            <input type="checkbox" checked={v.teamsStatus} onChange={(e) => setV({ ...v, teamsStatus: e.target.checked })} /> Set my status while I focus
          </label>
          <TeamsAccessLine />
          <Problems all={problems} field="focus.teams_status" />
        </Field>
        <Field label="Plain focus sets" hint="Deep focus always sets Do not disturb.">
          <select value={v.plainFocusStatus} disabled={!v.teamsStatus} onChange={(e) => setV({ ...v, plainFocusStatus: e.target.value as "busy" | "none" })}>
            <option value="busy">Busy</option>
            <option value="none">Nothing: leave my status alone</option>
          </select>
          <Problems all={problems} field="focus.plain_focus_status" />
        </Field>
      </div>
      <h3>Sound while focusing</h3>
      <p className="muted">Plays only while focus runs. The focus screen can pick another.</p>
      <div className="set-grid">
        <Field label="Default sound" hint={BINAURAL[v.sound as SoundKind] ? "Binaural beats need headphones." : "Brown is deep, pink brighter, rain a slow swell."}>
          <span className="set-inline">
            <select value={v.sound} onChange={(e) => setV({ ...v, sound: e.target.value as SoundKind })}>
              {SOUNDS.map((k) => (
                <option key={k} value={k}>{SOUND_NAMES[k]}</option>
              ))}
            </select>
            <button type="button" className="mini" disabled={v.sound === "none" || previewing} onClick={() => void preview()}>
              {previewing ? "Playing…" : "Try it"}
            </button>
          </span>
          <Problems all={problems} field="focus.sound" />
        </Field>
        <Field label={`Volume (${v.volume})`} hint="0 to 100.">
          <input type="range" min={0} max={100} step={5} value={v.volume} onChange={(e) => { setV({ ...v, volume: Number(e.target.value) }); sound.setVolume(Number(e.target.value)); }} />
          <Problems all={problems} field="focus.volume" />
        </Field>
        <Field label="Fade in and out (seconds)" hint="0 to 30.">
          <input type="number" min={0} max={30} step={1} value={v.fadeSeconds} onChange={(e) => setV({ ...v, fadeSeconds: Number(e.target.value) })} />
          <Problems all={problems} field="focus.fade_seconds" />
        </Field>
        <Field label="When a break starts" hint="The sound stops either way.">
          <select value={v.onBreak} onChange={(e) => setV({ ...v, onBreak: e.target.value as "silence" | "chime" })}>
            <option value="silence">Silence</option>
            <option value="chime">A soft chime</option>
          </select>
          <Problems all={problems} field="focus.on_break" />
        </Field>
      </div>
      <h3>Music players</h3>
      <div className="set-grid">
        <Field
          label="Pause and resume music"
          hint={
            media === null
              ? "Checking for music players…"
              : media.players
                ? "Pauses what is playing when focus ends or a break starts, and resumes it when the next focus starts."
                : "FocusTime can't pause or resume music players here. Nothing is installed for you."
          }
        >
          <label className="set-check">
            <input type="checkbox" checked={v.pauseMedia} disabled={media !== null && !media.players && !v.pauseMedia} onChange={(e) => setV({ ...v, pauseMedia: e.target.checked })} /> Pause music when focus ends
          </label>
          <Problems all={problems} field="focus.pause_media" />
        </Field>
      </div>
      <h3>Playlists</h3>
      <p className="muted">
        Save up to {MAX_PLAYLISTS} Spotify or YouTube links. Choosing one on the focus screen opens it: {media?.spotify ? "Spotify links in the Spotify app" : "in your default browser (the Spotify app isn't installed)"}.
      </p>
      <ul className="set-playlists">
        {lists.map((l, i) => (
          <li key={i}>
            <input value={l.name} placeholder="Name" aria-label={`Playlist ${i + 1} name`} maxLength={60} onChange={(e) => setLists(lists.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input value={l.url} placeholder="https://open.spotify.com/playlist/… or https://www.youtube.com/playlist?list=…" aria-label={`Playlist ${i + 1} link`} maxLength={500} aria-invalid={badLink(l.url)} onChange={(e) => setLists(lists.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            <button type="button" className="mini quiet" onClick={() => setLists(lists.filter((_, j) => j !== i))} aria-label={`Remove playlist ${l.name || i + 1}`}>
              Remove
            </button>
            {badLink(l.url) && <span className="field-problem">Only Spotify or YouTube links (https)</span>}
            <Problems all={problems} field={`focus.playlists[${i}]`} />
          </li>
        ))}
      </ul>
      {lists.length < MAX_PLAYLISTS && (
        <button type="button" className="mini" onClick={() => setLists([...lists, { name: "", url: "" }])}>
          Add a playlist
        </button>
      )}
      <Problems all={problems} field="focus.playlists" />
      <SaveRow status={status} />
    </form>
  );
}

/** Settings > You (step 15.5, Q87): whether the morning box's Start starts the VM at once. */
function VmStartForm(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const [on, setOn] = useState(p.data.vm.startWithoutAsking);
  const { problems, status, save } = useSave(p.onSavedData);
  return (
    <div className="set-grid set-vm-start">
      <Field label="Start my VM without asking" hint={'Start in the morning prompt skips the preview. Stop always previews.'}>
        <label className="set-check">
          <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); void save("vm", { startWithoutAsking: e.target.checked }); }} /> Start right away
        </label>
        <Problems all={problems} field="azure.start_without_asking" />
        {status && <span className="set-hint" role="status">{status}</span>}
      </Field>
    </div>
  );
}

/** Settings > Notifications (step 15.5): a switch per kind, quiet hours, held during focus, a test. */
/** Settings > Roadmap (step 17): when a row reads Stalled or Watch. Whole numbers. */
function RoadmapForm(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const r = p.data.roadmap;
  const [v, setV] = useState({ stalledDays: r.stalledDays, watchWeeks: r.watchWeeks });
  const { problems, status, save } = useSave(p.onSavedData);
  return (
    <form
      className="set-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save("roadmap", v);
      }}
    >
      <p className="muted">When a Roadmap row reads Stalled or Watch.</p>
      <div className="set-grid">
        <Field label="Stalled after (days)" hint="Days with no story change. 3 to 60.">
          <input type="number" min={3} max={60} step={1} value={v.stalledDays} onChange={(e) => setV({ ...v, stalledDays: Math.round(Number(e.target.value)) })} />
          <Problems all={problems} field="roadmap.stalled_days" />
        </Field>
        <Field label="Watch within (weeks)" hint="Forecast this close to the target. 0 to 4; 0 is never.">
          <input type="number" min={0} max={4} step={1} value={v.watchWeeks} onChange={(e) => setV({ ...v, watchWeeks: Math.round(Number(e.target.value)) })} />
          <Problems all={problems} field="roadmap.watch_weeks" />
        </Field>
      </div>
      <SaveRow status={status} />
    </form>
  );
}

function NotifyForm(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const n = p.data.notify;
  const [kinds, setKinds] = useState<Record<NotifyKind, boolean>>({ ...n.kinds });
  const [quiet, setQuiet] = useState(n.quiet);
  const [quietPto, setQuietPto] = useState(n.quietPto);
  const [test, setTest] = useState<string | null>(null);
  const { problems, status, save } = useSave(p.onSavedData);
  const group = (title: string, list: readonly NotifyKind[]) => (
    <fieldset className="set-notify-group">
      <legend>{title}</legend>
      {list.map((k) => (
        <label key={k} className="set-notify-row">
          <input type="checkbox" checked={kinds[k]} onChange={(e) => setKinds({ ...kinds, [k]: e.target.checked })} />
          <span className="set-notify-name">{KIND_LABEL[k]}</span>
          <span className="set-hint">{KIND_HINT[k]}</span>
          <Problems all={problems} field={`notify.${k}`} />
        </label>
      ))}
    </fieldset>
  );
  return (
    <form
      className="set-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save("notify", { kinds, quiet, quietPto });
      }}
    >
      <p className="muted">Each is sent once; a click opens FocusTime there.</p>
      <div className="set-notify">
        {group("Ritual reminders", RITUAL_KINDS)}
        {group("While you focus", ["timer", "meeting"])}
        {group("Other", ["vm", "followups", "expiry"])}
      </div>
      <h3>Quiet hours</h3>
      <div className="set-grid">
        <Field label="Quiet" hint="Focus timer and meeting warnings still come.">
          <select value={quiet} onChange={(e) => setQuiet(e.target.value as QuietMode)}>
            <option value="outside_hours">Outside working hours</option>
            <option value="off">Never quiet</option>
          </select>
          <Problems all={problems} field="notify.quiet" />
        </Field>
        <Field label="Days off" hint="PTO days from Dataverse.">
          <label className="set-check">
            <input type="checkbox" checked={quietPto} onChange={(e) => setQuietPto(e.target.checked)} /> Quiet on PTO days
          </label>
          <Problems all={problems} field="notify.quiet_pto" />
        </Field>
      </div>
      <h3>During a focus session</h3>
      <p className="muted">The rest wait and come as one after the session.</p>
      <div className="set-actions-row">
        <button
          type="button"
          className="mini"
          onClick={() => {
            setTest("Sending…");
            void call("notify.test", {}).then(() => setTest("Sent. Click it to come back here."), (e: unknown) => setTest(e instanceof Error ? e.message : "Couldn't send it"));
          }}
        >
          Send a test notification
        </button>
        {test && <span className="set-hint" role="status">{test}</span>}
      </div>
      <SaveRow status={status} />
    </form>
  );
}

function RiskForm(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const r = p.data.risk!;
  const [v, setV] = useState({ meetingWatchMinutes: r.meetingWatchMinutes, meetingAtRiskMinutes: r.meetingAtRiskMinutes, minFocusWindowMinutes: r.minFocusWindowMinutes });
  const { problems, status, save } = useSave(p.onSavedData);
  const num = (k: keyof typeof v, label: string, field: string, hint: string) => (
    <Field label={label} hint={hint}>
      <input type="number" min={0} max={600} step={5} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
      <Problems all={problems} field={field} />
    </Field>
  );
  return (
    <form
      className="set-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save("risk", v);
      }}
    >
      <div className="set-grid">
        {num("meetingWatchMinutes", "Watch at (minutes of meetings)", "risk.meeting_watch_minutes", "A block with this many minutes of meetings is marked Watch.")}
        {num("meetingAtRiskMinutes", "At risk at (minutes of meetings)", "risk.meeting_at_risk_minutes", "At least the Watch value.")}
        {num("minFocusWindowMinutes", "Shortest useful focus window (minutes)", "risk.min_focus_window_minutes", "With no free stretch this long, the block is at risk.")}
      </div>
      <SaveRow status={status} />
    </form>
  );
}

const fullDate = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
/** Why a client is (or isn't) followed, in plain words (step 6d). */
export function followText(f: FollowState | null, grace: number): string {
  if (!f) return "Unknown until Dataverse connects.";
  switch (f.why) {
    case "internal": return "Always followed (internal).";
    case "standing": return "Always followed (standing block).";
    case "ongoing": return "Followed: focus time is ongoing.";
    case "until": return `Followed: focus time until ${fullDate(f.date)}.`;
    case "grace": return `Followed until ${fullDate(f.until)}: focus time ended ${fullDate(f.date)} (${grace} days grace).`;
    case "kept": return "Followed because Keep following is on.";
    case "ended": return `Not followed: focus time ended ${fullDate(f.date)}. No DevOps items or Open half-day choices.`;
    case "none": return "Not followed: no focus time. No DevOps items or Open half-day choices.";
  }
}

/** Followed clients (or follow unknown) first; Dataverse clients FocusTime doesn't follow fold away. */
const followedFirst = (cs: readonly SettingsClient[]) => ({ followed: cs.filter((c) => c.follow?.active !== false), other: cs.filter((c) => c.follow?.active === false) });

/** One client: its settings, its DevOps identity (Dataverse's) and, when it has DevOps, my write access. */
function ClientCard({ c, d, p }: { c: SettingsClient; d: SettingsData; p: { onSavedData: (d: SettingsData) => void; reload: () => Promise<void> } }) {
  return (
    <div className="set-client-wrap" style={{ "--c": c.setting.color ? (c.setting.color.startsWith("#") ? c.setting.color : `var(--client-${c.setting.color})`) : "var(--client-none)" } as CSSProperties}>
      <ClientForm client={c} data={d} onSavedData={p.onSavedData} />
      {c.devops ? <WriteAccess client={c} onDone={p.reload} /> : d.dataverseReached && <p className="muted set-client-note">No DevOps set up for {c.setting.name ?? c.dataverseName ?? c.key} in Dataverse, so there is nothing to write to. Change it in Dataverse.</p>}
    </div>
  );
}

function ClientForm({ client: c, data, onSavedData }: { client: SettingsClient; data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const reached = data.dataverseReached;
  const [name, setName] = useState(c.setting.name ?? "");
  const [color, setColor] = useState(c.setting.color ?? "");
  const [open, setOpen] = useState(c.setting.openStates.join(", "));
  const [keep, setKeep] = useState(c.setting.follow);
  const { problems, status, save } = useSave(onSavedData);
  const f = `clients.${c.key}`;
  return (
    <form
      className="set-form set-client"
      style={{ "--c": color ? (color.startsWith("#") ? color : `var(--client-${color})`) : "var(--client-none)" } as CSSProperties}
      onSubmit={(e) => {
        e.preventDefault();
        void save("client", { key: c.key, name, color, openStates: open.split(",").map((x) => x.trim()).filter(Boolean), follow: keep });
      }}
    >
      <h3>
        <span className="swatch" /> {c.setting.name ?? c.key}
      </h3>
      <div className="set-grid">
        <ReadOnly label="Dataverse nickname" value={c.dataverseName ?? c.key} where="Change this in Dataverse" />
        <ReadOnly label="Your DevOps identity" value={c.devopsEmail ?? (reached ? null : "unknown until Dataverse connects")} where="Change this in Dataverse" />
        <Field label="Shown as" hint="Empty shows the Dataverse nickname.">
          <input value={name} placeholder={c.key} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <Problems all={problems} field={`${f}.name`} />
        </Field>
        <fieldset className="set-choice palette">
          <legend>Color</legend>
          {data.palette.map((slot) => (
            <label key={slot} className="slot" title={slot}>
              <input type="radio" name={`color-${c.key}`} checked={color === slot} onChange={() => setColor(slot)} aria-label={slot} />
              <span className="slot-swatch" style={{ background: `var(--client-${slot})` }} />
            </label>
          ))}
          {color.startsWith("#") && <span className="set-hint">Custom color {color} (pick a palette color to use theme-aware colors)</span>}
          <Problems all={problems} field={`${f}.color`} />
        </fieldset>
        <Field label="Followed" hint={followText(c.follow, data.planning.followGraceDays)}>
          <label className="set-check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} disabled={c.follow?.why === "internal" || c.follow?.why === "standing"} /> Keep following
          </label>
          <Problems all={problems} field={`${f}.follow`} />
        </Field>
        <Field label='States treated as open' hint="Done states this client still works in, like Resolved.">
          <input value={open} placeholder="none" onChange={(e) => setOpen(e.target.value)} />
          <Problems all={problems} field={`${f}.open_states`} />
        </Field>
      </div>
      <SaveRow status={status} />
    </form>
  );
}

function Connections(p: Props & { data: SettingsData; reload: () => Promise<void> }) {
  return (
    <div className="set-form">
      <ul className="set-list sources">
        {p.sources.map((s) => {
          const st = stateOf(s);
          const acts = sourceActions(s);
          const cal = s.source === "outlook" || s.source === "google" ? s.source : null;
          return (
            <li key={s.source} className={`source ${st.cls}`}>
              <span className="dot" aria-hidden="true" />
              <strong>{SOURCE_NAMES[s.source]}</strong>
              <span className={`state ${st.cls}`}>{st.label}</span>
              <span className="muted">{s.message ?? (s.sample || notConnected(s) ? "" : `${s.itemCount} ${s.itemCount === 1 ? "item" : "items"}`)}</span>
              <span className="row-actions">
                <button type="button" className="mini" disabled={p.loading} onClick={p.onRefresh}>
                  {p.loading ? "Retrying…" : "Retry"}
                </button>
                {cal && (acts.includes("connect") || acts.includes("reconnect")) && (
                  <button type="button" className="mini primary" disabled={p.busy !== null} onClick={() => p.onConnect(cal)}>
                    {p.busy === cal ? "Waiting for sign-in…" : acts.includes("connect") ? "Connect" : "Reconnect"}
                  </button>
                )}
                {cal && acts.includes("disconnect") && (
                  <button type="button" className="mini quiet" disabled={p.busy !== null} onClick={() => p.onDisconnect(cal)}>
                    Disconnect
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {p.reconnected && <InlineMoment line={`${SOURCE_NAMES[p.reconnected]} is connected again.`} />}
      <OutlookWriteRow />
      {p.devops && p.devops.length > 0 && (
        <>
          <h3>DevOps per client</h3>
          <p className="muted">Read from Dataverse only when fetching; never shown.</p>
          <ul className="set-list sources">
            {p.devops.map((c) => {
              const ok = c.status === "ok";
              const cls = ok ? (c.fromCache ? "cached" : "live") : "error";
              return (
                <li key={c.clientKey} className={`source ${cls}`}>
                  <span className="dot" aria-hidden="true" />
                  <strong>{c.clientName}</strong>
                  <span className={`state ${cls}`}>{ok ? (c.fromCache ? "Cached" : "Live") : DEVOPS_STATE[c.status]}</span>
                  <span className="muted">
                    {ok ? `${c.items.length} ${c.items.length === 1 ? "item" : "items"} assigned` : c.message}
                    {c.status === "auth_failed" || c.status === "not_set_up" || c.status === "identity_missing" ? ". Change it in Dataverse" : ""}
                  </span>
                  <span className="row-actions">
                    <button type="button" className="mini" disabled={p.loading} onClick={p.onRefresh}>
                      {p.loading ? "Retrying…" : "Retry"}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {p.data.secrets.length > 0 && <h3>Client secrets</h3>}
      {p.data.secrets.length > 0 && <p className="muted">Saved to the keyring; never shown again.</p>}
      {p.data.secrets.map((s) => (
        <SecretForm key={s.account} secret={s} onDone={p.reload} />
      ))}
    </div>
  );
}

function SecretForm({ secret: s, onDone }: { secret: SettingsData["secrets"][number]; onDone: () => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [expires, setExpires] = useState(s.expires ?? "");
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const state = s.state === "set" ? "Set" : s.state === "missing" ? "Not set" : s.state === "locked" ? "Keyring locked" : "Keyring unavailable";
  const daysLeft = s.expires ? Temporal.PlainDate.from(s.expires).since(Temporal.Now.plainDateISO()).days : null;
  return (
    <form
      className="set-row secret"
      autoComplete="off"
      onSubmit={async (e) => {
        e.preventDefault();
        const value = ref.current?.value ?? "";
        if (value && s.state === "set" && !confirm) {
          setConfirm(true);
          setStatus("This replaces the secret in the keyring. Press Replace again to confirm.");
          return;
        }
        const input: Record<string, unknown> = { account: s.account };
        if (value) input.value = value;
        if (expires !== (s.expires ?? "")) input.expires = expires;
        if (Object.keys(input).length === 1) return setStatus("Nothing to save");
        try {
          await call("secret.set", input);
          if (ref.current) ref.current.value = "";
          setConfirm(false);
          setStatus(value ? "Saved to the keyring" : "Expiry date saved");
          await onDone();
        } catch (err) {
          setStatus(err instanceof Error ? err.message : "Not saved");
        } finally {
          if (ref.current) ref.current.value = "";
        }
      }}
    >
      <strong>{s.label}</strong>
      <span className={`state ${s.state === "set" ? "live" : "error"}`}>{state}</span>
      {s.expires && <span className={daysLeft !== null && daysLeft < 30 ? "field-problem" : "muted"}>expires {shortDate(s.expires)}</span>}
      <input ref={ref} type="password" autoComplete="new-password" spellCheck={false} placeholder={s.state === "set" ? "New secret to replace it" : "Paste the secret"} aria-label={`${s.label} (masked)`} onChange={() => setConfirm(false)} />
      <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} aria-label={`${s.label} expiry date`} title="Expiry date, if you know it" />
      <button type="submit" className="mini primary">
        {confirm ? "Replace" : "Save"}
      </button>
      {status && (
        <span className="muted" role="status">
          {status}
        </span>
      )}
    </form>
  );
}

/**
 * Step 14: DevOps write access per client. A masked field for my own PAT; the server checks it belongs to my DevOps
 * identity there before keeping it in the keyring. The PAT is never shown again, and never sent anywhere else.
 */
function WriteAccess({ client: c, onDone }: { client: SettingsData["clients"][number]; onDone: () => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [expires, setExpires] = useState(c.write?.expires ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const w = c.write;
  const daysLeft = w?.expires ? Temporal.PlainDate.from(w.expires).since(Temporal.Now.plainDateISO()).days : null;
  return (
    <form
      className="set-row secret devops-write"
      autoComplete="off"
      aria-label={`DevOps write access for ${c.setting.name ?? c.key}`}
      onSubmit={async (e) => {
        e.preventDefault();
        const value = ref.current?.value ?? "";
        const input: Record<string, unknown> = { clientKey: c.key };
        if (value) input.pat = value;
        if (expires !== (w?.expires ?? "")) input.expires = expires || null;
        if (Object.keys(input).length === 1) return setStatus("Nothing to save");
        setBusy(true);
        setStatus(value ? "Checking whose PAT this is…" : null);
        try {
          await call("devops.set_write_pat", input);
          setStatus(value ? "Checked and saved to the keyring" : "Expiry date saved");
          await onDone();
        } catch (err) {
          setStatus(err instanceof Error ? err.message : "Not saved");
        } finally {
          if (ref.current) ref.current.value = "";
          setBusy(false);
        }
      }}
    >
      <strong>DevOps write access for {c.setting.name ?? c.dataverseName ?? c.key}</strong>
      <span className={`state ${w ? "live" : "muted"}`}>{w ? "On" : "Off, read-only"}</span>
      {w ? (
        <span className="muted">
          as {w.name} ({w.email}) on {w.org}
          {w.expires ? `, expires ${shortDate(w.expires)}` : ""}
        </span>
      ) : (
        <span className="muted">Your own PAT with Work Items (Read &amp; write).</span>
      )}
      {w?.expires && daysLeft !== null && daysLeft < 14 && <span className="field-problem">Expires in {Math.max(0, daysLeft)} days</span>}
      <input ref={ref} type="password" autoComplete="new-password" spellCheck={false} placeholder={w ? "New PAT to replace it" : "Paste your PAT"} aria-label={`DevOps write PAT for ${c.setting.name ?? c.key} (masked)`} />
      <label className="set-inline">
        <span className="muted">Expires (optional)</span>
        <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} title="DevOps doesn't tell FocusTime the expiry; copy it from the PAT page" />
      </label>
      <button type="submit" className="mini primary" disabled={busy}>
        {busy ? "Checking…" : "Save"}
      </button>
      {w && (
        <button
          type="button"
          className="mini quiet"
          disabled={busy}
          onClick={async () => {
            await call("devops.clear_write_pat", { clientKey: c.key }).catch(() => null);
            setStatus("Turned off. The PAT was removed from the keyring");
            await onDone();
          }}
        >
          Turn off
        </button>
      )}
      {status && (
        <span className="muted" role="status">
          {status}
        </span>
      )}
    </form>
  );
}

/** Reset local plan (Q37): type "reset" to confirm; the server backs the store up first. */
function ResetPlan({ disabled, onDone }: { disabled: boolean; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="set-field">
      <span className="set-label">Reset local plan</span>
      {asking ? (
        <form
          className="set-inline"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await call<{ backup: string | null }>("plan.reset", { confirm: typed.trim() });
              setStatus(`Done. The plan store was backed up first${r.backup ? ` (${r.backup})` : ""}.`);
              setAsking(false);
              setTyped("");
              onDone();
            } catch (err) {
              setStatus(err instanceof Error ? err.message : "Not reset");
            }
          }}
        >
          <input autoFocus value={typed} placeholder='Type "reset"' aria-label='Type "reset" to confirm' onChange={(e) => setTyped(e.target.value)} />
          <button type="submit" className="mini danger" disabled={typed.trim() !== "reset"}>
            Reset
          </button>
          <button type="button" className="mini" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="mini" disabled={disabled} onClick={() => { setAsking(true); setStatus(null); }}>
          Reset…
        </button>
      )}
      <span className="set-hint">{status ?? "Empties the plan store after a full backup. Settings and calendars stay."}</span>
    </div>
  );
}

/** A2: Export my data: everything FocusTime keeps for the signed-in person, downloaded as one JSON file. */
function ExportMine() {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="set-field">
      <span className="set-label">Export my data</span>
      <button
        type="button"
        className="mini"
        onClick={async () => {
          try {
            setStatus("Preparing…");
            const r = await call<{ fileName: string; export: unknown }>("data.export_mine", {});
            const url = URL.createObjectURL(new Blob([`${JSON.stringify(r.export, null, 2)}\n`], { type: "application/json" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = r.fileName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
            setStatus(`Downloaded ${r.fileName}`);
          } catch (e) {
            setStatus(e instanceof Error ? e.message : "Export failed");
          }
        }}
      >
        Download JSON
      </button>
      <span className="set-hint">{status ?? "Your plans, follow-ups, captures, logs and settings. Never a password or token."}</span>
    </div>
  );
}

/** A2: Delete my data: signs out and deletes everything kept for this person (kept 30 days, then removed for good). */
function DeleteMine() {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="set-field">
      <span className="set-label">Delete my data</span>
      {asking ? (
        <form
          className="set-inline set-delete"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await call("data.delete_mine", { confirm: "delete" });
              location.replace("/?signin=deleted");
            } catch (err) {
              setStatus(err instanceof Error ? err.message : "Not deleted");
            }
          }}
        >
          <input autoFocus value={typed} placeholder='Type "delete"' aria-label='Type "delete" to confirm' onChange={(e) => setTyped(e.target.value)} />
          <button type="submit" className="mini danger" disabled={typed.trim() !== "delete"}>
            Delete
          </button>
          <button type="button" className="mini" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="mini" onClick={() => { setAsking(true); setStatus(null); }}>
          Delete…
        </button>
      )}
      <span className="set-hint">
        {status ??
          (asking
            ? "Export first if you want a copy. You'll be signed out and can't sign in again. Everything is removed for good after 30 days. Outlook events, DevOps changes and your VM's schedule that FocusTime already made stay as they are."
            : "Signs you out and deletes everything FocusTime keeps for you.")}
      </span>
    </div>
  );
}

function DataSection(p: Props & { data: SettingsData }) {
  return (
    <div className="set-form">
      <WriteLog />
      <DevOpsWriteLog />
      <AzureWriteLog tz={userZone(p.data.you)} />
      <TeamsStatusLog tz={userZone(p.data.you)} />
      <div className="set-grid">
        <ExportMine />
        <ResetPlan disabled={!p.data.data.planStore} onDone={p.onSaved} />
        <DeleteMine />
      </div>
    </div>
  );
}

/** Settings > Connections (step 12): whether FocusTime may change its own Outlook events, and how to allow it. */
function OutlookWriteRow() {
  const env = useTimeboxes();
  useEffect(() => env?.loadAccess(), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!env) return null;
  const a = env.access;
  return (
    <div className="set-write">
      <h3>Outlook calendar changes</h3>
      <p>
        {!a ? "Checking…" : a.access === "write" ? "Allowed: FocusTime can create, change and remove the Outlook events it created (timeboxes), each after a preview. It can't change any other event." : a.message}
      </p>
      {a && a.access !== "write" && a.access !== "not_set_up" && (
        <button type="button" className="mini primary" onClick={env.connectWrite}>
          Reconnect Outlook with calendar changes
        </button>
      )}
      <p className="set-hint">Asks for Calendars.ReadWrite only when you reconnect here.</p>
    </div>
  );
}

const OPS: Record<WriteEntry["op"], string> = { create: "Created", update: "Changed", delete: "Removed" };
const KINDS: Record<WriteEntry["kind"], string | null> = { timebox: null, event: "Your event", invite: "Help invite", sync: "From Outlook", rsvp: "Response" };
const STATUS: Record<WriteEntry["status"], string> = { pending: "Not finished", confirmed: "Confirmed", unconfirmed: "Not confirmed", failed: "Failed", refused: "Refused" };
/** Settings > Data (step 12): every external write, newest first, with Undo and Retry; and FocusTime events left on Outlook. */
function WriteLog() {
  const env = useTimeboxes();
  const [log, setLog] = useState<WriteLogView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<WriteLogView>("write.log", {}).then(setLog, (e: unknown) => setError(e instanceof Error ? e.message : "The write log could not load"));
  }, [env?.timeboxes]);
  const tz = env?.tz ?? NEUTRAL_ZONE;
  const stamp = (s: string) => Temporal.ZonedDateTime.from(s).withTimeZone(tz).toPlainDateTime().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <section className="write-log" aria-label="Write log">
      <h3>Write log</h3>
      <p className="muted">Every change FocusTime made outside this computer.</p>
      {error && <p className="set-problem">{error}</p>}
      {log && log.orphans.length > 0 && (
        <div className="wl-orphans">
          <h4>FocusTime events with no timebox</h4>
          <ul>
            {log.orphans.map((o) => (
              <li key={o.uid}>
                <span>{o.title}</span> <span className="muted">{o.when}</span>{" "}
                <button type="button" className="mini" onClick={() => void env?.sync(o.uid)}>Remove from Outlook</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {log && !log.entries.length && <p className="muted">Nothing written yet.</p>}
      {log && log.entries.length > 0 && (
        <table className="wl-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What</th>
              <th scope="col">Where</th>
              <th scope="col">Result</th>
              <th scope="col">Before</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {log.entries.map((e) => (
              <tr key={e.id} className={`wl-${e.status}`}>
                <td>{stamp(e.at)}</td>
                <td>
                  {KINDS[e.kind] && <span className={`wl-kind wl-kind-${e.kind}`}>{KINDS[e.kind]}</span>}{" "}
                  {e.undoOf !== null ? "Undo: " : ""}
                  {e.kind === "sync" ? (e.message ?? OPS[e.op]).replace(/^From Outlook: /, "") : e.kind === "rsvp" ? `${responseLabel(e.after?.response)} to` : OPS[e.op]} <strong>{(e.after ?? e.before)?.subject ?? ""}</strong>
                  {e.whenText && <span className="muted"> · {e.whenText}</span>}
                  {e.auto && e.kind !== "sync" && <span className="muted"> · without asking</span>}
                </td>
                <td>Outlook{e.calendar ? ` · ${e.calendar}` : ""}{e.account ? ` · ${e.account}` : ""}</td>
                <td>
                  {STATUS[e.status]}
                  {e.undoneBy !== null && <span className="muted"> · undone</span>}
                  {e.attempts > 1 && <span className="muted"> · {e.attempts} tries</span>}
                  {e.message && e.status !== "confirmed" && <div className="muted">{e.message}</div>}
                </td>
                <td className="muted">{e.kind === "rsvp" ? responseLabel(e.before?.response) : e.before ? `${e.before.subject}, ${Temporal.Instant.from(e.before.start).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })} to ${Temporal.Instant.from(e.before.end).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Nothing (new)"}</td>
                <td>
                  {e.undoable && <button type="button" className="mini" onClick={() => void env?.undo(e.id)}>Undo</button>}
                  {e.retryable && <button type="button" className="mini" onClick={() => void env?.retry(e.id)}>Retry</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
