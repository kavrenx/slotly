import type { LocalMail } from "../../server/mail/local";
export type AuthMail = LocalMail & { actionUrl: string };
export { sendLocalMail as sendLocalAuthMail } from "../../server/mail/local";
