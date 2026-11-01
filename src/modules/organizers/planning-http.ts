import type { Database } from "../../server/db/types";
import { readLimitedBody } from "../../server/security/body";
import { DomainError } from "../../shared/domain-error";
import { planning } from "../../i18n/messages/ru/planning";
import type { OrganizerAuth } from "../identity/auth";
import { getSchedule, saveSchedule } from "../availability/service";
import { changePageState, createPage, getPage, listPages, updatePage } from "../booking-pages/service";
import { AuthenticationRequired, getOrganizerContext } from "./access";

export type PlanningResource = { kind: "schedule" } | { kind: "pages" } | { kind: "page"; id: string } | { kind: "state"; id: string };
export async function handlePlanningRequest(deps: { database: Database; auth: OrganizerAuth; appUrl: string }, request: Request, resource: PlanningResource) {
  const respond = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
  try {
    const allowed = resource.kind === "schedule" || resource.kind === "page" ? ["GET", "PUT"] : resource.kind === "pages" ? ["GET", "POST"] : ["POST"];
    if (!allowed.includes(request.method)) return respond({ code: "METHOD_NOT_ALLOWED" }, 405);
    const writing = request.method !== "GET";
    if (writing && request.headers.get("origin") !== deps.appUrl) throw new DomainError("INVALID_ORIGIN", 403);
    if (writing && request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new DomainError("JSON_REQUIRED", 415);
    const owner = await getOrganizerContext(deps.auth, deps.database, request.headers);
    let input: unknown;
    if (writing) {
      const body = await readLimitedBody(request, 65_536);
      if (body === null) throw new DomainError("BODY_TOO_LARGE", 413);
      try { input = JSON.parse(body); } catch { throw new DomainError("INVALID_INPUT"); }
    }
    const db = deps.database;
    if (resource.kind === "schedule") return respond(writing ? await saveSchedule(db, owner.id, input) : await getSchedule(db, owner.id));
    if (resource.kind === "pages") return respond(writing ? await createPage(db, owner.id, input) : await listPages(db, owner.id), writing ? 201 : 200);
    if (resource.kind === "page") return respond(writing ? await updatePage(db, owner.id, resource.id, input) : await getPage(db, owner.id, resource.id));
    return respond(await changePageState(db, owner.id, resource.id, input));
  } catch (error) {
    if (error instanceof DomainError) return respond({ code: error.code, message: planning.errors[error.code] }, error.status);
    if (error instanceof AuthenticationRequired) return respond({ code: "AUTHENTICATION_REQUIRED" }, 401);
    console.error("[planning] Операция недоступна; чувствительные детали скрыты.");
    return respond({ code: "SERVICE_UNAVAILABLE" }, 503);
  }
}
