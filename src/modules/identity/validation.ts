import { z } from "zod";

export const organizerName = z.string().trim().min(1).max(100);
export const emailInput = z.email().max(254).transform((value) => value.trim().toLowerCase());
// Printable ASCII: A-Z/a-z, digits, space and standard punctuation.
// Reject control/invisible characters too; do not trim or transliterate a secret.
export function hasAllowedPasswordCharacters(password: string) {
  return !/[^\x20-\x7E]/u.test(password);
}
export const passwordIssueCodes = ["INVALID_PASSWORD_CHARACTERS", "PASSWORD_TOO_SHORT", "PASSWORD_TOO_LONG",
  "PASSWORD_CLASSES_REQUIRED", "PASSWORD_REPEATED_CHARACTERS"] as const;
export type PasswordIssue = typeof passwordIssueCodes[number];

// Shared by forms and all new-password API operations. Space is allowed, but
// does not count as punctuation. Repetition is literal and case-sensitive.
export function getPasswordIssues(password: string): PasswordIssue[] {
  if (!hasAllowedPasswordCharacters(password)) return ["INVALID_PASSWORD_CHARACTERS"];
  const issues: PasswordIssue[] = [];
  if (password.length < 10) issues.push("PASSWORD_TOO_SHORT");
  if (password.length > 128) issues.push("PASSWORD_TOO_LONG");
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/];
  if (classes.filter((group) => group.test(password)).length < 3) issues.push("PASSWORD_CLASSES_REQUIRED");
  if (/(.)\1{4}/u.test(password)) issues.push("PASSWORD_REPEATED_CHARACTERS");
  return issues;
}

export const passwordInput = z.string().superRefine((password, context) => {
  for (const issue of getPasswordIssues(password)) context.addIssue({ code: "custom", message: issue });
});
