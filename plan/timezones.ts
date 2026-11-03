// Outlook's working hours name their zone the Windows way ("Central Standard Time"). Temporal needs IANA names.
// Pure data from the CLDR windowsZones table (the "001" territory, the zone Windows means by default), for the zones
// people at Cooptimize and its clients are likely to use, plus a fixed offset for Outlook's "Customized Time Zone".
const WINDOWS: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles",
  "Pacific Standard Time (Mexico)": "America/Tijuana",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time": "America/Denver",
  "Mountain Standard Time (Mexico)": "America/Mazatlan",
  "Central America Standard Time": "America/Guatemala",
  "Central Standard Time": "America/Chicago",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Canada Central Standard Time": "America/Regina",
  "SA Pacific Standard Time": "America/Bogota",
  "Eastern Standard Time": "America/New_York",
  "Eastern Standard Time (Mexico)": "America/Cancun",
  "US Eastern Standard Time": "America/Indiana/Indianapolis",
  "Venezuela Standard Time": "America/Caracas",
  "Atlantic Standard Time": "America/Halifax",
  "SA Western Standard Time": "America/La_Paz",
  "Pacific SA Standard Time": "America/Santiago",
  "Newfoundland Standard Time": "America/St_Johns",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "SA Eastern Standard Time": "America/Cayenne",
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "GTB Standard Time": "Europe/Bucharest",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "Israel Standard Time": "Asia/Jerusalem",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Egypt Standard Time": "Africa/Cairo",
  "Turkey Standard Time": "Europe/Istanbul",
  "Russian Standard Time": "Europe/Moscow",
  "Arab Standard Time": "Asia/Riyadh",
  "Arabian Standard Time": "Asia/Dubai",
  "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Kolkata",
  "Nepal Standard Time": "Asia/Kathmandu",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok",
  "Singapore Standard Time": "Asia/Singapore",
  "China Standard Time": "Asia/Shanghai",
  "Taipei Standard Time": "Asia/Taipei",
  "W. Australia Standard Time": "Australia/Perth",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
};

/** Outlook's timeZoneBase: a standard name, or a custom zone with a bias in minutes (UTC = local + bias). */
export type GraphZone = { name?: unknown; bias?: unknown; "@odata.type"?: unknown };

/** An IANA zone (or a fixed "+05:00"-style offset) for a Graph zone, or null when it isn't recognized. */
export function zoneOf(z: GraphZone | null | undefined): string | null {
  if (!z || typeof z !== "object") return null;
  const name = typeof z.name === "string" ? z.name.trim() : "";
  if (name && WINDOWS[name]) return WINDOWS[name]!;
  if (name && name !== "Customized Time Zone") {
    try {
      // Already an IANA Region/City name.
      return Temporal.Now.zonedDateTimeISO(name).timeZoneId;
    } catch {
      /* not a zone Temporal knows */
    }
  }
  if (typeof z.bias === "number" && Number.isFinite(z.bias) && Math.abs(z.bias) <= 14 * 60) {
    // Custom zones: the standard bias only (daylight rules aren't followed; noted in D222).
    const off = -z.bias;
    const sign = off < 0 ? "-" : "+";
    const a = Math.abs(off);
    return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
  }
  return null;
}
