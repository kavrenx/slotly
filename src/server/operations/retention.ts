import type { Pool } from "pg";

// Expired auxiliary data only. Booking, event, account and delivery history are
// deliberately outside this list. The extra day preserves existing OTP replays.
const plans = [
  { name: "guestChallenges", table: "guest_challenges", key: "id", predicate: "expires_at < $1::timestamptz - interval '1 day'" },
  { name: "guestLimits", table: "guest_rate_limits", key: "key", predicate: "expires_at < $1::timestamptz - interval '1 day'" },
  { name: "mailLimits", table: "mail_delivery_limits", key: "key", predicate: "expires_at < $1::timestamptz - interval '1 day'" },
  { name: "authSessions", table: "auth_sessions", key: "id", predicate: "expires_at < $1::timestamptz - interval '1 day'" },
  { name: "authVerifications", table: "auth_verifications", key: "id", predicate: "expires_at < $1::timestamptz - interval '1 day'" },
  // Better Auth 1.7 stores lastRequest as Date.now() milliseconds.
  { name: "authLimits", table: "auth_rate_limits", key: "id", predicate: "last_request < extract(epoch from ($1::timestamptz - interval '1 day')) * 1000" },
] as const;
export type RetentionCounts = Record<typeof plans[number]["name"], number>;

export async function maintainExpiredData(pool: Pool, options: { apply?: boolean; batchSize?: number; now?: Date } = {}) {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("INVALID_MAINTENANCE_BATCH");
  const client = await pool.connect();
  try {
    await client.query(options.apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const now = options.now ?? new Date(Number((await client.query("select extract(epoch from current_timestamp)*1000 as milliseconds")).rows[0].milliseconds));
    if (!Number.isFinite(now.getTime())) throw new Error("INVALID_MAINTENANCE_TIME");
    if (options.apply && !(await client.query("select pg_try_advisory_xact_lock(hashtextextended('slotly:retention:v1',0)) as acquired")).rows[0].acquired) {
      await client.query("ROLLBACK"); return { status: "busy" as const, applied: false, counts: null, batchSize };
    }
    const counts = {} as RetentionCounts;
    for (const plan of plans) {
      const table = `slotly.${plan.table}`;
      if (options.apply) {
        const result = await client.query(`delete from ${table} where ${plan.key} in
          (select ${plan.key} from ${table} where ${plan.predicate} order by ${plan.key} for update skip locked limit $2)
          and ${plan.predicate}`, [now.toISOString(), batchSize]);
        counts[plan.name] = result.rowCount ?? 0;
      } else counts[plan.name] = (await client.query(`select count(*)::int as count from ${table} where ${plan.predicate}`, [now.toISOString()])).rows[0].count;
    }
    await client.query("COMMIT");
    return { status: "ok" as const, applied: options.apply ?? false, counts, batchSize };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
