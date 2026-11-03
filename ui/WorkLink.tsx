// Every work item link goes through link.open, so it opens in that client's Edge profile (step 5.5).
// The href stays for hover and copy; a click never navigates the FocusTime window itself.
import type { MouseEvent, ReactNode } from "react";
import { call } from "./api.ts";
import { isDevOpsUrl } from "./work.ts";
import { ITEM_ATTRS } from "./keys.ts";
import { useScopedTab } from "./scope.ts";

export const NOTICE_EVENT = "focustime:notice";
const notify = (message: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: message }));

export async function openWorkItem(clientKey: string, url: string): Promise<void> {
  try {
    const r = await call<{ opened: "edge" | "default"; notice: string | null }>("link.open", { clientKey, url });
    if (r.notice) notify(r.notice);
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
