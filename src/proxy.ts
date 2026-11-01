import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "./server/security/headers";

export function proxy(request: NextRequest) {
  const nonce = randomBytes(16).toString("base64");
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development", process.env.APP_URL?.startsWith("https://") === true);
  const headers = new Headers(request.headers);
  // Replace untrusted incoming values before Next extracts the rendering nonce.
  headers.set("x-nonce", nonce); headers.set("Content-Security-Policy", csp);
  headers.delete("Content-Security-Policy-Report-Only");
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"] };
