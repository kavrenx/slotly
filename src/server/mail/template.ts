import type { LocalMail } from "./local";

export type MailPresentation = {
  heading: string;
  intro?: string;
  code?: string;
  details?: { label: string; value: string }[];
  actionLabel?: string;
  notes?: string[];
  reference?: string;
};
export const escapeMailHtml = (text: string) => text.replace(/[&<>"']/gu, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

export function mailAction(url: string | undefined, appUrl: string) {
  if (!url || !URL.canParse(url)) return null;
  const action = new URL(url), origin = new URL(appUrl);
  return ["http:", "https:"].includes(action.protocol) && action.origin === origin.origin && !action.username && !action.password &&
    (["/verify-email", "/reset-password", "/manage"].includes(action.pathname) || /^\/dashboard\/bookings\/[a-f0-9-]{36}$/u.test(action.pathname)) ? action : null;
}

/** Structured text only: callers cannot inject arbitrary HTML or remote assets. */
export function renderMailBody(message: LocalMail, appUrl: string) {
  const p = message.presentation ?? { heading: message.subject, intro: message.text };
  const escape = escapeMailHtml, action = mailAction(message.actionUrl, appUrl);
  const paragraph = (value: string, style = "") => `<p style="margin:0 0 16px;font-size:14px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;${style}">${escape(value)}</p>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;color:#192b27;text-align:left"><tr><td style="padding:28px 24px;background:#fffefa;border:1px solid #d7ddd2;border-radius:18px">
<p style="margin:0 0 26px;font-size:23px;font-weight:bold;color:#246750">Slotly</p>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.3;font-weight:600;overflow-wrap:anywhere">${escape(p.heading)}</h1>
${p.intro ? paragraph(p.intro, "color:#52655e") : ""}
${p.code ? `<p style="margin:22px 0;padding:18px 14px;background:#eef3e8;border:1px solid #d7ddd2;border-radius:12px;text-align:center;font-size:30px;letter-spacing:8px;font-weight:bold;color:#246750">${escape(p.code)}</p>` : ""}
${p.details?.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;border-collapse:collapse;background:#f3f5ed;border-radius:12px">${p.details.map(row => `<tr><td style="padding:10px 16px;vertical-align:top"><p style="margin:0 0 4px;font-size:11px;color:#52655e">${escape(row.label)}</p><p style="margin:0;font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere">${escape(row.value)}</p></td></tr>`).join("")}</table>` : ""}
${action ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td style="background:#246750;border-radius:10px"><a class="mail-action" href="${escape(action.toString())}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 20px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;line-height:1.4">${escape(p.actionLabel ?? "Открыть ссылку")}</a></td></tr></table>` : ""}
${(p.notes ?? []).map(note => paragraph(note, "font-size:12px;color:#52655e")).join("")}
${p.reference ? paragraph(p.reference, "font-size:10px;color:#52655e;border-top:1px solid #d7ddd2;padding-top:16px") : ""}
<p style="margin:24px 0 0;font-size:11px;line-height:1.8;color:#52655e">Создаём с уважением к вашему времени.<br>Your time. Your rules.</p>
</td></tr></table>`;
}

export function renderMailHtml(message: LocalMail, appUrl: string) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeMailHtml(message.subject)}</title></head><body style="margin:0;padding:24px 12px;background:#f7f7f2"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px"><tr><td>${renderMailBody(message, appUrl)}</td></tr></table></td></tr></table></body></html>`;
}
