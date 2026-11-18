// SA-2: Settings › Display, drawn with the parts. Display applies at once through its own path (no Undo there, as
// before); each row gets the same "Saved" mark for 2 seconds as the rest of Settings.
import { useEffect, useRef, useState } from "react";
import { TEXT_SIZES, THEME_NAMES, THEMES } from "../../../config/schema.ts";
import { VIEW_RANGE_NAMES, VIEW_RANGES } from "../../../week/hours.ts";
import { TEXT_SIZE_NAMES } from "../../textsize.ts";
import { SAVED_MS } from "../autosave.tsx";
import { Choice, Group, Page, Row, Switch } from "../parts.tsx";
import { firstLine, rest } from "./shared.ts";
import { usePhone } from "../../viewport.ts";
import type { Props } from "./types.ts";

/** The row that just changed, for 2 seconds. */
function useSavedRow() {
  const [row, setRow] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const saved = (id: string) => {
    if (timer.current) clearTimeout(timer.current);
    setRow(id);
    timer.current = setTimeout(() => setRow(null), SAVED_MS);
  };
  const mark = (id: string) => (row === id ? { s: { kind: "saved" as const }, retry: () => {} } : undefined);
  return { saved, mark };
}

const WEEK_DAYS_HELP = "The same choices as Week's View options. A hidden day with to-dos or promises due, or today, gets a note on Week with Show. Day still steps through every day.";

export function DisplaySection(p: Props) {
  const { saved, mark } = useSavedRow();
  const phone = usePhone();
  const on = <T,>(id: string, f: (v: T) => void) => (v: T) => (f(v), saved(id));
  return (
    <Page>
      <Group>
        <Row id="theme" help="Applies at once." mark={mark("theme")}>
          <Choice options={THEMES.map((t) => ({ value: t, label: THEME_NAMES[t] }))} value={p.theme} onChange={on("theme", p.setTheme)} />
        </Row>
        <Row id="text-size" help="Ctrl + and Ctrl − change it; Ctrl 0 resets." mark={mark("text-size")}>
          <Choice options={TEXT_SIZES.map((s) => ({ value: s, label: TEXT_SIZE_NAMES[s] }))} value={p.textSize} onChange={on("text-size", p.setTextSize)} />
        </Row>
        <Row id="timelines" help="The default. V on Week changes it until the page reloads." mark={mark("timelines")}>
          <Choice options={VIEW_RANGES.map((r) => ({ value: r, label: VIEW_RANGE_NAMES[r] }))} value={p.viewRange} onChange={on("timelines", p.setViewRange)} />
        </Row>
        <Row id="personal-events" help="On Week and Day. Hidden ones still count in risk and free time. G switches it." mark={mark("personal-events")}>
          <Switch checked={p.showPersonal} onChange={on("personal-events", p.setShowPersonal)} />
        </Row>
        {phone && p.setDayTimeline && (
          <Row id="day-timeline" help="The hours beside each block, with Timebox my day. Only this phone; your computer keeps its own." mark={mark("day-timeline")}>
            <Switch checked={!!p.dayTimeline} onChange={on("day-timeline", p.setDayTimeline)} />
          </Row>
        )}
      </Group>
      <Group sid="week-days">
        <Row id="week-days" noSid help={firstLine(WEEK_DAYS_HELP)} more={rest(WEEK_DAYS_HELP)} />
        <Row id="show-friday" help={`${p.catchUpName}, the catch-up day.`} mark={mark("show-friday")}>
          <Switch checked={p.weekDays.catchUp} onChange={on("show-friday", (v: boolean) => p.setWeekDays({ catchUp: v }))} />
        </Row>
        {/* SA-3: the same three choices as Week's View options (Show weekend, then Every weekend day). */}
        <Row id="show-weekend" help="Always is this browser's, as in Week's View options." mark={mark("show-weekend")}>
          <Choice
            options={[
              { value: "never", label: "Never" },
              { value: "some", label: "When something's on them" },
              ...(p.setEveryWeekendDay ? [{ value: "always", label: "Always" }] : []),
            ]}
            value={!p.weekDays.weekend ? "never" : p.everyWeekendDay ? "always" : "some"}
            onChange={on("show-weekend", (v: string) => {
              if (v === "never") return p.setWeekDays({ weekend: false });
              if (!p.weekDays.weekend) p.setWeekDays({ weekend: true });
              p.setEveryWeekendDay?.(v === "always");
            })}
          />
        </Row>
      </Group>
      <Group>
        <Row id="reduce-motion" help="No opening animation; the loader's mark holds still." mark={mark("reduce-motion")}>
          <Switch checked={p.reduceMotion} onChange={on("reduce-motion", p.setReduceMotion)} />
        </Row>
      </Group>
    </Page>
  );
}
