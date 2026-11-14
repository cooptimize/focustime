// T-2: every delegated permission FocusTime asks Microsoft for, why, and whether a person can allow it themselves or an
// admin must. Settings > Connections lists them with their state for the signed-in person. Keep this list in step with
// infra/scripts/app-registration.sh (GRAPH_SCOPES and the Azure Service Management scope) and sources/oauth/oauth.ts.
/** The sign-in's token kinds (sources/oauth/oauth.ts TokenKind), repeated here so plan/ stays pure. */
export type TokenKind = "read" | "write" | "id" | "arm" | "presence" | "photo" | "chats" | "messages" | "meetings" | "send" | "mail" | "mail_send";

export type Permission = {
  scope: string;
  api: "Microsoft Graph" | "Azure Service Management";
  why: string;
  /** Needs an admin's consent for the tenant (a person can't allow it alone). */
  admin: boolean;
  /** The token FocusTime asks for it on; "sign-in" is the sign-in's own. */
  kind: TokenKind | "sign-in";
  /**
   * AP-1 (D490): asked for only when a person switches a feature on (an incremental consent), so it isn't on the app
   * registration and the sign-in doesn't ask for it. Until they allow it, it shows as missing, with where to allow it.
   */
  later?: string;
};

export const PERMISSIONS: readonly Permission[] = [
  { scope: "User.Read", api: "Microsoft Graph", why: "Who you are", admin: false, kind: "sign-in" },
  { scope: "Calendars.ReadWrite", api: "Microsoft Graph", why: "Your calendar; FocusTime changes only its own events", admin: false, kind: "read" },
  { scope: "MailboxSettings.Read", api: "Microsoft Graph", why: "Your working hours and time zone", admin: false, kind: "sign-in" },
  { scope: "Presence.ReadWrite", api: "Microsoft Graph", why: "Your Teams status while focus runs", admin: false, kind: "presence" },
  { scope: "Presence.Read.All", api: "Microsoft Graph", why: "Teammates' availability", admin: false, kind: "presence" },
  { scope: "ProfilePhoto.Read.All", api: "Microsoft Graph", why: "Profile photos", admin: true, kind: "photo" },
  { scope: "Chat.ReadBasic", api: "Microsoft Graph", why: "Delivery chats: chat names and members, never messages", admin: false, kind: "chats" },
  { scope: "Chat.Read", api: "Microsoft Graph", why: "From chats: new messages in the client chats registered in FocusTime, read for everyone on them who follows the client; read only, never posts", admin: false, kind: "messages", later: "Settings > Clients: Add a chat to allow it" },
  { scope: "ChatMessage.Send", api: "Microsoft Graph", why: "Close the loop by Teams: posts your update as you, only after you confirm the preview, into the chat you chose", admin: false, kind: "send", later: "Close the loop: allow it the first time you send by Teams" },
  { scope: "Chat.Create", api: "Microsoft Graph", why: "Close the loop by Teams: finds your 1:1 chat with the person (Teams makes it once if there isn't one)", admin: false, kind: "send", later: "Close the loop: allow it the first time you send by Teams" },
  { scope: "Mail.ReadWrite", api: "Microsoft Graph", why: "Close the loop by email: saves your update as a draft in Outlook and reads back that one message; never reads other mail", admin: false, kind: "mail", later: "Close the loop: allow it the first time you save an email draft" },
  { scope: "Mail.Send", api: "Microsoft Graph", why: "Close the loop by email: Send now sends your update from your mailbox, only after you confirm the preview", admin: false, kind: "mail_send", later: "Close the loop: allow it the first time you choose Send now" },
  { scope: "OnlineMeetings.Read", api: "Microsoft Graph", why: "Meeting capture: finds a client call registered in FocusTime from its join link; never any other meeting", admin: true, kind: "meetings" },
  { scope: "OnlineMeetingTranscript.Read.All", api: "Microsoft Graph", why: "Meeting capture: the transcript of a registered client call organized at Cooptimize, for its reviewers; read only, kept 30 days", admin: true, kind: "meetings" },
  { scope: "user_impersonation", api: "Azure Service Management", why: "Your VM, with your own Azure access", admin: false, kind: "arm" },
];

export type ProbeResult = { kind: TokenKind; state: "granted" | "consent" | "signed_out" | "unavailable"; granted: string[] };
export type PermissionState = "granted" | "needs_consent" | "needs_admin" | "missing" | "signed_out" | "unknown";
export type PermissionRow = Permission & { state: PermissionState };

/**
 * Each permission's state from the token probes: granted when a token of its API holds it; otherwise what its own token
 * request said (consent needed, by the person or an admin), signed out, or unknown when it couldn't be checked.
 */
export function permissionRows(probes: readonly ProbeResult[], signedIn: boolean): PermissionRow[] {
  const held = (api: Permission["api"]) => new Set(probes.filter((p) => (api === "Azure Service Management") === (p.kind === "arm")).flatMap((p) => p.granted.map((g) => g.toLowerCase())));
  return PERMISSIONS.map((p) => {
    if (!signedIn) return { ...p, state: "signed_out" };
    if (held(p.api).has(p.scope.toLowerCase())) return { ...p, state: "granted" };
    const own = probes.find((x) => x.kind === p.kind);
    if (p.later && own?.state !== "unavailable") return { ...p, state: "missing" };
    const state: PermissionState = own?.state === "consent" || own?.state === "granted" ? (p.admin ? "needs_admin" : "needs_consent") : own?.state === "signed_out" ? "signed_out" : "unknown";
    return { ...p, state };
  });
}
