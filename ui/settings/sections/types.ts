// SA-2: what every Settings section is handed (ui/Settings.tsx keeps the shell, the rail and the routing).
import type { SettingsClient, SettingsData, SourceSummary } from "../../../actions/types.ts";
import type { TextSize, Theme } from "../../../config/schema.ts";
import type { SetupStep } from "../../../plan/setup.ts";
import type { ViewRange } from "../../../week/hours.ts";
import type { ClientWork } from "../../../week/types.ts";
import type { Calendar } from "../../status.ts";

export type Props = {
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
  /** Step 17.5: a calendar that just reconnected here (BR-1: one plain line). */
  reconnected?: Calendar | null;
  theme: Theme;
  setTheme: (t: Theme) => void;
  viewRange: ViewRange;
  setViewRange: (r: ViewRange) => void;
  /** Step 17.5: no opening animation (BR-1: the loader's mark holds still). */
  reduceMotion: boolean;
  setReduceMotion: (on: boolean) => void;
  /** U5 (D401): Default, Large or Larger. */
  textSize: TextSize;
  setTextSize: (s: TextSize) => void;
  /** U5.1 (D408): personal events shown on Week and Today. */
  showPersonal: boolean;
  setShowPersonal: (show: boolean) => void;
  /** PH-2: Day's timeline on this phone (TY-1's phone setting): its home on the phone now that another day has no ⋯. */
  dayTimeline?: boolean;
  setDayTimeline?: (show: boolean) => void;
  /** WK-5: the days Week shows, and the catch-up day's name in the loaded week ("Friday"). */
  weekDays: { catchUp: boolean; weekend: boolean };
  setWeekDays: (v: { catchUp?: boolean; weekend?: boolean }) => void;
  catchUpName: string;
  /** SA-3: Week's View options' "Every weekend day" (this browser's), so Days on Week offers the same three choices. */
  everyWeekendDay?: boolean;
  setEveryWeekendDay?: (on: boolean) => void;
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

export type BodyProps = Props & { section: string; data: SettingsData; onSavedData: (d: SettingsData) => void; reload: () => Promise<void>; client: SettingsClient | null; go: (section: string, setting?: string | null) => void };
export type FormProps = Props & { data: SettingsData; onSavedData: (d: SettingsData) => void };
