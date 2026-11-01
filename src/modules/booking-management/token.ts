import { timingSafeEqual } from "node:crypto";
import { guestDigest } from "../guest-booking/crypto";
import { managementToken } from "./contract";

type Identity = { id: string; organizerId: string; guestEmail: string };
// A domain-separated HMAC is an unguessable, deterministic capability. It also
// works for existing bookings and retries without storing plaintext credentials.
export function createManagementToken(secret: string, booking: Identity) {
  const tag = guestDigest(secret, "booking-management-capability", `${booking.id}\0${booking.organizerId}\0${booking.guestEmail}`);
  return `v1.${booking.id}.${tag}`;
}
export function managementBookingId(token: string) { return managementToken.safeParse(token).success ? token.split(".")[1]! : null; }
export function validManagementToken(secret: string, booking: Identity, token: string) {
  const expected = Buffer.from(createManagementToken(secret, booking)); const supplied = Buffer.from(token);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
