import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDatabase } from "../../server/db/client";
import { getServerEnv } from "../../server/config/env";
import { getAuth } from "../identity/server";
import { AuthenticationRequired, getOrganizerContext } from "./access";
import { handlePlanningRequest, type PlanningResource } from "./planning-http";

// Memoization is scoped to one server render. No cross-user session cache.
export const requireOrganizer = cache(async () => {
  try { return await getOrganizerContext(getAuth(), getDatabase(), await headers()); }
  catch (error) { if (error instanceof AuthenticationRequired) redirect("/login"); throw error; }
});
export function planningRoute(request: Request, resource: PlanningResource) {
  return handlePlanningRequest({ database: getDatabase(), auth: getAuth(), appUrl: getServerEnv().APP_URL }, request, resource);
}
