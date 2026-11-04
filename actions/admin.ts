// D522: the one check for admin-only work: registering, relabelling and removing client chats (shared polling). For
// now an admin is someone whose Entra object id is in the app config's `admins` (FOCUSTIME_ADMINS). The next step
// moves registration into an admin console and makes this the "FocusTime Admins" Entra group; registration is already
// stored per client (client_chats), so nothing else changes. Never decided by the client or a person's settings.

/** Whether this signed-in person is a FocusTime admin. */
export function isAdmin(userId: string | null, admins: readonly string[] | undefined): boolean {
  if (!userId || !admins?.length) return false;
  const id = userId.toLowerCase();
  return admins.some((a) => a.toLowerCase() === id);
}
