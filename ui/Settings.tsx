// Settings (step 6b): every setting FocusTime owns, read from and written to the same validated settings (a person's
// account, or the config file in the developer loop); each field saves itself (ui/settings/autosave.tsx). Values
// owned by Dataverse are shown read-only with where to change them. Secrets are entered in masked fields that go
// straight to the keyring; they are never shown again (only whether they are set, and an expiry date if entered).
import { FindItem } from "./settings/FindItem.tsx";
import { hoursText, STORY_SIZES, UNSIZED_CHOICES, unsizedText } from "../plan/estimate.ts";
import { AzureWriteLog, LoopSendsLog, TeamsAccessLine, TeamsStatusLog, VmStartForm, YouAccount } from "./Account.tsx";
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
import { notConnected, SOURCE_NAMES, sourceActions, sourceKey, sourceLabel, stateOf, type Calendar } from "./status.ts";
import { CalendarLinks } from "./settings/CalendarLinks.tsx";
import { shortDate } from "./labels.ts";
import { BINAURAL, MAX_PLAYLISTS, playlistLink, SOUND_NAMES, SOUNDS, type Playlist, type SoundKind } from "../plan/focussound.ts";
import { sound } from "./sound.ts";
import { KIND_HINT, KIND_LABEL, RITUAL_KINDS, type NotifyKind, type QuietMode } from "../plan/notify.ts";
import { DEFAULT_STATUS_TIMES, type StatusTimes } from "../plan/status-report.ts";
import { CLOSEOUT_MINUTES, DEFAULT_TEAMS_RHYTHM, HM, TEAMS_KIND_HINT, TEAMS_KIND_LABEL, TEAMS_KINDS, type TeamsKind, type TeamsRhythm } from "../plan/teams-rhythm.ts";
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
import { WRITES_HREF, type FeedbackStatus } from "../actions/feedback-types.ts";
import { ADMIN_UI_SECTIONS, AdminSection, isAdminSection, RETIRED_ADMIN_SECTIONS, useAdmin } from "./settings/Admin.tsx";
import { PanelShell, useNarrow, type RailGroup } from "./PanelShell.tsx";
import { useAppEnv, useDeveloperLoop } from "./appenv.ts";
import { resolveSettings, searchSettings, sectionOf, SECTIONS, settingsHref, SETTINGS_GROUPS, type SearchHit } from "./settings/registry.ts";
import { DemoSection } from "./settings/Demo.tsx";
import { DiagnosticsPanel } from "./settings/Diagnostics.tsx";
import { DeploySettings } from "./DeployItems.tsx";
import { Icon } from "./icons.tsx";

/** ST-1: every section id Settings opens (the registry's, then Admin's, for admins only). */
export const SETTINGS_SECTIONS: readonly (readonly [string, string])[] = [...SECTIONS.map((s) => [s.id, s.label] as const), ...ADMIN_UI_SECTIONS];
export type SettingsSectionId = string;

type Props = {
  /** The section in the address ("" is the rail: a list on the phone, Profile on a big screen); old ids still open. */
  section: string;
  /** A setting in the section (it scrolls into view with a brief highlight), or a client's key on its own page. */
  setting?: string | null;
  onSection: (s: string, setting?: string | null) => void;
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
  /** WK-5: the days Week shows, and the catch-up day's name in the loaded week ("Friday"). */
  weekDays: { catchUp: boolean; weekend: boolean };
  setWeekDays: (v: { catchUp?: boolean; weekend?: boolean }) => void;
  catchUpName: string;
  /** Step 15 (D272): demo mode and its switch. */
  demo: boolean;
  setDemo: (on: boolean) => void;
  /** Clears an override (hours.clear_day) and reloads. */
  runTime: (action: string, input: Record<string, unknown>) => Promise<boolean>;
  /** A setting that couldn't be saved after its form closed (said out loud, never dropped). */
  onNotice?: (message: string) => void;
  /** S1 (D451): opens first-run setup at a step (Settings > Profile > Setup runs it again; it edits these same settings). */
  onSetup?: (step: SetupStep) => void;
  /** ST-1: About's Open the Guide. */
  onGuide?: () => void;
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

/** ST-1: `sid` is the setting's id in the registry (ui/settings/registry.ts): search and deep links land on it. */
function Field({ label, children, hint, sid }: { label: string; children: ReactNode; hint?: ReactNode; sid?: string | undefined }) {
  return (
    <label className="set-field" data-setting={sid}>
      <span className="set-label">{label}</span>
      {children}
      {hint && <span className="set-hint">{hint}</span>}
    </label>
  );
}

function ReadOnly({ label, value, where, sid }: { label: string; value: ReactNode; where: string; sid?: string }) {
  return (
    <div className="set-field readonly" data-setting={sid}>
      <span className="set-label">{label}</span>
      <span className="set-value">{value || <span className="muted">not set</span>}</span>
      <span className="set-hint">{where}</span>
    </div>
  );
}

/** A group of settings under a heading, with the heading's own deep link when it is one setting. */
function Group({ title, sid, intro, children }: { title: string; sid?: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-section" data-setting={sid} aria-label={title}>
      <h3>{title}</h3>
      {intro && <p className="muted set-intro">{intro}</p>}
      {children}
    </section>
  );
}

/** ST-1: the rail's search. Finds any setting by its label, an old label or a keyword; Enter opens the first. */
function SettingsSearch({ q, setQ, hits, onGo }: { q: string; setQ: (q: string) => void; hits: SearchHit[]; onGo: (h: SearchHit) => void }) {
  return (
    <div className="ps-search">
      <input
        type="search"
        value={q}
        placeholder="Search settings"
        aria-label="Search settings"
        aria-controls="settings-search-results"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && q) {
            // The first Esc clears the search; the next closes Settings.
            e.preventDefault();
            e.nativeEvent.stopImmediatePropagation();
            setQ("");
          } else if (e.key === "Enter" && hits[0]) {
            e.preventDefault();
            onGo(hits[0]);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            document.querySelector<HTMLElement>("#settings-search-results a")?.focus();
          }
        }}
      />
    </div>
  );
}

function SearchResults({ q, hits, onGo }: { q: string; hits: SearchHit[]; onGo: (h: SearchHit) => void }) {
  return (
    <div id="settings-search-results" className="ps-results" role="region" aria-label="Search results" aria-live="polite">
      {hits.length === 0 ? (
        <p className="muted ps-none">Nothing called “{q.trim()}”.</p>
      ) : (
        hits.map((h) => (
          <a
            key={`${h.section}/${h.setting ?? ""}`}
            className="ps-item ps-hit"
            href={settingsHref(h.section, h.setting)}
            onClick={(e) => (e.preventDefault(), onGo(h))}
            onKeyDown={(e) => {
              const el = e.currentTarget;
              if (e.key === "ArrowDown") (e.preventDefault(), (el.nextElementSibling as HTMLElement | null)?.focus());
              if (e.key === "ArrowUp") (e.preventDefault(), ((el.previousElementSibling as HTMLElement | null) ?? document.querySelector<HTMLElement>(".ps-search input"))?.focus());
            }}
          >
            <span>{h.label}</span>
            <span className="ps-hint">
              {h.where}
              {h.matched ? ` · was “${h.matched}”` : ""}
            </span>
          </a>
        ))
      )}
    </div>
  );
}

/** The section and setting an address opens: old ids mapped; "" is the rail (a list on the phone, Profile otherwise). */
function placeOf(section: string, setting: string | null | undefined, list: boolean, demo: boolean, admin: boolean | null): { current: string | null; setting: string | null } {
  if (section === "") return { current: list ? null : "you", setting: null };
  // TP-1b: a retired Admin page: Admin's first page, or Profile for someone who isn't an admin.
  if (RETIRED_ADMIN_SECTIONS.includes(section)) return { current: admin === false ? "you" : ADMIN_UI_SECTIONS[0][0], setting: null };
  if (isAdminSection(section)) return { current: section, setting: null };
  const r = resolveSettings(section, setting);
  if (!r || (sectionOf(r.section)?.demoOnly && !demo)) return { current: "you", setting: null };
  return { current: r.section, setting: r.setting };
}

export function Settings(props: Props) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // A jump to a setting is owed once, until it lands or the person moves on (see the effect below).
  const jumpDue = useRef(false);
  const phone = usePhone();
  const list = useNarrow() || phone;
  const admin = useAdmin();
  const devLoop = useDeveloperLoop();
  const { current, setting } = placeOf(props.section, props.setting, list, props.demo, admin);
  const reload = useCallback(async () => {
    try {
      setData(await call<SettingsData>("settings.load", {}));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settings could not load");
    }
  }, []);
  // Each section reads fresh data, so team values an admin just changed (here or elsewhere) show.
  useEffect(() => {
    void reload();
  }, [reload, current]);
  // Each jump is owed once. The person going anywhere else first (a click, a key, the focus moving) cancels it, so it
  // never takes the focus back; this effect runs after PanelShell's own focus on the section's heading.
  useEffect(() => {
    if (!setting || current === "client") return;
    jumpDue.current = true;
    const moved = () => void (jumpDue.current = false);
    for (const e of ["focusin", "pointerdown", "keydown"]) document.addEventListener(e, moved, true);
    return () => {
      for (const e of ["focusin", "pointerdown", "keydown"]) document.removeEventListener(e, moved, true);
    };
  }, [current, setting]);
  // A deep link to one setting: into view with a brief highlight, focus on its first control. Waits for the section's
  // data the first time; a later reload of that data (a save, a late response) doesn't do it again.
  useEffect(() => {
    if (!data || !setting || current === "client") return;
    const t = setTimeout(() => {
      if (!jumpDue.current) return;
      const el = document.querySelector<HTMLElement>(`.ps-body [data-setting="${CSS.escape(setting)}"]`);
      if (!el) return;
      jumpDue.current = false;
      el.scrollIntoView?.({ block: "start" });
      el.classList.remove("ps-flash");
      void el.offsetWidth;
      el.classList.add("ps-flash");
      el.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea, button:not([disabled]), a[href]")?.focus({ preventScroll: true });
      setTimeout(() => el.classList.remove("ps-flash"), 2200);
    }, 60);
    return () => clearTimeout(t);
  }, [data, current, setting]);
  const saved = useCallback(
    (d: SettingsData) => {
      setData(d);
      props.onSaved();
    },
    [props.onSaved], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const inAdmin = current !== null && isAdminSection(current);
  const def = current ? sectionOf(current) : undefined;
  const client = current === "client" ? (data?.clients.find((c) => c.key === setting) ?? null) : null;
  const clientName = (c: SettingsClient) => c.setting.name ?? c.dataverseName ?? c.key;
  const title = inAdmin ? `Admin › ${ADMIN_UI_SECTIONS.find(([id]) => id === current)![1]}` : current === "client" ? (client ? clientName(client) : (setting ?? "Client")) : (def?.label ?? "Settings");
  const description = inAdmin ? "Team settings for everyone in FocusTime. Changes save as you make them and are logged in Admin › Audit." : def?.description;
  const hits = q.trim() ? searchSettings(q, { demo: props.demo, dev: devLoop }) : [];
  const groups: RailGroup[] = [
    ...SETTINGS_GROUPS.map(([g, label]) => ({
      id: g,
      label,
      items: SECTIONS.filter((s) => s.group === g && !s.parent && (!s.demoOnly || props.demo)).map((s) => ({ id: s.id, label: s.label, href: settingsHref(s.id) })),
    })),
    ...(admin ? [{ id: "admin", label: "Admin", items: ADMIN_UI_SECTIONS.map(([id, label]) => ({ id, label, href: settingsHref(id) })) }] : []),
  ];
  return (
    <AutoSaveProvider onNotice={props.onNotice}>
      {(leave) => {
        const go = (section: string, s?: string | null) => leave(() => (setQ(""), props.onSection(section, s ?? null)));
        return (
          <PanelShell
            name="Settings"
            className="settings"
            groups={groups}
            current={current}
            railCurrent={current === "client" ? "clients" : current}
            onPick={(id) => go(id)}
            onClose={() => leave(props.onClose)}
            onBack={current === "client" ? () => go("clients") : list && current !== null ? () => go("") : null}
            backLabel={current === "client" ? "Clients" : "Settings"}
            title={title}
            description={description}
            railTop={<SettingsSearch q={q} setQ={setQ} hits={hits} onGo={(h) => go(h.section, h.setting)} />}
            railOverride={q.trim() ? <SearchResults q={q} hits={hits} onGo={(h) => go(h.section, h.setting)} /> : undefined}
            phone={list}
            pageKey={`${current}/${current === "client" ? setting : ""}`}
          >
            {current !== null && (
              <>
                {error && <p className="field-problem">{error}</p>}
                {data && !inAdmin && data.problems.length > 0 && current !== "connections" && current !== "devops" && current !== "data" && current !== "activity" && (
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
                {inAdmin ? (
                  <AdminSection id={current as Parameters<typeof AdminSection>[0]["id"]} admin={admin} />
                ) : (
                  data &&
                  (phone && def?.phoneReadOnly ? (
                    <PhoneReadOnly line="Changing these works best on a bigger screen">
                      <SectionBody {...props} section={current} data={data} onSavedData={saved} reload={reload} client={client} go={go} />
                    </PhoneReadOnly>
                  ) : (
                    <SectionBody {...props} section={current} data={data} onSavedData={saved} reload={reload} client={client} go={go} />
                  ))
                )}
              </>
            )}
          </PanelShell>
        );
      }}
    </AutoSaveProvider>
  );
}

type BodyProps = Props & { section: string; data: SettingsData; onSavedData: (d: SettingsData) => void; reload: () => Promise<void>; client: SettingsClient | null; go: (section: string, setting?: string | null) => void };

function SectionBody(p: BodyProps) {
  const d = p.data;
  const dev = useDeveloperLoop();
  switch (p.section) {
    default:
      return null;
    case "you":
      return (
        <>
          <YouAccount part="account" />
          {d.you && (
            <div className="set-grid">
              <ReadOnly sid="email" label={d.fromFile ? "Email when signed out" : "Email"} value={d.you.email} where={d.fromFile ? "Used only when signed out ([dataverse] my_email in config.toml)" : "From your Microsoft sign-in"} />
              <ReadOnly sid="dataverse-user" label="Dataverse user" value={d.you.systemUserId ? "Found" : "Not found yet"} where="Change this in Dataverse" />
              <ReadOnly sid="environment" label="Dataverse environment" value={d.you.environmentUrl} where={d.fromFile ? "Set in config.toml ([dataverse] environment_url)" : ADMIN} />
            </div>
          )}
          <p className="muted set-intro">
            Your settings save as you change them, to {d.configPath}. Your time zone is under{" "}
            <a href={settingsHref("hours", "time-zone")} onClick={(e) => (e.preventDefault(), p.go("hours", "time-zone"))}>
              Working hours
            </a>
            .
          </p>
          <Group title="Setup" sid="setup">
            <SetupSection {...p} />
          </Group>
        </>
      );
    case "hours":
      return (
        <>
          {d.hours && <HoursForm {...p} />}
          <Group title="Standing blocks" sid="standing-blocks" intro="Shown when Dataverse has no focus block there.">
            <StandingForm {...p} />
          </Group>
        </>
      );
    case "planning":
      return (
        <>
          <GuidanceForm {...p} />
          <PlanningForm {...p} />
          <TimeboxForm {...p} />
          <CollabForm {...p} />
          <RiskForm {...p} />
        </>
      );
    case "focus":
      return (
        <>
          <FocusTimerForm {...p} />
          <FocusForm {...p} />
        </>
      );
    case "notifications":
      return <NotifyForm {...p} />;
    case "ahead":
      return <RoadmapForm {...p} />;
    case "clients":
      return <ClientList {...p} />;
    case "client":
      return p.client ? (
        <DeliveryChatsProvider>
          <ClientCard c={p.client} d={d} p={p} />
        </DeliveryChatsProvider>
      ) : <p className="muted">This client isn't one of yours. <a href={settingsHref("clients")} onClick={(e) => (e.preventDefault(), p.go("clients"))}>See your clients</a>.</p>;
    case "chats":
      return (
        <DeliveryChatsProvider>
          <AsksForm {...p} />
          <div data-setting="chats-read">
            <AsksConnections />
          </div>
        </DeliveryChatsProvider>
      );
    case "ai":
      return (
        <>
          <AiForm {...p} />
          <Group title="Assistant" sid="assistant-history">
            <div className="set-grid">
              <ClearAssistant />
            </div>
          </Group>
        </>
      );
    case "connections":
      return <Connections {...p} />;
    case "devops":
      return <DevOpsSection {...p} />;
    case "display":
      return (
        <div className="set-grid">
          <fieldset className="set-choice" data-setting="theme">
            <legend>Theme</legend>
            {THEMES.map((t) => (
              <label key={t}>
                <input type="radio" name="theme" checked={p.theme === t} onChange={() => p.setTheme(t)} /> {THEME_NAMES[t]}
              </label>
            ))}
            <span className="set-hint">Applies at once.</span>
          </fieldset>
          <fieldset className="set-choice" data-setting="text-size">
            <legend>Text size</legend>
            {TEXT_SIZES.map((s) => (
              <label key={s}>
                <input type="radio" name="text-size" checked={p.textSize === s} onChange={() => p.setTextSize(s)} /> {TEXT_SIZE_NAMES[s]}
              </label>
            ))}
            <span className="set-hint">Ctrl + and Ctrl − change it; Ctrl 0 resets.</span>
          </fieldset>
          <fieldset className="set-choice" data-setting="timelines">
            <legend>Timelines</legend>
            {VIEW_RANGES.map((r) => (
              <label key={r}>
                <input type="radio" name="range" checked={p.viewRange === r} onChange={() => p.setViewRange(r)} /> {VIEW_RANGE_NAMES[r]}
              </label>
            ))}
            <span className="set-hint">The default. V on Week changes it until you close FocusTime.</span>
          </fieldset>
          <fieldset className="set-choice" data-setting="personal-events">
            <legend>Personal events</legend>
            <label>
              <input type="checkbox" checked={p.showPersonal} onChange={(e) => p.setShowPersonal(e.target.checked)} /> Show personal events on Week and Today
            </label>
            <span className="set-hint">Hidden ones still count in risk and free time. G switches it.</span>
          </fieldset>
          <fieldset className="set-choice" data-setting="week-days">
            <legend>Days on Week</legend>
            <label>
              <input type="checkbox" checked={p.weekDays.catchUp} onChange={(e) => p.setWeekDays({ catchUp: e.target.checked })} /> Show {p.catchUpName}
            </label>
            <label>
              <input type="checkbox" checked={p.weekDays.weekend} onChange={(e) => p.setWeekDays({ weekend: e.target.checked })} /> Show weekend
            </label>
            <span className="set-hint">With Show weekend on, weekend days show when something is on them (or always, with Every weekend day in Week's ⋯). A hidden day with to-dos or promises due, or today, gets a note on Week with Show. Day still steps through every day.</span>
          </fieldset>
          <fieldset className="set-choice" data-setting="reduce-motion">
            <legend>Motion</legend>
            <label>
              <input type="checkbox" checked={p.reduceMotion} onChange={(e) => p.setReduceMotion(e.target.checked)} /> Reduce motion
            </label>
            <span className="set-hint">No opening or Close out animation; Lumen stays still.</span>
          </fieldset>
        </div>
      );
    case "activity":
      return <ActivitySection {...p} />;
    case "data":
      return <DataSection {...p} />;
    case "about":
      // Step 17.5: the lockup, the version and the credit line.
      return (
        <div className="brand-about">
          <Lockup width={320} />
          <p data-setting="version">Version {APP_VERSION}</p>
          <p className="set-hint">FocusTime is made by Cooptimize, for planning a week of client work.</p>
          <div className="set-grid">
            <div className="set-field" data-setting="guide">
              <span className="set-label">Guide</span>
              <button type="button" className="mini" onClick={() => p.onGuide?.()}>
                Open the Guide
              </button>
              <span className="set-hint">How FocusTime works, the keys and the questions people ask.</span>
            </div>
            {dev && (
              <div className="set-field" data-setting="style-guide">
                <span className="set-label">Style guide</span>
                <a href="/styleguide" target="_blank" rel="noopener">
                  Open the style guide
                </a>
                <span className="set-hint">Tokens and components in each theme (developer loop).</span>
              </div>
            )}
          </div>
        </div>
      );
  }
}

/** "09:00-17:00, 20:00-22:00" ⇄ spans. */
const spansIn = (s: string) => s.split(/[,;]/).map((x) => x.replace(/\s+/g, "")).filter(Boolean);

type FormProps = Props & { data: SettingsData; onSavedData: (d: SettingsData) => void };

/** A field that saves itself: its input (from `children`), "Saved" or "Couldn't save. Retry" by it, an error under it. */
/** ST-1: a field's key → its setting id in the registry, where the two differ only in name. */
const SID: Record<string, string> = {
  lunch: "lunch", tz: "time-zone", draftStories: "break-down-offered", readinessNudges: "readiness-nudges", carryDays: "carry-over",
  reminderOffsetMinutes: "plan-reminder", devopsOnDone: "devops-on-done", progressOffer: "progress-offer", suggest: "suggest-empty-blocks", checkinReminderMinutes: "checkin-reminder", closeoutReminderMinutes: "closeout-reminder",
  followGraceDays: "follow-grace", focusMinutes: "focus-length", breakMinutes: "break-length", endSound: "end-sound", enabled: "timeboxing", outlookDefault: "outlook-default",
  confirmOwn: "confirm-own", meetingMinutes: "help-length", teams: "help-teams", daysAhead: "help-days", exclude: "exclude", teamsStatus: "teams-status",
  plainFocusStatus: "plain-focus-status", sound: "sound", volume: "volume", fadeSeconds: "fade", onBreak: "on-break", pauseMedia: "pause-media", staleWeeks: "stale-weeks",
  stalledDays: "stalled-days", watchWeeks: "watch-weeks", requestPhrases: "request-phrases", ackPhrases: "ack-phrases", promisePhrases: "promise-phrases",
  status: "status-report-times", asksThroughFocus: "urgent-during-focus", quiet: "quiet", quietPto: "quiet-pto", pushDetails: "push-details", teamsMessages: "teams-messages", fromTestSite: "from-test-site",
  draftMonths: "draft-months", startWithoutAsking: "vm-start",
};

function AutoField<V>({ a, k, label, hint, children, sid }: { a: AutoSave<V>; k: keyof V; label: string; hint?: ReactNode; children: ReactNode; sid?: string | undefined }) {
  return (
    <Field label={label} hint={hint} sid={sid ?? SID[String(k)]}>
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
      <p className="muted set-intro">Like 09:00-17:00; a second span is an evening. Empty is a day off.</p>
      <div className="set-days" data-setting="weekdays">
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
      <h3 data-setting="one-day-changes">One-day changes</h3>
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
  minS: "Shortest useful time, S", minM: "Shortest useful time, M", minL: "Shortest useful time, L", carryDays: "Carry-over",
  unsizedMinutes: "Count unsized work as", reminderOffsetMinutes: "Reminder", checkinReminderMinutes: "Check-in reminder", closeoutReminderMinutes: "Close out reminder", weekNudgeThu: "Thursday nudge",
  weekNudgeFri: "Friday nudge", weekNudgeMon: "Monday nudge", followGraceDays: "Keep following", focusMinutes: "Focus length", breakMinutes: "Break length", endSound: "End sound", devopsOnDone: "When I tick a story", progressOffer: "Offer DevOps updates at end of day", suggest: "Suggest work for empty blocks",
};

/** The [plan] keys a form edits: each form saves only its own (the server takes any subset). */
function usePlan<K extends keyof PlanValues>(p: FormProps, keys: readonly K[]) {
  const pl = p.data.planning;
  const all: PlanValues = {
    unsizedMinutes: pl.sizes.unsized, minS: pl.minSizes.S, minM: pl.minSizes.M, minL: pl.minSizes.L, carryDays: pl.carryDays, reminderOffsetMinutes: pl.reminderOffsetMinutes,
    focusMinutes: pl.focusMinutes, breakMinutes: pl.breakMinutes, endSound: pl.endSound, devopsOnDone: pl.devopsOnDone, progressOffer: pl.progressOffer, suggest: pl.suggest !== false, followGraceDays: pl.followGraceDays, closeoutReminderMinutes: pl.closeoutReminderMinutes,
    checkinReminderMinutes: pl.checkinReminderMinutes, weekNudgeThu: pl.weekNudgeThu, weekNudgeFri: pl.weekNudgeFri, weekNudgeMon: pl.weekNudgeMon,
  };
  return useAutoSave({
    section: "planning",
    initial: Object.fromEntries(keys.map((k) => [k, all[k]])) as Pick<PlanValues, K>,
    payload: (v) => {
      const { minS, minM, minL, ...rest } = v as Partial<PlanValues>;
      return { ...rest, ...(minS !== undefined ? { minSizes: { S: minS, M: minM, L: minL } } : {}) };
    },
    onSaved: p.onSavedData,
    label: (k) => PLANNING_LABELS[k as string] ?? "Planning",
  });
}
type PlanValues = {
  unsizedMinutes: number; minS: number; minM: number; minL: number; carryDays: number; reminderOffsetMinutes: number; focusMinutes: number; breakMinutes: number; endSound: boolean;
  devopsOnDone: "ask" | "never"; progressOffer: boolean; suggest: boolean; followGraceDays: number; closeoutReminderMinutes: number; checkinReminderMinutes: number; weekNudgeThu: string; weekNudgeFri: string; weekNudgeMon: string;
};
type NumKey = "minS" | "minM" | "minL" | "carryDays" | "reminderOffsetMinutes" | "focusMinutes" | "breakMinutes" | "followGraceDays" | "closeoutReminderMinutes" | "checkinReminderMinutes";
function numField<V>(a: AutoSave<V>, k: NumKey & keyof V, label: string, hint: string, step = 5, max = 480) {
  const v = a.v as unknown as Record<NumKey, number>;
  return (
    <AutoField a={a} k={k} label={label} hint={hint}>
      <input type="number" min={0} max={max} step={step} value={v[k]} onChange={(e) => a.set(k, Number(e.target.value) as never)} {...a.text(k)} />
    </AutoField>
  );
}

/** ST-1: Today and Week's to-dos, rituals and nudges (the focus timer is under Focus, following under Clients). */
function PlanningForm(p: FormProps) {
  const a = usePlan(p, ["unsizedMinutes", "minS", "minM", "minL", "carryDays", "suggest", "reminderOffsetMinutes", "devopsOnDone", "progressOffer", "checkinReminderMinutes", "closeoutReminderMinutes", "weekNudgeThu", "weekNudgeFri", "weekNudgeMon"] as const);
  return (
    <>
      <Group title="To-dos">
        <div className="set-grid">
          <AutoField a={a} k="unsizedMinutes" sid="count-unsized" label="Count unsized work as" hint="Used wherever a to-do or story has no size yet, in every fit and budget. Nothing is written to DevOps.">
            <span className="set-unsized">
              <select aria-label="Count unsized work as" value={a.v.unsizedMinutes} onChange={(e) => a.change("unsizedMinutes", Number(e.target.value))}>
                {UNSIZED_CHOICES.map((m) => (
                  <option key={m} value={m}>{unsizedText({ ...p.data.planning.sizes, unsized: m })}</option>
                ))}
              </select>
              <span className="set-hint" data-size-scale>{STORY_SIZES.map((z) => `${z} ${p.data.planning.sizes[z] < 60 ? `${p.data.planning.sizes[z]} min` : hoursText(p.data.planning.sizes[z])}`).join(" · ")}</span>
            </span>
          </AutoField>
        </div>
        <div className="set-grid" data-setting="shortest-useful-time">
          {numField(a, "minS", "Shortest useful time, S (minutes)", "The least Timebox my day gives an S to-do (S is 1h, M 2h, L 4h).")}
          {numField(a, "minM", "Shortest useful time, M (minutes)", "The same for M.")}
          {numField(a, "minL", "Shortest useful time, L (minutes)", "The same for L.")}
        </div>
        <div className="set-grid">
          {numField(a, "carryDays", "Carry-over (days back)", "Unfinished to-dos offered again. 0 turns it off.", 1, 30)}
        </div>
        <AutoField a={a} k="suggest" label="Suggest work for empty blocks" hint="Today's and your next working day's empty blocks offer to-dos: unfinished ones first, then your backlog. Nothing is planned until you keep it. Also in Week's and Day's ⋯ as Suggestions.">
          <label className="set-check">
            <input type="checkbox" checked={a.v.suggest} onChange={(e) => a.change("suggest", e.target.checked)} /> Suggest
          </label>
        </AutoField>
        <AutoField a={a} k="devopsOnDone" label="When I tick a story" hint="Ask opens Wrap it up: Finished or Made progress, a comment, and one preview of what goes to DevOps. Only for items you can change, on clients with DevOps writes. Nothing is written without Confirm.">
          <div className="set-radios" role="radiogroup" aria-label="When I tick a story">
            <label className="set-check">
              <input type="radio" name="devops-on-done" checked={a.v.devopsOnDone === "ask"} onChange={() => a.change("devopsOnDone", "ask")} /> Ask (Wrap it up)
            </label>
            <label className="set-check">
              <input type="radio" name="devops-on-done" checked={a.v.devopsOnDone === "never"} onChange={() => a.change("devopsOnDone", "never")} /> Always skip DevOps
            </label>
          </div>
        </AutoField>
        <AutoField a={a} k="progressOffer" label="Offer DevOps updates at end of day" hint="After the end of day check-in: Remaining Work where the process has it, else a short comment. Always previewed; nothing is written without Confirm.">
          <label className="set-check">
            <input type="checkbox" checked={a.v.progressOffer} onChange={(e) => a.change("progressOffer", e.target.checked)} /> Offer
          </label>
        </AutoField>
      </Group>
      <Group title="Reminders" intro="Each comes as a notification; switch the kinds in Notifications.">
        <div className="set-grid">
          {numField(a, "reminderOffsetMinutes", "Add work reminder (minutes after the day starts)", "Only while today has no to-dos.", 5, 240)}
          {numField(a, "checkinReminderMinutes", "Midday check-in reminder (minutes after lunch)", "On a day with to-dos. 0 is the end of lunch.", 5, 120)}
          {numField(a, "closeoutReminderMinutes", "Close out reminder (minutes before the day ends)", "Only if Close out isn't done.", 5, 120)}
        </div>
      </Group>
      <Group title="Week nudges" sid="week-nudges" intro="Empty turns a nudge off.">
        <div className="set-grid">
          {([
            ["weekNudgeThu", "Thursday", "For next week."],
            ["weekNudgeFri", "Friday", "For next week, if nothing is on it yet."],
            ["weekNudgeMon", "Monday", "For this week, if nothing is on it yet."],
          ] as const).map(([k, label, hint]) => (
            <AutoField key={k} a={a} k={k} label={label} hint={hint}>
              <input type="time" value={a.v[k]} onChange={(e) => a.set(k, e.target.value)} {...a.text(k)} />
            </AutoField>
          ))}
        </div>
      </Group>
      <Group title="Plan ahead rituals" sid="rituals">
        <AheadRituals />
      </Group>
    </>
  );
}

/** ST-1: Focus › Focus timer (these are [plan] keys; they lived under Planning before). */
function FocusTimerForm(p: FormProps) {
  const a = usePlan(p, ["focusMinutes", "breakMinutes", "endSound"] as const);
  return (
    <Group title="Focus timer">
      <div className="set-grid">
        {numField(a, "focusMinutes", "Focus length (minutes)", "The default for a plain timer. A to-do suggests its size instead.", 5, 240)}
        {numField(a, "breakMinutes", "Break length (minutes)", "Offered when a session ends. 0 for none.", 5, 60)}
        <AutoField a={a} k="endSound" label="End sound" hint="With the notification when a session ends.">
          <label className="set-check">
            <input type="checkbox" checked={a.v.endSound} onChange={(e) => a.change("endSound", e.target.checked)} /> Play a sound
          </label>
        </AutoField>
      </div>
    </Group>
  );
}

/** ST-1: Clients › Keep following after focus time ends (a [plan] key; under Planning before). */
function FollowGraceForm(p: FormProps) {
  const a = usePlan(p, ["followGraceDays"] as const);
  return <div className="set-grid">{numField(a, "followGraceDays", "Keep following after focus time ends (days)", "Clients stay followed this long after their focus time ends.", 1, 90)}</div>;
}

/**
 * ADM-1: guidance with a team default by level (Admin › Organization): your own choice over it, and Reset to team
 * default. Levels change emphasis only: none of these ever blocks anything.
 */
function GuidanceForm(p: FormProps) {
  const org = p.data.org;
  const mine = p.data.guidance;
  const a = useAutoSave<{ draftStories: boolean | null; readinessNudges: boolean | null; planShare: number | null }>({
    section: "guidance",
    initial: { draftStories: mine.draftStories ?? null, readinessNudges: mine.readinessNudges ?? null, planShare: mine.planShare ?? null },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: (k) => (k === "draftStories" ? "Break down offered" : k === "readinessNudges" ? "Readiness nudges" : "Plan up to"),
  });
  if (!org) return null;
  const team = org.levelGuidance;
  const level = org.levelName ? `${org.levelName}${org.levelSource === "override" ? " (set by an admin)" : ""}` : "No level from Dataverse yet";
  const reset = (k: "draftStories" | "readinessNudges" | "planShare") =>
    a.v[k] !== null && (
      <button type="button" className="link-btn" onClick={() => a.change(k, null)}>
        Reset to team default
      </button>
    );
  const onOff = (b: boolean) => (b ? "on" : "off");
  return (
    <Group title="Guidance" intro="Your level changes emphasis only; none of these ever blocks anything.">
      <div className="set-grid set-guidance">
        <ReadOnly sid="level" label="Your level" value={level} where="From your position in Dataverse. It changes suggestions only, never what you can do." />
        {/* QT-1: "Plan up to (% of free time)" is gone from the screen (it moved the over line on Week's client chips, which are gone). The stored value stays. */}
        <AutoField a={a} k="draftStories" label="Break down" hint={<>Team default: {onOff(team.draftStories)}. {reset("draftStories")}</>}>
          <label className="set-check">
            <input type="checkbox" checked={a.v.draftStories ?? team.draftStories} onChange={(e) => a.change("draftStories", e.target.checked)} /> Offer Break down on features that need stories
          </label>
        </AutoField>
        <AutoField a={a} k="readinessNudges" label="Readiness nudges" hint={<>The ⚑ flags in Plan ahead. Team default: {onOff(team.readinessNudges)}. {reset("readinessNudges")}</>}>
          <label className="set-check">
            <input type="checkbox" checked={a.v.readinessNudges ?? team.readinessNudges} onChange={(e) => a.change("readinessNudges", e.target.checked)} /> Show readiness nudges
          </label>
        </AutoField>
      </div>
    </Group>
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
        <strong>Look ahead 4 weeks</strong> every other Thursday, offered after you confirm next week. Next: {day(n.lookAhead)}.
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
    <Group title="Timeboxes">
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
    </Group>
  );
}

/** Settings > Planning > Help sessions (step 13): length, Teams, how many workdays "Ask to collaborate" searches. */
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
    <Group title="Help sessions" intro="For Ask to collaborate.">
      <div className="set-grid">
        <AutoField a={a} k="meetingMinutes" label="Default length" hint="Where Ask to collaborate starts.">
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
        {p.data.org && <ReadOnly sid="never-suggested" label="Never suggested, for everyone" value={p.data.org.rules.neverSuggest.join(", ") || "Nobody"} where={ADMIN} />}
        <AutoField a={a} k="exclude" label={p.data.org ? "People I exclude" : "People to exclude"} hint="Never suggested as helpers or as Who. By name or email.">
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
        <ReadOnly sid="invite-domains" label="Invites go only to" value={c.domains.join(", ") || "No domain yet"} where={p.data.fromFile ? "Set in config.toml ([collab] domains)" : ADMIN} />
      </div>
    </Group>
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
    <>
    <Group title="Teams status" intro="Set while focus runs, back to automatic after. A change you make in Teams wins.">
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
    </Group>
    <Group title="Sound while focusing" intro="Plays only while focus runs. The focus screen can pick another.">
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
    </Group>
    <Group title="Music players">
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
    </Group>
    <Group title="Playlists" sid="playlists">
      <p className="muted set-intro">
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
    </Group>
    </>
  );
}

/** Settings > Backlog (was Ahead, was Roadmap; step 17, BL-1): when a row reads Stalled or Watch, and (BH-1) when Backlog calls an item stale. Whole numbers. */
function RoadmapForm(p: FormProps) {
  const r = p.data.roadmap;
  const a = useAutoSave({ section: "roadmap", initial: { stalledDays: r.stalledDays, watchWeeks: r.watchWeeks }, payload: (v) => v, onSaved: p.onSavedData, label: (k) => (k === "stalledDays" ? "Stalled after" : "Watch within") });
  const b = useAutoSave({ section: "ahead", initial: { staleWeeks: p.data.ahead?.staleWeeks ?? 6 }, payload: (v) => v, onSaved: p.onSavedData, label: () => "Stale after" });
  return (
    <div className="set-form">
      <div className="set-grid">
        <AutoField a={b} k="staleWeeks" label="Stale after (weeks)" hint="Open items with no change in DevOps for this long. 1 to 26.">
          <input type="number" min={1} max={26} step={1} value={b.v.staleWeeks} onChange={(e) => b.set("staleWeeks", Math.round(Number(e.target.value)))} {...b.text("staleWeeks")} />
        </AutoField>
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
  // ADM-1: the team's lists are a Default an admin sets; a person adds their own on top and never removes the team's.
  const team = p.data.org?.phrases.team ?? null;
  const a = useAutoSave({
    section: "asks",
    initial: { requestPhrases: s.requestPhrases.join(", "), ackPhrases: s.ackPhrases.join(", "), promisePhrases: (s.promisePhrases ?? []).join(", ") },
    payload: (v) => ({ requestPhrases: phrases(v.requestPhrases), ackPhrases: phrases(v.ackPhrases), promisePhrases: phrases(v.promisePhrases) }),
    onSaved: p.onSavedData,
    label: (k) => (k === "requestPhrases" ? "Request phrases" : k === "promisePhrases" ? "Promise phrases" : "Acknowledgements"),
  });
  return (
    <Group title="Phrases">
      <p className="muted set-intro">
        Each client chat registered below is read every {p.data.org?.rules.pollMinutes ?? 5} minutes in working hours, once for everyone who follows the client. A new message from someone outside Cooptimize becomes a request when it mentions a Cooptimizer, has a question mark, uses a request phrase, or has an attachment. One that is only an acknowledgement isn't. The request phrases used are the team's plus those of the person whose sign-in read the chat. Your own messages with one of the promise phrases become your promises. When a FocusTime admin allows AI for a client, AI sorts these; otherwise the rules alone decide.
      </p>
      {team && (
        <div className="set-grid" data-setting="team-phrases">
          <ReadOnly label="Team request phrases" value={team.request.join(", ") || "None"} where={ADMIN} />
          <ReadOnly label="Team acknowledgements" value={team.ack.join(", ") || "None"} where={ADMIN} />
          <ReadOnly label="Team promise phrases" value={team.promise.join(", ") || "None"} where={ADMIN} />
        </div>
      )}
      <div className="set-grid">
        <AutoField a={a} k="requestPhrases" label={team ? "My request phrases" : "Request phrases"} hint={team ? "Added on top of the team's. Commas between them." : "Commas between them. Whole words, any case."}>
          <input type="text" value={a.v.requestPhrases} onChange={(e) => a.set("requestPhrases", e.target.value)} {...a.text("requestPhrases")} />
        </AutoField>
        <AutoField a={a} k="ackPhrases" label={team ? "My acknowledgements" : "Acknowledgements"} hint="A message that is only these (and emoji) is not a request.">
          <input type="text" value={a.v.ackPhrases} onChange={(e) => a.set("ackPhrases", e.target.value)} {...a.text("ackPhrases")} />
        </AutoField>
        <AutoField a={a} k="promisePhrases" label={team ? "My promise phrases" : "Promise phrases"} hint="In your own messages: commas between them. Inbox › Promises.">
          <input type="text" value={a.v.promisePhrases} onChange={(e) => a.set("promisePhrases", e.target.value)} {...a.text("promisePhrases")} />
        </AutoField>
      </div>
    </Group>
  );
}

/** Settings > Notifications (step 15.5): a switch per kind, quiet hours, held during focus, a test. */
function NotifyForm(p: FormProps) {
  const n = p.data.notify;
  const a = useAutoSave({
    section: "notify",
    initial: { kinds: { ...n.kinds } as Record<NotifyKind, boolean>, quiet: n.quiet as QuietMode, quietPto: n.quietPto, pushDetails: n.pushDetails, asksThroughFocus: n.asksThroughFocus ?? false, teamsMessages: n.teamsMessages ?? false, fromTestSite: n.fromTestSite ?? false, teams: { ...DEFAULT_TEAMS_RHYTHM, ...(n.teams ?? {}) } as TeamsRhythm, status: { ...DEFAULT_STATUS_TIMES, ...(n.status ?? {}) } as StatusTimes },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: (k) => (k === "kinds" ? "Notification" : k === "quiet" ? "Quiet hours" : k === "pushDetails" ? "Show details" : k === "asksThroughFocus" ? "Urgent requests during focus" : k === "teamsMessages" ? "Messages in Teams" : k === "fromTestSite" ? "From this test site" : k === "teams" ? "Teams messages" : k === "status" ? "Status report times" : "Quiet on PTO days"),
  });
  const [test, setTest] = useState<string | null>(null);
  // ENV-1: outside production nothing is sent on its own unless the person switches it on here (the server decides
  // what is production; this only hides the switch where it means nothing).
  const env = useAppEnv();
  const testSite = env !== null && env !== "prod" && env !== "demo";
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
      {testSite && (
        <Group title="This test site" sid="test-site" intro="This is a test site. It sends nothing on its own: no reminders, notices, pushes or Teams messages, unless you switch them on here. It never reads chats or calls on its own and never changes your Teams status.">
          <AutoField a={a} k="fromTestSite" label="From this test site" hint="On: you get reminders, notices, pushes and Teams messages from this test site as the real FocusTime sends them, by the switches below. Only for you.">
            <label className="set-check">
              <input type="checkbox" checked={a.v.fromTestSite} onChange={(e) => a.change("fromTestSite", e.target.checked)} /> Send me reminders and Teams messages from this test site
            </label>
          </AutoField>
        </Group>
      )}
      <Group title="In FocusTime" sid="kinds" intro="Each is sent once; a click opens FocusTime there.">
      <div className="set-notify">
        {group("Ritual reminders", RITUAL_KINDS)}
        {group("While you focus", ["timer", "meeting"])}
        {group("Other", ["vm", "followups", "expiry", "asks"])}
        {group("Client chats", ["commitment_item", "taken_over"])}
        {group("Monday's status report", ["status_report"])}
        {group("Client calls", ["meeting_review"])}
      </div>
      <SaveMark s={a.status("kinds")} retry={() => a.commit("kinds")} />
      </Group>
      <Group title="Timing">
      <AutoField a={a} k="status" label="Status report times" hint="Friday at this time, or an hour before your day ends if that comes first. Sunday only when you turn it on. These times hold in Teams too.">
        <span className="set-teams-time">
          <input type="time" aria-label="Friday at" value={a.v.status.fridayAt} onChange={(e) => HM.test(e.target.value) && a.set("status", { ...a.v.status, fridayAt: e.target.value })} onBlur={() => a.commit("status")} />
          <label className="set-check">
            <input type="checkbox" checked={a.v.status.sunday} onChange={(e) => a.change("status", { ...a.v.status, sunday: e.target.checked })} /> Also Sunday evening at
          </label>
          <input type="time" aria-label="Sunday at" disabled={!a.v.status.sunday} value={a.v.status.sundayAt} onChange={(e) => HM.test(e.target.value) && a.set("status", { ...a.v.status, sundayAt: e.target.value })} onBlur={() => a.commit("status")} />
        </span>
      </AutoField>
      <AutoField a={a} k="asksThroughFocus" label="Urgent requests during focus" hint="Off: an urgent request waits until the focus session ends, with the others.">
        <label className="set-check">
          <input type="checkbox" checked={a.v.asksThroughFocus} onChange={(e) => a.change("asksThroughFocus", e.target.checked)} /> Let urgent asks through
        </label>
      </AutoField>
      </Group>
      <Group title="Quiet hours">
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
      </Group>
      <Group title="Test" intro="During a focus session only the timer, meeting warnings and (if you let them) urgent requests come; the rest wait and come as one after the session.">
      <div className="set-actions-row" data-setting="test-notification">
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
      </Group>
      <Group title="On your devices" sid="devices">
      <PushDevices />
      <AutoField a={a} k="pushDetails" label="Show details in notifications" hint="Off: a push says only what kind of thing it is (Promises due). On: client names and work item titles too, on the lock screen.">
        <label className="set-check">
          <input type="checkbox" checked={a.v.pushDetails} onChange={(e) => a.change("pushDetails", e.target.checked)} /> Show details
        </label>
      </AutoField>
      </Group>
      <Group title="In Teams">
      <TeamsStatusLine />
      <AutoField a={a} k="teamsMessages" label="Messages in Teams" hint="Off: FocusTime only answers when you message it in Teams. On: it may send the kinds you turn on below, only in your own chat with it, never in quiet hours, on PTO days or weekends, and held while you focus.">
        <label className="set-check">
          <input type="checkbox" checked={a.v.teamsMessages} onChange={(e) => a.change("teamsMessages", e.target.checked)} /> Let FocusTime message me in Teams
        </label>
      </AutoField>
      <TeamsKinds v={a.v.teams} on={a.v.teamsMessages} set={(t) => a.set("teams", t)} commit={(t) => a.commit("teams", t)} change={(t) => a.change("teams", t)} />
      <SaveMark s={a.status("teams")} retry={() => a.commit("teams")} />
      </Group>
    </div>
  );
}

type TeamsStatus = { available: boolean; chat: boolean; blocked: boolean };

/** TB-2: whether FocusTime can reach me in Teams: the hosted app only, after my first message, unless Teams refused it. */
function TeamsStatusLine({ always = false }: { always?: boolean } = {}) {
  const [st, setSt] = useState<TeamsStatus | null>(null);
  useEffect(() => void call<TeamsStatus>("teams.status", {}).then(setSt, () => setSt(null)), []);
  if (!st) return always ? <p className="muted">Checking…</p> : null;
  if (!st.available) return <p className="muted">FocusTime in Teams runs in the hosted app. Here it can't send anything.</p>;
  if (st.blocked) return <p className="set-warn" role="status">FocusTime can't message you in Teams. Add the app again.</p>;
  if (!st.chat) return <p className="muted">Message FocusTime in Teams once, so it knows where to reach you.</p>;
  return always ? <p>Connected: FocusTime can reach you in your chat with it.</p> : null;
}

/** TB-2: the kinds FocusTime may send in Teams, each with its time and Send me a test now. */
function TeamsKinds(p: { v: TeamsRhythm; on: boolean; set: (t: TeamsRhythm) => void; commit: (t: TeamsRhythm) => void; change: (t: TeamsRhythm) => void }) {
  const [test, setTest] = useState<{ kind: TeamsKind; text: string } | null>(null);
  const t = p.v;
  const send = (kind: TeamsKind) => {
    setTest({ kind, text: "Sending…" });
    void call("teams.test", { kind }).then(
      () => setTest({ kind, text: "Sent. Look in your chat with FocusTime in Teams." }),
      (e: unknown) => setTest({ kind, text: e instanceof Error ? e.message : "Couldn't send it" }),
    );
  };
  const time = (kind: TeamsKind) => {
    if (kind === "brief")
      return (
        <span className="set-teams-time">
          <select aria-label="Morning brief time" value={t.briefAt ? "time" : "start"} onChange={(e) => p.change({ ...t, briefAt: e.target.value === "start" ? null : (t.briefAt ?? "09:00") })}>
            <option value="start">At the start of my day</option>
            <option value="time">At a set time</option>
          </select>
          {t.briefAt !== null && <input type="time" aria-label="Morning brief at" value={t.briefAt} onChange={(e) => HM.test(e.target.value) && p.set({ ...t, briefAt: e.target.value })} onBlur={() => p.commit(t)} />}
        </span>
      );
    if (kind === "checkin")
      return <input type="time" aria-label="Midday check-in at" value={t.checkinAt} onChange={(e) => HM.test(e.target.value) && p.set({ ...t, checkinAt: e.target.value })} onBlur={() => p.commit(t)} />;
    if (kind === "closeout")
      return (
        <span className="set-teams-time">
          <input type="number" aria-label="Minutes before my day ends" min={CLOSEOUT_MINUTES.min} max={CLOSEOUT_MINUTES.max} step={5} value={t.closeoutMinutes} onChange={(e) => p.set({ ...t, closeoutMinutes: Math.max(CLOSEOUT_MINUTES.min, Math.min(CLOSEOUT_MINUTES.max, Math.round(Number(e.target.value) || 30))) })} onBlur={() => p.commit(t)} />
          <span className="set-hint">minutes before my day ends</span>
        </span>
      );
    return null;
  };
  return (
    <fieldset className="set-notify-group set-teams" disabled={!p.on} data-setting="teams-kinds">
      <legend>What FocusTime sends</legend>
      {TEAMS_KINDS.map((k) => (
        <div key={k} className="set-teams-row">
          <label className="set-notify-row">
            <input type="checkbox" checked={t[k]} onChange={(e) => p.change({ ...t, [k]: e.target.checked })} />
            <span className="set-notify-name">{TEAMS_KIND_LABEL[k]}</span>
            <span className="set-hint">{TEAMS_KIND_HINT[k]}</span>
          </label>
          <div className="set-teams-controls">
            {time(k)}
            <button type="button" className="mini" onClick={() => send(k)}>
              Send me a test now
            </button>
            {test?.kind === k && (
              <span className="set-hint" role="status">
                {test.text}
              </span>
            )}
          </div>
        </div>
      ))}
      <label className="set-check">
        <input type="checkbox" checked={t.friday} onChange={(e) => p.change({ ...t, friday: e.target.checked })} /> Also on Fridays (catch-up)
      </label>
      <p className="muted">Never on weekends or PTO days. A test comes now, whatever the switches say.</p>
    </fieldset>
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
  if (!p.data.risk) return null;
  return <RiskFields {...p} />;
}
function RiskFields(p: FormProps) {
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
    <Group title="At-risk blocks" sid="risk-rules" intro="When a block's meetings make it Watch or At risk.">
      <div className="set-grid">
        {num("meetingWatchMinutes", "Watch at (minutes of meetings)", "A block with this many minutes of meetings is marked Watch.")}
        {num("meetingAtRiskMinutes", "At risk at (minutes of meetings)", "At least the Watch value.")}
        {num("minFocusWindowMinutes", "Shortest useful focus window (minutes)", "With no free stretch this long, the block is at risk.")}
      </div>
    </Group>
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

/** ST-1: Clients: how long a client stays followed, then one row per client that opens its own page. */
function ClientList(p: BodyProps) {
  const d = p.data;
  const { followed, other } = followedFirst(d.clients);
  const row = (c: SettingsClient) => {
    const color = c.setting.color || c.teamColor || "";
    return (
      <li key={c.key}>
        <a
          className="set-client-row"
          href={settingsHref("client", c.key)}
          onClick={(e) => (e.preventDefault(), p.go("client", c.key))}
          style={{ "--c": color ? (color.startsWith("#") ? color : `var(--client-${color})`) : "var(--client-none)" } as CSSProperties}
        >
          <span className="swatch" aria-hidden="true" />
          <strong>{c.setting.name ?? c.dataverseName ?? c.key}</strong>
          <span className="muted">{c.follow?.active === false ? "Not followed" : "Followed"}</span>
          <span className="muted">{c.devops ? (c.write ? "DevOps writes on" : "DevOps read-only") : "No DevOps"}</span>
          <span className="ps-chev"><Icon name="next" /></span>
        </a>
      </li>
    );
  };
  return (
    <>
      <FollowGraceForm {...p} />
      <Group title="Your clients" sid="client-list" intro="From Dataverse (your Account Worker records and focus time). Open one to change how it shows.">
        {d.dataverseProblem && (
          <p className="set-problem" role="status">
            {d.dataverseProblem}{" "}
            <button type="button" className="link-btn" onClick={() => void p.reload()}>Refresh</button>
          </p>
        )}
        {d.clients.length === 0 && !d.dataverseProblem && <p className="muted">No clients yet.</p>}
        <ul className="set-client-list">{followed.map(row)}</ul>
        {other.length > 0 && (
          <details className="set-client-more">
            <summary>Not followed · {other.length}</summary>
            <ul className="set-client-list">{other.map(row)}</ul>
          </details>
        )}
      </Group>
    </>
  );
}

/** ST-1: DevOps: each client's read status (from the week's fetch) and my own write access per client. */
function DevOpsSection(p: BodyProps) {
  const d = p.data;
  const withDevOps = d.clients.filter((c) => c.devops);
  return (
    <div className="set-form">
      <Group title="Reading" sid="devops-read" intro="FocusTime reads with the company PAT from Dataverse, only when fetching; it is never shown.">
        {p.devops && p.devops.length > 0 ? (
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
        ) : (
          <p className="muted">No DevOps yet. It comes from each followed client's record in Dataverse.</p>
        )}
      </Group>
      <Group title="Write access" sid="devops-write" intro="Your own PAT per client, with Work Items (Read & write). FocusTime checks it is yours, keeps it sealed and never shows it again.">
        {withDevOps.length === 0 ? (
          <p className="muted">No client has DevOps set up in Dataverse.</p>
        ) : (
          withDevOps.map((c) => <WriteAccess key={c.key} client={c} onDone={p.reload} />)
        )}
      </Group>
      <Group title="Find an item" sid="find-item" intro="Why an item isn't showing: whether FocusTime's last check of DevOps found it, the scope, and where it shows. It answers from what FocusTime already read; Refresh checks DevOps now.">
        <FindItem clients={withDevOps.map((c) => ({ key: c.key, name: c.setting.name ?? c.dataverseName ?? c.key }))} />
      </Group>
    </div>
  );
}

/** One client: its settings, its DevOps identity (Dataverse's) and, when it has DevOps, my write access. */
function ClientCard({ c, d, p }: { c: SettingsClient; d: SettingsData; p: { onSavedData: (d: SettingsData) => void; reload: () => Promise<void>; go: (section: string, setting?: string | null) => void } }) {
  return (
    <div className="set-client-wrap" style={{ "--c": c.setting.color ? (c.setting.color.startsWith("#") ? c.setting.color : `var(--client-${c.setting.color})`) : "var(--client-none)" } as CSSProperties}>
      <ClientForm client={c} data={d} onSavedData={p.onSavedData} />
      <div className="set-form set-allow-ai">
      {c.devops ? (
        <ReadOnly
          label="DevOps writes"
          value={c.write ? "On" : "Off, read-only"}
          where={c.write ? `As ${c.write.name} on ${c.write.org}${c.write.expires ? `, expires ${shortDate(c.write.expires)}` : ""}.` : "Add your own PAT to write to DevOps."}
        />
      ) : (
        d.dataverseReached && <p className="muted set-client-note">No DevOps set up for {c.setting.name ?? c.dataverseName ?? c.key} in Dataverse, so there is nothing to write to. Change it in Dataverse.</p>
      )}
      {c.devops && (
        <p className="set-fix">
          <a href={settingsHref("devops", "devops-write")} onClick={(e) => (e.preventDefault(), p.go("devops", "devops-write"))}>
            {c.write ? "Change DevOps write access" : "Turn on DevOps writes"}
          </a>
        </p>
      )}
      </div>
      <DeliveryChatField clientKey={c.key} clientName={c.setting.name ?? c.dataverseName ?? c.key} readOnly />
      <AllowAi c={c} d={d} />
      <DeploySettings clientKey={c.key} clientName={c.setting.name ?? c.dataverseName ?? c.key} />
      {c.devops && <HouseStyleField clientKey={c.key} name={c.setting.name ?? c.dataverseName ?? c.key} />}
    </div>
  );
}

/** ADM-1: whether AI may be used for this client: an admin's Rule (Admin › AI), shown read-only. */
function AllowAi({ c, d }: { c: SettingsClient; d: SettingsData }) {
  const name = c.setting.name ?? c.dataverseName ?? c.key;
  const allowed = d.aiRules.allowedClients.includes(c.key);
  return (
    <div className="set-form set-allow-ai">
      <ReadOnly label="AI for this client" value={!d.aiRules.on ? "Off for FocusTime" : allowed ? `Allowed for ${name}` : `Not allowed for ${name}`} where={ADMIN} />
    </div>
  );
}

type HouseStyleData = { clientKey: string; text: string; computed: string | null; computedAt: string | null; learned: boolean; edited: string | null; team?: string | null; read?: boolean | null };

/** DS-1, ADM-1: the client's house style for Break down. The team's (a Rule, Admin › Clients) when set, else learned. */
function HouseStyleField({ clientKey, name }: { clientKey: string; name: string }) {
  const [h, setH] = useState<HouseStyleData | null>(null);
  useEffect(() => void call<HouseStyleData>("stories.house_style", { clientKey }).then(setH, () => setH(null)), [clientKey]);
  if (!h) return null;
  const where = h.team ? ADMIN : h.learned ? `Learned from ${name}'s own features each week. A FocusTime admin can set the team's in Admin › Clients.` : "The default: too few features with stories to learn from yet.";
  return (
    <div className="set-form set-house-style">
      <ReadOnly label="House style for Break down" value={<span className="set-pre">{h.text}</span>} where={where} />
    </div>
  );
}

type AiTestResult = { ok: true; latencyMs: number; cost: string; model: string } | { ok: false; kind: string; message: string };

/** AI-0, ADM-1: Settings › AI: the team's AI values read-only (Admin › AI sets them), this month's spend, Test AI, what is sent, and the last 20 requests. */
function AiForm(p: FormProps) {
  const s = p.data.ai;
  const a = useAutoSave({
    section: "ai",
    initial: { draftMonths: s.draftMonths ?? 12 },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: () => "Break down looks back",
  });
  const [st, setSt] = useState<AiView | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AiTestResult | null>(null);
  const load = useCallback(() => call<AiView | null>("ai.status", {}).then(setSt, () => setSt(null)), []);
  const rules = p.data.aiRules;
  useEffect(() => void load(), [load, rules.on, rules.personCapUsd]);
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
      <div className="set-grid" data-setting="ai-team">
        <ReadOnly label="AI for FocusTime" value={rules.on ? "On" : "Off"} where={ADMIN} />
        <ReadOnly
          label="Allowed for"
          value={rules.allowedClients.length ? rules.allowedClients.map((k) => nameOf(k)).join(", ") : "No clients yet"}
          where={ADMIN}
        />
        <ReadOnly label="Your monthly limit" value={rules.personCapUsd === 0 ? "AI budget is set to $0" : `$${rules.personCapUsd}`} where={ADMIN} />
      </div>
      {(st === null || notSetUp) && (
        <p className="set-problem" role="status">
          AI isn't set up for this FocusTime yet{st?.provider === "off" ? ": it's turned off" : ""}. Everything else works without it.
        </p>
      )}
      <div className="set-ai-month" data-setting="ai-month">
        <span className="set-ai-label">This month</span>
        <strong>
          {st ? st.spentText : "$0"} of {st ? st.capText : `$${rules.personCapUsd}`}
        </strong>
        {st?.zeroBudget ? <span className="field-problem">AI budget is set to $0</span> : st?.appReached && <span className="field-problem">FocusTime's AI budget for everyone is used up until next month.</span>}
      </div>
      <AutoField a={a} k="draftMonths" label="Break down looks back (months)" hint="Examples come from the same client's features changed in this many months, 1 to 36.">
        <input type="number" min={1} max={36} step={1} value={a.v.draftMonths} onChange={(e) => a.set("draftMonths", Number(e.target.value))} {...a.text("draftMonths")} />
      </AutoField>
      <div className="set-ai-test" data-setting="ai-test">
        <button type="button" className="mini" disabled={testing} onClick={() => void runTest()}>
          {testing ? "Testing…" : "Test AI"}
        </button>
        {test && (test.ok ? <span className="set-ai-ok" role="status">OK · {(test.latencyMs / 1000).toFixed(1)} s · {test.cost}</span> : <span className="field-problem" role="status">{test.message}</span>)}
        <span className="set-hint">Sends one fixed request with no client data.</span>
      </div>
      <details className="set-ai-sent" data-setting="ai-sent">
        <summary>What is sent</summary>
        <p className="muted">
          Only what a task needs, about one client at a time, and only for clients a FocusTime admin allowed. Before anything goes, FocusTime checks it: another client's name, project or work item, anything that looks like a key, token or password, your VM, or an email address from outside Cooptimize stops the request. The AI service is asked not to keep requests, and FocusTime's log keeps only the counts and the cost below, never the text.
        </p>
      </details>
      <h3 className="set-ai-h" data-setting="ai-log">Last 20 requests</h3>
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
const AI_TASK_NAMES: Record<string, string> = { test_ai: "Test AI", "asks.classify": "Sort an ask", "promises.extract": "Read a promise", "stories.draft": "Break down" };
const fmtAiTime = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function ClientForm({ client: c, data, onSavedData }: { client: SettingsClient; data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const reached = data.dataverseReached;
  const a = useAutoSave({
    section: "client",
    initial: { name: c.setting.name ?? "", color: c.setting.color ?? "", keep: c.setting.follow },
    payload: (v) => ({ key: c.key, name: v.name, color: v.color, follow: v.keep }),
    onSaved: onSavedData,
    label: (k) => `${c.setting.name ?? c.key}: ${k === "name" ? "Shown as" : k === "color" ? "Color" : "Keep following"}`,
  });
  // ADM-1: the team color (a Default set by an admin) unless you pick your own; Reset to team color clears yours.
  const team = c.teamColor ?? "";
  const color = a.v.color || team;
  const own = !!a.v.color && a.v.color !== team;
  const openStates = data.org?.clients[c.key]?.openStates ?? c.setting.openStates;
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
          <span className="set-hint set-team-color">
            {own ? (
              <>
                Your own color.{team ? " " : ""}
                {team && (
                  <button type="button" className="link-btn" onClick={() => a.change("color", "")}>
                    Reset to team color
                  </button>
                )}
              </>
            ) : team ? (
              "The team color, set by your FocusTime admin. Pick another to use your own."
            ) : (
              "No team color yet."
            )}
          </span>
          <SaveMark s={a.status("color")} retry={() => a.commit("color")} />
        </fieldset>
        <AutoField a={a} k="keep" label="Followed" hint={followText(c.follow, data.planning.followGraceDays)}>
          <label className="set-check">
            <input type="checkbox" checked={a.v.keep} onChange={(e) => a.change("keep", e.target.checked)} disabled={c.follow?.why === "internal" || c.follow?.why === "standing"} /> Keep following
          </label>
        </AutoField>
        <ReadOnly label="States treated as open" value={openStates.join(", ") || "None"} where={ADMIN} />
      </div>
    </div>
  );
}

function Connections(p: BodyProps) {
  return (
    <div className="set-form">
      <Group title="Sources" sid="sources">
      <ul className="set-list sources">
        {p.sources.map((s) => {
          const st = stateOf(s);
          const acts = sourceActions(s);
          const cal = s.source === "outlook" || s.source === "google" ? s.source : null;
          return (
            <li key={sourceKey(s)} className={`source ${st.cls}`}>
              <span className="dot" aria-hidden="true" />
              <strong>{sourceLabel(s)}</strong>
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
      </Group>
      <Group title="Calendars added by link" sid="calendar-links">
        <CalendarLinks timeZone={Temporal.Now.timeZoneId()} onChanged={p.onRefresh} />
      </Group>
      <div data-setting="outlook-changes"><OutlookWriteRow /></div>
      <div data-setting="permissions"><MicrosoftPermissions /></div>
      <Group title="My VM">
        <YouAccount part="vm" />
        <VmStartForm />
      </Group>
      <Group title="FocusTime in Teams" sid="teams-app">
        <TeamsStatusLine always />
        <p className="set-fix">
          <a href={settingsHref("notifications", "teams-messages")} onClick={(e) => (e.preventDefault(), p.go("notifications", "teams-messages"))}>
            What FocusTime may send you in Teams
          </a>
          {" · "}
          <a href={settingsHref("focus", "teams-status")} onClick={(e) => (e.preventDefault(), p.go("focus", "teams-status"))}>
            Your Teams status while you focus
          </a>
        </p>
      </Group>
      <div data-setting="feedback"><FeedbackRow go={p.go} /></div>
    </div>
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
  const env = useAppEnv();
  // Start over is for dev and local only (the server refuses it on prod too).
  const prod = env === null || env === "prod";
  useEffect(() => {
    call<SetupView>("setup.load", {}).then(setView, () => setView(null));
  }, []);
  if (p.demo) return <p className="muted">Setup isn't part of the demo.</p>;
  // RF-1: what's left, even once Today stopped offering it.
  const left = view?.left?.text;
  return (
    <div className="set-form">
      <p className="muted">The four first-run screens: your day, your clients, standing blocks and calendars. They change the same settings as the sections here.</p>
      <p>{view ? (left ? `${left}.` : "Every step is done.") : ""}</p>
      <div className="set-save">
        <button type="button" className="mini primary" onClick={() => p.onSetup?.(view?.left?.step ?? "day")}>
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
    <div className="set-field" data-setting="reset-plan">
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
    <div className="set-field" data-setting="export">
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
      <span className="set-hint">{status ?? "Your plans, promises, captures, logs and settings. Never a password or token."}</span>
    </div>
  );
}

/** AS-1: the assistant keeps 30 days of what I asked and its answers, for me only (in Export, never shown to admins). */
function ClearAssistant() {
  const [asking, setAsking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="set-field">
      <span className="set-label">Assistant history</span>
      {asking ? (
        <span className="set-inline">
          <button
            type="button"
            className="mini primary"
            onClick={async () => {
              try {
                const r = await call<{ removed: number }>("assistant.clear", { confirm: true });
                setStatus(r.removed ? `Cleared ${r.removed} ${r.removed === 1 ? "entry" : "entries"}` : "Nothing to clear");
              } catch (e) {
                setStatus(e instanceof Error ? e.message : "Couldn't clear it");
              }
              setAsking(false);
            }}
          >
            Clear it
          </button>
          <button type="button" className="mini" onClick={() => setAsking(false)}>Keep it</button>
        </span>
      ) : (
        <button type="button" className="mini" onClick={() => (setAsking(true), setStatus(null))}>Clear</button>
      )}
      <span className="set-hint">{status ?? "What you asked the assistant and its answers, kept 30 days. Only you see it; it is in Export my data."}</span>
    </div>
  );
}

/** A2: Delete my data: signs out and deletes everything kept for this person (kept 30 days, then removed for good). */
function DeleteMine() {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="set-field" data-setting="delete">
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

/** ST-1: Activity: every change FocusTime made in other apps (was the top of Data). */
function ActivitySection(p: BodyProps) {
  return (
    <div className="set-form">
      <div data-setting="write-log"><WriteLog /></div>
      <div data-setting="devops-log"><DevOpsWriteLog /></div>
      <div data-setting="azure-log"><AzureWriteLog tz={userZone(p.data.you)} /></div>
      <div data-setting="teams-log"><TeamsStatusLog tz={userZone(p.data.you)} /></div>
      <div data-setting="loop-log"><LoopSendsLog tz={userZone(p.data.you)} /></div>
    </div>
  );
}

function DataSection(p: BodyProps) {
  const dev = useDeveloperLoop();
  return (
    <div className="set-form">
      <div className="set-grid">
        <ExportMine />
        <ResetPlan disabled={!p.data.data.planStore} onDone={p.onSaved} />
        <DeleteMine />
      </div>
      <div data-setting="diagnostics"><DiagnosticsPanel /></div>
      {(dev || p.demo) && (
        <Group title="Demo" intro="Fictional data; your own plan isn't touched.">
          {/* ST-1: the switch works only in the developer loop (the hosted demo is "Try the demo" at sign-in). */}
          {dev && (
            <div className="set-grid">
              <fieldset className="set-choice" data-setting="demo-mode">
                <legend>Demo mode</legend>
                <label>
                  <input type="checkbox" checked={p.demo} onChange={(e) => p.setDemo(e.target.checked)} /> Show demo data
                </label>
              </fieldset>
            </div>
          )}
          {p.demo && (
            <div data-setting="demo-reset">
              <DemoSection />
            </div>
          )}
        </Group>
      )}
    </div>
  );
}

/** F1, FB-1: Send feedback's setup for me: my own write PAT for the feedback project's client, and the parent there. */
function FeedbackRow({ go }: { go: (section: string, setting?: string | null) => void }) {
  const [st, setSt] = useState<FeedbackStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (fresh: boolean) => call<FeedbackStatus>("feedback.status", fresh ? { fresh: true } : {}).then((r) => (setSt(r), setError(null)), (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't check"));
  useEffect(() => void load(false), []);
  return (
    <div className="set-write feedback-setup">
      <h3>Send feedback</h3>
      <p>{error ?? (st ? st.line : "Checking…")}</p>
      {st?.setup.state === "no_pat" && (
        <a className="mini primary" href={WRITES_HREF} onClick={(e) => (e.preventDefault(), go("devops", "devops-write"))}>
          Turn on DevOps writes
        </a>
      )}
      {st && (
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
