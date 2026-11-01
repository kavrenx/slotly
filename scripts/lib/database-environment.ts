import { existsSync } from "node:fs";
import { parseServerEnv } from "../../src/server/config/schema";
import { loadEnvironment } from "./environment";

// Privileged credentials are loaded only by operator CLIs, never by Next.js.
export function loadDatabaseEnvironment(purpose: "admin" | "migration") {
  const env = loadEnvironment();
  if (existsSync(".env.operations.local")) process.loadEnvFile(".env.operations.local");
  const variable = purpose === "admin" ? "ADMIN_DATABASE_URL" : "MIGRATION_DATABASE_URL";
  return parseServerEnv({ ...env, DATABASE_URL: process.env[variable] || env.DATABASE_URL });
}
