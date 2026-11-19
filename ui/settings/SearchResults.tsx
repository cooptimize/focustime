// SA-5: Settings' search box and its results (the search itself is ui/settings/search.ts, the same one the command menu
// and Search Admin use). A result says where it is and opens it, scrolled to, marked, with its fold open. A setting on
// a client's page asks which client when there is more than one. Admin's results show only to admins, marked Admin,
// under the person's own. Something that isn't a setting says where it is, or that FocusTime doesn't have it. Nothing
// found says so, then up to three nearest settings, then the Guide. What is typed stays in this browser.
import type { KeyboardEvent } from "react";
import type { SettingsClient } from "../../actions/types.ts";
import { nearest, resultHref, type SearchResult } from "./search.ts";

/** What a result opens: a Settings place (with a client for a client's page), Admin's place, or an answer's link. */
export type Open = { kind: "settings"; section: string; setting: string | null } | { kind: "client"; client: string; setting: string } | { kind: "admin"; path: string } | { kind: "href"; href: string };

/** Where a result goes when it is pressed; null when it only answers in words, or needs a client chosen first. */
export function openOf(r: SearchResult): Open | null {
  if (r.kind === "admin" && r.href) return { kind: "admin", path: r.href.replace(/^#\/admin\/?/, "") };
  if (r.kind === "client") return null;
  if (r.section) return { kind: "settings", section: r.section, setting: r.setting ?? null };
  if (r.href) return { kind: "href", href: r.href };
  return null;
}

export const NOTHING = (q: string) => `Nothing in Settings called “${q}”`;

/** The box. Enter opens the first result; the first Esc clears it; Down moves into the results. */
export function SettingsSearch({ q, setQ, onEnter }: { q: string; setQ: (q: string) => void; onEnter: () => void }) {
  return (
    <div className="ps-search">
      <input
        type="search"
        value={q}
        placeholder="Search settings"
        aria-label="Search settings"
        aria-controls="settings-search-results"
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && q) {
            // The first Esc clears the search; the next closes Settings.
            e.preventDefault();
            e.nativeEvent.stopImmediatePropagation();
            setQ("");
          } else if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            document.querySelector<HTMLElement>("#settings-search-results :is(a, button)")?.focus();
          }
        }}
      />
    </div>
  );
}

/** Up and Down between the results. */
function arrows(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const all = [...document.querySelectorAll<HTMLElement>("#settings-search-results :is(a, button)")];
  const i = all.indexOf(e.currentTarget);
  (all[e.key === "ArrowDown" ? i + 1 : i - 1] ?? (e.key === "ArrowUp" ? document.querySelector<HTMLElement>(".ps-search input") : null))?.focus();
}

type Props = {
  q: string;
  hits: readonly SearchResult[];
  clients: readonly SettingsClient[];
  admin: boolean;
  demo: boolean;
  dev: boolean;
  phone: boolean;
  /** The client result whose list of clients is open (Enter on it opens it too). */
  asking: string | null;
  setAsking: (id: string | null) => void;
  onOpen: (o: Open) => void;
  onGuide?: (() => void) | undefined;
};

const nameOf = (c: SettingsClient) => c.setting.name ?? c.dataverseName ?? c.key;

export function SearchResults(p: Props) {
  const near = p.hits.length ? [] : nearest(p.q, { demo: p.demo, dev: p.dev, phone: p.phone, admin: p.admin });
  return (
    <div id="settings-search-results" className="ps-results" role="region" aria-label="Search results" aria-live="polite">
      {p.hits.length === 0 ? (
        <div className="ps-none">
          <p className="muted">{NOTHING(p.q.trim())}</p>
          {near.length > 0 && (
            <>
              <p className="ps-none-h">Did you mean</p>
              {near.map((h) => (
                <Hit key={h.id} h={h} {...p} />
              ))}
            </>
          )}
          {p.onGuide && (
            <button type="button" className="ps-item ps-hit ps-guide" onClick={p.onGuide} onKeyDown={arrows}>
              <span>Look in the Guide</span>
              <span className="ps-hint">How FocusTime works, the keys and the questions people ask</span>
            </button>
          )}
        </div>
      ) : (
        p.hits.map((h) => <Hit key={h.id} h={h} {...p} />)
      )}
    </div>
  );
}

function Where({ h }: { h: SearchResult }) {
  return (
    <span className="ps-hint">
      {h.where}
      {h.matched ? ` · was “${h.matched}”` : ""}
    </span>
  );
}

function Hit({ h, clients, asking, setAsking, onOpen }: Props & { h: SearchResult }) {
  // Followed clients first.
  const own = [...clients].sort((a, b) => +(a.follow?.active === false) - +(b.follow?.active === false));
  const label = (
    <span className="ps-hit-label">
      {h.label}
      {h.kind === "admin" && <span className="ps-admin-mark">Admin</span>}
    </span>
  );
  if (h.kind === "client") {
    const open = asking === h.id;
    if (own.length === 1)
      return (
        <a className="ps-item ps-hit" href={`#/settings/client/${encodeURIComponent(own[0]!.key)}`} onKeyDown={arrows} onClick={(e) => (e.preventDefault(), onOpen({ kind: "client", client: own[0]!.key, setting: h.setting! }))}>
          {label}
          <span className="ps-hint">{nameOf(own[0]!)}'s page</span>
        </a>
      );
    return (
      <div className="ps-hit-group">
        <button type="button" className="ps-item ps-hit" aria-expanded={open} onKeyDown={arrows} onClick={() => setAsking(open ? null : h.id)}>
          {label}
          <span className="ps-hint">{own.length ? (open ? "Which client?" : "A client's page · which client?") : "A client's page · no clients yet"}</span>
        </button>
        {open && own.length > 0 && (
          <div className="ps-which" role="group" aria-label={`${h.label}: which client?`}>
            {own.map((c) => (
              <a key={c.key} className="ps-item ps-which-item" href={`#/settings/client/${encodeURIComponent(c.key)}`} onKeyDown={arrows} onClick={(e) => (e.preventDefault(), onOpen({ kind: "client", client: c.key, setting: h.setting! }))}>
                <span>{nameOf(c)}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }
  const o = openOf(h);
  if (h.kind === "answer")
    return o ? (
      <a className="ps-item ps-hit ps-answer" href={resultHref(h) ?? undefined} onKeyDown={arrows} onClick={(e) => (e.preventDefault(), onOpen(o))}>
        {label}
        <span className="ps-hint ps-answer-text">{h.answer}</span>
      </a>
    ) : (
      <div className="ps-item ps-hit ps-answer" role="note">
        {label}
        <span className="ps-hint ps-answer-text">{h.answer}</span>
      </div>
    );
  return (
    <a className="ps-item ps-hit" href={resultHref(h) ?? undefined} onKeyDown={arrows} onClick={(e) => (e.preventDefault(), o && onOpen(o))}>
      {label}
      <Where h={h} />
    </a>
  );
}
