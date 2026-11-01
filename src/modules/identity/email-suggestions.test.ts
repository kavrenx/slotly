import { expect, it } from "vitest";
import { completeEmailDomain, emailFieldError } from "./email-suggestions";

it("appends or replaces the domain without changing the entered mailbox name", () => {
  expect(completeEmailDomain("First.Last+slotly", "gmail.com")).toBe("First.Last+slotly@gmail.com");
  expect(completeEmailDomain("  tim@yan  ", "yandex.ru")).toBe("tim@yandex.ru");
  expect(completeEmailDomain("tim@mail.ru", "outlook.com")).toBe("tim@outlook.com");
  expect(completeEmailDomain("tim@@broken", "gmail.com")).toBe("tim@gmail.com");
  expect(completeEmailDomain(" ", "mail.ru")).toBe(null);
  expect(completeEmailDomain("@gmail.com", "mail.ru")).toBe(null);
});
it("matches server email validation, including incomplete domains and interior whitespace", () => {
  expect(emailFieldError(" ")).toBe("required");
  expect(emailFieldError("  Tim+slotly@GMAIL.COM  ")).toBe(null);
  for (const email of ["tim", "tim@", "tim@gmail", "tim@@gmail.com", "ti m@gmail.com"]) expect(emailFieldError(email)).toBe("invalid");
});
