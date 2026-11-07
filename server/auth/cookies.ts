// FocusTime's cookies (A2). All are __Host- prefixed (Secure, Path=/, no Domain), so only FocusTime's own origin sets
// or reads them; browsers treat http://localhost as secure, so the developer loop uses the same cookies.
//   __Host-focustime       the session id (HttpOnly, SameSite=Lax so Microsoft's redirect back keeps it)
//   __Host-focustime-csrf  the session's CSRF token, read by the page and sent as X-CSRF (SameSite=Strict)
//   __Host-focustime-auth  a sign-in on its way through Microsoft or Google: its state (HttpOnly, Lax, 10 minutes)

export const SESSION_COOKIE = "__Host-focustime";
export const CSRF_COOKIE = "__Host-focustime-csrf";
export const AUTH_COOKIE = "__Host-focustime-auth";
export const CSRF_HEADER = "x-csrf";

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

const attrs = (o: { httpOnly: boolean; sameSite: "Lax" | "Strict"; maxAgeS?: number }) =>
  `; Path=/; Secure${o.httpOnly ? "; HttpOnly" : ""}; SameSite=${o.sameSite}${o.maxAgeS !== undefined ? `; Max-Age=${o.maxAgeS}` : ""}`;

/** The two cookies of a new session (the session cookie lasts as long as the session may). */
export const sessionCookies = (cookie: string, csrf: string, maxAgeS: number): string[] => [
  `${SESSION_COOKIE}=${cookie}${attrs({ httpOnly: true, sameSite: "Lax", maxAgeS })}`,
  `${CSRF_COOKIE}=${csrf}${attrs({ httpOnly: false, sameSite: "Strict", maxAgeS })}`,
];
export const clearSessionCookies = (): string[] => [
  `${SESSION_COOKIE}=${attrs({ httpOnly: true, sameSite: "Lax", maxAgeS: 0 })}`,
  `${CSRF_COOKIE}=${attrs({ httpOnly: false, sameSite: "Strict", maxAgeS: 0 })}`,
];
export const authCookie = (state: string) => `${AUTH_COOKIE}=${state}${attrs({ httpOnly: true, sameSite: "Lax", maxAgeS: 600 })}`;
/** LP-1: which incremental consent a sign-in visit was for (a name from CONSENTS, never a secret), so it comes back to the right place. */
export const CONSENT_COOKIE = "__Host-focustime-consent";
export const consentCookie = (name: string) => `${CONSENT_COOKIE}=${name}${attrs({ httpOnly: true, sameSite: "Lax", maxAgeS: 600 })}`;
export const clearConsentCookie = () => `${CONSENT_COOKIE}=${attrs({ httpOnly: true, sameSite: "Lax", maxAgeS: 0 })}`;
export const clearAuthCookie = () => `${AUTH_COOKIE}=${attrs({ httpOnly: true, sameSite: "Lax", maxAgeS: 0 })}`;
