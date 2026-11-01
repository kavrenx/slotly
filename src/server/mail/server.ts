import "server-only";
import { getIdentityEnv } from "../config/env";
import { createMailDelivery } from "./delivery";

const globalMail = globalThis as typeof globalThis & { slotlyMail?: ReturnType<typeof createMailDelivery> };
export function getMailDelivery() {
  const env = getIdentityEnv();
  return globalMail.slotlyMail ??= createMailDelivery(env.MAIL_CONFIG, env.APP_URL);
}
