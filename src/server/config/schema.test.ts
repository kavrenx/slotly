import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./schema";

const valid = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://slotly:local-test-password@127.0.0.1:54329/slotly",
  DATABASE_SSL: "disable",
};

describe("server environment", () => {
  it("accepts the local setup", () => {
    expect(parseServerEnv(valid).NODE_ENV).toBe("development");
  });

  it.each(["APP_URL", "DATABASE_URL", "DATABASE_SSL"])("requires %s", (key) => {
    expect(() => parseServerEnv({ ...valid, [key]: undefined })).toThrow(key);
  });

  it.each([
    "https://slotly:secret@example.com/slotly",
    "postgresql://slotly@localhost/slotly",
    "postgresql://slotly:secret@localhost/",
    "postgresql://slotly:replace-with-local-password@localhost/slotly",
    "postgresql://slotly:secret@localhost/slotly?sslmode=no-verify",
    "postgresql://slotly:secret@localhost/slotly?sslcert=unsafe",
  ])("rejects invalid or ambiguous database configuration", (DATABASE_URL) => {
    expect(() => parseServerEnv({ ...valid, DATABASE_URL })).toThrow();
  });

  it("does not expose invalid secret values in errors", () => {
    const secret = "private-database-credential";
    try {
      parseServerEnv({ ...valid, DATABASE_URL: secret });
      expect.fail("Expected validation failure");
    } catch (error) {
      expect(String(error)).toContain("DATABASE_URL");
      expect(String(error)).not.toContain(secret);
    }
  });

  it("requires TLS for an external production database", () => {
    expect(() => parseServerEnv({ ...valid, NODE_ENV: "production", APP_URL: "https://slotly.example", DATABASE_URL: "postgresql://slotly:secret@db.example/slotly" })).toThrow("DATABASE_SSL");
  });

  it("accepts verified production TLS", () => {
    expect(parseServerEnv({ ...valid, NODE_ENV: "production", APP_URL: "https://slotly.example", DATABASE_URL: "postgresql://slotly:secret@db.example/slotly", DATABASE_SSL: "verify-full" }).DATABASE_SSL).toBe("verify-full");
  });

  it("rejects a public production HTTP origin", () => {
    expect(() => parseServerEnv({ ...valid, NODE_ENV: "production", APP_URL: "http://slotly.example" })).toThrow("APP_URL");
  });

  it("reports malformed production origins without leaking their values", () => {
    expect(() => parseServerEnv({ ...valid, NODE_ENV: "production", APP_URL: "private-invalid-origin" })).toThrow("APP_URL");
  });

  it.each(["javascript:alert(1)", "https://user:secret@slotly.example", "https://slotly.example/path", "https://slotly.example?token=secret"])("rejects unsafe app origins", (APP_URL) => {
    expect(() => parseServerEnv({ ...valid, APP_URL })).toThrow("APP_URL");
  });
});
