#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveBridgeConfig, shouldSkipHttpListen, startHttpBridge } from "./httpBridge.js";
import { logger } from "./log.js";
import { createMcpServer } from "./mcpServer.js";
import { createRemoteBridgeState } from "./remoteBridgeState.js";
import { createState } from "./state.js";

async function main(): Promise<void> {
  const httpOnly = process.argv.includes("--http-only");
  const stdioOnlyExistingBridge = shouldSkipHttpListen();

  if (httpOnly && stdioOnlyExistingBridge) {
    throw new Error("--http-only cannot be combined with --stdio-only-existing-bridge or ARMA_MCP_SKIP_HTTP_LISTEN=1");
  }

  if (stdioOnlyExistingBridge) {
    const bridgeConfig = resolveBridgeConfig();
    const state = createRemoteBridgeState(bridgeConfig);
    const mcpServer = createMcpServer(state, bridgeConfig);
    logger.info("using existing HTTP bridge for MCP stdio", { host: bridgeConfig.host, port: bridgeConfig.port });
    await mcpServer.connect(new StdioServerTransport());
    logger.info("MCP stdio server connected");
    return;
  }

  const state = createState();
  const bridge = await startHttpBridge(state, logger);

  if (httpOnly) {
    logger.info("running in HTTP-only development mode", { url: bridge.url });
    return;
  }

  const mcpServer = createMcpServer(state, bridge.config);
  await mcpServer.connect(new StdioServerTransport());
  logger.info("MCP stdio server connected");
}

main().catch((error: unknown) => {
  logger.error("fatal startup failure", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
