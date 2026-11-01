import { describe, expect, it } from "vitest";
import { pastedGuestCode } from "./code-paste";

describe("guest code paste", () => {
  it("accepts six digits, including leading zeroes and formatting whitespace", () => {
    expect(pastedGuestCode("001234")).toBe("001234");
    expect(pastedGuestCode("\n001 234\u00a0")).toBe("001234");
  });
  it("does not silently shorten long codes or extract codes from unrelated text", () => {
    for (const text of ["12345", "1234567", "Код: 123456", "123-456", "１２３４５６", ""]) {
      expect(pastedGuestCode(text)).toBeNull();
    }
  });
});
