import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeConfig } from "./httpBridge.js";
import { generateCheckpointPlan, validateCheckpointClasses } from "./checkpointPlanner.js";
import {
  generateAaSite,
  generateCoverLine,
  generateLz,
  generatePropWall,
  generateRoadCheckpoint,
  generateSmallOutpost
} from "./generators.js";
import {
  confirmationSchema,
  entityTypeSchema,
  transformSchema,
  vector3Schema,
  type ArmaMcpActionMode,
  type ArmaMcpActionName
} from "./protocol.js";
import { enforceToolPolicy } from "./policy.js";
import {
  compositionPlanSchema,
  generateCheckpointPlanInputSchema,
  getBridgeEventsInputSchema,
  getSnapshotInputSchema,
  queueApplyPlanInputSchema,
  requestSnapshotInputSchema
} from "./schema.js";
import type { ArmaMcpState } from "./state.js";

const emptyInputSchema = z.object({});
const readOptionsSchema = z.object({
  includeAttributes: z.boolean().default(true),
  includeConfig: z.boolean().default(true),
  includeModel: z.boolean().default(false)
});
const entityIdSchema = z.string().min(1).max(120);
const getEntitySnapshotToolSchema = readOptionsSchema.extend({
  entityId: entityIdSchema,
  attributeNames: z.array(z.string().min(1).max(80)).max(50).optional()
});
const getEntitiesToolSchema = readOptionsSchema.extend({
  entityIds: z.array(entityIdSchema).min(1).max(100)
});
const entityListToolSchema = readOptionsSchema.extend({
  types: z.array(z.string().min(1).max(40)).max(8).optional(),
  classNameContains: z.string().max(160).optional(),
  variableNameContains: z.string().max(160).optional(),
  radius: z
    .object({
      centerATL: vector3Schema,
      meters: z.number().positive().max(10_000)
    })
    .optional(),
  limit: z.number().int().positive().max(500).default(200)
});
const getEntityAttributesToolSchema = z.object({
  entityId: entityIdSchema,
  attributeNames: z.array(z.string().min(1).max(80)).max(50).optional()
});
const assetSearchToolSchema = z.object({
  query: z.string().trim().min(1).max(160),
  kinds: z.array(z.string().min(1).max(40)).max(10).optional(),
  factions: z.array(z.string().min(1).max(80)).max(20).optional(),
  limit: z.number().int().positive().max(100).default(25)
});
const terrainSampleAreaToolSchema = z.object({
  centerATL: vector3Schema,
  radiusMeters: z.number().positive().max(500),
  spacingMeters: z.number().positive().max(100).default(10),
  includeWater: z.boolean().default(true),
  includeSurfaceNormal: z.boolean().default(false)
});
const writeBaseSchema = z.object({
  dryRun: z.boolean().default(true),
  confirmation: confirmationSchema
});
const createEntityToolSchema = writeBaseSchema.extend({
  type: entityTypeSchema.default("Object"),
  className: z.string().trim().min(1).max(160),
  transform: transformSchema.default({}),
  attributes: z.record(z.string(), z.unknown()).optional(),
  select: z.boolean().default(true),
  layer: z.string().trim().min(1).max(160).optional()
});
const setEntityTransformToolSchema = writeBaseSchema.extend({
  entityId: entityIdSchema,
  transform: transformSchema
});
const setEntityAttributesToolSchema = writeBaseSchema.extend({
  entityId: entityIdSchema,
  attributes: z.record(z.string(), z.unknown()),
  mode: z.enum(["patch", "replace"]).default("patch")
});
const appendInitToolSchema = writeBaseSchema.extend({
  entityId: entityIdSchema,
  text: z.string().min(1).max(16_000),
  separator: z.string().max(20).default("\n")
});
const deleteEntitiesToolSchema = writeBaseSchema.extend({
  entityIds: z.array(entityIdSchema).min(1).max(100)
});
const selectionToolSchema = z.object({
  entityIds: z.array(entityIdSchema).max(100),
  focus: z.boolean().default(false)
});
const focusEntitiesToolSchema = z.object({
  entityIds: z.array(entityIdSchema).min(1).max(20)
});
const batchOperationSchema = z
  .object({
    op: z.enum([
      "create_entity",
      "set_transform",
      "set_attributes",
      "delete_entity",
      "select_entities",
      "sync_entities",
      "assign_layer",
      "create_marker",
      "create_trigger",
      "create_waypoint",
      "create_module"
    ]),
    clientRef: z.string().min(1).max(120).optional(),
    entityId: entityIdSchema.optional(),
    entityIds: z.array(entityIdSchema).max(100).optional(),
    type: entityTypeSchema.optional(),
    className: z.string().trim().min(1).max(160).optional(),
    transform: transformSchema.optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    text: z.string().max(500).optional(),
    layer: z.string().max(160).optional()
  })
  .strict();
const batchToolSchema = writeBaseSchema.extend({
  historyLabel: z.string().trim().min(1).max(160).default("Arma MCP batch"),
  operations: z.array(batchOperationSchema).max(250)
});
const validatePlanToolSchema = z.object({
  plan: z.object({ operations: z.array(batchOperationSchema).max(250) }).passthrough(),
  checks: z
    .object({
      classes: z.boolean().default(true),
      terrain: z.boolean().default(false),
      water: z.boolean().default(false),
      bounds: z.boolean().default(false),
      destructive: z.boolean().default(true)
    })
    .default({ classes: true, terrain: false, water: false, bounds: false, destructive: true })
});
const generatorAnchorSchema = z
  .object({
    mode: z.string().max(40).optional(),
    positionATL: vector3Schema.optional(),
    dir: z.number().optional()
  })
  .default({});
const roadCheckpointGeneratorSchema = z.object({
  dryRun: z.boolean().default(true),
  anchor: generatorAnchorSchema,
  factionTheme: z.string().max(80).optional(),
  size: z.enum(["small", "medium"]).default("small"),
  features: z.record(z.string(), z.boolean()).optional()
});
const smallOutpostGeneratorSchema = z.object({
  dryRun: z.boolean().default(true),
  anchor: generatorAnchorSchema,
  factionTheme: z.string().max(80).optional(),
  radiusMeters: z.number().positive().max(100).default(35),
  objective: z.string().max(120).optional(),
  threatDirectionDeg: z.number().optional(),
  features: z.record(z.string(), z.boolean()).optional()
});
const siteGeneratorSchema = z.object({
  dryRun: z.boolean().default(true),
  anchor: generatorAnchorSchema,
  factionTheme: z.string().max(80).optional(),
  radiusMeters: z.number().positive().max(100).default(30)
});
const lineGeneratorSchema = z.object({
  dryRun: z.boolean().default(true),
  anchor: generatorAnchorSchema,
  lengthMeters: z.number().positive().max(200).default(24),
  segmentCount: z.number().int().positive().max(30).default(6)
});
const captureCompositionToolSchema = z.object({
  anchor: z
    .object({
      mode: z.enum(["selectionCentroid", "firstSelected"]).default("selectionCentroid")
    })
    .default({ mode: "selectionCentroid" }),
  includeAttributes: z.boolean().default(true),
  includeConnections: z.boolean().default(false),
  includeLayers: z.boolean().default(true),
  name: z.string().trim().min(1).max(120).default("captured-selection")
});
const applyCompositionToolSchema = writeBaseSchema.extend({
  composition: z
    .object({
      schemaVersion: z.literal(1),
      name: z.string().min(1).max(120),
      entities: z.array(z.record(z.string(), z.unknown())).max(250),
      connections: z.array(z.record(z.string(), z.unknown())).optional()
    })
    .passthrough(),
  anchor: z
    .object({
      positionATL: vector3Schema.default([0, 0, 0]),
      dir: z.number().default(0)
    })
    .default({ positionATL: [0, 0, 0], dir: 0 }),
  layer: z.string().max(160).optional()
});

export function createMcpServer(state: ArmaMcpState, bridgeConfig: BridgeConfig): McpServer {
  const server = new McpServer({
    name: "arma-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "arma.ping",
    {
      title: "Arma MCP Ping",
      description: "Check MCP server health without waiting on Eden.",
      inputSchema: emptyInputSchema.shape
    },
    async () =>
      jsonToolResult({
        ok: true,
        server: "arma-mcp",
        version: "0.1.0",
        httpBridge: { host: bridgeConfig.host, port: bridgeConfig.port }
      })
  );

  server.registerTool(
    "arma.bridge.get_status",
    {
      title: "Bridge Status",
      description: "Check sidecar queue and most recent Eden contact.",
      inputSchema: emptyInputSchema.shape
    },
    async () =>
      jsonToolResult({
        sidecarConnected: true,
        armaConnected: state.getLastEdenSeenAt() !== null,
        edenAvailable: state.getLastEdenSeenAt() !== null,
        pendingActions: state.pendingCommandCount(),
        pendingResults: state.pendingActionCount(),
        lastSeenAt: state.getLastEdenSeenAt(),
        httpBridge: { host: bridgeConfig.host, port: bridgeConfig.port }
      })
  );

  registerActionTool(server, state, "arma.bridge.ping", "bridge.ping", "read", emptyInputSchema, "Bridge Ping");
  registerActionTool(
    server,
    state,
    "arma.bridge.get_capabilities",
    "bridge.get_capabilities",
    "read",
    emptyInputSchema,
    "Bridge Capabilities"
  );
  registerActionTool(server, state, "arma.eden.get_status", "eden.get_status", "read", emptyInputSchema, "Eden Status");
  registerActionTool(
    server,
    state,
    "arma.eden.get_selection",
    "eden.get_selection",
    "read",
    readOptionsSchema,
    "Get Eden Selection"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.list_entities",
    "eden.list_entities",
    "read",
    entityListToolSchema,
    "List Eden Entities"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.find_entities",
    "eden.find_entities",
    "read",
    entityListToolSchema,
    "Find Eden Entities"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.get_entity_snapshot",
    "eden.get_entity_snapshot",
    "read",
    getEntitySnapshotToolSchema,
    "Get Eden Entity Snapshot"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.get_entities",
    "eden.get_entities",
    "read",
    getEntitiesToolSchema,
    "Get Eden Entities"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.get_entity_attributes",
    "eden.get_entity_attributes",
    "read",
    getEntityAttributesToolSchema,
    "Get Eden Entity Attributes"
  );
  registerActionTool(
    server,
    state,
    "arma.assets.search_classes",
    "assets.search_classes",
    "read",
    assetSearchToolSchema,
    "Search Arma Classes"
  );
  registerActionTool(
    server,
    state,
    "arma.terrain.sample_area",
    "terrain.sample_area",
    "read",
    terrainSampleAreaToolSchema,
    "Sample Terrain Area"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.create_entity",
    "eden.create_entity",
    "write",
    createEntityToolSchema,
    "Create Eden Entity"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.set_entity_transform",
    "eden.set_entity_transform",
    "write",
    setEntityTransformToolSchema,
    "Set Eden Entity Transform"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.set_entity_attributes",
    "eden.set_entity_attributes",
    "write",
    setEntityAttributesToolSchema,
    "Set Eden Entity Attributes"
  );
  registerActionTool(server, state, "arma.eden.append_init", "eden.append_init", "write", appendInitToolSchema, "Append Init");
  registerActionTool(
    server,
    state,
    "arma.eden.delete_entities",
    "eden.delete_entities",
    "destructive",
    deleteEntitiesToolSchema,
    "Delete Eden Entities"
  );
  registerActionTool(server, state, "arma.eden.set_selection", "eden.set_selection", "write", selectionToolSchema, "Set Selection");
  registerActionTool(
    server,
    state,
    "arma.eden.clear_selection",
    "eden.clear_selection",
    "write",
    emptyInputSchema,
    "Clear Selection"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.focus_entities",
    "eden.focus_entities",
    "write",
    focusEntitiesToolSchema,
    "Focus Entities"
  );
  registerActionTool(server, state, "arma.eden.batch", "eden.batch", "write", batchToolSchema, "Apply Eden Batch");
  registerActionTool(
    server,
    state,
    "arma.eden.validate_plan",
    "eden.validate_plan",
    "read",
    validatePlanToolSchema,
    "Validate Eden Plan"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.capture_composition",
    "eden.capture_composition",
    "read",
    captureCompositionToolSchema,
    "Capture Composition"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.apply_composition",
    "eden.apply_composition",
    "write",
    applyCompositionToolSchema,
    "Apply Composition"
  );
  registerLocalGeneratorTool(server, "arma.eden.generate_road_checkpoint", roadCheckpointGeneratorSchema, (input) =>
    generateRoadCheckpoint(input)
  );
  registerLocalGeneratorTool(server, "arma.eden.generate_small_outpost", smallOutpostGeneratorSchema, (input) =>
    generateSmallOutpost(input)
  );
  registerLocalGeneratorTool(server, "arma.eden.generate_aa_site", siteGeneratorSchema, (input) => generateAaSite(input));
  registerLocalGeneratorTool(server, "arma.eden.generate_lz", siteGeneratorSchema, (input) => generateLz(input));
  registerLocalGeneratorTool(server, "arma.eden.generate_cover_line", lineGeneratorSchema, (input) => generateCoverLine(input));
  registerLocalGeneratorTool(server, "arma.eden.generate_prop_wall", lineGeneratorSchema, (input) => generatePropWall(input));

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

function registerLocalGeneratorTool<T extends z.ZodObject<z.ZodRawShape>>(
  server: McpServer,
  toolName: string,
  inputSchema: T,
  generate: (input: z.infer<T>) => unknown
): void {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description: "Generate a dry-run Eden batch plan without mutating Eden.",
      inputSchema: inputSchema.shape
    },
    async (input) => {
      const parsed = inputSchema.parse(input);
      return jsonToolResult(generate(parsed));
    }
  );
}

function registerActionTool<T extends z.ZodObject<z.ZodRawShape>>(
  server: McpServer,
  state: ArmaMcpState,
  toolName: string,
  actionName: ArmaMcpActionName,
  mode: ArmaMcpActionMode,
  inputSchema: T,
  title: string
): void {
  server.registerTool(
    toolName,
    {
      title,
      description: `Dispatch typed Arma action ${actionName}.`,
      inputSchema: inputSchema.shape
    },
    async (input) => {
      const parsed = inputSchema.parse(input);
      const policy = enforceToolPolicy({
        action: actionName,
        dryRun: "dryRun" in parsed ? parsed.dryRun === true : false,
        confirmation:
          "confirmation" in parsed && parsed.confirmation && typeof parsed.confirmation === "object"
            ? (parsed.confirmation as { confirmed: boolean; reason: string })
            : undefined,
        attributes:
          "attributes" in parsed && parsed.attributes && typeof parsed.attributes === "object" && !Array.isArray(parsed.attributes)
            ? (parsed.attributes as Record<string, unknown>)
            : undefined,
        operations: "operations" in parsed && Array.isArray(parsed.operations) ? parsed.operations : undefined
      });
      const queued = state.queueAction({
        action: actionName,
        mode,
        params: policy.warnings.length > 0 ? { ...parsed, policyWarnings: policy.warnings } : parsed,
        dryRun: "dryRun" in parsed && parsed.dryRun === true,
        requiresConfirmation: "confirmation" in parsed && confirmationSchema.safeParse(parsed.confirmation).success,
        context: {
          confirmationConfirmed:
            "confirmation" in parsed &&
            typeof parsed.confirmation === "object" &&
            parsed.confirmation !== null &&
            "confirmed" in parsed.confirmation &&
            parsed.confirmation.confirmed === true
        }
      });
      const result = await queued.result;
      return jsonToolResult(result.result ?? result);
    }
  );
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
