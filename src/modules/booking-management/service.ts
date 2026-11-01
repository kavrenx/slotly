import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { bookingEvents, bookingPages, bookings, occupancies, organizers, schedules } from "../../server/db/schema";
import type { Database } from "../../server/db/types";
import { DomainError, validate } from "../../shared/domain-error";
import { dateInZone } from "../../shared/calendar";
import { readSlotContext, type PublishedPage } from "../availability/public-service";
import { calculateAvailability } from "../availability/slots";
import { availabilityQuery, type SlotQuery } from "../availability/contract";
import { lockOrganizer } from "../organizers/locking";
import { guestDigest } from "../guest-booking/crypto";
import { accessInput, cancelInput, organizerCancelInput, rescheduleInput, type ManagedBooking } from "./contract";
import { createManagementToken, managementBookingId, validManagementToken } from "./token";

export type ManagementDependencies = { database: Database; secret: string; clock?: () => Date };
export type BookingActor = { kind: "guest"; token: string } | { kind: "organizer"; organizerId: string; bookingId: string };
const notFound = () => new DomainError("NOT_FOUND", 404);
function bookingId(actor: BookingActor) {
  const id = actor.kind === "guest" ? managementBookingId(actor.token) : actor.bookingId;
  if (!id || !z.uuid().safeParse(id).success) throw notFound(); return id;
}
async function load(database: Database, id: string) {
  const [row] = await database.select({ booking: bookings, occupied: occupancies, organizerName: organizers.displayName,
    currentTimezone: schedules.timezone, scheduleVersion: schedules.version, pageVersion: bookingPages.version, stepMinutes: bookingPages.stepMinutes })
    .from(bookings).innerJoin(occupancies, eq(occupancies.id, bookings.occupancyId)).innerJoin(organizers, eq(organizers.id, bookings.organizerId))
    .innerJoin(bookingPages, eq(bookingPages.id, bookings.pageId)).innerJoin(schedules, eq(schedules.organizerId, bookings.organizerId)).where(eq(bookings.id, id));
  if (!row) throw notFound(); return row;
}
type Row = Awaited<ReturnType<typeof load>>;
function authorize(row: Row, actor: BookingActor, secret: string, now: Date) {
  if (actor.kind === "organizer") { if (row.booking.organizerId !== actor.organizerId) throw notFound(); }
  else if (!validManagementToken(secret, row.booking, actor.token) || now.getTime() > row.occupied.endAt.getTime() + 30 * 86_400_000) throw notFound();
}
function allowed(row: Row, kind: "cancel" | "reschedule", actor: BookingActor, now: Date) {
  if (row.occupied.releasedAt || now.getTime() >= row.occupied.startAt.getTime()) return false;
  if (actor.kind === "organizer") return kind === "cancel";
  const cutoff = kind === "cancel" ? row.booking.cancelCutoffMinutes : row.booking.rescheduleCutoffMinutes;
  return now.getTime() <= row.occupied.startAt.getTime() - cutoff * 60_000;
}
async function dto(database: Database, row: Row, actor: BookingActor, now: Date, secret: string): Promise<ManagedBooking> {
  const events = await database.select().from(bookingEvents).where(and(eq(bookingEvents.bookingId, row.booking.id), eq(bookingEvents.organizerId, row.booking.organizerId))).orderBy(asc(bookingEvents.version));
  const { booking: b, occupied: o } = row;
  return { id: b.id, title: b.titleSnapshot, location: b.locationSnapshot, organizerName: row.organizerName, guestName: b.guestName, guestEmail: b.guestEmail,
    startAt: o.startAt.toISOString(), endAt: o.endAt.toISOString(), timezone: actor.kind === "guest" ? b.guestTimezone : b.scheduleTimezoneSnapshot,
    version: o.version, status: o.releasedAt ? "cancelled" : "confirmed", durationMinutes: (o.endAt.getTime() - o.startAt.getTime()) / 60_000,
    cancelDeadline: new Date(o.startAt.getTime() - b.cancelCutoffMinutes * 60_000).toISOString(), rescheduleDeadline: new Date(o.startAt.getTime() - b.rescheduleCutoffMinutes * 60_000).toISOString(),
    canCancel: allowed(row, "cancel", actor, now), canReschedule: allowed(row, "reschedule", actor, now), generatedAt: now.toISOString(),
    history: events.map(e => ({ version: e.version, type: e.type, actor: e.actor, reason: e.reason, at: e.createdAt.toISOString(), oldStartAt: e.oldStartAt?.toISOString() ?? null, oldEndAt: e.oldEndAt?.toISOString() ?? null, newStartAt: e.newStartAt?.toISOString() ?? null, newEndAt: e.newEndAt?.toISOString() ?? null })),
    ...(actor.kind === "organizer" ? { managementToken: createManagementToken(secret, b) } : {}),
  };
}
export async function getManagedBooking(deps: ManagementDependencies, actor: BookingActor): Promise<ManagedBooking> {
  const id = bookingId(actor);
  return deps.database.transaction(async tx => {
    const row = await load(tx, id); const at = (deps.clock ?? (() => new Date()))(); authorize(row, actor, deps.secret, at);
    return dto(tx, row, actor, at, deps.secret);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function getGuestBooking(deps: ManagementDependencies, input: unknown) {
  const { token } = validate(accessInput, input); return getManagedBooking(deps, { kind: "guest", token });
}
function savedPolicy(row: Row): PublishedPage {
  const b = row.booking, o = row.occupied;
  return { id: b.pageId, organizerId: b.organizerId, timezone: row.currentTimezone, scheduleVersion: row.scheduleVersion, pageVersion: row.pageVersion,
    title: b.titleSnapshot, description: "", location: b.locationSnapshot, stepMinutes: row.stepMinutes,
    durationMinutes: (o.endAt.getTime() - o.startAt.getTime()) / 60_000, bufferBeforeMinutes: o.bufferBeforeMinutes, bufferAfterMinutes: o.bufferAfterMinutes,
    minNoticeMinutes: b.minNoticeMinutes, horizonDays: b.horizonDays, cancelCutoffMinutes: b.cancelCutoffMinutes, rescheduleCutoffMinutes: b.rescheduleCutoffMinutes };
}
async function available(database: Database, row: Row, query: SlotQuery, now: Date) {
  const context = await readSlotContext(database, savedPolicy(row), query, now, row.occupied.id);
  const result = calculateAvailability({ query, ...context, now });
  result.slots = result.slots.filter(slot => slot.startAt !== row.occupied.startAt.toISOString());
  return result;
}
export async function getRescheduleSlots(deps: ManagementDependencies, actor: BookingActor, input: unknown) {
  if (actor.kind !== "guest") throw new DomainError("FORBIDDEN", 403);
  const query = validate(availabilityQuery, input); const id = bookingId(actor);
  return deps.database.transaction(async tx => {
    const row = await load(tx, id); const at = (deps.clock ?? (() => new Date()))(); authorize(row, actor, deps.secret, at);
    if (!allowed(row, "reschedule", actor, at)) throw new DomainError("CHANGE_NOT_ALLOWED", 409);
    return available(tx, row, query, at);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("cause" in error) return postgresCode(error.cause);
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}
export async function changeBooking(deps: ManagementDependencies, actor: BookingActor, operation: "cancel" | "reschedule", input: unknown): Promise<ManagedBooking> {
  const id = bookingId(actor);
  if (operation === "reschedule" && actor.kind !== "guest") throw new DomainError("FORBIDDEN", 403);
  const data = operation === "cancel" ? validate(actor.kind === "organizer" ? organizerCancelInput : cancelInput, input) : validate(rescheduleInput, input);
  const [owner] = await deps.database.select({ organizerId: bookings.organizerId, occupancyId: bookings.occupancyId }).from(bookings).where(eq(bookings.id, id));
  if (!owner || (actor.kind === "organizer" && owner.organizerId !== actor.organizerId)) throw notFound();
  const requestHash = guestDigest(deps.secret, "booking-management-command", JSON.stringify({ id, actor: actor.kind, operation, ...data }));
  try {
    return await deps.database.transaction(async tx => {
      await lockOrganizer(tx, owner.organizerId);
      await tx.select({ id: occupancies.id }).from(occupancies).where(eq(occupancies.id, owner.occupancyId)).for("update");
      const row = await load(tx, id); const at = (deps.clock ?? (() => new Date()))(); authorize(row, actor, deps.secret, at);
      const [replayed] = await tx.select().from(bookingEvents).where(eq(bookingEvents.requestId, data.requestId));
      if (replayed) {
        if (replayed.bookingId !== id || replayed.requestHash !== requestHash) throw new DomainError("IDEMPOTENCY_CONFLICT", 409);
        return dto(tx, row, actor, at, deps.secret);
      }
      if (row.occupied.version !== data.version) throw new DomainError("VERSION_CONFLICT", 409);
      if (!allowed(row, operation, actor, at)) throw new DomainError("CHANGE_NOT_ALLOWED", 409);
      const o = row.occupied; const version = o.version + 1;
      let startAt: Date | undefined, endAt: Date | undefined;
      if ("startAt" in data) {
        startAt = new Date(data.startAt); endAt = new Date(data.endAt);
        if (endAt.getTime() - startAt.getTime() !== o.endAt.getTime() - o.startAt.getTime()) throw new DomainError("INVALID_INPUT");
        const slots = await available(tx, row, { date: dateInZone(data.startAt, row.booking.guestTimezone), timezone: row.booking.guestTimezone }, at);
        if (!slots.slots.some(s => s.startAt === data.startAt && s.endAt === data.endAt)) throw new DomainError("SLOT_UNAVAILABLE", 409);
        await tx.update(occupancies).set({ startAt, endAt, busyStartAt: new Date(startAt.getTime() - o.bufferBeforeMinutes * 60_000), busyEndAt: new Date(endAt.getTime() + o.bufferAfterMinutes * 60_000), version }).where(and(eq(occupancies.id, o.id), eq(occupancies.version, o.version)));
      } else await tx.update(occupancies).set({ releasedAt: at, version }).where(and(eq(occupancies.id, o.id), eq(occupancies.version, o.version)));
      await tx.insert(bookingEvents).values({ bookingId: id, organizerId: owner.organizerId, version, type: operation === "cancel" ? "cancelled" : "rescheduled", actor: actor.kind,
        reason: "reason" in data ? data.reason || null : null, oldStartAt: o.startAt, oldEndAt: o.endAt, newStartAt: startAt ?? null, newEndAt: endAt ?? null,
        requestId: data.requestId, requestHash, createdAt: at });
      return dto(tx, await load(tx, id), actor, at, deps.secret);
    });
  } catch (error) {
    if (postgresCode(error) === "23P01") throw new DomainError("SLOT_UNAVAILABLE", 409);
    if (postgresCode(error) === "23505") throw new DomainError("IDEMPOTENCY_CONFLICT", 409);
    throw error;
  }
}
