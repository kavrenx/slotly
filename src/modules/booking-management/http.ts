import type { OrganizerAuth } from "../identity/auth";
import { AuthenticationRequired, getOrganizerContext } from "../organizers/access";
import { spendGuestLimit, GuestRateLimit } from "../guest-booking/limits";
import { readLimitedBody } from "../../server/security/body";
import { DomainError, validate } from "../../shared/domain-error";
import { guestCancelInput, guestRescheduleInput, managementSlotsInput } from "./contract";
import { changeBooking, getGuestBooking, getManagedBooking, getRescheduleSlots, type ManagementDependencies } from "./service";

export type ManagementOperation = "read" | "slots" | "cancel" | "reschedule";
function respond(body: unknown, status = 200, retryAfter?: number) { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } }); }
async function body(request: Request, appUrl: string) {
  if (request.headers.get("origin") !== appUrl) throw new DomainError("INVALID_ORIGIN", 403);
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new DomainError("JSON_REQUIRED", 415);
  const text = await readLimitedBody(request, 8192); if (text === null) throw new DomainError("BODY_TOO_LARGE", 413);
  try { return JSON.parse(text) as unknown; } catch { throw new DomainError("INVALID_INPUT"); }
}
function failure(error: unknown) {
  if (error instanceof GuestRateLimit) return respond({ code: error.code, retryAfter: error.retryAfter }, error.status, error.retryAfter);
  if (error instanceof DomainError) return respond({ code: error.code }, error.status);
  if (error instanceof AuthenticationRequired) return respond({ code: "AUTHENTICATION_REQUIRED" }, 401);
  console.error("[booking-management] Операция недоступна; чувствительные детали скрыты.");
  return respond({ code: "SERVICE_UNAVAILABLE" }, 503);
}
export async function handleGuestManagement(deps: ManagementDependencies, request: Request, operation: ManagementOperation, appUrl: string) {
  try {
    if (request.method !== "POST") return respond({ code: "METHOD_NOT_ALLOWED" }, 405);
    const input = await body(request, appUrl);
    // Loopback deployment only. Forwarding headers never establish a trusted IP.
    const limit = await spendGuestLimit(deps.database, deps.secret, "management-ip:127.0.0.1", 120, 600, (deps.clock ?? (() => new Date()))()); if (limit) throw limit;
    if (operation === "read") return respond(await getGuestBooking(deps, input));
    if (operation === "slots") { const { token, ...query } = validate(managementSlotsInput, input); return respond(await getRescheduleSlots(deps, { kind: "guest", token }, query)); }
    if (operation === "cancel") { const { token, ...command } = validate(guestCancelInput, input); return respond(await changeBooking(deps, { kind: "guest", token }, "cancel", command)); }
    const { token, ...command } = validate(guestRescheduleInput, input); return respond(await changeBooking(deps, { kind: "guest", token }, "reschedule", command));
  } catch (error) { return failure(error); }
}
export async function handleOrganizerBooking(deps: ManagementDependencies & { auth: OrganizerAuth; appUrl: string }, request: Request, id: string, operation: "read" | "cancel") {
  try {
    if (request.method !== (operation === "read" ? "GET" : "POST")) return respond({ code: "METHOD_NOT_ALLOWED" }, 405);
    const input = operation === "cancel" ? await body(request, deps.appUrl) : undefined;
    const owner = await getOrganizerContext(deps.auth, deps.database, request.headers);
    const actor = { kind: "organizer" as const, organizerId: owner.id, bookingId: id };
    return respond(operation === "read" ? await getManagedBooking(deps, actor) : await changeBooking(deps, actor, "cancel", input));
  } catch (error) { return failure(error); }
}
