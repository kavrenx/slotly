import { expect, it } from "vitest";
import { pageDefaults, pageInput, pageStateUpdate, pageUpdate, stateTransitions } from "./validation";

const page = { ...pageDefaults, title: "Консультация" };
it("uses the approved defaults and trims visible content", () => {
  expect(pageInput.parse({ ...page, title: " Встреча ", description: " Описание " })).toMatchObject({
    title: "Встреча", description: "Описание", durationMinutes: 30, stepMinutes: 15, bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0, minNoticeMinutes: 120, horizonDays: 60, cancelCutoffMinutes: 120, rescheduleCutoffMinutes: 120,
  });
});
it.each([
  ["durationMinutes", 0], ["durationMinutes", 31], ["durationMinutes", 485], ["stepMinutes", 7], ["stepMinutes", 125],
  ["bufferBeforeMinutes", -5], ["bufferAfterMinutes", 245], ["bufferBeforeMinutes", 4],
  ["minNoticeMinutes", -1], ["minNoticeMinutes", 43201], ["horizonDays", 0], ["horizonDays", 366],
  ["cancelCutoffMinutes", 43201], ["rescheduleCutoffMinutes", 1.5],
])("rejects an invalid timing parameter %s=%s", (field, value) => {
  expect(pageInput.safeParse({ ...page, [field]: value }).success).toBe(false);
});
it("accepts the inclusive policy boundaries", () => {
  expect(pageInput.safeParse({ ...page, durationMinutes: 480, stepMinutes: 120, bufferBeforeMinutes: 240, bufferAfterMinutes: 240, minNoticeMinutes: 43200, horizonDays: 365, cancelCutoffMinutes: 0, rescheduleCutoffMinutes: 43200 }).success).toBe(true);
});
it("rejects blank titles, too much content, forged ownership and missing versions", () => {
  expect(pageInput.safeParse({ ...page, title: "  " }).success).toBe(false);
  expect(pageInput.safeParse({ ...page, description: "x".repeat(4001) }).success).toBe(false);
  expect(pageInput.safeParse({ ...page, organizerId: "forged" }).success).toBe(false);
  expect(pageInput.safeParse({ ...page, state: "published" }).success).toBe(false);
  expect(pageUpdate.safeParse(page).success).toBe(false);
  expect(pageStateUpdate.safeParse({ state: "published", version: 0 }).success).toBe(false);
  expect(stateTransitions.archived).toEqual([]);
});
