import { getAuth } from "@/modules/identity/server";
import { getDatabase } from "@/server/db/client";
import { handleActivityRequest } from "@/modules/organizers/activity-http";

export async function GET(request: Request) {
  return handleActivityRequest({ auth: getAuth(), database: getDatabase() }, request);
}
