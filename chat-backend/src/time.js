// The owner's current date and time for the AI. The app sends its clock and IANA timezone with each message;
// the server's clock and UTC stand in when they are missing, invalid or more than a day off.
export function getTimeContext(clientTime, timeZone, now = new Date()) {
  const sent = typeof clientTime === "string" ? new Date(clientTime) : null;
  const at = sent && Number.isFinite(sent.getTime()) && Math.abs(sent.getTime() - now.getTime()) <= 86400000 ? sent : now;
  let zone = "UTC";
  if (typeof timeZone === "string" && timeZone.length <= 64) {
    try { new Intl.DateTimeFormat("en-US", {timeZone}); zone = timeZone; } catch {}
  }
  const local = new Intl.DateTimeFormat("en-US", {timeZone: zone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"}).format(at);
  return "Current date and time for the owner: " + local + " (" + zone + "; " + at.toISOString().slice(0, 16) + " UTC). Use this for anything involving today's date, the time or time zones; never guess the date.";
}
