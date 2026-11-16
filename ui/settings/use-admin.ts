// ADM-1: whether the signed-in person is a FocusTime admin. Its own file (PF-1) so the top bar and Backlog's toolbar
// don't bring the Admin screens (ui/settings/Admin.tsx, loaded with Settings) with them.
import { useEffect, useState } from "react";
import { call } from "../api.ts";

/** Whether the signed-in person is a FocusTime admin (null while asking). */
export function useAdmin(): boolean | null {
  const [admin, setAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    call<{ admin: boolean }>("admin.status", {}).then(
      (r) => live && setAdmin(r.admin),
      () => live && setAdmin(false),
    );
    return () => void (live = false);
  }, []);
  return admin;
}
