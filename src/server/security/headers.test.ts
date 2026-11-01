import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import { contentSecurityPolicy } from "./headers";

it("restricts production scripts, embedding and submissions while retaining product styles", () => {
  const csp = contentSecurityPolicy("test-nonce", false, false);
  expect(csp).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic';");
  expect(csp).toContain("script-src-attr 'none'"); expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("form-action 'self'"); expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  expect(csp).not.toContain("unsafe-eval"); expect(csp).not.toContain("upgrade-insecure-requests");
  expect(contentSecurityPolicy("nonce", true, false)).toContain("'unsafe-eval'");
  expect(contentSecurityPolicy("nonce", false, true)).toContain("upgrade-insecure-requests");
});

it("replaces attacker-provided policy and uses an independent nonce on every request", () => {
  const request = () => new NextRequest("http://localhost:3000/register", { headers: { "x-nonce": "attacker", "Content-Security-Policy": "script-src 'unsafe-inline'", "Content-Security-Policy-Report-Only": "script-src 'nonce-attacker'" } });
  const a = proxy(request()), b = proxy(request());
  const csp = a.headers.get("Content-Security-Policy")!;
  expect(csp).not.toContain("attacker"); expect(csp).not.toEqual(b.headers.get("Content-Security-Policy"));
  const nonce = a.headers.get("x-middleware-request-x-nonce")!;
  expect(Buffer.from(nonce, "base64").length).toBe(16); expect(csp).toContain(`'nonce-${nonce}'`);
  expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  expect(a.headers.get("x-middleware-request-content-security-policy-report-only")).toBeNull();
  expect(a.headers.get("Cache-Control")).toBe("private, no-store");
});
