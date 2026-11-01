import type { GuestBookingDependencies } from "./service";
import { confirmGuestBooking, requestGuestCode } from "./service";
import { GuestRateLimit } from "./limits";
import { DomainError } from "../../shared/domain-error";
import { readLimitedBody } from "../../server/security/body";

export async function handleGuestBooking(deps: GuestBookingDependencies, request: Request, publicId: string, operation: "code" | "confirm", appUrl: string) {
  const reply = (body: unknown, status = 200, retryAfter?: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
  try {
    if (request.method !== "POST") return reply({ code: "METHOD_NOT_ALLOWED" }, 405);
    if (request.headers.get("origin") !== appUrl) throw new DomainError("INVALID_ORIGIN", 403);
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new DomainError("JSON_REQUIRED", 415);
    const text = await readLimitedBody(request, 8192); if (text === null) throw new DomainError("BODY_TOO_LARGE", 413);
    let input: unknown; try { input = JSON.parse(text); } catch { throw new DomainError("INVALID_INPUT"); }
    // Local-only deployment: never trust client forwarding headers. Real proxy
    // trust and per-recipient delivery budgets must be configured before a pilot.
    return reply(operation === "code" ? await requestGuestCode(deps, publicId, input, "127.0.0.1") : await confirmGuestBooking(deps, publicId, input, "127.0.0.1"));
  } catch (error) {
    if (error instanceof GuestRateLimit) return reply({ code: error.code, retryAfter: error.retryAfter }, error.status, error.retryAfter);
    if (error instanceof DomainError) return reply({ code: error.code }, error.status);
    console.error("[guest-booking] Операция недоступна; чувствительные детали скрыты.");
    return reply({ code: "SERVICE_UNAVAILABLE" }, 503);
  }
}
