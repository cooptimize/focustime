// Teammates' presence (step 16.3): one batched read for the Cooptimizers on screen, refreshed every 2 minutes while
// the window is visible, held only in this component's memory. Nothing shows when presence can't be read.
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { call } from "./api.ts";
import { PRESENCE_CLASS, PRESENCE_REFRESH_MS, type PresenceWord } from "../plan/presence.ts";
import type { PresencePeopleData, TeamsStatusView } from "../actions/types.ts";
import { STATUS_WORD } from "../plan/presence.ts";

export type PresenceMap = { byEmail: Map<string, PresenceWord>; byName: Map<string, PresenceWord> };
const EMPTY: PresenceMap = { byEmail: new Map(), byName: new Map() };

/** Presence for the people given (emails and/or exact display names). Re-reads when the list changes. */
export function usePresence(people: { emails?: readonly string[]; names?: readonly string[] }): PresenceMap & { wordFor: (p: { email?: string | null; name?: string | null }) => PresenceWord | null } {
  const emailsKey = [...new Set((people.emails ?? []).map((e) => e.toLowerCase()))].sort().join("\n");
  const namesKey = [...new Set((people.names ?? []).map((n) => n.trim()).filter((n) => n && n !== "You"))].sort().join("\n");
  const [map, setMap] = useState<PresenceMap>(EMPTY);
  useEffect(() => {
    const emails = emailsKey ? emailsKey.split("\n") : [];
    const names = namesKey ? namesKey.split("\n") : [];
    if (!emails.length && !names.length) return setMap(EMPTY);
    let live = true;
    let timer: number | null = null;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await call<PresencePeopleData>("presence.people", { ...(emails.length ? { emails: emails.slice(0, 100) } : {}), ...(names.length ? { names: names.slice(0, Math.max(0, 100 - emails.length)) } : {}) });
        if (!live) return;
        setMap(r.available ? { byEmail: new Map(r.people.map((p) => [p.email, p.word])), byName: new Map(r.people.map((p) => [p.name.toLowerCase(), p.word])) } : EMPTY);
      } catch {
        if (live) setMap(EMPTY);
      }
    };
    void read();
    timer = window.setInterval(() => void read(), PRESENCE_REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && void read();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [emailsKey, namesKey]);
  return useMemo(() => ({ ...map, wordFor: (p: { email?: string | null; name?: string | null }) => (p.email ? map.byEmail.get(p.email.toLowerCase()) : undefined) ?? (p.name ? map.byName.get(p.name.toLowerCase()) : undefined) ?? null }), [map]);
}

/** The small mark: its shape says the state, the word is on hover and focus and read by screen readers. */
export function PresenceDot({ word }: { word: PresenceWord | null }) {
  if (!word) return null;
  return <span className={`pres pres-${PRESENCE_CLASS[word]}`} role="img" aria-label={word} title={word} data-word={word} tabIndex={0} />;
}

const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * The focus screen's Teams line (step 16.3): "Teams: Busy until 10:45". Read again when the session changes (start,
 * +15, deep or plain, pause) and every 30 seconds while shown. Nothing when Teams status is off in Settings.
 */
export function TeamsFocusLine({ sessionKey }: { sessionKey: string }) {
  const [v, setV] = useState<TeamsStatusView | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void call<TeamsStatusView>("presence.status", {}).then((r) => live && setV(r), () => live && setV(null));
    read();
    // The server sets the status just after a timer change: read again shortly after.
    const soon = window.setTimeout(read, 2500);
    const every = window.setInterval(read, 30_000);
    return () => {
      live = false;
      window.clearTimeout(soon);
      window.clearInterval(every);
    };
  }, [sessionKey]);
  if (!v?.enabled) return null;
  let text: React.ReactNode;
  if (v.manual) text = <>Teams: left as you set it</>;
  else if (v.set && v.until) text = <>Teams: <strong>{STATUS_WORD[v.set]}</strong> until {hm(v.until)}</>;
  else if (v.error) text = <>Teams status not set. {v.error}</>;
  else return null;
  return <p className="teams-line" role="status">{text}</p>;
}
