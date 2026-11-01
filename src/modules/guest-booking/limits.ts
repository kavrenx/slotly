import { sql } from "drizzle-orm";
import { guestRateLimits } from "../../server/db/schema";
import type { Database } from "../../server/db/types";
import { DomainError } from "../../shared/domain-error";
import { guestDigest } from "./crypto";

export class GuestRateLimit extends DomainError {
  constructor(public readonly retryAfter: number) { super("RATE_LIMITED", 429); }
}
export async function spendGuestLimit(database: Database, secret: string, scope: string, limit: number, seconds: number, now: Date) {
  const key = guestDigest(secret, "rate-key", scope); const expiresAt = new Date(now.getTime() + seconds * 1000);
  const [row] = await database.insert(guestRateLimits).values({ key, count: 1, expiresAt }).onConflictDoUpdate({ target: guestRateLimits.key, set: {
    count: sql`case when ${guestRateLimits.expiresAt} <= ${now.toISOString()}::timestamptz then 1 else least(${guestRateLimits.count} + 1, ${limit + 1}) end`,
    expiresAt: sql`case when ${guestRateLimits.expiresAt} <= ${now.toISOString()}::timestamptz then ${expiresAt.toISOString()}::timestamptz else ${guestRateLimits.expiresAt} end`,
  } }).returning();
  return row!.count > limit ? new GuestRateLimit(Math.max(1, Math.ceil((row!.expiresAt.getTime() - now.getTime()) / 1000))) : null;
}
