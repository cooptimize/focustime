// Teammates' presence (step 16.3): one batched read for the Cooptimizers on screen, refreshed every 2 minutes while
// the window is visible, held only in this component's memory. Nothing shows when presence can't be read.
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { call } from "./api.ts";
import { PRESENCE_CLASS, PRESENCE_REFRESH_MS, type PresenceWord } from "../plan/presence.ts";
import type { PhotosData, PresencePeopleData, TeamsStatusView } from "../actions/types.ts";
import { STATUS_WORD } from "../plan/presence.ts";

export type PresenceMap = { byEmail: Map<string, PresenceWord>; byName: Map<string, PresenceWord>; me: PresenceWord | null };
const EMPTY: PresenceMap = { byEmail: new Map(), byName: new Map(), me: null };

/** Presence for the people given (emails and/or exact display names). Re-reads when the list changes. */
export function usePresence(people: { emails?: readonly string[]; names?: readonly string[]; /** Step 16.4: my own presence too (the top bar). */ me?: boolean }): PresenceMap & { wordFor: (p: { email?: string | null; name?: string | null }) => PresenceWord | null } {
  const emailsKey = [...new Set((people.emails ?? []).map((e) => e.toLowerCase()))].sort().join("\n");
  const namesKey = [...new Set((people.names ?? []).map((n) => n.trim()).filter((n) => n && n !== "You"))].sort().join("\n");
  const [map, setMap] = useState<PresenceMap>(EMPTY);
  const me = !!people.me;
  useEffect(() => {
    const emails = emailsKey ? emailsKey.split("\n") : [];
    const names = namesKey ? namesKey.split("\n") : [];
    if (!emails.length && !names.length && !me) return setMap(EMPTY);
    let live = true;
    let timer: number | null = null;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        // HK-3: a background read (on a timer and on showing the page), never someone using FocusTime.
        const r = await call<PresencePeopleData>("presence.people", { ...(emails.length ? { emails: emails.slice(0, 100) } : {}), ...(names.length ? { names: names.slice(0, Math.max(0, 100 - emails.length)) } : {}), ...(me ? { me } : {}) }, { background: true });
        if (!live) return;
        setMap(r.available ? { byEmail: new Map(r.people.map((p) => [p.email, p.word])), byName: new Map(r.people.map((p) => [p.name.toLowerCase(), p.word])), me: r.me ?? null } : EMPTY);
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
  }, [emailsKey, namesKey, me]);
  // Step 16.4: email first; the display name only when there is no email.
  return useMemo(() => ({ ...map, wordFor: (p: { email?: string | null; name?: string | null }) => (p.email ? map.byEmail.get(p.email.toLowerCase()) : p.name ? map.byName.get(p.name.toLowerCase()) : undefined) ?? null }), [map]);
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
    const read = () => void call<TeamsStatusView>("presence.status", {}, { background: true }).then((r) => live && setV(r), () => live && setV(null));
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
  // ENV-1: a test site never changes Teams status; say so instead of a status.
  if (v?.testSite) return <p className="teams-line" role="status">Teams status isn't changed from the test site.</p>;
  if (!v?.enabled) return null;
  let text: React.ReactNode;
  if (v.manual) text = <>Teams: left as you set it</>;
  else if (v.set && v.until) text = <>Teams: <strong>{STATUS_WORD[v.set]}</strong> until {hm(v.until)}</>;
  else if (v.error) text = <>Teams status not set. {v.error}</>;
  else return null;
  return <p className="teams-line" role="status">{text}</p>;
}

// ---- Profile photos (step 16.4) ----

/** Photos already read this session, by email ("me" for mine): one read per person, not per view. Memory only. */
const photoMemo = new Map<string, { url: string | null; at: number }>();
const PHOTO_MEMO_MS = 10 * 60_000;

/** Photos (data URLs) for the people given by email, and mine when asked; null means initials. */
export function usePhotos(people: { emails?: readonly string[]; me?: boolean }): { me: string | null; photoFor: (email?: string | null) => string | null } {
  const emailsKey = [...new Set((people.emails ?? []).map((e) => e.toLowerCase()).filter((e) => e.includes("@")))].sort().join("\n");
  const me = !!people.me;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const fresh = (k: string) => (photoMemo.get(k)?.at ?? 0) > now - PHOTO_MEMO_MS;
    const emails = (emailsKey ? emailsKey.split("\n") : []).filter((e) => !fresh(e)).slice(0, 60);
    const wantMe = me && !fresh("me");
    if (!emails.length && !wantMe) return;
    let live = true;
    void call<PhotosData>("people.photos", { ...(emails.length ? { emails } : {}), ...(wantMe ? { me: true } : {}) }).then(
      (r) => {
        const at = Date.now();
        // Nothing readable (no permission, signed out): initials, asked again later.
        if (r.available) {
          for (const e of emails) photoMemo.set(e, { url: r.people.find((p) => p.email === e)?.photo ?? null, at });
          if (wantMe) photoMemo.set("me", { url: r.me, at });
        }
        if (live) setTick((t) => t + 1);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [emailsKey, me]);
  return useMemo(() => ({ me: photoMemo.get("me")?.url ?? null, photoFor: (email?: string | null) => (email ? (photoMemo.get(email.toLowerCase())?.url ?? null) : null) }), [tick, emailsKey, me]);
}

/** Forget photos read this session (sign-out). */
export const forgetPhotos = () => photoMemo.clear();

export function initialsOf(name: string): string {
  const parts = name.replace(/\(.*?\)/g, " ").split(/[\s,]+/).filter((p) => /^\p{L}/u.test(p));
  const two = parts.length > 1 ? [parts[0]!, parts.at(-1)!] : parts.slice(0, 1);
  return two.map((p) => p[0]!.toUpperCase()).join("") || "?";
}

/**
 * A person: their photo (or initials when there is none or it can't be read) with their presence mark on the corner.
 * The name is the label; the photo itself is decoration.
 */
export function Avatar({ name, photo, word, size = 24, initials }: { name: string; photo: string | null; word?: PresenceWord | null; size?: number; initials?: string }) {
  return (
    <span className={`avatar${photo ? " has-photo" : ""}`} style={{ "--av": `${size}px` } as React.CSSProperties} aria-hidden={word ? undefined : true}>
      {photo ? <img src={photo} alt="" width={size} height={size} draggable={false} /> : <span className="avatar-initials">{initials ?? initialsOf(name)}</span>}
      {word && <PresenceDot word={word} />}
    </span>
  );
}
