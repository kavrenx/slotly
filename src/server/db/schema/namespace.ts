import { pgSchema, timestamp } from "drizzle-orm/pg-core";

export const slotlySchema = pgSchema("slotly");
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
