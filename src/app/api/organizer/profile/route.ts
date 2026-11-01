import { getAuth } from "@/modules/identity/server";
import { AuthenticationRequired, IdentityUnavailable, getOrganizerContext } from "@/modules/organizers/access";
import { getDatabase } from "@/server/db/client";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return Response.json(await getOrganizerContext(getAuth(), getDatabase(), request.headers), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AuthenticationRequired) return Response.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (error instanceof IdentityUnavailable) return Response.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    throw error;
  }
}
