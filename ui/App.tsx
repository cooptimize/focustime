import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Meetings } from "./meetings/Meetings.tsx";
import { addWeeks, mondayOf } from "../week/dates.ts";
import { hidePersonal, personalCount } from "../week/personal.ts";
import type { Half, IsoDate } from "../week/types.ts";
import { SignInAgainButton } from "./Reopen.tsx";
import { parseRoute, ROUTE_EVENT } from "../plan/notify.ts";
import { ActionRefusal, call, connectSource, disconnectSource, endSession, planAction, SessionError, setThemeAction, startDemo, takeOpenRequest, weekLoad } from "./api.ts";
import { dayEndOf, hoursOn, VIEW_RANGE_NAMES, VIEW_RANGES, type ViewRange } from "../week/hours.ts";
import { applyTheme, initialTheme } from "./theme.ts";
import { rememberReduceMotion } from "./brand/motion.ts";
import { applyTextSize, stepTextSize, storedTextSize, TEXT_SIZE_NAMES, textSizeKey } from "./textsize.ts";
import type { TextSize } from "../config/schema.ts";
import { WeekMark } from "./brand/Brand.tsx";
import { CloseReverse, MomentOverlay, Opening } from "./brand/Opening.tsx";
import { mustsDone, sourceLines } from "./brand/opening.ts";
import type { Theme } from "../config/schema.ts";
import { NOTICE_EVENT, openChecked, openWorkItem, type Opened } from "./WorkLink.tsx";
import { DevOpsWriteCtx, useDevOpsWriteFlow } from "./DevOpsWrite.tsx";
import { DoneOfferCtx, useDoneOfferFlow } from "./DoneOffer.tsx";
import { TimeboxCtx, TimeboxDialog, timeboxChange as tbChange, useWriteFlow, type TimeboxEnv } from "./Timeboxes.tsx";
import { HelpFinder } from "./HelpFinder.tsx";
import { SendHost, TeamView } from "./Team.tsx";
import { StatusView } from "./Status.tsx";
import type { HelpTarget } from "./menu.ts";
import type { TimeboxTarget } from "./menu.ts";
import type { WriteState } from "../actions/types.ts";
import type { PlanDayState } from "../plan/types.ts";
import { planTarget } from "../plan/target.ts";
import { canAddWork, stepDay } from "../plan/days.ts";
import { PlanDay } from "./PlanDay.tsx";
import { dayRolledOver } from "./planday.ts";
import { PlanCtx, resumeSlots } from "./planview.ts";
import { DevOpsWork, workByClient } from "./work.ts";
import { afterLoad, createAutoRefresh, type LoadState, type RefreshTrigger } from "./refresh.ts";
import { DetailPanel } from "./DetailPanel.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { causeLines, SOURCE_NAMES, sourceActions, stateOf } from "./status.ts";
import { WeekGrid, type PanelFocus, type Selection } from "./WeekGrid.tsx";
import { MustsSummary, TopTimer } from "./NowStrip.tsx";
import { PersonChip, useAccountMenu, VM_MENU_EVENT, VmChip, VmProvider } from "./Account.tsx";
import { stepWeekday, afterDone, defaultNav, focusOf, hashOf, HOME, isPlanning, modeNav, navOf, parseHash, planDayNav, planWeekOf, routeLoc, sameLoc, TAB_NAMES, tabForKey, TABS, toggleP, viewName, viewNav, type Loc, type ModeName, type Nav, type Tab } from "./nav.ts";
import { ModeArea, ModeSwitch, TimelineToggle } from "./ModeSwitch.tsx";
import { dayModeStatus, momentCard, weekModeStatus } from "../plan/modes.ts";
import { FocusScreen, SoundControl } from "./FocusScreen.tsx";
import { sound } from "./sound.ts";
import type { TimerView } from "../actions/types.ts";
import { soundStep, type SoundKind } from "../plan/focussound.ts";
import { focusPick } from "../plan/today.ts";
import { InboxPage } from "./inbox/InboxPage.tsx";
import { useInboxToday } from "./inboxcount.ts";
import { railItems } from "../plan/inbox-items.ts";
import { Ahead } from "./ahead/Ahead.tsx";
import { Today } from "./Today.tsx";
import type { DraftStory, Pick } from "../plan/types.ts";
import { PlanWeek } from "./PlanWeek.tsx";
import { weekMusts } from "./WeekMusts.tsx";
import { CaptureDialog, captureClients } from "./Capture.tsx";
import { AssistantMark, AssistantPanel, COMMANDS_HREF } from "./Assistant.tsx";
import type { AssistantContext } from "../assistant/types.ts";
import { CreateDraftCtx, CreateDraftDialog } from "./CreateDraft.tsx";
import { DraftEditor, DraftEditorCtx } from "./DraftEditor.tsx";
import type { BoxKind } from "../plan/capture.ts";
import { borrowedSummary } from "../plan/borrow.ts";
import { formatDuration } from "../week/format.ts";
import { MoreButton, PopupMenu } from "./Menus.tsx";
import { borrowStep, timerStep } from "./menu.ts";
import { nowStrip } from "../plan/now.ts";
import { cardHalves, slotOf, validHalf } from "./halves.ts";
import { SetupFlow } from "./Setup.tsx";
import { AboutDialog } from "./About.tsx";
import { FeedbackDialog } from "./Feedback.tsx";
import { BreakDownHost, CoopBriefHost } from "./BreakDownPanel.tsx";
import { FromLastWeek } from "./FromLastWeek.tsx";
import { CarryProvider, CarrySummary } from "./Carry.tsx";
import type { SetupStep, SetupView } from "../plan/setup.ts";
import { Settings } from "./Settings.tsx";
import { useAdmin } from "./settings/Admin.tsx";
import { clientColor, SampleSources, weekLabel } from "./labels.ts";
import { useLayout, usePhone } from "./viewport.ts";
import { BottomBar, InstallHowTo, PhoneReadOnly, type BottomTab } from "./Phone.tsx";
import { commandList, type MenuEnv, type View } from "./menu.ts";
import { CommandMenu, MenuHost } from "./Menus.tsx";
import { WeekDndProvider } from "./WeekStories.tsx";
import { WeekItems } from "./ItemLookup.tsx";
import { NoHoursPrompt } from "./NoHoursPrompt.tsx";
import { KeyLegend } from "./KeyLegend.tsx";
import { NoticesPanel, NoticeToasts, useNotices } from "./Notices.tsx";
import type { InAppNotice } from "../plan/push.ts";
import { promptInstall, takeLaunchRoute, useInstall } from "./pwa.ts";
import { TourLink } from "./guide/TourLink.tsx";
import { tourById } from "./guide/tours.ts";
import type { Checklist } from "../actions/guide-actions.ts";
// UI-5: the Guide and its tours load only when opened (no weight on the app's first load).
const Guide = lazy(() => import("./guide/Guide.tsx"));
const Tour = lazy(() => import("./guide/tour/Tour.tsx"));
import { commandKeyAllowed, globalKeyAllowed, isTypingTarget, nextRegion, openTarget, regionOf, regionsAvailable, topOverlay, type Region } from "./keys.ts";
import { userZone } from "../week/zone.ts";

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** ?now=ISO pins the clock (used for screenshots and checks). */
function nowOverride(): string | undefined {
  const p = new URLSearchParams(location.search).get("now");
  if (!p) return undefined;
  try {
    return Temporal.Instant.from(p).toString();
  } catch {
    return undefined;
  }
}

/** Step 16.2: the last place, so reopening (a new window from focustime-open) lands where the last one was. */
const LOC_KEY = "focustime.loc";
function storedLoc(): Loc | null {
  try {
    const h = localStorage.getItem(LOC_KEY);
    return h ? parseHash(h) : null;
  } catch {
    return null;
  }
}

const TAB_TITLES: Record<Tab, string> = {
  today: "Today: what's next, what's urgent and the day's blocks",
  week: "The week: the Board (Plan today) and Plan (each client's features)",
  ahead: "Features, epics and stories ahead: Grid, Gantt and Gaps",
  inbox: "What needs you: promises, conversations, sends, captures and drafts",
};

const shortDay = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** A5: the address that opens Quick capture (Super+Alt+N on the hosted app). */
const CAPTURE_HASH = "#/capture";

export function App() {
  const now = useRef(nowOverride()).current;
  const { layout, compact } = useLayout();
  // P1: under 600 px, the phone app (bottom bar, one day at a time, planning read-only).
  const phone = usePhone();
  const [phoneMoreAt, setPhoneMoreAt] = useState<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Selection>({ dayIndex: 0, half: "AM" });
  // Step 17.5: the welcome moment (the first launch ever, kept in the plan store) and the Close out reverse.
  const [welcome, setWelcome] = useState(false);
  const [closing, setClosing] = useState<{ musts: boolean } | null>(null);
  const [reconnected, setReconnected] = useState<"outlook" | "google" | null>(null);
  // S1 (D451): first-run setup. It opens by itself for a new person (and resumes after a sign-out halfway); once
  // closed or skipped, Today keeps one quiet line to finish it. Never in demo mode (the server says so).
  const [setupView, setSetupView] = useState<SetupView | null>(null);
  const [setupAt, setSetupAt] = useState<SetupStep | null>(null);
  /** S1 (D452): ⋯ › About, which build this is. */
  const [aboutOpen, setAboutOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // P1: ⋯ › Notifications (the in-app list), its toasts, and Install app's iPhone how-to.
  const notices = useNotices(true);
  /** The list as it was when opened (what was new keeps its dot while the panel is open). */
  const [noticesOpen, setNoticesOpen] = useState<InAppNotice[] | null>(null);
  const [installHowTo, setInstallHowTo] = useState(false);
  const install = useInstall();
  const loadSetup = useCallback(
    (openIt: boolean): Promise<SetupView | null> =>
      call<SetupView>("setup.load", {}).then(
        (v) => {
          setSetupView(v);
          if (openIt && v.open) setSetupAt(v.open);
          return v;
        },
        () => null,
      ),
    [],
  );
  const afterOpening = useCallback(() => {
    // When setup opens by itself it is the welcome: the first launch's moment (which takes the first key) waits.
    const first = call<{ first: boolean }>("ui.first_launch", {});
    void loadSetup(true).then((v) => first.then((r) => r.first && !v?.open && setWelcome(true), () => {}));
    // G1: a person's first Today offers the tour once (per person, in the plan store).
    call<{ show: boolean }>("ui.tour_offer", {}).then((r) => setTourOffer(r.show), () => {});
  }, [loadSetup]);
  const [tourOffer, setTourOffer] = useState(false);
  const endTourOffer = useCallback(() => setTourOffer(false), []);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** U3: where the detail panel opened (the features list, a follow-up or a pick), or the block itself. */
  const [panelFocus, setPanelFocus] = useState<PanelFocus | null>(null);
  // ADM-1: whether the signed-in person is a FocusTime admin (Admin in ⋯ and the Settings sidebar).
  const isAdmin = useAdmin();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  /**
   * Step 16.2: where the window is: a tab and its mode (Today · Week · Roadmap · Inbox), or an overlay (the focus
   * screen, Settings). Mirrored in the address (#/…) so browser back and reopening land in the same place.
   */
  // A5: #/capture (the hosted app's Super+Alt+N) opens Quick capture over the last place, then leaves the address.
  const captureAsked = useRef(location.hash === CAPTURE_HASH);
  const [loc, setLocState] = useState<Loc>(() => parseHash(location.hash) ?? (location.hash && !captureAsked.current ? HOME : storedLoc()) ?? HOME);
  const locRef = useRef(loc);
  locRef.current = loc;
  const go = useCallback((next: Loc | ((l: Loc) => Loc)) => setLocState((l) => {
    const n = typeof next === "function" ? next(l) : next;
    return sameLoc(n, l) ? l : n;
  }), []);
  const goNav = useCallback((nav: Nav) => go({ nav, overlay: null }), [go]);
  useEffect(() => {
    const h = hashOf(loc);
    // NV-1: an older address that lands on the same place (a redirect) is replaced, so Back doesn't loop on it.
    const was = parseHash(location.hash);
    if (location.hash === CAPTURE_HASH || (was && sameLoc(was, loc))) history.replaceState(null, "", h);
    else if (location.hash !== h) history.pushState(null, "", h);
    try {
      localStorage.setItem(LOC_KEY, h);
    } catch {
      /* per-window convenience only */
    }
  }, [loc]);
  useEffect(() => {
    const on = () => {
      if (location.hash === CAPTURE_HASH) {
        history.replaceState(null, "", hashOf(locRef.current));
        setCaptureOpen(true);
        return;
      }
      const next = parseHash(location.hash) ?? HOME;
      // ST-1: a Settings address carries no tab: a link into Settings (Status, Feedback, the Guide's Do it now) opens it
      // over the tab I'm on, so closing returns there.
      setLocState(next.overlay?.kind === "settings" ? { ...next, nav: locRef.current.nav } : next);
    };
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const nav = loc.nav;
  // ST-1: the section in the address ("" is the rail) and a setting in it; Settings maps old ids and unknown ones.
  const settingsAt: string | null = loc.overlay?.kind === "settings" ? loc.overlay.section : null;
  const settingAt: string | null = loc.overlay?.kind === "settings" ? (loc.overlay.setting ?? null) : null;
  const focusOpen = loc.overlay?.kind === "focus";
  /** G1: the Guide (#/guide), over the current place like Settings. */
  const guideAt = loc.overlay?.kind === "guide" ? loc.overlay : null;
  /** UI-5: a Show me tour over the real screen (#/guide/tour/<id>); it only highlights and explains. */
  const tourAt = loc.overlay?.kind === "tour" ? (tourById(loc.overlay.id) ?? null) : null;
  // MC-1: Client calls over the place (#/meetings and #/meetings/<occurrence>).
  const meetingAt = loc.overlay?.kind === "meeting" ? loc.overlay : null;
  const base: "today" | "week" = nav.tab === "week" ? "week" : "today";
  const followUpsOpen = nav.tab === "inbox";
  /** IB-1: the Inbox's item open in the detail pane (the command menu's Inbox keys run only there). */
  const asksOpen = nav.tab === "inbox";
  const roadmapOpen = nav.tab === "ahead";
  const checkInOpen = nav.tab === "today" && nav.flow === "checkin";
  /** NV-1: the Board focused on a day (Plan the day lives here now). */
  const planDayFocus = focusOf(nav);
  /** Settings (step 6b) at a section, or closed (back to the place under it). */
  const setSettingsAt = useCallback((section: string | null, setting: string | null = null) => go((l) => ({ nav: l.nav, overlay: section !== null ? { kind: "settings", section, setting } : null })), [go]);
  // CV-3: the account menu, for the phone's ⋯ first row (the person chip on wider screens).
  const account = useAccountMenu(() => setSettingsAt("you"));
  // G1: the tour link shows on the first Today (Now) a person sees, once: it is recorded as shown when it first
  // appears, and stays for this visit until they open the Guide from it or say Not now.
  const showTour = tourOffer && !loc.overlay && loc.nav.tab === "today" && loc.nav.flow === null;
  const tourMarked = useRef(false);
  useEffect(() => {
    if (!showTour || tourMarked.current) return;
    tourMarked.current = true;
    void call("ui.tour_offer", { done: true }).catch(() => {});
  }, [showTour]);
  /** UI-5: Your first day's states (read only; never a token). */
  const guideChecklist = useCallback(() => call<Checklist>("guide.checklist", {}), []);
  const openGuide = useCallback((chapter: string | null = null) => go((l) => ({ nav: l.nav, overlay: { kind: "guide", chapter } })), [go]);
  // P1: opening the list marks every notice read (the dot goes).
  const readAllNotices = notices.readAll;
  const openNotices = useCallback(() => setNoticesOpen(readAllNotices()), [readAllNotices]);
  /** P1: Install app, where the browser can install (Chromium's prompt) or on iPhone (the how-to); gone once installed. */
  const installItem = install === "prompt" ? [{ id: "install", label: "Install app", run: () => void promptInstall() }] : install === "ios" ? [{ id: "install", label: "Install app", run: () => setInstallHowTo(true) }] : [];
  const setFocusOpen = useCallback((on: boolean) => go((l) => ({ nav: on ? l.nav : l.nav, overlay: on ? { kind: "focus" } : null })), [go]);
  /** Bumped when something outside Plan the week (the command menu) changes its plan, so it reloads. */
  const [planWeekVersion, setPlanWeekVersion] = useState(0);
  /** Quick capture (step 9): the box over any view, and the Capture view (inbox and notes) in the week's place. */
  const [captureOpen, setCaptureOpen] = useState(false);
  // AS-1: the assistant panel (Ctrl+J, /, the top bar's Ask), with any text it opens with.
  const [assistantAt, setAssistantAt] = useState<{ text: string } | null>(null);
  // Step 15.3: the kind chip to start on (Follow-up from "Add a follow-up"), or the rules' suggestion.
  const [captureKind, setCaptureKind] = useState<BoxKind | null>(null);
  // Step 15.3: the draft open in the draft editor.
  const [draftEdit, setDraftEdit] = useState<DraftStory | null>(null);
  const [createDraft, setCreateDraft] = useState<number | null>(null);
  const [captureVersion, setCaptureVersion] = useState(0);
  const [borrowMenuAt, setBorrowMenuAt] = useState<{ x: number; y: number } | null>(null);
  /** U2: Week's ⋯ (the hours shown, and the compact timelines in the medium layout), moved from the status bar. */
  const [weekMoreAt, setWeekMoreAt] = useState<{ x: number; y: number } | null>(null);
  /** The focus timer menu (F or the top bar Focus button), anchored where it was opened. */
  const [timerMenuAt, setTimerMenuAt] = useState<{ x: number; y: number } | null>(null);
  /** Step 16.2: the top bar's ⋯ menu (Commands, keyboard shortcuts) and the initials menu (Settings, Sign out). */
  const [moreAt, setMoreAt] = useState<{ x: number; y: number } | null>(null);
  const [personMenu, setPersonMenu] = useState<{ at: { x: number; y: number }; step: import("./menu.ts").MenuStep } | null>(null);
  /** A per-second clock while a timer runs, for its countdown. */
  // With ?now= pinned (screenshots, verification), the countdown follows the pinned clock too.
  const skew = useRef(now ? Date.parse(now) - Date.now() : 0).current;
  const [secondMs, setSecondMs] = useState(() => Date.now() + skew);
  // The element focused in each region, so F6 returns to it; and the work item focused when the command menu opened.
  const lastInRegion = useRef(new Map<Region, HTMLElement>());
  const focusedItem = useRef<{ clientKey: string; url: string } | null>(null);
  const openCommands = useCallback(() => {
    focusedItem.current = openTarget(document.activeElement);
    setDetailsOpen(false); // the details dialog is modal and would sit above the menu
    setCmdOpen(true);
  }, []);
  const [busy, setBusy] = useState<"outlook" | "google" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A2: back from Google's sign-in (Settings > Connections > Connect): say how it went, then drop it from the address.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const g = q.get("google");
    if (!g) return;
    setNotice(g === "connected" ? "Google Calendar connected" : g === "expired" ? "That Google sign-in took too long. Try Connect again" : "Google Calendar didn't connect. Try again");
    q.delete("google");
    history.replaceState(null, "", `${location.pathname}${q.size ? `?${q}` : ""}${location.hash}`);
  }, []);
  // Step 17: after Done in Plan the week, offer Look ahead 4 weeks when it is due (every other Thursday).
  const [offerAhead, setOfferAhead] = useState(false);
  // Notices from work item links (e.g. "Could not start the browser"), shown for a few seconds.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      setNotice((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), 6000);
    };
    window.addEventListener(NOTICE_EVENT, on);
    return () => {
      window.removeEventListener(NOTICE_EVENT, on);
      clearTimeout(timer);
    };
  }, []);
  const [clock, setClock] = useState(() => Date.now());
  const [pd, setPd] = useState<PlanDayState | null>(null);
  /** Step 15.2: the block selected in Plan the day, so menus add to it. */
  const [pdHalf, setPdHalf] = useState<Half | null>(null);
  const [justCommitted, setJustCommitted] = useState(false);
  useEffect(() => setJustCommitted(false), [pd?.date]);
  // Step 13.6: "+ Add work" and A open Plan the day on one block's picker.
  const [pdStart, setPdStart] = useState<{ half: Half; n: number; focus?: number | null; timebox?: boolean } | null>(null);
  const [pdError, setPdError] = useState<string | null>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  // The week the window is on (or moving to), and a counter so a slow older response never overwrites a newer one.
  const weekRef = useRef<string | undefined>(undefined);
  const seq = useRef(0);
  const data = state.kind === "ready" ? state.data : null;
  // IB-1 slice 4: the badge, Today's urgent strip and Week's rail read the same rows (inbox.today).
  const inboxToday = useInboxToday(captureVersion, data);
  const needsYouCount = inboxToday?.needsYou ?? null;
  /** Close out's day (Today › Close out), and Plan the week's week (Week › Plan the week: next week unless asked). */
  const closeOutAt: IsoDate | null = nav.tab === "today" && nav.flow === "closeout" && data ? (nav.date ?? data.planDay.date) : null;
  /** QF-1: the day Today shows (#/today/<date>); null is today. */
  const todayAt: IsoDate | null = nav.tab === "today" && !nav.flow && data && nav.date && nav.date !== data.planDay.date ? nav.date : null;
  const planWeekAt: IsoDate | null = nav.tab === "week" && nav.mode === "commit" && data ? planWeekOf(nav.week, mondayOf(data.planDay.date)) : null;

  // Theme: the config's value once loaded; a change applies at once and is saved, and reverts if saving fails.
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const configTheme = data?.ui.theme;
  useEffect(() => {
    if (configTheme) setThemeState(configTheme);
  }, [configTheme]);
  useEffect(() => applyTheme(theme), [theme]);
  const setTheme = useCallback(
    async (t: Theme) => {
      const before = theme;
      setThemeState(t);
      try {
        await setThemeAction(t);
      } catch (e) {
        setThemeState(before);
        setNotice(`Theme not saved: ${e instanceof Error ? e.message : "unknown error"}`);
      }
    },
    [theme],
  );

  /**
   * Step 15 (D271): H, the menu and the status bar change the view range for this session only; Settings > Display
   * saves the default (saveViewRange). The week is rebuilt with it (the server widens it around planned time).
   */
  const rangeRef = useRef<ViewRange | null>(null);
  const setViewRange = useCallback(async (r: ViewRange) => {
    rangeRef.current = r;
    setNotice(`Timelines: ${VIEW_RANGE_NAMES[r]} for now. Settings > Display sets the default`);
    reloadRef.current();
  }, []);
  const saveViewRange = useCallback(async (r: ViewRange) => {
    try {
      await call("ui.set_view_range", { range: r });
      rangeRef.current = null;
      setNotice(`Timelines default: ${VIEW_RANGE_NAMES[r]}`);
      reloadRef.current();
    } catch (e) {
      setNotice(`Default not saved: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }, []);
  /** Step 17.5: Settings > Display "Reduce motion", mirrored locally so the next opening knows before it loads. */
  useEffect(() => {
    if (data) rememberReduceMotion(data.ui.reduceMotion);
  }, [data?.ui.reduceMotion]);
  const saveReduceMotion = useCallback(async (on: boolean) => {
    try {
      await call("ui.set_reduce_motion", { on });
      rememberReduceMotion(on);
      setNotice(`Reduce motion: ${on ? "on" : "off"}`);
      reloadRef.current();
    } catch (e) {
      setNotice(`Not saved: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }, []);
  /** U5 (D401): text size. Applied at once, then saved in [ui] text_size; the config wins when the week loads. */
  const [textSize, setTextSize] = useState<TextSize>(storedTextSize);
  const textSizeRef = useRef(textSize);
  textSizeRef.current = textSize;
  useEffect(() => {
    if (!data) return;
    setTextSize(data.ui.textSize);
    applyTextSize(data.ui.textSize);
  }, [data?.ui.textSize]);
  const saveTextSize = useCallback(async (s: TextSize) => {
    const before = textSizeRef.current;
    if (s === before) return setNotice(`Text size: ${TEXT_SIZE_NAMES[s]}`);
    setTextSize(s);
    applyTextSize(s);
    try {
      await call("ui.set_text_size", { size: s });
      setNotice(`Text size: ${TEXT_SIZE_NAMES[s]}`);
    } catch (e) {
      setTextSize(before);
      applyTextSize(before);
      setNotice(`Text size not saved: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }, []);
  /**
   * U5.1 (D408): the Personal events switch (G, Week's and Today's ⋯, Settings > Display). Hidden personal events
   * still count in risk and free time; only Week's and Today's rows, chips and rail blocks leave (hidePersonal).
   */
  const [showPersonal, setShowPersonal] = useState(true);
  const showPersonalRef = useRef(showPersonal);
  showPersonalRef.current = showPersonal;
  useEffect(() => {
    if (data) setShowPersonal(data.ui.showPersonal ?? true);
  }, [data?.ui.showPersonal]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveShowPersonal = useCallback(async (show: boolean) => {
    setShowPersonal(show);
    try {
      await call("ui.set_show_personal", { show });
      if (show) setNotice("Personal events shown");
    } catch (e) {
      setShowPersonal(!show);
      setNotice(`Not saved: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }, []);
  const shownData = useMemo(() => (data && !showPersonal ? { ...data, week: hidePersonal(data.week) } : data), [data, showPersonal]);
  /**
   * WK-2: the Board's Timeline toggle (its header button, B, Week's ⋯, the command). Hidden, every card uses its full
   * width for its to-dos and lists its meetings; remembered per person in [ui] show_timelines.
   */
  const [showTimelines, setShowTimelines] = useState(true);
  const showTimelinesRef = useRef(showTimelines);
  showTimelinesRef.current = showTimelines;
  useEffect(() => {
    if (data) setShowTimelines(data.ui.showTimelines ?? true);
  }, [data?.ui.showTimelines]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveShowTimelines = useCallback(async (show: boolean) => {
    setShowTimelines(show);
    try {
      await call("ui.set_show_timelines", { show });
    } catch (e) {
      setShowTimelines(!show);
      setNotice(`Not saved: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }, []);
  // Ctrl+plus, Ctrl+minus, Ctrl+0: step the text size, only when no text field has focus and no dialog is on top
  // (then the browser's own zoom keys do what they always do).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = textSizeKey(e);
      if (!d || isTypingTarget(e.target as HTMLElement | null) || topOverlay(document) === "modal") return;
      e.preventDefault();
      void saveTextSize(d === "reset" ? "default" : stepTextSize(textSizeRef.current, d === "up" ? 1 : -1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [saveTextSize]);
  /** Time model actions (hours for a day, unavailable time, flex sessions): run, then reload the week quietly. */
  const runTime = useCallback(async (action: string, input: Record<string, unknown>): Promise<boolean> => {
    try {
      await call(action, input);
      reloadRef.current();
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't work");
      return false;
    }
  }, []);
  const reloadRef = useRef<() => void>(() => {});
  const openFocusRef = useRef<() => void>(() => {});
  /** Timer actions (step 6c): the server keeps the state; reload to show it. */
  // PK-1: the focus timer's Done ticks its to-do; the offer follows (the refs are set once the week is loaded).
  const timerPickRef = useRef<number | null>(null);
  const tickedRef = useRef<((pickId: number, done: boolean) => void) | null>(null);
  const runTimer = useCallback(async (action: string, input: Record<string, unknown> = {}): Promise<boolean> => {
    try {
      const donePick = action === "timer.done" ? timerPickRef.current : null;
      const r = await call<{ notice?: string }>(action, input);
      if (donePick !== null) tickedRef.current?.(donePick, true);
      if (r?.notice) setNotice(r.notice);
      // Step 10: starting focus (or the next pick) switches to the focus screen, from wherever it was started.
      if ((action === "timer.start" && input.kind !== "break") || action === "timer.next") openFocusRef.current();
      reloadRef.current();
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't work");
      return false;
    }
  }, []);

  /** Start focus (step 10): on a pick (its size's length), or a plain focus timer. */
  const startFocus = useCallback((p: Pick | null) => void runTimer("timer.start", p ? { pickId: p.id } : { kind: "focus" }), [runTimer]);

  /** Loads a week. Data on screen stays put until the new data arrives; a failure keeps it (afterLoad). */
  const load = useCallback(
    async (input: { weekStart?: string; refresh?: boolean; quiet?: boolean }, opts: { selectToday?: boolean; quiet?: boolean; background?: boolean } = {}) => {
      const id = ++seq.current;
      if (input.weekStart) weekRef.current = input.weekStart;
      if (!opts.quiet) setLoading(true);
      try {
        const d = await weekLoad({ ...input, ...(now ? { now } : {}), ...(rangeRef.current ? { viewRange: rangeRef.current } : {}) }, { background: !!opts.background });
        if (id !== seq.current) return undefined;
        weekRef.current = d.weekStart;
        setState((prev) => afterLoad(prev, { kind: "ok", data: d }));
        if (opts.selectToday) setSel({ dayIndex: d.today.dayIndex, half: d.today.half });
        return d;
      } catch (e) {
        if (id !== seq.current) return undefined;
        setState((prev) => afterLoad(prev, e instanceof SessionError ? { kind: "session" } : { kind: "error" }));
        return undefined;
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [now],
  );
  const reloadQuiet = useCallback(() => void load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}) }, { quiet: true }), [load]);
  // Timeboxes (step 12): the Timebox… dialog, Outlook write access (read when first needed), and the write flow.
  const [tbTarget, setTbTarget] = useState<TimeboxTarget | null>(null);
  // Step 13: the collaboration finder's target, and the timebox env for menus built before render.
  const [helpTarget, setHelpTarget] = useState<HelpTarget | null>(null);
  const tbEnvRef = useRef<TimeboxEnv | null>(null);
  const [writeAccess, setWriteAccess] = useState<WriteState | null>(null);
  const accessAsked = useRef(false);
  const loadAccess = useCallback(() => {
    if (accessAsked.current) return;
    accessAsked.current = true;
    call<WriteState>("write.status", {}).then(setWriteAccess, () => (accessAsked.current = false));
  }, []);
  const writes = useWriteFlow(reloadQuiet);
  // Step 14: DevOps writes (preview, confirm, read back) and the way to Settings > Clients for a write PAT.
  const openSettingsRef = useRef<((section?: string, setting?: string) => void) | null>(null);
  // CP-1: the preview names the client (and its color) it writes to.
  const devopsWrites = useDevOpsWriteFlow({
    allowed: data?.devopsWrite ?? [],
    onDone: reloadQuiet,
    openSettings: () => openSettingsRef.current?.("devops", "devops-write"),
    client: { name: (k) => (data ? captureClients(data).find((c) => c.clientKey === k)?.clientName : undefined) ?? k, color: (k) => (data ? clientColor(k, data.clients) : undefined) },
  });
  // PK-1: a to-do checked off offers its DevOps item's done state (never automatically); unchecked, the Undo.
  const doneOffer = useDoneOfferFlow({ allowed: data?.devopsWrite ?? [], ask: (data?.planning.devopsOnDone ?? "ask") === "ask", onDone: reloadQuiet });
  const { ticked } = doneOffer.env;
  tickedRef.current = ticked;
  timerPickRef.current = data?.timer?.pickId ?? null;
  const connectWrite = useCallback(async () => {
    setNotice("Signing in to Microsoft to allow calendar changes");
    try {
      const r = await call<{ status: string; message?: string; url?: string }>("auth.connect_outlook_write", {});
      // A2: the sign-in happens in this tab, through the server's own route.
      if (r.status === "redirect" && r.url?.startsWith("/auth/")) return location.assign(r.url);
      setNotice(r.status === "connected" ? "Outlook reconnected" : (r.message ?? "Sign-in did not finish"));
    } catch {
      setNotice("Sign-in did not finish");
    } finally {
      accessAsked.current = false;
      setWriteAccess(null);
      loadAccess();
      reloadQuiet();
    }
  }, [loadAccess, reloadQuiet]);
  reloadRef.current = reloadQuiet;
  // The week can lose a column (a weekend day emptied) or a slot (an evening removed): keep the selection valid.
  useEffect(() => {
    if (!data) return;
    const days = data.week.days;
    const i = Math.min(sel.dayIndex, days.length - 1);
    const half = validHalf(days[i]!, sel.half);
    if (i !== sel.dayIndex || half !== sel.half) setSel({ dayIndex: i, half });
  }, [data, sel]);

  useEffect(() => {
    void load({}, { selectToday: true });
  }, [load]);

  // Freshness: refetch on window focus (at most once a minute), quietly every 5 minutes, and on "r" or Refresh.
  const auto = useMemo(
    () =>
      createAutoRefresh({
        isHidden: () => document.hidden,
        // DV-1: focus and the timer read DevOps from the store (quiet); R and Refresh make it check now.
        refresh: async (t: RefreshTrigger) => void (await load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}), refresh: true, ...(t === "focus" || t === "interval" ? { quiet: true } : {}) }, { quiet: t === "focus" || t === "interval", background: t === "interval" })),
      }),
    [load],
  );
  useEffect(() => {
    auto.start();
    const onFocus = () => auto.trigger("focus");
    const onVisible = () => document.visibilityState === "visible" && auto.trigger("focus");
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setClock(Date.now()), 30_000);
    return () => {
      auto.stop();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(tick);
    };
  }, [auto]);

  /** [ and ], ‹ ›: the week before or after, in the Week tab (Plan the week steps its own week). */
  const changeWeek = useCallback(
    (n: number) => {
      if (!data) return;
      if (nav.tab === "week" && nav.mode === "commit" && planWeekAt) return goNav(navOf.week("commit", addWeeks(planWeekAt, n)));
      goNav(navOf.week("board", addWeeks(data.weekStart, n)));
    },
    [data, nav, planWeekAt, goNav],
  );
  const goToday = useCallback(() => {
    if (!data) return;
    goNav(navOf.week());
    if (data.today.weekStart === data.weekStart) setSel({ dayIndex: data.today.dayIndex, half: data.today.half });
    else void load({ weekStart: data.today.weekStart }, { selectToday: true });
  }, [data, load, goNav]);

  /** The clock in the configured zone (pinned by ?now= for checks). */
  const zonedNow = useCallback(
    (tz: string) => (now ? Temporal.Instant.from(now).toZonedDateTimeISO(tz) : Temporal.Now.zonedDateTimeISO(tz)),
    [now],
  );
  /**
   * Days with working hours (the time model) or a flex session on the week shown (D127). A flex-only day in another
   * week is found by the server, which refuses or opens it; the stepper below tries the next one on a refusal.
   */
  const hasHours = useCallback(
    (d: IsoDate) => !!data && (hoursOn(data.hours, d).segments.length > 0 || data.week.days.some((x) => x.date === d && x.flexMinutes > 0)),
    [data],
  );
  /** Default day to plan: today on a day with hours before its end, else the next such day (D97, D127). */
  // PTO days are skipped (D106): the ones ahead of today from the server, plus any on the week shown.
  const target = useMemo(() => {
    if (!data) return null;
    const pto = new Set([...data.ptoAhead, ...data.week.days.filter((d) => d.pto).map((d) => d.date)]);
    const now = zonedNow(userZone(data));
    return planTarget(now, dayEndOf(data.hours, now.toPlainDate().toString()) ?? "24:00", pto, hasHours);
  }, [data, zonedNow, clock, hasHours]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The Now strip (slice 4): from the loaded week and today's picks, recomputed on the 30 s clock. */
  const strip = useMemo(() => {
    if (!data || !target) return null;
    const now = zonedNow(userZone(data));
    const date = now.toPlainDate().toString();
    const names = new Map(data.planClients.map((c) => [c.clientKey, c.clientName]));
    return nowStrip({
      now,
      day: data.week.days.find((d) => d.date === date) ?? null,
      picks: data.plan?.[date]?.picks ?? [],
      committed: !!data.plan?.[date]?.committedAt,
      pto: data.ptoAhead.includes(date),
      nextWorkday: target.date !== date ? target.date : null,
      clientName: (k) => names.get(k) ?? k,
      noHoursToday: !hasHours(date),
      sizes: data.planning.sizes,
      timeboxes: data.timeboxes,
    });
  }, [data, target, zonedNow, clock, hasHours]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Opens Plan the day for a date (default: today or the next workday). Moves to that date's week when it isn't
   * on screen. The automatic open is for today only, once per day.
   */
  const showPlanDay = useCallback(
    async (st: PlanDayState) => {
      if (!data) return;
      setPdError(null);
      setDetailsOpen(false);
      const monday = mondayOf(st.date);
      const w = monday !== data.weekStart ? ((await load({ weekStart: monday })) ?? null) : data;
      const dayIndex = Math.max(0, (w ?? data).week.days.findIndex((d) => d.date === st.date));
      const first = (w ?? data).week.days[dayIndex];
      const firstHalf: Half = first ? cardHalves(first)[0]! : "AM";
      setSel((s) => ({ dayIndex, half: s.dayIndex === dayIndex ? s.half : firstHalf }));
      setPd(st);
    },
    [data, load],
  );
  /** Loads Plan the day's state for a date (Today › Plan asks for it); a refusal says why and goes back to Now. */
  const loadPlanDay = useCallback(
    async (date: IsoDate) => {
      if (!data || !data.planDay.available) return void setNotice("The local plan store isn't available, so planning is off");
      try {
        await showPlanDay(await planAction("planday.start", { date }));
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not open planning");
        goNav(navOf.week());
      }
    },
    [data, showPlanDay, goNav],
  );
  /** NV-1: the Board focused on a date (default: today or the next workday), from anywhere. */
  const openPlanDay = useCallback((date?: IsoDate) => goNav(navOf.planDay(date ?? null)), [goNav]);

  /** "+ Add work" and A (step 13.6): the Board focused on that day, with that block's picker. */
  const addWork = useCallback(
    (date: IsoDate, half: Half, focus: number | null = null) => {
      setPdStart((s) => ({ half, n: (s?.n ?? 0) + 1, focus }));
      goNav(planDayNav(date, half));
    },
    [goNav],
  );

  /**
   * QF-1: Timebox my day from Today or the Board's day menu: confirms the day first when it isn't ("Confirm and
   * timebox"), then opens Plan today on it with the same Timebox my day preview (and its one Outlook preview).
   */
  const timeboxDay = useCallback(
    async (date: IsoDate) => {
      if (!data || !data.planDay.available) return void setNotice("The local plan store isn't available, so planning is off");
      try {
        if (!data.plan?.[date]?.committedAt) await planAction("planday.commit", { date });
        await showPlanDay(await planAction("planday.start", { date }));
        reloadQuiet();
        const d = data.week.days.find((x) => x.date === date);
        setPdStart((s) => ({ half: d ? cardHalves(d)[0]! : "AM", n: (s?.n ?? 0) + 1, focus: null, timebox: true }));
        goNav(planDayNav(date));
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Couldn't open Timebox my day");
      }
    },
    [data, showPlanDay, reloadQuiet, goNav],
  );

  /**
   * ← → in Plan the day: the previous or next day that can be planned. Days without working hours and known PTO
   * are skipped here; a PTO day only the server knows of is skipped too (it refuses with 422), up to a few times.
   */
  const stepPlanDay = useCallback(
    async (dir: 1 | -1) => {
      if (!data || !pd) return;
      const pto = new Set([...data.ptoAhead, ...data.week.days.filter((d) => d.pto).map((d) => d.date)]);
      let from = pd.date;
      for (let tries = 0; tries < 5; tries++) {
        const next = stepDay(from, dir, pto, hasHours);
        if (!next) return setPdError(`No day to plan ${dir > 0 ? "after" : "before"} ${shortDay(from)} within a month`);
        try {
          const st = await planAction("planday.start", { date: next });
          await showPlanDay(st);
          return goNav(navOf.planDay(st.date));
        } catch (e) {
          if (!(e instanceof ActionRefusal && e.status === 422)) return setPdError(e instanceof Error ? e.message : "Could not open that day");
          from = next;
        }
      }
    },
    [data, pd, showPlanDay, hasHours, goNav],
  );

  /**
   * Runs a plan action from anywhere (the panel, a "⋯" menu, the command menu). The panel shows its own day's
   * new state; the week view reloads quietly so its checklist matches. False, with a message, on refusal.
   */
  const runPlan = useCallback(
    async (action: string, input: Record<string, unknown>) => {
      try {
        const r = await planAction(action, input);
        setPdError(null);
        if (pd) setPd(r.state?.date === pd.date ? r.state : await planAction("planday.start", { date: pd.date }));
        reloadQuiet();
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "That did not work";
        if (pd) setPdError(msg);
        else setNotice(msg);
        return false;
      }
    },
    [pd, reloadQuiet],
  );

  // HK-3: after Keep, Move to… or Drop on a suggested card in Plan today, its state and the week both read again.
  const refreshPlanDay = useCallback(() => {
    reloadQuiet();
    if (pd) void planAction("planday.start", { date: pd.date }).then((st) => setPd((cur) => (cur?.date === st.date ? st : cur)), () => undefined);
  }, [pd, reloadQuiet]);

  const closePlanDay = useCallback(() => {
    setPd(null);
    setPdError(null);
  }, []);

  // The Board focused on a day: keep Plan the day's state on the day the address asks for (default: today or the next workday).
  const wantPlanDate = planDayFocus && target ? (planDayFocus.date ?? target.date) : null;
  const pdTried = useRef<string | null>(null);
  useEffect(() => {
    if (!wantPlanDate) {
      pdTried.current = null;
      if (pd) closePlanDay();
      return;
    }
    if (pd?.date === wantPlanDate || pdTried.current === wantPlanDate) return;
    pdTried.current = wantPlanDate;
    void loadPlanDay(wantPlanDate);
  }, [wantPlanDate, pd, closePlanDay, loadPlanDay]);

  // The week each place shows: Week its week (this week by default), Plan the week its week, Today and Check-in today's.
  // A focused day loads its own week (showPlanDay).
  const wantWeek = !data ? null : nav.tab === "week" ? (planDayFocus ? null : (planWeekAt ?? nav.week ?? data.today.weekStart)) : nav.tab === "today" && !loc.overlay ? (todayAt ? mondayOf(todayAt) : data.today.weekStart) : null;
  useEffect(() => {
    if (!data || !wantWeek || wantWeek === weekRef.current) return;
    void load({ weekStart: wantWeek }, { selectToday: wantWeek === data.today.weekStart });
  }, [wantWeek]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(async () => {
    if (!pd) return;
    try {
      await planAction("planday.commit", { date: pd.date });
      // Step 15 (D265): the first Done commits. When planned picks still have no time (and timeboxing is on), the view
      // stays open once to offer Timebox my day (D254); otherwise it closes.
      const st = await planAction("planday.start", { date: pd.date });
      const boxed = new Set((data?.timeboxes ?? []).filter((t) => t.date === pd.date && !t.removedAt).map((t) => t.pickId));
      const unboxed = st.picks.some((p) => p.date === pd.date && p.status === "planned" && !boxed.has(p.id));
      reloadQuiet();
      if (unboxed && data?.timeboxSettings.enabled !== false) {
        setPd(st);
        setJustCommitted(true);
      } else {
        setNotice(`Planned ${shortDay(pd.date)}`);
        goNav(afterDone(nav));
      }
    } catch (e) {
      setPdError(e instanceof Error ? e.message : "Couldn't save the plan");
    }
  }, [pd, data, reloadQuiet, goNav, nav]);

  /** Step 15 (D272): demo mode on or off; the server swaps every source and the plan store, then the week reloads. */
  // A2: the demo is its own session. Turning it on starts a demo session in place of this one (sign in again for your own
  // data); turning it off ends the demo session and goes back to the sign-in screen.
  const switchDemo = useCallback(async (on: boolean) => {
    try {
      if (on) await startDemo();
      else await endSession();
      location.replace(`/${location.search}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't switch demo mode");
    }
  }, []);

  /** Tick a committed pick done or not; local status only. Shown at once, put back if the store refuses. */
  const toggle = useCallback(
    (id: number, done: boolean) => {
      setState((prev) => {
        if (prev.kind !== "ready" || !prev.data.plan) return prev;
        const plan = Object.fromEntries(Object.entries(prev.data.plan).map(([d, v]) => [d, { ...v, picks: v.picks.map((p) => (p.id === id ? { ...p, status: done ? ("done" as const) : ("planned" as const) } : p)) }]));
        return { ...prev, data: { ...prev.data, plan } };
      });
      planAction("pick.mark_done", { id, done })
        .then((r) => {
          // PK-1: the store's own pick (client and item) for the offer.
          const p = (r as { pick?: { clientKey: string; itemId: number | null } } | undefined)?.pick;
          if (p) ticked(id, done, p.clientKey, p.itemId);
        })
        .catch(reloadQuiet);
    },
    [reloadQuiet, ticked],
  );

  const connect = useCallback(
    async (src: "outlook" | "google") => {
      setBusy(src);
      setNotice(`Finish signing in to ${src === "outlook" ? "Microsoft" : "Google"} in your browser`);
      try {
        const r = await connectSource(src);
        setNotice(r.status === "connected" ? null : (r.message ?? "Sign-in did not finish"));
        return r.status === "connected";
      } catch {
        setNotice("Sign-in did not finish");
        return false;
      } finally {
        setBusy(null);
        void load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}), refresh: true });
      }
    },
    [load],
  );
  const disconnect = useCallback(
    async (src: "outlook" | "google") => {
      const name = src === "outlook" ? "Outlook" : "Google";
      if (!window.confirm(`Disconnect ${name}? FocusTime forgets its sign-in and cached ${name} events. Nothing changes in ${name}.`)) return;
      await disconnectSource(src).catch(() => setNotice(`Could not disconnect ${name}`));
      void load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}), refresh: true });
    },
    [load],
  );

  /** Week › Plan the week for a week (its Monday); the week loads too, since fit and readiness use it. */
  const openPlanWeek = useCallback((w: IsoDate) => goNav(navOf.week("commit", w)), [goNav]);
  /** fix/planday-pane: the client Plan the week opens on (Plan the day's "plan the week"), until it has. */
  const [planWeekClient, setPlanWeekClient] = useState<string | null>(null);
  const clearPlanWeekClient = useCallback(() => setPlanWeekClient(null), []);

  /** A view by name (the command menu, older entry points): its tab and mode, or an overlay. */
  const setView = useCallback(
    (v: View) => {
      setDetailsOpen(false);
      const r = viewNav(v);
      if (r.overlay) return go((l) => ({ nav: r.nav ?? l.nav, overlay: r.overlay }));
      if (r.nav?.tab === "week" && r.nav.mode === "board" && !r.nav.focus && data) setSel({ dayIndex: data.today.dayIndex, half: data.today.half });
      if (r.nav) goNav(r.nav);
    },
    [go, goNav, data],
  );
  /** P: the current tab's planning mode, or back to its view mode. */
  const togglePlanning = useCallback(() => {
    setDetailsOpen(false);
    go((l) => ({ nav: toggleP(l.nav), overlay: null }));
  }, [go]);
  /** A tab (top bar, 1–4): its default mode. */
  const openTab = useCallback(
    (t: Tab) => {
      setDetailsOpen(false);
      if (t === "week" && data) setSel({ dayIndex: data.today.dayIndex, half: data.today.half });
      goNav(defaultNav(t));
    },
    [goNav, data],
  );
  openFocusRef.current = () => setView("focus");

  // Focus sounds (step 10): the session's choice (else Settings > Focus) plays only while focus runs; a soft chime
  // marks a break when asked for. The choice and volume reset when the timer is cleared.
  const [sessionSound, setSessionSound] = useState<SoundKind | null>(null);
  const [sessionVolume, setSessionVolume] = useState<number | null>(null);
  const prevTimer = useRef<TimerView | null>(null);
  const focusCfg = data?.focus;
  const timerNow = data?.timer ?? null;
  useEffect(() => {
    if (!focusCfg) return;
    sound.setVolume(sessionVolume ?? focusCfg.volume);
    const step = soundStep(prevTimer.current, timerNow, sessionSound ?? focusCfg.sound, focusCfg.onBreak);
    if (step.play) sound.play(step.play, focusCfg.fadeSeconds);
    else sound.stop(focusCfg.fadeSeconds);
    if (step.chime) sound.chime();
    prevTimer.current = timerNow;
    if (!timerNow) {
      setSessionSound(null);
      setSessionVolume(null);
    }
  }, [focusCfg, timerNow, sessionSound, sessionVolume]);

  // A per-second tick only while a timer runs; when it reaches zero locally, reload shortly after so the server's end shows.
  const timerRunning = !!data?.timer?.running;
  useEffect(() => {
    if (!timerRunning) return;
    setSecondMs(Date.now() + skew);
    const id = setInterval(() => setSecondMs(Date.now() + skew), 1000);
    return () => clearInterval(id);
  }, [timerRunning, skew]);
  const timerEndsAt = data?.timer?.running ? data.timer.endsAt : null;
  useEffect(() => {
    if (!timerEndsAt) return;
    const wait = Date.parse(timerEndsAt) - (Date.now() + skew) + 6000;
    const id = setTimeout(() => reloadRef.current(), Math.max(1000, wait));
    return () => clearTimeout(id);
  }, [timerEndsAt, skew]);

  // Step 15.5: a clicked notification opens its view (the server hands the route over like the capture request).
  const openRouteRef = useRef<(route: string) => void>(() => {});
  openRouteRef.current = (text: string) => {
    const r = parseRoute(text);
    if (!r) return;
    setCmdOpen(false);
    setDetailsOpen(false);
    // Step 16.2: each route is a tab and mode (or an overlay); the VM opens Today with the VM menu.
    const { loc: to, vmMenu } = routeLoc(r);
    go(to);
    // The chip's menu, once Today is on screen.
    if (vmMenu) setTimeout(() => window.dispatchEvent(new Event(VM_MENU_EVENT)), 300);
  };

  // The same routes as a page event (browser notifications in a hosted version, and the browser tests).
  useEffect(() => {
    const on = (e: Event) => openRouteRef.current(String((e as CustomEvent).detail ?? ""));
    window.addEventListener(ROUTE_EVENT, on);
    return () => window.removeEventListener(ROUTE_EVENT, on);
  }, []);

  // Step 9: focustime-open --capture leaves a request; take it on load, when the window gains focus, and every few
  // seconds while it has focus (the global key may be pressed while FocusTime is already in front).
  const hasData = !!data;
  useEffect(() => {
    if (!hasData) return;
    if (captureAsked.current) {
      captureAsked.current = false;
      setCaptureOpen(true);
    }
    const check = () => void takeOpenRequest().then((v) => (v === "capture" ? setCaptureOpen(true) : v ? openRouteRef.current(v) : undefined));
    check();
    // P1: a tapped push that opened the app asked for a view.
    const launched = takeLaunchRoute();
    if (launched) openRouteRef.current(launched);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    const id = setInterval(() => document.hasFocus() && check(), 2000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, [hasData]);

  // Running for days: on a new local day, move to it (when showing the week that was current). Nothing opens by itself
  // (step 16.2): the mode switch shows what's due.
  useEffect(() => {
    if (!data) return;
    if (dayRolledOver(zonedNow(userZone(data)), data.planDay.date)) {
      const onTodaysWeek = data.today.weekStart === data.weekStart;
      void load(onTodaysWeek ? {} : { weekStart: data.weekStart }, { selectToday: onTodaysWeek, quiet: true });
    }
  }, [clock]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pd && !cmdOpen && !keysOpen) cellRefs.current.get(`${sel.dayIndex}${sel.half}`)?.focus({ preventScroll: true });
  }, [sel, data?.weekStart, layout, pd, cmdOpen, keysOpen]);

  useEffect(() => {
    const on = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      const r = regionOf(el);
      if (r && r !== "grid") lastInRegion.current.set(r, el);
    };
    document.addEventListener("focusin", on);
    return () => document.removeEventListener("focusin", on);
  }, []);

  /** Focus a region: the selected half-day for the week, else where focus last was there, else its first control. */
  const focusRegion = useCallback(
    (r: Region) => {
      if (r === "grid") return cellRefs.current.get(`${sel.dayIndex}${sel.half}`)?.focus();
      const root = document.querySelector<HTMLElement>(r === "panel" ? (detailsOpen ? ".detail-panel" : ".planday") : r === "top" ? ".topbar" : ".statusbar");
      if (!root) return;
      const last = lastInRegion.current.get(r);
      if (last?.isConnected && root.contains(last) && !last.matches(":disabled")) return last.focus();
      if (r === "panel" && !detailsOpen) return root.focus();
      root.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    },
    [sel, detailsOpen],
  );
  const moveRegion = useCallback(
    (dir: 1 | -1) => focusRegion(nextRegion(regionOf(document.activeElement), regionsAvailable({ planOpen: !!pd, detailsOpen }), dir)),
    [focusRegion, pd, detailsOpen],
  );

  // F6, O and ? work everywhere (capture phase: the ⋯ buttons keep other keys to themselves), except while typing
  // and inside the command menu, the legend and popup menus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cmdOpen || !data) return;
      const t = e.target as HTMLElement | null;
      // Step 13.5: nothing while typing (but F6), nothing behind a dialog or menu (only F6 behind the details).
      if (!globalKeyAllowed(e, t, topOverlay(document))) return;
      const typing = isTypingTarget(t);
      if (e.key === "?" && !typing) {
        // G1: ? opens the Guide (and closes it again); the one-list legend stays in the command menu and ⋯.
        e.preventDefault();
        setDetailsOpen(false);
        setKeysOpen(false);
        go((l) => (l.overlay?.kind === "guide" ? { nav: l.nav, overlay: null } : { nav: l.nav, overlay: { kind: "guide", chapter: null } }));
        return;
      }
      if (keysOpen) return;
      if (e.key === "F6") {
        e.preventDefault();
        moveRegion(e.shiftKey ? -1 : 1);
      } else if ((e.key === "o" || e.key === "O") && !e.shiftKey && !typing) {
        e.preventDefault();
        const target = openTarget(document.activeElement);
        if (target) void openWorkItem(target.clientKey, target.url);
        else setNotice("Focus a work item first (Tab to it), then press O");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cmdOpen, keysOpen, data, moveRegion, go]);

  // Ctrl+K (or Cmd+K) opens the command menu from anywhere, even while Plan the day or details are open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        if (!commandKeyAllowed(topOverlay(document), cmdOpen)) return;
        e.preventDefault();
        setKeysOpen(false);
        if (cmdOpen) setCmdOpen(false);
        else openCommands();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cmdOpen, openCommands]);

  // AS-1: Ctrl+J (or Cmd+J) toggles the assistant from anywhere but behind a dialog; / opens it when no text field has
  // focus and nothing else took it (in Plan today and Week › Plan, / is their Search: those handlers run first).
  useEffect(() => {
    const onChord = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "j" || e.key === "J"))) return;
      if (topOverlay(document) === "modal") return;
      e.preventDefault();
      setAssistantAt((a) => (a ? null : { text: "" }));
    };
    const onSlash = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target as HTMLElement | null)) return;
      if (topOverlay(document) === "modal" || assistantAt || isPlanning(nav)) return;
      e.preventDefault();
      setAssistantAt({ text: "" });
    };
    window.addEventListener("keydown", onChord, true);
    window.addEventListener("keydown", onSlash);
    return () => {
      window.removeEventListener("keydown", onChord, true);
      window.removeEventListener("keydown", onSlash);
    };
  }, [assistantAt, nav]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cmdOpen || keysOpen) return;
      if (!globalKeyAllowed(e, e.target as HTMLElement | null, topOverlay(document))) return;
      const typing = isTypingTarget(e.target as HTMLElement | null);
      const free = !typing && !captureOpen;
      const k = e.key;
      if (loc.overlay && k === "Escape" && !captureOpen) {
        // The focus screen and Settings sit over a place; Esc goes back to it (the timer keeps running). Settings' own
        // shell takes Esc first (ST-1), so its unsaved fields are saved on the way out.
        e.preventDefault();
        go((l) => ({ nav: l.nav, overlay: null }));
      } else if (k === "Escape" && !captureOpen && !pd && isPlanning(nav)) {
        // A planning mode: Esc goes back to the tab's view mode without saving (Plan the day handles its own Esc).
        e.preventDefault();
        goNav(afterDone(nav));
      } else if (settingsAt === null && k === "," && free) {
        e.preventDefault();
        setSettingsAt("");
      } else if (tabForKey(k) && free) {
        // Step 16.2: 1–4 are the tabs in order (T stays Today).
        e.preventDefault();
        openTab(tabForKey(k)!);
      } else if ((k === "p" || k === "P" || k === "i" || k === "I") && free && settingsAt === null) {
        // P toggles the current tab's planning mode (I stays an alias).
        e.preventDefault();
        togglePlanning();
      } else if ((k === "g" || k === "G") && free && settingsAt === null && !loc.overlay && (nav.tab === "week" || nav.tab === "today") && !isPlanning(nav)) {
        // U5.1 (D408): show or hide personal events on Week and Today (saved in config).
        e.preventDefault();
        void saveShowPersonal(!showPersonalRef.current);
      } else if ((k === "b" || k === "B") && free && settingsAt === null && !loc.overlay && nav.tab === "week" && nav.mode === "board" && !isPlanning(nav) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // WK-2: show or hide the Board's timeline (saved for the person).
        e.preventDefault();
        void saveShowTimelines(!showTimelinesRef.current);
      } else if ((k === "l" || k === "L") && free && settingsAt === null) {
        e.preventDefault();
        openTab("inbox");
      } else if ((k === "w" || k === "W") && free && settingsAt === null) {
        e.preventDefault();
        goNav(planWeekAt !== null ? navOf.week("board", nav.tab === "week" ? nav.week : null) : navOf.week("commit"));
      } else if ((k === "e" || k === "E") && free && settingsAt === null) {
        e.preventDefault();
        goNav(closeOutAt !== null ? navOf.today() : navOf.today("closeout"));
      } else if ((k === "m" || k === "M") && free && settingsAt === null) {
        e.preventDefault();
        goNav(checkInOpen ? navOf.today() : navOf.today("checkin"));
      } else if ((e.key === "n" || e.key === "N" || ((e.key === "c" || e.key === "C") && !pd && !e.ctrlKey && !e.metaKey && !e.altKey)) && !typing && !captureOpen) {
        // P1: C opens Capture too, everywhere but Today › Plan, where C is still Done.
        e.preventDefault();
        setCaptureOpen(true);
      } else if ((e.key === "f" || e.key === "F") && !typing) {
        e.preventDefault();
        // Under the Focus button when it is on screen (it hides on narrow widths).
        const r = document.querySelector(".top-btn.timer-btn")?.getBoundingClientRect();
        setTimerMenuAt(r && r.width ? { x: r.right, y: r.bottom + 4 } : { x: Math.round(window.innerWidth / 2) + 160, y: 96 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loc, nav, settingsAt, closeOutAt, checkInOpen, planWeekAt, captureOpen, cmdOpen, keysOpen, pd, detailsOpen, go, goNav, openTab, togglePlanning, setSettingsAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (base !== "week" || (nav.tab === "week" && (nav.mode === "team" || nav.mode === "status")) || focusOpen || guideAt || meetingAt || settingsAt !== null || followUpsOpen || closeOutAt !== null || checkInOpen || planWeekAt !== null || captureOpen || pd || cmdOpen || keysOpen || e.ctrlKey || e.metaKey || e.altKey || !data) return;
      if (!globalKeyAllowed(e, e.target as HTMLElement | null, topOverlay(document)) || isTypingTarget(e.target as HTMLElement | null)) return;
      if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
      const days = data.week.days;
      const halvesOf = (i: number): Half[] => (days[i] ? cardHalves(days[i]) : ["AM", "PM"]);
      const move = (dayIndex: number, half: Half) => {
        e.preventDefault();
        const i = Math.max(0, Math.min(days.length - 1, dayIndex));
        setSel({ dayIndex: i, half: validHalf(days[i]!, half) });
      };
      const step = (dir: 1 | -1) => {
        const hs = halvesOf(sel.dayIndex);
        return move(sel.dayIndex, hs[Math.max(0, Math.min(hs.length - 1, hs.indexOf(sel.half) + dir))]!);
      };
      switch (e.key) {
        case "ArrowLeft": return move(sel.dayIndex - 1, sel.half);
        case "ArrowRight": return move(sel.dayIndex + 1, sel.half);
        case "ArrowUp": return step(-1);
        case "ArrowDown": return step(1);
        case "v":
        case "V":
        case "h":
          // U5.1 (D407): V (H stays an alias) cycles the hours the rails and timelines show, for now.
          e.preventDefault();
          void setViewRange(VIEW_RANGES[(VIEW_RANGES.indexOf(data.week.range.mode) + 1) % VIEW_RANGES.length]!);
          return;
        case "Enter":
        case " ":
          e.preventDefault();
          return setDetailsOpen(true);
        case "a":
        case "A": {
          // Step 13.6 (D241): add work to the selected block (its picker in Plan the day).
          e.preventDefault();
          const d = days[sel.dayIndex];
          const sl = d ? slotOf(d, sel.half) : undefined;
          if (!d || !sl) return;
          if (!canAddWork({ date: d.date, today: data.planDay.date, pto: !!d.pto, off: sl.off })) return setNotice(d.date < data.planDay.date ? "That day is past: its to-dos can only be ticked done or dropped" : d.pto ? "That's a PTO day" : "That block has no working hours");
          return addWork(d.date, sel.half);
        }
        case "r":
          e.preventDefault();
          auto.trigger("key");
          return;
        case "[": return changeWeek(-1);
        case "]": return changeWeek(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, detailsOpen, data, goToday, changeWeek, auto, pd, cmdOpen, keysOpen, openPlanDay, addWork, setViewRange, settingsAt, followUpsOpen, closeOutAt, checkInOpen, planWeekAt, focusOpen, guideAt, meetingAt, base, captureOpen, layout, nav]);

  // QF-1: [ and ] on Today step a day back or ahead (never while typing; Week keeps them for its weeks).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (base !== "today" || nav.tab !== "today" || nav.flow || loc.overlay || cmdOpen || keysOpen || captureOpen || settingsAt !== null || e.ctrlKey || e.metaKey || e.altKey || !data) return;
      if (e.key !== "[" && e.key !== "]") return;
      if (!globalKeyAllowed(e, e.target as HTMLElement | null, topOverlay(document)) || isTypingTarget(e.target as HTMLElement | null)) return;
      e.preventDefault();
      const next = stepWeekday(todayAt ?? data.planDay.date, e.key === "]" ? 1 : -1);
      goNav(navOf.todayOn(next === data.planDay.date ? null : next));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [base, nav, loc.overlay, cmdOpen, keysOpen, captureOpen, settingsAt, data, todayAt, goNav]);

  const work = useMemo(() => workByClient(data?.devops ?? null), [data?.devops]);
  const weekItems = useMemo(() => (data?.weekFeatures ?? []).filter((f) => f.weekStart === data?.weekStart).map((f) => ({ clientKey: f.clientKey, itemId: f.itemId })), [data?.weekFeatures, data?.weekStart]);

  const env = useMemo<MenuEnv | null>(() => {
    if (!data || !target) return null;
    const day = data.week.days[Math.min(sel.dayIndex, data.week.days.length - 1)]!;
    // The command menu offers Disconnect exactly where the status bar does (live calendars only).
    const cal = (src: "outlook" | "google") => {
      const s = data.sources.find((x) => x.source === src);
      return !!s && sourceActions(s).includes("disconnect");
    };
    return {
      week: data.week,
      // Step 15.2: while Plan the day is open, its selected block is the selection (⋯ → Add to the plan targets it).
      selection: (() => {
        const pdDay = pd ? data.week.days.find((d) => d.date === pd.date) : undefined;
        const at = pdDay && pdHalf ? { d: pdDay, half: pdHalf } : { d: day, half: sel.half };
        return { date: at.d.date, half: at.half, clientKey: (at.half === "AM" ? at.d.am : at.half === "PM" ? at.d.pm : at.d.eve)?.focus[0]?.clientKey ?? null };
      })(),
      planWeek: data.plan,
      planState: pd,
      focusNext: focusPick(data.plan?.[data.planDay.date]?.picks ?? [], strip?.half ?? null),
      planTarget: target,
      today: data.planDay.date,
      work,
      calendars: { outlook: cal("outlook"), google: cal("google") },
      runPlan,
      openPlanDay: (d) => void openPlanDay(d),
      ...(data.timeboxSettings.enabled !== false ? { timeboxDay: (d: IsoDate) => void timeboxDay(d) } : {}),
      commitPlan: () => void commit(),
      openDetails: (date, half) => {
        const i = data.week.days.findIndex((x) => x.date === date);
        if (i < 0) return;
        // The details belong to the Week: go there (that week) with the half-day selected.
        goNav(navOf.week("board", data.weekStart));
        setSel({ dayIndex: i, half });
        setDetailsOpen(true);
      },
      openLink: (k, u) => void openWorkItem(k, u),
      changeWeek,
      goToday,
      refresh: () => auto.trigger("button"),
      showSourceStatus: () => {
        const states = data.sources.map((s) => `${SOURCE_NAMES[s.source]}: ${stateOf(s).label}`).join(" · ");
        const causes = causeLines(data.sources, data.devops).map((l) => l.text).join(". ");
        setNotice(causes ? `${states}. ${causes}.` : states);
      },
      connect: (c) => void connect(c),
      disconnect: (c) => void disconnect(c),
      setView,
      // Run after the command menu has closed and handed focus back.
      moveRegion: (dir) => setTimeout(() => moveRegion(dir), 0),
      focusedItem: focusedItem.current,
      showKeys: () => setKeysOpen(true),
      showGuide: (section) => openGuide(section ?? null),
      startTour: (id) => {
        const t = tourById(id);
        if (t) go(() => ({ nav: t.start, overlay: { kind: "tour", id: t.id } }));
      },
      theme,
      setTheme: (t) => void setTheme(t),
      viewRange: data.week.range.mode,
      setViewRange: (r) => void setViewRange(r),
      reduceMotion: data.ui.reduceMotion,
      saveReduceMotion: (on) => void saveReduceMotion(on),
      textSize,
      showPersonal,
      saveShowPersonal: (show) => void saveShowPersonal(show),
      showTimelines,
      saveShowTimelines: (show) => void saveShowTimelines(show),
      saveTextSize: (s) => void saveTextSize(s),
      hours: data.hours,
      runTime,
      planning: data.planning,
      timer: data.timer,
      runTimer,
      openFollowUps: () => setView("follow_ups"),
      openCloseOut: (d) => goNav(navOf.today("closeout", d ?? null)),
      openCheckIn: () => goNav(navOf.today("checkin")),
      openPlanWeek: (w) => (w ? openPlanWeek(w) : setView("planweek")),
      planWeekOpen: planWeekAt,
      openCapture: (kind) => (setCaptureKind(kind ?? null), setCaptureOpen(true)),
      openAssistant: (text) => setAssistantAt({ text: text ?? "" }),
      openCaptures: () => setView("capture"),
      openRitual: togglePlanning,
      commitWeek: () => {
        if (planWeekAt)
          void call("weekplan.commit", { weekStart: planWeekAt }).then(
            () => { setNotice("Week confirmed"); setPlanWeekVersion((n) => n + 1); reloadQuiet(); },
            (e: unknown) => setNotice(e instanceof Error ? e.message : "Couldn't save the week plan"),
          );
      },
      closeOutDate: closeOutAt,
      commitCloseOut: () => {
        if (closeOutAt) void call("closeout.commit", { date: closeOutAt }).then(() => { setNotice("Closed out"); reloadQuiet(); }, (e: unknown) => setNotice(e instanceof Error ? e.message : "Couldn't save Close out"));
      },
      makeUp: async (pickId, input) => {
        try {
          const r = await call<{ flexOffer: { date: string; start: string; end: string } | null; pick: { clientKey: string; title: string }; borrowed: { minutes: number } }>("pick.make_up", { id: pickId, ...input });
          setNotice(`Borrowed ${formatDuration(r.borrowed.minutes)} to make up`);
          const o = r.flexOffer;
          if (o && window.confirm(`Add a flex session ${shortDay(o.date)}, ${o.start} to ${o.end} for ${r.pick.clientKey}? Local only; nothing goes on your calendar.`))
            await call("flex.add", { date: o.date, clientKey: r.pick.clientKey, start: o.start, end: o.end, note: `Make up: ${r.pick.title}`.slice(0, 500) }).catch((e: unknown) => setNotice(e instanceof Error ? e.message : "Could not add the flex session"));
          if (pd) setPd(await planAction("planday.start", { date: pd.date }));
          reloadQuiet();
          return true;
        } catch (e) {
          setNotice(e instanceof Error ? e.message : "That didn't work");
          return false;
        }
      },
      runFollowUps: async (action, input) => {
        try {
          await call(action, input);
          reloadQuiet();
          return true;
        } catch (e) {
          setNotice(e instanceof Error ? e.message : "That didn't work");
          return false;
        }
      },
      borrowed: data.borrowed,
      resetPlan: () => setSettingsAt("data"),
      openVm: () => window.dispatchEvent(new Event(VM_MENU_EVENT)),
      openFeedback: () => setFeedbackOpen(true),
      openNotifications: () => openNotices(),
      openSettings: (section, setting) => {
        setDetailsOpen(false);
        setSettingsAt(section ?? "", setting ?? null);
      },
      openTimebox: (t) => {
        setCmdOpen(false);
        setTbTarget(t);
      },
      connectWrite: () => void connectWrite(),
      eventEdit: data.eventEdit ?? {},
      canWrite: !!data.canWrite,
      editEvent: (input) => void writes.edit(input),
      rsvp: (input) => void writes.rsvp(input),
      openOutlook: (url) => void call<Opened>("outlook.open", { url }).then(openChecked).catch((e: unknown) => setNotice(e instanceof Error ? e.message : "Could not open Outlook")),
      timeboxChange: (action, input) => void (tbEnvRef.current && tbChange(tbEnvRef.current, action, input)),
      startTimeboxFocus: (tb) => void runTimer("timer.start", { timeboxId: tb.id }).then((ok) => ok && setFocusOpen(true)),
      openHelp: (t) => {
        setCmdOpen(false);
        setHelpTarget(t);
      },
      invites: data.invites ?? [],
      undoWrite: (id) => void writes.undo(id),
      tz: userZone(data.week),
      timeboxes: data.timeboxes,
      now: now ?? new Date(clock).toISOString(),
      addWork,
      planFeature: (date: IsoDate, half: Half, itemId: number) => addWork(date, half, itemId),
      demo: data.demo,
      admin: isAdmin === true,
      asksOpen,
      setDemo: (on: boolean) => void switchDemo(on),
      exportPlan: () =>
        void call<{ path: string }>("data.export", {}).then(
          (r) => setNotice(`Plan exported to ${r.path}`),
          (e: unknown) => setNotice(e instanceof Error ? e.message : "Export failed"),
        ),
    };
  }, [data, target, sel, openGuide, pd, pdHalf, work, runPlan, openPlanDay, commit, closePlanDay, changeWeek, goToday, auto, connect, disconnect, setView, moveRegion, cmdOpen, theme, setTheme, setViewRange, runTime, runTimer, closeOutAt, reloadQuiet, planWeekAt, openPlanWeek, togglePlanning, connectWrite, addWork, timeboxDay, goNav, asksOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // AS-1: what the assistant hears about the screen: its address, the client and item in focus, the selected block and
  // today. Nothing else on screen is sent; the server reads what a question needs.
  const assistantContext = useMemo<AssistantContext>(() => {
    const c: AssistantContext = { screen: hashOf(loc) };
    const clientKey = env?.selection.clientKey;
    if (clientKey) c.clientKey = clientKey;
    if (loc.nav.tab === "ahead" && loc.nav.item) c.itemId = loc.nav.item;
    if (env) c.block = { date: env.selection.date, half: env.selection.half === "PM" ? "PM" : "AM" };
    if (data?.planDay.date) c.date = data.planDay.date;
    return c;
  }, [loc, env, data?.planDay.date]);
  openSettingsRef.current = env?.openSettings ?? null;

  // Step 17.5: the opening (loader, unroll, into the top bar's mark), then the welcome moment on the first launch ever.
  const opening = <Opening key="opening" ready={state.kind !== "loading"} lines={sourceLines(data?.sources ?? null, data?.devops)} onFinished={afterOpening} />;

  if (state.kind === "session") {
    return (
      <div className="center-note">
        {opening}
        <h1>Signed out</h1>
        <p>Your FocusTime session ended. Sign in again to continue; your plan is as you left it.</p>
        <SignInAgainButton />
      </div>
    );
  }
  if (!data || !env || !target) {
    return (
      <>
        {opening}
        {state.kind === "failed" && <div className="center-note"><p>Nothing to show without a connection. Reload when you’re back online.</p></div>}
      </>
    );
  }

  const { week } = shownData ?? data;
  const day = week.days[Math.min(sel.dayIndex, week.days.length - 1)]!;
  const slot = slotOf(day, validHalf(day, sel.half)) ?? day.am;
  // Weekend: "Today" shows the coming week (D36), so say so.
  const localToday = data.planDay.date;
  // The real date only: on a weekend the Today key shows next week, but no day there is badged "Today".
  const today = week.days.some((d) => d.date === localToday) ? localToday : "";
  const weekendNote = Temporal.PlainDate.from(localToday).dayOfWeek >= 6 && data.weekStart === data.today.weekStart ? `Today is ${shortDay(localToday)} · showing next week` : null;
  // IB-1: the badge is Needs you, the server's one count (conversations, promises new or due, sends waiting).
  const inboxCount = needsYouCount ?? 0;
  const borrowWeek = borrowedSummary(data.borrowed, week.days[0]!.date, week.days.at(-1)!.date);
  // The running timer's pick and client, for the top bar timer and the focus screen (client color).
  const timerPick = data.timer?.pickId != null ? Object.values(data.plan ?? {}).flatMap((d) => d.picks).find((p) => p.id === data.timer!.pickId) ?? null : null;
  const timerClient = timerPick ? (data.planClients.find((c) => c.clientKey === timerPick.clientKey)?.clientName ?? timerPick.clientKey) : null;
  const timerColor = timerPick ? clientColor(timerPick.clientKey, data.clients) : "var(--accent)";

  const samples = new Set(data.sources.filter((s) => s.sample).map((s) => s.source));

  // Step 16.2: the mode switches. Today's modes show ✓ and due dots for the day they are on; Plan the week for its week.
  const zn = zonedNow(userZone(data));
  const statusDay: IsoDate = planDayFocus ? (pd?.date ?? planDayFocus.date ?? target.date) : closeOutAt ?? localToday;
  const sh = hoursOn(data.hours, statusDay);
  const statusPlan = data.plan?.[statusDay] ?? null;
  const dayStatus = dayModeStatus({
    date: statusDay,
    today: zn.toPlainDate().toString(),
    time: zn.toPlainTime().toString({ smallestUnit: "minute" }),
    workday: statusDay === localToday ? data.planDay.workday : sh.segments.length > 0 && !week.days.find((d) => d.date === statusDay)?.pto,
    amEnd: sh.am?.end ?? null,
    pmStart: sh.pm?.start ?? null,
    end: dayEndOf(data.hours, statusDay),
    committed: !!(pd?.date === statusDay ? pd.plan.committedAt : statusPlan?.committedAt),
    checkedIn: data.checkIn.date === statusDay && data.checkIn.done,
    closedOut: data.closeOut.date === statusDay ? data.closeOut.done : !!statusPlan?.closedOutAt,
    checkinOffsetMinutes: data.planning.checkinReminderMinutes,
    closeoutLeadMinutes: data.planning.closeoutReminderMinutes,
  });
  const thisMonday = mondayOf(localToday);
  const weekToPlan = planWeekAt ?? planWeekOf(null, thisMonday);
  // NV-1: today's card for the moment of the day (Plan today, Midday check-in or Close out), from today's facts.
  const th = hoursOn(data.hours, localToday);
  const todayPlan = data.plan?.[localToday] ?? null;
  const moment = momentCard({
    date: localToday,
    today: zn.toPlainDate().toString(),
    time: zn.toPlainTime().toString({ smallestUnit: "minute" }),
    workday: data.planDay.workday,
    amEnd: th.am?.end ?? null,
    pmStart: th.pm?.start ?? null,
    end: dayEndOf(data.hours, localToday),
    committed: !!(pd?.date === localToday ? pd.plan.committedAt : todayPlan?.committedAt),
    checkedIn: data.checkIn.date === localToday && data.checkIn.done,
    closedOut: data.closeOut.date === localToday ? data.closeOut.done : !!todayPlan?.closedOutAt,
    checkinOffsetMinutes: data.planning.checkinReminderMinutes,
    closeoutLeadMinutes: data.planning.closeoutReminderMinutes,
  });
  const switches: Record<Tab, React.ReactNode> = {
    today: null,
    week: (
      <ModeSwitch
        tab="week"
        current={nav.tab === "week" ? nav.mode : "board"}
        status={{ board: dayStatus.plan === "due" ? "due" : null, commit: weekModeStatus(!!data.weekCommitted[weekToPlan], data.weekNudge.badge, weekToPlan) }}
        onMode={(m: ModeName) => goNav(m === "board" ? navOf.week("board") : m === "team" ? navOf.week("team") : m === "status" ? navOf.week("status") : navOf.week("commit"))}
      />
    ),
    ahead: <ModeSwitch tab="ahead" current={nav.tab === "ahead" ? nav.mode : "grid"} status={{ gantt: data.aheadDue.length ? "due" : null }} onMode={(m: ModeName) => goNav(modeNav("ahead", m))} />,
    inbox: null,
  };
  // AH-3: Ahead's switch with Fix next's count, given by Ahead once it knows it.
  const aheadSwitch = (counts: Partial<Record<ModeName, number>>) => <ModeSwitch tab="ahead" current={nav.tab === "ahead" ? nav.mode : "grid"} status={{ gantt: data.aheadDue.length ? "due" : null }} counts={counts} onMode={(m: ModeName) => goNav(modeNav("ahead", m))} />;
  const leavePlanning = () => goNav(afterDone(nav));
  const tbEnv: TimeboxEnv = {
    timeboxes: data.timeboxes,
    settings: data.timeboxSettings,
    colors: data.clients,
    tz: userZone(week),
    access: writeAccess,
    loadAccess,
    changed: reloadQuiet,
    sync: writes.sync,
    syncMany: writes.syncMany,
    undo: writes.undo,
    retry: writes.retry,
    open: (t) => setTbTarget(t),
    startFocus: (tb) => void runTimer("timer.start", { timeboxId: tb.id }).then((ok) => ok && setFocusOpen(true)),
    connectWrite: () => void connectWrite(),
    help: (t) => setHelpTarget(t),
    invites: data.invites ?? [],
  };
  tbEnvRef.current = tbEnv;

  return (
    <>
    {opening}
    {welcome && <MomentOverlay line="Welcome to FocusTime. Here's your week." onDone={() => setWelcome(false)} />}
    {closing && <CloseReverse musts={closing.musts} onDone={() => setClosing(null)} />}
    <SampleSources.Provider value={samples}>
    <DevOpsWork.Provider value={work}>
    <WeekItems.Provider value={weekItems}>
    <PlanCtx.Provider value={{ week: data.plan, toggle, sizes: data.planning.sizes, minSizes: data.planning.minSizes, focused: data.focused, timer: data.timer, nowMs: secondMs, resumeNotes: data.resumeNotes, resumeOn: resumeSlots(week.days, data.resumeNotes, data.planDay.date), weekFeatures: data.weekFeatures, timeboxes: data.timeboxes, followUps: data.followUps, today: data.planDay.date, checkins: data.checkins ?? [] }}>
    <TimeboxCtx.Provider value={tbEnv}>
    <DevOpsWriteCtx.Provider value={devopsWrites.env}>
    <DoneOfferCtx.Provider value={doneOffer.env}>
    <MenuHost env={env}>
    <VmProvider onSettings={() => setSettingsAt("connections", "vm")}>
    <DraftEditorCtx.Provider value={setDraftEdit}>
    <CreateDraftCtx.Provider value={setCreateDraft}>
    <WeekDndProvider
      data={data}
      week={week}
      now={now ?? new Date(clock).toISOString()}
      onChanged={reloadQuiet}
      onRefresh={() => void load({ ...(weekRef.current ? { weekStart: weekRef.current } : {}), refresh: true }, { quiet: true })}
      onOpenSlot={(date, half) => {
        // PV-1: "Planned · Thu AM" opens that block's panel.
        const dayIndex = week.days.findIndex((d) => d.date === date);
        if (dayIndex < 0) return;
        setSel({ dayIndex, half });
        setPanelFocus(null);
        setDetailsOpen(true);
      }}
    >
    <div className={`app ${layout}${compact ? " compact" : ""}${phone ? " phone" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <button type="button" className="brand-home" onClick={() => setView("today")} title="Today">
            <WeekMark height={18} />
            <span className="name">FocusTime</span>
          </button>
          {data.demo && (
            <button type="button" className="demo-tag" onClick={() => setSettingsAt("data", "demo-reset")} title="Demo mode: fictional data, nothing leaves FocusTime. Settings › Your data has Reset demo">
              {phone ? "Demo" : "Demo data"}
            </button>
          )}
        </div>
        {!phone && <nav className="views" aria-label="Tabs">
          {TABS.map((t, n) => (
            <button key={t} type="button" className="view-tab" aria-current={nav.tab === t && !loc.overlay ? "page" : undefined} onClick={() => openTab(t)} title={TAB_TITLES[t] + ` (${n + 1})`}>
              {TAB_NAMES[t]}
              {t === "inbox" && inboxCount > 0 && <span className="count" aria-label={`${inboxCount} need you`}>{inboxCount}</span>}
            </button>
          ))}
        </nav>}
        <div className="top-actions">
          <VmChip dot={phone} />
          {phone && <>
          {/* NV-1: on the phone, Capture and ⋯ sit here (the bottom bar holds the four tabs). */}
          <button type="button" className="top-btn phone-capture" onClick={() => setCaptureOpen(true)} aria-label="Capture" title="Quick capture: one line, saved at once">
            +
          </button>
          <button type="button" className="top-btn phone-assistant" data-tour="ask" onClick={() => setAssistantAt((a) => (a ? null : { text: "" }))} aria-label="Assistant" aria-expanded={!!assistantAt} title="Ask the assistant">
            <AssistantMark />
          </button>
          <button
            type="button"
            className="top-btn top-more"
            aria-haspopup="menu"
            aria-label="More: notifications, focus, Settings and the Guide"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPhoneMoreAt({ x: r.right, y: r.bottom + 4 });
            }}
          >
            ⋯
            {notices.unread > 0 && <span className="top-dot" aria-label={`${notices.unread} new notifications`} />}
          </button>
          </>}
          {!phone && <>
          {/* Step 15.2: Focus is always here. Idle it opens the start menu (next pick first); running it is the countdown. */}
          {data.timer ? (
            <TopTimer
              t={data.timer}
              nowMs={secondMs}
              color={timerColor}
              client={timerClient}
              onClick={() => setView("focus")}
            />
          ) : (
            <button
              type="button"
              className="top-btn timer-btn"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setTimerMenuAt({ x: r.right, y: r.bottom + 4 });
              }}
              title="Start focus: the next to-do, or a plain timer (F)"
              aria-haspopup="menu"
            >
              Focus <kbd>F</kbd>
            </button>
          )}
          <button type="button" className="top-btn capture-btn" onClick={() => setCaptureOpen(true)} title="Quick capture: one line, saved at once (N)">
            Capture <kbd>N</kbd>
          </button>
          <button type="button" className="top-btn assistant-btn" data-tour="ask" onClick={() => setAssistantAt((a) => (a ? null : { text: "" }))} aria-expanded={!!assistantAt} title="Ask the assistant: look things up, or ask for a change you confirm (Ctrl J or /)">
            Ask <kbd>Ctrl J</kbd>
          </button>
          <button
            type="button"
            className="top-btn top-more"
            aria-haspopup="menu"
            aria-label="More: the Guide, commands and keyboard shortcuts"
            title="Guide (?), commands (Ctrl K) and keyboard shortcuts"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMoreAt({ x: r.right, y: r.bottom + 4 });
            }}
          >
            ⋯
            {notices.unread > 0 && <span className="top-dot" aria-label={`${notices.unread} new notifications`} />}
          </button>
          </>}
          <PersonChip
            onOpen={(at, step) => setPersonMenu({ at, step })}
            onSettings={() => setSettingsAt(settingsAt === null ? "" : null)}
            menuOnly={phone}
          />
        </div>
      </header>

      {!data.config.ok && (
        <div className="config-banner" role="alert">
          <strong>{data.config.created ? "FocusTime created a starter config. Fill it in to show your week." : "Config needs attention. Focus blocks are hidden until it is fixed."}</strong>
          <span className="muted"> {data.config.path}</span>
          <ul>
            {data.config.errors.map((e) => (
              <li key={e.field}>
                <code>{e.field}</code> {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {offerAhead && nav.tab === "week" && nav.mode === "board" && !planDayFocus && data.aheadDue.includes("plan_ahead") && (
        <div className="ahead-offer" role="status">
          <span>Next week is planned. Look ahead 4 weeks: blocks per week and dates.</span>
          <button type="button" className="primary" onClick={() => (setOfferAhead(false), goNav(navOf.ahead("gantt")))}>
            Look ahead 4 weeks
          </button>
          <button type="button" className="quiet" onClick={() => setOfferAhead(false)}>
            Not now
          </button>
        </div>
      )}

      {tourAt && (
        <Suspense fallback={null}>
          <Tour
            key={tourAt.id}
            tour={tourAt}
            phone={phone}
            onEnd={(to) => go((l) => ({ nav: l.nav, overlay: to === "guide" ? { kind: "guide", chapter: tourAt.section } : null }))}
            onNav={(nav) => go(() => ({ nav, overlay: { kind: "tour", id: tourAt.id } }))}
          />
        </Suspense>
      )}
      {showTour && (
        <div className="today-tour">
          <TourLink onOpen={() => (endTourOffer(), openGuide())} onDismiss={endTourOffer} />
        </div>
      )}
      {settingsAt !== null ? (
        <Settings
          section={settingsAt}
          setting={settingAt}
          onSection={(s, setting) => setSettingsAt(s, setting ?? null)}
          onGuide={() => openGuide()}
          onClose={() => setSettingsAt(null)}
          onSaved={reloadQuiet}
          onNotice={setNotice}
          sources={data.sources}
          devops={data.devops}
          busy={busy}
          loading={loading}
          onRefresh={() => auto.trigger("button")}
          onConnect={(src) => {
            // Step 17.5: a calendar that was down and reconnects here gets the fun moment.
            const wasDown = data.sources.some((s) => s.source === src && s.status !== "ok");
            void connect(src).then((ok) => {
              if (!ok || !wasDown) return;
              setReconnected(src);
              setTimeout(() => setReconnected((r) => (r === src ? null : r)), 6000);
            });
          }}
          onDisconnect={(src) => void disconnect(src)}
          reconnected={reconnected}
          theme={theme}
          setTheme={(t) => void setTheme(t)}
          viewRange={data.ui.viewRange}
          setViewRange={(r) => void saveViewRange(r)}
          reduceMotion={data.ui.reduceMotion}
          setReduceMotion={(on) => void saveReduceMotion(on)}
          showPersonal={showPersonal}
          setShowPersonal={(show) => void saveShowPersonal(show)}
          textSize={textSize}
          setTextSize={(s) => void saveTextSize(s)}
          demo={data.demo}
          setDemo={(on) => void switchDemo(on)}
          runTime={runTime}
          onSetup={(step) => setSetupAt(step)}
        />
      ) : guideAt ? (
        <Suspense fallback={null}>
          <Guide
            chapter={guideAt.chapter}
            onClose={() => go((l) => ({ nav: l.nav, overlay: null }))}
            onSection={(id) => go((l) => ({ nav: l.nav, overlay: { kind: "guide", chapter: id } }))}
            onTour={(id) => {
              const t = tourById(id);
              if (t) go(() => ({ nav: t.start, overlay: { kind: "tour", id: t.id } }));
            }}
            checklist={guideChecklist}
          />
        </Suspense>
      ) : meetingAt ? (
        <Meetings occurrence={meetingAt.occurrence} colors={data.clients} onOpen={(id) => go((l) => ({ nav: l.nav, overlay: { kind: "meeting", occurrence: id } }))} onClose={() => go((l) => ({ nav: l.nav, overlay: null }))} />
      ) : focusOpen ? (
        <FocusScreen
          t={data.timer}
          nowMs={secondMs}
          pick={timerPick}
          client={timerClient}
          color={timerColor}
          event={strip?.event ?? null}
          onTimer={(a) => {
            // Done and Stop end focus: back to Today (the next step is there).
            void runTimer(a).then((ok) => ok && (a === "timer.done" || a === "timer.stop") && setView("today"));
          }}
          onStart={() => startFocus(focusPick(data.plan?.[data.planDay.date]?.picks ?? [], strip?.half ?? null))}
          onClose={() => setView("today")}
          onDeep={(on) => void runTimer("timer.deep", { on })}
          sound={
            <SoundControl
              settings={data.focus}
              media={data.media}
              choice={sessionSound ?? data.focus.sound}
              onChoice={(k) => {
                void sound.unlock();
                setSessionSound(k);
              }}
              volume={sessionVolume ?? data.focus.volume}
              onVolume={setSessionVolume}
              onPlaylist={(name) => void runTimer("playlist.open", { name })}
              blocked={sound.blocked}
              onUnlock={() => void sound.unlock()}
            />
          }
        />
      ) : planWeekAt !== null ? (
        <PhoneGate phone={phone} onBack={leavePlanning} backLabel="Back to Week"><PlanWeek openClient={planWeekClient} onOpenClientSeen={clearPlanWeekClient} switcher={switches.week} weekStart={planWeekAt} data={data} version={planWeekVersion} now={now ?? new Date(clock).toISOString()} onWeek={openPlanWeek} onClose={() => (setOfferAhead(true), leavePlanning())} onChanged={reloadQuiet} onCaptures={() => setView("capture")} onOpenDay={(d, h) => goNav(navOf.planDay(d, h))} /></PhoneGate>
      ) : nav.tab === "week" && nav.mode === "status" ? (
        // SR-1: Week › Status; Preview only on the phone (writing is for a wider screen).
        <StatusView switcher={switches.week} colors={data.clients} readOnly={phone} version={planWeekVersion} onChanged={reloadQuiet} />
      ) : nav.tab === "week" && nav.mode === "team" ? (
        // SW-1: Week › Team, read-only on the phone (allowed there, no gate).
        <TeamView switcher={switches.week} weekStart={nav.week ?? data.today.weekStart} thisWeek={data.today.weekStart} colors={data.clients} readOnly={phone} onWeek={(w) => goNav(navOf.week("team", w))} version={planWeekVersion} onChanged={reloadQuiet} />
      ) : followUpsOpen ? (
        <div className="inbox-page">
          {nav.tab === "inbox" && <InboxPage nav={nav} data={data} version={captureVersion} onNav={goNav} onChanged={reloadQuiet} onFeedback={() => setFeedbackOpen(true)} />}
        </div>
      ) : roadmapOpen ? (
        nav.tab === "ahead" ? (
          <PhoneGate phone={phone}><Ahead data={data} mode={nav.mode} item={nav.item ?? null} switcher={switches.ahead} renderSwitch={aheadSwitch} onChanged={reloadQuiet} readOnly={phone} /></PhoneGate>
        ) : null
      ) : planDayFocus ? (
        pd && week.days.some((d) => d.date === pd.date) ? (
          (() => {
            const dayIndex = week.days.findIndex((d) => d.date === pd.date);
            const fri = week.days[4]!.date;
            return (
                    // NV-1 (narrowing D476): Plan today works on the phone too, so no read-only gate here. HK-3: inside the
                    // Board's CarryProvider, so a pick suggested in one of this day's blocks is the same dashed card here.
                    <CarryProvider active={data.weekStart === data.today.weekStart} version={pd} week={week} now={now ?? new Date(clock).toISOString()} onChanged={refreshPlanDay}>
                    <PlanDay
                      switcher={switches.week}
                      key={pd.date}
                      day={week.days[dayIndex]!}
                      state={pd}
                      which={pd.date === target.date && !target.isToday ? "Next workday" : null}
                      today={localToday}
                      friday={fri === pd.date ? null : fri}
                      nextDay={(() => {
                        const next = stepDay(pd.date, 1, new Set([...data.ptoAhead, ...week.days.filter((d) => d.pto).map((d) => d.date)]), hasHours);
                        if (!next) return null;
                        const label = Temporal.PlainDate.from(pd.date).add({ days: 1 }).toString() === next ? "tomorrow" : Temporal.PlainDate.from(next).toLocaleString("en-US", { weekday: "short" });
                        return { date: next, label };
                      })()}
                      now={now ?? new Date(clock).toISOString()}
                      tz={userZone(week)}
                      colors={data.clients}
                      clients={data.planClients}
                      error={pdError}
                      act={runPlan}
                      onCommit={() => void commit()}
                      justCommitted={justCommitted}
                      onCommitSeen={() => setJustCommitted(false)}
                      onClose={leavePlanning}
                      onStep={(dir) => void stepPlanDay(dir)}
                      start={pdStart}
                      onSelectBlock={setPdHalf}
                      onPlanWeek={(clientKey) => {
                        // The week this day is in (the line says "this week").
                        setPlanWeekClient(clientKey);
                        openPlanWeek(week.days[0]!.date);
                      }}
                    />
                    </CarryProvider>
          );
          })()
        ) : (
          <main className="today-view" aria-label="Plan">
            <header className="page-head">
              <h2>Plan</h2>
              <ModeArea>{switches.week}</ModeArea>
            </header>
            <p className="muted">{pdError ?? "Opening the plan…"}</p>
          </main>
        )
      ) : base === "today" ? (
        <Today
          viewDate={todayAt}
          onDay={(d) => goNav(navOf.todayOn(d && d !== data.planDay.date ? d : null))}
          onTimebox={(d) => void timeboxDay(d)}
          onCloseOutOn={(d) => goNav(navOf.today("closeout", d))}
          data={shownData ?? data}
          strip={strip}
          target={target}
          now={now ?? new Date(clock).toISOString()}
          nowMs={secondMs}
          mode={nav.tab === "today" && nav.flow ? nav.flow : "now"}
          moment={moment}
          onCheckIn={() => goNav(navOf.today("checkin"))}
          onCloseOut={() => goNav(navOf.today("closeout"))}
          closeOutDate={closeOutAt}
          wide={layout === "wide"}
          showPersonal={showPersonal}
          onShowPersonal={(show) => void saveShowPersonal(show)}
          onStart={startFocus}
          onFocusScreen={() => setView("focus")}
          onTimer={(a) => void runTimer(a)}
          onPlan={(d) => openPlanDay(d)}
          onPlanWeek={() => openPlanWeek(data.today.weekStart)}
          inbox={inboxToday?.items ?? null}
          needsYou={needsYouCount}
          onItem={(key) => goNav(navOf.inboxItem(key))}
          onNeedsYou={() => goNav(navOf.inboxView("needs_you"))}
          switcher={switches.today}
          onInbox={() => setView("follow_ups")}
          onAsks={(id) => (id ? goNav(navOf.conversation(id)) : setView("conversations"))}
          onPromises={(id) => (id ? goNav(navOf.promise(id)) : setView("my_promises"))}
          onCaptures={() => setView("capture")}
          onRetry={() => auto.trigger("button")}
          onFix={() => setSettingsAt("connections")}
          onSettings={(section) => setSettingsAt(section as never)}
          onChanged={reloadQuiet}
          onLeave={(msg) => (msg && setNotice(msg), leavePlanning())}
          onCloseOutDate={(d) => goNav(navOf.today("closeout", d))}
          onClosedOut={(st) => setClosing({ musts: st.date === st.today && mustsDone(st.picks, data.weekFeatures) })}
          setupLine={setupView?.line ?? null}
          onSetup={(step) => setSetupAt(step)}
        />
      ) : (
        <>
          <header className="page-head week-head">
            <div className="ph-title">
              <span className="pd-step" role="group" aria-label="Week">
                <button type="button" onClick={() => changeWeek(-1)} aria-label="Previous week" title="Previous week ([)">‹</button>
                <button type="button" onClick={() => changeWeek(1)} aria-label="Next week" title="Next week (])">›</button>
              </span>
              <h2>Week of {weekLabel(week.days[0]!.date, week.days[4]!.date)}</h2>
              {data.weekStart !== data.today.weekStart && (
                <button type="button" className="mini today-btn" onClick={goToday} title="Back to this week">
                  This week
                </button>
              )}
              {weekendNote && <span className="weekend-note">{weekendNote}</span>}
              {(borrowWeek.totalMinutes > 0 || borrowWeek.unpaid > 0) && (
                <button
                  type="button"
                  className="borrow-chip"
                  title="Borrowed time: slipped focus you said you'd make up"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setBorrowMenuAt({ x: r.left, y: r.bottom + 4 });
                  }}
                >
                  {borrowWeek.unpaid ? `${formatDuration(borrowWeek.unpaidMinutes)} to make up` : `Borrowed ${formatDuration(borrowWeek.totalMinutes)}, paid`}
                </button>
              )}
              <MustsSummary musts={weekMusts(data, data.weekStart, data.weekStart === data.today.weekStart ? (now ?? new Date(clock).toISOString()) : null).rows} colors={data.clients} onPlanWeek={() => openPlanWeek(data.weekStart)} />
              <MoreButton
                label="View options for Week"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setWeekMoreAt({ x: r.left, y: r.bottom + 4 });
                }}
              />
            </div>
            <ModeArea>
              {data.weekStart === data.today.weekStart && data.planDay.workday && (
                <button type="button" className="mini plan-today-btn" onClick={() => openPlanDay(target.isToday ? target.date : undefined)} title="The Board focused on today: put stories into today's blocks, then Confirm today">
                  {target.isToday ? "Plan today" : "Plan the next workday"}
                </button>
              )}
              <TimelineToggle shown={showTimelines} onToggle={() => void saveShowTimelines(!showTimelines)} />
              {switches.week}
            </ModeArea>
          </header>
      <CarryProvider active={data.weekStart === data.today.weekStart} version={data} week={week} now={now ?? new Date(clock).toISOString()} onChanged={reloadQuiet}>
      {data.weekStart === data.today.weekStart && <CarrySummary colors={data.clients} nameOf={(k) => data.planClients.find((c) => c.clientKey === k)?.clientName ?? k} />}
      {data.weekStart === data.today.weekStart && <FromLastWeek version={data} colors={data.clients} nameOf={(k) => data.planClients.find((c) => c.clientKey === k)?.clientName ?? k} weekStart={data.weekStart} week={week} today={data.planDay.date} onChanged={reloadQuiet} />}
      <WeekGrid
        week={week}
        colors={data.clients}
        minFocusWindow={data.thresholds.minFocusWindowMinutes}
        today={today}
        now={now ?? new Date(clock).toISOString()}
        selection={sel}
        cellRefs={cellRefs.current}
        layout={layout}
        compact={compact}
        onPlanDay={(d) => goNav(planDayNav(d))}
        promises={railItems(inboxToday?.items ?? [])}
        onPromise={(key) => goNav(navOf.inboxItem(key))}
        onLate={(client) => goNav(navOf.inboxLate(client))}
        onAddWork={addWork}
        onAddHours={() => {
          setDetailsOpen(false);
          setSettingsAt("hours");
        }}
        panelOpen={detailsOpen && !planWeekAt && !pd}
        timeline={showTimelines}
        onSelect={(s) => setSel(s)}
        onOpen={(s, focus) => {
          setSel(s);
          setPanelFocus(focus ?? null);
          setDetailsOpen(true);
        }}
      />
      </CarryProvider>
        </>
      )}

      <StatusBar
        sources={data.sources}
        devops={data.devops}
        hours={data.hours}
        loading={loading}
        busy={busy}
        notice={notice ?? (state.kind === "ready" ? state.refreshError ?? null : null)}
        extra={
          !showPersonal && (base === "week" || base === "today") && !planWeekAt && !pd ? (() => {
            // Week counts the week's personal events, Today today's.
            const n = personalCount(base === "today" ? data.week.days.filter((d) => d.date === data.planDay.date) : data.week.days);
            return (
              <button type="button" className="status-chip personal-hidden" onClick={() => void saveShowPersonal(true)} title="Personal events are hidden on Week and Today. They still count in risk and free time. Click or press G to show them">
                {n} personal hidden
              </button>
            );
          })() : null
        }
        clock={clock}
        onRefresh={() => auto.trigger("button")}
        onConnect={(src) => void connect(src)}
        onDisconnect={(src) => void disconnect(src)}
      />

      {detailsOpen && base === "week" && !planWeekAt && !pd && !(nav.tab === "week" && (nav.mode === "team" || nav.mode === "status")) && (
        <DetailPanel variant="week" data={data} day={day} slot={slot} focus={panelFocus} now={now ?? new Date(clock).toISOString()} onClose={() => (setDetailsOpen(false), setPanelFocus(null), cellRefs.current.get(`${sel.dayIndex}${sel.half}`)?.focus({ preventScroll: true }))} onStart={startFocus} onChanged={reloadQuiet} onNotice={setNotice} />
      )}
      {phone && (
        <BottomBar
          current={settingsAt !== null || guideAt || meetingAt || focusOpen ? null : nav.tab}
          inboxCount={inboxCount}
          onTab={(t: BottomTab) => {
            // The bar stays on screen under Capture: a tab closes it and goes there.
            setCaptureOpen(false);
            openTab(t);
          }}
        />
      )}
      {phoneMoreAt && (
        <PopupMenu
          at={phoneMoreAt}
          step={{
            title: "More",
            items: [
              // CV-3: on the phone the person chip is this first row (the top bar keeps room for the name).
              { id: "account", label: account.title, next: account.step },
              { id: "notices", label: "Notifications", ...(notices.unread > 0 ? { hint: `${notices.unread} new` } : {}), run: () => openNotices() },
              ...(data.timer ? [{ id: "focus", label: "Focus screen", run: () => setView("focus") }] : [{ id: "focus", label: "Start focus", run: () => setTimerMenuAt(phoneMoreAt) }]),
              { id: "settings", label: "Settings", run: () => setSettingsAt("") },
              ...(isAdmin ? [{ id: "admin", label: "Admin", run: () => setSettingsAt("admin-clients") }] : []),
              { id: "guide", label: "Guide", run: () => openGuide() },
              ...installItem,
              { id: "about", label: "About", run: () => setAboutOpen(true) },
            ],
          }}
          onClose={() => setPhoneMoreAt(null)}
        />
      )}
      {assistantAt && (
        <AssistantPanel
          phone={phone}
          skewMs={skew}
          initialText={assistantAt.text}
          context={assistantContext}
          onClose={() => setAssistantAt(null)}
          onChanged={reloadQuiet}
          onOpen={(href) => {
            if (href === COMMANDS_HREF) return openCommands();
            const to = parseHash(href);
            if (to) go(to);
          }}
        />
      )}
      {cmdOpen && <CommandMenu commands={commandList(env)} onClose={() => setCmdOpen(false)} />}
      {noticesOpen && <NoticesPanel items={noticesOpen} onClose={() => setNoticesOpen(null)} onOpen={(r) => (setNoticesOpen(null), openRouteRef.current(r))} />}
      <NoticeToasts toasts={notices.toasts} onDismiss={notices.dismiss} onOpen={(n) => (notices.dismiss(n.id), n.route && openRouteRef.current(n.route))} />
      {installHowTo && <InstallHowTo onClose={() => setInstallHowTo(false)} />}
      {timerMenuAt && <PopupMenu at={timerMenuAt} step={timerStep(env)} onClose={() => setTimerMenuAt(null)} />}
      {moreAt && (
        <PopupMenu
          at={moreAt}
          step={{
            title: "More",
            items: [
              { id: "notices", label: "Notifications", ...(notices.unread > 0 ? { hint: `${notices.unread} new` } : {}), run: () => openNotices() },
              { id: "commands", label: "Commands", hint: "Ctrl K", run: () => openCommands() },
              { id: "guide", label: "Guide", hint: "?", run: () => openGuide() },
              { id: "keys", label: "Keyboard shortcuts", run: () => setKeysOpen(true) },
              { id: "feedback", label: "Send feedback", run: () => setFeedbackOpen(true) },
              // ADM-1: only for FocusTime admins (the server checks every admin action again).
              ...(isAdmin ? [{ id: "admin", label: "Admin", run: () => setSettingsAt("admin-clients") }] : []),
              ...installItem,
              { id: "about", label: "About", run: () => setAboutOpen(true) },
            ],
          }}
          onClose={() => setMoreAt(null)}
        />
      )}
      {personMenu && <PopupMenu at={personMenu.at} step={personMenu.step} onClose={() => setPersonMenu(null)} />}
      {weekMoreAt && (
        <PopupMenu
          at={weekMoreAt}
          step={{
            title: "Week",
            items: [
              // U5.1 (D407): Timelines, the hours the rails and timelines show (V cycles them).
              ...VIEW_RANGES.map((r) => ({ id: `range-${r}`, label: VIEW_RANGE_NAMES[r], group: "Timelines", checked: data.week.range.mode === r, ...(data.week.range.mode === r ? {} : { hint: "V" }), run: () => void setViewRange(r) })),
              { id: "personal", label: "Personal events", group: "Show", checked: showPersonal, hint: "G", run: () => void saveShowPersonal(!showPersonal) },
              // WK-2: the Board's timeline, the same toggle as the button beside the modes.
              { id: "timeline", label: "Timeline", group: "Show", checked: showTimelines, hint: "B", run: () => void saveShowTimelines(!showTimelines) },
            ],
          }}
          onClose={() => setWeekMoreAt(null)}
        />
      )}
      {borrowMenuAt && <PopupMenu at={borrowMenuAt} step={borrowStep(env, data.borrowed)} onClose={() => setBorrowMenuAt(null)} />}
      {keysOpen && <KeyLegend onClose={() => setKeysOpen(false)} />}
      <NoHoursPrompt
        onAddHours={() => {
          setDetailsOpen(false);
          setSettingsAt("hours");
        }}
      />
      {tbTarget && (() => {
        const pick = "pickId" in tbTarget ? Object.values(data.plan ?? {}).flatMap((d) => d.picks).concat(pd?.picks ?? []).find((p) => p.id === tbTarget.pickId) : null;
        return <TimeboxDialog target={tbTarget} env={tbEnv} title={pick ? pick.title : "title" in tbTarget ? tbTarget.title : "To-do"} defaultMinutes={pick ? data.planning.sizes[pick.size ?? "M"] : 60} onClose={() => setTbTarget(null)} />;
      })()}
      {helpTarget && (
        <HelpFinder
          target={helpTarget}
          clientName={data.planClients.find((c) => c.clientKey === helpTarget.clientKey)?.clientName ?? helpTarget.clientKey}
          settings={data.collab}
          tz={userZone(week)}
          onPreview={(p) => writes.show(p)}
          onClose={() => setHelpTarget(null)}
        />
      )}
      {writes.dialog}
      {devopsWrites.dialog}
      {doneOffer.card}
      <SendHost thisWeek={data.today.weekStart} onSent={() => setPlanWeekVersion((v) => v + 1)} />
      <BreakDownHost onDone={() => (setPlanWeekVersion((v) => v + 1), reloadQuiet())} />
      <CoopBriefHost />
      {feedbackOpen && <FeedbackDialog view={viewName(loc)} zone={userZone(data)} onClose={() => setFeedbackOpen(false)} />}
      {aboutOpen && <AboutDialog zone={userZone(data)} onClose={() => setAboutOpen(false)} onGuide={() => openGuide()} />}
      {setupAt && (
        <SetupFlow
          start={setupAt}
          googleConnected={data.sources.some((x) => x.source === "google" && x.status === "ok")}
          onConnectGoogle={() => void connect("google")}
          onClose={(changed) => {
            setSetupAt(null);
            loadSetup(false);
            if (changed) reloadQuiet();
          }}
          onPlanWeek={() => openPlanWeek(data.today.weekStart)}
          onGuide={() => openGuide()}
        />
      )}
      {captureOpen && <CaptureDialog data={data} defaultClient={env?.selection.clientKey ?? null} initialKind={captureKind} onClose={() => (setCaptureOpen(false), setCaptureKind(null))} onOpenView={() => { setCaptureOpen(false); setView("inbox"); }} onChanged={() => { setCaptureVersion((n) => n + 1); setPlanWeekVersion((n) => n + 1); reloadQuiet(); }} />}
      {createDraft !== null && <CreateDraftDialog key={createDraft} draftId={createDraft} data={data} onClose={() => setCreateDraft(null)} onChanged={() => { setCaptureVersion((n) => n + 1); setPlanWeekVersion((n) => n + 1); reloadQuiet(); }} />}
      {draftEdit && <DraftEditor key={draftEdit.id} draft={draftEdit} data={data} onClose={() => setDraftEdit(null)} onChanged={() => { setCaptureVersion((n) => n + 1); setPlanWeekVersion((n) => n + 1); reloadQuiet(); }} />}
    </div>
    </WeekDndProvider>
    </CreateDraftCtx.Provider>
    </DraftEditorCtx.Provider>
    </VmProvider>
    </MenuHost>
    </DoneOfferCtx.Provider>
    </DevOpsWriteCtx.Provider>
    </TimeboxCtx.Provider>
    </PlanCtx.Provider>
    </WeekItems.Provider>
    </DevOpsWork.Provider>
    </SampleSources.Provider>
    </>
  );
}

/** P1: a planning screen on the phone is read-only under one line (PhoneReadOnly); elsewhere it is as it was. */
function PhoneGate({ phone, onBack, backLabel, children }: { phone: boolean; onBack?: () => void; backLabel?: string; children: React.ReactNode }) {
  return phone ? (
    <PhoneReadOnly onBack={onBack} {...(backLabel ? { backLabel } : {})}>
      {children}
    </PhoneReadOnly>
  ) : (
    <>{children}</>
  );
}
