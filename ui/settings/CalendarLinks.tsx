// CAL-1: Settings › Accounts and calendars › Calendars added by link. Paste any calendar's ICS link, check it ("Found
// 12 upcoming events"), name it, pick a color, Busy only or Show titles, Personal or Work, then Save. The link is
// sent once to be checked and kept; it never comes back (only its host, "calendar.google.com/…"). Read only.
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { CalendarLinkView } from "../../actions/calendar-link-types.ts";
import { call } from "../api.ts";
import { updatedAgo } from "../refresh.ts";

type Mode = "busy" | "titles";
type Kind = "personal" | "work";

/** The colors to pick from: distinct from each other and from client colors' usual hues, in both themes. */
export const LINK_COLORS: readonly { value: string; name: string }[] = [
  { value: "#8b5cf6", name: "Violet" },
  { value: "#0d9488", name: "Teal" },
  { value: "#e11d48", name: "Rose" },
  { value: "#d97706", name: "Amber" },
  { value: "#0284c7", name: "Sky" },
  { value: "#64748b", name: "Slate" },
];

const err = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

export function CalendarLinks({ timeZone, onChanged }: { timeZone: string; onChanged: () => void }) {
  const [links, setLinks] = useState<CalendarLinkView[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const load = async () => {
    try {
      const r = (await call("calendar_link.list", {})) as { links: CalendarLinkView[] };
      setLinks(r.links);
      setProblem(null);
    } catch (e) {
      setProblem(err(e));
    }
  };
  useEffect(() => {
    void load();
    const t = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const changed = async () => {
    await load();
    onChanged();
  };
  return (
    <>
      <p className="muted set-intro">
        Any calendar with a subscription link (an <em>.ics</em> or <em>webcal://</em> address): Google, Outlook, iCloud, school and activity apps. Read only, refreshed about every 15 minutes while you use FocusTime. Events count against your free time like Outlook's and Google's.
      </p>
      {problem && <p className="field-problem" role="status">{problem}</p>}
      {links && links.length > 0 && (
        <ul className="set-list cal-links">
          {links.map((l) => (
            <LinkRow key={l.id} link={l} clock={clock} timeZone={timeZone} onChanged={changed} />
          ))}
        </ul>
      )}
      {links && !links.length && !adding && <p className="muted">No calendars added by link yet.</p>}
      {adding ? (
        <AddLink onDone={async (saved) => (setAdding(false), saved ? await changed() : undefined)} />
      ) : (
        <p>
          <button type="button" className="mini primary" onClick={() => setAdding(true)} disabled={!links || links.length >= 10}>
            Add a calendar by link
          </button>
          {links && links.length >= 10 && <span className="muted"> At most 10. Remove one first.</span>}
        </p>
      )}
      <WhereToFind />
    </>
  );
}

function LinkRow({ link: l, clock, timeZone, onChanged }: { link: CalendarLinkView; clock: number; timeZone: string; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<null | "settings" | "replace" | "remove">(null);
  const [status, setStatus] = useState<string | null>(null);
  const state = l.failure ? (l.broken ? "error" : "cached") : "live";
  return (
    <li className={`cal-link source ${state}`} data-link={l.id} style={{ "--cal": l.color } as CSSProperties}>
      <div className="cal-link-head">
        <span className="dot cal-dot" aria-hidden="true" />
        <strong>{l.name}</strong>
        <span className={`state ${state}`}>{l.failure ? (l.broken ? "stopped working" : "failed") : "live"}</span>
        <span className="muted">
          {[l.host, l.mode === "busy" ? "Busy only" : "Shows titles", l.kind === "personal" ? "Personal" : "Work", `${l.eventCount} ${l.eventCount === 1 ? "event" : "events"}`, l.fetchedAt ? updatedAgo(l.fetchedAt, clock, timeZone) : null].filter(Boolean).join(" · ")}
        </span>
        <span className="row-actions">
          <button type="button" className={`mini${l.broken ? " primary" : ""}`} aria-pressed={editing === "replace"} onClick={() => setEditing(editing === "replace" ? null : "replace")}>
            Replace link
          </button>
          <button type="button" className="mini" aria-pressed={editing === "settings"} onClick={() => setEditing(editing === "settings" ? null : "settings")}>
            Edit
          </button>
          <button type="button" className="mini quiet" aria-pressed={editing === "remove"} onClick={() => setEditing(editing === "remove" ? null : "remove")}>
            Remove
          </button>
        </span>
      </div>
      {l.problem && (
        <p className="field-problem cal-link-problem" role="status">
          {l.problem}
        </p>
      )}
      {editing === "settings" && (
        <LinkFields
          initial={{ name: l.name, color: l.color, mode: l.mode, kind: l.kind }}
          submit="Save"
          onCancel={() => setEditing(null)}
          onSubmit={async (v) => {
            await call("calendar_link.update", { id: l.id, ...v });
            setEditing(null);
            setStatus(v.mode === "busy" && l.mode === "titles" ? "Saved. Titles from this calendar were deleted" : "Saved");
            await onChanged();
          }}
        />
      )}
      {editing === "replace" && (
        <ReplaceLink
          id={l.id}
          onDone={async (saved) => {
            setEditing(null);
            if (saved) {
              setStatus("New link checked and saved");
              await onChanged();
            }
          }}
        />
      )}
      {editing === "remove" && (
        <div className="set-row cal-link-confirm">
          <span>Remove {l.name}? Its link and its {l.eventCount} stored events are deleted.</span>
          <button
            type="button"
            className="mini danger"
            onClick={async () => {
              try {
                await call("calendar_link.remove", { id: l.id });
                await onChanged();
              } catch (e) {
                setStatus(err(e));
              }
            }}
          >
            Remove
          </button>
          <button type="button" className="mini quiet" onClick={() => setEditing(null)}>
            Keep it
          </button>
        </div>
      )}
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
    </li>
  );
}

type Fields = { name: string; color: string; mode: Mode; kind: Kind };

function LinkFields({ initial, submit, onSubmit, onCancel, disabled }: { initial: Fields; submit: string; onSubmit: (v: Fields) => Promise<void>; onCancel: () => void; disabled?: boolean }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  return (
    <form
      className="cal-link-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.name.trim()) return setProblem("Give the calendar a name");
        setBusy(true);
        setProblem(null);
        try {
          await onSubmit({ ...v, name: v.name.trim() });
        } catch (x) {
          setProblem(err(x));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="set-inline">
        <span>Name</span>
        <input type="text" value={v.name} maxLength={60} placeholder="Family" onChange={(e) => setV({ ...v, name: e.target.value })} />
      </label>
      <fieldset className="set-choice cal-colors">
        <legend>Color</legend>
        {LINK_COLORS.map((c) => (
          <label key={c.value} className="cal-swatch" style={{ "--cal": c.value } as CSSProperties} title={c.name}>
            <input type="radio" name={`${id}-color`} checked={v.color === c.value} onChange={() => setV({ ...v, color: c.value })} aria-label={c.name} />
            <span aria-hidden="true" />
          </label>
        ))}
      </fieldset>
      <fieldset className="set-choice">
        <legend>Events show as</legend>
        <label>
          <input type="radio" name={`${id}-mode`} checked={v.mode === "busy"} onChange={() => setV({ ...v, mode: "busy" })} /> Busy only
        </label>
        <label>
          <input type="radio" name={`${id}-mode`} checked={v.mode === "titles"} onChange={() => setV({ ...v, mode: "titles" })} /> Show titles
        </label>
        <span className="set-hint">Busy only keeps no titles, places or notes: just when you're busy.</span>
      </fieldset>
      <fieldset className="set-choice">
        <legend>This calendar is</legend>
        <label>
          <input type="radio" name={`${id}-kind`} checked={v.kind === "personal"} onChange={() => setV({ ...v, kind: "personal" })} /> Personal
        </label>
        <label>
          <input type="radio" name={`${id}-kind`} checked={v.kind === "work"} onChange={() => setV({ ...v, kind: "work" })} /> Work
        </label>
        <span className="set-hint">Personal events hide with the Personal events switch (G); work events count as meetings.</span>
      </fieldset>
      <div className="cal-link-actions">
        <button type="submit" className="mini primary" disabled={busy || disabled}>
          {busy ? "Saving…" : submit}
        </button>
        <button type="button" className="mini quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {problem && (
          <span className="field-problem" role="status">
            {problem}
          </span>
        )}
      </div>
    </form>
  );
}

/** The link box and Check. Only a link that checked out can be saved; the input is cleared after. */
function LinkInput({ label, onChecked }: { label: string; onChecked: (r: { host: string; upcoming: number; total: number } | null, url: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="cal-link-input">
      <label className="set-inline">
        <span>{label}</span>
        <input
          ref={ref}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://… or webcal://…"
          aria-label={`${label} (hidden once pasted)`}
          onChange={() => (setProblem(null), onChecked(null, ""))}
        />
      </label>
      <button
        type="button"
        className="mini primary"
        disabled={busy}
        onClick={async () => {
          const url = ref.current?.value ?? "";
          setBusy(true);
          setProblem(null);
          try {
            const r = (await call("calendar_link.preview", { url })) as { host: string; upcoming: number; total: number };
            onChecked(r, url);
          } catch (e) {
            setProblem(err(e));
            onChecked(null, "");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking…" : "Check link"}
      </button>
      {problem && (
        <p className="field-problem" role="status">
          {problem}
        </p>
      )}
    </div>
  );
}

const found = (r: { host: string; upcoming: number }) => `Found ${r.upcoming} upcoming ${r.upcoming === 1 ? "event" : "events"} on ${r.host}`;

function AddLink({ onDone }: { onDone: (saved: boolean) => void }) {
  const [checked, setChecked] = useState<{ host: string; upcoming: number; total: number } | null>(null);
  const url = useRef("");
  return (
    <div className="cal-link-add set-row" aria-label="Add a calendar by link" role="group">
      <strong>Add a calendar by link</strong>
      <LinkInput label="Calendar link" onChecked={(r, u) => ((url.current = u), setChecked(r))} />
      {checked && (
        <p className="cal-link-found" role="status">
          {found(checked)}
        </p>
      )}
      <LinkFields
        initial={{ name: "", color: LINK_COLORS[0]!.value, mode: "busy", kind: "personal" }}
        submit="Save calendar"
        disabled={!checked}
        onCancel={() => onDone(false)}
        onSubmit={async (v) => {
          await call("calendar_link.add", { url: url.current, ...v });
          url.current = "";
          onDone(true);
        }}
      />
    </div>
  );
}

function ReplaceLink({ id, onDone }: { id: string; onDone: (saved: boolean) => void }) {
  const [checked, setChecked] = useState<{ host: string; upcoming: number; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = useRef("");
  return (
    <div className="cal-link-replace">
      <LinkInput label="New link" onChecked={(r, u) => ((url.current = u), setChecked(r))} />
      {checked && <p className="cal-link-found" role="status">{found(checked)}</p>}
      <div className="cal-link-actions">
        <button
          type="button"
          className="mini primary"
          disabled={!checked || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await call("calendar_link.replace", { id, url: url.current });
              url.current = "";
              onDone(true);
            } catch (e) {
              setProblem(err(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save new link"}
        </button>
        <button type="button" className="mini quiet" onClick={() => onDone(false)}>
          Cancel
        </button>
        {problem && <span className="field-problem">{problem}</span>}
      </div>
    </div>
  );
}

/** Where each provider keeps its link (CAL-1). Kept short; the Guide says the same. */
export function WhereToFind() {
  return (
    <details className="cal-link-help">
      <summary>Where do I find the link?</summary>
      <dl>
        <dt>Google Calendar</dt>
        <dd>On a computer: Settings, pick the calendar under "Settings for my calendars", then Integrate calendar › <em>Secret address in iCal format</em>. Google's own changes can take several hours to show up there.</dd>
        <dt>Outlook.com or Outlook on the web</dt>
        <dd>Settings › Calendar › Shared calendars › Publish a calendar: choose the calendar and "Can view when I'm busy" (or titles), Publish, then copy the <em>ICS</em> link.</dd>
        <dt>iCloud</dt>
        <dd>On iCloud.com or a Mac: share the calendar, turn on <em>Public Calendar</em>, and copy the link (it starts with webcal://). Anyone with the link can see the calendar.</dd>
        <dt>School, sports and other apps</dt>
        <dd>Look for "Subscribe", "Sync to calendar", "iCal" or "ICS". Copy the link rather than downloading the file.</dd>
      </dl>
      <p className="muted">The link works like a password: FocusTime keeps it encrypted, never shows it again (only its address's host), and you can Replace or Remove it here.</p>
    </details>
  );
}
