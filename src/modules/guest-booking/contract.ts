import { z } from "zod";
import { isNamedTimezone } from "../availability/validation";
import { pageInput } from "../booking-pages/validation";

const minuteInstant = z.iso.datetime({ precision: 3 }).refine((value) => Date.parse(value) % 60_000 === 0);
export const requestCodeInput = z.strictObject({
  requestId: z.uuid(), previousChallengeId: z.uuid().optional(),
  name: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  timezone: z.string().max(64).refine(isNamedTimezone), startAt: minuteInstant, endAt: minuteInstant,
}).refine((value) => Date.parse(value.endAt) > Date.parse(value.startAt) && Date.parse(value.endAt) - Date.parse(value.startAt) <= 480 * 60_000);
export const confirmBookingInput = z.strictObject({ challengeId: z.uuid(), code: z.string().length(6).regex(/^[0-9]{6}$/u) });
export const bookingQuote = pageInput.extend({ timezone: z.string().max(64).refine(isNamedTimezone), pageVersion: z.number().int().positive(), scheduleVersion: z.number().int().positive() });
export type BookingQuote = z.infer<typeof bookingQuote>;
export type CodeRequest = z.infer<typeof requestCodeInput>;
export type PublicBookingQuote = Pick<BookingQuote, "title" | "location" | "durationMinutes" | "cancelCutoffMinutes" | "rescheduleCutoffMinutes">;
export type CodeChallenge = { challengeId: string; expiresAt: string; resendAt: string; quote: PublicBookingQuote };
export type BookingReceipt = { id: string; title: string; location: string; startAt: string; endAt: string; timezone: string;
  guestName: string; guestEmail: string; organizerName: string; status: "confirmed" | "cancelled"; managementToken: string };
