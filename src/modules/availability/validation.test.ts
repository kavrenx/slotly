import { expect, it } from "vitest";
import { isNamedTimezone, minuteToTime, scheduleInput, timeToMinute } from "./validation";

const schedule = { version: 0, timezone: "Europe/Minsk", weekly: [{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 780, endMinute: 1020 }], overrides: [] };
it("accepts separated or touching windows, including the end of a local day", () => {
  expect(scheduleInput.safeParse(schedule).success).toBe(true);
  expect(scheduleInput.safeParse({ ...schedule, weekly: [{ weekday: 7, startMinute: 0, endMinute: 720 }, { weekday: 7, startMinute: 720, endMinute: 1440 }] }).success).toBe(true);
});
it.for([
  [{ weekday: 1, startMinute: 540, endMinute: 540 }],
  [{ weekday: 1, startMinute: 1020, endMinute: 540 }],
  [{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 719, endMinute: 800 }],
  [{ weekday: 1, startMinute: 1440, endMinute: 1441 }],
  [{ weekday: 0, startMinute: 540, endMinute: 720 }],
  [{ weekday: 1, startMinute: 540.5, endMinute: 720 }],
])("rejects invalid or overlapping weekly windows", (weekly) => {
  expect(scheduleInput.safeParse({ ...schedule, weekly }).success).toBe(false);
});
it.each(["+03:00", "GMT+3", "Invalid/Timezone", "", "Europe/Minsk\n"])("rejects a non-named or unknown zone: %s", (timezone) => {
  expect(isNamedTimezone(timezone)).toBe(false);
  expect(scheduleInput.safeParse({ ...schedule, timezone }).success).toBe(false);
});
it.each(["UTC", "Europe/Berlin", "America/New_York", "Asia/Kathmandu", "Pacific/Chatham"])("accepts named zones across countries: %s", (timezone) => {
  expect(isNamedTimezone(timezone)).toBe(true);
});
it.for([
  [{ localDate: "2027-02-29", mode: "closed", windows: [] }],
  [{ localDate: "2027-01-04", mode: "replace", windows: [] }],
  [{ localDate: "2027-01-04", mode: "closed", windows: [{ startMinute: 540, endMinute: 600 }] }],
  [{ localDate: "2027-01-04", mode: "replace", windows: [{ startMinute: 540, endMinute: 600 }, { startMinute: 570, endMinute: 620 }] }],
  [{ localDate: "2027-01-04", mode: "closed", windows: [] }, { localDate: "2027-01-04", mode: "closed", windows: [] }],
])("rejects ambiguous or incomplete date overrides", (overrides) => {
  expect(scheduleInput.safeParse({ ...schedule, overrides }).success).toBe(false);
});
it("keeps local dates and clock times intact through daylight-saving transition dates", () => {
  const data = { ...schedule, timezone: "America/New_York", overrides: [
    { localDate: "2026-03-08", mode: "replace", windows: [{ startMinute: 150, endMinute: 210 }] },
    { localDate: "2026-11-01", mode: "replace", windows: [{ startMinute: 60, endMinute: 120 }] },
  ] };
  expect(scheduleInput.parse(data)).toEqual(data);
  expect(minuteToTime(150)).toBe("02:30"); expect(timeToMinute("02:30")).toBe(150);
  expect(timeToMinute("24:00")).toBe(1440); expect(minuteToTime(1440)).toBe("24:00");
  expect(timeToMinute("24:01")).toBeNull(); expect(timeToMinute("9:00")).toBeNull();
});
it("rejects mass assignment and unbounded collections", () => {
  expect(scheduleInput.safeParse({ ...schedule, organizerId: "another-owner" }).success).toBe(false);
  expect(scheduleInput.safeParse({ ...schedule, weekly: Array.from({ length: 9 }, (_, i) => ({ weekday: 1, startMinute: i * 10, endMinute: i * 10 + 5 })) }).success).toBe(false);
});
