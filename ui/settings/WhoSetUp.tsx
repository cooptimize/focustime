// IN-1: Admin › People › Who's set up, and the invite sheet. Cooptimizers only, with yes or no marks (signed in with the
// day they were last active, DevOps connected, Calendar connected, and Teams app added where FocusTime can know it),
// filters and plain counts. Invite (one person) and Invite several (the ones ticked) open a sheet with an editable
// message: Open in Teams (a 1:1 chat, one person at a time with Next), Open in Outlook (one email to all), Copy
// message. FocusTime sends nothing: it opens Teams or Outlook for the admin to send, and records only "Invited <day>
// by <admin>" (admin.invited). The server checks every read and write again.
import { useEffect, useMemo, useState } from "react";
import { call } from "../api.ts";
import { CloseButton, useReturnFocus } from "../CloseButton.tsx";
import { shortDate } from "../labels.ts";
import { matchesFilter, NAME_TOKEN, mailtoLink, outlookComposeLink, personalize, SETUP_FILTERS, setupCounts, teamsChatLink, validEmail, type SetupFilter, type SetupRow } from "../../plan/invite.ts";

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
      ✓ Yes
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
                      {p.invited && <span className="set-hint adm-block">Invited {shortDate(p.invited.day)} by {p.invited.byName}</span>}
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
          onInvited={async (n) => {
            setMsg(n === 1 ? "Marked as invited." : `Marked ${n} people as invited.`);
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

export function InviteSheet({ people, invite, onClose, onInvited }: { people: SetupRow[]; invite: NonNullable<SetupData["invite"]>; onClose: () => void; onInvited: (n: number) => Promise<void> }) {
  useReturnFocus();
  const [message, setMessage] = useState(invite.template);
  const [subject, setSubject] = useState(invite.subject);
  // Teams opens one 1:1 chat at a time: the index of the next person.
  const [next, setNext] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const title = several ? `Invite ${people.length} people` : `Invite ${people[0]!.name}`;
  return (
    <div className="cap-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="cap-dialog invite-sheet"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) (e.stopPropagation(), e.preventDefault(), onClose());
        }}
      >
        <div className="cap-dialog-head">
          <h2>{title}</h2>
          {several && <span className="muted">{people.map((p) => p.name).join(", ")}</span>}
          <CloseButton onClose={onClose} disabled={busy} />
        </div>
        <p className="invite-note">FocusTime doesn't send this. It opens in Teams or Outlook for you to send.</p>
        <label className="set-field">
          <span className="set-label">Subject (email)</span>
          <input value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="set-field">
          <span className="set-label">Message</span>
          <textarea className="invite-message" rows={14} maxLength={1500} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
          <span className="set-hint">
            {NAME_TOKEN} becomes each person's first name{several ? ` in Teams, and "all" in one email` : ""}.
          </span>
        </label>
        {noEmail.length > 0 && <p className="set-problem">FocusTime has no email address for {noEmail.map((p) => p.name).join(", ")}. Copy the message for them instead.</p>}
        <div className="wd-actions invite-acts">
          {withEmail.length > 0 && (
            <button type="button" className="primary" disabled={busy || !teamsPerson} onClick={() => void openTeams()}>
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
        {error && (
          <p className="error-line" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
