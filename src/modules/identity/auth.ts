import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../server/db/schema";
import type { IdentityEnv } from "../../server/config/schema";
import type { AuthMail } from "./mail";
import { getPasswordIssues, organizerName } from "./validation";
import { identity } from "../../i18n/messages/ru/identity";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { MailBudgetExceeded } from "../../server/mail/limits";

export function createOrganizerAuth(database: NodePgDatabase<typeof schema>, env: IdentityEnv, sendMail: (message: AuthMail) => Promise<void>) {
  async function deliver(message: AuthMail) {
    try { await sendMail(message); }
    catch (error) {
      // Public verification/reset responses must not reveal account existence
      // through an outbound budget that only known recipients would consume.
      if (!(error instanceof MailBudgetExceeded)) throw error;
      console.warn("[identity] Письмо не отправлено: достигнут лимит почты; данные скрыты.");
    }
  }
  function name(value: unknown) {
    const parsed = organizerName.safeParse(value);
    if (!parsed.success) throw new APIError("BAD_REQUEST", { code: "INVALID_NAME", message: "Имя должно содержать от 1 до 100 символов." });
    return parsed.data;
  }
  function actionUrl(path: string, token: string) {
    const url = new URL(path, env.APP_URL);
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
  }
  return betterAuth({
    appName: "Slotly",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(database, {
      provider: "pg", transaction: true, schemaName: "slotly",
      schema: { user: schema.authUsers, session: schema.authSessions, account: schema.authAccounts, verification: schema.authVerifications, rateLimit: schema.authRateLimits },
    }),
    emailAndPassword: {
      enabled: true, autoSignIn: false, requireEmailVerification: true,
      minPasswordLength: 10, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true, resetPasswordTokenExpiresIn: 1800,
      async sendResetPassword({ user, token }) {
        await deliver({ to: user.email, subject: "Восстановление доступа к Slotly",
          text: "Чтобы задать новый пароль, откройте ссылку. Она действует 30 минут. Если вы не запрашивали смену пароля, проигнорируйте письмо.",
          presentation: { heading: "Восстановим доступ", intro: "Задайте новый пароль для аккаунта организатора Slotly.", actionLabel: "Задать новый пароль", notes: ["Ссылка действует 30 минут. После смены пароля потребуется войти заново.", "Если вы не запрашивали смену пароля, проигнорируйте письмо."] },
          actionUrl: actionUrl("/reset-password", token) });
      },
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: false, expiresIn: 3600,
      async sendVerificationEmail({ user, token }) {
        await deliver({ to: user.email, subject: "Подтвердите почту для Slotly",
          text: "Подтвердите адрес, чтобы войти в Slotly. Ссылка действует один час.",
          presentation: { heading: "Подтвердите вашу почту", intro: "Остался один шаг, чтобы начать организовывать встречи в Slotly.", actionLabel: "Подтвердить почту", notes: ["Ссылка действует один час. Если вы не создавали аккаунт, проигнорируйте это письмо."] },
          actionUrl: actionUrl("/verify-email", token) });
      },
    },
    session: { expiresIn: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60, cookieCache: { enabled: false } },
    verification: { storeIdentifier: "hashed" },
    account: { accountLinking: { enabled: false } },
    user: { deleteUser: { enabled: false }, changeEmail: { enabled: false } },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const path = context.path.replace(/\/+$/, "");
        const field = path === "/sign-up/email" ? "password"
          : ["/reset-password", "/change-password", "/set-password"].includes(path) ? "newPassword" : null;
        const candidate = field ? context.body?.[field] : undefined;
        if (typeof candidate === "string") {
          const issue = getPasswordIssues(candidate)[0];
          if (issue) throw new APIError("BAD_REQUEST", { code: issue, message: identity.errors[issue] ?? identity.genericError });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: { before: async (user) => ({ data: { ...user, name: name(user.name) } }) },
        update: { before: async (user) => ({ data: { ...user, ...(user.name !== undefined ? { name: name(user.name) } : {}) } }) },
      },
    },
    rateLimit: {
      enabled: true, storage: "database", window: 60, max: 100,
      customRules: {
        "/sign-up/email": { window: 60, max: 5 },
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
        "/verify-email": { window: 60, max: 10 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "slotly",
      useSecureCookies: new URL(env.APP_URL).protocol === "https:",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      // The stage-3 HTTP adapter sets this header itself. Client headers are ignored.
      ipAddress: { ipAddressHeaders: ["x-slotly-client-ip"], ipv6Subnet: 64 },
    },
    logger: {
      level: "warn",
      log() { console.error("[identity] Ошибка службы входа; чувствительные детали скрыты."); },
    },
  });
}

export type OrganizerAuth = ReturnType<typeof createOrganizerAuth>;
