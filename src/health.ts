import { createServer } from "node:http";
import type { Client } from "discord.js";

/** Lightweight /healthz endpoint for Railway health checks. */
export function startHealth(client: Client): void {
  const started = Date.now();
  const port = Number(process.env.PORT) || 3000;

  createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    if (url !== "/healthz" && url !== "/") {
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const ready = client.isReady();
    const body = {
      status: ready ? "ok" : "down",
      ready,
      guilds: ready ? client.guilds.cache.size : 0,
      gatewayPingMs: ready ? Math.round(client.ws.ping) : null,
      uptimeSeconds: Math.floor((Date.now() - started) / 1000),
    };
    res
      .writeHead(ready ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      .end(req.method === "HEAD" ? undefined : JSON.stringify(body));
  }).listen(port, () => console.log(`Health endpoint listening on port ${port}`));
}
