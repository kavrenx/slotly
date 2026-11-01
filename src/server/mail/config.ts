import { z } from "zod";

const smtp = z.object({
  SMTP_HOST: z.string().min(1).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/iu),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_SECURITY: z.enum(["tls", "starttls"]),
  SMTP_USER: z.string().min(1).max(254).regex(/^[^\r\n\0]+$/u),
  SMTP_PASSWORD: z.string().min(1).max(1024).regex(/^[^\r\n\0]+$/u),
  MAIL_FROM: z.email().max(254),
});
export type MailConfig = { transport: "local" } | ({ transport: "smtp" } & z.infer<typeof smtp>);

export function parseMailConfig(input: Record<string, string | undefined>, appUrl: string): MailConfig {
  const app = new URL(appUrl);
  if (input.MAIL_TRANSPORT === "local") {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)) throw new Error("MAIL_TRANSPORT: локальная доставка разрешена только для loopback APP_URL");
    return { transport: "local" };
  }
  if (input.MAIL_TRANSPORT !== "smtp") throw new Error("MAIL_TRANSPORT: выберите local или smtp");
  if (app.protocol !== "https:") throw new Error("APP_URL: SMTP-доставка требует HTTPS-ссылок приложения");
  const result = smtp.safeParse(input);
  if (!result.success) throw new Error(`Ошибка конфигурации почты: ${[...new Set(result.error.issues.map(issue => issue.path[0]))].join(", ")}; значения скрыты`);
  return { transport: "smtp", ...result.data };
}
