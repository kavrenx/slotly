import { getAuth } from "@/modules/identity/server";
import { handleVerificationRequest } from "@/modules/identity/http";
import { getIdentityEnv } from "@/server/config/env";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleVerificationRequest(getAuth(), request, getIdentityEnv().APP_URL);
}
