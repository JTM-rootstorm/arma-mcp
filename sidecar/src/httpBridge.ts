import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { editorSnapshotSchema } from "./schema.js";
import type { ArmaMcpState } from "./state.js";
import type { Logger } from "./log.js";

export type BridgeConfig = {
  host: string;
  port: number;
  token: string;
  generatedToken: boolean;
};

export type StartedBridge = {
  server: Server;
  config: BridgeConfig;
  url: string;
  close(): Promise<void>;
};

export function resolveBridgeConfig(env = process.env): BridgeConfig {
  const generatedToken = !env.ARMA_MCP_TOKEN;
  return {
    host: env.ARMA_MCP_HOST ?? "127.0.0.1",
    port: Number(env.ARMA_MCP_PORT ?? 38473),
    token: env.ARMA_MCP_TOKEN ?? `dev_${randomBytes(18).toString("hex")}`,
    generatedToken
  };
}

export async function startHttpBridge(
  state: ArmaMcpState,
  logger: Logger,
  config = resolveBridgeConfig()
): Promise<StartedBridge> {
  const server = createServer((request, response) => {
    handleRequest(request, response, state, config).catch((error: unknown) => {
      logger.error("http request failed", { error: error instanceof Error ? error.message : String(error) });
      sendJson(response, 500, { error: "internal_error" });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : config.port;
  const actualConfig = { ...config, port: actualPort };
  if (actualConfig.generatedToken) {
    logger.warn("ARMA_MCP_TOKEN missing; generated in-memory dev token", { token: actualConfig.token });
  }
  logger.info("HTTP bridge listening", { host: actualConfig.host, port: actualConfig.port });

  return {
    server,
    config: actualConfig,
    url: `http://${actualConfig.host}:${actualConfig.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: ArmaMcpState,
  config: BridgeConfig
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${config.host}:${config.port}`}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, bridge: "ok" });
    return;
  }

  if (!isAuthorized(request, config.token)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/bridge/snapshot") {
    const body = await readJson(request);
    const snapshot = editorSnapshotSchema.parse(body);
    const stored = state.storeSnapshot(snapshot);
    sendJson(response, 200, { ok: true, snapshotId: stored.id });
    return;
  }

  if (request.method === "GET" && url.pathname === "/bridge/commands") {
    sendJson(response, 200, { ok: true, commands: state.drainCommands() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/bridge/result") {
    const body = await readJson(request);
    const result = state.completeActionResult(body);
    sendJson(response, 200, { ok: true, resultId: result.id });
    return;
  }

  if (request.method === "POST" && url.pathname === "/bridge/event") {
    const body = await readJson(request);
    const event = state.rememberBridgeEvent(
      typeof body.type === "string" ? body.type : "edenEvent",
      typeof body.message === "string" ? body.message : "Eden posted an event",
      body
    );
    sendJson(response, 200, { ok: true, eventId: event.id });
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 256 * 1024) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload).toString()
  });
  response.end(payload);
}
