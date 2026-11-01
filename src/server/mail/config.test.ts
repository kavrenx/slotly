import { expect, it } from "vitest";
import { parseMailConfig } from "./config";

const valid = { MAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.example.invalid", SMTP_PORT: "587", SMTP_SECURITY: "starttls", SMTP_USER: "slotly", SMTP_PASSWORD: "private-password", MAIL_FROM: "noreply@example.invalid" };
it("requires explicit encrypted SMTP settings and an HTTPS application origin", () => {
  expect(parseMailConfig(valid, "https://slotly.example")).toMatchObject({ transport: "smtp", SMTP_PORT: 587 });
  expect(parseMailConfig({ ...valid, SMTP_PORT: "465", SMTP_SECURITY: "tls" }, "https://slotly.example")).toMatchObject({ SMTP_SECURITY: "tls" });
  expect(() => parseMailConfig(valid, "http://localhost:3000")).toThrow("APP_URL");
  expect(() => parseMailConfig({ MAIL_TRANSPORT: "local" }, "https://slotly.example")).toThrow("MAIL_TRANSPORT");
  expect(parseMailConfig({ MAIL_TRANSPORT: "local" }, "http://localhost:3000")).toEqual({ transport: "local" });
});
it.each(["SMTP_HOST", "SMTP_PORT", "SMTP_SECURITY", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM"])("rejects missing %s without exposing secret input", field => {
  try { parseMailConfig({ ...valid, [field]: undefined }, "https://slotly.example"); expect.fail("Expected invalid config"); }
  catch (error) { expect(String(error)).toContain(field); expect(String(error)).not.toContain(valid.SMTP_PASSWORD); }
});
it.each([
  { SMTP_HOST: "smtp://user:password@host/?tls=false" }, { SMTP_HOST: "host/path" },
  { SMTP_PORT: "0" }, { SMTP_PORT: "65536" }, { SMTP_SECURITY: "plain" },
  { SMTP_USER: "user\r\nAUTH" }, { SMTP_PASSWORD: "secret\ncommand" },
  { MAIL_FROM: "a@example.invalid,b@example.invalid" }, { MAIL_FROM: "a@example.invalid\r\nBcc: other@example.invalid" },
])("rejects ambiguous servers, plaintext mode and header injection", override => {
  expect(() => parseMailConfig({ ...valid, ...override }, "https://slotly.example")).toThrow();
});
