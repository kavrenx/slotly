import { expect, it } from "vitest";
import { parseMailBudgetPolicy } from "./limits";

it("uses conservative pilot defaults and validates all configurable limits", () => {
  expect(parseMailBudgetPolicy({})).toEqual({ MAIL_MAX_PER_HOUR: 100, MAIL_MAX_PER_DAY: 1000, MAIL_RECIPIENT_MAX_PER_HOUR: 20, MAIL_RECIPIENT_MAX_PER_DAY: 100 });
  for (const value of ["0", "-1", "1.5", "1000001", "private-invalid-setting"]) {
    try { parseMailBudgetPolicy({ MAIL_MAX_PER_HOUR: value }); expect.fail("Expected rejection"); }
    catch (error) { expect(String(error)).toContain("MAIL_MAX_PER_HOUR"); expect(String(error)).not.toContain("private-invalid-setting"); }
  }
});
