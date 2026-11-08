// CW-1: co-working calls in the client's delivery chats. One load for the window (chats.calls, now and every minute
// while it's open, quietly), shared by Week's cards, Today's Now card, the block's ⋯ and the command menu. Join and
// Start a call only open the chat in Teams; FocusTime never starts, joins, records or posts anything.
import { createContext, useContext, useEffect, useState } from "react";
import { call } from "./api.ts";
import { liveLine, type CoworkChatView, type CoworkData } from "../plan/cowork.ts";

/** How often the window asks again: the server only reads its own rows (the shared poll reads Teams every 5 minutes). */
const RELOAD_MS = 60_000;

export const CoworkCtx = createContext<CoworkData | null>(null);
export const useCoworkData = () => useContext(CoworkCtx);

/** chats.calls, now and every minute; null when client chats aren't available here (signed out, no store). */
export function useCowork(on: boolean): CoworkData | null {
  const [data, setData] = useState<CoworkData | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const load = () => call<CoworkData>("chats.calls", {}, { background: true }).then((d) => live && setData(d), () => undefined);
    void load();
    const t = window.setInterval(load, RELOAD_MS);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [on]);
  return data;
}

/** A client's registered chats I can see, and those with a call live now. */
export const chatsOf = (d: CoworkData | null, clientKey: string | null): CoworkChatView[] => (d && clientKey ? d.chats.filter((c) => c.clientKey === clientKey) : []);
export const liveOf = (d: CoworkData | null, clientKey: string | null): CoworkChatView[] => chatsOf(d, clientKey).filter((c) => !!c.live);

/** Opens the chat in Teams in a new tab (the Teams app takes it over where it's installed). */
export function openChat(link: string) {
  window.open(link, "_blank", "noopener,noreferrer");
}

/** "Call live in <chat> · started 9:12 · Join", with who started it under it. On Week's card and Today's Now card. */
export function LiveCalls({ chats, zone, tabIndex, className = "" }: { chats: readonly CoworkChatView[]; zone: string; tabIndex?: number; className?: string }) {
  if (!chats.length) return null;
  return (
    <div className={`live-calls ${className}`.trim()}>
      {chats.map((c) => {
        const { line, by } = liveLine(c.name, c.live!, zone);
        return (
          <div key={c.chatId} className="live-call" role="status">
            <span className="lc-dot" aria-hidden="true" />
            <span className="lc-text">
              <span className="lc-line">{line}</span>
              {by && <span className="lc-by">{by}</span>}
            </span>
            <a
              className="lc-join"
              href={c.link}
              target="_blank"
              rel="noreferrer"
              tabIndex={tabIndex}
              onClick={(e) => e.stopPropagation()}
              title={`Open ${c.name} in Teams to join the call`}
              aria-label={`Join the call in ${c.name}`}
            >
              Join
            </a>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The block's detail panel: each of its client's chats, live ones as "Call live … · Join" (today only), the others as
 * "Start a call in <chat>", opening the chat in Teams ready to start one.
 */
export function BlockCalls({ chats, zone, today }: { chats: readonly CoworkChatView[]; zone: string; today: boolean }) {
  if (!chats.length) return null;
  const live = today ? chats.filter((c) => c.live) : [];
  const idle = chats.filter((c) => !live.includes(c));
  return (
    <section className="dp-section dp-calls" aria-label="Teams calls">
      <LiveCalls chats={live} zone={zone} />
      {idle.length > 0 && (
        <ul className="lc-starts">
          {idle.map((c) => (
            <li key={c.chatId}>
              <a className="lc-start" href={c.link} target="_blank" rel="noreferrer" title={`Opens ${c.name} in Teams, ready to start a call. FocusTime doesn't start it or post anything`}>
                Start a call in {c.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
