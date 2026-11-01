import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Socket, type Server } from "node:net";
import { createSecureContext, createServer as createTlsServer, TLSSocket } from "node:tls";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPrivateWorkspace, removePrivateWorkspace } from "../operations/postgres-tools";
import { createMailDelivery } from "./delivery";
import { readLocalMail } from "./reader";

const execute = promisify(execFile);
let directory: string, key: Buffer, cert: Buffer, caPath: string;
beforeAll(async () => {
  directory = await createPrivateWorkspace(); caPath = join(directory, "test-cert.pem");
  const keyPath = join(directory, "test-key.pem");
  const openssl = process.platform === "win32" && existsSync("C:/Program Files/Git/usr/bin/openssl.exe") ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
  await execute(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1", "-keyout", keyPath, "-out", caPath,
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-addext", "basicConstraints=critical,CA:TRUE"], { windowsHide: true });
  key = await readFile(keyPath); cert = await readFile(caPath);
});
afterAll(async () => { if (directory) await removePrivateWorkspace(directory); });

async function smtpServer(mode: "tls" | "starttls" | "no-tls", rejectData = false) {
  const connections = new Set<Socket>(), messages: string[] = [];
  let authBeforeTls = 0, authentications = 0;
  function session(socket: Socket, encrypted: boolean, greeting = true) {
    connections.add(socket); socket.on("error", () => {}); socket.once("close", () => connections.delete(socket));
    if (greeting) socket.write("220 localhost test SMTP\r\n");
    let buffer = "", data: string[] | undefined;
    const receive = (chunk: Buffer) => {
      buffer += chunk.toString();
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n"), line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (data) {
          if (line !== ".") { data.push(line); continue; }
          messages.push(data.join("\r\n")); data = undefined;
          socket.write(rejectData ? "451 test-only delivery failure\r\n" : "250 accepted\r\n"); continue;
        }
        if (/^EHLO /u.test(line)) socket.write(`250-localhost\r\n${mode === "starttls" && !encrypted ? "250-STARTTLS\r\n" : ""}250 AUTH PLAIN\r\n`);
        else if (line === "STARTTLS" && mode === "starttls") {
          socket.removeListener("data", receive);
          socket.write("220 ready\r\n", () => session(new TLSSocket(socket, { isServer: true, secureContext: createSecureContext({ key, cert }) }), true, false));
          return;
        } else if (line === "STARTTLS") socket.write("454 TLS unavailable\r\n");
        else if (line.startsWith("AUTH ")) {
          if (!encrypted) authBeforeTls++; authentications++;
          const credentials = Buffer.from(line.slice("AUTH PLAIN ".length), "base64").toString();
          socket.write(encrypted && credentials === "\0test-only\0test-only-password" ? "235 authenticated\r\n" : "535 invalid test credentials\r\n");
        }
        else if (/^(MAIL FROM:|RCPT TO:)/u.test(line)) socket.write("250 ok\r\n");
        else if (line === "DATA") { data = []; socket.write("354 send data\r\n"); }
        else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("500 unsupported\r\n");
      }
    };
    socket.on("data", receive);
  }
  const server: Server = mode === "tls" ? createTlsServer({ key, cert }, socket => session(socket, true)) : createServer(socket => session(socket, false));
  server.on("tlsClientError", () => {});
  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Test SMTP unavailable");
  return { port: address.port, messages, stats: () => ({ authBeforeTls, authentications }),
    close: async () => { for (const socket of connections) socket.destroy(); await new Promise<void>(resolveClose => server.close(() => resolveClose())); } };
}
async function client(port: number, security: "tls" | "starttls", trust: boolean, action = "send") {
  const env = { ...process.env }; delete env.NODE_EXTRA_CA_CERTS;
  const result = await execute(process.execPath, ["--import", "tsx", resolve("tests/helpers/smtp-client.ts")], {
    windowsHide: true, timeout: 20_000, env: { ...env, NODE_OPTIONS: "--max-old-space-size=256", ...(trust ? { NODE_EXTRA_CA_CERTS: caPath } : {}),
      SLOTLY_SMTP_TEST_ACTION: action, SLOTLY_SMTP_TEST_CONFIG: JSON.stringify({ MAIL_TRANSPORT: "smtp", SMTP_HOST: "localhost", SMTP_PORT: String(port),
        SMTP_SECURITY: security, SMTP_USER: "test-only", SMTP_PASSWORD: "test-only-password", MAIL_FROM: "noreply@example.invalid" }) },
  });
  return result.stdout.trim();
}

it.each(["tls", "starttls"] as const)("delivers MIME mail through authenticated %s with the original action link and stable Message-ID", async mode => {
  const server = await smtpServer(mode);
  try {
    expect(await client(server.port, mode, true)).toBe("ok");
    expect(server.stats()).toEqual({ authBeforeTls: 0, authentications: 1 });
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]).toContain("https://slotly.example/verify-email#token=test-only");
    expect(server.messages[0]).toContain("Message-ID: <11111111-1111-4111-8111-111111111111@slotly.example>");
    expect(server.messages[0]).toContain("To: guest@example.invalid");
  } finally { await server.close(); }
}, 25_000);
it("refuses an untrusted certificate before authenticating or delivering", async () => {
  const server = await smtpServer("tls");
  try { expect(await client(server.port, "tls", false)).toBe("MAIL_DELIVERY_FAILED"); expect(server.messages).toEqual([]); expect(server.stats().authentications).toBe(0); }
  finally { await server.close(); }
}, 25_000);
it("never sends credentials or mail when STARTTLS is unavailable", async () => {
  const server = await smtpServer("no-tls");
  try { expect(await client(server.port, "starttls", false)).toBe("MAIL_DELIVERY_FAILED"); expect(server.messages).toEqual([]); expect(server.stats().authentications).toBe(0); }
  finally { await server.close(); }
}, 25_000);
it("reports failed DATA acceptance as delivery failure without exposing server details", async () => {
  const server = await smtpServer("tls", true);
  try { expect(await client(server.port, "tls", true)).toBe("MAIL_DELIVERY_FAILED"); }
  finally { await server.close(); }
}, 25_000);
it("checks SMTP connectivity without sending a message", async () => {
  const server = await smtpServer("tls");
  try { expect(await client(server.port, "tls", true, "verify")).toBe("ok"); expect(server.messages).toEqual([]); expect(server.stats().authentications).toBe(1); }
  finally { await server.close(); }
}, 25_000);
it("keeps local delivery and rejects SMTP header injection before connecting", async () => {
  const local = createMailDelivery({ transport: "local" }, "http://localhost:3000", join(directory, "mail"));
  await local.sendMail({ to: "guest@example.invalid", subject: "Local", text: "Local only" });
  expect(await readLocalMail(join(directory, "mail"))).toHaveLength(1);
  const smtp = createMailDelivery({ transport: "smtp", SMTP_HOST: "localhost", SMTP_PORT: 1, SMTP_SECURITY: "tls", SMTP_USER: "test", SMTP_PASSWORD: "test", MAIL_FROM: "a@example.invalid" }, "https://slotly.example");
  try {
    await expect(smtp.sendMail({ to: "a@example.invalid,b@example.invalid", subject: "test", text: "test" })).rejects.toMatchObject({ code: "MAIL_INVALID" });
    await expect(smtp.sendMail({ to: "a@example.invalid", subject: "test\r\nBcc: b@example.invalid", text: "test" })).rejects.toMatchObject({ code: "MAIL_INVALID" });
    await expect(smtp.sendMail({ to: "a@example.invalid", subject: "test", text: "test", actionUrl: "https://other.example/#private" })).rejects.toMatchObject({ code: "MAIL_INVALID" });
  } finally { smtp.close(); }
});
