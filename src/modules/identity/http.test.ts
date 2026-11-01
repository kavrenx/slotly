import { expect, it, vi } from "vitest";
import { handleIdentityRequest, handleVerificationRequest, readLimitedBody } from "./http";
import type { OrganizerAuth } from "./auth";
import { MailBudgetExceeded } from "../../server/mail/limits";

it("enforces a byte limit without trusting content-length", async () => {
  const request = new Request("http://localhost", { method: "POST", body: "я".repeat(20) });
  expect(await readLimitedBody(request, 30)).toBeNull();
});

it("limits normalized mail requests before account lookup and preserves Retry-After", async () => {
  const handler = vi.fn(async () => Response.json({ ok: true }));
  const auth = { handler } as unknown as OrganizerAuth;
  const guard = vi.fn(async () => { throw new MailBudgetExceeded(60); });
  const request = new Request("http://localhost:3000/api/auth/request-password-reset", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ email: " Guest@Example.invalid " }) });
  const response = await handleIdentityRequest(auth, request, "http://localhost:3000", { beforeMailRequest: guard });
  expect(guard).toHaveBeenCalledWith("guest@example.invalid", "127.0.0.1"); expect(handler).not.toHaveBeenCalled();
  expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("60");
});

it("replaces caller supplied auth IP headers with the verified proxy address", async () => {
  vi.stubEnv("CLIENT_IP_HEADER", "x-slotly-proxy-ip");
  try {
    let actual: Headers | undefined;
    const auth = { handler: async (request: Request) => { actual = request.headers; return Response.json({ ok: true }); } } as unknown as OrganizerAuth;
    const response = await handleIdentityRequest(auth, new Request("https://slotly.example/api/auth/get-session", { headers: { "x-slotly-proxy-ip": "203.0.113.8", "x-slotly-client-ip": "192.0.2.3", "x-forwarded-for": "192.0.2.4" } }), "https://slotly.example");
    expect(response.status).toBe(200); expect(actual!.get("x-slotly-client-ip")).toBe("203.0.113.8"); expect(actual!.get("x-forwarded-for")).toBeNull();
  } finally { vi.unstubAllEnvs(); }
});

it("does not present a verification service outage as an invalid token", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const auth = { handler: async () => { throw new Error("private-token"); } } as unknown as OrganizerAuth;
    const response = await handleVerificationRequest(auth, new Request("http://localhost:3000/api/identity/verify-email", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ token: "test-token" }),
    }), "http://localhost:3000");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-token");
  } finally { log.mockRestore(); }
});

it("does not return or log credentials from unexpected authentication failures", async () => {
  const secret = "private-session-token";
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const handler = { handler: async () => { throw new Error(secret); } } as unknown as OrganizerAuth;
    const response = await handleIdentityRequest(handler, new Request("http://localhost:3000/api/auth/sign-out", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: "{}",
    }), "http://localhost:3000");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(secret);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  } finally { log.mockRestore(); }
});
