import { defineConfig } from "drizzle-kit";
import { loadDatabaseEnvironment } from "./scripts/lib/database-environment";

const env = loadDatabaseEnvironment("migration");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  schemaFilter: ["slotly"],
  dbCredentials: {
    url: env.DATABASE_URL,
    ssl: env.DATABASE_SSL === "verify-full" ? { rejectUnauthorized: true } : false,
  },
  strict: true,
  verbose: false,
});
