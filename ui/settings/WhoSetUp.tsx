// IN-1: Admin › People › Who's set up, and the invite sheet. Cooptimizers only, with yes or no marks (signed in with the
// day they were last active, DevOps connected, Calendar connected, and Teams app added where FocusTime can know it),
// filters and plain counts. Invite (one person) and Invite several (the ones ticked) open a sheet with an editable
// message: Open in Teams (a 1:1 chat, one person at a time with Next), Open in Outlook (one email to all), Copy
// message; these open Teams or Outlook for the admin to send, and record only "Invited <day> by <admin>"
// (admin.invited). IN-2: where the admin's sign-in allows it (Close the loop's permissions), Send in Teams (one 1:1
// per person) and Create Outlook draft or Send email now (one email each, or one to everyone) send from FocusTime as
// the admin, after a preview of who, how and the final text; each is read back and the row reads "Invited by <admin>
// via Teams, <day>". Without the permission the sheet keeps the links with LP-1's note. The server checks it all again.
import { TextBox } from "../TextBox.tsx";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { call } from "../api.ts";
import { CloseButton, useReturnFocus } from "../CloseButton.tsx";
import { shortDate } from "../labels.ts";
import type { InviteAccessView, InvitePreviewView, InviteResultView, EmailSplit } from "../../actions/invite-types.ts";
import type { ChannelAccess } from "../../actions/loop-types.ts";
import { invitedLine, matchesFilter, NAME_TOKEN, mailtoLink, outlookComposeLink, personalize, SETUP_FILTERS, setupCounts, teamsChatLink, validEmail, type SetupFilter, type SetupRow } from "../../plan/invite.ts";
import { Icon } from "../icons.tsx";

type SetupData = {
  people: SetupRow[];
  counts: { total: number; signedIn: number; partly: number; notSignedIn: number; text: string };
  teamsKnown: boolean;
  invite: { appUrl: string; teamsAppLink: string | null; subject: string; template: string } | null;
};
type Via = "teams" | "outlook" | "email" | "copy";

function Mark({ yes, label }: { yes: boolean; label: string }) {
  return yes ? (
    <span className="adm-ok" aria-label={`${label}: yes`}>
      <Icon name="done" /> Yes
    </span>
  ) : (
    <span className="muted" aria-label={`${label}: no`}>
      No
    </span>
  );
}

export function WhoSetUp() {
  const [data, setData] = useState<SetupData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SetupFilter>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState<SetupRow[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => {
    try {
      setData(await call<SetupData>("admin.load", { section: "setup" }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this");
    }
  };
  useEffect(() => void load(), []);
  // A deep link (#/settings/admin-people/whos-set-up, or the command menu) lands here once the list is in.
  useEffect(() => {
    if (!data || !/\/whos-set-up$/.test(location.hash)) return;
    document.querySelector<HTMLElement>('[data-setting="whos-set-up"]')?.scrollIntoView?.({ block: "start" });
  }, [data]);
  const shown = useMemo(() => (data ? data.people.filter((p) => matchesFilter(p, filter)) : []), [data, filter]);
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const counts = setupCounts(data.people);
  const invitable = (p: SetupRow) => !p.signedIn;
  const pickedRows = data.people.filter((p) => picked.has(p.id) && invitable(p));
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const notSignedShown = shown.filter(invitable);
  const allPicked = notSignedShown.length > 0 && notSignedShown.every((p) => picked.has(p.id));
  return (
    <section className="adm-setup" data-setting="whos-set-up" aria-labelledby="whos-set-up-h">
      <h3 id="whos-set-up-h">Who's set up</h3>
      <p className="adm-setup-counts" role="status">
        {counts.text}
      </p>
      <p className="muted">Cooptimizers only. Yes or no for each; FocusTime never shows which DevOps clients or PATs anyone has.{data.teamsKnown ? "" : " Teams app added isn't known here: the Teams app isn't set up for this FocusTime."}</p>
      <div className="set-row-actions adm-setup-bar">
        <div className="adm-filter" role="radiogroup" aria-label="Show">
          {SETUP_FILTERS.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={filter === id} onClick={() => setFilter(id)}>
              {label}
              {id === "not_signed_in" ? ` (${counts.notSignedIn})` : id === "partly" ? ` (${counts.partly})` : ` (${counts.total})`}
            </button>
          ))}
        </div>
        <button type="button" className="mini adm-setup-several" disabled={pickedRows.length === 0 || !data.invite} title={pickedRows.length ? undefined : "Tick the people who haven't signed in first"} onClick={() => setInviting(pickedRows)}>
          Invite several{pickedRows.length ? ` (${pickedRows.length})` : ""}
        </button>
        {msg && (
          <span className="set-hint" role="status">
            {msg}
          </span>
        )}
      </div>
      {!data.invite && <p className="set-problem">FocusTime has no public address set, so there is no link to invite people to.</p>}
      <div className="adm-scroll">
        <table className="adm-table adm-setup-table" aria-label="Who's set up">
          <thead>
            <tr>
              <th scope="col">
                <input type="checkbox" aria-label="Select everyone shown who hasn't signed in" disabled={notSignedShown.length === 0} checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(notSignedShown.map((p) => p.id)))} />
              </th>
              <th scope="col">Name</th>
              <th scope="col">Signed in</th>
              <th scope="col">DevOps connected</th>
              <th scope="col">Calendar connected</th>
              {data.teamsKnown && <th scope="col">Teams app added</th>}
              <th scope="col">
                <span className="sr-only">Invite</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={data.teamsKnown ? 7 : 6} className="muted">
                  {filter === "not_signed_in" ? "Everyone has signed in." : filter === "partly" ? "Nobody is set up partly." : "No Cooptimizers yet. They come from Dataverse (Refresh from Dataverse above)."}
                </td>
              </tr>
            )}
            {shown.map((p) => (
              <tr key={p.id} data-person={p.id}>
                <td>{invitable(p) && <input type="checkbox" aria-label={`Select ${p.name}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} />}</td>
                <th scope="row">
                  {p.name}
                  {p.me && <span className="muted"> (you)</span>}
                </th>
                <td>
                  <Mark yes={p.signedIn} label="Signed in" />
                  {p.lastActiveDay && <span className="set-hint adm-block">Last active {shortDate(p.lastActiveDay)}</span>}
                </td>
                <td>{p.signedIn ? <Mark yes={p.devops} label="DevOps connected" /> : <span className="muted">No</span>}</td>
                <td>{p.signedIn ? <Mark yes={p.calendar} label="Calendar connected" /> : <span className="muted">No</span>}</td>
                {data.teamsKnown && <td>{<Mark yes={p.teams === true} label="Teams app added" />}</td>}
                <td>
                  {invitable(p) && (
                    <>
                      <button type="button" className="mini" disabled={!data.invite} onClick={() => setInviting([p])}>
                        Invite
                      </button>
                      {p.invited && <span className="set-hint adm-block">{invitedLine(p.invited, shortDate)}</span>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inviting && data.invite && (
        <InviteSheet
          people={inviting}
          invite={data.invite}
          onClose={() => setInviting(null)}
          onInvited={async (n, sent) => {
            setMsg(sent ?? (n === 1 ? "Marked as invited." : `Marked ${n} people as invited.`));
            setPicked(new Set());
            await load();
          }}
        />
      )}
    </section>
  );
}

function openLink(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type Step = { kind: "compose" } | { kind: "preview"; p: InvitePreviewView } | { kind: "result"; r: InviteResultView };
const SEND_LABEL = { teams: "Send in Teams", draft: "Create Outlook draft", send: "Send email now" } as const;
const ready = (a: ChannelAccess | undefined) => a?.state === "ready";
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Nothing was sent");

export function InviteSheet({ people, invite, onClose, onInvited }: { people: SetupRow[]; invite: NonNullable<SetupData["invite"]>; onClose: () => void; onInvited: (n: number, sent?: string) => Promise<void> }) {
  useReturnFocus();
  const [message, setMessage] = useState(invite.template);
  const [subject, setSubject] = useState(invite.subject);
  // Teams opens one 1:1 chat at a time: the index of the next person.
  const [next, setNext] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // IN-2: what this admin's sign-in allows (a probe; nothing is sent), and the send's own steps.
  const [access, setAccess] = useState<InviteAccessView | null>(null);
  const [emailMode, setEmailMode] = useState<"draft" | "send">("draft");
  const [split, setSplit] = useState<EmailSplit>("each");
  const [step, setStep] = useState<Step>({ kind: "compose" });
  useEffect(() => {
    let live = true;
    call<InviteAccessView>("admin.invite_access", {}).then(
      (a) => live && setAccess(a),
      () => live && setAccess(null),
    );
    return () => void (live = false);
  }, []);
  const several = people.length > 1;
  const withEmail = people.filter((p) => validEmail(p.email));
  const noEmail = people.filter((p) => !validEmail(p.email));
  const record = async (ids: string[], via: Via) => {
    setBusy(true);
    setError(null);
    try {
      await call("admin.invited", { personIds: ids, via });
      await onInvited(ids.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not marked as invited");
    } finally {
      setBusy(false);
    }
  };
  const teamsPerson = withEmail[next] ?? null;
  const openTeams = async () => {
    if (!teamsPerson) return;
    openLink(teamsChatLink(teamsPerson.email!, personalize(message, teamsPerson.name)));
    await record([teamsPerson.id], "teams");
    setNote(`Opened a Teams chat with ${teamsPerson.name}. Send it there.`);
    setNext((i) => i + 1);
  };
  const emailBody = personalize(message, several ? null : people[0]!.name);
  const openOutlook = async (via: "outlook" | "email") => {
    if (!withEmail.length) return;
    const to = withEmail.map((p) => p.email!);
    openLink(via === "outlook" ? outlookComposeLink(to, subject, emailBody) : mailtoLink(to, subject, emailBody));
    await record(withEmail.map((p) => p.id), via);
    setNote(via === "outlook" ? "Opened an email in Outlook. Send it there." : "Opened an email in your mail app. Send it there.");
  };
  const copy = async () => {
    if (await copyText(emailBody)) {
      await record(people.map((p) => p.id), "copy");
      setNote("Message copied. Paste it where you like and send it.");
    } else setError("Couldn't copy. Select the message and copy it yourself.");
  };

  // IN-2: Send from FocusTime. Only everyone with an address; the server checks the recipients and the permission again.
  const canTeams = ready(access?.teams);
  const canDraft = ready(access?.draft);
  const canSendNow = canDraft && ready(access?.send);
  const canSend = (canTeams || canDraft) && withEmail.length > 0 && noEmail.length === 0;
  const asks = access ? ([access.teams, access.draft, ...(canDraft ? [access.send] : [])].filter((a) => a.state === "consent") as Extract<ChannelAccess, { state: "consent" }>[]) : [];
  const unavailable = access && !canTeams && !canDraft && [access.teams, access.draft].every((a) => a.state === "unavailable");
  const preview = async (channel: "teams" | "email") => {
    setBusy(true);
    setError(null);
    try {
      const p = await call<InvitePreviewView>("admin.invite_preview", {
        personIds: withEmail.map((x) => x.id),
        channel,
        message,
        ...(channel === "email" ? { subject, mode: canSendNow ? emailMode : "draft", ...(several ? { split } : {}) } : {}),
      });
      setStep({ kind: "preview", p });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const settle = async (r: InviteResultView) => {
    setStep({ kind: "result", r });
    if (r.invited) await onInvited(r.invited, r.message);
  };
  const send = async (p: InvitePreviewView) => {
    setBusy(true);
    setError(null);
    try {
      await settle(await call<InviteResultView>("admin.invite_send", { previewId: p.previewId }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const retry = async (r: InviteResultView) => {
    setBusy(true);
    setError(null);
    try {
      await settle(await call<InviteResultView>("admin.invite_retry", { batchId: r.batchId }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const title = several ? `Invite ${people.length} people` : `Invite ${people[0]!.name}`;
  const sendLabel = (p: { channel: "teams" | "email"; mode: "draft" | "send" | null }) => (p.channel === "teams" ? SEND_LABEL.teams : SEND_LABEL[p.mode ?? "draft"]);
  let body: ReactNode;
  if (step.kind === "preview") {
    const p = step.p;
    body = (
      <section className="invite-preview" aria-label="Preview">
        <dl className="sl-facts">
          <dt className="close-loop-label">Send by</dt>
          <dd>{p.how}</dd>
          <dt className="close-loop-label">To</dt>
          <dd>{p.recipients.map((r) => r.name).join(", ")}</dd>
          {p.subject && (
            <>
              <dt className="close-loop-label">Subject</dt>
              <dd>{p.subject}</dd>
            </>
          )}
        </dl>
        <ol className="invite-messages" aria-label={p.messages.length === 1 ? "The message" : `The ${p.messages.length} messages`}>
          {p.messages.map((m, i) => (
            <li key={i}>
              {p.messages.length > 1 && <span className="close-loop-label">To {m.to.join(", ")}</span>}
              <div className="sl-text">{m.text}</div>
            </li>
          ))}
        </ol>
        <p className="sl-final">{p.note}</p>
        <div className="wd-actions invite-acts">
          <button type="button" className="primary" disabled={busy} onClick={() => void send(p)}>
            {busy ? "Sending…" : sendLabel(p)}
          </button>
          <button type="button" disabled={busy} onClick={() => setStep({ kind: "compose" })}>
            Back to the message
          </button>
        </div>
      </section>
    );
  } else if (step.kind === "result") {
    const r = step.r;
    body = (
      <section className="invite-result" aria-label="Result">
        <p className={r.ok ? "sl-result" : "sl-result bad"} role={r.ok ? "status" : "alert"}>
          {r.message}
        </p>
        <ul className="sl-parts">
          {r.items.map((it, i) => (
            <li key={i} className={it.ok ? "ok" : "bad"}>
              <Icon name={it.ok ? "done" : "close"} />{" "}
              <strong>{it.names.join(", ")}</strong>: {it.line}
              {it.link && it.ok && (
                <>
                  {" "}
                  <a href={it.link} target="_blank" rel="noreferrer">
                    {r.channel === "teams" ? "Open in Teams" : it.state === "draft" ? "Open draft" : "Open in Outlook"}
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="wd-actions invite-acts">
          {r.retry && (
            <button type="button" className="primary" disabled={busy} onClick={() => void retry(r)}>
              {busy ? "Trying again…" : `Retry for ${r.items.filter((x) => !x.ok).flatMap((x) => x.names).length === 1 ? r.items.find((x) => !x.ok)!.names[0] : "the ones not sent"}`}
            </button>
          )}
          <button type="button" className={r.retry ? undefined : "primary"} disabled={busy} onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    );
  } else
    body = (
      <>
        <p className="invite-note">{canSend ? "Send it from FocusTime as you, or open it in Teams or Outlook and send it there." : "FocusTime doesn't send this. It opens in Teams or Outlook for you to send."}</p>
        <label className="set-field">
          <span className="set-label">Subject (email)</span>
          <input value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="set-field">
          <span className="set-label">Message</span>
          <TextBox className="invite-message" minRows={14} maxRows={20} maxLength={1500} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
          <span className="set-hint">
            {NAME_TOKEN} becomes each person's first name{several ? (canSend ? `, and "all" in one email to everyone` : ` in Teams, and "all" in one email`) : ""}.
          </span>
        </label>
        {noEmail.length > 0 && <p className="set-problem">FocusTime has no email address for {noEmail.map((p) => p.name).join(", ")}. Copy the message for them instead.</p>}
        {canSend && (
          <div className="invite-send" role="group" aria-label="Send from FocusTime">
            <span className="close-loop-label">Send from FocusTime</span>
            {canTeams && (
              <div className="invite-send-way">
                <button type="button" className="primary" disabled={busy || !message.trim()} onClick={() => void preview("teams")}>
                  {several ? `Send in Teams (${withEmail.length} chats)` : "Send in Teams"}
                </button>
                <span className="set-hint">{several ? "A 1:1 chat with each person, as you" : "A 1:1 chat, as you"}</span>
              </div>
            )}
            {canDraft && (
              <div className="invite-send-way">
                <button type="button" className={canTeams ? undefined : "primary"} disabled={busy || !message.trim() || !subject.trim()} onClick={() => void preview("email")}>
                  {SEND_LABEL[canSendNow ? emailMode : "draft"]}
                </button>
                <div className="sl-targets" role="radiogroup" aria-label="Email">
                  <label>
                    <input type="radio" name="invite-mode" checked={emailMode === "draft" || !canSendNow} onChange={() => setEmailMode("draft")} /> Outlook draft
                  </label>
                  <label title={canSendNow ? undefined : "Sending email now needs one more permission (below)"}>
                    <input type="radio" name="invite-mode" disabled={!canSendNow} checked={emailMode === "send" && canSendNow} onChange={() => setEmailMode("send")} /> Send now
                  </label>
                </div>
                {several && (
                  <div className="sl-targets" role="radiogroup" aria-label="Emails">
                    <label>
                      <input type="radio" name="invite-split" checked={split === "each"} onChange={() => setSplit("each")} /> One email each
                    </label>
                    <label>
                      <input type="radio" name="invite-split" checked={split === "one"} onChange={() => setSplit("one")} /> One email to everyone
                    </label>
                  </div>
                )}
              </div>
            )}
            <span className="set-hint">You see who gets it and the final text before anything is sent.</span>
          </div>
        )}
        {(asks.length > 0 || unavailable) && (
          <div className="sl-fallback invite-fallback">
            <p>{unavailable ? "Sign in to Microsoft to send from FocusTime. Until then, open it prefilled and send it there." : canSend ? "Send email now needs one more permission, which an admin may need to approve. Until then, create the Outlook draft and send it from Outlook." : access!.note}</p>
            {access?.canAsk &&
              asks.map((a) => (
                <a key={a.consent} className="mini" href={`/auth/microsoft/login?consent=${a.consent}`}>
                  {a.consent === "teams_send" ? "Allow sending in Teams" : a.consent === "mail_draft" ? "Allow Outlook drafts" : "Allow sending email now"}
                </a>
              ))}
          </div>
        )}
        <div className="wd-actions invite-acts" role="group" aria-label="Open it yourself">
          {withEmail.length > 0 && (
            <button type="button" className={canSend ? undefined : "primary"} disabled={busy || !teamsPerson} onClick={() => void openTeams()}>
              {!teamsPerson ? "Teams: all opened" : several ? (next === 0 ? `Open in Teams: ${teamsPerson.name} (1 of ${withEmail.length})` : `Next: ${teamsPerson.name} (${next + 1} of ${withEmail.length})`) : "Open in Teams"}
            </button>
          )}
          {withEmail.length > 0 && (
            <button type="button" disabled={busy} onClick={() => void openOutlook("outlook")}>
              {several ? `Open in Outlook (one email to ${withEmail.length})` : "Open in Outlook"}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void copy()}>
            Copy message
          </button>
          {withEmail.length > 0 && (
            <button type="button" className="link-btn" disabled={busy} onClick={() => void openOutlook("email")} title="If Outlook on the web doesn't open, use the mail app on this computer">
              Use my mail app instead
            </button>
          )}
        </div>
        {note && (
          <p className="set-hint" role="status">
            {note}
          </p>
        )}
      </>
    );
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="cap-dialog invite-sheet"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key !== "Escape" || busy) return;
          e.stopPropagation();
          e.preventDefault();
          if (step.kind === "preview") setStep({ kind: "compose" });
          else onClose();
        }}
      >
        <div className="cap-dialog-head">
          <h2>{title}</h2>
          {several && <span className="muted">{people.map((p) => p.name).join(", ")}</span>}
          <CloseButton onClose={onClose} disabled={busy} />
        </div>
        {body}
        {error && (
          <p className="error-line" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
