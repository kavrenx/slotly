import { expect, it, vi } from "vitest";
import { handleGuestBooking } from "./http";
import type { GuestBookingDependencies } from "./service";

it("rejects missing trusted proxy identity before touching the database or sending a code", async () => {
  vi.stubEnv("CLIENT_IP_HEADER", "x-slotly-proxy-ip");
  try {
    const query = vi.fn(), sendMail = vi.fn();
    const deps = { database: { select: query }, secret: "test-secret", sendMail } as unknown as GuestBookingDependencies;
    const response = await handleGuestBooking(deps, new Request("https://slotly.example/api/guest-bookings/test/code", {
      method: "POST", headers: { origin: "https://slotly.example", "content-type": "application/json", "x-forwarded-for": "203.0.113.1" }, body: "{}",
    }), "test", "code", "https://slotly.example");
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "CLIENT_IP_UNAVAILABLE" });
    expect(query).not.toHaveBeenCalled(); expect(sendMail).not.toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); }
});
