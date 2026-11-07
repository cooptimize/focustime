// ST-1: which FocusTime this page runs in, from /version.
import { useEffect, useState } from "react";

/** The app's environment from /version ("local" is the developer loop; "dev" and "prod" are hosted), null while asking. */
let envCache: Promise<string> | null = null;
export function useAppEnv(): string | null {
  const [env, setEnv] = useState<string | null>(null);
  useEffect(() => {
    envCache ??= fetch("/version", { credentials: "same-origin" })
      .then((r) => r.json() as Promise<{ env?: string }>)
      .then((b) => b.env ?? "prod", () => "prod");
    let live = true;
    void envCache.then((e) => live && setEnv(e));
    return () => void (live = false);
  }, []);
  return env;
}
/** ST-1: developer-loop-only things (the demo switch, the style guide, config wording) show only there. */
export const useDeveloperLoop = () => useAppEnv() === "local";

