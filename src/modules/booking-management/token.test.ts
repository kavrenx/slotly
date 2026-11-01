import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createManagementToken, managementBookingId, validManagementToken } from "./token";
import { guestCancelInput, organizerCancelInput, rescheduleInput } from "./contract";

it("binds a stable capability to the booking, owner, verified email and signing secret", () => {
  const secret = randomBytes(32).toString("hex"); const booking = { id: randomUUID(), organizerId: randomUUID(), guestEmail: "guest@example.invalid" };
  const token = createManagementToken(secret, booking);
  expect(createManagementToken(secret, booking)).toBe(token); expect(managementBookingId(token)).toBe(booking.id); expect(validManagementToken(secret, booking, token)).toBe(true);
  for (const changed of [{ ...booking, id: randomUUID() }, { ...booking, organizerId: randomUUID() }, { ...booking, guestEmail: "other@example.invalid" }]) expect(validManagementToken(secret, changed, token)).toBe(false);
  expect(validManagementToken(secret + "different", booking, token)).toBe(false); expect(validManagementToken(secret, booking, token.slice(0, -1))).toBe(false);
  expect(managementBookingId(`${booking.id}.forged`)).toBeNull();
});
it("requires an organizer explanation and rejects injected identity or status fields", () => {
  const command = { requestId: randomUUID(), version: 1 };
  expect(organizerCancelInput.safeParse({ ...command, reason: "   " }).success).toBe(false);
  expect(organizerCancelInput.parse({ ...command, reason: "  Не смогу провести встречу  " }).reason).toBe("Не смогу провести встречу");
  expect(organizerCancelInput.safeParse({ ...command, reason: "ok", organizerId: randomUUID() }).success).toBe(false);
  expect(guestCancelInput.safeParse({ ...command, token: "bad", status: "cancelled" }).success).toBe(false);
});
it("only accepts finite minute-aligned UTC rescheduling intervals and a bounded version", () => {
  const data = { requestId: randomUUID(), version: 1, startAt: "2027-01-04T10:00:00.000Z", endAt: "2027-01-04T10:30:00.000Z" };
  expect(rescheduleInput.safeParse(data).success).toBe(true);
  for (const changed of [{ ...data, endAt: data.startAt }, { ...data, startAt: "2027-01-04T10:00:01.000Z" }, { ...data, version: 0 }, { ...data, version: 2_147_483_647 }, { ...data, startAt: "2027-01-04T13:00:00.000+03:00" }]) expect(rescheduleInput.safeParse(changed).success).toBe(false);
});
