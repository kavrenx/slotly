import { sql } from "drizzle-orm";
import { check, index, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { slotlySchema } from "./namespace";

export const mailDeliveryLimits = slotlySchema.table("mail_delivery_limits", {
  key: varchar("key", { length: 64 }).primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [index("mail_delivery_limits_expiry").on(t.expiresAt),
  check("mail_delivery_limits_key", sql`${t.key} ~ '^[a-f0-9]{64}$'`),
  check("mail_delivery_limits_count", sql`${t.count} between 1 and 1000000`),
  check("mail_delivery_limits_expiry_finite", sql`isfinite(${t.expiresAt})`),
]);
