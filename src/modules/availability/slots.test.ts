import { describe, expect, it } from "vitest";
import { calculateAvailability } from "./slots";
import { pageDefaults } from "../booking-pages/validation";
import type { ScheduleData } from "./validation";
import type { SlotPolicy } from "./contract";

const schedule = (timezone = "UTC", startMinute = 540, endMinute = 720): ScheduleData => ({ version: 1, timezone,
  weekly: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinute, endMinute })), overrides: [] });
const policy: SlotPolicy = { ...pageDefaults, minNoticeMinutes: 0 };
function slots(options: Partial<Parameters<typeof calculateAvailability>[0]> = {}) {
  return calculateAvailability({ query: { date: "2027-01-04", timezone: "UTC" }, policy, schedule: schedule(), busy: [], now: new Date("2027-01-04T00:00:00Z"), ...options });
}
const starts = (result: ReturnType<typeof slots>) => result.slots.map((s) => s.startAt);

it("uses a local start grid and requires the full elapsed duration inside working hours", () => {
  const result = slots(); expect(result.slots).toHaveLength(11);
  expect(result.slots[0]).toEqual({ startAt: "2027-01-04T09:00:00.000Z", endAt: "2027-01-04T09:30:00.000Z" });
  expect(result.slots.at(-1)?.startAt).toBe("2027-01-04T11:30:00.000Z");
  expect(starts(slots({ schedule: schedule("UTC", 547, 607) }))[0]).toBe("2027-01-04T09:07:00.000Z");
});
it("fits buffers within the working interval and preserves half-open occupancy boundaries", () => {
  const result = slots({ policy: { ...policy, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 }, busy: [{ start: Date.parse("2027-01-04T10:00:00Z"), end: Date.parse("2027-01-04T10:30:00Z") }] });
  expect(starts(result)).toEqual(["2027-01-04T09:15:00.000Z", "2027-01-04T10:45:00.000Z", "2027-01-04T11:00:00.000Z", "2027-01-04T11:15:00.000Z"]);
});
it("never bridges a working break but merges touching intervals", () => {
  const s = schedule(); s.weekly = [{ weekday: 1, startMinute: 540, endMinute: 600 }, { weekday: 1, startMinute: 615, endMinute: 720 }];
  expect(starts(slots({ schedule: s }))).not.toContain("2027-01-04T09:45:00.000Z");
  s.weekly[1]!.startMinute = 600;
  expect(starts(slots({ schedule: s }))).toContain("2027-01-04T09:45:00.000Z");
});
it("replaces rather than adds to weekly hours and closes explicit days", () => {
  const s = schedule(); s.overrides = [{ localDate: "2027-01-04", mode: "closed", windows: [] }];
  expect(slots({ schedule: s }).slots).toEqual([]);
  s.overrides = [{ localDate: "2027-01-04", mode: "replace", windows: [{ startMinute: 780, endMinute: 840 }] }];
  expect(starts(slots({ schedule: s }))).toEqual(["2027-01-04T13:00:00.000Z", "2027-01-04T13:15:00.000Z", "2027-01-04T13:30:00.000Z"]);
});
it("enforces the server notice to the millisecond and permits its exact boundary", () => {
  const p = { ...policy, minNoticeMinutes: 120 };
  expect(starts(slots({ policy: p, now: new Date("2027-01-04T07:00:00Z") }))[0]).toBe("2027-01-04T09:00:00.000Z");
  expect(starts(slots({ policy: p, now: new Date("2027-01-04T07:00:00.001Z") }))[0]).toBe("2027-01-04T09:15:00.000Z");
});
it("counts horizon calendar days in the organizer's zone, including today", () => {
  const result = slots({ policy: { ...policy, horizonDays: 1 }, query: { date: "2027-01-05", timezone: "UTC" } });
  expect(result.range).toEqual({ firstDate: "2027-01-04", lastDate: "2027-01-04" }); expect(result.slots).toEqual([]);
  expect(slots({ policy: { ...policy, horizonDays: 1, minNoticeMinutes: 1440 } }).range).toBeNull();
});
it("groups by viewer date rather than organizer date, including quarter-hour zones", () => {
  const result = slots({ schedule: schedule("Asia/Kathmandu", 30, 90), query: { date: "2027-01-03", timezone: "America/New_York" }, now: new Date("2027-01-03T00:00:00Z") });
  expect(starts(result)).toContain("2027-01-03T18:45:00.000Z");
  expect(starts(result)).not.toContain("2027-01-04T18:45:00.000Z");
});
it("supports a full meeting across midnight only if working hours continue on the next day", () => {
  const s = schedule(); s.weekly = [{ weekday: 1, startMinute: 1380, endMinute: 1440 }, { weekday: 2, startMinute: 0, endMinute: 60 }];
  const options = { schedule: s, policy: { ...policy, durationMinutes: 60 } };
  expect(starts(slots(options))).toContain("2027-01-04T23:45:00.000Z");
  s.overrides = [{ localDate: "2027-01-05", mode: "closed", windows: [] }];
  expect(starts(slots(options))).not.toContain("2027-01-04T23:45:00.000Z");
});
describe("daylight saving time", () => {
  it.each([
    ["2027-03-14", "2027-03-14T05:00:00Z", 276],
    ["2026-11-01", "2026-11-01T04:00:00Z", 300],
  ])("counts the actual minutes of a short or long day: %s", (date, now, count) => {
    const result = slots({ schedule: schedule("America/New_York", 0, 1440), policy: { ...policy, durationMinutes: 5, stepMinutes: 5, horizonDays: 1 }, query: { date, timezone: "America/New_York" }, now: new Date(now) });
    expect(result.slots).toHaveLength(count);
    expect(result.slots.every((s) => Date.parse(s.endAt) - Date.parse(s.startAt) === 300_000)).toBe(true);
  });
  it("skips nonexistent start times and measures meeting duration in elapsed minutes", () => {
    const result = slots({ schedule: schedule("America/New_York", 60, 240), policy: { ...policy, durationMinutes: 60, stepMinutes: 30 }, query: { date: "2027-03-14", timezone: "America/New_York" }, now: new Date("2027-03-14T00:00:00Z") });
    expect(result.slots).toEqual([
      { startAt: "2027-03-14T06:00:00.000Z", endAt: "2027-03-14T07:00:00.000Z" },
      { startAt: "2027-03-14T06:30:00.000Z", endAt: "2027-03-14T07:30:00.000Z" },
      { startAt: "2027-03-14T07:00:00.000Z", endAt: "2027-03-14T08:00:00.000Z" },
    ]);
  });
  it("returns both repeated starts as distinct UTC instants", () => {
    const result = slots({ schedule: schedule("America/New_York", 60, 180), query: { date: "2026-11-01", timezone: "America/New_York" }, now: new Date("2026-11-01T00:00:00Z") });
    expect(starts(result)).toContain("2026-11-01T05:30:00.000Z");
    expect(starts(result)).toContain("2026-11-01T06:30:00.000Z");
    expect(new Set(starts(result)).size).toBe(result.slots.length);
  });
  it("does not bridge a closed portion inside a repeated hour", () => {
    const result = slots({ schedule: schedule("America/New_York", 90, 120), policy: { ...policy, durationMinutes: 45 }, query: { date: "2026-11-01", timezone: "America/New_York" }, now: new Date("2026-11-01T00:00:00Z") });
    expect(result.slots).toEqual([]);
  });
  it("handles the half-hour transition on Lord Howe Island", () => {
    const result = slots({ schedule: schedule("Australia/Lord_Howe", 90, 150), policy: { ...policy, stepMinutes: 15, durationMinutes: 15 }, query: { date: "2027-04-04", timezone: "Australia/Lord_Howe" }, now: new Date("2027-04-03T00:00:00Z") });
    expect(starts(result)).toContain("2027-04-03T14:30:00.000Z");
    expect(starts(result)).toContain("2027-04-03T15:00:00.000Z");
  });
  it("does not invent instants for an entirely skipped civil day", () => {
    const result = slots({ schedule: schedule("Pacific/Apia", 0, 1440), query: { date: "2011-12-30", timezone: "Pacific/Apia" }, now: new Date("2011-12-29T00:00:00Z") });
    expect(result.slots).toEqual([]);
  });
  it("starts at the first real time on a date without midnight", () => {
    const result = slots({ schedule: schedule("America/Sao_Paulo", 0, 1440), policy: { ...policy, durationMinutes: 5, stepMinutes: 5 }, query: { date: "2018-11-04", timezone: "America/Sao_Paulo" }, now: new Date("2018-11-03T00:00:00Z") });
    expect(result.slots[0]?.startAt).toBe("2018-11-04T03:00:00.000Z");
    expect(result.slots).toHaveLength(276);
  });
});
