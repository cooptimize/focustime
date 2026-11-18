// MC-1d: the one short mark a registered call's meeting carries wherever it is drawn (Day's Timeline and Cards, Week,
// the block panel, the phone): its state in the call's own words (plan/call-words.ts). A press opens the call's page.
// A real button, so it is reached by Tab and read by a screen reader as "<call>: <state>. Open the call".
import type { MouseEvent } from "react";
import { CALL_ACTIONS, MEETING_WORDS } from "../../plan/call-words.ts";
import { Icon } from "../icons.tsx";
import { openCall, type CallMark } from "./calls.ts";

export function CallMarkButton({ call, tabIndex }: { call: CallMark; tabIndex?: number }) {
  return (
    <button
      type="button"
      className={`call-mark ev-call${call.needsMe ? " needs" : ""}${call.state === "failed" ? " failed" : ""}`}
      data-call={call.occurrenceId}
      {...(tabIndex !== undefined ? { tabIndex } : {})}
      aria-label={`${call.role}, ${call.name}: ${call.label}. ${call.state === "ready" && call.open && call.review ? CALL_ACTIONS.review : CALL_ACTIONS.open}`}
      title={`${call.role} · ${call.name}: ${call.label}`}
      onClick={(e) => (e.stopPropagation(), openCall(call.occurrenceId))}
      onKeyDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* DY-1: the call's type beside its state where there is room; always in the label and the hover. */}
      <span className="call-type" aria-hidden="true">{call.role}</span>
      <span className="call-what">{call.label}</span>
    </button>
  );
}

/** DY-1: a meeting that is one of a series on the calendar (never guessed from a title). */
export function RepeatMark() {
  return (
    <span className="repeat-mark" title={MEETING_WORDS.repeats}>
      <Icon name="repeats" label={MEETING_WORDS.repeats} />
    </span>
  );
}

/** DY-1: the one mark a drawn meeting carries: its registered call's (which names its type), else Repeats, else none. */
export function MeetingMark({ e, call, tabIndex }: { e: { repeats?: true | undefined }; call: CallMark | null; tabIndex?: number }) {
  if (call) return <CallMarkButton call={call} {...(tabIndex !== undefined ? { tabIndex } : {})} />;
  return e.repeats ? <RepeatMark /> : null;
}

/** A call's meeting title opens the call (the rest of the meeting still opens its menu). */
export const titleOpensCall = (call: CallMark | null) =>
  call ? { onClick: (e: MouseEvent) => (e.stopPropagation(), openCall(call.occurrenceId)), "data-call-title": "" } : {};
