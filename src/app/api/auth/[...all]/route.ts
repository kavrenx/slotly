import { getAuth } from "@/modules/identity/server";
import { handleIdentityRequest } from "@/modules/identity/http";
import { getIdentityEnv } from "@/server/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(request: Request) {
  return handleIdentityRequest(getAuth(), request, getIdentityEnv().APP_URL);
}
export { handler as GET, handler as POST };
