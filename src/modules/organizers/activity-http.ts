import type { Database } from "../../server/db/types";
import type { OrganizerAuth } from "../identity/auth";
import { AuthenticationRequired, getOrganizerContext } from "./access";
import { getOrganizerActivity } from "./dashboard-service";

export async function handleActivityRequest(deps: { database: Database; auth: OrganizerAuth }, request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const owner = await getOrganizerContext(deps.auth, deps.database, request.headers);
    return Response.json({ items: await getOrganizerActivity(deps.database, owner.id) }, { headers });
  } catch (error) {
    if (error instanceof AuthenticationRequired) return Response.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401, headers });
    console.error("[activity] Не удалось загрузить события; данные скрыты.");
    return Response.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}
