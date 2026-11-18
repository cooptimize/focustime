// MC-4: the calls I review that are still open (a proposal undecided), in two places outside Calls: Close out lists
// today's, each with Open and Skip all and close (with Undo); and from Thursday, Week's header says "N calls to close
// this week", which opens Calls on Open. Both read meeting.mine (the app's calls), nothing more.
import { useContext } from "react";
import { call } from "../api.ts";
import { MenuCtx } from "../Menus.tsx";
import { CLOSE_TEXT } from "../../plan/call-words.ts";
import { callsHash } from "../nav.ts";
import { openCall, useCallMarks, useCallsReload, type CallMark } from "./calls.ts";

const dayIn = (iso: string, zone: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(zone).toPlainDate().toString();

/** Calls I review with something left to decide, whose day is from `from` to `to` (inclusive). */
export const callsToClose = (marks: readonly CallMark[], zone: string, from: string, to: string): CallMark[] =>
  marks.filter((m) => m.review && m.open > 0 && dayIn(m.startAt, zone) >= from && dayIn(m.startAt, zone) <= to);

/** Week's count: from Thursday, on this week only, the calls this week up to today still to close (0: no line). */
export function weekCallsToClose(marks: readonly CallMark[], zone: string, today: string, weekStart: string): number {
  const t = Temporal.PlainDate.from(today);
  const monday = t.subtract({ days: t.dayOfWeek - 1 }).toString();
  if (weekStart !== monday || t.dayOfWeek < 4) return 0;
  return callsToClose(marks, zone, monday, today).length;
}

/** From Thursday of the week shown (only this week): "N calls to close this week". */
export function WeekCallsLine({ today, weekStart, zone }: { today: string; weekStart: string; zone: string }) {
  const n = weekCallsToClose(useCallMarks(), zone, today, weekStart);
  if (!n) return null;
  return (
    <a className="mini quiet week-calls-line" href={`${callsHash({ occurrence: null })}?show=open`} data-week-calls-line="">
      {CLOSE_TEXT.weekLine(n)}
    </a>
  );
}

/** Close out's list: today's calls still open, with Open and Skip all and close. */
export function CloseOutCalls({ date, today, zone }: { date: string; today: string; zone: string }) {
  const marks = useCallMarks();
  const reload = useCallsReload();
  const { env } = useContext(MenuCtx);
  const list = callsToClose(marks, zone, date, date);
  const head = CLOSE_TEXT.closeOutHead(date === today ? null : Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long" }));
  if (!list.length) return null;
  const skipAll = async (m: CallMark) => {
    const d = await call<{ calls: { skipped: { id: number; was: "open" | "failed" }[] }[] }>("meeting.skip_all", { occurrenceIds: [m.occurrenceId] });
    const items = d.calls.flatMap((c) => c.skipped);
    reload();
    env?.undoable?.(CLOSE_TEXT.closedOne, async () => {
      if (items.length) await call("meeting.unskip_all", { items });
      reload();
    });
  };
  return (
    <section className="cp-section" aria-label={head} data-closeout-calls="">
      <h3>{head}</h3>
      <ul className="cp-owed">
        {list.map((m) => (
          <li key={m.occurrenceId}>
            <span className="cp-owed-what">
              {m.name} <span className="muted">{m.label}</span>
            </span>
            <span className="cp-calls-acts">
              <button type="button" className="mini" onClick={() => openCall(m.occurrenceId)}>{CLOSE_TEXT.closeOutOpen}</button>
              <button type="button" className="mini quiet" onClick={() => void skipAll(m).catch(() => undefined)} data-call-act="skip-all">{CLOSE_TEXT.skipAllClose}</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
