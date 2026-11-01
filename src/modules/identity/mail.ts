import type { LocalMail } from "../../server/mail/local";
export type AuthMail = LocalMail & { actionUrl: string };
