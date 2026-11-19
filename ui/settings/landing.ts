// SA-5: the setting to land on when a client's page opens from a search result. A client's page's address names the
// client (#/settings/client/<key>), so the setting rides here, once, from the command menu's Settings results to the
// page. In memory only, for this page's life.
let next: string | null = null;
export const landOn = (setting: string | null) => void (next = setting);
/** The setting to land on, taken once. */
export function takeLanding(): string | null {
  const s = next;
  next = null;
  return s;
}
