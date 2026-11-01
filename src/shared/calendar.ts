// Civil calendar helpers use UTC solely as a timezone-independent date counter.
export function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function isoWeekday(date: string) { return new Date(`${date}T00:00:00Z`).getUTCDay() || 7; }
export function dateInZone(instant: string | number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, calendar: "iso8601", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(typeof instant === "number" ? instant : new Date(instant));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}
