// Settings (step 6b): every setting Coopilot owns, read from and written to the same validated config file. Values
// owned by Dataverse are shown read-only with where to change them. Secrets are entered in masked fields that go
// straight to the keyring; they are never shown again (only whether they are set, and an expiry date if entered).
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { FieldProblem, SettingsClient, SettingsData, SourceSummary } from "../actions/types.ts";
import { THEME_NAMES, THEMES, type Theme } from "../config/schema.ts";
import type { ClientWork } from "../week/types.ts";
import type { FollowState } from "../week/follow.ts";
import { spanText, VIEW_RANGE_NAMES, VIEW_RANGES, WEEKDAY_KEYS, type ViewRange } from "../week/hours.ts";
import { ActionRefusal, call } from "./api.ts";
import { notConnected, SOURCE_NAMES, sourceActions, stateOf, type Calendar } from "./status.ts";
import { shortDate } from "./labels.ts";

export const SETTINGS_SECTIONS = [
  ["you", "You"],
  ["hours", "Working hours"],
  ["standing", "Standing blocks"],
  ["planning", "Planning"],
  ["risk", "Risk rules"],
  ["clients", "Clients"],
  ["connections", "Connections"],
  ["display", "Display"],
  ["data", "Data"],
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
  theme: Theme;
  setTheme: (t: Theme) => void;
  viewRange: ViewRange;
  setViewRange: (r: ViewRange) => void;
  /** Clears an override (hours.clear_day) and reloads. */
  runTime: (action: string, input: Record<string, unknown>) => Promise<boolean>;
};

const DEVOPS_STATE: Record<ClientWork["status"], string> = { ok: "Live", identity_missing: "No identity", not_set_up: "Not set up", auth_failed: "PAT problem", no_access: "No access", unreachable: "Unreachable", error: "Error" };

const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } as const;

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
        <button type="button" className="set-tab close" onClick={props.onClose}>
          Back to the week <kbd>Esc</kbd>
        </button>
      </nav>
      <section className="set-body">
        <h2 ref={headRef} tabIndex={-1}>
          {title}
        </h2>
        {data && <p className="muted set-path">Saved to {data.configPath} (a backup is made on every save)</p>}
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
      return d.you ? (
        <div className="set-grid">
          <ReadOnly label="Email" value={d.you.email} where="Identifies you in Dataverse. Set in config.toml ([dataverse] my_email)" />
          <ReadOnly label="Dataverse user" value={d.you.systemUserId ? "Found" : "Not found yet"} where="Your Dataverse user record, found from the email. Change it in Dataverse" />
          <ReadOnly label="Environment" value={d.you.environmentUrl} where="Set in config.toml ([dataverse] environment_url)" />
          <ReadOnly label="Time zone" value={d.you.timeZone} where="Change it under Working hours" />
        </div>
      ) : null;
    case "hours":
      return d.hours ? <HoursForm {...p} /> : null;
    case "standing":
      return <StandingForm {...p} />;
    case "planning":
      return <PlanningForm {...p} />;
    case "risk":
      return d.risk ? <RiskForm {...p} /> : null;
    case "clients":
      return (
        <div className="set-clients">
          {d.clients.length === 0 && <p className="muted">No clients yet: they come from Dataverse (your Account Worker records) and from config.</p>}
          {d.clients.map((c) => (
            <ClientForm key={c.key} client={c} data={d} onSavedData={p.onSavedData} />
          ))}
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
            <span className="set-hint">Applies at once and is saved in config.</span>
          </fieldset>
          <fieldset className="set-choice">
            <legend>Default view range</legend>
            {VIEW_RANGES.map((r) => (
              <label key={r}>
                <input type="radio" name="range" checked={p.viewRange === r} onChange={() => p.setViewRange(r)} /> {VIEW_RANGE_NAMES[r]}
              </label>
            ))}
            <span className="set-hint">H in the week cycles it. Timelines widen to show anything planned outside it.</span>
          </fieldset>
          <div className="set-field">
            <span className="set-label">Style guide</span>
            <a href="/styleguide" target="_blank" rel="noopener">
              Open the style guide
            </a>
            <span className="set-hint">Tokens and core components, live in each theme.</span>
          </div>
        </div>
      );
    case "data":
      return <DataSection {...p} />;
  }
}

/** "09:00-17:00, 20:00-22:00" ⇄ spans. */
const spansIn = (s: string) => s.split(/[,;]/).map((x) => x.replace(/\s+/g, "")).filter(Boolean);

function HoursForm(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void; reload: () => Promise<void> }) {
  const h = p.data.hours!;
  const [tz, setTz] = useState(h.timeZone);
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
      <p className="muted">Working spans per day, like 09:00-17:00. A second span, like 20:00-22:00, becomes an evening slot that can hold picks. Leave a day empty for a day off. Friday is the overflow day unless you give it hours.</p>
      <div className="set-days">
        {WEEKDAY_KEYS.map((k) => (
          <Field key={k} label={DAY_NAMES[k]}>
            <input value={days[k]} placeholder="day off" onChange={(e) => setDays({ ...days, [k]: e.target.value })} aria-invalid={problemsFor(problems, `hours.${k}`).length > 0} />
            <Problems all={problems} field={`hours.${k}`} />
          </Field>
        ))}
      </div>
      <div className="set-grid">
        <Field label="Lunch" hint="Where the morning ends and the afternoon starts, like 12:00-12:30. Empty: the day splits in the middle.">
          <input value={lunch} placeholder="none" onChange={(e) => setLunch(e.target.value)} />
          <Problems all={problems} field="hours.lunch" />
        </Field>
        <Field label="Time zone" hint="An IANA zone, like America/New_York.">
          <input value={tz} onChange={(e) => setTz(e.target.value)} />
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
      <p className="muted">Half-days you keep for a client every week, shown when Dataverse has no focus block there.</p>
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
  const [v, setV] = useState({ S: pl.sizes.S, M: pl.sizes.M, L: pl.sizes.L, carryDays: pl.carryDays, reminderOffsetMinutes: pl.reminderOffsetMinutes, focusMinutes: pl.focusMinutes, breakMinutes: pl.breakMinutes, endSound: pl.endSound, followGraceDays: pl.followGraceDays, closeoutReminderMinutes: pl.closeoutReminderMinutes, checkinReminderMinutes: pl.checkinReminderMinutes });
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
          sizes: { S: v.S, M: v.M, L: v.L },
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
        {num("S", "Size S (minutes)", "plan.size_s", "A small pick. In steps of 5.")}
        {num("M", "Size M (minutes)", "plan.size_m", "More than S.")}
        {num("L", "Size L (minutes)", "plan.size_l", "More than M. Nothing above L: split it first.")}
        <Field label="Portfolio types that can be picked" hint='Work item types above story level that you still pick directly, like "Recurring".'>
          <input value={types} onChange={(e) => setTypes(e.target.value)} />
          <Problems all={problems} field="plan.pickable_portfolio_types" />
        </Field>
        {num("carryDays", "Carry-over (days back)", "plan.carry_days", "Unfinished picks from this many days back are offered on the first upcoming day not committed yet. 0 turns it off.", 1, 30)}
        {num("reminderOffsetMinutes", "Reminder (minutes after the day starts)", "plan.reminder_offset_minutes", "When today isn't committed, one reminder from this time, for 90 minutes.", 5, 240)}
      </div>
      <h3>Check-in and Close out</h3>
      <div className="set-grid">
        {num("checkinReminderMinutes", "Check-in reminder (minutes after lunch)", "plan.checkin_reminder_minutes", "One reminder after lunch ends (midday when there is no lunch), only on a committed day. 0 is right at the end of lunch.", 5, 120)}
        {num("closeoutReminderMinutes", "Close out reminder (minutes before the day ends)", "plan.closeout_reminder_minutes", "One reminder this long before the end of the working day, if Close out isn't done.", 5, 120)}
      </div>
      <h3>Plan the week</h3>
      <div className="set-grid">
        {([
          ["weekNudgeThu", "week_nudge_thu", "Thursday nudge", "For next week. Leave empty to turn it off."],
          ["weekNudgeFri", "week_nudge_fri", "Friday nudge", "For next week, if Thursday's didn't get it committed."],
          ["weekNudgeMon", "week_nudge_mon", "Monday nudge", "For this week, if it still isn't committed."],
        ] as const).map(([k, toml, label, hint]) => (
          <Field key={k} label={label} hint={`${hint} Each fires once, only while that week isn't committed.`}>
            <input type="time" value={nudges[k]} onChange={(e) => setNudges({ ...nudges, [k]: e.target.value })} />
            <Problems all={problems} field={`plan.${toml}`} />
          </Field>
        ))}
      </div>
      <h3>Clients followed</h3>
      <div className="set-grid">
        {num("followGraceDays", "Keep following after focus time ends (days)", "plan.follow_grace_days", "DevOps items and Open half-day choices come only from clients with focus time that is ongoing, ends today or later, or ended within this many days. Cooptimize always counts; Settings > Clients can keep one.", 1, 90)}
      </div>
      <h3>Focus timer</h3>
      <div className="set-grid">
        {num("focusMinutes", "Focus length (minutes)", "plan.focus_minutes", "The default for a plain timer. A pick suggests its size instead.", 5, 240)}
        {num("breakMinutes", "Break length (minutes)", "plan.break_minutes", "Offered when a session ends. 0 for none.", 5, 60)}
        <Field label="End sound" hint="A short sound with the desktop notification when a session ends.">
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

function ClientForm({ client: c, data, onSavedData }: { client: SettingsClient; data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const reached = data.dataverseReached;
  const [name, setName] = useState(c.setting.name ?? "");
  const [color, setColor] = useState(c.setting.color ?? "");
  const [browser, setBrowser] = useState(c.setting.browser);
  const [profile, setProfile] = useState(c.profile ?? "");
  const [open, setOpen] = useState(c.setting.openStates.join(", "));
  const [keep, setKeep] = useState(c.setting.follow);
  const { problems, status, save } = useSave(onSavedData);
  const f = `clients.${c.key}`;
  const info = data.browsers[browser];
  const profiles = info.profiles;
  return (
    <form
      className="set-form set-client"
      style={{ "--c": color ? (color.startsWith("#") ? color : `var(--client-${color})`) : "var(--client-none)" } as CSSProperties}
      onSubmit={(e) => {
        e.preventDefault();
        void save("client", { key: c.key, name, color, browser, profile, openStates: open.split(",").map((x) => x.trim()).filter(Boolean), follow: keep });
      }}
    >
      <h3>
        <span className="swatch" /> {c.setting.name ?? c.key}
      </h3>
      <div className="set-grid">
        <ReadOnly label="Dataverse nickname" value={c.dataverseName ?? c.key} where="The account's reporting nickname. Change it in Dataverse" />
        <ReadOnly label="Your DevOps identity" value={c.devopsEmail ?? (reached ? null : "unknown until Dataverse connects")} where="Account Worker record (DevOps email). Change it in Dataverse" />
        <Field label="Shown as" hint="Leave empty to show the Dataverse nickname.">
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
        <Field label="Open links in">
          <select
            value={browser}
            onChange={(e) => {
              setBrowser(e.target.value as typeof browser);
              setProfile("");
            }}
          >
            <option value="edge" disabled={!data.browsers.edge.found}>
              Edge{data.browsers.edge.found ? "" : " (not installed)"}
            </option>
            <option value="chromium" disabled={!data.browsers.chromium.found}>
              Chromium{data.browsers.chromium.found ? "" : " (not installed)"}
            </option>
          </select>
          <Problems all={problems} field={`${f}.browser`} />
        </Field>
        <Field label="Profile" hint={info.found ? "Profiles read from the browser (names only)." : "That browser isn't installed."}>
          <select value={profile} onChange={(e) => setProfile(e.target.value)} disabled={!info.found}>
            <option value="">None (default browser)</option>
            {profile && !profiles.some((x) => x.directory === profile) && <option value={profile}>{profile} (not found)</option>}
            {profiles.map((x) => (
              <option key={x.directory} value={x.directory}>
                {x.name} ({x.directory})
              </option>
            ))}
          </select>
          <Problems all={problems} field={`${f}.profile`} />
        </Field>
        <Field label="Followed" hint={followText(c.follow, data.planning.followGraceDays)}>
          <label className="set-check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} disabled={c.follow?.why === "internal" || c.follow?.why === "standing"} /> Keep following
          </label>
          <Problems all={problems} field={`${f}.follow`} />
        </Field>
        <Field label='States treated as open' hint="DevOps states this client still works in, though DevOps files them as done (e.g. Resolved). Applies on the next refresh.">
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
      {p.devops && p.devops.length > 0 && (
        <>
          <h3>DevOps per client</h3>
          <p className="muted">PATs live on each client's DevOps settings in Dataverse. Coopilot reads them only when it fetches, and never shows them.</p>
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
      <h3>Client secrets</h3>
      <p className="muted">Entered here, they go straight to the keyring (service coopilot). Coopilot never shows them again.</p>
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
      <span className="set-hint">{status ?? "Empties picks, drafts, unavailable time, flex sessions, loops, the timer and focused time. A full backup of the plan store is made first. Settings and calendars are not touched."}</span>
    </div>
  );
}

function DataSection(p: Props & { data: SettingsData }) {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="set-form">
      <div className="set-grid">
        <div className="set-field">
          <span className="set-label">Export the plan</span>
          <button
            type="button"
            className="mini"
            disabled={!p.data.data.planStore}
            onClick={async () => {
              try {
                const r = await call<{ path: string }>("data.export", {});
                setStatus(`Written to ${r.path}`);
              } catch (e) {
                setStatus(e instanceof Error ? e.message : "Export failed");
              }
            }}
          >
            Export as JSON
          </button>
          <span className="set-hint">{status ?? "Picks, drafts, unavailable time, flex sessions and loops. Local only."}</span>
        </div>
        <ReadOnly label="Config file" value={p.data.configPath} where="Backups are kept next to it in backups/ (the last 30)" />
        <ReadOnly label="Audit log" value="Not built yet" where="Waits for the write framework" />
        <ResetPlan disabled={!p.data.data.planStore} onDone={p.onSaved} />
      </div>
    </div>
  );
}
