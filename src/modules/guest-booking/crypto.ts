import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export function guestDigest(secret: string, purpose: string, value: string) {
  return createHmac("sha256", secret).update(`slotly-guest/${purpose}/v1\0${value}`).digest("hex");
}
export function codeDigest(secret: string, id: string, code: string) { return guestDigest(secret, "code-check", `${id}\0${code}`); }
export function checkCode(secret: string, id: string, code: string, expected: string) {
  const actual = Buffer.from(codeDigest(secret, id, code), "hex"); const stored = Buffer.from(expected, "hex");
  return stored.length === actual.length && timingSafeEqual(actual, stored);
}
const encryptionKey = (secret: string) => Buffer.from(guestDigest(secret, "encryption-key", "otp"), "hex");
export function issueCode(secret: string, id: string) {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv); cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return { codeHash: codeDigest(secret, id, code), sealedCode: [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".") };
}
// Encrypted short-lived retry material lets a failed delivery retry the same code.
export function openCode(secret: string, id: string, sealed: string) {
  const parts = sealed.split("."); if (parts.length !== 3) throw new Error("Invalid sealed OTP");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(parts[0]!, "base64url"));
  decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(Buffer.from(parts[1]!, "base64url"));
  const code = Buffer.concat([decipher.update(Buffer.from(parts[2]!, "base64url")), decipher.final()]).toString("utf8");
  if (!/^[0-9]{6}$/u.test(code)) throw new Error("Invalid sealed OTP"); return code;
}
