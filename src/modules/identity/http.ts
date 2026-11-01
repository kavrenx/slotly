import type { OrganizerAuth } from "./auth";
import { readLimitedBody } from "../../server/security/body";
export { readLimitedBody } from "../../server/security/body";

export async function handleIdentityRequest(auth: OrganizerAuth, request: Request, appUrl: string) {
  if (request.method === "POST" && request.headers.get("origin") !== appUrl) {
    return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  }
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 16_384) return Response.json({ code: "BODY_TOO_LARGE" }, { status: 413 });
  const headers = new Headers(request.headers);
  // Local-only auth transport. Public proxy/IP trust must be configured before a pilot.
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  headers.set("x-slotly-client-ip", "127.0.0.1");
  let body: string | undefined;
  if (request.method === "POST") {
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return Response.json({ code: "JSON_REQUIRED" }, { status: 415 });
    }
    const input = await readLimitedBody(request, 16_384);
    if (input === null) return Response.json({ code: "BODY_TOO_LARGE" }, { status: 413 });
    body = input;
    headers.delete("content-length");
  }
  const forwarded = new Request(request.url, { method: request.method, headers, ...(body !== undefined ? { body } : {}) });
  try {
    const response = await auth.handler(forwarded);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    console.error("[identity] Служба входа временно недоступна; детали скрыты.");
    return Response.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function handleVerificationRequest(auth: OrganizerAuth, request: Request, appUrl: string) {
  if (request.headers.get("origin") !== appUrl) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  const body = await readLimitedBody(request, 8192);
  if (body === null) return Response.json({ code: "BODY_TOO_LARGE" }, { status: 413 });
  let token: unknown;
  try { token = (JSON.parse(body) as { token?: unknown }).token; } catch { token = undefined; }
  if (typeof token !== "string" || token.length > 4096) return Response.json({ code: "INVALID_TOKEN" }, { status: 400 });
  const internalUrl = new URL("/api/auth/verify-email", appUrl);
  internalUrl.searchParams.set("token", token);
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const response = await handleIdentityRequest(auth, new Request(internalUrl, { headers }), appUrl);
  return Response.json({ ok: response.ok }, { status: response.status >= 500 ? 503 : response.status === 429 ? 429 : response.ok ? 200 : 400,
    headers: { "Cache-Control": "no-store" } });
}
