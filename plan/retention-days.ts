// SA-3: how long a soft delete waits before everything is removed, in a module the browser can read too (Settings ›
// Your data › What FocusTime keeps about you reads it; store/user-data.ts uses it). The one place this number is typed.
export const HARD_DELETE_AFTER_DAYS = 30;
/** The team Rule conv.retention_days' starting value (config/org.ts reads it): chat messages nothing was found in. */
export const CHAT_RETENTION_DAYS = 14;
