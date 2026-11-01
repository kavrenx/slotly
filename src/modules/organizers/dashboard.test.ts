import { expect, it } from "vitest";
import { organizerDay, setupProgress } from "./dashboard-service";
import { readBookingFilters, bookingsHref } from "./dashboard-contract";
import type { ScheduleData } from "../availability/validation";

it.each([
  ["2027-03-14T12:00:00Z", "2027-03-14T05:00:00.000Z", "2027-03-15T04:00:00.000Z", 23],
  ["2027-11-07T12:00:00Z", "2027-11-07T04:00:00.000Z", "2027-11-08T05:00:00.000Z", 25],
])("uses civil-day boundaries across DST on %s", (instant, start, end, hours) => {
  const day = organizerDay(new Date(instant), "America/New_York");
  expect(day.start.toISOString()).toBe(start); expect(day.end.toISOString()).toBe(end);
  expect(day.end.getTime() - day.start.getTime()).toBe(Number(hours) * 3_600_000);
});
it("uses the organizer's local date instead of the server date", () => {
  expect(organizerDay(new Date("2027-01-04T22:00:00Z"), "Europe/Minsk").date).toBe("2027-01-05");
});
it("guides a fresh account to hours before creating a page", () => {
  expect(setupProgress(null, [], new Date())).toMatchObject({ hours: false, page: false, published: false });
});
it("does not treat expired one-off hours or archived pages as a completed setup", () => {
  const schedule: ScheduleData = { version: 1, timezone: "UTC", weekly: [], overrides: [
    { localDate: "2027-01-03", mode: "replace", windows: [{ startMinute: 600, endMinute: 660 }] },
    { localDate: "2027-01-04", mode: "replace", windows: [{ startMinute: 600, endMinute: 660 }] },
    { localDate: "2027-01-05", mode: "closed", windows: [] },
  ] };
  expect(setupProgress(schedule, [{ id: "old", state: "archived" }], new Date("2027-01-04T12:00:00Z"))).toMatchObject({ hours: false, page: false, published: false });
  schedule.overrides.push({ localDate: "2027-01-05", mode: "replace", windows: [{ startMinute: 600, endMinute: 660 }] });
  expect(setupProgress(schedule, [{ id: "draft-page", state: "draft" }], new Date("2027-01-04T12:00:00Z"))).toMatchObject({ hours: true, page: true, published: false, pageHref: "/dashboard/pages/draft-page" });
});
it.each([{}, { view: "unknown", page: "-4" }, { view: ["past", "cancelled"], page: ["2", "3"] }, { page: "99999999999999999999" }, { page: "1.5" }])("bounds malformed URL filters: %j", query => {
  expect(readBookingFilters(query)).toEqual({ view: "upcoming", page: 1 });
});
it("keeps the selected view in pagination URLs and resets pagination when changing view", () => {
  expect(readBookingFilters({ view: "past", page: "3" })).toEqual({ view: "past", page: 3 });
  expect(bookingsHref("past", 3)).toBe("/dashboard/bookings?view=past&page=3");
  expect(bookingsHref("cancelled")).toBe("/dashboard/bookings?view=cancelled");
  expect(bookingsHref()).toBe("/dashboard/bookings");
});
