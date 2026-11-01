import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/database";
import { fixture, insertCompleteBooking } from "../helpers/domain";
import { transaction } from "../helpers/database";
import { inspectDatabase } from "../../src/server/operations/diagnostics";
import { loadEnvironment } from "../../scripts/lib/environment";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase({ restricted: true }); });
afterAll(async () => { await database?.close(); });

it("runs as a non-owner without elevated attributes, membership or DDL capabilities", async () => {
  const role = (await database.pool.query(`select r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
    exists(select 1 from pg_auth_members where member=r.oid) as membership,
    exists(select 1 from pg_class where relnamespace='slotly'::regnamespace and relowner=r.oid) as owns
    from pg_roles r where rolname=current_user`)).rows[0];
  expect(Object.values(role).every(value => value === false)).toBe(true);
  expect((await inspectDatabase({ ...loadEnvironment(), DATABASE_URL: database.pool.options.connectionString! }, [])).privilegedRole).toBe(false);
  for (const sql of [
    "CREATE TABLE slotly.forbidden (id int)", "CREATE TABLE public.forbidden (id int)",
    "CREATE TEMP TABLE forbidden (id int)", "CREATE SCHEMA forbidden", "CREATE ROLE slotly_forbidden",
    "ALTER TABLE slotly.bookings DISABLE TRIGGER ALL", "TRUNCATE slotly.booking_events",
    "ALTER TABLE slotly.occupancies DROP CONSTRAINT occupancies_no_overlap",
    "DELETE FROM drizzle.__drizzle_migrations", "SET session_replication_role=replica",
  ]) await expect(database.pool.query(sql)).rejects.toMatchObject({ code: "42501" });
  const owner = (await database.migrationPool!.query("select current_user as name")).rows[0].name;
  await expect(database.pool.query(`SET ROLE "${owner}"`)).rejects.toMatchObject({ code: "42501" });
});

it("keeps booking snapshots and history append-only even through direct application SQL", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, client => insertCompleteBooking(client, f));
  for (const sql of [
    `UPDATE slotly.bookings SET guest_name='changed' WHERE id='${saved.booking.id}'`,
    `DELETE FROM slotly.bookings WHERE id='${saved.booking.id}'`,
    `UPDATE slotly.booking_events SET actor='system' WHERE booking_id='${saved.booking.id}'`,
    `DELETE FROM slotly.booking_events WHERE booking_id='${saved.booking.id}'`,
    `DELETE FROM slotly.occupancies WHERE id='${saved.occupancy.id}'`,
  ]) await expect(database.pool.query(sql)).rejects.toMatchObject({ code: "42501" });
  expect((await database.pool.query("select count(*)::int as n from slotly.notification_outbox where event_id in (select id from slotly.booking_events where booking_id=$1)", [saved.booking.id])).rows[0].n).toBe(2);
});

it("requires an explicit grant for newly migrated tables and functions", async () => {
  await database.migrationPool!.query("CREATE TABLE slotly.future_private (id int); CREATE FUNCTION slotly.future_private_fn() RETURNS int LANGUAGE sql AS 'select 1'");
  await expect(database.pool.query("select * from slotly.future_private")).rejects.toMatchObject({ code: "42501" });
  await expect(database.pool.query("select slotly.future_private_fn()")).rejects.toMatchObject({ code: "42501" });
});
