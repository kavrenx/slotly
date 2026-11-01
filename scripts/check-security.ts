import { loadEnvironment } from "./lib/environment";

try {
  const { APP_URL } = loadEnvironment();
  const origin = new URL(APP_URL).origin;
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try { ready = (await fetch(origin, { signal: AbortSignal.timeout(2000), redirect: "manual" })).ok; } catch { /* Server may still be starting. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Server unavailable");
  const nonces = new Set<string>();
  for (const path of ["/", "/login", "/register", "/manage", "/missing-security-check-page"]) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    if (response.status !== (path.startsWith("/missing-") ? 404 : 200)) throw new Error("Unexpected status");
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/u)?.[1];
    if (!nonce || nonces.has(nonce) || Buffer.from(nonce, "base64").length !== 16) throw new Error("Nonce missing or reused");
    nonces.add(nonce);
    const scripts = csp.split(";").find(directive => directive.trim().startsWith("script-src ")) ?? "";
    if (!scripts.includes("'strict-dynamic'") || /unsafe-inline|unsafe-eval/u.test(scripts)) throw new Error("Unsafe script policy");
    for (const directive of ["script-src-attr 'none'", "frame-ancestors 'none'", "form-action 'self'", "object-src 'none'"]) if (!csp.includes(directive)) throw new Error("CSP directive missing");
    for (const [key, expected] of [["x-content-type-options", "nosniff"], ["referrer-policy", "no-referrer"], ["x-frame-options", "DENY"]]) if (response.headers.get(key!) !== expected) throw new Error("Security header missing");
    if (!response.headers.get("cache-control")?.includes("no-store")) throw new Error("Document may be shared in cache");
    if (new URL(origin).protocol === "https:" && !response.headers.get("strict-transport-security")) throw new Error("HSTS missing");
    const html = await response.text();
    const tags = [...html.matchAll(/<script\b[^>]*>/giu)];
    if (!tags.length || tags.some(tag => !tag[0].includes(`nonce="${nonce}"`))) throw new Error("Rendered script nonce missing");
  }
  console.log("Проверены production CSP, уникальность nonce, скрипты HTML и защитные заголовки пяти страниц, включая 404.");
} catch {
  console.error("Проверка защиты браузера не пройдена. Нужна запущенная production-сборка; содержимое ответов скрыто."); process.exitCode = 1;
}
