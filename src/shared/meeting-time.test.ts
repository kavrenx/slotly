import { expect, it } from "vitest";
import { meetingTimeSummary } from "./meeting-time";

it("uses the viewer date and exposes the ending date across midnight and year boundaries", () => {
  const result = meetingTimeSummary({ startAt: "2026-12-31T20:45:00Z", endAt: "2026-12-31T21:15:00Z" }, "Europe/Minsk");
  expect(result.date).toContain("31 декабря 2026"); expect(result.time).toContain("23:45"); expect(result.time).toContain("1 янв. 2027"); expect(result.time).toContain("00:15"); expect(result.durationMinutes).toBe(30);
});
it("retains both UTC offsets and elapsed duration in a repeated local hour", () => {
  const result = meetingTimeSummary({ startAt: "2026-11-01T05:30:00Z", endAt: "2026-11-01T06:30:00Z" }, "America/New_York");
  expect(result.time).toBe("01:30 — 01:30"); expect(result.offset).toBe("GMT-4 → GMT-5"); expect(result.durationMinutes).toBe(60);
});
it("formats the same instant on the correct next date in a distant timezone", () => {
  const result = meetingTimeSummary({ startAt: "2026-11-01T12:00:00Z", endAt: "2026-11-01T12:30:00Z" }, "Pacific/Kiritimati");
  expect(result.date).toContain("2 ноября 2026"); expect(result.time).toBe("02:00 — 02:30"); expect(result.offset).toBe("GMT+14");
});
