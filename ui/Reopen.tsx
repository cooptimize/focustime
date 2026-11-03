// A2: when a call finds the session ended (signed out elsewhere, or 12 idle hours, or 7 days), say so in plain words
// with one button that signs in again. The developer loop's "bring the window up" (focustime-open) isn't sign-in and
// isn't shown here.
import { useEffect, useState } from "react";
import { setDbStateListener, setSignInShownListener, setStaleListener, signInWithMicrosoft, type DbState } from "./api.ts";

export function SignInAgainButton() {
  const [busy, setBusy] = useState(false);
  return (
    <span className="reopen-actions">
      <button
        type="button"
        className="commit"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          signInWithMicrosoft();
        }}
      >
        {busy ? "Opening sign-in…" : "Sign in again"}
      </button>
    </span>
  );
}

/** A banner over everything once any call finds the session ended. */
export function StaleBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    setStaleListener(() => setStale(true));
    // The sign-in screen already says it: no banner over it.
    setSignInShownListener(() => setStale(false));
    return () => {
      setStaleListener(null);
      setSignInShownListener(null);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="stale-banner" role="alert">
      <span>You're signed out of FocusTime.</span>
      <SignInAgainButton />
    </div>
  );
}

/** A3: while a call waits on a database that is waking up (Azure SQL pauses when nobody has used it for a while). */
export function DbBanner() {
  const [state, setState] = useState<DbState>("ok");
  useEffect(() => {
    setDbStateListener(setState);
    return () => setDbStateListener(null);
  }, []);
  if (state === "ok") return null;
  return (
    <div className="stale-banner db-banner" role="status" aria-live="polite">
      <span>{state === "waking" ? "Waking up the database. This can take up to a minute." : "The database isn't answering. FocusTime will keep trying; try again in a minute."}</span>
    </div>
  );
}
