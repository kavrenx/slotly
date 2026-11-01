import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createTestDatabase, transaction } from "../helpers/database";
import { fixture, insertCompleteBooking } from "../helpers/domain";
import { maintainExpiredData } from "../../src/server/operations/retention";

let test: Awaited<ReturnType<typeof createTestDatabase>>, f: Awaited<ReturnType<typeof fixture>>;
const now = new Date("2027-01-03T10:00:00Z"), day = 86_400_000;
beforeAll(async () => {
  test = await createTestDatabase({ restricted: true }); f = await fixture(test.pool);
  await transaction(test.pool, client => insertCompleteBooking(client, f));
});
beforeEach(async () => {
  for (const table of ["guest_challenges", "guest_rate_limits", "mail_delivery_limits", "auth_sessions", "auth_verifications", "auth_rate_limits"]) await test.pool.query(`delete from slotly.${table}`);
});
afterAll(async () => { await test?.close(); });
async function seed() {
  const variants = [{ name: "old", expiry: new Date(now.getTime() - 2 * day) }, { name: "boundary", expiry: new Date(now.getTime() - day) },
    { name: "recent", expiry: new Date(now.getTime() - 60_000) }, { name: "active", expiry: new Date(now.getTime() + day) }];
  for (const [i, v] of variants.entries()) {
    const key = String(i + 1).repeat(64);
    await test.pool.query(`insert into slotly.auth_sessions (id,token,user_id,expires_at) values ($1,$2,$3,$4)`, [v.name, randomUUID(), f.organizer.userId, v.expiry]);
    await test.pool.query("insert into slotly.auth_verifications (id,identifier,value,expires_at) values ($1,$2,'test-token',$3)", [v.name, `${v.name}@example.invalid`, v.expiry]);
    await test.pool.query("insert into slotly.auth_rate_limits (id,key,count,last_request) values ($1,$1,1,$2)", [v.name, v.expiry.getTime()]);
    for (const table of ["guest_rate_limits", "mail_delivery_limits"]) await test.pool.query(`insert into slotly.${table} (key,count,expires_at) values ($1,1,$2)`, [key, v.expiry]);
    await test.pool.query(`insert into slotly.guest_challenges (id,request_id,request_hash,organizer_id,page_id,guest_name,guest_email,guest_timezone,start_at,end_at,quote,code_hash,sealed_code,created_at,expires_at)
      values ($1,$2,$3,$4,$5,'Private guest','guest@example.invalid','Europe/Minsk','2027-01-04T10:00:00Z','2027-01-04T10:30:00Z','{}',$3,'test-sealed',$6,$7)`,
    [randomUUID(), randomUUID(), "a".repeat(64), f.organizer.id, f.page.id, new Date(v.expiry.getTime() - 300_000), v.expiry]);
  }
}
it("previews all eligible auxiliary data without changing rows or printing contacts", async () => {
  await seed();
  const result = await maintainExpiredData(test.pool, { now });
  expect(result).toMatchObject({ status: "ok", applied: false, counts: { guestChallenges: 1, guestLimits: 1, mailLimits: 1, authSessions: 1, authVerifications: 1, authLimits: 1 } });
  expect((await test.pool.query("select count(*)::int as n from slotly.auth_sessions")).rows[0].n).toBe(4);
  expect(JSON.stringify(result)).not.toContain("guest@example.invalid"); expect(JSON.stringify(result)).not.toContain("test-token");
});
it("preserves live data, the grace boundary, accounts, bookings, occupancies, history and delivery snapshots", async () => {
  await seed();
  const tables = ["auth_users", "auth_accounts", "organizers", "bookings", "occupancies", "booking_events", "notification_outbox"];
  const snapshot = async () => Promise.all(tables.map(async table => (await test.pool.query(`select to_jsonb(t) as row from slotly.${table} t order by id`)).rows));
  const before = await snapshot();
  const result = await maintainExpiredData(test.pool, { now, apply: true });
  expect(result.applied).toBe(true); expect(Object.values(result.counts!)).toEqual([1, 1, 1, 1, 1, 1]);
  expect((await test.pool.query("select id from slotly.auth_sessions order by id")).rows.map(row => row.id)).toEqual(["active", "boundary", "recent"]);
  expect(await snapshot()).toEqual(before);
  expect(Object.values((await maintainExpiredData(test.pool, { now, apply: true })).counts!).every(count => count === 0)).toBe(true);
});
it("bounds deletion per table and validates the requested batch size", async () => {
  await test.pool.query("insert into slotly.mail_delivery_limits(key,count,expires_at) select lpad(to_hex(i),64,'0'),1,'2026-01-01T00:00:00Z' from generate_series(1,35) i");
  expect((await maintainExpiredData(test.pool, { now, apply: true, batchSize: 10 })).counts!.mailLimits).toBe(10);
  expect((await test.pool.query("select count(*)::int as n from slotly.mail_delivery_limits")).rows[0].n).toBe(25);
  for (const batchSize of [0, -1, 1001, 1.5]) await expect(maintainExpiredData(test.pool, { batchSize })).rejects.toThrow("INVALID_MAINTENANCE_BATCH");
});
it("rolls back earlier cleanup steps if a later table cannot be cleaned", async () => {
  await seed();
  await test.adminPool.query("create table slotly.retention_blocker(session_id text references slotly.auth_sessions(id)); insert into slotly.retention_blocker values ('old')");
  try { await expect(maintainExpiredData(test.pool, { now, apply: true })).rejects.toMatchObject({ code: "23503" }); }
  finally { await test.adminPool.query("drop table slotly.retention_blocker"); }
  expect((await test.pool.query("select count(*)::int as n from slotly.guest_challenges")).rows[0].n).toBe(4);
  expect((await test.pool.query("select count(*)::int as n from slotly.mail_delivery_limits")).rows[0].n).toBe(4);
});
it("skips rows being refreshed by another transaction and keeps them after renewal", async () => {
  await seed(); const holding = await test.pool.connect();
  try {
    await holding.query("begin"); await holding.query("select id from slotly.auth_sessions where id='old' for update");
    expect((await maintainExpiredData(test.pool, { now, apply: true })).counts!.authSessions).toBe(0);
    await holding.query("update slotly.auth_sessions set expires_at=$1 where id='old'", [new Date(now.getTime() + day)]); await holding.query("commit");
    expect((await maintainExpiredData(test.pool, { now, apply: true })).counts!.authSessions).toBe(0);
  } finally { await holding.query("rollback"); holding.release(); }
});
it("does not run a second maintenance transaction while its advisory lock is held", async () => {
  await seed(); const holding = await test.pool.connect();
  try {
    await holding.query("begin"); await holding.query("select pg_advisory_xact_lock(hashtextextended('slotly:retention:v1',0))");
    expect(await maintainExpiredData(test.pool, { now, apply: true })).toMatchObject({ status: "busy", applied: false, counts: null });
    expect((await test.pool.query("select count(*)::int as n from slotly.auth_sessions")).rows[0].n).toBe(4);
  } finally { await holding.query("rollback"); holding.release(); }
});
