import "server-only";
import { getDatabase } from "../../server/db/client";
import { getIdentityEnv } from "../../server/config/env";
import { getAuth } from "../identity/server";
import { handleGuestManagement, handleOrganizerBooking, type ManagementOperation } from "./http";

export function managementDependencies() { const env = getIdentityEnv(); return { database: getDatabase(), secret: env.BETTER_AUTH_SECRET }; }
export function guestManagementRoute(request: Request, operation: ManagementOperation) {
  return handleGuestManagement(managementDependencies(), request, operation, getIdentityEnv().APP_URL);
}
export function organizerBookingRoute(request: Request, id: string, operation: "read" | "cancel") {
  return handleOrganizerBooking({ ...managementDependencies(), auth: getAuth(), appUrl: getIdentityEnv().APP_URL }, request, id, operation);
}
