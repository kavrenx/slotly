import { randomUUID } from "node:crypto";
import { createTransport } from "nodemailer";
import { z } from "zod";
import type { MailConfig } from "./config";
import { sendLocalMail, type LocalMail } from "./local";
import { renderMailHtml } from "./template";

export class MailDeliveryError extends Error {
  constructor(readonly code: "MAIL_INVALID" | "MAIL_CONNECTION_FAILED" | "MAIL_DELIVERY_FAILED") { super(code); }
}

export function createMailDelivery(config: MailConfig, appUrl: string, localDirectory?: string) {
  if (config.transport === "local") return {
    sendMail: (message: LocalMail) => sendLocalMail(message, localDirectory),
    verify: async () => {}, close: () => {},
  };
  const origin = new URL(appUrl);
  const transporter = createTransport({
    host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURITY === "tls",
    requireTLS: true, tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", servername: config.SMTP_HOST },
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }, forceAuth: true,
    name: origin.hostname, pool: false, logger: false, debug: false,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 15_000, dnsTimeout: 5000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return {
    async sendMail(message: LocalMail) {
      const id = message.messageId ?? randomUUID();
      if (!z.email().safeParse(message.to).success || /[\r\n\0]/u.test(message.subject) || !/^[a-f0-9-]{36}$/u.test(id) ||
        (message.createdAt && !Number.isFinite(Date.parse(message.createdAt)))) throw new MailDeliveryError("MAIL_INVALID");
      if (message.actionUrl) {
        let action: URL;
        try { action = new URL(message.actionUrl); } catch { throw new MailDeliveryError("MAIL_INVALID"); }
        if (action.origin !== origin.origin || action.username || action.password) throw new MailDeliveryError("MAIL_INVALID");
      }
      try {
        const result = await transporter.sendMail({
          from: { name: "Slotly", address: config.MAIL_FROM }, to: { name: "", address: message.to },
          envelope: { from: config.MAIL_FROM, to: [message.to] }, subject: message.subject,
          text: message.actionUrl && !message.text.includes(message.actionUrl) ? `${message.text}\n\n${message.actionUrl}` : message.text,
          html: renderMailHtml(message, appUrl),
          messageId: `<${id}@${origin.hostname}>`, date: message.createdAt ? new Date(message.createdAt) : new Date(),
        });
        if (result.accepted.length !== 1 || result.rejected.length || result.pending?.length) throw new Error("Not accepted");
      } catch { throw new MailDeliveryError("MAIL_DELIVERY_FAILED"); }
    },
    async verify() { try { await transporter.verify(); } catch { throw new MailDeliveryError("MAIL_CONNECTION_FAILED"); } },
    close: () => transporter.close(),
  };
}
