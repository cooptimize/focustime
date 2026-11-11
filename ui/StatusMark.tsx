// RF-1: the dot beside Status in the tabs and the phone's ⋯ menu. Never color alone: amber is a ring and red a filled
// disc, and both carry their reason as the tooltip and the screen reader's words.
import type { DotTone } from "../plan/status-dot.ts";

export function StatusMark({ tone, text }: { tone: DotTone; text: string }) {
  if (tone === "none") return null;
  return <span className={`status-mark ${tone}`} role="img" aria-label={text} title={text} />;
}
