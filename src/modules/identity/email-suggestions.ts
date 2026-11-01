import { emailInput } from "./validation";

export const emailDomains = ["gmail.com", "yandex.ru", "mail.ru", "outlook.com"] as const;
export function emailFieldError(value: string): "required" | "invalid" | null {
  const email = value.trim().toLowerCase();
  return !email ? "required" : emailInput.safeParse(email).success ? null : "invalid";
}
export function completeEmailDomain(value: string, domain: typeof emailDomains[number]) {
  const local = value.trim().split("@")[0]!;
  return local ? `${local}@${domain}` : null;
}
