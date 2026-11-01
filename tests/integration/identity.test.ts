import { randomBytes, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import * as schema from "../../src/server/db/schema";
import { parseIdentityEnv } from "../../src/server/config/schema";
import { createOrganizerAuth, type OrganizerAuth } from "../../src/modules/identity/auth";
import { handleIdentityRequest, handleVerificationRequest } from "../../src/modules/identity/http";
import type { AuthMail } from "../../src/modules/identity/mail";
import { AuthenticationRequired, getOrganizerContext } from "../../src/modules/organizers/access";
import { createTestDatabase } from "../helpers/database";
import { loadEnvironment } from "../../scripts/lib/environment";
import { hashPassword } from "better-auth/crypto";

const origin = "http://localhost:3000";
const password = "Local-test-password-47";
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let auth: OrganizerAuth;
const mails: AuthMail[] = [];

beforeAll(async () => {
  database = await createTestDatabase({ restricted: true });
  const env = parseIdentityEnv({ ...loadEnvironment(), NODE_ENV: "test", APP_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), MAIL_TRANSPORT: "local" });
  auth = createOrganizerAuth(drizzle(database.pool, { schema }), env, async (message) => { mails.push(message); });
});
beforeEach(async () => { mails.length = 0; await database.pool.query("DELETE FROM slotly.auth_rate_limits"); });
afterAll(async () => { await database?.close(); });

function request(path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request(origin + "/api/auth" + path, { method: "POST",
    headers: { origin, "content-type": "application/json", ...extraHeaders }, body: JSON.stringify(body) });
}
function post(path: string, body: unknown, extraHeaders?: Record<string, string>) {
  return handleIdentityRequest(auth, request(path, body, extraHeaders), origin);
}
function cookie(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
function mailToken(email: string, path: string) {
  const message = [...mails].reverse().find((m) => m.to === email && new URL(m.actionUrl).pathname === path);
  if (!message) throw new Error("Expected intercepted mail");
  const token = new URLSearchParams(new URL(message.actionUrl).hash.slice(1)).get("token");
  if (!token) throw new Error("Expected token in URL fragment");
  return token;
}
function verify(token: string) {
  return handleVerificationRequest(auth, new Request(origin + "/api/identity/verify-email", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token }),
  }), origin);
}
async function register(verified = false) {
  const email = `${randomUUID()}@example.invalid`;
  const response = await post("/sign-up/email", { name: " Test organizer ", email, password });
  expect(response.status).toBe(200);
  if (verified) expect((await verify(mailToken(email, "/verify-email"))).status).toBe(200);
  return { email, response };
}
function context(sessionCookie: string, extra: Record<string, string> = {}) {
  return getOrganizerContext(auth, drizzle(database.pool, { schema }), new Headers({ cookie: sessionCookie, ...extra }));
}

it("creates one organizer atomically and stores a password hash without issuing an unverified session", async () => {
  const { email, response } = await register();
  expect(cookie(response)).not.toContain("session_token");
  const result = await database.pool.query("SELECT u.id,o.display_name,a.password FROM slotly.auth_users u JOIN slotly.organizers o ON o.user_id=u.id JOIN slotly.auth_accounts a ON a.user_id=u.id WHERE u.email=$1", [email]);
  expect(result.rowCount).toBe(1);
  expect(result.rows[0].display_name).toBe("Test organizer");
  expect(result.rows[0].password).not.toBe(password);
  expect(result.rows[0].password.length).toBeGreaterThan(30);
  const message = mails.find((m) => m.to === email);
  expect(new URL(message?.actionUrl ?? "").search).toBe("");
});

it("does not log in before email verification", async () => {
  const { email } = await register();
  expect((await post("/sign-in/email", { email, password })).status).toBe(403);
  await expect(context("")).rejects.toBeInstanceOf(AuthenticationRequired);
});

it("verifies email, logs in, and returns only the current organizer", async () => {
  const a = await register(true);
  const b = await register(true);
  const signedIn = await post("/sign-in/email", { email: a.email, password });
  expect(signedIn.status).toBe(200);
  const sessionCookie = cookie(signedIn);
  expect(signedIn.headers.getSetCookie().some((value) => /httponly/i.test(value) && /samesite=lax/i.test(value))).toBe(true);
  const other = await context(cookie(await post("/sign-in/email", { email: b.email, password })));
  const own = await context(sessionCookie, { "x-organizer-id": other.id });
  expect(own.email).toBe(a.email);
  expect(own.id).not.toBe(other.id);
  expect(Object.keys(own).sort()).toEqual(["displayName", "email", "id"]);
});

it("rejects invalid and forged sessions", async () => {
  await expect(context("slotly.session_token=forged")).rejects.toBeInstanceOf(AuthenticationRequired);
});

it("rejects malformed verification tokens", async () => {
  expect((await verify("tampered-token")).status).toBe(400);
});

it("rejects invalid names without leaving either account or organizer behind", async () => {
  const email = `${randomUUID()}@example.invalid`;
  expect((await post("/sign-up/email", { name: "  ", email, password })).status).toBe(400);
  const result = await database.pool.query("SELECT id FROM slotly.auth_users WHERE email=$1", [email]);
  expect(result.rowCount).toBe(0);
});

it("does not enumerate registered addresses during sign-up or reset requests", async () => {
  const { email } = await register();
  expect((await post("/sign-up/email", { name: "Another name", email, password })).status).toBe(200);
  const known = await post("/request-password-reset", { email });
  const missing = await post("/request-password-reset", { email: `${randomUUID()}@example.invalid` });
  expect(known.status).toBe(missing.status);
  expect(await known.json()).toEqual(await missing.json());
});

it("rejects wrong passwords and logs out by revoking the database session", async () => {
  const { email } = await register(true);
  expect((await post("/sign-in/email", { email, password: "wrong-password" })).status).toBe(401);
  const signedIn = await post("/sign-in/email", { email, password });
  const sessionCookie = cookie(signedIn);
  expect((await context(sessionCookie)).email).toBe(email);
  expect((await post("/sign-out", {}, { cookie: sessionCookie })).status).toBe(200);
  await expect(context(sessionCookie)).rejects.toBeInstanceOf(AuthenticationRequired);
});

it("resets a password once, revokes existing sessions and rejects the old password", async () => {
  const { email } = await register(true);
  const sessionCookie = cookie(await post("/sign-in/email", { email, password }));
  expect((await post("/request-password-reset", { email })).status).toBe(200);
  const token = mailToken(email, "/reset-password");
  const nextPassword = "Different-local-password-93";
  expect((await post("/reset-password", { token, newPassword: nextPassword })).status).toBe(200);
  await expect(context(sessionCookie)).rejects.toBeInstanceOf(AuthenticationRequired);
  expect((await post("/reset-password", { token, newPassword: "Another-local-password-94" })).status).toBe(400);
  expect((await post("/sign-in/email", { email, password })).status).toBe(401);
  expect((await post("/sign-in/email", { email, password: nextPassword })).status).toBe(200);
});

it("rejects expired reset tokens", async () => {
  const { email } = await register(true);
  await post("/request-password-reset", { email });
  const token = mailToken(email, "/reset-password");
  await database.pool.query("UPDATE slotly.auth_verifications SET expires_at=now()-interval '1 minute' WHERE value=(SELECT id FROM slotly.auth_users WHERE email=$1)", [email]);
  expect((await post("/reset-password", { token, newPassword: "Different-local-password-93" })).status).toBe(400);
});

it("does not spend a reset token on a rejected short password", async () => {
  const { email } = await register(true);
  await post("/request-password-reset", { email });
  const token = mailToken(email, "/reset-password");
  expect((await post("/reset-password", { token, newPassword: "short" })).status).toBe(400);
  expect((await post("/reset-password", { token, newPassword: "Different-local-password-93" })).status).toBe(200);
});

it("rejects untrusted origins and oversized bodies before authentication", async () => {
  expect((await post("/sign-up/email", { name: "Test", email: "local@example.invalid", password }, { origin: "https://untrusted.invalid" })).status).toBe(403);
  const response = await post("/sign-up/email", { name: "x".repeat(20_000) });
  expect(response.status).toBe(413);
});

it("enforces database rate limits even with spoofed forwarding headers", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    statuses.push((await post("/sign-in/email", { email: "missing@example.invalid", password },
      { "x-forwarded-for": `192.0.2.${i}`, "x-slotly-client-ip": `192.0.2.${i}` })).status);
  }
  expect(statuses.at(-1)).toBe(429);
  expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
});

it("rolls back the user and profile if credential creation fails", async () => {
  const email = `${randomUUID()}@example.invalid`;
  await database.adminPool.query("ALTER TABLE slotly.auth_accounts ADD CONSTRAINT test_reject_credentials CHECK (provider_id <> 'credential') NOT VALID");
  try {
    const response = await post("/sign-up/email", { name: "Test organizer", email, password });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const users = await database.pool.query("SELECT id FROM slotly.auth_users WHERE email=$1", [email]);
    expect(users.rowCount).toBe(0);
    const orphans = await database.pool.query("SELECT o.id FROM slotly.organizers o LEFT JOIN slotly.auth_users u ON u.id=o.user_id WHERE u.id IS NULL");
    expect(orphans.rowCount).toBe(0);
  } finally { await database.adminPool.query("ALTER TABLE slotly.auth_accounts DROP CONSTRAINT test_reject_credentials"); }
});

it("does not accept a modified signed email token", async () => {
  const { email } = await register();
  const token = mailToken(email, "/verify-email");
  const changed = token.slice(0, -3) + "xyz";
  expect((await verify(changed)).status).toBe(400);
  const result = await database.pool.query("SELECT email_verified FROM slotly.auth_users WHERE email=$1", [email]);
  expect(result.rows[0].email_verified).toBe(false);
});

it("checks session expiry against the database", async () => {
  const { email } = await register(true);
  const sessionCookie = cookie(await post("/sign-in/email", { email, password }));
  await database.pool.query("UPDATE slotly.auth_sessions SET expires_at=now()-interval '1 minute' WHERE user_id=(SELECT id FROM slotly.auth_users WHERE email=$1)", [email]);
  await expect(context(sessionCookie)).rejects.toBeInstanceOf(AuthenticationRequired);
});

it("enforces the same rate limit on concurrent requests", async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    post("/sign-in/email", { email: "missing@example.invalid", password })));
  expect(results.filter((r) => r.status === 401)).toHaveLength(5);
  expect(results.filter((r) => r.status === 429)).toHaveLength(3);
});

it.each(["РусскийПароль123!", "Latin-пароль-47", "LatinPassword47😀"])("rejects non-Latin new passwords through the API", async (candidate) => {
  const email = `${randomUUID()}@example.invalid`;
  const response = await post("/sign-up/email", { name: "Алексей", email, password: candidate });
  expect(response.status).toBe(400);
  expect((await response.json()).code).toBe("INVALID_PASSWORD_CHARACTERS");
  const result = await database.pool.query("SELECT id FROM slotly.auth_users WHERE email=$1", [email]);
  expect(result.rowCount).toBe(0);
});

it("rejects a non-Latin reset without consuming the token or revoking the old session", async () => {
  const { email } = await register(true);
  const sessionCookie = cookie(await post("/sign-in/email", { email, password }));
  await post("/request-password-reset", { email });
  const token = mailToken(email, "/reset-password");
  const rejected = await post("/reset-password", { token, newPassword: "НовыйПароль-47" });
  expect(rejected.status).toBe(400);
  expect((await rejected.json()).code).toBe("INVALID_PASSWORD_CHARACTERS");
  expect((await context(sessionCookie)).email).toBe(email);
  expect((await post("/reset-password", { token, newPassword: "New-latin-password-47" })).status).toBe(200);
});

it("applies the alphabet rule to authenticated password changes", async () => {
  const { email } = await register(true);
  const sessionCookie = cookie(await post("/sign-in/email", { email, password }));
  const response = await post("/change-password", { currentPassword: password, newPassword: "НовыйПароль-47" }, { cookie: sessionCookie });
  expect(response.status).toBe(400);
  expect((await response.json()).code).toBe("INVALID_PASSWORD_CHARACTERS");
  expect((await post("/sign-in/email", { email, password })).status).toBe(200);
});

it.each(["Старый-пароль-47", "11111111111111111111111111111"])("keeps login available for existing accounts with a legacy password", async (legacyPassword) => {
  const userId = randomUUID();
  const email = `${randomUUID()}@example.invalid`;
  const db = drizzle(database.pool);
  await db.insert(schema.authUsers).values({ id: userId, email, name: "Алексей", emailVerified: true });
  await db.insert(schema.authAccounts).values({
    accountId: userId, providerId: "credential", userId, password: await hashPassword(legacyPassword),
  });
  const response = await post("/sign-in/email", { email, password: legacyPassword });
  expect(response.status).toBe(200);
  expect((await context(cookie(response))).email).toBe(email);
});

const rejectedPasswords = [
  ["61803792548201639475", "PASSWORD_CLASSES_REQUIRED"],
  ["aaaaaB7!xyz", "PASSWORD_REPEATED_CHARACTERS"],
] as const;
it.each(rejectedPasswords)("enforces new password policy on sign-up: %s", async (candidate, code) => {
  const email = `${randomUUID()}@example.invalid`;
  const response = await post("/sign-up/email", { name: "Test", email, password: candidate });
  expect(response.status).toBe(400);
  expect((await response.json()).code).toBe(code);
  expect((await database.pool.query("SELECT id FROM slotly.auth_users WHERE email=$1", [email])).rowCount).toBe(0);
  expect(mails).toHaveLength(0);
});
it.each(rejectedPasswords)("rejects a reset without consuming its token or session: %s", async (newPassword, code) => {
  const { email } = await register(true);
  const sessionCookie = cookie(await post("/sign-in/email", { email, password }));
  await post("/request-password-reset", { email });
  const token = mailToken(email, "/reset-password");
  const rejected = await post("/reset-password", { token, newPassword });
  expect(rejected.status).toBe(400);
  expect((await rejected.json()).code).toBe(code);
  expect((await context(sessionCookie)).email).toBe(email);
  expect((await post("/reset-password", { token, newPassword: "Different-local-password-93" })).status).toBe(200);
  await expect(context(sessionCookie)).rejects.toBeInstanceOf(AuthenticationRequired);
});
it.each(rejectedPasswords)("rejects an authenticated password change without modifying credentials: %s", async (newPassword, code) => {
  const { email } = await register(true);
  const sessionCookie = cookie(await post("/sign-in/email", { email, password }));
  const rejected = await post("/change-password", { currentPassword: password, newPassword }, { cookie: sessionCookie });
  expect(rejected.status).toBe(400);
  expect((await rejected.json()).code).toBe(code);
  expect((await context(sessionCookie)).email).toBe(email);
  expect((await post("/sign-in/email", { email, password })).status).toBe(200);
});
