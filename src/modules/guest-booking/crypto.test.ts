import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { checkCode, guestDigest, issueCode, openCode } from "./crypto";
import { confirmBookingInput, requestCodeInput } from "./contract";

it("generates six random digits, stores no plaintext, and verifies only this challenge", () => {
  const secret = randomBytes(32).toString("hex"); const id = randomUUID(); const issued = issueCode(secret, id);
  const code = openCode(secret, id, issued.sealedCode);
  expect(code).toMatch(/^[0-9]{6}$/u); expect(issued.codeHash).toHaveLength(64);
  expect(checkCode(secret, id, code, issued.codeHash)).toBe(true);
  expect(checkCode(secret, randomUUID(), code, issued.codeHash)).toBe(false);
  expect(checkCode(secret + "changed", id, code, issued.codeHash)).toBe(false);
  expect(checkCode(secret, id, code, "invalid")).toBe(false);
  expect(() => openCode(secret, randomUUID(), issued.sealedCode)).toThrow();
  expect(() => openCode(secret + "changed", id, issued.sealedCode)).toThrow();
  expect(guestDigest(secret, "rate-key", "guest@example.invalid")).not.toBe(guestDigest(secret, "request", "guest@example.invalid"));
});
it.each(["12345", "1234567", "１２３４５６", "123456\n", "123 45"])("rejects malformed codes: %s", (code) => {
  expect(confirmBookingInput.safeParse({ challengeId: randomUUID(), code }).success).toBe(false);
});
it("normalizes contact input but rejects forged rules and non-minute instants", () => {
  const input = { requestId: randomUUID(), name: " Гость ", email: " GUEST@EXAMPLE.INVALID ", timezone: "Europe/Minsk", startAt: "2027-01-04T09:00:00.000Z", endAt: "2027-01-04T09:30:00.000Z" };
  expect(requestCodeInput.parse(input)).toMatchObject({ name: "Гость", email: "guest@example.invalid" });
  expect(requestCodeInput.safeParse({ ...input, durationMinutes: 5 }).success).toBe(false);
  expect(requestCodeInput.safeParse({ ...input, startAt: "2027-01-04T09:00:00.001Z" }).success).toBe(false);
  expect(requestCodeInput.safeParse({ ...input, endAt: input.startAt }).success).toBe(false);
});
