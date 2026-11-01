import { z } from "zod";

const isLoopback = (hostname: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

const databaseUrl = z.string().min(1).superRefine((value, ctx) => {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        !url.hostname || !url.username || !url.password || url.pathname.length < 2) {
      ctx.addIssue({ code: "custom", message: "Нужен PostgreSQL URL с пользователем, паролем и именем базы" });
    }
    for (const key of url.searchParams.keys()) {
      if (key.toLowerCase().startsWith("ssl")) {
        ctx.addIssue({ code: "custom", message: "TLS настраивается через DATABASE_SSL, а не параметры URL" });
      }
    }
    if (decodeURIComponent(url.password) === "replace-with-local-password") {
      ctx.addIssue({ code: "custom", message: "Выполните npm run setup или задайте собственный пароль" });
    }
  } catch {
    ctx.addIssue({ code: "custom", message: "Некорректный PostgreSQL URL" });
  }
});

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().superRefine((value, ctx) => {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
          url.pathname !== "/" || url.search || url.hash) {
        ctx.addIssue({ code: "custom", message: "Нужен HTTP(S) origin без пути, параметров и секретов" });
      }
    } catch {
      ctx.addIssue({ code: "custom", message: "Нужен HTTP(S) origin без пути, параметров и секретов" });
    }
  }),
  DATABASE_URL: databaseUrl,
  DATABASE_SSL: z.enum(["disable", "verify-full"]),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== "production") return;
  if (!URL.canParse(value.APP_URL) || !URL.canParse(value.DATABASE_URL)) return;
  const app = new URL(value.APP_URL);
  if (app.protocol !== "https:" && !isLoopback(app.hostname)) {
    ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "Публичное production-приложение требует HTTPS" });
  }
  if (value.DATABASE_SSL === "disable" && !isLoopback(new URL(value.DATABASE_URL).hostname)) {
    ctx.addIssue({ code: "custom", path: ["DATABASE_SSL"], message: "Внешняя production-база требует проверяемого TLS" });
  }
});

export type ServerEnv = z.infer<typeof schema>;

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Report field names and controlled messages only; never values or Zod input.
    throw new Error(`Ошибка конфигурации: ${result.error.issues.map(
      (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
    ).join("; ")}`);
  }
  return result.data;
}

export function parseIdentityEnv(input: Record<string, string | undefined>) {
  const base = parseServerEnv(input);
  const secret = input.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32 || secret === "replace-with-random-secret") {
    throw new Error("BETTER_AUTH_SECRET: нужен случайный секрет не короче 32 символов; выполните npm run setup");
  }
  if (input.MAIL_TRANSPORT !== "local") {
    throw new Error("MAIL_TRANSPORT: на этом этапе поддерживается только локальный перехватчик");
  }
  if (!isLoopback(new URL(base.APP_URL).hostname)) {
    throw new Error("MAIL_TRANSPORT: локальная доставка разрешена только для loopback APP_URL");
  }
  return { ...base, BETTER_AUTH_SECRET: secret, MAIL_TRANSPORT: "local" as const };
}

export type IdentityEnv = ReturnType<typeof parseIdentityEnv>;
