import type { LocalMail } from "./local";
import { escapeMailHtml as escape, mailAction, renderMailBody } from "./template";

export function renderLocalMailbox(messages: LocalMail[], appUrl: string) {
  const html = messages.map(message => {
    const action = mailAction(message.actionUrl, appUrl);
    const allowed = action !== null;
    const label = action?.pathname === "/manage" ? "Управлять встречей" : action?.pathname.startsWith("/dashboard/bookings/") ? "Открыть запись" : "Открыть ссылку";
    const at = message.createdAt && Number.isFinite(Date.parse(message.createdAt)) ? new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(message.createdAt)) + " UTC" : "";
    return `<article><div class="meta"><span>${escape(message.to)}</span><time>${escape(at)}</time></div>${message.presentation ? `<div style="margin-top:20px">${renderMailBody(message, appUrl)}</div><details><summary>Текстовая версия</summary><p>${escape(message.text)}</p></details>` : `<h2>${escape(message.subject)}</h2><p>${escape(message.text)}</p>${allowed ? `<a class="action" href="${escape(action.toString())}">${label}<span aria-hidden="true"> →</span></a>` : ""}`}</article>`;
  }).join("");
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Slotly — локальная почта</title><style>
  *{box-sizing:border-box}body{font:15px/1.7 system-ui;background:#f7f7f2;color:#192b27;max-width:840px;margin:48px auto;padding:0 24px}
  header{margin-bottom:32px}.brand{font-size:20px;font-weight:650;color:#246750}h1{font-size:32px;line-height:1.2;letter-spacing:-.04em;margin:20px 0 12px}header p{color:#596b63}
  article{background:#fffefa;border:1px solid #d7ddd2;border-radius:20px;padding:28px;margin:20px 0;overflow-wrap:anywhere}
  h2{font-size:21px;line-height:1.4;letter-spacing:-.02em;margin:20px 0}p{white-space:pre-wrap;overflow-wrap:anywhere}
  a{color:#246750}.meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:12px;color:#596b63}
  .action{display:inline-flex;gap:12px;background:#246750;color:#fff;padding:11px 18px;border-radius:12px;text-decoration:none;font-weight:550;min-height:44px}
  a:focus-visible{outline:3px solid #246750;outline-offset:4px}.action:hover{background:#1c533f}
  @media(max-width:480px){body{margin:28px auto;padding:0 16px}article{padding:20px}h1{font-size:28px}h2{font-size:19px}}
  </style><header><div class="brand">Slotly / почта</div><h1>Письма о ваших встречах</h1><p>Локальный просмотрщик: письма не отправляются наружу.<br>Последние 50 сообщений · <a href="/">Обновить</a></p></header>${html || "<p>Писем пока нет.</p>"}</html>`;
}
