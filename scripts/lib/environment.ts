import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseServerEnv } from "../../src/server/config/schema";

// @next/env is CommonJS. Explicit require works in both tsx ESM and Drizzle's
// CommonJS config loader, without relying on synthetic named/default exports.
const nextEnv = createRequire(resolve("package.json"))("@next/env") as typeof import("@next/env");

export function loadEnvironment(mode?: "development" | "test" | "production") {
  const nodeEnv = mode ?? process.env.NODE_ENV;
  nextEnv.loadEnvConfig(process.cwd(), nodeEnv !== "production");
  return parseServerEnv({ ...process.env, NODE_ENV: nodeEnv });
}
