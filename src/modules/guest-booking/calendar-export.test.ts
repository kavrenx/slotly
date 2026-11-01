import { expect, it } from "vitest";
import { bookingCalendar } from "./calendar-export";
const meeting = { id: "00000000-0000-4000-8000-000000000001", title: "Встреча, план; вопросы", description: "Обсудим проект\nВторая строка", location: "Онлайн", startAt: "2026-11-01T05:30:00Z", endAt: "2026-11-01T06:30:00Z", timezone: "America/New_York", organizerName: "Анна" };
const at = new Date("2026-10-31T10:00:00Z");
const unfold = (value: string) => value.replace(/\r\n[ \t]/gu, "");
it("uses unambiguous UTC instants and actual elapsed duration through the repeated DST hour", () => {
  const file = unfold(bookingCalendar(meeting, at));
  expect(file).toContain("DTSTART:20261101T053000Z\r\nDTEND:20261101T063000Z");
  expect(file).toContain("GMT-4 → GMT-5"); expect(file).toContain("UID:"+meeting.id+"@slotly");
  expect(file).not.toContain("TZID="); expect(file).not.toContain("DURATION:");
});
it("escapes property injection, preserves Unicode and folds every physical line to 75 UTF-8 bytes", () => {
  const file = bookingCalendar({ ...meeting, title: "Обсудим 👋 ".repeat(25), description: "\\,;\r\nEND:VEVENT\r\nBEGIN:VEVENT\nATTENDEE:evil@example.invalid" }, at);
  for (const line of file.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  const full = unfold(file);
  expect(full).toContain("SUMMARY:" + "Обсудим 👋 ".repeat(25)); expect(full).not.toContain("�");
  expect(full.match(/^BEGIN:VEVENT$/gmu)).toHaveLength(1); expect(full.match(/^END:VEVENT$/gmu)).toHaveLength(1);
  expect(full).toContain("\\\\\\,\\;\\nEND:VEVENT\\nBEGIN:VEVENT\\nATTENDEE:");
});
it("exports only meeting fields, never guest identifiers or management capabilities", () => {
  const file = unfold(bookingCalendar({ ...meeting, managementToken: "super-private", guestEmail: "private@example.invalid" } as typeof meeting, at));
  expect(file).not.toContain("super-private"); expect(file).not.toContain("private@example.invalid"); expect(file).not.toContain("URL:"); expect(file).not.toContain("ATTENDEE:");
  expect(file).toContain("SUMMARY:Встреча\\, план\\; вопросы"); expect(file).toContain("LOCATION:Онлайн");
});
it("retains UTC instants across the local year boundary and rejects invalid intervals", () => {
  const file = bookingCalendar({ ...meeting, startAt: "2026-12-31T20:45:00Z", endAt: "2026-12-31T21:15:00Z", timezone: "Europe/Minsk" }, at);
  expect(unfold(file)).toContain("1 янв. 2027");
  expect(() => bookingCalendar({ ...meeting, endAt: meeting.startAt }, at)).toThrow();
  expect(() => bookingCalendar({ ...meeting, id: "fake\r\nBEGIN:VEVENT" }, at)).toThrow();
});
