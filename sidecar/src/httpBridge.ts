import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { compositionPlanSchema, editorSnapshotSchema } from "./schema.js";
import type { ArmaMcpState, QueuedActionInput } from "./state.js";
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

export function shouldSkipHttpListen(argv = process.argv, env = process.env): boolean {
  return argv.includes("--stdio-only-existing-bridge") || truthyEnv(env.ARMA_MCP_SKIP_HTTP_LISTEN);
}

export function isRecoverableListenError(error: unknown): boolean {
  const record = error && typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : String(error);
  return code === "EADDRINUSE" || code === "EPERM" || /listen EADDRINUSE|listen EPERM/i.test(message);
}

export async function startHttpBridge(
  state: ArmaMcpState,
  logger: Logger,
  config = resolveBridgeConfig()
): Promise<StartedBridge> {
  const server = createServer((request, response) => {
    handleRequest(request, response, state, config).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("http request failed", { error: message });
      sendJson(response, 500, { error: "internal_error", message });
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

  if (url.pathname.startsWith("/mcp/")) {
    await handleMcpControlRequest(request, response, url, state);
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

async function handleMcpControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  state: ArmaMcpState
): Promise<void> {
  if (request.method === "GET" && url.pathname === "/mcp/status") {
    const lastSeenAt = await state.getLastEdenSeenAt();
    sendJson(response, 200, {
      ok: true,
      armaConnected: lastSeenAt !== null,
      edenAvailable: lastSeenAt !== null,
      pendingActions: await state.pendingCommandCount(),
      pendingResults: await state.pendingActionCount(),
      lastSeenAt,
      lastSnapshotAt: (await state.getLastSnapshot())?.createdAt ?? null
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/mcp/actions") {
    const body = await readJson(request);
    const queued = state.queueAction(body as QueuedActionInput);
    const result = await queued.result;
    sendJson(response, 200, { ok: true, action: queued.action, result });
    return;
  }

  if (request.method === "POST" && url.pathname === "/mcp/snapshot-requests") {
    const body = await readJson(request);
    const scope = body.scope === "all" ? "all" : "selection";
    const command = await state.queueSnapshotRequest(scope);
    sendJson(response, 200, { ok: true, command });
    return;
  }

  if (request.method === "GET" && url.pathname === "/mcp/snapshot") {
    const includeRaw = url.searchParams.get("includeRaw") === "1" || url.searchParams.get("includeRaw") === "true";
    const snapshot = await state.getLastSnapshot();
    if (!snapshot) {
      sendJson(response, 200, { ok: true, snapshot: null });
      return;
    }
    const { raw: _raw, ...withoutRaw } = snapshot;
    sendJson(response, 200, { ok: true, snapshot: includeRaw ? snapshot : withoutRaw });
    return;
  }

  if (request.method === "POST" && url.pathname === "/mcp/apply-plans") {
    const body = await readJson(request);
    const plan = compositionPlanSchema.parse(body.plan);
    const command = await state.queueApplyPlan(plan);
    sendJson(response, 200, { ok: true, command });
    return;
  }

  if (request.method === "GET" && url.pathname === "/mcp/events") {
    const limit = Number(url.searchParams.get("limit") ?? 20);
    sendJson(response, 200, { ok: true, events: await state.recentEvents(Number.isFinite(limit) ? limit : 20) });
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

function truthyEnv(value: string | undefined): boolean {
  return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
