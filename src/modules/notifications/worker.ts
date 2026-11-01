import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Database } from "../../server/db/types";
import { bookingEvents, bookings, notificationOutbox } from "../../server/db/schema";
import type { LocalMail } from "../../server/mail/local";
import { renderBookingNotification } from "./mail";

export type NotificationDependencies = { database: Database; appUrl: string; secret: string; sendMail: (mail: LocalMail) => Promise<void>; clock?: () => Date };
export const LEASE_MS = 120_000;
export const MAX_ATTEMPTS = 8;
export function retryDelay(attempts: number) { return Math.min(3_600_000, 5_000 * 2 ** Math.max(0, attempts - 1)); }
type Claim = { id: string; lease_token: string };

async function claim(deps: NotificationDependencies): Promise<Claim | undefined> {
  const now = (deps.clock ?? (() => new Date()))();
  // A process may die on its last attempt. Recover the expired lease as failed,
  // rather than leaving this delivery (and later events) blocked indefinitely.
  await deps.database.execute(sql`update slotly.notification_outbox set failed_at=${now.toISOString()}::timestamptz,
    lease_token=null, locked_until=null, last_error='LEASE_EXHAUSTED'
    where sent_at is null and failed_at is null and attempts >= ${MAX_ATTEMPTS}
      and locked_until <= ${now.toISOString()}::timestamptz`);
  const lease = randomUUID();
  const result = await deps.database.execute(sql`update slotly.notification_outbox set
    lease_token=${lease}::uuid, locked_until=${new Date(now.getTime() + LEASE_MS).toISOString()}::timestamptz,
    attempts=attempts+1
    where id=(select q.id from slotly.notification_outbox q
      join slotly.booking_events e on e.id=q.event_id
      where q.sent_at is null and q.failed_at is null and q.attempts < ${MAX_ATTEMPTS}
        and q.available_at <= ${now.toISOString()}::timestamptz
        and (q.locked_until is null or q.locked_until <= ${now.toISOString()}::timestamptz)
        and not exists(select 1 from slotly.notification_outbox previous
          join slotly.booking_events pe on pe.id=previous.event_id
          where pe.booking_id=e.booking_id and pe.version < e.version and previous.audience=q.audience
            and previous.sent_at is null and previous.failed_at is null)
      order by q.available_at, e.version, q.id for update of q skip locked limit 1)
    returning id, lease_token`);
  return result.rows[0] as Claim | undefined;
}

// One claim per call, no long-lived transaction or network work under row locks.
// Stable message ID + timestamp make local delivery idempotent after a crash.
export async function deliverNextNotification(deps: NotificationDependencies): Promise<"idle" | "sent" | "retry" | "failed" | "lease-lost"> {
  const claimed = await claim(deps); if (!claimed) return "idle";
  const [content] = await deps.database.select({ delivery: notificationOutbox, event: bookingEvents, booking: bookings })
    .from(notificationOutbox).innerJoin(bookingEvents, eq(bookingEvents.id, notificationOutbox.eventId))
    .innerJoin(bookings, eq(bookings.id, bookingEvents.bookingId)).where(and(eq(notificationOutbox.id, claimed.id), eq(notificationOutbox.leaseToken, claimed.lease_token)));
  if (!content) return "lease-lost";
  let delivered = false;
  try { await deps.sendMail(renderBookingNotification(content, deps.appUrl, deps.secret)); delivered = true; }
  catch { /* Never persist exception text, credentials, recipients or URLs. */ }
  const now = (deps.clock ?? (() => new Date()))();
  const terminal = content.delivery.attempts >= MAX_ATTEMPTS;
  const rows = await deps.database.update(notificationOutbox).set({ leaseToken: null, lockedUntil: null,
    ...(delivered ? { sentAt: now, lastError: null }
      : { lastError: "DELIVERY_FAILED", ...(terminal ? { failedAt: now } : { availableAt: new Date(now.getTime() + retryDelay(content.delivery.attempts)) }) }),
  }).where(and(eq(notificationOutbox.id, claimed.id), eq(notificationOutbox.leaseToken, claimed.lease_token))).returning({ id: notificationOutbox.id });
  if (!rows.length) return "lease-lost";
  return delivered ? "sent" : terminal ? "failed" : "retry";
}

export async function notificationQueueStatus(database: Database) {
  const result = await database.execute(sql`select
    count(*) filter (where sent_at is not null)::int as sent,
    count(*) filter (where failed_at is not null)::int as failed,
    count(*) filter (where sent_at is null and failed_at is null)::int as pending
    from slotly.notification_outbox`);
  return result.rows[0] as { sent: number; failed: number; pending: number };
}
export async function retryFailedNotifications(database: Database, now = new Date()) {
  return database.update(notificationOutbox).set({ failedAt: null, attempts: 0, availableAt: now, lastError: null })
    .where(isNotNull(notificationOutbox.failedAt)).returning({ id: notificationOutbox.id });
}
