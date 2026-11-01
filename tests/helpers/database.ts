import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool, PoolClient } from "pg";
import { loadEnvironment } from "../../scripts/lib/environment";
import { createDatabasePool } from "../../src/server/db/connection";

export async function createTestDatabase() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env = loadEnvironment();
  const url = new URL(env.DATABASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || env.NODE_ENV === "production") {
    throw new Error("Integration tests require a local, non-production PostgreSQL server.");
  }
  const name = `slotly_test_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabasePool(env);
  url.pathname = `/${name}`;
  const pool = createDatabasePool({ ...env, DATABASE_URL: url.toString() });
  let created = false;
  async function close() {
    await pool.end();
    try {
      if (created && /^slotly_test_[a-f0-9]{32}$/.test(name)) {
        await admin.query(`DROP DATABASE "${name}"`);
      }
    } finally {
      await admin.end();
    }
  }
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    await migrate(drizzle(pool), { migrationsFolder: resolve("drizzle") });
    return { pool, close };
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
