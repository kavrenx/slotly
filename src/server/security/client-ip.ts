import { isIP } from "node:net";
import { DomainError } from "../../shared/domain-error";

const local = (appUrl: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(appUrl).hostname);
export function parseClientIpHeader(value: string | undefined, appUrl: string) {
  if (!value && local(appUrl)) return undefined;
  if (!value || !/^[a-z][a-z0-9-]{0,63}$/u.test(value) || ["forwarded", "x-forwarded-for", "x-slotly-client-ip"].includes(value)) {
    throw new Error("CLIENT_IP_HEADER: нужен один явно выбранный заголовок, перезаписываемый доверенным прокси");
  }
  return value;
}
export function resolveClientIp(headers: Headers, appUrl: string, configuredHeader = process.env.CLIENT_IP_HEADER) {
  if (local(appUrl)) return "127.0.0.1";
  let header: string | undefined;
  try { header = parseClientIpHeader(configuredHeader, appUrl); } catch { throw new DomainError("CLIENT_IP_UNAVAILABLE", 503); }
  const value = headers.get(header!)?.trim();
  if (!value || value.includes("%") || !isIP(value)) throw new DomainError("CLIENT_IP_UNAVAILABLE", 503);
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/u.exec(canonical);
  if (mapped) {
    const a = parseInt(mapped[1]!, 16), b = parseInt(mapped[2]!, 16);
    return [a >> 8, a & 255, b >> 8, b & 255].join(".");
  }
  return canonical;
}
// IPv6 privacy addresses within one /64 share guest request limits.
export function clientIpBucket(ip: string) {
  if (isIP(ip) !== 6) return ip;
  const [left = "", right] = ip.split("::");
  const a = left.split(":").filter(Boolean), b = right?.split(":").filter(Boolean) ?? [];
  const words = right === undefined ? a : [...a, ...Array<string>(8 - a.length - b.length).fill("0"), ...b];
  return words.slice(0, 4).map(word => parseInt(word, 16).toString(16)).join(":") + "::/64";
}
