import type { OrganizerAuth } from "./auth";
import { readLimitedBody } from "../../server/security/body";
import { resolveClientIp } from "../../server/security/client-ip";
import { MailBudgetExceeded } from "../../server/mail/limits";
import { emailInput } from "./validation";
export { readLimitedBody } from "../../server/security/body";

export async function handleIdentityRequest(auth: OrganizerAuth, request: Request, appUrl: string, options: { beforeMailRequest?: (recipient: string, clientIp: string) => Promise<void> } = {}) {
  if (request.method === "POST" && request.headers.get("origin") !== appUrl) {
    return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  }
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 16_384) return Response.json({ code: "BODY_TOO_LARGE" }, { status: 413 });
  const headers = new Headers(request.headers);
  let ip: string;
  try { ip = resolveClientIp(request.headers, appUrl); }
  catch { return Response.json({ code: "CLIENT_IP_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  // Only the application can populate Better Auth's internal trusted header.
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");
  headers.delete("forwarded");
  headers.set("x-slotly-client-ip", ip);
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
  let path = "";
  try { path = decodeURIComponent(new URL(request.url).pathname).replace(/^\/api\/auth/u, "").replace(/\/+$/u, ""); } catch { /* Better Auth rejects invalid paths. */ }
  if (body && options.beforeMailRequest && ["/sign-up/email", "/request-password-reset", "/send-verification-email"].includes(path)) {
    let recipient: unknown;
    try { recipient = (JSON.parse(body) as { email?: unknown }).email; } catch { /* Better Auth validates malformed JSON. */ }
    const parsed = emailInput.safeParse(typeof recipient === "string" ? recipient.trim().toLowerCase() : recipient);
    if (parsed.success) {
      try { await options.beforeMailRequest(parsed.data, ip); }
      catch (error) {
        if (error instanceof MailBudgetExceeded) return Response.json({ code: "TOO_MANY_REQUESTS" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfter) } });
        return Response.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    }
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
