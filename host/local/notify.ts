// The local host's notifications (A1): notify-send and the freedesktop notification service. The hosted app shows
// notices in the page instead (host/azure).
import { spawn } from "node:child_process";
import { OPEN_KEY, type Notice } from "../../plan/notify.ts";

/** The icon name every notification carries (step 17.5): the hicolor icons installed by system/install-icons.sh. */
export const NOTIFY_ICON = "focustime";

/** notify-send with a fixed argument list (no shell). Fire and forget: for a line that needs no buttons or click. */
export function notifySend(title: string, body: string) {
  const p = spawn("notify-send", ["--app-name=FocusTime", "--urgency=normal", `--icon=${NOTIFY_ICON}`, title, body], { stdio: "ignore" });
  p.on("error", () => {});
  p.unref();
}

/**
 * Step 15.5, the desktop host's notifications (a hosted version would use browser notifications behind the same
 * NotifyHost): notify-send with a fixed argument list (no shell), the click on the notification itself as the
 * freedesktop "default" action, and its buttons. notify-send waits while a notification with actions is open and
 * prints the chosen key; resolves null when it is dismissed or expires. Only known keys are passed on (the notifier
 * checks again).
 */
export function desktopNotify(n: Notice, shown?: (handle: string) => void): Promise<string | null> {
  return new Promise((resolve) => {
    // --print-id (Q91): the first line is the notification's id, so it can be closed when its occasion is handled.
    const args = ["--app-name=FocusTime", "--urgency=normal", "--print-id", `--icon=${NOTIFY_ICON}`, `--action=${OPEN_KEY}=Open`, ...n.buttons.map((b) => `--action=${b.key}=${b.label}`), n.title, n.body];
    const p = spawn("notify-send", args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    let told = false;
    p.stdout.on("data", (c: Buffer) => {
      out += c.toString();
      const first = out.split("\n")[0]!;
      if (!told && out.includes("\n") && /^\d{1,10}$/.test(first)) {
        told = true;
        shown?.(first);
      }
    });
    p.on("error", () => resolve(null));
    p.on("close", () => {
      const lines = out.trim().split("\n");
      const key = (/^\d{1,10}$/.test(lines[0] ?? "") ? lines.slice(1) : lines).join("").trim();
      resolve(key === OPEN_KEY || n.buttons.some((b) => b.key === key) ? key : null);
    });
  });
}

/**
 * Q91: withdraws a notification FocusTime showed (freedesktop CloseNotification, fixed arguments, no shell). A
 * service that ignores it leaves the notification; clicking it then opens a view that shows the thing is done.
 */
export function closeDesktopNotification(handle: string) {
  if (!/^\d{1,10}$/.test(handle)) return;
  const p = spawn("gdbus", ["call", "--session", "--dest", "org.freedesktop.Notifications", "--object-path", "/org/freedesktop/Notifications", "--method", "org.freedesktop.Notifications.CloseNotification", handle], { stdio: "ignore" });
  p.on("error", () => {});
  p.unref();
}
