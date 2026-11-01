import type { Database } from "../../server/db/types";
import { DomainError } from "../../shared/domain-error";
import { getPublicAvailability } from "./public-service";

export async function handlePublicAvailability(database: Database, request: Request, publicId: string, now = new Date()) {
  const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "GET") return response({ code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    if (request.url.length > 2048) throw new DomainError("INVALID_INPUT");
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new DomainError("INVALID_INPUT");
    return response(await getPublicAvailability(database, publicId, Object.fromEntries(params), now));
  } catch (error) {
    if (error instanceof DomainError) return response({ code: error.code }, error.status);
    console.error("[availability] Не удалось рассчитать доступность; чувствительные детали скрыты.");
    return response({ code: "SERVICE_UNAVAILABLE" }, 503);
  }
}
