import { expect, it } from "vitest";
import { clientIpBucket, parseClientIpHeader, resolveClientIp } from "./client-ip";

const app = "https://slotly.example", header = "x-slotly-proxy-ip";
it("ignores every forwarded IP in the local configuration", () => {
  expect(resolveClientIp(new Headers({ "x-forwarded-for": "203.0.113.9", "x-slotly-client-ip": "203.0.113.8", [header]: "203.0.113.7" }), "http://localhost:3000", header)).toBe("127.0.0.1");
});
it("trusts only one explicitly selected proxy header", () => {
  expect(resolveClientIp(new Headers({ [header]: "203.0.113.5", "x-forwarded-for": "192.0.2.1", "x-slotly-client-ip": "192.0.2.2" }), app, header)).toBe("203.0.113.5");
  expect(() => resolveClientIp(new Headers({ "x-forwarded-for": "203.0.113.5" }), app, header)).toThrow("CLIENT_IP_UNAVAILABLE");
  expect(() => parseClientIpHeader(undefined, app)).toThrow("CLIENT_IP_HEADER");
  for (const invalid of ["forwarded", "x-forwarded-for", "x-slotly-client-ip", "X-Real-IP", "bad header"]) expect(() => parseClientIpHeader(invalid, app)).toThrow("CLIENT_IP_HEADER");
});
it.each(["", "203.0.113.5, 192.0.2.1", "203.0.113.5:443", "[2001:db8::1]", "unknown", "fe80::1%eth0", "example.com"])("fails closed on ambiguous or missing proxy values", value => {
  expect(() => resolveClientIp(new Headers({ [header]: value }), app, header)).toThrow("CLIENT_IP_UNAVAILABLE");
});
it("canonicalizes IPv6, unifies mapped IPv4 and shares IPv6 /64 request buckets", () => {
  const resolve = (value: string) => resolveClientIp(new Headers({ [header]: value }), app, header);
  expect(resolve("2001:0DB8:0000:0001:0000:0000:0000:0001")).toBe("2001:db8:0:1::1");
  expect(resolve("::ffff:192.0.2.9")).toBe("192.0.2.9");
  expect(clientIpBucket(resolve("2001:db8:1:2::1"))).toBe(clientIpBucket(resolve("2001:db8:1:2:ffff::9")));
  expect(clientIpBucket(resolve("2001:db8:1:2::1"))).not.toBe(clientIpBucket(resolve("2001:db8:1:3::1")));
});
