import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/database";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => { await database?.close(); });

it("applies the domain schema to a fresh database", async () => {
  const tables = await database.pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'slotly' ORDER BY table_name");
  expect(tables.rows.map((r) => r.table_name)).toEqual([
    "auth_accounts", "auth_rate_limits", "auth_sessions", "auth_users", "auth_verifications",
    "booking_events", "booking_pages", "bookings", "date_overrides", "guest_challenges", "guest_rate_limits", "mail_delivery_limits", "notification_outbox", "occupancies",
    "organizers", "override_windows", "schedules", "weekly_windows",
  ]);
});

it("can repeat all migrations without applying them twice", async () => {
  await migrate(drizzle(database.pool), { migrationsFolder: resolve("drizzle") });
  const result = await database.pool.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations');
  expect(result.rows[0].count).toBe(9);
});

it("uses UTC and installs btree_gist", async () => {
  const timezone = await database.pool.query("SHOW TimeZone");
  expect(timezone.rows[0].TimeZone).toBe("UTC");
  const extensions = await database.pool.query("SELECT extname FROM pg_extension WHERE extname = 'btree_gist'");
  expect(extensions.rowCount).toBe(1);
});
