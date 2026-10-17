export function getTimeContext() {
  const now = new Date();
  const utc = now.toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `Current UTC time: ${utc}. User timezone: ${tz}.`;
}