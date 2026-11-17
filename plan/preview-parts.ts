// OP-1: a screen's DevOps changes in parts for the one preview, pure. Each part is one client's changes, at most 10, in
// the screen's own order (a client's parts follow one another; clients in the order they first appear). The words a
// screen says before the first preview when there is more than one part live here too, so every screen says it the
// same way (docs/design/wording.md).

/** The most changes one preview shows and confirms at once (the write framework's own limit). */
export const PART_MAX = 10;

export type Part<T> = { clientKey: string; items: T[] };

/** One client's changes per part, at most `max` each, keeping the order they came in. */
export function partsOf<T>(items: readonly T[], clientOf: (x: T) => string, max = PART_MAX): Part<T>[] {
  const byClient = new Map<string, T[]>();
  for (const x of items) (byClient.get(clientOf(x)) ?? byClient.set(clientOf(x), []).get(clientOf(x))!).push(x);
  const out: Part<T>[] = [];
  for (const [clientKey, list] of byClient) for (let i = 0; i < list.length; i += max) out.push({ clientKey, items: list.slice(i, i + max) });
  return out;
}

/**
 * What a screen says before the first preview when its changes take more than one: "21 lines go in 3 previews, one
 * client at a time and 10 at most in each." Null for one preview (nothing to say). `noun` is the screen's own word
 * ("line", "update", "item").
 */
export function partsLine(count: number, parts: number, clients: number, noun: string): string | null {
  if (parts <= 1) return null;
  const what = `${count} ${count === 1 ? noun : `${noun}s`}`;
  const how = clients > 1 ? `one client at a time${parts > clients ? ` and ${PART_MAX} at most in each` : ""}` : `${PART_MAX} at most in each`;
  return `${what} go in ${parts} previews, ${how}.`;
}
