import "server-only";
import { getIdentityEnv } from "../config/env";
import { createMailDelivery } from "./delivery";
import { withMailBudget } from "./limits";
import { getDatabase } from "../db/client";

const globalMail = globalThis as typeof globalThis & { slotlyMail?: ReturnType<typeof createMailDelivery> };
export function getMailDelivery() {
  const env = getIdentityEnv();
  if (globalMail.slotlyMail) return globalMail.slotlyMail;
  const raw = createMailDelivery(env.MAIL_CONFIG, env.APP_URL);
  return globalMail.slotlyMail = env.MAIL_TRANSPORT === "smtp" ? withMailBudget(raw, getDatabase(), env.BETTER_AUTH_SECRET, env.MAIL_BUDGET) : raw;
}
