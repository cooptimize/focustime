// DP-2: the time picker's rules, pure. Typed times ("7pm", "7:30 pm", "19:00", "1930", "noon") and the 15-minute steps
// the list offers. Values are "HH:MM", 24 hours, like a deployment's window.
const two = (n: number) => String(n).padStart(2, "0");
const make = (h: number, m: number): string | null => (h >= 0 && h <= 23 && m >= 0 && m <= 59 ? `${two(h)}:${two(m)}` : null);

/** A typed time as "HH:MM", or null when it can't be read. With no am or pm a bare hour is that hour of the 24. */
export function parseTypedTime(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/\./g, "");
  if (!t) return null;
  if (t === "noon") return "12:00";
  if (t === "midnight") return "00:00";
  const x = /^(\d{1,2})(?::?(\d{2}))? ?(am|pm|a|p)?$/.exec(t);
  if (!x) return null;
  const h = Number(x[1]);
  const m = x[2] ? Number(x[2]) : 0;
  if (!x[3]) return make(h, m);
  if (h < 1 || h > 12) return null;
  return make((h % 12) + (x[3].startsWith("p") ? 12 : 0), m);
}

/** Every 15 minutes of the day. */
export const quarterHours = (): string[] => Array.from({ length: 96 }, (_, i) => `${two(Math.floor(i / 4))}:${two((i % 4) * 15)}`);

/** "7:00 PM" for "19:00". */
export function time12(hm: string): string {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${two(m)} ${h < 12 ? "AM" : "PM"}`;
}

/** The step a list should show for a value: the value itself, or the next quarter hour for a typed "7:07". */
export function nearestStep(hm: string): string {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  const q = Math.min(95, Math.round((h * 60 + m) / 15));
  return `${two(Math.floor(q / 4))}:${two((q % 4) * 15)}`;
}
