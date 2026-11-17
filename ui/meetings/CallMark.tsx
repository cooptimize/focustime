// MC-1d: the one short mark a registered call's meeting carries wherever it is drawn (Day's Timeline and Cards, Week,
// the block panel, the phone): its state in the call's own words (plan/call-words.ts). A press opens the call's page.
// A real button, so it is reached by Tab and read by a screen reader as "<call>: <state>. Open the call".
import type { MouseEvent } from "react";
import { CALL_ACTIONS } from "../../plan/call-words.ts";
import { openCall, type CallMark } from "./calls.ts";

export function CallMarkButton({ call, tabIndex }: { call: CallMark; tabIndex?: number }) {
  return (
    <button
      type="button"
      className={`call-mark ev-call${call.needsMe ? " needs" : ""}${call.state === "failed" ? " failed" : ""}`}
      data-call={call.occurrenceId}
      {...(tabIndex !== undefined ? { tabIndex } : {})}
      aria-label={`${call.name}: ${call.label}. ${call.state === "ready" && call.open && call.review ? CALL_ACTIONS.review : CALL_ACTIONS.open}`}
      title={`${call.name}: ${call.label}`}
      onClick={(e) => (e.stopPropagation(), openCall(call.occurrenceId))}
      onKeyDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {call.label}
    </button>
  );
}

/** A call's meeting title opens the call (the rest of the meeting still opens its menu). */
export const titleOpensCall = (call: CallMark | null) =>
  call ? { onClick: (e: MouseEvent) => (e.stopPropagation(), openCall(call.occurrenceId)), "data-call-title": "" } : {};
