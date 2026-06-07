import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeConfig } from "./httpBridge.js";
import { generateCheckpointPlan, validateCheckpointClasses } from "./checkpointPlanner.js";
import {
  compositionPlanSchema,
  generateCheckpointPlanInputSchema,
  getBridgeEventsInputSchema,
  getSnapshotInputSchema,
  queueApplyPlanInputSchema,
  requestSnapshotInputSchema
} from "./schema.js";
import type { ArmaMcpState } from "./state.js";

export function createMcpServer(state: ArmaMcpState, bridgeConfig: BridgeConfig): McpServer {
  const server = new McpServer({
    name: "arma-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "arma_ping",
    {
      title: "Arma MCP Ping",
      description: "Check sidecar, local bridge, Eden connection, and pending command state.",
      inputSchema: {}
    },
    async () =>
      jsonToolResult({
        sidecar: "ok",
        httpBridge: { host: bridgeConfig.host, port: bridgeConfig.port },
        eden: {
          connected: state.getLastEdenSeenAt() !== null,
          lastSeenAt: state.getLastEdenSeenAt()
        },
        lastSnapshotAt: state.getLastSnapshot()?.createdAt ?? null,
        pendingCommandCount: state.pendingCommandCount()
      })
  );

  server.registerTool(
    "arma_request_editor_snapshot",
    {
      title: "Request Eden Snapshot",
      description: "Queue a command asking Eden to upload a fresh editor snapshot.",
      inputSchema: requestSnapshotInputSchema.shape
    },
    async (input) => {
      const parsed = requestSnapshotInputSchema.parse(input);
      const command = state.queueSnapshotRequest(parsed.scope);
      return jsonToolResult({ queued: true, commandId: command.id });
    }
  );

  server.registerTool(
    "arma_get_editor_snapshot",
    {
      title: "Get Eden Snapshot",
      description: "Return the latest Eden snapshot stored by the sidecar.",
      inputSchema: getSnapshotInputSchema.shape
    },
    async (input) => {
      const parsed = getSnapshotInputSchema.parse(input);
      const snapshot = state.getLastSnapshot();
      if (!snapshot) {
        return jsonToolResult({
          snapshot: null,
          message: "No Eden snapshot has been received yet. Call arma_request_editor_snapshot, then let Eden poll."
        });
      }
      const { raw: _raw, ...withoutRaw } = snapshot;
      return jsonToolResult({ snapshot: parsed.includeRaw ? snapshot : withoutRaw });
    }
  );

  server.registerTool(
    "arma_generate_checkpoint_plan",
    {
      title: "Generate Checkpoint Plan",
      description: "Generate a dry-run, reviewable checkpoint composition plan.",
      inputSchema: generateCheckpointPlanInputSchema.shape
    },
    async (input) => {
      const parsed = generateCheckpointPlanInputSchema.parse(input);
      const generated = generateCheckpointPlan(parsed);
      compositionPlanSchema.parse(generated.plan);
      return jsonToolResult(generated);
    }
  );

  server.registerTool(
    "arma_queue_apply_plan",
    {
      title: "Queue Eden Plan",
      description: "Queue a validated structured composition plan for Eden to apply.",
      inputSchema: queueApplyPlanInputSchema.shape
    },
    async (input) => {
      const parsed = queueApplyPlanInputSchema.parse(input);
      if (parsed.plan.dryRun) {
        throw new Error("Refusing to queue a dry-run plan; set dryRun=false after review.");
      }
      const unsupported = validateCheckpointClasses(parsed.plan);
      if (unsupported.length > 0) {
        throw new Error(`Unsupported MVP classname(s): ${unsupported.join(", ")}`);
      }
      const command = state.queueApplyPlan(parsed.plan);
      return jsonToolResult({ queued: true, commandId: command.id });
    }
  );

  server.registerTool(
    "arma_get_bridge_events",
    {
      title: "Get Bridge Events",
      description: "Return recent bridge events and Eden results.",
      inputSchema: getBridgeEventsInputSchema.shape
    },
    async (input) => {
      const parsed = getBridgeEventsInputSchema.parse(input);
      return jsonToolResult({ events: state.recentEvents(parsed.limit) });
    }
  );

  return server;
}

function jsonToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
