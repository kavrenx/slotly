import { loadEnvironment } from "./lib/environment";
import { parseIdentityEnv } from "../src/server/config/schema";
import { createMailDelivery } from "../src/server/mail/delivery";

// Configuration + SMTP handshake/auth only. Never send a test email implicitly.
try {
  loadEnvironment();
  const env = parseIdentityEnv(process.env), mail = createMailDelivery(env.MAIL_CONFIG, env.APP_URL);
  try {
    await mail.verify();
    console.log(env.MAIL_TRANSPORT === "local" ? "Используется локальная почта; внешние соединения не выполнялись." : "SMTP: соединение, TLS и аутентификация проверены. Письмо не отправлялось.");
  } finally { mail.close(); }
} catch {
  console.error("Проверка почты не пройдена. Проверьте MAIL_TRANSPORT и SMTP-настройки; реквизиты и ответы сервера скрыты."); process.exitCode = 1;
}
