import { expect, it } from "vitest";
import { getPasswordIssues, hasAllowedPasswordCharacters, organizerName, passwordInput } from "./validation";

it.each(["Password-123!", "Latin words 47!", Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("")])("accepts printable Latin characters and punctuation", (password) => {
  expect(passwordInput.safeParse(password).success).toBe(true);
});
it.each(["РусскийПароль123!", "Latin-пароль47", "LatinPassword47😀", "LatinPassword47é", "LatinPassword47\n", "LatinPassword47\t", "LatinPassword47\u200b"])("rejects non-ASCII, invisible and control characters", (password) => {
  expect(hasAllowedPasswordCharacters(password)).toBe(false);
  expect(passwordInput.safeParse(password).success).toBe(false);
});
it("preserves the existing length rule", () => {
  expect(passwordInput.safeParse("Abc123!").success).toBe(false);
  expect(passwordInput.safeParse("a".repeat(129)).success).toBe(false);
});
it("continues to accept Russian organizer names", () => {
  expect(organizerName.safeParse("Алексей").success).toBe(true);
});

it.each(["abcDEF1234", "abcDEF!@#$", "abcdef12!#", "ABCDEF12!#"])("accepts any three of the four character classes: %s", (password) => {
  expect(getPasswordIssues(password)).toEqual([]);
  expect(passwordInput.safeParse(password).success).toBe(true);
});
it.each(["12345678901234567890", "lowercase123", "UPPERCASE123", "lowerUPPER", "lowercase!@", "UPPERCASE!@", "12345678!@", "lowercase 123"])("rejects fewer than three classes: %s", (password) => {
  expect(getPasswordIssues(password)).toContain("PASSWORD_CLASSES_REQUIRED");
  expect(passwordInput.safeParse(password).success).toBe(false);
});
it.each(["aaaaB7!xyz", "aBBBB7!xyz", "abC1111!xy", "abC7!!!!xy", "abC7____xy", "abC7    xy", "aaAAaB7!xy"])("accepts up to four identical consecutive characters: %s", (password) => {
  expect(passwordInput.safeParse(password).success).toBe(true);
});
it.each(["aaaaaB7!xyz", "aBBBBB7!xyz", "abC11111!xy", "abC7!!!!!xy", "abC7_____xy", "abC7     xy"])("rejects five identical consecutive characters: %s", (password) => {
  expect(getPasswordIssues(password)).toContain("PASSWORD_REPEATED_CHARACTERS");
  expect(passwordInput.safeParse(password).success).toBe(false);
});
it("rejects the reported numeric password for both composition and repetition", () => {
  const password = "11111111111111111111111111111111111111111111111111111111115647367848768686557851089367450987390846734586789056309460925638753845";
  expect(getPasswordIssues(password)).toEqual(expect.arrayContaining(["PASSWORD_CLASSES_REQUIRED", "PASSWORD_REPEATED_CHARACTERS"]));
  expect(passwordInput.safeParse(password).success).toBe(false);
});
it("keeps length boundaries inclusive without trimming", () => {
  expect(passwordInput.safeParse("Ab3!".repeat(32)).success).toBe(true);
  expect(passwordInput.safeParse("Ab3!".repeat(32) + "x").success).toBe(false);
  expect(passwordInput.safeParse(" Ab3!wX7z ").data).toBe(" Ab3!wX7z ");
});
