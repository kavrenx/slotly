import { z } from "zod";
import { availabilityQuery } from "../availability/contract";

export const managementToken = z.string().regex(/^v1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$/u);
export const accessInput = z.strictObject({ token: managementToken });
export const managementSlotsInput = availabilityQuery.extend({ token: managementToken });
const command = { requestId: z.uuid(), version: z.number().int().min(1).max(2_147_483_646) };
export const cancelInput = z.strictObject({ ...command, reason: z.string().trim().max(1000).optional() });
export const organizerCancelInput = cancelInput.extend({ reason: z.string().trim().min(1).max(1000) });
const minuteInstant = z.iso.datetime({ precision: 3 }).refine(value => Date.parse(value) % 60_000 === 0);
export const rescheduleInput = z.strictObject({ ...command, startAt: minuteInstant, endAt: minuteInstant }).refine(value => Date.parse(value.endAt) > Date.parse(value.startAt) && Date.parse(value.endAt) - Date.parse(value.startAt) <= 480 * 60_000);
export const guestCancelInput = cancelInput.extend({ token: managementToken });
export const guestRescheduleInput = z.strictObject({ ...command, token: managementToken, startAt: minuteInstant, endAt: minuteInstant }).refine(value => Date.parse(value.endAt) > Date.parse(value.startAt) && Date.parse(value.endAt) - Date.parse(value.startAt) <= 480 * 60_000);

export type BookingHistory = { version: number; type: string; actor: string; reason: string | null; at: string; oldStartAt: string | null; oldEndAt: string | null; newStartAt: string | null; newEndAt: string | null };
export type ManagedBooking = {
  id: string; title: string; location: string; organizerName: string; guestName: string; guestEmail: string;
  startAt: string; endAt: string; timezone: string; status: "confirmed" | "cancelled"; version: number;
  durationMinutes: number; cancelDeadline: string; rescheduleDeadline: string; generatedAt: string;
  canCancel: boolean; canReschedule: boolean; history: BookingHistory[]; managementToken?: string;
};
export const managementHref = (token: string) => `/manage#token=${encodeURIComponent(token)}`;
