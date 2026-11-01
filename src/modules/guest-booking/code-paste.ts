/** Accept formatted six-digit codes without truncating them at the input's maxLength. */
export function pastedGuestCode(text: string): string | null {
  const compact = text.replace(/\s/gu, "");
  return /^[0-9]{6}$/u.test(compact) ? compact : null;
}
