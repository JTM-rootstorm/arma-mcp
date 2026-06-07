#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startHttpBridge } from "./httpBridge.js";
import { logger } from "./log.js";
import { createMcpServer } from "./mcpServer.js";
import { createState } from "./state.js";

async function main(): Promise<void> {
  const state = createState();
  const bridge = await startHttpBridge(state, logger);

  if (process.argv.includes("--http-only")) {
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
