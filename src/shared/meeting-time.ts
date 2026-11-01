import { dateInZone } from "./calendar";

export function meetingTimeSummary(slot: { startAt: string; endAt: string }, timezone: string) {
  const start = new Date(slot.startAt), end = new Date(slot.endAt);
  const date = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const clock = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const zone = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, timeZoneName: "shortOffset" });
  const offset = (value: Date) => zone.formatToParts(value).find(p => p.type === "timeZoneName")?.value ?? "";
  const firstOffset = offset(start), lastOffset = offset(end);
  const crossDay = dateInZone(slot.startAt, timezone) !== dateInZone(slot.endAt, timezone);
  const endDate = crossDay ? new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, day: "numeric", month: "short", year: "numeric" }).format(end) : "";
  return { date: date.format(start), time: `${clock.format(start)} — ${endDate ? `${endDate}, ` : ""}${clock.format(end)}`,
    offset: firstOffset === lastOffset ? firstOffset : `${firstOffset} → ${lastOffset}`,
    durationMinutes: (end.getTime() - start.getTime()) / 60_000 };
}
