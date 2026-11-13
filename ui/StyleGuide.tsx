// /styleguide (step 6b slice 5): tokens and core components, live in each theme, from fixture data only (no
// sources, no client data). The switcher here only previews: Settings > Display saves the theme.
import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { legacyHours, THEME_NAMES, THEMES, type Theme } from "../config/schema.ts";
import { samplePatterns, sampleOutlook, sampleGoogle, SAMPLE_WEEK } from "../fixtures/sample-week.ts";
import type { SourceSummary, TimerView } from "../actions/types.ts";
import type { NowStrip as Strip } from "../plan/now.ts";
import { SIZE_MINUTES, type Pick, type PlanWeek } from "../plan/types.ts";
import { buildWeek } from "../week/build.ts";
import type { FlexSession } from "../week/types.ts";
import { CloseButton } from "./CloseButton.tsx";
import { Icon, ICON_NAMES, type IconName } from "./icons.tsx";
import { KEYS } from "./keys.ts";
import { menuIcon } from "./menu-icons.ts";
import { NowStrip, TopTimer } from "./NowStrip.tsx";
import { PlanCtx } from "./planview.ts";
import { StatusBar } from "./StatusBar.tsx";
import { isTheme } from "./theme.ts";
import { useLayout } from "./viewport.ts";
import { WeekGrid } from "./WeekGrid.tsx";
import { BentMark, Lockup, Lumen, LumenLoading, WeekMark } from "./brand/Brand.tsx";

const NY = "America/New_York";
const NOW = "2026-11-02T10:10:00-05:00";
const model = legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: NY });
model.weekdays.tue = [{ start: "09:00", end: "16:00" }, { start: "20:00", end: "22:00" }];
model.lunch = { start: "12:00", end: "12:30" };
const flex: FlexSession = { id: 1, clientKey: "adatum", start: "2026-11-02T19:00:00-05:00", end: "2026-11-02T21:00:00-05:00", itemId: null, itemTitle: null, itemUrl: null, note: "Finish the import mapping" };
const week = buildWeek({
  weekStart: SAMPLE_WEEK,
  patterns: samplePatterns,
  events: [...sampleOutlook, ...sampleGoogle],
  config: { hours: model, thresholds: { meetingWatchMinutes: 90, meetingAtRiskMinutes: 150, minFocusWindowMinutes: 90 }, standingBlocks: [{ day: "Mon", half: "AM", clientKey: "internal", clientName: "Internal" }] },
  pto: { "2026-11-05": { date: "2026-11-05", titles: ["Sample day off"] } },
  unavailable: [{ id: 1, title: "Unavailable", start: "2026-11-04T14:00:00-05:00", end: "2026-11-04T15:30:00-05:00", note: null }],
  flex: [flex],
});
const colors = { proseware: "var(--client-violet)", adatum: "var(--client-ochre)", internal: "var(--client-slate)", tw: "var(--client-teal)" };

let n = 0;
const pick = (half: Pick["half"], clientKey: string, title: string, size: Pick["size"], status: Pick["status"] = "planned"): Pick => ({
  id: ++n, date: SAMPLE_WEEK, half, clientKey, kind: "intention", itemId: null, draftId: null, title, itemType: null, itemUrl: null,
  size, status, carriedFrom: null, carriedFromDate: null, followUpId: null, notes: null, position: n, createdAt: "", updatedAt: "",
});
const plan: PlanWeek = {
  [SAMPLE_WEEK]: {
    picks: [pick("AM", "proseware", "Review the intake form", "S", "done"), pick("AM", "proseware", "Draft the release notes", "L"), pick("PM", "adatum", "Pair on the import job", "M")],
  },
};

/** Focused time on the sample picks (step 6d): the done one took 50 minutes, the release notes 45 so far. */
const SAMPLE_FOCUSED: Record<number, number> = { [plan[SAMPLE_WEEK]!.picks[0]!.id]: 50 * 60, [plan[SAMPLE_WEEK]!.picks[1]!.id]: 45 * 60 };

const sources: SourceSummary[] = [
  { source: "dataverse", status: "ok", fetchedAt: "2026-11-02T10:05:00-05:00", fromCache: false, itemCount: 4, sample: true },
  { source: "outlook", status: "ok", fetchedAt: "2026-11-02T10:05:00-05:00", fromCache: false, itemCount: 12, sample: true },
  { source: "google", status: "unreachable", fetchedAt: "2026-11-02T08:00:00-05:00", fromCache: true, itemCount: 3, sample: true, message: "Could not reach Google. Showing data from 8:00 AM", cause: "network" },
];

const base: Strip = { kind: "slot", half: "AM", title: "Proseware focus", until: "12:00", untilMinutes: 110, event: { title: "Design review", at: "11:00", minutes: 50, now: false }, picks: { done: 1, total: 3 }, overBy: 95, nextPick: "Draft the release notes", next: null, flex: false };
const strips: [string, Strip][] = [
  ["In a block, over by", base],
  ["Before work", { ...base, kind: "before", title: "Work starts", until: "09:00", untilMinutes: 30, overBy: null, event: null }],
  ["In a meeting", { ...base, event: { title: "Standup", at: "10:30", minutes: 20, now: true }, overBy: null }],
  ["Flex session", { ...base, half: "EVE", title: "Flex session: Adatum", until: "21:00", flex: true, event: null, overBy: null, nextPick: "Finish the import mapping" }],
  ["PTO", { ...base, kind: "pto", half: null, title: "PTO today", until: null, event: null, picks: null, overBy: null, nextPick: null, next: "2026-11-09" }],
  ["No work today", { ...base, kind: "off", half: null, title: "No work today", until: null, event: null, picks: null, overBy: null, nextPick: null, next: "2026-11-09" }],
];

const timers: [string, TimerView][] = [
  ["Focus running", { kind: "focus", pickId: 2, label: "Draft the release notes", plannedMinutes: 50, remainingMs: 23 * 60_000 + 14_000, running: true, ended: false, endsAt: new Date(Date.parse(NOW) + 23 * 60_000 + 14_000).toISOString(), runningSince: new Date(Date.parse(NOW) - 26 * 60_000 - 46_000).toISOString(), deep: false }],
  ["Focus paused", { kind: "focus", pickId: null, label: "Focus", plannedMinutes: 25, remainingMs: 9 * 60_000, running: false, ended: false, endsAt: null, runningSince: null, deep: false }],
  ["Time's up", { kind: "focus", pickId: 2, label: "Draft the release notes", plannedMinutes: 50, remainingMs: 0, running: false, ended: true, endsAt: null, runningSince: null, deep: false }],
  ["Break", { kind: "break", pickId: null, label: "Break", plannedMinutes: 10, remainingMs: 4 * 60_000, running: true, ended: false, endsAt: new Date(Date.parse(NOW) + 4 * 60_000).toISOString(), runningSince: new Date(Date.parse(NOW) - 6 * 60_000).toISOString(), deep: false }],
];

// Machado et al. 2009, severity 1 (the matrices used in docs/design/style-guide.md).
const CVD: [string, string][] = [
  ["Deuteranopia", "0.367322 0.860646 -0.227968 0 0  0.280085 0.672501 0.047413 0 0  -0.011820 0.042940 0.968881 0 0  0 0 0 1 0"],
  ["Protanopia", "0.152286 1.052583 -0.204868 0 0  0.114503 0.786281 0.099216 0 0  -0.003882 -0.048116 1.051998 0 0  0 0 0 1 0"],
  ["Tritanopia", "1.255528 -0.076749 -0.178779 0 0  -0.078411 0.930809 0.147602 0 0  0.004733 0.691367 0.303900 0 0  0 0 0 1 0"],
];
const SLOTS = ["teal", "violet", "ochre", "blue", "rose", "earth", "green", "slate"];

// ---- tokens, read live from the stylesheet and the computed style ----
const DOMAIN = /^--(risk|watch|ok|pto|oof|personal|sample|client-|event-surface)/;
function tokenNames(): string[] {
  const names = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const walk = (list: CSSRuleList) => {
      for (const r of Array.from(list)) {
        if (r instanceof CSSStyleRule && r.selectorText.startsWith(":root")) for (const p of Array.from(r.style)) if (p.startsWith("--")) names.add(p);
        if ("cssRules" in r) walk((r as CSSGroupingRule).cssRules);
      }
    };
    walk(rules);
  }
  return [...names].filter((x) => x !== "--c" && x !== "--font-ui" && !x.startsWith("--shadow"));
}
const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d", { willReadFrequently: true }) : null;
function rgba(css: string): [number, number, number, number] | null {
  if (!ctx || !css) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
}
const hex = (c: [number, number, number, number]) => `#${c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}${c[3] < 1 ? ` ${Math.round(c[3] * 100)}%` : ""}`;
const lum = (c: number[]) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
};
function contrast(fg: [number, number, number, number], bg: [number, number, number, number]): number {
  const mixed = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i]! * (1 - fg[3]));
  const [a, b] = [lum(mixed), lum(bg)].sort((x, y) => y - x) as [number, number];
  return (a + 0.05) / (b + 0.05);
}

type Token = { name: string; value: string; ratio: number | null };
function readTokens(): { layer: string; tokens: Token[] }[] {
  const cs = getComputedStyle(document.documentElement);
  const surface = rgba(cs.getPropertyValue("--surface").trim());
  const all = tokenNames().map((name): Token => {
    const c = rgba(cs.getPropertyValue(name).trim());
    return { name, value: c ? hex(c) : cs.getPropertyValue(name).trim(), ratio: c && surface ? contrast(c, surface) : null };
  });
  return [
    { layer: "Primitives", tokens: all.filter((t) => t.name.startsWith("--p-")) },
    { layer: "Semantic", tokens: all.filter((t) => !t.name.startsWith("--p-") && !DOMAIN.test(t.name)) },
    { layer: "Domain", tokens: all.filter((t) => DOMAIN.test(t.name)) },
  ];
}

/** The U3 type scale (D385), as docs/design/style-guide.md section 4 lists it. */
const TYPE_SCALE: [string, number, string, boolean][] = [
  ["--fs-4", 600, "Page and panel titles", false],
  ["--fs-3", 600, "Client names, the next to-do", false],
  ["--fs-3", 500, "Buttons and chips", false],
  ["--fs-3", 400, "Body: to-dos, rows, follow-ups", false],
  ["--fs-2", 500, "Pills and badges", false],
  ["--fs-2", 400, "Meta: times, counts, status bar", false],
  ["--fs-1", 500, "Rail labels and hour marks", false],
  ["--fs-1", 600, "Section labels", true],
];

/** RS-1: the button kinds of style guide section 11, each shown at rest, hover, pressed, focus and disabled. */
const SG_BUTTONS: { name: string; cls: string; word: string; icon?: IconName; filled?: boolean }[] = [
  { name: "Filled: the screen's one main action", cls: "done-btn", word: "Add", icon: "add", filled: true },
  { name: "Outlined: everything else you press", cls: "", word: "Outlined" },
  { name: "Outlined, with an icon", cls: "top-btn", word: "Capture", icon: "capture" },
  { name: "Quiet: secondary, and inside rows", cls: "quiet", word: "Quiet" },
  { name: "Small: inside cards and rows", cls: "mini", word: "Small" },
  { name: "Small, accented", cls: "mini primary", word: "Accept" },
  { name: "Small, quiet", cls: "mini quiet", word: "Not today" },
  { name: "Small, filled", cls: "start-focus", word: "Start focus", filled: true },
];
const SG_MENU: { label: string; cls?: string; key?: string; why?: string; next?: boolean }[] = [
  { label: "Mark done", cls: "active", key: "X" },
  { label: "Size M", cls: "checked" },
  { label: "Move", next: true },
  { label: "Copy link" },
  { label: "Move to Friday", why: "no working hours" },
  { label: "Drop", cls: "danger" },
];

export function StyleGuide() {
  const [theme, setTheme] = useState<Theme>(() => {
    const q = new URLSearchParams(location.search).get("theme");
    const now = document.documentElement.dataset.theme;
    return isTheme(q) ? q : isTheme(now) ? now : "cooptimize-dark";
  });
  const [layers, setLayers] = useState<ReturnType<typeof readTokens>>([]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = "FocusTime style guide";
    // After the attribute lands, read the tokens the theme now resolves to.
    const id = requestAnimationFrame(() => setLayers(readTokens()));
    return () => cancelAnimationFrame(id);
  }, [theme]);
  const { layout, compact } = useLayout();
  const cellRefs = useMemo(() => new Map<string, HTMLDivElement>(), []);
  const noop = () => {};

  return (
    <div className="sg">
      <header className="sg-head">
        <div className="brand">
          <WeekMark height={18} />
          <span className="name">FocusTime style guide</span>
        </div>
        <div className="sg-themes" role="radiogroup" aria-label="Theme preview">
          {THEMES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} className="top-btn" aria-current={theme === t ? "page" : undefined} onClick={() => setTheme(t)}>
              {THEME_NAMES[t]}
            </button>
          ))}
        </div>
        <p className="muted sg-note">Preview only. Settings &gt; Display saves the theme. Neutral follows the system light or dark setting. Sample data, no client data.</p>
      </header>

      <section className="sg-section">
        <h2>Brand</h2>
        <p className="muted">Step 17.5 (docs/design/brand.md): the marks and Lumen. Lumen appears only in the opening, Close out's reverse, sign-in, About, three empty states and three fun moments.</p>
        <div className="sg-brand">
          <figure><WeekMark height={36} /><figcaption>WeekMark: top bar, icon</figcaption></figure>
          <figure><BentMark width={120} /><figcaption>BentMark: sign-in</figcaption></figure>
          <figure><Lockup width={280} /><figcaption>Lockup: About</figcaption></figure>
          <figure><Lumen pose="still" size={40} /><figcaption>Lumen still</figcaption></figure>
          <figure><Lumen pose="idle" size={40} /><figcaption>Lumen idle</figcaption></figure>
          <figure><Lumen pose="bob" size={40} /><figcaption>Lumen bob</figcaption></figure>
          <figure><LumenLoading height={120} /><figcaption>LumenLoading</figcaption></figure>
        </div>
      </section>

      <section className="sg-section">
        <h2>Tokens</h2>
        <p className="muted">Live values in {THEME_NAMES[theme]}. The ratio is against --surface (AA: 4.5 for text, 3 for large text and non-text).</p>
        {layers.map((l) => (
          <Fragment key={l.layer}>
            <h3>
              {l.layer} <span className="muted">({l.tokens.length})</span>
            </h3>
            <div className="sg-swatches">
              {l.tokens.map((t) => (
                <div key={t.name} className="sg-token">
                  <span className="sg-chip" style={{ background: `var(${t.name})` }} />
                  <code>{t.name}</code>
                  <span className="muted">{t.value}</span>
                  {t.ratio !== null && <span className={t.ratio >= 4.5 ? "sg-ratio" : t.ratio >= 3 ? "sg-ratio mid" : "sg-ratio low"}>{t.ratio.toFixed(1)}</span>}
                </div>
              ))}
            </div>
          </Fragment>
        ))}
      </section>

      <section className="sg-section">
        <h2>Client slots</h2>
        <p className="muted">Normal vision and simulated color-vision types. Slots 7 and 8 rely on the client name: assign them last.</p>
        <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
          {CVD.map(([name, m]) => (
            <filter key={name} id={`sg-${name}`} colorInterpolationFilters="linearRGB">
              <feColorMatrix type="matrix" values={m} />
            </filter>
          ))}
        </svg>
        <div className="sg-cvd">
          {[["Normal", ""] as const, ...CVD].map(([name]) => (
            <div key={name} className="sg-cvd-row">
              <span className="sg-cvd-name">{name}</span>
              <div className="sg-slots" style={name === "Normal" ? undefined : { filter: `url(#sg-${name})` }}>
                {SLOTS.map((s, i) => (
                  <span key={s} className="sg-slot" style={{ borderLeftColor: `var(--client-${s})` }}>
                    <span className="swatch" style={{ background: `var(--client-${s})` }} />
                    {i + 1}. {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="sg-section">
        <h2>Type scale</h2>
        <p className="muted">Today and Week: four sizes and three weights. Uppercase only for section labels.</p>
        <div className="sg-type">
          {TYPE_SCALE.map(([fs, w, use, upper]) => (
            <div key={`${fs}-${w}`} className="sg-type-row">
              <span className="sg-type-spec">{`${fs.replace("--fs-", "fs-")} · ${w}`}</span>
              <span style={{ fontSize: `var(${fs})`, fontWeight: w, ...(upper ? { textTransform: "uppercase", letterSpacing: "0.06em" } : {}) }}>{use}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="sg-section" data-sg="controls">
        <h2>Controls, icons and rows (RS-1)</h2>
        <p className="muted">Style guide section 11: every control in every state. Hover and pressed are drawn as they look; the washes are instant.</p>

        <h3>Buttons</h3>
        {SG_BUTTONS.map((b) => (
          <div key={b.name} className="sg-states">
            <span className="sg-state-name">{b.name}</span>
            <button type="button" className={b.cls}>{b.icon && <Icon name={b.icon} />} {b.word}</button>
            <button type="button" className={b.cls} style={b.filled ? { filter: "brightness(1.08)" } : { background: "var(--wash-1)" }}>Hover</button>
            <button type="button" className={b.cls} style={b.filled ? { filter: "brightness(0.95)" } : { background: "var(--wash-2)" }}>Pressed</button>
            <button type="button" className={b.cls} style={{ outline: "2px solid var(--focus)", outlineOffset: 2 }}>Focus</button>
            <button type="button" className={b.cls} disabled>Disabled</button>
          </div>
        ))}

        <h3>Icon-only buttons</h3>
        <div className="sg-row">
          {(["back", "next", "more", "close", "add", "remove", "bold", "italic", "bullets", "numbers", "link"] as const).map((n) => (
            <button key={n} type="button" className="icon-btn" aria-label={n} title={n}><Icon name={n} /></button>
          ))}
          <button type="button" className="icon-btn" aria-label="Hover" title="Hover" style={{ background: "var(--wash-1)", color: "var(--text)" }}><Icon name="more" /></button>
          <button type="button" className="icon-btn" aria-label="Pressed" title="Pressed" style={{ background: "var(--wash-2)", color: "var(--text)" }}><Icon name="more" /></button>
          <button type="button" className="icon-btn" aria-label="Focus" title="Focus" style={{ outline: "2px solid var(--focus)", outlineOffset: 2 }}><Icon name="more" /></button>
          <button type="button" className="icon-btn" aria-label="Disabled" title="Disabled" disabled><Icon name="more" /></button>
          <button type="button" className="icon-btn small" aria-label="Small" title="Small, inside cards and rows"><Icon name="more" /></button>
          <CloseButton onClose={noop} />
        </div>

        <h3>Tabs</h3>
        <div className="sg-row">
          <nav className="views" aria-label="Sample tabs">
            {(["day", "week", "backlog", "status", "inbox"] as const).map((t, i) => (
              <button key={t} type="button" className="view-tab" aria-current={i === 1 ? "page" : undefined} style={i === 2 ? { background: "var(--wash-1)", color: "var(--text)" } : undefined}>
                <Icon name={t} />
                {{ day: "Day", week: "Week", backlog: "Backlog (hover)", status: "Status", inbox: "Inbox" }[t]}
                {t === "inbox" && <span className="count">6</span>}
              </button>
            ))}
          </nav>
        </div>

        <h3>Switches</h3>
        <div className="sg-row">
          <span className="day-switch" role="group" aria-label="Sample: cards or timeline">
            <button type="button" aria-pressed={true}>Cards</button>
            <button type="button" aria-pressed={false}>Timeline</button>
          </span>
          <span className="rm-seg" role="group" aria-label="Sample: whose">
            <button type="button" aria-pressed={false}>Mine</button>
            <button type="button" aria-pressed={true}>Contributing</button>
            <button type="button" aria-pressed={false}>Everyone</button>
          </span>
          <nav className="mode-switch" aria-label="Sample: views">
            <button type="button" className="ms-btn" aria-current="page">Grid</button>
            <button type="button" className="ms-btn">Gantt</button>
          </nav>
        </div>

        <h3>Pills: outlined means press</h3>
        <div className="sg-row">
          <span className="today-pill">Today</span>
          <span className="due-badge later">Due Sun</span>
          <span className="due-badge was_due">1 day late</span>
          <span className="status-pill at_risk">At risk</span>
          <span className="status-pill on_track">On track</span>
          <span className="status-pill watch">Stale</span>
          <span className="size-chip static">M</span>
          <span className="adm-kind">Rule</span>
          <span className="status-chip">Read only</span>
          <span className="muted">a status: a wash, no line</span>
        </div>
        <div className="sg-row">
          <button type="button" className="rm-chip" aria-pressed={false} style={{ "--c": "var(--client-teal)" } as CSSProperties}><span className="swatch small" style={{ "--c2": "var(--client-teal)" } as CSSProperties} />Client, off</button>
          <button type="button" className="rm-chip" aria-pressed={true} style={{ "--c": "var(--client-teal)" } as CSSProperties}><span className="swatch small" style={{ "--c2": "var(--client-teal)" } as CSSProperties} />Client, on</button>
          <button type="button" className="chip-btn" aria-pressed={false}>Decide later</button>
          <button type="button" className="chip-btn on" aria-pressed={true}>Promise</button>
          <button type="button" className="size-chip">M</button>
          <button type="button" className="carry-chip">→ Wed</button>
          <span className="muted">a chip to press: a line when off, its wash when on</span>
        </div>

        <h3>Inputs</h3>
        <div className="sg-row">
          <input type="text" placeholder="Text" aria-label="Sample text" />
          <input type="text" defaultValue="Focused" aria-label="Sample focused" style={{ borderColor: "var(--accent)", outline: "2px solid var(--focus)", outlineOffset: 1 }} />
          <input type="text" defaultValue="Not right" aria-invalid="true" aria-label="Sample invalid" />
          <input type="text" defaultValue="Disabled" disabled aria-label="Sample disabled" />
          <select aria-label="Sample select" defaultValue="b"><option value="a">One</option><option value="b">Two</option></select>
          <button type="button" className="date-field"><span>Nov 6</span><span className="date-field-icon"><Icon name="open" /></span></button>
        </div>

        <h3>Menus and dialogs</h3>
        <div className="sg-row">
          <ul className="popup-menu sg-static menu-list" role="menu" aria-label="Sample menu">
            <li className="menu-group">To-do</li>
            {SG_MENU.map((m) => (
              <li key={m.label} role="menuitem" className={`menu-item${m.cls ? ` ${m.cls}` : ""}`} aria-disabled={m.why ? true : undefined}>
                <span className="menu-icon"><Icon name={m.cls === "checked" ? "done" : menuIcon({ label: m.label })} /></span>
                <span className="menu-label">{m.label}{m.why && <span className="menu-why"> · {m.why}</span>}</span>
                {m.key && <span className="menu-hint"><kbd>{m.key}</kbd></span>}
                {m.next && <span className="menu-arrow"><Icon name="next" /></span>}
              </li>
            ))}
          </ul>
          <div className="cap-dialog sg-dialog" role="group" aria-label="Sample dialog">
            <div className="cap-dialog-head"><h2>A dialog</h2><CloseButton onClose={noop} /></div>
            <p className="muted">16 radius, the quiet line. One filled button.</p>
            <div className="sg-row"><button type="button" className="done-btn">Save</button><button type="button" className="quiet">Cancel</button></div>
          </div>
          <dl className="key-list sg-keys">
            {KEYS.slice(0, 8).map((k) => (
              <Fragment key={k.does}>
                <dt>
                  {k.keys.map((x) => (
                    <kbd key={x}>{x}</kbd>
                  ))}
                </dt>
                <dd>{k.does}</dd>
              </Fragment>
            ))}
          </dl>
        </div>

        <h3>Rows</h3>
        <ul className="sg-rows" aria-label="Sample rows">
          <li><span className="swatch small" style={{ "--c2": "var(--client-violet)" } as CSSProperties} /><span className="sg-row-title">A row at rest: one line, no box</span><span className="due-badge later">Due Fri</span><Icon name="next" /></li>
          <li className="hover"><span className="swatch small" style={{ "--c2": "var(--client-violet)" } as CSSProperties} /><span className="sg-row-title">Hover: the faint wash</span><span className="due-badge was_due">1 day late</span><Icon name="next" /></li>
          <li className="selected"><span className="swatch small" style={{ "--c2": "var(--client-teal)" } as CSSProperties} /><span className="sg-row-title">Selected, or the keyboard's row: the accent wash</span><Icon name="next" /></li>
          <li className="open"><span className="swatch small" style={{ "--c2": "var(--client-ochre)" } as CSSProperties} /><span className="sg-row-title">Open in place: one quiet card while it is open<span className="muted sg-row-sub">A second line stays when the row needs one.</span></span><Icon name="up" /></li>
        </ul>

        <h3>Icons</h3>
        <p className="muted">One family (ui/icons.tsx), by name. 16 px at the Default text size, a 1.5 px stroke, the color of the text beside it.</p>
        <ul className="sg-icons" aria-label="Icons by name">
          {ICON_NAMES.map((n) => (
            <li key={n}><Icon name={n} /><code>{n}</code></li>
          ))}
        </ul>

        <h3>Other marks</h3>
        <div className="sg-row">
          <kbd>Ctrl K</kbd>
          <span className="soon-tag">soon</span>
          <span className="fit fits">fits, 1h spare</span>
          <span className="fit tight">tight, 20m spare</span>
          <span className="fit over">over by 30m</span>
          <span className="pto-pill full">PTO · Sample day off</span>
          <span className="weekend-note">Today is Sat, Nov 7 · showing next week</span>
        </div>
      </section>

      <section className="sg-section">
        <h2>Now strip</h2>
        <div className="sg-strips">
          {strips.map(([label, s]) => (
            <div key={label} className="sg-strip">
              <span className="muted">{label}</span>
              <NowStrip strip={s} onSelect={noop} />
            </div>
          ))}
          {timers.map(([label, t]) => (
            <div key={label} className="sg-strip">
              <span className="muted">{label}</span>
              <TopTimer t={t} nowMs={Date.parse(NOW)} color="var(--accent)" client="T&W" onClick={noop} />
            </div>
          ))}
        </div>
      </section>

      <section className="sg-section">
        <h2>Week</h2>
        <p className="muted">Sample week at Mon 10:10 AM: a plan over its free time, a split day with an evening, unavailable time, a flex session, a PTO day.</p>
        <div className="sg-week">
          <PlanCtx.Provider value={{ week: plan, toggle: noop, sizes: SIZE_MINUTES, focused: SAMPLE_FOCUSED, timer: null, nowMs: Date.parse(NOW) }}>
            <WeekGrid week={week} colors={colors} minFocusWindow={90} today={SAMPLE_WEEK} now={NOW} selection={{ dayIndex: 0, half: "AM" }} cellRefs={cellRefs} onSelect={noop} onOpen={noop} layout={layout} compact={compact} />
          </PlanCtx.Provider>
        </div>
      </section>

      <section className="sg-section">
        <h2>Status bar</h2>
        <div className="sg-status">
          <StatusBar sources={sources} devops={null} hours={model} loading={false} busy={null} notice={null} clock={Date.parse(NOW)} onRefresh={noop} onConnect={noop} onDisconnect={noop} />
        </div>
      </section>
    </div>
  );
}
