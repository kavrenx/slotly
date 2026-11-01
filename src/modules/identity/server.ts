import "server-only";
import { getIdentityEnv } from "../../server/config/env";
import { getDatabase } from "../../server/db/client";
import { createOrganizerAuth } from "./auth";
import { sendLocalAuthMail } from "./mail";

const globalIdentity = globalThis as typeof globalThis & { slotlyAuth?: ReturnType<typeof createOrganizerAuth> };
export function getAuth() {
  return globalIdentity.slotlyAuth ??= createOrganizerAuth(getDatabase(), getIdentityEnv(), sendLocalAuthMail);
}
