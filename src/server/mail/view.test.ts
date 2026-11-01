import { expect, it } from "vitest";
import { renderLocalMailbox } from "./view";

it("escapes message content and only offers actions on known same-origin routes", () => {
  const mailbox = renderLocalMailbox([
    { to: "<img>@example.invalid", subject: "<script>attack()</script>", text: "<a href='https://foreign.invalid'>fake</a>", actionUrl: "https://foreign.invalid/manage" },
    { to: "g@example.invalid", subject: "Private link", text: "Details", actionUrl: "http://localhost:3000/manage#token=test" },
    { to: "g@example.invalid", subject: "Unsafe", text: "Details", actionUrl: "http://user:pass@localhost:3000/manage" },
    { to: "g@example.invalid", subject: "Unknown path", text: "Details", actionUrl: "http://localhost:3000/api/delete" },
    { to: "g@example.invalid", subject: "Unsafe protocol", text: "Details", actionUrl: "javascript:alert(1)" },
  ], "http://localhost:3000");
  expect(mailbox).toContain("&lt;script&gt;"); expect(mailbox).not.toContain("<script>");
  expect(mailbox.match(/class="action"/gu)).toHaveLength(1);
  expect(mailbox).toContain('href="http://localhost:3000/manage#token=test"');
  expect(mailbox).toContain("Управлять встречей");
});
