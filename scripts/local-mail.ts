import { createServer } from "node:http";
import { parseIdentityEnv } from "../src/server/config/schema";
import { loadEnvironment } from "./lib/environment";
import { readLocalMail } from "../src/server/mail/reader";
import { renderLocalMailbox } from "../src/server/mail/view";

loadEnvironment();
const env = parseIdentityEnv(process.env);

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  if (!["127.0.0.1:8025", "localhost:8025"].includes(request.headers.host ?? "") || request.method !== "GET" || request.url !== "/") {
    response.writeHead(404).end(); return;
  }
  try {
    const messages = await readLocalMail();
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(renderLocalMailbox(messages, env.APP_URL));
  } catch {
    response.writeHead(500).end("Не удалось прочитать локальную почту.");
  }
});
server.listen(8025, "127.0.0.1", () => console.log("Локальная почта: http://localhost:8025 (только loopback)."));
process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());
