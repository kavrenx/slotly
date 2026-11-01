import { getAuth } from "@/modules/identity/server";
import { handleIdentityRequest } from "@/modules/identity/http";
import { getIdentityEnv } from "@/server/config/env";
import { getDatabase } from "@/server/db/client";
import { guardIdentityMailRequest } from "@/server/mail/limits";
import { clientIpBucket } from "@/server/security/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(request: Request) {
  const env = getIdentityEnv();
  return handleIdentityRequest(getAuth(), request, env.APP_URL, env.MAIL_TRANSPORT === "smtp" ? {
    beforeMailRequest: (recipient, clientIp) => guardIdentityMailRequest(getDatabase(), env.BETTER_AUTH_SECRET, recipient, clientIpBucket(clientIp)),
  } : {});
}
export { handler as GET, handler as POST };
