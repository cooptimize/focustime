// SW-1: opening Send to… from anywhere (a row's ⋯, Break down's results) without passing it down: one window event
// that App's SendHost (ui/Team.tsx) listens for. Pure; no React.
export const SEND_EVENT = "focustime:send-to";

/** What Send to… sends: one feature or story of a client. */
export type SendTarget = { clientKey: string; clientName?: string | null; itemId: number; level: "feature" | "story"; title: string; itemType: string | null; url: string | null; parentId?: number | null };

export function openSend(t: SendTarget): void {
  window.dispatchEvent(new CustomEvent(SEND_EVENT, { detail: t }));
}

/** A DevOps item's level for a send: features and stories only (an epic is sent through its features). */
export function sendLevel(i: { level: "story" | "portfolio" | "other" | "feature"; tier?: "feature" | "epic" | undefined }): "feature" | "story" | null {
  if (i.level === "feature") return "feature";
  if (i.level === "portfolio") return i.tier === "epic" ? null : "feature";
  return "story";
}
