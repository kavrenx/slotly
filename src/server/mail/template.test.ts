import { expect, it } from "vitest";
import { mailAction, renderMailHtml } from "./template";
import { renderLocalMailbox } from "./view";
import type { LocalMail } from "./local";

const message: LocalMail = { to: "guest@example.invalid", subject: "Встреча подтверждена", text: "Текстовая версия", actionUrl: "https://slotly.example/manage#token=test-only",
  presentation: { heading: "Встреча подтверждена", details: [{ label: "Название", value: '<img src=x onerror="alert(1)"> & встреча' }], actionLabel: "Управлять встречей", notes: ["Личная ссылка"], reference: "Номер записи: test-only" } };
it("escapes every user-controlled text value and keeps a private fragment only on the action", () => {
  const html = renderMailHtml(message, "https://slotly.example");
  expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; встреча");
  expect(html).not.toContain("<img"); expect(html).not.toContain("<script");
  expect(html).toContain('href="https://slotly.example/manage#token=test-only"');
  expect(html.match(/test-only/g)).toHaveLength(2); // one action plus the harmless reference
  expect(html).toContain('role="presentation"'); expect(html).not.toMatch(/<link|<style|url\(/u);
});
it.each(["javascript:alert(1)", "https://foreign.example/manage", "https://user:pass@slotly.example/manage", "https://slotly.example/api/delete"])("does not turn an unsafe action into an HTML link: %s", action => {
  expect(mailAction(action, "https://slotly.example")).toBeNull();
  expect(renderMailHtml({ ...message, actionUrl: action }, "https://slotly.example")).not.toContain('href="');
});
it("renders the same safe presentation in the local mailbox and retains plain text", () => {
  const html = renderLocalMailbox([{ ...message, createdAt: "2026-11-04T10:00:00Z" }], "https://slotly.example");
  expect(html).toContain("mail-action"); expect(html).toContain("Текстовая версия");
  expect(html).toContain("10:00 UTC"); expect(html).not.toContain("2026-11-04T10:00:00Z");
  expect(html).not.toContain("<img");
});
it("also formats legacy/plain messages and escapes OTP and heading content", () => {
  expect(renderMailHtml({ to: "g@example.invalid", subject: "Old <title>", text: "Plain <body>" }, "https://slotly.example")).toContain("Plain &lt;body&gt;");
  expect(renderMailHtml({ ...message, presentation: { heading: "<script>", code: "123456" } }, "https://slotly.example")).toContain("123456");
});
