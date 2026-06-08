#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isRecoverableListenError, resolveBridgeConfig, shouldSkipHttpListen, startHttpBridge } from "./httpBridge.js";
import { logger } from "./log.js";
import { createMcpServer } from "./mcpServer.js";
import { createRemoteBridgeState } from "./remoteBridgeState.js";
import { createRuntimeInfo } from "./runtime.js";
import { createState } from "./state.js";

async function main(): Promise<void> {
  const httpOnly = process.argv.includes("--http-only");
  const stdioOnlyExistingBridge = shouldSkipHttpListen();
  const bridgeConfig = resolveBridgeConfig();
  const startedAt = new Date().toISOString();

  if (httpOnly && stdioOnlyExistingBridge) {
    throw new Error("--http-only cannot be combined with --stdio-only-existing-bridge or ARMA_MCP_SKIP_HTTP_LISTEN=1");
  }

  if (stdioOnlyExistingBridge) {
    const runtime = createRuntimeInfo({
      mode: "stdio-existing-bridge",
      host: bridgeConfig.host,
      port: bridgeConfig.port,
      ownsHttpListener: false,
      skipHttpListen: true,
      startedAt
    });
    const state = createRemoteBridgeState(bridgeConfig);
    const mcpServer = createMcpServer(state, bridgeConfig, runtime);
    logger.info("using existing HTTP bridge for MCP stdio", runtime);
    await mcpServer.connect(new StdioServerTransport());
    logger.info("MCP stdio server connected", runtime);
    return;
  }

  const state = createState();
  const requestedRuntime = createRuntimeInfo({
    mode: httpOnly ? "http-only" : "stdio",
    host: bridgeConfig.host,
    port: bridgeConfig.port,
    ownsHttpListener: true,
    skipHttpListen: false,
    startedAt
  });
  const bridge = await startHttpBridge(state, logger, bridgeConfig, requestedRuntime).catch((error: unknown) => {
    if (httpOnly || !isRecoverableListenError(error)) {
      throw error;
    }
    const fallbackRuntime = createRuntimeInfo({
      mode: "stdio-existing-bridge",
      host: bridgeConfig.host,
      port: bridgeConfig.port,
      ownsHttpListener: false,
      skipHttpListen: true,
      startedAt
    });
    logger.warn("HTTP bridge listen failed; reusing existing bridge for MCP stdio", {
      host: bridgeConfig.host,
      port: bridgeConfig.port,
      mode: fallbackRuntime.mode,
      pid: fallbackRuntime.pid,
      startedAt: fallbackRuntime.startedAt,
      ownsHttpListener: fallbackRuntime.ownsHttpListener,
      httpBridgeUrl: fallbackRuntime.httpBridgeUrl,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  });

  if (httpOnly) {
    if (!bridge) {
      throw new Error("HTTP-only mode requires the sidecar to own the HTTP bridge listener");
    }
    logger.info("running in HTTP-only development mode", { url: bridge.url });
    return;
  }

  const mcpState = bridge ? state : createRemoteBridgeState(bridgeConfig);
  const runtime = bridge?.runtime ?? createRuntimeInfo({
    mode: "stdio-existing-bridge",
    host: bridgeConfig.host,
    port: bridgeConfig.port,
    ownsHttpListener: false,
    skipHttpListen: true,
    startedAt
  });
  const mcpServer = createMcpServer(mcpState, bridge?.config ?? bridgeConfig, runtime);
  await mcpServer.connect(new StdioServerTransport());
  logger.info("MCP stdio server connected", runtime);
}

main().catch((error: unknown) => {
  logger.error("fatal startup failure", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
