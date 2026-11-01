import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool, PoolClient } from "pg";
import { loadDatabaseEnvironment } from "../../scripts/lib/database-environment";
import { createDatabasePool } from "../../src/server/db/connection";
import { configureDatabaseAccess, createDatabaseLogin } from "../../src/server/db/privileges";

export async function createTestDatabase(options: { restricted?: boolean } = {}) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env = loadDatabaseEnvironment("admin");
  const url = new URL(env.DATABASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || env.NODE_ENV === "production") {
    throw new Error("Integration tests require a local, non-production PostgreSQL server.");
  }
  const name = `slotly_test_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabasePool(env);
  url.pathname = `/${name}`;
  const adminPool = createDatabasePool({ ...env, DATABASE_URL: url.toString() });
  let pool = adminPool, migrationPool: Pool | undefined;
  const roles: string[] = [];
  let created = false;
  async function close() {
    await pool.end();
    if (pool !== adminPool) await adminPool.end();
    await migrationPool?.end();
    try {
      if (created && /^slotly_test_[a-f0-9]{32}$/.test(name)) {
        await admin.query(`DROP DATABASE "${name}"`);
      }
      for (const role of roles.reverse()) {
        if (!/^slotly_test_(app|migrate)_[a-f0-9]{32}$/u.test(role)) throw new Error("Unsafe test role");
        await admin.query(`DROP ROLE "${role}"`);
      }
    } finally {
      await admin.end();
    }
  }
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    if (options.restricted) {
      const suffix = randomUUID().replaceAll("-", "");
      const migrationRole = `slotly_test_migrate_${suffix}`, applicationRole = `slotly_test_app_${suffix}`;
      const migrationPassword = randomBytes(32).toString("hex"), applicationPassword = randomBytes(32).toString("hex");
      await createDatabaseLogin(admin, migrationRole, migrationPassword); roles.push(migrationRole);
      await createDatabaseLogin(admin, applicationRole, applicationPassword); roles.push(applicationRole);
      await admin.query(`GRANT CONNECT, CREATE ON DATABASE "${name}" TO "${migrationRole}"`);
      const migrationUrl = new URL(url); migrationUrl.username = migrationRole; migrationUrl.password = migrationPassword;
      migrationPool = createDatabasePool({ ...env, DATABASE_URL: migrationUrl.toString() });
      await migrate(drizzle(migrationPool), { migrationsFolder: resolve("drizzle") });
      await configureDatabaseAccess(adminPool, migrationRole, applicationRole);
      const applicationUrl = new URL(url); applicationUrl.username = applicationRole; applicationUrl.password = applicationPassword;
      pool = createDatabasePool({ ...env, DATABASE_URL: applicationUrl.toString() });
    } else await migrate(drizzle(pool), { migrationsFolder: resolve("drizzle") });
    return { pool, adminPool, migrationPool, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function postgresError(error: unknown): { code?: string; constraint?: string } {
  if (error && typeof error === "object" && "cause" in error && error.cause) {
    return postgresError(error.cause);
  }
  return error as { code?: string; constraint?: string };
}
