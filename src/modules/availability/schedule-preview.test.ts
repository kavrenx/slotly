import { expect, it } from "vitest";
import { previewWorkingDay } from "./schedule-preview";
it("keeps breaks and the 24:00 endpoint while treating disabled days as weekends", () => {
  expect(previewWorkingDay([{ start: "13:00", end: "24:00" }, { start: "09:00", end: "12:00" }])).toEqual({ invalid: false, intervals: [{ start: 540, end: 720 }, { start: 780, end: 1440 }] });
  expect(previewWorkingDay([])).toEqual({ invalid: false, intervals: [] });
});
it.each([[{ start: "10:", end: "12:00" }], [{ start: "12:00", end: "09:00" }], [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }]].map(windows => ({ windows })))("does not draw misleading bars for invalid draft intervals", ({ windows }) => {
  expect(previewWorkingDay(windows)).toEqual({ invalid: true, intervals: [] });
});
