import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/types";
import type { LocalMail } from "./local";
import type { createMailDelivery } from "./delivery";

const setting = (fallback: number) => z.coerce.number().int().min(1).max(1_000_000).default(fallback);
const policySchema = z.object({ MAIL_MAX_PER_HOUR: setting(100), MAIL_MAX_PER_DAY: setting(1000),
  MAIL_RECIPIENT_MAX_PER_HOUR: setting(20), MAIL_RECIPIENT_MAX_PER_DAY: setting(100) });
export type MailBudgetPolicy = z.infer<typeof policySchema>;
export function parseMailBudgetPolicy(input: Record<string, string | undefined>) {
  const result = policySchema.safeParse(input);
  if (!result.success) throw new Error(`Ошибка лимитов почты: ${result.error.issues.map(i => i.path[0]).join(", ")}; значения скрыты`);
  return result.data;
}
export class MailBudgetExceeded extends Error {
  readonly code = "MAIL_RATE_LIMITED";
  constructor(readonly retryAfter: number) { super("MAIL_RATE_LIMITED"); }
}
export type MailLimit = { scope: string; maximum: number; seconds: number };
const digest = (secret: string, scope: string) => createHmac("sha256", secret).update(`slotly-mail-limits/v1\0${scope}`).digest("hex");

// Reservations commit before SMTP; an ambiguous network failure is not refunded.
// All buckets change together or none do. Stable key order prevents deadlocks.
export async function reserveMailLimits(database: Database, secret: string, limits: MailLimit[], now?: Date) {
  await database.execute(sql`delete from slotly.mail_delivery_limits where key in
    (select key from slotly.mail_delivery_limits where expires_at < current_timestamp - interval '1 day' order by expires_at,key for update skip locked limit 100)`);
  await database.transaction(async tx => {
    const at = now ?? new Date(Number((await tx.execute(sql`select extract(epoch from current_timestamp)*1000 as milliseconds`)).rows[0]!.milliseconds));
    let retryAfter = 0;
    const buckets = limits.map(limit => ({ ...limit, key: digest(secret, limit.scope) })).sort((a, b) => a.key.localeCompare(b.key));
    for (const bucket of buckets) {
      const expiry = new Date(at.getTime() + bucket.seconds * 1000).toISOString();
      const result = await tx.execute(sql`insert into slotly.mail_delivery_limits as existing (key,count,expires_at)
        values (${bucket.key},1,${expiry}::timestamptz) on conflict(key) do update set
        count=case when existing.expires_at <= ${at.toISOString()}::timestamptz then 1 else existing.count+1 end,
        expires_at=case when existing.expires_at <= ${at.toISOString()}::timestamptz then excluded.expires_at else existing.expires_at end
        where existing.expires_at <= ${at.toISOString()}::timestamptz or existing.count < ${bucket.maximum} returning expires_at`);
      if (!result.rows.length) {
        const row = (await tx.execute(sql`select extract(epoch from expires_at)*1000 as milliseconds from slotly.mail_delivery_limits where key=${bucket.key}`)).rows[0]!;
        retryAfter = Math.max(retryAfter, Math.max(1, Math.ceil((Number(row.milliseconds) - at.getTime()) / 1000)));
      }
    }
    if (retryAfter) throw new MailBudgetExceeded(retryAfter);
  });
}
export async function guardIdentityMailRequest(database: Database, secret: string, recipient: string, clientBucket: string) {
  const email = recipient.trim().toLowerCase();
  // Charge known and unknown accounts equally, before Better Auth looks them up.
  await reserveMailLimits(database, secret, [
    { scope: `auth-request-ip-minute:${clientBucket}`, maximum: 10, seconds: 60 },
    { scope: `auth-request-ip-hour:${clientBucket}`, maximum: 60, seconds: 3600 },
    { scope: `auth-request-minute:${email}`, maximum: 1, seconds: 60 },
    { scope: `auth-request-hour:${email}`, maximum: 5, seconds: 3600 },
  ]);
}
export function withMailBudget(raw: ReturnType<typeof createMailDelivery>, database: Database, secret: string, policy: MailBudgetPolicy) {
  return { ...raw, async sendMail(message: LocalMail) {
    const recipient = message.to.trim().toLowerCase();
    await reserveMailLimits(database, secret, [
      { scope: "smtp-hour", maximum: policy.MAIL_MAX_PER_HOUR, seconds: 3600 },
      { scope: "smtp-day", maximum: policy.MAIL_MAX_PER_DAY, seconds: 86400 },
      { scope: `smtp-recipient-hour:${recipient}`, maximum: policy.MAIL_RECIPIENT_MAX_PER_HOUR, seconds: 3600 },
      { scope: `smtp-recipient-day:${recipient}`, maximum: policy.MAIL_RECIPIENT_MAX_PER_DAY, seconds: 86400 },
    ]);
    await raw.sendMail(message);
  } };
}
