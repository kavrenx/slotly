import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { getServerEnv } from "../config/env";
import { createDatabasePool } from "./connection";
import * as schema from "./schema";

const globalDatabase = globalThis as typeof globalThis & {
  slotlyPool?: ReturnType<typeof createDatabasePool>;
};

export function getDatabase() {
  const pool = globalDatabase.slotlyPool ?? createDatabasePool(getServerEnv());
  globalDatabase.slotlyPool = pool;
  return drizzle(pool, { schema });
}
