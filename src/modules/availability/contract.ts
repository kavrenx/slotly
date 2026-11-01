import { z } from "zod";
import type { pageInput } from "../booking-pages/validation";
import { isNamedTimezone } from "./validation";

export const availabilityQuery = z.strictObject({
  date: z.iso.date().refine((date) => !date.startsWith("0000")),
  timezone: z.string().max(64).refine(isNamedTimezone),
});
export type SlotQuery = z.infer<typeof availabilityQuery>;
export type SlotPolicy = Pick<z.infer<typeof pageInput>, "durationMinutes" | "stepMinutes" | "bufferBeforeMinutes" | "bufferAfterMinutes" | "minNoticeMinutes" | "horizonDays">;
export type AvailableSlot = { startAt: string; endAt: string };
export type AvailabilityResponse = {
  date: string; timezone: string; generatedAt: string;
  hasOffsetChange: boolean;
  range: { firstDate: string; lastDate: string } | null;
  slots: AvailableSlot[];
};
