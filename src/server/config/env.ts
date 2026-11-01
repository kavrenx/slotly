import "server-only";
import { parseIdentityEnv, parseServerEnv } from "./schema";

export function getServerEnv() {
  return parseServerEnv(process.env);
}

export function getIdentityEnv() {
  return parseIdentityEnv(process.env);
}
