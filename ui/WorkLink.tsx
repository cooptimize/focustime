// FN-1: a work item's title opens FocusTime's story card (#/item/<client>/<id>), never DevOps. The href stays the
// DevOps address for hover, copy and a middle click's "copy link" habit, but a click (or middle click) opens the card.
// Links that aren't a work item's edit page keep the old behaviour: link.open checks they are on the client's DevOps
// organization and opens them in the person's browser (A1).
import type { MouseEvent, ReactNode } from "react";
import { call } from "./api.ts";
import { isDevOpsUrl } from "./work.ts";
import { ITEM_ATTRS } from "./keys.ts";
import { useScopedTab } from "./scope.ts";
import { itemIdOfUrl } from "../plan/item-card.ts";

export const NOTICE_EVENT = "focustime:notice";
const notify = (message: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: message }));

/** FN-1: opens the story card over whatever is on screen (App listens and puts it in the address). */
export const ITEM_CARD_EVENT = "focustime:item-card";
export type ItemCardTarget = { clientKey: string; itemId: number };
/** FN-1: an item changed from FocusTime (Wrap it up wrote it): an open card reads it again. */
export const CARD_STALE_EVENT = "focustime:card-stale";
export const cardStale = (clientKey: string, itemId: number) => window.dispatchEvent(new CustomEvent<ItemCardTarget>(CARD_STALE_EVENT, { detail: { clientKey, itemId } }));
export function openItemCard(clientKey: string, itemId: number): void {
  window.dispatchEvent(new CustomEvent<ItemCardTarget>(ITEM_CARD_EVENT, { detail: { clientKey, itemId } }));
}

/** What link.open and outlook.open answer: the host opened the link, or the page opens it (the hosted app). */
export type Opened = { opened: "browser" } | { opened: "page"; url: string };
/** Opens a link the server checked and handed back, in a new tab of the person's browser. */
export function openChecked(r: Opened): void {
  if (r.opened === "page") window.open(r.url, "_blank", "noopener,noreferrer");
}

export async function openWorkItem(clientKey: string, url: string): Promise<void> {
  try {
    openChecked(await call<Opened>("link.open", { clientKey, url }));
  } catch (e) {
    notify(e instanceof Error ? e.message : "Could not open the link");
  }
}

/**
 * FN-1: copies a work item's DevOps address and says "Link copied" (the notice is a live region, so a screen reader
 * hears it). Only a DevOps address is copied. Without the clipboard API (an insecure page) it says so.
 */
export async function copyWorkLink(url: string): Promise<boolean> {
  if (!isDevOpsUrl(url)) {
    notify("That isn't a DevOps link");
    return false;
  }
  try {
    await navigator.clipboard.writeText(url);
    notify("Link copied");
    return true;
  } catch {
    notify("Couldn't copy the link. Your browser didn't allow it");
    return false;
  }
}

/** A work item's title as a link that opens its story card; a link with no item id opens in the browser as before. */
export function WorkLink({ clientKey, url, className, title, children }: { clientKey: string; url: string | null | undefined; className?: string | undefined; title?: string | undefined; children: ReactNode }) {
  const tabIndex = useScopedTab();
  if (!url || !isDevOpsUrl(url)) return <span className={className}>{children}</span>;
  const id = itemIdOfUrl(url);
  const open = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // a card click selects the half-day; a link click only opens the item
    if (id !== null) openItemCard(clientKey, id);
    else void openWorkItem(clientKey, url);
  };
  return (
    <a href={url} className={className} title={title} tabIndex={tabIndex} {...ITEM_ATTRS(clientKey, url)} {...(id !== null ? { "data-card": `${clientKey}:${id}`, "aria-haspopup": "dialog" as const } : {})} onClick={open} onAuxClick={(e) => e.button === 1 && open(e)} onDoubleClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  );
}

/** FN-1: an item known by its id (an Inbox link, a promise's item): its title opens the card even without a URL. */
export function ItemTitleLink({ clientKey, id, url, className, children }: { clientKey: string | null | undefined; id: number; url?: string | null | undefined; className?: string; children: ReactNode }) {
  const tabIndex = useScopedTab();
  if (!clientKey) return <span className={className}>{children}</span>;
  const open = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openItemCard(clientKey, id);
  };
  return (
    <a href={url && isDevOpsUrl(url) ? url : `#/item/${encodeURIComponent(clientKey)}/${id}`} className={className} tabIndex={tabIndex} data-card={`${clientKey}:${id}`} aria-haspopup="dialog" onClick={open} onAuxClick={(e) => e.button === 1 && open(e)}>
      {children}
    </a>
  );
}
