import { Temporal } from "@js-temporal/polyfill";
import { isoWeekday } from "../../shared/calendar";
import type { AvailabilityResponse, SlotPolicy, SlotQuery } from "./contract";
import type { ScheduleData } from "./validation";

const MINUTE = 60_000;
export type BusyInterval = { start: number; end: number };
export type BookingRange = { minStart: number; maxStart: number; firstDate: string; lastDate: string };

export function bookingRange(now: Date, policy: SlotPolicy, organizerTimezone: string, viewerTimezone: string): BookingRange | null {
  const instant = Temporal.Instant.fromEpochMilliseconds(now.getTime());
  const today = instant.toZonedDateTimeISO(organizerTimezone).toPlainDate();
  // Calendar days in the organizer's zone, including today; upper bound exclusive.
  const maxStart = today.add({ days: policy.horizonDays }).toZonedDateTime(organizerTimezone).epochMilliseconds;
  const minStart = now.getTime() + policy.minNoticeMinutes * MINUTE;
  if (minStart >= maxStart) return null;
  const date = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(viewerTimezone).toPlainDate().toString();
  return { minStart, maxStart, firstDate: date(minStart), lastDate: date(maxStart - 1) };
}

export function queryWindow(query: SlotQuery, policy: SlotPolicy, range: BookingRange | null) {
  if (!range || query.date < range.firstDate || query.date > range.lastDate) return null;
  const date = Temporal.PlainDate.from(query.date);
  // No assumption that a local day is 24 hours or begins at an existing midnight.
  const first = date.toZonedDateTime(query.timezone);
  const next = date.add({ days: 1 }).toZonedDateTime(query.timezone);
  const dayStart = first.epochMilliseconds;
  const dayEnd = next.epochMilliseconds;
  const start = Math.max(dayStart, range.minStart);
  const end = Math.min(dayEnd, range.maxStart);
  if (start >= end) return null;
  return { start, end, hasOffsetChange: first.offsetNanoseconds !== next.subtract({ milliseconds: 1 }).offsetNanoseconds,
    busyStart: Math.floor((start - policy.bufferBeforeMinutes * MINUTE) / MINUTE) * MINUTE,
    busyEnd: Math.ceil((end + (policy.durationMinutes + policy.bufferAfterMinutes) * MINUTE) / MINUTE) * MINUTE };
}

export function calculateAvailability(input: { query: SlotQuery; policy: SlotPolicy; schedule: ScheduleData; busy: BusyInterval[]; now: Date }): AvailabilityResponse {
  const { query, policy, schedule, now } = input;
  const range = bookingRange(now, policy, schedule.timezone, query.timezone);
  const response: AvailabilityResponse = { ...query, generatedAt: now.toISOString(), hasOffsetChange: false, range: range ? { firstDate: range.firstDate, lastDate: range.lastDate } : null, slots: [] };
  const bounds = queryWindow(query, policy, range);
  if (!bounds) return response;
  response.hasOffsetChange = bounds.hasOffsetChange;
  const clock = new Intl.DateTimeFormat("en", { timeZone: schedule.timezone, calendar: "iso8601", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const localWindows = new Map<string, { startMinute: number; endMinute: number }[]>();
  const work: BusyInterval[] = [];
  const candidates: number[] = [];

  // Walk actual UTC minutes, not imaginary local minutes. Gaps have no instants;
  // folds naturally visit both occurrences and can split a working window.
  for (let at = bounds.busyStart; at < bounds.busyEnd; at += MINUTE) {
    const parts = clock.formatToParts(at);
    const part = (name: string) => parts.find((p) => p.type === name)!.value;
    const date = `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
    let windows = localWindows.get(date);
    if (!windows) {
      const override = schedule.overrides.find((o) => o.localDate === date);
      windows = override ? override.mode === "closed" ? [] : override.windows : schedule.weekly.filter((w) => w.weekday === isoWeekday(date));
      localWindows.set(date, windows);
    }
    const minute = Number(part("hour")) * 60 + Number(part("minute"));
    const window = windows.find((w) => w.startMinute <= minute && minute < w.endMinute);
    if (!window) continue;
    const previous = work.at(-1);
    if (previous?.end === at) previous.end += MINUTE;
    else work.push({ start: at, end: at + MINUTE });
    if (at >= bounds.start && at < bounds.end && (minute - window.startMinute) % policy.stepMinutes === 0) candidates.push(at);
  }
  const busy = [...input.busy].sort((a, b) => a.start - b.start);
  let workIndex = 0; let busyIndex = 0;
  for (const at of candidates) {
    const end = at + policy.durationMinutes * MINUTE;
    const busyStart = at - policy.bufferBeforeMinutes * MINUTE;
    const busyEnd = end + policy.bufferAfterMinutes * MINUTE;
    while (work[workIndex] && work[workIndex]!.end <= busyStart) workIndex++;
    const interval = work[workIndex];
    if (!interval || interval.start > busyStart || interval.end < busyEnd) continue;
    while (busy[busyIndex] && busy[busyIndex]!.end <= busyStart) busyIndex++;
    const conflict = busy[busyIndex];
    if (conflict && conflict.start < busyEnd) continue;
    response.slots.push({ startAt: new Date(at).toISOString(), endAt: new Date(end).toISOString() });
  }
  return response;
}
