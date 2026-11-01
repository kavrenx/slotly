import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { bookingEvents, bookingPages, bookings, guestChallenges, occupancies, organizers } from "../../server/db/schema";
import type { Database } from "../../server/db/types";
import type { LocalMail } from "../../server/mail/local";
import { DomainError, validate } from "../../shared/domain-error";
import { dateInZone } from "../../shared/calendar";
import { readPublishedPage, readSlotContext, type PublishedPage } from "../availability/public-service";
import { calculateAvailability } from "../availability/slots";
import { lockOrganizer } from "../organizers/locking";
import { bookingQuote, confirmBookingInput, requestCodeInput, type BookingQuote, type BookingReceipt, type CodeChallenge, type CodeRequest } from "./contract";
import { checkCode, guestDigest, issueCode, openCode } from "./crypto";
import { spendGuestLimit } from "./limits";
import { createManagementToken } from "../booking-management/token";
import { meetingTimeSummary } from "../../shared/meeting-time";

export type GuestBookingDependencies = { database: Database; secret: string; sendMail: (mail: LocalMail) => Promise<void>; clock?: () => Date };
type Challenge = typeof guestChallenges.$inferSelect;
const OTP_LIFETIME = 600_000;
const REPLAY_LIFETIME = 86_400_000;
function quote(page: PublishedPage): BookingQuote {
  return { title: page.title, description: page.description, location: page.location, timezone: page.timezone,
    pageVersion: page.pageVersion, scheduleVersion: page.scheduleVersion, durationMinutes: page.durationMinutes, stepMinutes: page.stepMinutes,
    bufferBeforeMinutes: page.bufferBeforeMinutes, bufferAfterMinutes: page.bufferAfterMinutes, minNoticeMinutes: page.minNoticeMinutes,
    horizonDays: page.horizonDays, cancelCutoffMinutes: page.cancelCutoffMinutes, rescheduleCutoffMinutes: page.rescheduleCutoffMinutes };
}
function dto(row: Challenge): CodeChallenge {
  const saved = bookingQuote.parse(row.quote);
  return { challengeId: row.id, expiresAt: row.expiresAt.toISOString(), resendAt: new Date(row.createdAt.getTime() + 60_000).toISOString(),
    quote: { title: saved.title, location: saved.location, durationMinutes: saved.durationMinutes, cancelCutoffMinutes: saved.cancelCutoffMinutes, rescheduleCutoffMinutes: saved.rescheduleCutoffMinutes } };
}
async function ownerOf(database: Database, publicId: string) {
  if (!z.uuid().safeParse(publicId).success) throw new DomainError("NOT_FOUND", 404);
  const [page] = await database.select({ id: bookingPages.id, organizerId: bookingPages.organizerId }).from(bookingPages).where(eq(bookingPages.publicId, publicId));
  if (!page) throw new DomainError("NOT_FOUND", 404); return page;
}
function sameIntent(row: Challenge, data: CodeRequest, pageId: string) {
  return row.pageId === pageId && row.guestEmail === data.email && row.guestName === data.name && row.guestTimezone === data.timezone
    && row.startAt.toISOString() === data.startAt && row.endAt.toISOString() === data.endAt;
}
async function assertAvailable(database: Database, page: PublishedPage, startAt: string, endAt: string, timezone: string, now: Date) {
  if (Date.parse(endAt) - Date.parse(startAt) !== page.durationMinutes * 60_000) throw new DomainError("CONDITIONS_CHANGED", 409);
  const query = { date: dateInZone(startAt, timezone), timezone };
  const context = await readSlotContext(database, page, query, now);
  if (!calculateAvailability({ query, ...context, now }).slots.some((s) => s.startAt === startAt && s.endAt === endAt)) throw new DomainError("SLOT_UNAVAILABLE", 409);
}
function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("cause" in error) return postgresCode(error.cause);
  return "code" in error && typeof error.code === "string" ? error.code : undefined;
}
// Bounded maintenance only removes expired verification data, never booking history.
export async function pruneGuestData(database: Database, now: Date) {
  const before = new Date(now.getTime() - REPLAY_LIFETIME).toISOString();
  await database.execute(sql`delete from ${guestChallenges} where id in (select id from ${guestChallenges} where expires_at < ${before}::timestamptz order by expires_at for update skip locked limit 100)`);
  await database.execute(sql`delete from slotly.guest_rate_limits where key in (select key from slotly.guest_rate_limits where expires_at < ${before}::timestamptz order by expires_at for update skip locked limit 100)`);
}
export async function requestGuestCode(deps: GuestBookingDependencies, publicId: string, input: unknown, clientIp: string): Promise<CodeChallenge> {
  const data = validate(requestCodeInput, input); const now = deps.clock ?? (() => new Date());
  const ipLimit = await spendGuestLimit(deps.database, deps.secret, `send-ip:${clientIp}`, 60, 3600, now()); if (ipLimit) throw ipLimit;
  await pruneGuestData(deps.database, now());
  const owner = await ownerOf(deps.database, publicId);
  const requestHash = guestDigest(deps.secret, "request", JSON.stringify({ publicId, ...data }));
  let result;
  try {
    result = await deps.database.transaction(async (tx) => {
      await lockOrganizer(tx, owner.organizerId); const at = now();
      const [existing] = await tx.select().from(guestChallenges).where(eq(guestChallenges.requestId, data.requestId));
      if (existing) {
        if (existing.requestHash !== requestHash) return { error: new DomainError("IDEMPOTENCY_CONFLICT", 409) };
        if (existing.invalidatedAt || existing.expiresAt.getTime() <= at.getTime()) return { error: new DomainError("INVALID_CODE") };
        return { challenge: existing };
      }
      const page = await readPublishedPage(tx, publicId);
      await assertAvailable(tx, page, data.startAt, data.endAt, data.timezone, at);
      let previous: Challenge | undefined;
      if (data.previousChallengeId) {
        [previous] = await tx.select().from(guestChallenges).where(eq(guestChallenges.id, data.previousChallengeId)).for("update");
        if (!previous || previous.consumedAt || !sameIntent(previous, data, page.id)) return { error: new DomainError("INVALID_CODE") };
      }
      const minuteLimit = await spendGuestLimit(tx, deps.secret, `send-email-minute:${data.email}`, 1, 60, at); if (minuteLimit) return { error: minuteLimit };
      const hourLimit = await spendGuestLimit(tx, deps.secret, `send-email-hour:${data.email}`, 5, 3600, at); if (hourLimit) return { error: hourLimit };
      const id = randomUUID();
      const [challenge] = await tx.insert(guestChallenges).values({ id, requestId: data.requestId, requestHash, organizerId: page.organizerId, pageId: page.id,
        guestName: data.name, guestEmail: data.email, guestTimezone: data.timezone, startAt: new Date(data.startAt), endAt: new Date(data.endAt), quote: quote(page),
        ...issueCode(deps.secret, id), createdAt: at, expiresAt: new Date(at.getTime() + OTP_LIFETIME) }).returning();
      if (previous) await tx.update(guestChallenges).set({ invalidatedAt: at }).where(eq(guestChallenges.id, previous.id));
      return { challenge: challenge! };
    });
  } catch (error) { if (postgresCode(error) === "23505") throw new DomainError("IDEMPOTENCY_CONFLICT", 409); throw error; }
  if (result.error) throw result.error;
  const challenge = result.challenge!;
  if (!challenge.sentAt) {
    let code: string;
    try { code = openCode(deps.secret, challenge.id, challenge.sealedCode); } catch { throw new DomainError("INVALID_CODE"); }
    const time = meetingTimeSummary({ startAt: challenge.startAt.toISOString(), endAt: challenge.endAt.toISOString() }, challenge.guestTimezone);
    await deps.sendMail({ messageId: challenge.id, createdAt: challenge.createdAt.toISOString(), to: challenge.guestEmail, subject: "Код подтверждения записи в Slotly",
      text: `Ваш код: ${code}\n\n${challenge.quote.title}\n${time.date}\n${time.time} · ${challenge.guestTimezone} · ${time.offset}\n\nКод действует 10 минут. Время пока не забронировано. Если вы не запрашивали запись, проигнорируйте письмо.`,
      presentation: { heading: "Подтвердите запись", intro: "Введите этот код на странице Slotly, чтобы завершить запись.", code,
        details: [{ label: "Встреча", value: challenge.quote.title }, { label: "Дата и время", value: `${time.date}\n${time.time} · ${challenge.guestTimezone} · ${time.offset}` }],
        notes: ["Код действует 10 минут. Время остаётся доступным другим участникам до подтверждения.", "Если вы не запрашивали запись, проигнорируйте письмо."] } });
    await deps.database.update(guestChallenges).set({ sentAt: now() }).where(and(eq(guestChallenges.id, challenge.id), isNull(guestChallenges.sentAt)));
  }
  return dto(challenge);
}

async function receipt(database: Database, id: string, organizerId: string, secret: string, description: string): Promise<BookingReceipt> {
  const [row] = await database.select({ id: bookings.id, title: bookings.titleSnapshot, location: bookings.locationSnapshot, startAt: occupancies.startAt, endAt: occupancies.endAt,
    releasedAt: occupancies.releasedAt, timezone: bookings.guestTimezone, guestName: bookings.guestName, guestEmail: bookings.guestEmail, organizerName: organizers.displayName })
    .from(bookings).innerJoin(occupancies, eq(occupancies.id, bookings.occupancyId)).innerJoin(organizers, eq(organizers.id, bookings.organizerId))
    .where(and(eq(bookings.id, id), eq(bookings.organizerId, organizerId)));
  if (!row) throw new DomainError("INVALID_CODE");
  return { id: row.id, title: row.title, description, location: row.location, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(), timezone: row.timezone,
    guestName: row.guestName, guestEmail: row.guestEmail, organizerName: row.organizerName, status: row.releasedAt ? "cancelled" : "confirmed",
    managementToken: createManagementToken(secret, { id: row.id, organizerId, guestEmail: row.guestEmail }) };
}
export async function confirmGuestBooking(deps: GuestBookingDependencies, publicId: string, input: unknown, clientIp: string): Promise<BookingReceipt> {
  const data = validate(confirmBookingInput, input); const now = deps.clock ?? (() => new Date());
  const ipLimit = await spendGuestLimit(deps.database, deps.secret, `confirm-ip:${clientIp}`, 60, 600, now()); if (ipLimit) throw ipLimit;
  const owner = await ownerOf(deps.database, publicId);
  try {
    const result = await deps.database.transaction(async (tx) => {
      await lockOrganizer(tx, owner.organizerId); const at = now();
      const [challenge] = await tx.select().from(guestChallenges).where(and(eq(guestChallenges.id, data.challengeId), eq(guestChallenges.pageId, owner.id))).for("update");
      if (!challenge) return { error: new DomainError("INVALID_CODE") };
      const replay = challenge.consumedAt && challenge.consumedAt.getTime() + REPLAY_LIFETIME > at.getTime();
      const active = !challenge.invalidatedAt && (replay || challenge.expiresAt.getTime() > at.getTime());
      if (!active || challenge.attempts >= 5 || !challenge.sentAt) return { error: new DomainError("INVALID_CODE") };
      if (!checkCode(deps.secret, challenge.id, data.code, challenge.codeHash)) {
        await tx.update(guestChallenges).set({ attempts: challenge.attempts + 1 }).where(eq(guestChallenges.id, challenge.id));
        return { error: new DomainError("INVALID_CODE") }; // Commit the failed attempt.
      }
      const savedDescription = bookingQuote.parse(challenge.quote).description;
      if (challenge.bookingId) return { booking: await receipt(tx, challenge.bookingId, owner.organizerId, deps.secret, savedDescription) };
      const page = await readPublishedPage(tx, publicId);
      if (!isDeepStrictEqual(quote(page), challenge.quote)) return { error: new DomainError("CONDITIONS_CHANGED", 409) };
      await assertAvailable(tx, page, challenge.startAt.toISOString(), challenge.endAt.toISOString(), challenge.guestTimezone, at);
      const [occupied] = await tx.insert(occupancies).values({ organizerId: owner.organizerId, kind: "booking", startAt: challenge.startAt, endAt: challenge.endAt,
        bufferBeforeMinutes: page.bufferBeforeMinutes, bufferAfterMinutes: page.bufferAfterMinutes,
        busyStartAt: new Date(challenge.startAt.getTime() - page.bufferBeforeMinutes * 60_000), busyEndAt: new Date(challenge.endAt.getTime() + page.bufferAfterMinutes * 60_000) }).returning();
      const [booked] = await tx.insert(bookings).values({ organizerId: owner.organizerId, pageId: page.id, occupancyId: occupied!.id,
        guestName: challenge.guestName, guestEmail: challenge.guestEmail, guestTimezone: challenge.guestTimezone, emailVerifiedAt: at,
        titleSnapshot: page.title, locationSnapshot: page.location, scheduleTimezoneSnapshot: page.timezone, minNoticeMinutes: page.minNoticeMinutes,
        horizonDays: page.horizonDays, cancelCutoffMinutes: page.cancelCutoffMinutes, rescheduleCutoffMinutes: page.rescheduleCutoffMinutes }).returning();
      await tx.insert(bookingEvents).values({ bookingId: booked!.id, organizerId: owner.organizerId, version: 1, type: "created", actor: "guest", newStartAt: challenge.startAt, newEndAt: challenge.endAt });
      await tx.update(guestChallenges).set({ consumedAt: at, bookingId: booked!.id }).where(eq(guestChallenges.id, challenge.id));
      return { booking: await receipt(tx, booked!.id, owner.organizerId, deps.secret, savedDescription) };
    });
    if (result.error) throw result.error; return result.booking!;
  } catch (error) { if (postgresCode(error) === "23P01") throw new DomainError("SLOT_UNAVAILABLE", 409); throw error; }
}
