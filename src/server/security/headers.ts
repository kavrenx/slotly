// Inline style attributes are used by the calendar, demo cursor and 3D tilt.
// Scripts get a per-response nonce instead of an unsafe-inline exception.
export function contentSecurityPolicy(nonce: string, development: boolean, https: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self'", "object-src 'none'",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "frame-src 'none'",
    `connect-src 'self'${development ? " ws:" : ""}`,
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
