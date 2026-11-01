import type { BookingReceipt } from "./contract";
import { meetingTimeSummary } from "../../shared/meeting-time";

type CalendarMeeting = Pick<BookingReceipt, "id" | "title" | "description" | "location" | "startAt" | "endAt" | "timezone" | "organizerName">;
const text = (value: string) => Array.from(value, char => {
  const code = char.codePointAt(0)!;
  return (code < 32 && ![9, 10, 13].includes(code)) || code === 127 ? "" : char;
}).join("").replace(/\\/gu, "\\\\").replace(/\r\n|\r|\n/gu, "\\n").replace(/[,;]/gu, value => `\\${value}`);
const utc = (date: Date) => date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");

// RFC 5545 §3.1: fold by UTF-8 octets, never through a Unicode code point.
function fold(line: string) {
  const encoder = new TextEncoder(); let size = 0, result = "";
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > 75) { result += "\r\n "; size = 1; }
    result += char; size += bytes;
  }
  return result;
}
export function bookingCalendar(meeting: CalendarMeeting, generatedAt: Date) {
  const start = new Date(meeting.startAt), end = new Date(meeting.endAt);
  if (!/^[a-f0-9-]{36}$/u.test(meeting.id) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || !Number.isFinite(generatedAt.getTime())) throw new Error("Invalid calendar meeting");
  const summary = meetingTimeSummary(meeting, meeting.timezone);
  const description = [meeting.description, `Организатор: ${meeting.organizerName}`, `${summary.date}\n${summary.time} · ${meeting.timezone} · ${summary.offset}`, "Сохранённая копия встречи. Перенос и отмена в Slotly не обновляют этот файл автоматически."].filter(Boolean).join("\n\n");
  // UTC instants avoid floating/repeated-hour ambiguity. No attendees, action URLs or capability tokens.
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Slotly//Personal Booking//RU", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${meeting.id}@slotly`, `DTSTAMP:${utc(generatedAt)}`, `DTSTART:${utc(start)}`, `DTEND:${utc(end)}`, `SUMMARY:${text(meeting.title)}`, `DESCRIPTION:${text(description)}`, ...(meeting.location ? [`LOCATION:${text(meeting.location)}`] : []), "STATUS:CONFIRMED", "CLASS:PRIVATE", "END:VEVENT", "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}
