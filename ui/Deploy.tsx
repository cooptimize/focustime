// WK-3 (DP-0): the pieces a Deployment to-do adds to the screens: its icon and window on a row, the week's after-hours
// chip, and the offer after Done: "Tell <client> it's deployed" through LP-1's Close the loop (a draft with the note and
// the items, the preview, Send only on Confirm), or Not now, which leaves it simply done. No runbook, checklist or
// status flow: the runbook and the execution stay in Coop.
import { useState } from "react";
import { call } from "./api.ts";
import { CloseButton } from "./CloseButton.tsx";
import { Modal } from "./DevOpsWrite.tsx";
import { PersonPicker, type PersonValue } from "./PersonPicker.tsx";
import { SendLoop } from "./SendLoop.tsx";
import type { WeekLoadData } from "../actions/types.ts";
import { deployedWhen, afterHoursText, deployedText, tellWhat, windowText, type AfterHoursPart } from "../plan/deploy.ts";
import type { Pick } from "../plan/types.ts";
import { formatDuration } from "../week/format.ts";

/** The Deployment icon: a small upward arrow out of a tray (shipping it), drawn in the row's text colour. */
export function DeployIcon({ title = "Deployment" }: { title?: string }) {
  return (
    <svg className="deploy-icon" viewBox="0 0 16 16" width="1em" height="1em" role="img" aria-label={title}>
      <title>{title}</title>
      <path d="M8 2.5 4.5 6h2.3v4.2h2.4V6h2.3Z" fill="currentColor" />
      <path d="M2.5 9.5v3.5h11V9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A Deployment's window chip ("19:00–21:00"), in place of a to-do's time. */
export function WindowChip({ pick }: { pick: Pick }) {
  if (!pick.window) return null;
  return (
    <span className="deploy-window" title={`Deployment window ${windowText(pick.window)}`}>
      {windowText(pick.window)}
    </span>
  );
}

const WHY: Record<AfterHoursPart["why"], string> = { deployment: "deployment window", evening: "evening", weekend: "weekend" };
const day = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short" });

/** Week's header: "3h after hours this week" beside the borrowed-time chip, with what makes it up in its title. */
export function AfterHoursChip({ after }: { after: WeekLoadData["afterHours"] }) {
  const text = after ? afterHoursText(after.minutes) : null;
  if (!after || !text) return null;
  const lines = after.parts.map((p) => `${day(p.date)} · ${p.title} · ${formatDuration(p.minutes)} (${WHY[p.why]})`);
  return (
    <span className="after-hours-chip" title={`Extra time outside your day shape:\n${lines.join("\n")}`} data-testid="after-hours">
      {text}
    </span>
  );
}

/** The client's name as the week knows it. */
export function clientNameFor(data: WeekLoadData, key: string): string {
  return data.planClients.find((c) => c.clientKey === key)?.clientName ?? data.devops?.find((w) => w.clientKey === key)?.clientName ?? key;
}

/**
 * After a Deployment is ticked done: offer to tell the client. Tell opens a promise of mine ("Tell <client> it's
 * deployed: <title>", who I choose) and LP-1's draft with the note and items; it goes only from the preview's Send.
 * Not now (or closing) leaves the to-do done and nothing else. Backing out of the draft removes the promise it opened.
 */
export function DeployedOffer({ pick, clientName, demo, today, onDone }: { pick: Pick; clientName: string; demo: boolean; today: string; onDone: (notice: string | null) => void }) {
  const [who, setWho] = useState<PersonValue>({ who: "", whoRef: null });
  const [promise, setPromise] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const links = pick.links ?? [];
  const tell = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ followUp: { id: number } }>("followup.add", {
        what: tellWhat(clientName, pick.title),
        clientKey: pick.clientKey,
        ...(who.who.trim() ? { who: who.who.trim(), ...(who.whoRef ? { whoRef: who.whoRef } : {}) } : {}),
        ...(links[0] ? { itemId: links[0].id } : {}),
      });
      setPromise(r.followUp.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    }
    setBusy(false);
  };
  const back = async () => {
    if (promise !== null) await call("followup.delete", { id: promise }).catch(() => undefined);
    onDone(null);
  };
  const title = `Tell ${clientName} it's deployed`;
  return (
    <Modal label={title} busy={busy} onClose={() => void back()}>
      <div className="cap-dialog-head">
        <h2>{title}</h2>
        <CloseButton onClose={() => void back()} disabled={busy} />
      </div>
      {promise === null ? (
        <div className="deployed-ask">
          <p className="deployed-done"><DeployIcon /> {pick.title} is done</p>
          <p className="muted">
            {pick.window ? `${windowText(pick.window)} · ` : ""}
            {[pick.deployItems?.map((i) => i.name).join(", "), pick.notes].filter(Boolean).join(" · ") || "No note of what went"}
            {links.length ? ` · ${links.map((l) => `#${l.id}`).join(", ")}` : ""}
          </p>
          <label className="deployed-who">
            Who to tell <PersonPicker value={who} onChange={setWho} clientKey={pick.clientKey} placeholder="Someone at the client (optional)" />
          </label>
          {error && <p className="set-problem" role="alert">{error}</p>}
          <div className="sl-actions">
            <button type="button" className="mini primary" disabled={busy} onClick={() => void tell()}>{title}</button>
            <button type="button" className="mini" onClick={() => onDone(null)}>Not now</button>
          </div>
        </div>
      ) : (
        <SendLoop
          promiseKey={`f${promise}`}
          who={who.who.trim() || null}
          demo={demo}
          initialText={{ text: deployedText({ who: who.who.trim() || null, clientName, title: pick.title, note: pick.notes, links, items: pick.deployItems ?? [], when: deployedWhen(pick, today), myName: null }), from: "A plain draft from what the deployment moved. Edit it as you like." }}
          onClosed={(m) => onDone(m)}
          onCancel={() => void back()}
          closeWithout={async (v) => {
            try {
              await call("followup.close", { id: promise, note: v.note, ...(v.how ? { how: v.how } : {}) });
              onDone("Loop closed");
              return null;
            } catch (e) {
              return e instanceof Error ? e.message : "That didn't work";
            }
          }}
        />
      )}
    </Modal>
  );
}
