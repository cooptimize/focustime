// Every work item link goes through link.open, which checks it is on the client's DevOps organization and opens it in
// the person's browser (A1). The href stays for hover and copy; a click never navigates the FocusTime window itself.
import type { MouseEvent, ReactNode } from "react";
import { call } from "./api.ts";
import { isDevOpsUrl } from "./work.ts";
import { ITEM_ATTRS } from "./keys.ts";
import { useScopedTab } from "./scope.ts";

export const NOTICE_EVENT = "focustime:notice";
const notify = (message: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: message }));

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

export function WorkLink({ clientKey, url, className, title, children }: { clientKey: string; url: string | null | undefined; className?: string | undefined; title?: string | undefined; children: ReactNode }) {
  const tabIndex = useScopedTab();
  if (!url || !isDevOpsUrl(url)) return <span className={className}>{children}</span>;
  const open = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // a card click selects the half-day; a link click only opens the item
    void openWorkItem(clientKey, url);
  };
  return (
    <a href={url} className={className} title={title} tabIndex={tabIndex} {...ITEM_ATTRS(clientKey, url)} onClick={open} onAuxClick={open} onDoubleClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  );
}
