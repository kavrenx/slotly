import { describe, expect, it } from "vitest";
import { parseIdentityEnv } from "./schema";

const valid = { APP_URL: "http://localhost:3000", DATABASE_URL: "postgresql://slotly:local-password@127.0.0.1:54329/slotly",
  DATABASE_SSL: "disable", BETTER_AUTH_SECRET: "local-test-secret-with-more-than-32-characters", MAIL_TRANSPORT: "local" };
describe("identity configuration", () => {
  it("accepts a local interceptor", () => { expect(parseIdentityEnv(valid).MAIL_TRANSPORT).toBe("local"); });
  it.each([undefined, "short", "replace-with-random-secret"])("rejects missing or weak secrets without echoing them", (secret) => {
    try { parseIdentityEnv({ ...valid, BETTER_AUTH_SECRET: secret }); throw new Error("Expected rejection"); }
    catch (error) { expect(String(error)).toContain("BETTER_AUTH_SECRET"); if (secret) expect(String(error)).not.toContain(secret); }
  });
  it("does not enable local delivery on a public host", () => {
    expect(() => parseIdentityEnv({ ...valid, APP_URL: "https://slotly.example" })).toThrow("MAIL_TRANSPORT");
  });
});
