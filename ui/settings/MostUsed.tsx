// SA-5: the phone's Settings opens on Most used: the five things people change from a phone, each changed right there
// and saved the way its own page saves it. Notify this device and Let FocusTime message me in Teams are Reminders and
// notices' own rows; Theme and Text size are Display's; Today's hours is Week's day menu's one-day change (hours.set_day)
// for today. Search and every section follow it (ui/Settings.tsx).
import { useState } from "react";
import { TEXT_SIZES, THEME_NAMES, THEMES } from "../../config/schema.ts";
import { hoursOn } from "../../week/hours.ts";
import { userZone } from "../../week/zone.ts";
import { dayHoursInput } from "../day-hours.ts";
import { TEXT_SIZE_NAMES } from "../textsize.ts";
import { Button, Buttons, Choice, Group, Row, Time } from "./parts.tsx";
import { PushDevices, TeamsMessagesRow } from "./sections/Notifications.tsx";
import type { BodyProps } from "./sections/types.ts";

export function MostUsed(p: BodyProps) {
  return (
    <section className="ps-most" aria-labelledby="ps-most-h">
      <h3 className="ps-group-head" id="ps-most-h">
        Most used
      </h3>
      <Group>
        <PushDevices />
        <TeamsMessagesRow {...p} />
        <Row id="theme" help="Applies at once.">
          <Choice options={THEMES.map((t) => ({ value: t, label: THEME_NAMES[t] }))} value={p.theme} onChange={p.setTheme} />
        </Row>
        <Row id="text-size">
          <Choice options={TEXT_SIZES.map((s) => ({ value: s, label: TEXT_SIZE_NAMES[s] }))} value={p.textSize} onChange={p.setTextSize} />
        </Row>
        {p.data.hours && <TodayHours {...p} />}
      </Group>
    </section>
  );
}

/** Today's own hours: the main span, keeping today's lunch and evening as they are; Use usual hours takes it back. */
function TodayHours(p: BodyProps) {
  const h = p.data.hours!;
  const today = Temporal.Now.plainDateISO(userZone(h)).toString();
  const day = hoursOn(h, today);
  const own = h.overrides.some((o) => o.date === today);
  const [start, setStart] = useState(day.main?.start ?? "09:00");
  const [end, setEnd] = useState(day.main?.end ?? "17:00");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; tone?: "problem" } | null>(null);
  const run = async (action: string, input: Record<string, unknown>, done: string) => {
    setBusy(true);
    setSaid(null);
    const ok = await p.runTime(action, input).catch(() => false);
    setBusy(false);
    setSaid(ok ? { text: done } : { text: "Couldn't save. Try again.", tone: "problem" });
    if (ok) await p.reload();
  };
  const eve = day.extra[0];
  return (
    <Row
      id="today-hours"
      def={{ label: "Today's hours" }}
      wide
      help={own ? "Its own hours for today. Your usual hours stay for other days." : "Only for today. Your usual hours stay for other days."}
      below={
        <Buttons result={said?.text} tone={said?.tone}>
          <Button
            kind="main"
            disabled={busy || !start || !end || start >= end}
            onClick={() =>
              void run(
                "hours.set_day",
                dayHoursInput(today, { start, end, lunchStart: day.lunch?.start ?? "", lunchEnd: day.lunch?.end ?? "", eveStart: eve?.start ?? "", eveEnd: eve?.end ?? "" }),
                `Saved for today: ${start} to ${end}.`,
              )
            }
          >
            Save for today
          </Button>
          {own && (
            <Button disabled={busy} onClick={() => void run("hours.clear_day", { date: today }, "Back to your usual hours for today.")}>
              Use usual hours
            </Button>
          )}
        </Buttons>
      }
    >
      <span className="ps-most-times">
        <Time label="Starts today at" value={start} onChange={setStart} />
        <Time label="Ends today at" value={end} onChange={setEnd} />
      </span>
    </Row>
  );
}
