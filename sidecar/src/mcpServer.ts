import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdirSync } from "node:fs";
import type { BridgeConfig } from "./httpBridge.js";
import { DEFAULT_SCAN_TARGETS, ingestCatalogChunk, stableHash, type CatalogChunk } from "./catalog.js";
import {
  addCatalogVisualTag,
  closeCatalogDb,
  createVisualInspectionRun,
  ensureCatalogSchema,
  findCatalogByDimensions,
  getCatalogClass,
  getCatalogStatus,
  getCatalogTags,
  listCatalogCategories,
  listCatalogFactions,
  listClassesMissingMeasurements,
  listClassScreenshots,
  listCatalogMods,
  openCatalogDb,
  searchCatalogClasses,
  writeClassMeasurement,
  writeScanManifest
} from "./catalogDb.js";
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
const catalogScanToolSchema = z.object({
  scanId: z.string().trim().min(1).max(160).optional(),
  targets: z.array(z.string().trim().min(1).max(80)).max(20).default([...DEFAULT_SCAN_TARGETS]),
  chunkSize: z.number().int().positive().max(500).default(100),
  maxChunks: z.number().int().positive().max(50_000).default(10_000),
  timeoutMs: z.number().int().positive().max(300_000).default(120_000)
});
const catalogSearchToolSchema = z.object({
  query: z.string().trim().max(200).optional(),
  kind: z.string().trim().min(1).max(80).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  visual_tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  limit: z.number().int().positive().max(100).default(25)
});
const catalogClassToolSchema = z.object({
  className: z.string().trim().min(1).max(200)
});
const catalogTagsToolSchema = z.object({
  className: z.string().trim().min(1).max(200).optional()
});
const catalogMeasureClassToolSchema = z.object({
  className: z.string().trim().min(1).max(200),
  force: z.boolean().default(false),
  timeoutMs: z.number().int().positive().max(120_000).default(60_000)
});
const catalogMeasureSearchResultsToolSchema = catalogSearchToolSchema.extend({
  force: z.boolean().default(false),
  timeoutMs: z.number().int().positive().max(120_000).default(60_000)
});
const catalogMeasureMissingToolSchema = z.object({
  kinds: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  limit: z.number().int().positive().max(100).default(25),
  force: z.boolean().default(false),
  timeoutMs: z.number().int().positive().max(120_000).default(60_000)
});
const visualInspectClassToolSchema = z.object({
  className: z.string().trim().min(1).max(200),
  angles: z.array(z.string().trim().min(1).max(40)).max(16).default(["front", "left", "right", "rear"]),
  resolution: z.tuple([z.number().int().positive().max(7680), z.number().int().positive().max(4320)]).default([1280, 720]),
  force: z.boolean().default(false)
});
const visualAddTagToolSchema = z.object({
  className: z.string().trim().min(1).max(200),
  tag: z.string().trim().min(1).max(80),
  confidence: z.number().min(0).max(1).default(0.5),
  source: z.string().trim().min(1).max(80).default("manual")
});
const findByDimensionsToolSchema = z.object({
  minWidth: z.number().nonnegative().optional(),
  maxWidth: z.number().nonnegative().optional(),
  minDepth: z.number().nonnegative().optional(),
  maxDepth: z.number().nonnegative().optional(),
  minHeight: z.number().nonnegative().optional(),
  maxHeight: z.number().nonnegative().optional(),
  limit: z.number().int().positive().max(100).default(25)
});
const catalogRoleToolSchema = z.object({
  role: z.string().trim().min(1).max(120),
  limit: z.number().int().positive().max(100).default(25)
});
const findSimilarToolSchema = z.object({
  className: z.string().trim().min(1).max(200),
  limit: z.number().int().positive().max(100).default(25)
});
const compositionPlanToolSchema = z.object({
  name: z.string().trim().min(1).max(120).default("catalog-composition"),
  role: z.string().trim().min(1).max(120).optional(),
  classes: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  anchor: z
    .object({
      positionATL: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
      dir: z.number().default(0)
    })
    .default({ positionATL: [0, 0, 0], dir: 0 })
});
const compositionExportToolSchema = z.object({
  plan: z.record(z.string(), z.unknown())
});
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
  registerCatalogTools(server, state);
  registerCatalogMeasurementTools(server, state);
  registerEdenInspectionAliasTools(server, state);
  registerVisualAndCameraTools(server);
  registerCompositionCatalogTools(server);
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

function registerCatalogTools(server: McpServer, state: ArmaMcpState): void {
  server.registerTool(
    "arma.catalog.status",
    {
      title: "Catalog Status",
      description: "Inspect the local Arma catalog SQLite cache.",
      inputSchema: emptyInputSchema.shape
    },
    async () =>
      withCatalogDb((catalogDb) =>
        jsonToolResult({
          ok: true,
          catalog: getCatalogStatus(catalogDb)
        })
      )
  );

  server.registerTool(
    "arma.catalog.scan",
    {
      title: "Scan Loaded Arma Catalog",
      description: "Ask Eden to stream loaded config class chunks into the local SQLite catalog cache.",
      inputSchema: catalogScanToolSchema.shape
    },
    async (input) => {
      const parsed = catalogScanToolSchema.parse(input);
      return withCatalogDb(async (catalogDb) => {
        const started = await dispatchCatalogAction(state, "catalog.scanStart", {
          scanId: parsed.scanId,
          targets: parsed.targets,
          chunkSize: parsed.chunkSize
        }, parsed.timeoutMs);
        const startPayload = asRecord(started.result);
        const scanId = String(startPayload.scan_id ?? startPayload.scanId ?? parsed.scanId ?? new Date().toISOString());
        writeScanManifest(catalogDb, {
          scanId,
          gameVersion: stringOrNull(startPayload.game_version ?? startPayload.gameVersion),
          worldName: stringOrNull(startPayload.world_name ?? startPayload.worldName),
          loadedModsHash: stableHash(startPayload.loaded_mods ?? startPayload.loadedMods ?? []),
          loadedAddonsHash: stableHash(startPayload.loaded_addons ?? startPayload.loadedAddons ?? []),
          status: "running"
        });

        const counts: Record<string, number> = {};
        for (const target of parsed.targets) {
          let chunkIndex = 0;
          let finishedTarget = false;
          while (!finishedTarget) {
            if (chunkIndex >= parsed.maxChunks) {
              throw new Error(`Catalog scan exceeded maxChunks=${parsed.maxChunks} while scanning ${target}`);
            }
            const chunkResult = await dispatchCatalogAction(
              state,
              "catalog.scanChunk",
              { scanId, configPath: target, chunkIndex, chunkSize: parsed.chunkSize },
              parsed.timeoutMs
            );
            const chunk = asRecord(chunkResult.result) as CatalogChunk;
            counts[target] = (counts[target] ?? 0) + ingestCatalogChunk(catalogDb, scanId, chunk);
            finishedTarget = chunk.is_last_chunk === true || chunk.isLastChunk === true;
            chunkIndex += 1;
          }
        }

        await dispatchCatalogAction(state, "catalog.scanFinish", { scanId, classCounts: counts }, parsed.timeoutMs);
        writeScanManifest(catalogDb, {
          scanId,
          gameVersion: stringOrNull(startPayload.game_version ?? startPayload.gameVersion),
          worldName: stringOrNull(startPayload.world_name ?? startPayload.worldName),
          loadedModsHash: stableHash(startPayload.loaded_mods ?? startPayload.loadedMods ?? []),
          loadedAddonsHash: stableHash(startPayload.loaded_addons ?? startPayload.loadedAddons ?? []),
          classCounts: counts,
          finishedAt: new Date().toISOString(),
          status: "complete"
        });

        return jsonToolResult({ ok: true, scan_id: scanId, counts, catalog: getCatalogStatus(catalogDb) });
      });
    }
  );

  server.registerTool(
    "arma.catalog.search",
    {
      title: "Search Catalog",
      description: "Search cached Arma classes by text, kind, tags, or visual tags.",
      inputSchema: catalogSearchToolSchema.shape
    },
    async (input) => {
      const parsed = catalogSearchToolSchema.parse(input);
      return withCatalogDb((catalogDb) =>
        jsonToolResult({
          results: searchCatalogClasses(catalogDb, {
            query: parsed.query,
            kind: parsed.kind,
            tags: parsed.tags,
            visualTags: parsed.visual_tags,
            limit: parsed.limit
          })
        })
      );
    }
  );

  server.registerTool(
    "arma.catalog.getClass",
    {
      title: "Get Catalog Class",
      description: "Fetch one cached Arma class by class_name.",
      inputSchema: catalogClassToolSchema.shape
    },
    async (input) => {
      const parsed = catalogClassToolSchema.parse(input);
      return withCatalogDb((catalogDb) => jsonToolResult({ class: getCatalogClass(catalogDb, parsed.className) }));
    }
  );

  server.registerTool(
    "arma.catalog.getTags",
    {
      title: "Get Catalog Tags",
      description: "List tags for one class or aggregate tags for the whole catalog.",
      inputSchema: catalogTagsToolSchema.shape
    },
    async (input) => {
      const parsed = catalogTagsToolSchema.parse(input);
      return withCatalogDb((catalogDb) => jsonToolResult({ tags: getCatalogTags(catalogDb, parsed.className) }));
    }
  );

  server.registerTool(
    "arma.catalog.listMods",
    {
      title: "List Catalog Mods",
      description: "List loaded mods stored in the catalog cache.",
      inputSchema: emptyInputSchema.shape
    },
    async () => withCatalogDb((catalogDb) => jsonToolResult({ mods: listCatalogMods(catalogDb) }))
  );

  server.registerTool(
    "arma.catalog.listFactions",
    {
      title: "List Catalog Factions",
      description: "List factions discovered in the catalog cache.",
      inputSchema: emptyInputSchema.shape
    },
    async () => withCatalogDb((catalogDb) => jsonToolResult({ factions: listCatalogFactions(catalogDb) }))
  );

  server.registerTool(
    "arma.catalog.listCategories",
    {
      title: "List Catalog Categories",
      description: "List Eden editor categories discovered in the catalog cache.",
      inputSchema: emptyInputSchema.shape
    },
    async () => withCatalogDb((catalogDb) => jsonToolResult({ categories: listCatalogCategories(catalogDb) }))
  );
}

function registerCatalogMeasurementTools(server: McpServer, state: ArmaMcpState): void {
  server.registerTool(
    "arma.catalog.measureClass",
    {
      title: "Measure Catalog Class",
      description: "Measure one safe catalog class in Arma and store bounding dimensions.",
      inputSchema: catalogMeasureClassToolSchema.shape
    },
    async (input) => {
      const parsed = catalogMeasureClassToolSchema.parse(input);
      return withCatalogDb(async (catalogDb) =>
        jsonToolResult({ result: await measureCatalogClass(catalogDb, state, parsed.className, parsed.force, parsed.timeoutMs) })
      );
    }
  );

  server.registerTool(
    "arma.catalog.measureSearchResults",
    {
      title: "Measure Search Results",
      description: "Measure safe classes returned by a catalog search.",
      inputSchema: catalogMeasureSearchResultsToolSchema.shape
    },
    async (input) => {
      const parsed = catalogMeasureSearchResultsToolSchema.parse(input);
      return withCatalogDb(async (catalogDb) => {
        const results = searchCatalogClasses(catalogDb, {
          query: parsed.query,
          kind: parsed.kind,
          tags: parsed.tags,
          visualTags: parsed.visual_tags,
          limit: parsed.limit
        });
        const measured = [];
        for (const result of results) {
          measured.push(await measureCatalogClass(catalogDb, state, String(result.class_name), parsed.force, parsed.timeoutMs));
        }
        return jsonToolResult({ measured });
      });
    }
  );

  server.registerTool(
    "arma.catalog.measureMissing",
    {
      title: "Measure Missing Catalog Classes",
      description: "Measure safe catalog classes that do not have stored dimensions yet.",
      inputSchema: catalogMeasureMissingToolSchema.shape
    },
    async (input) => {
      const parsed = catalogMeasureMissingToolSchema.parse(input);
      return withCatalogDb(async (catalogDb) => {
        const candidates = listClassesMissingMeasurements(catalogDb, parsed.limit, parsed.kinds);
        const measured = [];
        for (const candidate of candidates) {
          measured.push(await measureCatalogClass(catalogDb, state, String(candidate.className), parsed.force, parsed.timeoutMs));
        }
        return jsonToolResult({ measured });
      });
    }
  );
}

function registerEdenInspectionAliasTools(server: McpServer, state: ArmaMcpState): void {
  server.registerTool(
    "arma.eden.listSelected",
    {
      title: "List Selected Eden Objects",
      description: "List selected Eden objects and enrich them from the local catalog cache when possible.",
      inputSchema: readOptionsSchema.shape
    },
    async (input) => {
      const parsed = readOptionsSchema.parse(input);
      const result = await dispatchCatalogAction(state, "eden.get_selection", parsed, 60_000);
      return withCatalogDb((catalogDb) => jsonToolResult(enrichEdenResult(catalogDb, result.result)));
    }
  );

  server.registerTool(
    "arma.eden.listPlaced",
    {
      title: "List Placed Eden Objects",
      description: "List placed Eden objects and enrich them from the local catalog cache when possible.",
      inputSchema: entityListToolSchema.shape
    },
    async (input) => {
      const parsed = entityListToolSchema.parse(input);
      const result = await dispatchCatalogAction(state, "eden.list_entities", parsed, 60_000);
      return withCatalogDb((catalogDb) => jsonToolResult(enrichEdenResult(catalogDb, result.result)));
    }
  );

  server.registerTool(
    "arma.eden.getObject",
    {
      title: "Get Eden Object",
      description: "Fetch one Eden object snapshot and enrich it from the catalog cache when possible.",
      inputSchema: getEntitySnapshotToolSchema.shape
    },
    async (input) => {
      const parsed = getEntitySnapshotToolSchema.parse(input);
      const result = await dispatchCatalogAction(state, "eden.get_entity_snapshot", parsed, 60_000);
      return withCatalogDb((catalogDb) => jsonToolResult(enrichEdenResult(catalogDb, result.result)));
    }
  );

  server.registerTool(
    "arma.eden.getSynced",
    {
      title: "Get Eden Sync Relationships",
      description: "Return sync relationship fields currently exposed by Eden snapshots.",
      inputSchema: getEntitySnapshotToolSchema.shape
    },
    async (input) => {
      const parsed = getEntitySnapshotToolSchema.parse(input);
      const result = await dispatchCatalogAction(state, "eden.get_entity_snapshot", parsed, 60_000);
      const snapshot = asRecord(asRecord(result.result).snapshot);
      return jsonToolResult({
        entityId: parsed.entityId,
        synced_to: snapshot.synced_to ?? [],
        attached_to: snapshot.attached_to ?? null,
        note: "Sync relationship extraction is limited to fields currently exposed by the Eden snapshot handler."
      });
    }
  );

  server.registerTool(
    "arma.eden.exportSelection",
    {
      title: "Export Eden Selection",
      description: "Capture selected Eden objects as a data-only composition export.",
      inputSchema: captureCompositionToolSchema.shape
    },
    async (input) => {
      const parsed = captureCompositionToolSchema.parse(input);
      const result = await dispatchCatalogAction(state, "eden.capture_composition", parsed, 60_000);
      return jsonToolResult(result.result);
    }
  );
}

function registerVisualAndCameraTools(server: McpServer): void {
  for (const toolName of [
    "arma.camera.createPreviewScene",
    "arma.camera.inspectClass",
    "arma.camera.captureClassAngles",
    "arma.camera.captureCurrentView",
    "arma.camera.destroyPreviewScene"
  ]) {
    server.registerTool(
      toolName,
      {
        title: toolName,
        description: "Camera preview interface placeholder; screenshot capture backend is not implemented yet.",
        inputSchema: emptyInputSchema.shape
      },
      async () => jsonToolResult({ ok: false, error: { code: "screenshot_capture_not_implemented" } })
    );
  }

  server.registerTool(
    "arma.visual.inspectClass",
    {
      title: "Inspect Class Visually",
      description: "Create visual inspection bookkeeping and return a clear non-fatal screenshot backend error.",
      inputSchema: visualInspectClassToolSchema.shape
    },
    async (input) => {
      const parsed = visualInspectClassToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        const catalogClass = getCatalogClass(catalogDb, parsed.className);
        if (!catalogClass) {
          throw new Error(`Class ${parsed.className} is not present in the local catalog cache`);
        }
        if (!parsed.force && !isSafeToMeasure(catalogClass)) {
          throw new Error(`Class ${parsed.className} is not safe for visual inspection without force=true`);
        }
        const screenshotDir = `.mcp-cache/arma/screenshots/${safePathSegment(parsed.className)}`;
        mkdirSync(screenshotDir, { recursive: true });
        const runId = createVisualInspectionRun(catalogDb, {
          className: parsed.className,
          status: "failed",
          error: "screenshot_capture_not_implemented",
          angles: parsed.angles,
          screenshotDir,
          resolution: parsed.resolution
        });
        return jsonToolResult({
          ok: false,
          inspectionRunId: runId,
          screenshotDir,
          error: { code: "screenshot_capture_not_implemented" }
        });
      });
    }
  );

  server.registerTool(
    "arma.visual.getScreenshots",
    {
      title: "Get Class Screenshots",
      description: "List stored screenshot metadata for one catalog class.",
      inputSchema: catalogClassToolSchema.shape
    },
    async (input) => {
      const parsed = catalogClassToolSchema.parse(input);
      return withCatalogDb((catalogDb) => jsonToolResult({ screenshots: listClassScreenshots(catalogDb, parsed.className) }));
    }
  );

  server.registerTool(
    "arma.visual.addTag",
    {
      title: "Add Visual Tag",
      description: "Manually add a visual tag to a catalog class and update FTS.",
      inputSchema: visualAddTagToolSchema.shape
    },
    async (input) => {
      const parsed = visualAddTagToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        addCatalogVisualTag(catalogDb, {
          className: parsed.className,
          tag: parsed.tag,
          confidence: parsed.confidence,
          source: parsed.source
        });
        return jsonToolResult({ ok: true, className: parsed.className, tag: parsed.tag });
      });
    }
  );

  server.registerTool(
    "arma.visual.findByVisualTags",
    {
      title: "Find By Visual Tags",
      description: "Search catalog classes by stored visual tags.",
      inputSchema: z.object({ visual_tags: z.array(z.string().min(1)).min(1).max(20), limit: z.number().int().positive().max(100).default(25) }).shape
    },
    async (input) => {
      const parsed = z
        .object({ visual_tags: z.array(z.string().min(1)).min(1).max(20), limit: z.number().int().positive().max(100).default(25) })
        .parse(input);
      return withCatalogDb((catalogDb) =>
        jsonToolResult({ results: searchCatalogClasses(catalogDb, { visualTags: parsed.visual_tags, limit: parsed.limit }) })
      );
    }
  );
}

function registerCompositionCatalogTools(server: McpServer): void {
  server.registerTool(
    "arma.catalog.recommend",
    {
      title: "Recommend Catalog Assets",
      description: "Recommend cached catalog assets by role/tag text.",
      inputSchema: catalogRoleToolSchema.shape
    },
    async (input) => {
      const parsed = catalogRoleToolSchema.parse(input);
      return withCatalogDb((catalogDb) => jsonToolResult({ results: searchCatalogClasses(catalogDb, { query: parsed.role, limit: parsed.limit }) }));
    }
  );

  server.registerTool(
    "arma.catalog.findByRole",
    {
      title: "Find Catalog Assets By Role",
      description: "Find cached assets by role or tag.",
      inputSchema: catalogRoleToolSchema.shape
    },
    async (input) => {
      const parsed = catalogRoleToolSchema.parse(input);
      return withCatalogDb((catalogDb) =>
        jsonToolResult({ results: searchCatalogClasses(catalogDb, { query: parsed.role, tags: [parsed.role], limit: parsed.limit }) })
      );
    }
  );

  server.registerTool(
    "arma.catalog.findSimilar",
    {
      title: "Find Similar Catalog Assets",
      description: "Find assets sharing kind and tags with a cached class.",
      inputSchema: findSimilarToolSchema.shape
    },
    async (input) => {
      const parsed = findSimilarToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        const catalogClass = getCatalogClass(catalogDb, parsed.className);
        if (!catalogClass) {
          return jsonToolResult({ results: [] });
        }
        const tags = Array.isArray(catalogClass.tags) ? catalogClass.tags.map(String).slice(0, 3) : [];
        return jsonToolResult({
          results: searchCatalogClasses(catalogDb, { kind: String(catalogClass.kind ?? ""), tags, limit: parsed.limit }).filter(
            (item) => item.class_name !== parsed.className
          )
        });
      });
    }
  );

  server.registerTool(
    "arma.catalog.findByDimensions",
    {
      title: "Find Catalog Assets By Dimensions",
      description: "Find measured assets within dimension ranges.",
      inputSchema: findByDimensionsToolSchema.shape
    },
    async (input) => {
      const parsed = findByDimensionsToolSchema.parse(input);
      return withCatalogDb((catalogDb) => jsonToolResult({ results: findCatalogByDimensions(catalogDb, parsed) }));
    }
  );

  server.registerTool(
    "arma.composition.plan",
    {
      title: "Plan Composition",
      description: "Create a data-only composition plan from cached classes; does not apply anything to Eden.",
      inputSchema: compositionPlanToolSchema.shape
    },
    async (input) => {
      const parsed = compositionPlanToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        const classNames =
          parsed.classes && parsed.classes.length > 0
            ? parsed.classes
            : searchCatalogClasses(catalogDb, { query: parsed.role, limit: 10 }).map((item) => String(item.class_name));
        return jsonToolResult({ plan: createDataOnlyCompositionPlan(parsed.name, classNames, parsed.anchor) });
      });
    }
  );

  server.registerTool(
    "arma.composition.previewLocal",
    {
      title: "Preview Composition Locally",
      description: "Return the composition plan as a non-applying local preview payload.",
      inputSchema: compositionExportToolSchema.shape
    },
    async (input) => jsonToolResult({ ok: true, previewOnly: true, plan: compositionExportToolSchema.parse(input).plan })
  );

  server.registerTool(
    "arma.composition.exportSqf",
    {
      title: "Export Composition SQF",
      description: "Export a data-only composition plan as SQF text without running it.",
      inputSchema: compositionExportToolSchema.shape
    },
    async (input) => jsonToolResult({ sqf: exportPlanSqf(compositionExportToolSchema.parse(input).plan) })
  );

  server.registerTool(
    "arma.composition.exportEdenInstructions",
    {
      title: "Export Eden Instructions",
      description: "Export human-readable Eden placement instructions from a data-only composition plan.",
      inputSchema: compositionExportToolSchema.shape
    },
    async (input) => jsonToolResult({ instructions: exportEdenInstructions(compositionExportToolSchema.parse(input).plan) })
  );
}

async function measureCatalogClass(
  catalogDb: ReturnType<typeof openCatalogDb>,
  state: ArmaMcpState,
  className: string,
  force: boolean,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const catalogClass = getCatalogClass(catalogDb, className);
  if (!catalogClass) {
    return { className, status: "failed", error: "class_not_in_catalog" };
  }
  if (!force && !isSafeToMeasure(catalogClass)) {
    writeClassMeasurement(catalogDb, className, {
      status: "skipped",
      error: "class_not_safe_to_measure_without_force"
    });
    return { className, status: "skipped", error: "class_not_safe_to_measure_without_force" };
  }

  const result = await dispatchCatalogAction(state, "catalog.measureClass", { className }, timeoutMs);
  const payload = asRecord(result.result);
  const measurement = asRecord(payload.measurement ?? payload);
  const status = payload.status === "failed" || measurement.status === "failed" ? "failed" : "measured";
  writeClassMeasurement(catalogDb, className, {
    status,
    error: stringOrNull(payload.error ?? measurement.error),
    bboxMin: vectorOrNull(measurement.bbox_min ?? measurement.bboxMin),
    bboxMax: vectorOrNull(measurement.bbox_max ?? measurement.bboxMax),
    center: vectorOrNull(measurement.center),
    widthM: numberOrNull(measurement.width_m ?? measurement.widthM),
    depthM: numberOrNull(measurement.depth_m ?? measurement.depthM),
    heightM: numberOrNull(measurement.height_m ?? measurement.heightM),
    sizeOf: numberOrNull(measurement.size_of ?? measurement.sizeOf)
  });
  return { className, status, measurement };
}

function isSafeToMeasure(catalogClass: Record<string, unknown>): boolean {
  const kind = String(catalogClass.kind ?? "");
  const subkind = String(catalogClass.subkind ?? "");
  const scope = typeof catalogClass.scope === "number" ? catalogClass.scope : Number(catalogClass.scope ?? 1);
  const modelPath = String(catalogClass.model_path ?? "");
  if (scope <= 0 || !modelPath) {
    return false;
  }
  if (["unit", "vehicle", "ammo", "module"].includes(kind)) {
    return false;
  }
  return ["prop", "structure", "fortification", "supply", "decor"].includes(kind) || ["terminal", "console"].includes(subkind);
}

function enrichEdenResult(catalogDb: ReturnType<typeof openCatalogDb>, input: unknown): Record<string, unknown> {
  const payload = asRecord(input);
  if (Array.isArray(payload.entities)) {
    return { ...payload, entities: payload.entities.map((entity) => enrichEdenEntity(catalogDb, asRecord(entity))) };
  }
  if (payload.snapshot) {
    return { ...payload, snapshot: enrichEdenEntity(catalogDb, asRecord(payload.snapshot)) };
  }
  return payload;
}

function enrichEdenEntity(catalogDb: ReturnType<typeof openCatalogDb>, entity: Record<string, unknown>): Record<string, unknown> {
  const className = String(entity.className ?? entity.class_name ?? "");
  if (!className) {
    return entity;
  }
  const catalogClass = getCatalogClass(catalogDb, className);
  if (!catalogClass) {
    return entity;
  }
  return {
    ...entity,
    catalog: {
      kind: catalogClass.kind ?? null,
      subkind: catalogClass.subkind ?? null,
      tags: catalogClass.tags ?? [],
      dimensions:
        catalogClass.width_m === null || catalogClass.depth_m === null || catalogClass.height_m === null
          ? null
          : {
              width_m: catalogClass.width_m,
              depth_m: catalogClass.depth_m,
              height_m: catalogClass.height_m
            },
      source_mod: catalogClass.source_mod_guess ?? null,
      editor_category: catalogClass.editor_category ?? null,
      editor_subcategory: catalogClass.editor_subcategory ?? null
    }
  };
}

function safePathSegment(input: string): string {
  return input.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 160) || "class";
}

function createDataOnlyCompositionPlan(name: string, classNames: string[], anchor: { positionATL: [number, number, number]; dir: number }) {
  return {
    schemaVersion: 1,
    name,
    dryRun: true,
    anchor,
    operations: classNames.map((className, index) => ({
      op: "create_entity",
      clientRef: `catalog_${index + 1}`,
      type: "Object",
      className,
      transform: {
        positionATL: [index * 2, 0, 0],
        dir: 0
      }
    }))
  };
}

function exportPlanSqf(plan: Record<string, unknown>): string {
  const operations = Array.isArray(plan.operations) ? plan.operations.map(asRecord) : [];
  return operations
    .filter((operation) => operation.op === "create_entity" && operation.className)
    .map((operation) => {
      const transform = asRecord(operation.transform);
      const position = Array.isArray(transform.positionATL) ? transform.positionATL : [0, 0, 0];
      const dir = typeof transform.dir === "number" ? transform.dir : 0;
      return `private _obj = createVehicle [${JSON.stringify(operation.className)}, ${JSON.stringify(position)}, [], 0, "CAN_COLLIDE"]; _obj setDir ${dir};`;
    })
    .join("\n");
}

function exportEdenInstructions(plan: Record<string, unknown>): string[] {
  const operations = Array.isArray(plan.operations) ? plan.operations.map(asRecord) : [];
  return operations.map((operation, index) => {
    const transform = asRecord(operation.transform);
    return `${index + 1}. Place ${String(operation.className ?? "unknown class")} at ${JSON.stringify(transform.positionATL ?? [0, 0, 0])} facing ${String(transform.dir ?? 0)} degrees.`;
  });
}

async function withCatalogDb<T>(callback: (catalogDb: ReturnType<typeof openCatalogDb>) => T | Promise<T>): Promise<T> {
  const catalogDb = openCatalogDb();
  try {
    ensureCatalogSchema(catalogDb);
    return await callback(catalogDb);
  } finally {
    closeCatalogDb(catalogDb);
  }
}

async function dispatchCatalogAction(
  state: ArmaMcpState,
  action: ArmaMcpActionName,
  params: Record<string, unknown>,
  timeoutMs: number
) {
  const queued = state.queueAction({ action, mode: "read", params, timeoutMs });
  const result = await queued.result;
  if (!result.ok) {
    throw new Error(result.error?.message ?? `Arma action ${action} failed`);
  }
  return result;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function stringOrNull(input: unknown): string | null {
  return typeof input === "string" ? input : null;
}

function numberOrNull(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function vectorOrNull(input: unknown): [number, number, number] | null {
  if (!Array.isArray(input) || input.length < 3) {
    return null;
  }
  const vector = input.slice(0, 3);
  return vector.every((item) => typeof item === "number" && Number.isFinite(item))
    ? (vector as [number, number, number])
    : null;
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
