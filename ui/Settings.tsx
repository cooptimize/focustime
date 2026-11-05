// Settings (step 6b): every setting FocusTime owns, read from and written to the same validated settings (a person's
// account, or the config file in the developer loop); each field saves itself (ui/settings/autosave.tsx). Values
// owned by Dataverse are shown read-only with where to change them. Secrets are entered in masked fields that go
// straight to the keyring; they are never shown again (only whether they are set, and an expiry date if entered).
import { AzureWriteLog, TeamsAccessLine, TeamsStatusLog, YouAccount } from "./Account.tsx";
import { responseLabel } from "../plan/rsvp.ts";
import { DevOpsWriteLog } from "./DevOpsWrite.tsx";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { SettingsClient, SettingsData, SourceSummary } from "../actions/types.ts";
import { AsksConnections, DeliveryChatField, DeliveryChatsProvider, MicrosoftPermissions } from "./settings/DeliveryChats.tsx";
import { AutoSaveProvider, SaveMark, useAutoSave, type AutoSave } from "./settings/autosave.tsx";
import { COLLAB_LENGTHS, TEXT_SIZES, THEME_NAMES, THEMES, type TextSize, type Theme } from "../config/schema.ts";
import { TEXT_SIZE_NAMES } from "./textsize.ts";
import type { ClientWork } from "../week/types.ts";
import type { FollowState } from "../week/follow.ts";
import { spanText, VIEW_RANGE_NAMES, VIEW_RANGES, WEEKDAY_KEYS, type ViewRange } from "../week/hours.ts";
import { call } from "./api.ts";
import type { AiView } from "../ai/view.ts";
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
import { usePhone } from "./viewport.ts";
import { PhoneReadOnly } from "./Phone.tsx";
import { deviceId, disablePush, enablePush, pushSupport, type PushStatus } from "./pwa.ts";
import { NOTICES_CHANGED } from "./Notices.tsx";
import { NEUTRAL_ZONE, userZone } from "../week/zone.ts";
import type { SetupStep, SetupView } from "../plan/setup.ts";
import type { FeedbackStatus } from "../actions/feedback-types.ts";

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
  ["ai", "AI"],
  ["connections", "Connections"],
  ["display", "Display"],
  ["data", "Data"],
  ["setup", "Setup"],
  ["about", "About"],
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number][0];

/** P1: the sections laid out for a big screen (a week of hours, the standing blocks grid, client tables, the logs) read on the phone; the rest are simple fields that work there. */
export const PHONE_READ_ONLY: ReadonlySet<SettingsSectionId> = new Set(["hours", "standing", "clients", "data"]);

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
  /** A setting that couldn't be saved after its form closed (said out loud, never dropped). */
  onNotice?: (message: string) => void;
  /** S1 (D451): opens first-run setup at a step (Settings > Setup runs it again; it edits these same settings). */
  onSetup?: (step: SetupStep) => void;
};

/** Where an app-level value is changed when there is no config file here (hosted, signed in, the demo). */
const ADMIN = "Set by your FocusTime admin";

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
  useEffect(() => {
    // One scroll for the whole page: a new section starts at its top.
    headRef.current?.closest(".settings")?.scrollTo({ top: 0 });
    headRef.current?.focus({ preventScroll: true });
  }, [props.section]);
  const saved = useCallback(
    (d: SettingsData) => {
      setData(d);
      props.onSaved();
    },
    [props.onSaved], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const title = SETTINGS_SECTIONS.find(([id]) => id === props.section)![1];
  const phone = usePhone();
  return (
    <AutoSaveProvider onNotice={props.onNotice}>
      {(leave) => (
    <main className="settings" aria-label="Settings">
      <nav className="set-nav" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map(([id, label]) => (
          <button key={id} type="button" className="set-tab" aria-current={props.section === id ? "page" : undefined} onClick={() => leave(() => props.onSection(id))}>
            {label}
          </button>
        ))}
        <button type="button" className="set-tab close" onClick={() => leave(props.onClose)} title="Back (Esc)">
          Back
        </button>
      </nav>
      <section className="set-body">
        <h2 ref={headRef} tabIndex={-1}>
          {title}
        </h2>
        {data && props.section !== "about" && props.section !== "setup" && <p className="muted set-path">Changes save as you make them, to {data.configPath}</p>}
        {error && <p className="field-problem">{error}</p>}
        {data && data.problems.length > 0 && props.section !== "connections" && props.section !== "data" && (
          <div className="config-banner" role="alert">
            <strong>{data.fromFile ? "The config file has problems, so only Connections and Data work here until it is fixed by hand." : "Your saved settings have problems, so only Connections and Data work here. Ask your FocusTime admin."}</strong>
            <ul>
              {data.problems.map((p) => (
                <li key={p.field}>
                  <code>{p.field}</code> {p.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {data && (phone && PHONE_READ_ONLY.has(props.section) ? (
          <PhoneReadOnly>
            <SectionBody {...props} data={data} onSavedData={saved} reload={reload} />
          </PhoneReadOnly>
        ) : (
          <SectionBody {...props} data={data} onSavedData={saved} reload={reload} />
        ))}
      </section>
    </main>
      )}
    </AutoSaveProvider>
  );
}

function SectionBody(p: Props & { data: SettingsData; onSavedData: (d: SettingsData) => void; reload: () => Promise<void> }) {
  const d = p.data;
  switch (p.section) {
    case "setup":
      return <SetupSection {...p} />;
    case "you":
      return (
        <>
        <YouAccount />
        <VmStartForm {...p} />
        {d.you && (
        <div className="set-grid">
          <ReadOnly label={d.fromFile ? "Email when signed out" : "Email"} value={d.you.email} where={d.fromFile ? "Used only when signed out ([dataverse] my_email in config.toml)" : "From your Microsoft sign-in"} />
          <ReadOnly label="Dataverse user" value={d.you.systemUserId ? "Found" : "Not found yet"} where="Change this in Dataverse" />
          <ReadOnly label="Environment" value={d.you.environmentUrl} where={d.fromFile ? "Set in config.toml ([dataverse] environment_url)" : ADMIN} />
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
        <DeliveryChatsProvider>
        <AsksForm {...p} />
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
        </DeliveryChatsProvider>
      );
    case "ai":
      return <AiForm {...p} />;
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

type FormProps = Props & { data: SettingsData; onSavedData: (d: SettingsData) => void };

/** A field that saves itself: its input (from `children`), "Saved" or "Couldn't save. Retry" by it, an error under it. */
function AutoField<V>({ a, k, label, hint, children }: { a: AutoSave<V>; k: keyof V; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      {children}
      <SaveMark s={a.status(k)} retry={() => a.commit(k)} />
    </Field>
  );
}

function HoursForm(p: FormProps & { reload: () => Promise<void> }) {
  const h = p.data.hours!;
  const a = useAutoSave({
    section: "hours",
    initial: { tz: userZone(h), lunch: h.lunch ? spanText(h.lunch) : "", ...(Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, h.weekdays[k].map(spanText).join(", ")])) as Record<(typeof WEEKDAY_KEYS)[number], string>) },
    payload: (v) => ({ timeZone: v.tz, lunch: v.lunch.replace(/\s+/g, ""), weekdays: Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, spansIn(v[k] ?? "")])) }),
    onSaved: p.onSavedData,
    label: (k) => (k === "tz" ? "Time zone" : k === "lunch" ? "Lunch" : `${DAY_NAMES[k as (typeof WEEKDAY_KEYS)[number]]} hours`),
  });
  return (
    <div className="set-form">
      <p className="muted">Like 09:00-17:00; a second span is an evening. Empty is a day off.</p>
      <div className="set-days">
        {WEEKDAY_KEYS.map((k) => (
          <AutoField key={k} a={a} k={k} label={DAY_NAMES[k]}>
            <input value={a.v[k]} placeholder="day off" onChange={(e) => a.set(k, e.target.value)} {...a.text(k)} />
          </AutoField>
        ))}
      </div>
      <div className="set-grid">
        <AutoField a={a} k="lunch" label="Lunch" hint="Like 12:00-12:30. Empty splits the day in the middle.">
          <input value={a.v.lunch} placeholder="none" onChange={(e) => a.set("lunch", e.target.value)} {...a.text("lunch")} />
        </AutoField>
        <AutoField a={a} k="tz" label="Time zone" hint="Where you work, as a Region/City name from the list.">
          <input value={a.v.tz} list="set-zones" onChange={(e) => a.set("tz", e.target.value)} {...a.text("tz")} />
          <datalist id="set-zones">
            {ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </AutoField>
      </div>
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
    </div>
  );
}

type StandingRow = { day: string; half: string; client: string };
function StandingForm(p: FormProps) {
  const a = useAutoSave({
    section: "standing",
    initial: { rows: p.data.standingBlocks.map((b): StandingRow => ({ day: b.day as string, half: b.half as string, client: b.clientKey })) },
    payload: (v) => ({ blocks: v.rows }),
    onSaved: p.onSavedData,
    label: () => "Standing blocks",
  });
  const rows = a.v.rows;
  const keys = p.data.clients.map((c) => c.key);
  const edit = (i: number, patch: Partial<StandingRow>) => a.change("rows", rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="set-form">
      <p className="muted">Shown when Dataverse has no focus block there.</p>
      {rows.map((r, i) => (
        <div key={i} className="set-row">
          <select value={r.day} onChange={(e) => edit(i, { day: e.target.value })} aria-label="Day">
            {["Mon", "Tue", "Wed", "Thu"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select value={r.half} onChange={(e) => edit(i, { half: e.target.value })} aria-label="Half">
            <option>AM</option>
            <option>PM</option>
          </select>
          <select value={r.client} onChange={(e) => edit(i, { client: e.target.value })} aria-label="Client">
            {[...new Set([r.client, ...keys])].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button type="button" className="mini quiet" onClick={() => a.change("rows", rows.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <span className="set-inline">
        <button type="button" className="mini" onClick={() => a.change("rows", [...rows, { day: "Mon", half: "AM", client: keys[0] ?? "Internal" }])}>
          Add a standing block
        </button>
        <SaveMark s={a.status("rows")} retry={() => a.commit("rows")} />
      </span>
    </div>
  );
}

const PLANNING_LABELS: Record<string, string> = {
  minS: "Shortest useful time, S", minM: "Shortest useful time, M", minL: "Shortest useful time, L", types: "Portfolio types", carryDays: "Carry-over",
  reminderOffsetMinutes: "Reminder", checkinReminderMinutes: "Check-in reminder", closeoutReminderMinutes: "Close out reminder", weekNudgeThu: "Thursday nudge",
  weekNudgeFri: "Friday nudge", weekNudgeMon: "Monday nudge", followGraceDays: "Keep following", focusMinutes: "Focus length", breakMinutes: "Break length", endSound: "End sound",
};

function PlanningForm(p: FormProps) {
  const pl = p.data.planning;
  const a = useAutoSave({
    section: "planning",
    initial: {
      types: pl.pickablePortfolioTypes.join(", "), minS: pl.minSizes.S, minM: pl.minSizes.M, minL: pl.minSizes.L, carryDays: pl.carryDays, reminderOffsetMinutes: pl.reminderOffsetMinutes,
      focusMinutes: pl.focusMinutes, breakMinutes: pl.breakMinutes, endSound: pl.endSound, followGraceDays: pl.followGraceDays, closeoutReminderMinutes: pl.closeoutReminderMinutes,
      checkinReminderMinutes: pl.checkinReminderMinutes, weekNudgeThu: pl.weekNudgeThu, weekNudgeFri: pl.weekNudgeFri, weekNudgeMon: pl.weekNudgeMon,
    },
    payload: (v) => ({
      pickablePortfolioTypes: v.types.split(",").map((x) => x.trim()).filter(Boolean),
      minSizes: { S: v.minS, M: v.minM, L: v.minL },
      carryDays: v.carryDays,
      reminderOffsetMinutes: v.reminderOffsetMinutes,
      focusMinutes: v.focusMinutes,
      breakMinutes: v.breakMinutes,
      endSound: v.endSound,
      followGraceDays: v.followGraceDays,
      closeoutReminderMinutes: v.closeoutReminderMinutes,
      checkinReminderMinutes: v.checkinReminderMinutes,
      weekNudgeThu: v.weekNudgeThu,
      weekNudgeFri: v.weekNudgeFri,
      weekNudgeMon: v.weekNudgeMon,
    }),
    onSaved: p.onSavedData,
    label: (k) => PLANNING_LABELS[k as string] ?? "Planning",
  });
  type NumKey = "minS" | "minM" | "minL" | "carryDays" | "reminderOffsetMinutes" | "focusMinutes" | "breakMinutes" | "followGraceDays" | "closeoutReminderMinutes" | "checkinReminderMinutes";
  const num = (k: NumKey, label: string, hint: string, step = 5, max = 480) => (
    <AutoField a={a} k={k} label={label} hint={hint}>
      <input type="number" min={0} max={max} step={step} value={a.v[k]} onChange={(e) => a.set(k, Number(e.target.value))} {...a.text(k)} />
    </AutoField>
  );
  return (
    <div className="set-form">
      <h3>Picks</h3>
      <div className="set-grid">
        {num("minS", "Shortest useful time, S (minutes)", "The least Timebox my day gives an S pick (S is 1h, M 2h, L 4h).")}
        {num("minM", "Shortest useful time, M (minutes)", "The same for M.")}
        {num("minL", "Shortest useful time, L (minutes)", "The same for L.")}
        <AutoField a={a} k="types" label="Portfolio types that can be picked" hint='Types above story level you pick directly, like "Recurring".'>
          <input value={a.v.types} onChange={(e) => a.set("types", e.target.value)} {...a.text("types")} />
        </AutoField>
        {num("carryDays", "Carry-over (days back)", "Unfinished picks offered again. 0 turns it off.", 1, 30)}
        {num("reminderOffsetMinutes", "Reminder (minutes after the day starts)", "Only when today isn't committed.", 5, 240)}
      </div>
      <h3>Check-in and Close out</h3>
      <div className="set-grid">
        {num("checkinReminderMinutes", "Check-in reminder (minutes after lunch)", "On a committed day. 0 is the end of lunch.", 5, 120)}
        {num("closeoutReminderMinutes", "Close out reminder (minutes before the day ends)", "Only if Close out isn't done.", 5, 120)}
      </div>
      <h3>Plan the week</h3>
      <div className="set-grid">
        {([
          ["weekNudgeThu", "Thursday nudge", "For next week. Empty turns it off."],
          ["weekNudgeFri", "Friday nudge", "For next week, if still not committed."],
          ["weekNudgeMon", "Monday nudge", "For this week, if still not committed."],
        ] as const).map(([k, label, hint]) => (
          <AutoField key={k} a={a} k={k} label={label} hint={hint}>
            <input type="time" value={a.v[k]} onChange={(e) => a.set(k, e.target.value)} {...a.text(k)} />
          </AutoField>
        ))}
      </div>
      <h3>Clients followed</h3>
      <div className="set-grid">{num("followGraceDays", "Keep following after focus time ends (days)", "Clients stay followed this long after focus time ends.", 1, 90)}</div>
      <h3>Plan ahead rituals</h3>
      <AheadRituals />
      <h3>Focus timer</h3>
      <div className="set-grid">
        {num("focusMinutes", "Focus length (minutes)", "The default for a plain timer. A pick suggests its size instead.", 5, 240)}
        {num("breakMinutes", "Break length (minutes)", "Offered when a session ends. 0 for none.", 5, 60)}
        <AutoField a={a} k="endSound" label="End sound" hint="With the notification when a session ends.">
          <label className="set-check">
            <input type="checkbox" checked={a.v.endSound} onChange={(e) => a.change("endSound", e.target.checked)} /> Play a sound
          </label>
        </AutoField>
      </div>
    </div>
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
function TimeboxForm(p: FormProps) {
  const t = p.data.timebox;
  const a = useAutoSave({
    section: "timebox",
    initial: { ...t },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: (k) => (k === "enabled" ? "Use timeboxing" : k === "outlookDefault" ? "Put on Outlook" : "Asking about my own timeboxes"),
  });
  return (
    <div className="set-form">
      <h3>Timeboxes</h3>
      <div className="set-grid">
        <AutoField a={a} k="enabled" label="Use timeboxing" hint="Off hides the time controls; timeboxes are kept.">
          <label className="set-check">
            <input type="checkbox" checked={a.v.enabled} onChange={(e) => a.change("enabled", e.target.checked)} /> Use timeboxing
          </label>
        </AutoField>
        <AutoField a={a} k="outlookDefault" label="Put on Outlook" hint="Every new event shows a preview first.">
          <label className="set-check">
            <input type="checkbox" checked={a.v.outlookDefault} onChange={(e) => a.change("outlookDefault", e.target.checked)} /> On by default
          </label>
        </AutoField>
        <AutoField a={a} k="confirmOwn" label="Changes to my own timebox events" hint="Off: no question; every change is still logged and can be undone.">
          <label className="set-check">
            <input type="checkbox" checked={!a.v.confirmOwn} onChange={(e) => a.change("confirmOwn", !e.target.checked)} /> Don't ask again for my own timeboxes
          </label>
        </AutoField>
      </div>
    </div>
  );
}

/** Settings > Planning > Help sessions (step 13): length, Teams, how many workdays "Needs help from…" searches. */
function CollabForm(p: FormProps) {
  const c = p.data.collab;
  const a = useAutoSave({
    section: "collab",
    initial: { meetingMinutes: c.meetingMinutes, teams: c.teams, daysAhead: c.daysAhead, exclude: [...c.exclude] },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: (k) => (k === "meetingMinutes" ? "Default length" : k === "teams" ? "Teams meeting" : k === "daysAhead" ? "Days to search" : "People to exclude"),
  });
  const [adding, setAdding] = useState("");
  const add = () => {
    if (!adding.trim()) return;
    a.change("exclude", [...a.v.exclude, adding.trim()]);
    setAdding("");
  };
  return (
    <div className="set-form">
      <h3>Help sessions</h3>
      <div className="set-grid">
        <AutoField a={a} k="meetingMinutes" label="Default length" hint="Where Needs help from… starts.">
          <select value={a.v.meetingMinutes} onChange={(e) => a.change("meetingMinutes", Number(e.target.value))}>
            {COLLAB_LENGTHS.map((m) => (
              <option key={m} value={m}>{m} minutes</option>
            ))}
          </select>
        </AutoField>
        <AutoField a={a} k="teams" label="Teams meeting" hint="You can turn it off per invite.">
          <label className="set-check">
            <input type="checkbox" checked={a.v.teams} onChange={(e) => a.change("teams", e.target.checked)} /> On by default
          </label>
        </AutoField>
        <AutoField a={a} k="daysAhead" label="Days to search" hint="Workdays from today, for items not pinned to a day.">
          <input type="number" min={1} max={10} step={1} value={a.v.daysAhead} onChange={(e) => a.set("daysAhead", Number(e.target.value))} {...a.text("daysAhead")} />
        </AutoField>
        <AutoField a={a} k="exclude" label="People to exclude" hint="Never suggested as helpers or as Who. By name or email.">
          <ul className="set-list">
            {a.v.exclude.map((x, i) => (
              <li key={`${x}:${i}`}>
                <span>{x}</span>
                <button type="button" className="mini quiet" aria-label={`Remove ${x}`} onClick={() => a.change("exclude", a.v.exclude.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ul>
          <span className="set-inline">
            <input value={adding} maxLength={200} placeholder="Name or email" aria-label="Add a person to exclude" onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }} />
            <button type="button" className="mini" disabled={!adding.trim()} onClick={add}>Add</button>
          </span>
        </AutoField>
        <ReadOnly label="Invites go only to" value={c.domains.join(", ") || "No domain yet"} where={p.data.fromFile ? "Set in config.toml ([collab] domains)" : ADMIN} />
      </div>
    </div>
  );
}

const FOCUS_LABELS: Record<string, string> = { sound: "Default sound", volume: "Volume", fadeSeconds: "Fade", onBreak: "When a break starts", pauseMedia: "Pause music", teamsStatus: "Teams status", plainFocusStatus: "Plain focus status", playlists: "Playlists" };

/** Settings > Focus (step 10): the default sound, volume, fade, what a break sounds like, media pause, playlists. */
function FocusForm(p: FormProps) {
  const f = p.data.focus;
  const a = useAutoSave({
    section: "focus",
    initial: { sound: f.sound, volume: f.volume, fadeSeconds: f.fadeSeconds, onBreak: f.onBreak, pauseMedia: f.pauseMedia, teamsStatus: f.teamsStatus, plainFocusStatus: f.plainFocusStatus, playlists: f.playlists as Playlist[] },
    payload: (v) => ({ ...v, playlists: v.playlists.filter((l) => l.name.trim() || l.url.trim()) }),
    onSaved: p.onSavedData,
    label: (k) => FOCUS_LABELS[k as string] ?? "Focus",
  });
  const v = a.v;
  const lists = v.playlists;
  const [media, setMedia] = useState<{ players: boolean; spotify: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);
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
  // A playlist row saves when you leave it, and only once its link is a good one (or empty).
  const editList = (i: number, patch: Partial<Playlist>) => a.set("playlists", lists.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const leaveList = () => {
    if (!lists.some((l) => badLink(l.url))) a.commit("playlists");
  };
  return (
    <div className="set-form">
      <h3>Teams status</h3>
      <p className="muted">Set while focus runs, back to automatic after. A change you make in Teams wins.</p>
      <div className="set-grid">
        <AutoField a={a} k="teamsStatus" label="Set Teams status during focus" hint="Logged in Data › Teams status log.">
          <label className="set-check">
            <input type="checkbox" checked={v.teamsStatus} onChange={(e) => a.change("teamsStatus", e.target.checked)} /> Set my status while I focus
          </label>
          <TeamsAccessLine />
        </AutoField>
        <AutoField a={a} k="plainFocusStatus" label="Plain focus sets" hint="Deep focus always sets Do not disturb.">
          <select value={v.plainFocusStatus} disabled={!v.teamsStatus} onChange={(e) => a.change("plainFocusStatus", e.target.value as "busy" | "none")}>
            <option value="busy">Busy</option>
            <option value="none">Nothing: leave my status alone</option>
          </select>
        </AutoField>
      </div>
      <h3>Sound while focusing</h3>
      <p className="muted">Plays only while focus runs. The focus screen can pick another.</p>
      <div className="set-grid">
        <AutoField a={a} k="sound" label="Default sound" hint={BINAURAL[v.sound as SoundKind] ? "Binaural beats need headphones." : "Brown is deep, pink brighter, rain a slow swell."}>
          <span className="set-inline">
            <select value={v.sound} onChange={(e) => a.change("sound", e.target.value as SoundKind)}>
              {SOUNDS.map((k) => (
                <option key={k} value={k}>{SOUND_NAMES[k]}</option>
              ))}
            </select>
            <button type="button" className="mini" disabled={v.sound === "none" || previewing} onClick={() => void preview()}>
              {previewing ? "Playing…" : "Try it"}
            </button>
          </span>
        </AutoField>
        <AutoField a={a} k="volume" label={`Volume (${v.volume})`} hint="0 to 100.">
          <input type="range" min={0} max={100} step={5} value={v.volume}
            onChange={(e) => { a.set("volume", Number(e.target.value)); sound.setVolume(Number(e.target.value)); }}
            onPointerUp={() => a.commit("volume")} onKeyUp={() => a.commit("volume")} onBlur={() => a.commit("volume")} />
        </AutoField>
        <AutoField a={a} k="fadeSeconds" label="Fade in and out (seconds)" hint="0 to 30.">
          <input type="number" min={0} max={30} step={1} value={v.fadeSeconds} onChange={(e) => a.set("fadeSeconds", Number(e.target.value))} {...a.text("fadeSeconds")} />
        </AutoField>
        <AutoField a={a} k="onBreak" label="When a break starts" hint="The sound stops either way.">
          <select value={v.onBreak} onChange={(e) => a.change("onBreak", e.target.value as "silence" | "chime")}>
            <option value="silence">Silence</option>
            <option value="chime">A soft chime</option>
          </select>
        </AutoField>
      </div>
      <h3>Music players</h3>
      <div className="set-grid">
        <AutoField
          a={a}
          k="pauseMedia"
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
            <input type="checkbox" checked={v.pauseMedia} disabled={media !== null && !media.players && !v.pauseMedia} onChange={(e) => a.change("pauseMedia", e.target.checked)} /> Pause music when focus ends
          </label>
        </AutoField>
      </div>
      <h3>Playlists</h3>
      <p className="muted">
        Keep up to {MAX_PLAYLISTS} Spotify or YouTube links. Choosing one on the focus screen opens it: {media?.spotify ? "Spotify links in the Spotify app" : "in your default browser (the Spotify app isn't installed)"}.
      </p>
      <ul className="set-playlists">
        {lists.map((l, i) => (
          <li key={i}>
            <input value={l.name} placeholder="Name" aria-label={`Playlist ${i + 1} name`} maxLength={60} onChange={(e) => editList(i, { name: e.target.value })} onBlur={leaveList} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), leaveList())} />
            <input value={l.url} placeholder="https://open.spotify.com/playlist/… or https://www.youtube.com/playlist?list=…" aria-label={`Playlist ${i + 1} link`} maxLength={500} aria-invalid={badLink(l.url)} onChange={(e) => editList(i, { url: e.target.value })} onBlur={leaveList} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), leaveList())} />
            <button type="button" className="mini quiet" onClick={() => a.change("playlists", lists.filter((_, j) => j !== i))} aria-label={`Remove playlist ${l.name || i + 1}`}>
              Remove
            </button>
            {badLink(l.url) && <span className="field-problem">Only Spotify or YouTube links (https)</span>}
          </li>
        ))}
      </ul>
      <span className="set-inline">
        {lists.length < MAX_PLAYLISTS && (
          <button type="button" className="mini" onClick={() => a.set("playlists", [...lists, { name: "", url: "" }])}>
            Add a playlist
          </button>
        )}
        <SaveMark s={a.status("playlists")} retry={() => a.commit("playlists")} />
      </span>
    </div>
  );
}

/** Settings > You (step 15.5, Q87): whether the morning box's Start starts the VM at once. */
function VmStartForm(p: FormProps) {
  const a = useAutoSave({ section: "vm", initial: { startWithoutAsking: p.data.vm.startWithoutAsking }, payload: (v) => v, onSaved: p.onSavedData, label: () => "Start my VM without asking" });
  return (
    <div className="set-grid set-vm-start">
      <AutoField a={a} k="startWithoutAsking" label="Start my VM without asking" hint={"Start in the morning prompt skips the preview."}>
        <label className="set-check">
          <input type="checkbox" checked={a.v.startWithoutAsking} onChange={(e) => a.change("startWithoutAsking", e.target.checked)} /> Start right away
        </label>
      </AutoField>
    </div>
  );
}

/** Settings > Roadmap (step 17): when a row reads Stalled or Watch. Whole numbers. */
function RoadmapForm(p: FormProps) {
  const r = p.data.roadmap;
  const a = useAutoSave({ section: "roadmap", initial: { stalledDays: r.stalledDays, watchWeeks: r.watchWeeks }, payload: (v) => v, onSaved: p.onSavedData, label: (k) => (k === "stalledDays" ? "Stalled after" : "Watch within") });
  return (
    <div className="set-form">
      <p className="muted">When a Roadmap row reads Stalled or Watch.</p>
      <div className="set-grid">
        <AutoField a={a} k="stalledDays" label="Stalled after (days)" hint="Days with no story change. 3 to 60.">
          <input type="number" min={3} max={60} step={1} value={a.v.stalledDays} onChange={(e) => a.set("stalledDays", Math.round(Number(e.target.value)))} {...a.text("stalledDays")} />
        </AutoField>
        <AutoField a={a} k="watchWeeks" label="Watch within (weeks)" hint="Forecast this close to the target. 0 to 4; 0 is never.">
          <input type="number" min={0} max={4} step={1} value={a.v.watchWeeks} onChange={(e) => a.set("watchWeeks", Math.round(Number(e.target.value)))} {...a.text("watchWeeks")} />
        </AutoField>
      </div>
    </div>
  );
}

/** The phrases the Requests rules use (the chats are read every 5 minutes for everyone, D514). Commas between phrases. */
const phrases = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
function AsksForm(p: FormProps) {
  const s = p.data.asks;
  const a = useAutoSave({
    section: "asks",
    initial: { requestPhrases: s.requestPhrases.join(", "), ackPhrases: s.ackPhrases.join(", "), promisePhrases: (s.promisePhrases ?? []).join(", ") },
    payload: (v) => ({ pollMinutes: s.pollMinutes, requestPhrases: phrases(v.requestPhrases), ackPhrases: phrases(v.ackPhrases), promisePhrases: phrases(v.promisePhrases) }),
    onSaved: p.onSavedData,
    label: (k) => (k === "requestPhrases" ? "Request phrases" : k === "promisePhrases" ? "Promise phrases" : "Acknowledgements"),
  });
  return (
    <details className="set-form set-asks">
      <summary>
        <strong>Requests</strong> <span className="muted">· the phrases · Inbox › Requests</span>
      </summary>
      <p className="muted">
        Each client chat registered below is read every 5 minutes in working hours, once for everyone who follows the client. A new message from someone outside Cooptimize becomes a request when it mentions a Cooptimizer, has a question mark, uses a request phrase, or has an attachment. One that is only an acknowledgement isn't. The request phrases used are those of the person whose sign-in read the chat. Your own messages with one of your promise phrases become your promises. With Allow AI on for a client (and Use AI), AI sorts these; without it, the rules alone decide.
      </p>
      <div className="set-grid">
        <AutoField a={a} k="requestPhrases" label="Request phrases" hint="Commas between them. Whole words, any case.">
          <input type="text" value={a.v.requestPhrases} onChange={(e) => a.set("requestPhrases", e.target.value)} {...a.text("requestPhrases")} />
        </AutoField>
        <AutoField a={a} k="ackPhrases" label="Acknowledgements" hint="A message that is only these (and emoji) is not a request.">
          <input type="text" value={a.v.ackPhrases} onChange={(e) => a.set("ackPhrases", e.target.value)} {...a.text("ackPhrases")} />
        </AutoField>
        <AutoField a={a} k="promisePhrases" label="Promise phrases" hint="In your own messages: commas between them. Inbox › Promises.">
          <input type="text" value={a.v.promisePhrases} onChange={(e) => a.set("promisePhrases", e.target.value)} {...a.text("promisePhrases")} />
        </AutoField>
      </div>
    </details>
  );
}

/** Settings > Notifications (step 15.5): a switch per kind, quiet hours, held during focus, a test. */
function NotifyForm(p: FormProps) {
  const n = p.data.notify;
  const a = useAutoSave({
    section: "notify",
    initial: { kinds: { ...n.kinds } as Record<NotifyKind, boolean>, quiet: n.quiet as QuietMode, quietPto: n.quietPto, pushDetails: n.pushDetails, asksThroughFocus: n.asksThroughFocus ?? false },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: (k) => (k === "kinds" ? "Notification" : k === "quiet" ? "Quiet hours" : k === "pushDetails" ? "Show details" : k === "asksThroughFocus" ? "Urgent requests during focus" : "Quiet on PTO days"),
  });
  const [test, setTest] = useState<string | null>(null);
  const group = (title: string, list: readonly NotifyKind[]) => (
    <fieldset className="set-notify-group">
      <legend>{title}</legend>
      {list.map((k) => (
        <label key={k} className="set-notify-row">
          <input type="checkbox" checked={a.v.kinds[k]} onChange={(e) => a.change("kinds", { ...a.v.kinds, [k]: e.target.checked })} />
          <span className="set-notify-name">{KIND_LABEL[k]}</span>
          <span className="set-hint">{KIND_HINT[k]}</span>
        </label>
      ))}
    </fieldset>
  );
  return (
    <div className="set-form">
      <p className="muted">Each is sent once; a click opens FocusTime there.</p>
      <div className="set-notify">
        {group("Ritual reminders", RITUAL_KINDS)}
        {group("While you focus", ["timer", "meeting"])}
        {group("Other", ["vm", "followups", "expiry", "asks"])}
      </div>
      <SaveMark s={a.status("kinds")} retry={() => a.commit("kinds")} />
      <AutoField a={a} k="asksThroughFocus" label="Urgent requests during focus" hint="Off: an urgent request waits until the focus session ends, with the others.">
        <label className="set-check">
          <input type="checkbox" checked={a.v.asksThroughFocus} onChange={(e) => a.change("asksThroughFocus", e.target.checked)} /> Let urgent asks through
        </label>
      </AutoField>
      <h3>Quiet hours</h3>
      <div className="set-grid">
        <AutoField a={a} k="quiet" label="Quiet" hint="Focus timer and meeting warnings still come.">
          <select value={a.v.quiet} onChange={(e) => a.change("quiet", e.target.value as QuietMode)}>
            <option value="outside_hours">Outside working hours</option>
            <option value="off">Never quiet</option>
          </select>
        </AutoField>
        <AutoField a={a} k="quietPto" label="Days off" hint="PTO days from Dataverse.">
          <label className="set-check">
            <input type="checkbox" checked={a.v.quietPto} onChange={(e) => a.change("quietPto", e.target.checked)} /> Quiet on PTO days
          </label>
        </AutoField>
      </div>
      <h3>During a focus session</h3>
      <p className="muted">The rest wait and come as one after the session.</p>
      <div className="set-actions-row">
        <button
          type="button"
          className="mini"
          onClick={() => {
            setTest("Sending…");
            void call("notify.test", {}).then(
              () => (setTest("Sent. Click it to come back here."), window.dispatchEvent(new Event(NOTICES_CHANGED))),
              (e: unknown) => setTest(e instanceof Error ? e.message : "Couldn't send it"),
            );
          }}
        >
          Send a test notification
        </button>
        {test && <span className="set-hint" role="status">{test}</span>}
      </div>
      <h3>On your devices</h3>
      <PushDevices />
      <AutoField a={a} k="pushDetails" label="Show details in notifications" hint="Off: a push says only what kind of thing it is (Follow-ups due). On: client names and work item titles too, on the lock screen.">
        <label className="set-check">
          <input type="checkbox" checked={a.v.pushDetails} onChange={(e) => a.change("pushDetails", e.target.checked)} /> Show details
        </label>
      </AutoField>
    </div>
  );
}

/**
 * P1: push, per device. "Notify this device" asks the browser's permission only when tapped; the list shows every
 * device with push on, with Remove. In-app notifications (⋯ › Notifications) work without any of this.
 */
function PushDevices() {
  const [st, setSt] = useState<PushStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void call<PushStatus>("push.status", {}).then(setSt, () => setSt({ available: false, reason: "Push status isn't available right now.", publicKey: null, devices: [] })), []);
  if (!st) return <p className="muted">Checking…</p>;
  const me = deviceId();
  const here = st.devices.some((d) => d.deviceId === me);
  const support = pushSupport();
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };
  const when = (iso: string) => new Date(iso.replace(/\[.*\]$/, "")).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div className="set-push">
      {!st.available ? (
        <p className="muted">{st.reason}</p>
      ) : support === "ios-install" ? (
        <p className="muted">On iPhone, add FocusTime to your home screen first (⋯ › Install app), then open it from there to turn this on.</p>
      ) : support === "unsupported" ? (
        <p className="muted">This browser can't get push notifications. In-app notifications still work.</p>
      ) : (
        <div className="set-actions-row">
          {here ? (
            <button type="button" className="mini" disabled={busy} onClick={() => void run(async () => setSt((await disablePush()) ?? st))}>
              Turn off for this device
            </button>
          ) : (
            <button
              type="button"
              className="mini primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await enablePush(st.publicKey!);
                  if (r.ok) (setSt(r.status), setMsg("This device gets notifications now. Send a test above to check."));
                  else setMsg(r.reason);
                })
              }
            >
              Notify this device
            </button>
          )}
        </div>
      )}
      {msg && <p className="set-hint" role="status">{msg}</p>}
      {st.devices.length > 0 && (
        <ul className="push-devices">
          {st.devices.map((d) => (
            <li key={d.deviceId}>
              <span className="pd-name">
                {d.label}
                {d.deviceId === me ? " (this device)" : ""}
              </span>
              <span className="set-hint">
                Added {when(d.createdAt)}
                {d.failedAt ? " · last one didn't arrive" : d.sentAt ? ` · last ${when(d.sentAt)}` : ""}
              </span>
              <button type="button" className="mini" disabled={busy} onClick={() => void run(async () => setSt(d.deviceId === me ? ((await disablePush()) ?? st) : await call<PushStatus>("push.remove", { deviceId: d.deviceId })))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RiskForm(p: FormProps) {
  const r = p.data.risk!;
  const a = useAutoSave({
    section: "risk",
    initial: { meetingWatchMinutes: r.meetingWatchMinutes, meetingAtRiskMinutes: r.meetingAtRiskMinutes, minFocusWindowMinutes: r.minFocusWindowMinutes },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: (k) => (k === "meetingWatchMinutes" ? "Watch at" : k === "meetingAtRiskMinutes" ? "At risk at" : "Shortest useful focus window"),
  });
  const num = (k: keyof typeof a.v, label: string, hint: string) => (
    <AutoField a={a} k={k} label={label} hint={hint}>
      <input type="number" min={0} max={600} step={5} value={a.v[k]} onChange={(e) => a.set(k, Number(e.target.value))} {...a.text(k)} />
    </AutoField>
  );
  return (
    <div className="set-form">
      <div className="set-grid">
        {num("meetingWatchMinutes", "Watch at (minutes of meetings)", "A block with this many minutes of meetings is marked Watch.")}
        {num("meetingAtRiskMinutes", "At risk at (minutes of meetings)", "At least the Watch value.")}
        {num("minFocusWindowMinutes", "Shortest useful focus window (minutes)", "With no free stretch this long, the block is at risk.")}
      </div>
    </div>
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
      <DeliveryChatField clientKey={c.key} clientName={c.setting.name ?? c.dataverseName ?? c.key} />
      <AllowAi c={c} d={d} onSavedData={p.onSavedData} />
      {c.devops && <HouseStyleField clientKey={c.key} name={c.setting.name ?? c.dataverseName ?? c.key} />}
    </div>
  );
}

/** AI-0: Allow AI for one client, off by default; a request about this client runs only with this and Use AI on. */
function AllowAi({ c, d, onSavedData }: { c: SettingsClient; d: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const name = c.setting.name ?? c.dataverseName ?? c.key;
  const a = useAutoSave({
    section: "ai",
    initial: { on: d.ai.allowedClients.includes(c.key) },
    payload: (v) => ({ allow: { client: c.key, on: v.on } }),
    onSaved: onSavedData,
    label: () => `${name}: Allow AI`,
  });
  return (
    <div className="set-form set-allow-ai">
      <AutoField a={a} k="on" label="Allow AI" hint={d.ai.use ? "Lets AI requests about this client send its data, one client at a time. Off by default." : "Off by default. Also needs Use AI on in Settings › AI."}>
        <label className="set-check">
          <input type="checkbox" role="switch" checked={a.v.on} onChange={(e) => a.change("on", e.target.checked)} /> Allow AI for {name}
        </label>
      </AutoField>
    </div>
  );
}

type HouseStyleData = { clientKey: string; text: string; computed: string | null; computedAt: string | null; learned: boolean; edited: string | null; read?: boolean | null };

/** DS-1: the client's house style for Draft stories: learned from its own features each week, or your own words. */
function HouseStyleField({ clientKey, name }: { clientKey: string; name: string }) {
  const [h, setH] = useState<HouseStyleData | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void call<HouseStyleData>("stories.house_style", { clientKey }).then(setH, () => setH(null)), [clientKey]);
  const run = async (input: Record<string, unknown>, action = "stories.house_style_save", done = "Saved") => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<HouseStyleData>(action, { clientKey, ...input });
      setH(r);
      setDraft(null);
      setMsg(action === "stories.house_style" && r.read === false ? "DevOps couldn't be read now; the style is unchanged" : done);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };
  if (!h) return null;
  const value = draft ?? h.text;
  return (
    <div className="set-form set-house-style">
      <label className="set-field">
        <span className="set-label">House style for Draft stories</span>
        <textarea aria-label={`${name}: house style`} rows={3} maxLength={1200} value={value} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== null && draft.trim() !== h.text && !busy && void run({ text: draft })} />
        <span className="set-hint">
          {h.edited ? "Your words, saved when you leave the box and used until you go back to the learned style." : h.learned ? `Learned from ${name}'s own features${h.computedAt ? `, ${new Date(h.computedAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}; learned again each week.` : "The default: too few features with stories to learn from yet."} Sent with every Draft stories request for {name}.
        </span>
      </label>
      <div className="set-row-actions">
        {h.edited && <button type="button" className="mini" disabled={busy} onClick={() => void run({ text: null }, undefined, "Back to the learned style")}>Use the learned style</button>}
        <button type="button" className="mini" disabled={busy} onClick={() => void run({ recompute: true }, "stories.house_style", "Learned again")}>Learn again now</button>
        {msg && <span className="set-hint" role="status">{msg}</span>}
      </div>
    </div>
  );
}

type AiTestResult = { ok: true; latencyMs: number; cost: string; model: string } | { ok: false; kind: string; message: string };

/** AI-0: Settings › AI: Use AI, the monthly limit and this month's spend, Test AI, what is sent, and the last 20 requests. */
function AiForm(p: FormProps) {
  const s = p.data.ai;
  const a = useAutoSave({
    section: "ai",
    initial: { use: s.use, monthlyCapUsd: s.monthlyCapUsd, draftMonths: s.draftMonths ?? 12 },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: (k) => (k === "use" ? "Use AI" : k === "draftMonths" ? "Draft stories looks back" : "Monthly limit"),
  });
  const [st, setSt] = useState<AiView | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AiTestResult | null>(null);
  const load = useCallback(() => call<AiView | null>("ai.status", {}).then(setSt, () => setSt(null)), []);
  useEffect(() => void load(), [load, p.data.ai.use, p.data.ai.monthlyCapUsd]);
  const nameOf = (k: string | null) => (k ? (p.data.clients.find((c) => c.key === k)?.setting.name ?? k) : "None");
  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await call<AiTestResult>("ai.test", {}));
    } catch (e) {
      setTest({ ok: false, kind: "provider", message: e instanceof Error ? e.message : "Test AI didn't run" });
    } finally {
      setTesting(false);
      void load();
    }
  };
  const notSetUp = st !== null && !st.setUp;
  return (
    <div className="set-form set-ai">
      <AutoField a={a} k="use" label="Use AI" hint="Off by default. Each client also needs Allow AI on, in Settings › Clients.">
        <label className="set-check">
          <input type="checkbox" role="switch" checked={a.v.use} onChange={(e) => a.change("use", e.target.checked)} /> Use AI
        </label>
      </AutoField>
      {(st === null || notSetUp) && (
        <p className="set-problem" role="status">
          AI isn't set up for this FocusTime yet{st?.provider === "off" ? ": it's turned off" : ""}. Everything else works without it.
        </p>
      )}
      <div className="set-ai-month">
        <span className="set-ai-label">This month</span>
        <strong>
          {st ? st.spentText : "$0"} of {st ? st.capText : `$${s.monthlyCapUsd}`}
        </strong>
        {st?.appReached && <span className="field-problem">FocusTime's AI budget for everyone is used up until next month.</span>}
      </div>
      <AutoField a={a} k="monthlyCapUsd" label="Monthly limit (US dollars)" hint="AI stops for you when you reach it, until next month. 0 to 1000.">
        <input type="number" min={0} max={1000} step={1} value={a.v.monthlyCapUsd} onChange={(e) => a.set("monthlyCapUsd", Number(e.target.value))} {...a.text("monthlyCapUsd")} />
      </AutoField>
      <AutoField a={a} k="draftMonths" label="Draft stories looks back (months)" hint="Examples come from the same client's features changed in this many months, 1 to 36.">
        <input type="number" min={1} max={36} step={1} value={a.v.draftMonths} onChange={(e) => a.set("draftMonths", Number(e.target.value))} {...a.text("draftMonths")} />
      </AutoField>
      <div className="set-ai-test">
        <button type="button" className="mini" disabled={testing} onClick={() => void runTest()}>
          {testing ? "Testing…" : "Test AI"}
        </button>
        {test && (test.ok ? <span className="set-ai-ok" role="status">OK · {(test.latencyMs / 1000).toFixed(1)} s · {test.cost}</span> : <span className="field-problem" role="status">{test.message}</span>)}
        <span className="set-hint">Sends one fixed request with no client data.</span>
      </div>
      <details className="set-ai-sent">
        <summary>What is sent</summary>
        <p className="muted">
          Only what a task needs, about one client at a time, and only for clients with Allow AI on. Before anything goes, FocusTime checks it: another client's name, project or work item, anything that looks like a key, token or password, your VM, or an email address from outside Cooptimize stops the request. The AI service is asked not to keep requests, and FocusTime's log keeps only the counts and the cost below, never the text.
        </p>
      </details>
      <h3 className="set-ai-h">Last 20 requests</h3>
      {st && st.recentText.length ? (
        <table className="set-ai-log">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Task</th>
              <th scope="col">Client</th>
              <th scope="col">Cost</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {st.recentText.map((r, i) => (
              <tr key={i}>
                <td>{fmtAiTime(r.at)}</td>
                <td>{AI_TASK_NAMES[r.task] ?? r.task}</td>
                <td>{nameOf(r.client)}</td>
                <td>{r.cost}</td>
                <td className={r.outcome === "OK" ? "" : "field-problem"}>{r.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No AI requests yet.</p>
      )}
    </div>
  );
}

/** Names for the task names the log keeps. */
const AI_TASK_NAMES: Record<string, string> = { test_ai: "Test AI", "asks.classify": "Sort an ask", "promises.extract": "Read a promise", "stories.draft": "Draft stories" };
const fmtAiTime = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function ClientForm({ client: c, data, onSavedData }: { client: SettingsClient; data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const reached = data.dataverseReached;
  const a = useAutoSave({
    section: "client",
    initial: { name: c.setting.name ?? "", color: c.setting.color ?? "", open: c.setting.openStates.join(", "), keep: c.setting.follow },
    payload: (v) => ({ key: c.key, name: v.name, color: v.color, openStates: v.open.split(",").map((x) => x.trim()).filter(Boolean), follow: v.keep }),
    onSaved: onSavedData,
    label: (k) => `${c.setting.name ?? c.key}: ${k === "name" ? "Shown as" : k === "color" ? "Color" : k === "open" ? "States treated as open" : "Keep following"}`,
  });
  const color = a.v.color;
  return (
    <div className="set-form set-client" style={{ "--c": color ? (color.startsWith("#") ? color : `var(--client-${color})`) : "var(--client-none)" } as CSSProperties}>
      <h3>
        <span className="swatch" /> {c.setting.name ?? c.key}
      </h3>
      <div className="set-grid">
        <ReadOnly label="Dataverse nickname" value={c.dataverseName ?? c.key} where="Change this in Dataverse" />
        <ReadOnly label="Your DevOps identity" value={c.devopsEmail ?? (reached ? null : "unknown until Dataverse connects")} where="Change this in Dataverse" />
        <AutoField a={a} k="name" label="Shown as" hint="Empty shows the Dataverse nickname.">
          <input value={a.v.name} placeholder={c.key} maxLength={60} onChange={(e) => a.set("name", e.target.value)} {...a.text("name")} />
        </AutoField>
        <fieldset className="set-choice palette">
          <legend>Color</legend>
          {data.palette.map((slot) => (
            <label key={slot} className="slot" title={slot}>
              <input type="radio" name={`color-${c.key}`} checked={color === slot} onChange={() => a.change("color", slot)} aria-label={slot} />
              <span className="slot-swatch" style={{ background: `var(--client-${slot})` }} />
            </label>
          ))}
          {color.startsWith("#") && <span className="set-hint">Custom color {color} (pick a palette color to use theme-aware colors)</span>}
          <SaveMark s={a.status("color")} retry={() => a.commit("color")} />
        </fieldset>
        <AutoField a={a} k="keep" label="Followed" hint={followText(c.follow, data.planning.followGraceDays)}>
          <label className="set-check">
            <input type="checkbox" checked={a.v.keep} onChange={(e) => a.change("keep", e.target.checked)} disabled={c.follow?.why === "internal" || c.follow?.why === "standing"} /> Keep following
          </label>
        </AutoField>
        <AutoField a={a} k="open" label="States treated as open" hint="Done states this client still works in, like Resolved.">
          <input value={a.v.open} placeholder="none" onChange={(e) => a.set("open", e.target.value)} {...a.text("open")} />
        </AutoField>
      </div>
    </div>
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
      <FeedbackRow />
      <MicrosoftPermissions />
      <AsksConnections />
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
        {busy ? "Checking…" : "Check and save"}
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

/**
 * S1 (D451): Settings > Setup. Run setup again opens the four screens on the same settings (nothing is duplicated:
 * each screen saves Working hours, Clients, Standing blocks or Connections as those sections do). Start over forgets
 * the setup record so the flow opens by itself again; dev and local only.
 */
function SetupSection(p: Props) {
  const [view, setView] = useState<SetupView | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [prod, setProd] = useState(true);
  useEffect(() => {
    call<SetupView>("setup.load", {}).then(setView, () => setView(null));
    // Start over is for dev and local only (the server refuses it on prod too).
    fetch("/version", { credentials: "same-origin" })
      .then((r) => r.json() as Promise<{ env?: string }>)
      .then((b) => setProd(b.env === "prod"), () => setProd(true));
  }, []);
  if (p.demo) return <p className="muted">Setup isn't part of the demo.</p>;
  const left = view?.line?.text;
  return (
    <div className="set-form">
      <p className="muted">The four first-run screens: your day, your clients, standing blocks and calendars. They change the same settings as the sections here.</p>
      <p>{view ? (left ? `${left}.` : "Every step is done.") : ""}</p>
      <div className="set-save">
        <button type="button" className="mini primary" onClick={() => p.onSetup?.(view?.line?.step ?? "day")}>
          {left ? "Finish setup" : "Run setup again"}
        </button>
        {left && (
          <button type="button" className="mini" onClick={() => p.onSetup?.("day")}>
            Run setup from the start
          </button>
        )}
        {!prod && (
        <button
          type="button"
          className="mini quiet"
          title="Forget your setup record, so the screens open by themselves next time (dev and local only)"
          onClick={async () => {
            try {
              setView(await call<SetupView>("setup.reset", {}));
              setStatus("Setup record cleared. The screens open by themselves the next time FocusTime opens");
            } catch (e) {
              setStatus(e instanceof Error ? e.message : "Not cleared");
            }
          }}
        >
          Start over
        </button>
        )}
        {status && (
          <span className="muted" role="status">
            {status}
          </span>
        )}
      </div>
    </div>
  );
}

/** Reset local plan (Q37): type "reset" to confirm; the server backs the store up first. */
function ResetPlan({ disabled, onDone }: { disabled: boolean; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="set-field">
      <span className="set-label">Reset my plan</span>
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

/** F1: Send feedback's setup, read only: feature #496 there, a Feature, and FocusTime's identity may add a story under it. */
function feedbackLine(st: FeedbackStatus): string {
  const s = st.setup;
  const mode = st.mode === "live" ? "" : " Preview only here: nothing is sent from this FocusTime.";
  if (s.state === "local") return "Preview only on this machine: ⋯ › Send feedback shows the story but sends nothing.";
  if (s.state === "ready") return `Set up: stories go under Feature #${s.parentId} (${s.parentTitle}) as ${s.storyType}.${mode}`;
  return `Not set up: ${s.reason}.${mode}`;
}

function FeedbackRow() {
  const [st, setSt] = useState<FeedbackStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (fresh: boolean) => call<FeedbackStatus>("feedback.status", fresh ? { fresh: true } : {}).then((r) => (setSt(r), setError(null)), (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't check"));
  useEffect(() => void load(false), []);
  return (
    <div className="set-write feedback-setup">
      <h3>Send feedback</h3>
      <p>{error ?? (st ? feedbackLine(st) : "Checking…")}</p>
      {st && st.setup.state !== "local" && (
        <button type="button" className="mini" onClick={() => void load(true)}>
          Check again
        </button>
      )}
      <p className="set-hint">{st ? `${st.destination}. ${st.sentToday} of ${st.limit} sent today.` : ""}</p>
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
      <p className="muted">Every change FocusTime made in other apps.</p>
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
