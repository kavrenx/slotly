import { expect, it, vi } from "vitest";
import { handleIdentityRequest, handleVerificationRequest, readLimitedBody } from "./http";
import type { OrganizerAuth } from "./auth";

it("enforces a byte limit without trusting content-length", async () => {
  const request = new Request("http://localhost", { method: "POST", body: "я".repeat(20) });
  expect(await readLimitedBody(request, 30)).toBeNull();
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
