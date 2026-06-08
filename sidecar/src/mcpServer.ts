import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { BridgeConfig } from "./httpBridge.js";
import { DEFAULT_SCAN_TARGETS, ingestCatalogChunk, stableHash, type CatalogChunk } from "./catalog.js";
import {
  addCatalogVisualTag,
  closeCatalogDb,
  countCatalogClassesForScanTarget,
  createVisualInspectionRun,
  ensureCatalogSchema,
  findCatalogByDimensions,
  finishVisualInspectionRun,
  getCatalogSearchDiagnostics,
  getCatalogClass,
  getCatalogStatus,
  getCatalogTags,
  getScanManifest,
  getScanProgress,
  initializeScanTargets,
  listCatalogCategories,
  listCatalogFactions,
  listClassesMissingMeasurements,
  listClassScreenshots,
  listCatalogMods,
  markScanFinished,
  markStaleScans,
  openCatalogDb,
  repairStaleScan,
  searchCatalogClasses,
  insertClassScreenshot,
  writeScanTargetProgress,
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
import { mirrorProfileScreenshot, screenshotCacheDir } from "./screenshotPaths.js";
import {
  compositionPlanSchema,
  generateCheckpointPlanInputSchema,
  getBridgeEventsInputSchema,
  getSnapshotInputSchema,
  queueApplyPlanInputSchema,
  requestSnapshotInputSchema
} from "./schema.js";
import type { SidecarRuntimeInfo } from "./runtime.js";
import type { ArmaMcpState } from "./state.js";

const emptyInputSchema = z.object({});
export const MCP_DISCOVERY_FALLBACK_TOOL_NAMES = [
  "arma.bridge.diagnostics",
  "arma.bridge.get_capabilities",
  "arma.bridge.ping",
  "arma.camera.captureClassAngles",
  "arma.camera.createPreviewScene",
  "arma.camera.inspectClass",
  "arma_catalog_find_by_role",
  "arma_catalog_get_class",
  "arma_catalog_search",
  "arma_catalog_status",
  "arma_composition_plan",
  "arma_eden_list_placed",
  "arma_visual_inspect_class",
  "arma.eden.inspectClass",
  "arma.eden.planComposition",
  "arma.catalog.scanStart",
  "arma.catalog.scan",
  "arma.catalog.scanStatus",
  "arma.catalog.scanPoll",
  "arma.catalog.scanCancel",
  "arma.catalog.scanFinalize",
  "arma.catalog.scanRepair",
  "arma.catalog.search",
  "arma.catalog.status",
  "arma.catalog.getClass",
  "arma.catalog.getTags",
  "arma.catalog.listMods",
  "arma.catalog.listFactions",
  "arma.catalog.listCategories",
  "arma.catalog.measureClass",
  "arma.catalog.measureSearchResults",
  "arma.catalog.measureMissing",
  "arma.catalog.recommend",
  "arma.catalog.findByRole",
  "arma.catalog.findSimilar",
  "arma.catalog.findByDimensions",
  "arma.assets.search_classes",
  "arma.assets.get_class",
  "arma.composition.plan",
  "arma.composition.previewLocal",
  "arma.composition.exportSqf",
  "arma.composition.exportEdenInstructions",
  "arma.eden.apply_composition",
  "arma.eden.capture_composition",
  "arma.eden.exportSelection",
  "arma.eden.batch",
  "arma.eden.create_entity",
  "arma.eden.find_entities",
  "arma.eden.getObject",
  "arma.eden.get_connections",
  "arma.eden.get_synced",
  "arma.eden.getSynced",
  "arma.eden.list_layers",
  "arma.eden.create_layer",
  "arma.eden.assign_layer",
  "arma.eden.remove_from_layer",
  "arma.eden.set_layer_attributes",
  "arma.eden.delete_layer",
  "arma.eden.sync_entities",
  "arma.eden.unsync_entities",
  "arma.eden.generate_aa_site",
  "arma.eden.generate_cover_line",
  "arma.eden.generate_lz",
  "arma.eden.generate_prop_wall",
  "arma.eden.generate_road_checkpoint",
  "arma.eden.generate_small_outpost",
  "arma.eden.listPlaced",
  "arma.eden.list_entities",
  "arma.eden.set_entity_transform",
  "arma.eden.validate_plan",
  "arma.terrain.sample_area",
  "arma.terrain.find_flat_area",
  "arma.terrain.find_nearest_roads",
  "arma.spatial.check_collision",
  "arma.spatial.score_placement",
  "arma.spatial.line_of_sight",
  "arma.spatial.find_cover_positions",
  "arma.spatial.find_lz_candidates",
  "arma.visual.inspectClass",
  "arma.visual.getScreenshots",
  "arma.visual.addTag",
  "arma.visual.findByVisualTags",
  "arma_queue_apply_plan",
  "arma_request_editor_snapshot"
] as const;
type CatalogScanJob = {
  scanId: string;
  targets: string[];
  chunkSize: number;
  currentChunkSize: number;
  minChunkSize: number;
  adaptiveChunkSizing: boolean;
  includeRaw: boolean;
  maxChunks: number;
  timeoutMs: number;
  cancelRequested: boolean;
  promise?: Promise<void>;
};
const catalogScanJobs = new Map<string, CatalogScanJob>();
const terminalCatalogScanStatuses = new Set(["complete", "failed", "cancelled"]);
const catalogScanToolSchema = z.object({
  scanId: z.string().trim().min(1).max(160).optional(),
  targets: z.array(z.string().trim().min(1).max(80)).max(20).default([...DEFAULT_SCAN_TARGETS]),
  chunkSize: z.number().int().positive().max(500).default(100),
  minChunkSize: z.number().int().positive().max(500).default(25),
  adaptiveChunkSizing: z.boolean().default(true),
  includeRaw: z.boolean().default(false),
  maxChunks: z.number().int().positive().max(50_000).default(10_000),
  timeoutMs: z.number().int().positive().max(120_000).default(60_000),
  background: z.boolean().default(true)
});
const managedDiscoveryFallbackCallSchema = z.object({
  toolName: z.enum(MCP_DISCOVERY_FALLBACK_TOOL_NAMES),
  input: z.record(z.string(), z.unknown()).default({})
});
const catalogScanStatusToolSchema = z.object({
  scanId: z.string().trim().min(1).max(160).optional()
});
const catalogScanPollToolSchema = z.object({
  scanId: z.string().trim().min(1).max(160).optional(),
  maxChunks: z.number().int().positive().max(100).default(5),
  maxRuntimeMs: z.number().int().positive().max(55_000).default(45_000),
  timeoutMs: z.number().int().positive().max(120_000).default(60_000)
});
const catalogScanCancelToolSchema = z.object({
  scanId: z.string().trim().min(1).max(160)
});
const catalogScanFinalizeToolSchema = z.object({
  scanId: z.string().trim().min(1).max(160).optional(),
  timeoutMs: z.number().int().positive().max(120_000).default(60_000)
});

export function pruneTerminalCatalogScanJobIds<T extends { promise?: Promise<void> }>(
  jobs: Map<string, T>,
  getScanStatus: (scanId: string) => string | null | undefined
): string[] {
  for (const [scanId] of jobs) {
    const status = getScanStatus(scanId);
    if (!status || terminalCatalogScanStatuses.has(String(status))) {
      jobs.delete(scanId);
    }
  }
  return [...jobs.keys()];
}

function pruneTerminalCatalogScanJobs(catalogDb: ReturnType<typeof openCatalogDb>): string[] {
  return pruneTerminalCatalogScanJobIds(catalogScanJobs, (scanId) => {
    const status = getScanManifest(catalogDb, scanId)?.status;
    return typeof status === "string" ? status : null;
  });
}

function clearCatalogScanJobIfTerminal(scanId: string, scan: Record<string, unknown> | null | undefined): void {
  const status = String(scan?.status ?? asRecord(scan?.manifest).status ?? "");
  if (terminalCatalogScanStatuses.has(status)) {
    catalogScanJobs.delete(scanId);
  }
}
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
  angles: z.array(z.string().trim().min(1).max(40)).max(16).default(["front", "left", "right", "back", "top", "iso"]),
  resolution: z.tuple([z.number().int().positive().max(7680), z.number().int().positive().max(4320)]).default([1280, 720]),
  force: z.boolean().default(false),
  distance: z.number().positive().max(100).default(8),
  height: z.number().min(-10).max(100).default(2.2),
  fov: z.number().positive().max(2).default(0.7),
  settleSeconds: z.number().nonnegative().max(5).default(0.25),
  timeoutMs: z.number().int().positive().max(120_000).default(60_000)
});
const cameraPreviewSceneToolSchema = z.object({
  className: z.string().trim().min(1).max(200),
  positionATL: vector3Schema.default([0, 0, 0]),
  dir: z.number().default(0),
  angles: z.array(z.string().trim().min(1).max(40)).max(16).default(["iso"]),
  distance: z.number().positive().max(100).default(8),
  height: z.number().min(-10).max(100).default(2.2),
  fov: z.number().positive().max(2).default(0.7),
  settleSeconds: z.number().nonnegative().max(5).default(0.25),
  timeoutMs: z.number().int().positive().max(120_000).default(60_000)
});
const cameraCaptureClassAnglesToolSchema = cameraPreviewSceneToolSchema.extend({
  angles: z.array(z.string().trim().min(1).max(40)).min(1).max(16).default(["front", "left", "right", "back", "top", "iso"]),
  runId: z.string().trim().min(1).max(160).optional()
});
const cameraCaptureCurrentViewToolSchema = z.object({
  filename: z.string().trim().min(1).max(240).optional(),
  runId: z.string().trim().min(1).max(160).optional(),
  timeoutMs: z.number().int().positive().max(120_000).default(60_000)
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
const assetGetClassToolSchema = z.object({
  className: z.string().trim().min(1).max(200),
  configRoot: z.string().trim().min(1).max(80).optional()
});
const terrainSampleAreaToolSchema = z.object({
  centerATL: vector3Schema,
  radiusMeters: z.number().positive().max(500),
  spacingMeters: z.number().positive().max(100).default(10),
  includeWater: z.boolean().default(true),
  includeSurfaceNormal: z.boolean().default(false),
  includeSurfaceType: z.boolean().default(false),
  includeRoads: z.boolean().default(false),
  includeNearbyObjects: z.boolean().default(false),
  nearbyObjectTypes: z.array(z.string().trim().min(1).max(80)).max(20).optional()
});
const terrainFindFlatAreaToolSchema = z.object({
  centerATL: vector3Schema,
  searchRadiusMeters: z.number().positive().max(2_000).default(250),
  sampleRadiusMeters: z.number().positive().max(250).default(25),
  spacingMeters: z.number().positive().max(100).default(10),
  maxSlopeDeg: z.number().nonnegative().max(45).default(8),
  allowWater: z.boolean().default(false),
  limit: z.number().int().positive().max(50).default(10)
});
const terrainFindNearestRoadsToolSchema = z.object({
  positionATL: vector3Schema,
  radiusMeters: z.number().positive().max(5_000).default(100),
  limit: z.number().int().positive().max(50).default(10),
  extendedConnections: z.boolean().default(true)
});
const spatialPlanOperationSchema = z
  .object({
    clientRef: z.string().min(1).max(120).optional(),
    className: z.string().trim().min(1).max(160).optional(),
    type: entityTypeSchema.optional(),
    transform: transformSchema.optional(),
    radiusMeters: z.number().positive().max(500).optional()
  })
  .passthrough();
const spatialCheckCollisionToolSchema = z.object({
  operations: z.array(spatialPlanOperationSchema).max(250).default([]),
  positionATL: vector3Schema.optional(),
  radiusMeters: z.number().positive().max(500).default(5),
  terrainObjectTypes: z.array(z.string().trim().min(1).max(80)).max(20).default(["HOUSE", "WALL", "ROCK", "TREE", "ROAD"]),
  includeTerrainObjects: z.boolean().default(true)
});
const spatialScorePlacementToolSchema = z.object({
  positionATL: vector3Schema,
  radiusMeters: z.number().positive().max(500).default(25),
  intendedUse: z.enum(["generic", "road_checkpoint", "lz", "aa_site", "cover", "outpost"]).default("generic"),
  maxSlopeDeg: z.number().nonnegative().max(45).default(10),
  requireRoad: z.boolean().default(false),
  avoidWater: z.boolean().default(true),
  spacingMeters: z.number().positive().max(100).default(10)
});
const spatialLineOfSightToolSchema = z.object({
  fromASL: vector3Schema.optional(),
  toASL: vector3Schema.optional(),
  fromATL: vector3Schema.optional(),
  toATL: vector3Schema.optional(),
  samples: z
    .array(
      z.object({
        fromASL: vector3Schema.optional(),
        toASL: vector3Schema.optional(),
        fromATL: vector3Schema.optional(),
        toATL: vector3Schema.optional()
      })
    )
    .max(50)
    .optional()
});
const spatialFindCoverPositionsToolSchema = z.object({
  centerATL: vector3Schema,
  threatDirectionDeg: z.number().default(0),
  radiusMeters: z.number().positive().max(500).default(50),
  limit: z.number().int().positive().max(50).default(10),
  objectTypes: z.array(z.string().trim().min(1).max(80)).max(20).default(["WALL", "ROCK", "TREE", "HOUSE", "FENCE"])
});
const spatialFindLzCandidatesToolSchema = z.object({
  centerATL: vector3Schema,
  searchRadiusMeters: z.number().positive().max(2_000).default(300),
  lzRadiusMeters: z.number().positive().max(250).default(30),
  spacingMeters: z.number().positive().max(100).default(25),
  maxSlopeDeg: z.number().nonnegative().max(45).default(6),
  limit: z.number().int().positive().max(50).default(10)
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
const connectionToolSchema = z.object({
  entityIds: z.array(entityIdSchema).min(1).max(100).optional(),
  entityId: entityIdSchema.optional(),
  connectionType: z.string().trim().min(1).max(80).default("Sync")
});
const mutateConnectionToolSchema = writeBaseSchema.extend({
  entityIds: z.array(entityIdSchema).min(1).max(100),
  targetEntityId: entityIdSchema,
  connectionType: z.string().trim().min(1).max(80).default("Sync")
});
const createLayerToolSchema = writeBaseSchema.extend({
  name: z.string().trim().min(1).max(160),
  parentLayerId: z.number().int().default(-1)
});
const layerRefSchema = z.object({
  layerId: z.number().int().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  createIfMissing: z.boolean().default(false),
  parentLayerId: z.number().int().default(-1)
});
const assignLayerToolSchema = writeBaseSchema.extend({
  entityIds: z.array(entityIdSchema).min(1).max(100),
  layer: layerRefSchema
});
const removeFromLayerToolSchema = writeBaseSchema.extend({
  entityIds: z.array(entityIdSchema).min(1).max(100)
});
const setLayerAttributesToolSchema = writeBaseSchema.extend({
  layer: layerRefSchema,
  attributes: z.record(z.string(), z.unknown())
});
const deleteLayerToolSchema = writeBaseSchema.extend({
  layer: layerRefSchema,
  deleteEntities: z.boolean().default(false)
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
      "unsync_entities",
      "assign_layer",
      "remove_from_layer",
      "create_layer",
      "create_marker",
      "create_trigger",
      "create_waypoint",
      "create_module"
    ]),
    clientRef: z.string().min(1).max(120).optional(),
    entityId: entityIdSchema.optional(),
    entityIds: z.array(entityIdSchema).max(100).optional(),
    targetEntityId: entityIdSchema.optional(),
    connectionType: z.string().trim().min(1).max(80).optional(),
    type: entityTypeSchema.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    className: z.string().trim().min(1).max(160).optional(),
    transform: transformSchema.optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    text: z.string().max(500).optional(),
    markerType: z.string().trim().min(1).max(80).optional(),
    color: z.string().trim().min(1).max(80).optional(),
    shape: z.string().trim().min(1).max(80).optional(),
    size: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
    alpha: z.number().min(0).max(1).optional(),
    layer: z.union([z.string().max(160), layerRefSchema]).optional(),
    parentLayerId: z.number().int().optional()
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

export function createMcpServer(state: ArmaMcpState, bridgeConfig: BridgeConfig, runtimeInfo?: SidecarRuntimeInfo): McpServer {
  const server = new McpServer({
    name: "arma-mcp",
    version: "0.1.0"
  });
  const runtime: SidecarRuntimeInfo = runtimeInfo ?? {
    mode: "stdio",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ownsHttpListener: true,
    skipHttpListen: false,
    httpBridgeUrl: `http://${bridgeConfig.host}:${bridgeConfig.port}`,
    nodeVersion: process.version
  };

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
        runtime,
        httpBridge: { host: bridgeConfig.host, port: bridgeConfig.port }
      })
  );
  registerManagedDiscoveryFallbackTools(server, state, bridgeConfig, runtime);
  registerPriorityEdenWorkflowTools(server, state);

  server.registerTool(
    "arma.bridge.get_status",
    {
      title: "Bridge Status",
      description: "Check sidecar queue and most recent Eden contact.",
      inputSchema: emptyInputSchema.shape
    },
    async () => {
      const status = await readBridgeStatus(state);
      if (!status.ok) {
        return jsonToolResult({
          sidecarConnected: true,
          bridgeReachable: false,
          armaConnected: false,
          edenAvailable: false,
          pendingActions: null,
          pendingResults: null,
          lastSeenAt: null,
          runtime,
          httpBridge: { host: bridgeConfig.host, port: bridgeConfig.port },
          error: status.error
        });
      }
      return jsonToolResult({
        sidecarConnected: true,
        bridgeReachable: true,
        armaConnected: status.lastSeenAt !== null,
        edenAvailable: status.lastSeenAt !== null,
        pendingActions: status.pendingCommandCount,
        pendingResults: status.pendingActionCount,
        lastSeenAt: status.lastSeenAt,
        lastSnapshotAt: status.lastSnapshotAt,
        runtime,
        diagnostics: status.diagnostics ?? null,
        httpBridge: { host: bridgeConfig.host, port: bridgeConfig.port }
      });
    }
  );

  server.registerTool(
    "arma.bridge.diagnostics",
    {
      title: "Bridge Diagnostics",
      description: "Report MCP stdio process identity, HTTP bridge reachability, and recent bridge activity.",
      inputSchema: emptyInputSchema.shape
    },
    async () => {
      const status = await readBridgeStatus(state);
      return jsonToolResult({
        sidecarConnected: true,
        runtime,
        httpBridge: { host: bridgeConfig.host, port: bridgeConfig.port, url: runtime.httpBridgeUrl },
        bridgeReachable: status.ok,
        armaConnected: status.ok ? status.lastSeenAt !== null : false,
        edenAvailable: status.ok ? status.lastSeenAt !== null : false,
        lastSeenAt: status.ok ? status.lastSeenAt : null,
        lastSnapshotAt: status.ok ? status.lastSnapshotAt : null,
        pendingActions: status.ok ? status.pendingCommandCount : null,
        pendingResults: status.ok ? status.pendingActionCount : null,
        diagnostics: status.ok ? status.diagnostics ?? null : null,
        error: status.ok ? null : status.error
      });
    }
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
    "arma.assets.get_class",
    "assets.get_class",
    "read",
    assetGetClassToolSchema,
    "Get Arma Class"
  );
  registerCatalogTools(server, state);
  registerCatalogMeasurementTools(server, state);
  registerEdenInspectionAliasTools(server, state);
  registerVisualAndCameraTools(server, state);
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
    "arma.terrain.find_flat_area",
    "terrain.find_flat_area",
    "read",
    terrainFindFlatAreaToolSchema,
    "Find Flat Terrain Area"
  );
  registerActionTool(
    server,
    state,
    "arma.terrain.find_nearest_roads",
    "terrain.find_nearest_roads",
    "read",
    terrainFindNearestRoadsToolSchema,
    "Find Nearest Roads"
  );
  registerActionTool(
    server,
    state,
    "arma.spatial.check_collision",
    "spatial.check_collision",
    "read",
    spatialCheckCollisionToolSchema,
    "Check Spatial Collision"
  );
  registerActionTool(
    server,
    state,
    "arma.spatial.score_placement",
    "spatial.score_placement",
    "read",
    spatialScorePlacementToolSchema,
    "Score Spatial Placement"
  );
  registerActionTool(
    server,
    state,
    "arma.spatial.line_of_sight",
    "spatial.line_of_sight",
    "read",
    spatialLineOfSightToolSchema,
    "Check Line Of Sight"
  );
  registerActionTool(
    server,
    state,
    "arma.spatial.find_cover_positions",
    "spatial.find_cover_positions",
    "read",
    spatialFindCoverPositionsToolSchema,
    "Find Cover Positions"
  );
  registerActionTool(
    server,
    state,
    "arma.spatial.find_lz_candidates",
    "spatial.find_lz_candidates",
    "read",
    spatialFindLzCandidatesToolSchema,
    "Find LZ Candidates"
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
  registerActionTool(
    server,
    state,
    "arma.eden.get_connections",
    "eden.get_connections",
    "read",
    connectionToolSchema,
    "Get Eden Connections"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.get_synced",
    "eden.get_synced",
    "read",
    connectionToolSchema,
    "Get Eden Sync Links"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.sync_entities",
    "eden.sync_entities",
    "write",
    mutateConnectionToolSchema,
    "Sync Eden Entities"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.unsync_entities",
    "eden.unsync_entities",
    "write",
    mutateConnectionToolSchema,
    "Unsync Eden Entities"
  );
  registerActionTool(server, state, "arma.eden.list_layers", "eden.list_layers", "read", emptyInputSchema, "List Eden Layers");
  registerActionTool(
    server,
    state,
    "arma.eden.create_layer",
    "eden.create_layer",
    "write",
    createLayerToolSchema,
    "Create Eden Layer"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.assign_layer",
    "eden.assign_layer",
    "write",
    assignLayerToolSchema,
    "Assign Eden Layer"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.remove_from_layer",
    "eden.remove_from_layer",
    "write",
    removeFromLayerToolSchema,
    "Remove From Eden Layer"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.set_layer_attributes",
    "eden.set_layer_attributes",
    "write",
    setLayerAttributesToolSchema,
    "Set Eden Layer Attributes"
  );
  registerActionTool(
    server,
    state,
    "arma.eden.delete_layer",
    "eden.delete_layer",
    "destructive",
    deleteLayerToolSchema,
    "Delete Eden Layer"
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
    async () => {
      const status = await readBridgeStatus(state);
      if (!status.ok) {
        return jsonToolResult({
          sidecar: "ok",
          httpBridge: { host: bridgeConfig.host, port: bridgeConfig.port },
          runtime,
          bridgeReachable: false,
          eden: {
            connected: false,
            lastSeenAt: null
          },
          lastSnapshotAt: null,
          pendingCommandCount: null,
          error: status.error
        });
      }
      return jsonToolResult({
        sidecar: "ok",
        httpBridge: { host: bridgeConfig.host, port: bridgeConfig.port },
        runtime,
        bridgeReachable: true,
        eden: {
          connected: status.lastSeenAt !== null,
          lastSeenAt: status.lastSeenAt
        },
        lastSnapshotAt: status.lastSnapshotAt,
        pendingCommandCount: status.pendingCommandCount
      });
    }
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
      const command = await state.queueSnapshotRequest(parsed.scope);
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
      const snapshot = await state.getLastSnapshot();
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
      const command = await state.queueApplyPlan(parsed.plan);
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
      return jsonToolResult({ events: await state.recentEvents(parsed.limit) });
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
      description: "Start a background loaded-config scan. Use scanStatus/scanPoll to observe or advance it.",
      inputSchema: catalogScanToolSchema.shape
    },
    async (input) => startCatalogScanTool(state, catalogScanToolSchema.parse(input))
  );

  server.registerTool(
    "arma.catalog.scanStart",
    {
      title: "Start Catalog Scan",
      description: "Create a background catalog scan job and return quickly with scan progress metadata.",
      inputSchema: catalogScanToolSchema.shape
    },
    async (input) => startCatalogScanTool(state, catalogScanToolSchema.parse(input))
  );

  server.registerTool(
    "arma.catalog.scanStatus",
    {
      title: "Catalog Scan Status",
      description: "Inspect background or persisted catalog scan progress.",
      inputSchema: catalogScanStatusToolSchema.shape
    },
    async (input) => {
      const parsed = catalogScanStatusToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        markStaleScans(catalogDb);
        const scanId = parsed.scanId ?? latestScanId(catalogDb);
        return jsonToolResult({
          ok: true,
          activeJobs: pruneTerminalCatalogScanJobs(catalogDb),
          scan: scanId ? getScanProgress(catalogDb, scanId) : null,
          catalog: getCatalogStatus(catalogDb)
        });
      });
    }
  );

  server.registerTool(
    "arma.catalog.scanPoll",
    {
      title: "Poll Catalog Scan",
      description: "Advance a bounded amount of scan work and return before client timeouts.",
      inputSchema: catalogScanPollToolSchema.shape
    },
    async (input) => {
      const parsed = catalogScanPollToolSchema.parse(input);
      const scanId = parsed.scanId ?? (await withCatalogDb((catalogDb) => latestScanId(catalogDb)));
      if (!scanId) {
        return jsonToolResult({ ok: false, error: { code: "no_scan_available" } });
      }
      const result = await pollCatalogScan(state, scanId, parsed.maxChunks, parsed.maxRuntimeMs, parsed.timeoutMs);
      return jsonToolResult(result);
    }
  );

  server.registerTool(
    "arma.catalog.scanCancel",
    {
      title: "Cancel Catalog Scan",
      description: "Request cancellation for a running or partial catalog scan.",
      inputSchema: catalogScanCancelToolSchema.shape
    },
    async (input) => {
      const parsed = catalogScanCancelToolSchema.parse(input);
      const job = catalogScanJobs.get(parsed.scanId);
      if (job) {
        job.cancelRequested = true;
      }
      return withCatalogDb((catalogDb) => {
        markScanFinished(catalogDb, parsed.scanId, "cancelled");
        catalogScanJobs.delete(parsed.scanId);
        return jsonToolResult({ ok: true, scan: getScanProgress(catalogDb, parsed.scanId) });
      });
    }
  );

  server.registerTool(
    "arma.catalog.scanFinalize",
    {
      title: "Finalize Catalog Scan",
      description: "Finalize a completed scan and populate class-count metadata.",
      inputSchema: catalogScanFinalizeToolSchema.shape
    },
    async (input) => {
      const parsed = catalogScanFinalizeToolSchema.parse(input);
      const scanId = parsed.scanId ?? (await withCatalogDb((catalogDb) => latestScanId(catalogDb)));
      if (!scanId) {
        return jsonToolResult({ ok: false, error: { code: "no_scan_available" } });
      }
      return jsonToolResult(await finalizeCatalogScan(state, scanId, parsed.timeoutMs));
    }
  );

  server.registerTool(
    "arma.catalog.scanRepair",
    {
      title: "Repair Catalog Scan",
      description: "Mark stale running chunks partial and make a scan resumable without deleting the cache.",
      inputSchema: catalogScanStatusToolSchema.shape
    },
    async (input) => {
      const parsed = catalogScanStatusToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        markStaleScans(catalogDb, 1);
        const scanId = parsed.scanId ?? latestScanId(catalogDb);
        pruneTerminalCatalogScanJobs(catalogDb);
        return jsonToolResult(scanId ? repairStaleScan(catalogDb, scanId) : { ok: false, error: "no_scan_available" });
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
      return withCatalogDb((catalogDb) => {
        const searchInput = {
            query: parsed.query,
            kind: parsed.kind,
            tags: parsed.tags,
            visualTags: parsed.visual_tags,
            limit: parsed.limit
          };
        const results = searchCatalogClasses(catalogDb, searchInput);
        return jsonToolResult({
          results,
          diagnostics: getCatalogSearchDiagnostics(catalogDb, searchInput, results.length)
        });
      });
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
        const measured: Record<string, unknown>[] = [];
        const skipped: Record<string, unknown>[] = [];
        const failed: Record<string, unknown>[] = [];
        for (const result of results) {
          const measurement = await measureCatalogClass(catalogDb, state, String(result.class_name), parsed.force, parsed.timeoutMs);
          bucketMeasurementResult(measurement, measured, skipped, failed);
        }
        return jsonToolResult({ measured, skipped, failed });
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
        const measured: Record<string, unknown>[] = [];
        const skipped: Record<string, unknown>[] = [];
        const failed: Record<string, unknown>[] = [];
        for (const candidate of candidates) {
          const measurement = await measureCatalogClass(catalogDb, state, String(candidate.className), parsed.force, parsed.timeoutMs);
          bucketMeasurementResult(measurement, measured, skipped, failed);
        }
        return jsonToolResult({ measured, skipped, failed });
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
      description: "Return Eden Sync connections for one entity.",
      inputSchema: getEntitySnapshotToolSchema.shape
    },
    async (input) => {
      const parsed = getEntitySnapshotToolSchema.parse(input);
      const result = await dispatchCatalogAction(state, "eden.get_synced", { entityId: parsed.entityId }, 60_000);
      return jsonToolResult(result.result);
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

function registerPriorityEdenWorkflowTools(server: McpServer, state: ArmaMcpState): void {
  server.registerTool(
    "arma_catalog_status",
    {
      title: "Catalog Status",
      description: "Discovery-friendly alias for cached catalog status.",
      inputSchema: emptyInputSchema.shape
    },
    async () => withCatalogDb((catalogDb) => jsonToolResult({ ok: true, catalog: getCatalogStatus(catalogDb) }))
  );

  server.registerTool(
    "arma_catalog_search",
    {
      title: "Search Catalog",
      description: "Discovery-friendly alias for cached catalog search.",
      inputSchema: catalogSearchToolSchema.shape
    },
    async (input) => {
      const parsed = catalogSearchToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        const searchInput = { query: parsed.query, kind: parsed.kind, tags: parsed.tags, visualTags: parsed.visual_tags, limit: parsed.limit };
        const results = searchCatalogClasses(catalogDb, searchInput);
        return jsonToolResult({ results, diagnostics: getCatalogSearchDiagnostics(catalogDb, searchInput, results.length) });
      });
    }
  );

  server.registerTool(
    "arma_catalog_get_class",
    {
      title: "Get Catalog Class",
      description: "Discovery-friendly alias for fetching one cached catalog class.",
      inputSchema: catalogClassToolSchema.shape
    },
    async (input) => {
      const parsed = catalogClassToolSchema.parse(input);
      return withCatalogDb((catalogDb) => jsonToolResult({ class: getCatalogClass(catalogDb, parsed.className) }));
    }
  );

  server.registerTool(
    "arma_catalog_find_by_role",
    {
      title: "Find Catalog Assets By Role",
      description: "Discovery-friendly alias for role-based cached catalog search.",
      inputSchema: catalogRoleToolSchema.shape
    },
    async (input) => {
      const parsed = catalogRoleToolSchema.parse(input);
      return withCatalogDb((catalogDb) => jsonToolResult({ results: recommendCatalogRole(catalogDb, parsed.role, parsed.limit) }));
    }
  );

  server.registerTool(
    "arma_eden_list_placed",
    {
      title: "List Placed Eden Objects",
      description: "Discovery-friendly alias for listing placed Eden objects.",
      inputSchema: entityListToolSchema.shape
    },
    async (input) => {
      const parsed = entityListToolSchema.parse(input);
      const result = await dispatchCatalogAction(state, "eden.list_entities", parsed, 60_000);
      return withCatalogDb((catalogDb) => jsonToolResult(enrichEdenResult(catalogDb, result.result)));
    }
  );

  server.registerTool(
    "arma_visual_inspect_class",
    {
      title: "Inspect Class Visually",
      description: "Discovery-friendly alias for the high-level visual class inspection workflow.",
      inputSchema: visualInspectClassToolSchema.shape
    },
    async (input) => jsonToolResult(await inspectClassVisually(state, input))
  );

  server.registerTool(
    "arma_composition_plan",
    {
      title: "Plan Composition",
      description: "Discovery-friendly alias for the high-level data-only composition planner.",
      inputSchema: compositionPlanToolSchema.shape
    },
    async (input) => jsonToolResult(await createCatalogCompositionPlan(compositionPlanToolSchema.parse(input)))
  );

  server.registerTool(
    "arma.eden.inspectClass",
    {
      title: "Inspect Eden Class",
      description: "Direct Eden-facing visual class inspection alias, registered early for managed MCP discovery.",
      inputSchema: visualInspectClassToolSchema.shape
    },
    async (input) => jsonToolResult(await inspectClassVisually(state, input))
  );

  server.registerTool(
    "arma.eden.planComposition",
    {
      title: "Plan Eden Composition",
      description: "Direct Eden-facing data-only composition planner alias, registered early for managed MCP discovery.",
      inputSchema: compositionPlanToolSchema.shape
    },
    async (input) => jsonToolResult(await createCatalogCompositionPlan(compositionPlanToolSchema.parse(input)))
  );
}

function registerVisualAndCameraTools(server: McpServer, state: ArmaMcpState): void {
  server.registerTool(
    "arma.camera.createPreviewScene",
    {
      title: "Create Camera Preview Scene",
      description: "Create a temporary local class preview scene in Eden and move the camera to the requested view.",
      inputSchema: cameraPreviewSceneToolSchema.shape
    },
    async (input) => {
      const parsed = cameraPreviewSceneToolSchema.parse(input);
      const result = await dispatchCatalogAction(state, "camera.createPreviewScene", parsed, parsed.timeoutMs);
      return jsonToolResult(result.result);
    }
  );

  server.registerTool(
    "arma.camera.inspectClass",
    {
      title: "Inspect Class With Camera",
      description: "Capture screenshot angles for a temporary local class preview scene.",
      inputSchema: cameraCaptureClassAnglesToolSchema.shape
    },
    async (input) => {
      const parsed = cameraCaptureClassAnglesToolSchema.parse(input);
      return withCatalogDb(async (catalogDb) => {
        const runId = createVisualInspectionRun(catalogDb, {
          className: parsed.className,
          status: "running",
          angles: parsed.angles,
          screenshotDir: screenshotCacheDir(parsed.className),
          resolution: [0, 0]
        });
        const result = await captureClassAngles(state, parsed, runId);
        const screenshots = storeCapturedScreenshots(catalogDb, parsed.className, runId, asRecord(result.result));
        const failed = screenshots.filter((shot) => shot.captured === false);
        finishVisualInspectionRun(catalogDb, runId, failed.length > 0 ? "partial" : "complete", failed.length > 0 ? "one_or_more_screenshots_failed" : null);
        return jsonToolResult({ ...asRecord(result.result), inspectionRunId: runId, screenshots });
      });
    }
  );

  server.registerTool(
    "arma.camera.captureClassAngles",
    {
      title: "Capture Class Angles",
      description: "Capture PNG screenshots for a temporary local class preview scene.",
      inputSchema: cameraCaptureClassAnglesToolSchema.shape
    },
    async (input) => {
      const parsed = cameraCaptureClassAnglesToolSchema.parse(input);
      const result = await captureClassAngles(state, parsed);
      const payload = asRecord(result.result);
      const runId = String(payload.run_id ?? payload.runId ?? parsed.runId ?? `capture_${Date.now().toString(36)}`);
      const screenshots = normalizeScreenshotArtifacts(parsed.className, undefined, asScreenshotRows(payload.screenshots), runId);
      return jsonToolResult({ ...payload, screenshots });
    }
  );

  server.registerTool(
    "arma.camera.captureCurrentView",
    {
      title: "Capture Current Camera View",
      description: "Ask Arma to screenshot the current 3D scene and optionally mirror it into the local cache.",
      inputSchema: cameraCaptureCurrentViewToolSchema.shape
    },
    async (input) => {
      const parsed = cameraCaptureCurrentViewToolSchema.parse(input);
      const runId = parsed.runId ?? `current_${Date.now().toString(36)}`;
      const result = await dispatchCatalogAction(
        state,
        "camera.captureCurrentView",
        { runId, filename: parsed.filename },
        parsed.timeoutMs
      );
      const payload = asRecord(result.result);
      const screenshots = normalizeScreenshotArtifacts("current-view", undefined, asScreenshotRows(payload.screenshots), runId);
      return jsonToolResult({ ...payload, screenshots });
    }
  );

  server.registerTool(
    "arma.camera.destroyPreviewScene",
    {
      title: "Destroy Camera Preview Scene",
      description: "Terminate the preview camera and delete temporary local preview objects.",
      inputSchema: emptyInputSchema.shape
    },
    async () => {
      const result = await dispatchCatalogAction(state, "camera.destroyPreviewScene", {}, 30_000);
      return jsonToolResult(result.result);
    }
  );

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
        const screenshotDir = screenshotCacheDir(parsed.className);
        mkdirSync(screenshotDir, { recursive: true });
        const runId = createVisualInspectionRun(catalogDb, {
          className: parsed.className,
          status: "running",
          angles: parsed.angles,
          screenshotDir,
          resolution: parsed.resolution
        });
        return captureClassAngles(state, { ...parsed, runId: String(runId) }, runId).then((result) => {
          const screenshots = storeCapturedScreenshots(catalogDb, parsed.className, runId, asRecord(result.result));
          const failed = screenshots.filter((shot) => shot.captured === false);
          finishVisualInspectionRun(catalogDb, runId, failed.length > 0 ? "partial" : "complete", failed.length > 0 ? "one_or_more_screenshots_failed" : null);
          return jsonToolResult({
            ...asRecord(result.result),
            ok: failed.length === 0,
            inspectionRunId: runId,
            screenshotDir,
            screenshots
          });
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
      return withCatalogDb((catalogDb) => jsonToolResult({ results: recommendCatalogRole(catalogDb, parsed.role, parsed.limit) }));
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
      return withCatalogDb((catalogDb) => jsonToolResult({ results: recommendCatalogRole(catalogDb, parsed.role, parsed.limit) }));
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
      return jsonToolResult(await createCatalogCompositionPlan(parsed));
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

async function captureClassAngles(
  state: ArmaMcpState,
  parsed: z.infer<typeof cameraCaptureClassAnglesToolSchema> | (z.infer<typeof visualInspectClassToolSchema> & { runId?: string }),
  inspectionRunId?: number
) {
  const runId = parsed.runId ?? String(inspectionRunId ?? `capture_${Date.now().toString(36)}`);
  return dispatchCatalogAction(
    state,
    "camera.captureClassAngles",
    {
      className: parsed.className,
      runId,
      angles: parsed.angles,
      positionATL: "positionATL" in parsed ? parsed.positionATL : [0, 0, 0],
      dir: "dir" in parsed ? parsed.dir : 0,
      distance: parsed.distance,
      height: parsed.height,
      fov: parsed.fov,
      settleSeconds: parsed.settleSeconds
    },
    parsed.timeoutMs
  );
}

function storeCapturedScreenshots(
  catalogDb: ReturnType<typeof openCatalogDb>,
  className: string,
  inspectionRunId: number,
  payload: Record<string, unknown>
): Array<Record<string, unknown>> {
  const runId = String(payload.run_id ?? payload.runId ?? inspectionRunId);
  const screenshots = normalizeScreenshotArtifacts(className, inspectionRunId, asScreenshotRows(payload.screenshots), runId);
  for (const screenshot of screenshots) {
    if (screenshot.captured === false) {
      continue;
    }
    insertClassScreenshot(catalogDb, {
      className,
      inspectionRunId,
      angle: String(screenshot.angle ?? "unknown"),
      filePath: String(screenshot.local_file_path ?? screenshot.profile_relative_path ?? screenshot.filename ?? ""),
      cameraPosition: Array.isArray(screenshot.camera_position) ? screenshot.camera_position : [],
      cameraTarget: Array.isArray(screenshot.camera_target) ? screenshot.camera_target : []
    });
  }
  return screenshots;
}

function normalizeScreenshotArtifacts(
  className: string,
  inspectionRunId: number | undefined,
  screenshots: Array<Record<string, unknown>>,
  runId: string
): Array<Record<string, unknown>> {
  const targetDir = screenshotCacheDir(className);
  mkdirSync(targetDir, { recursive: true });
  return screenshots.map((screenshot) => {
    const profileRelativePath = String(screenshot.profile_relative_path ?? screenshot.filename ?? "");
    const angle = safePathSegment(String(screenshot.angle ?? "current"));
    const targetPath = resolve(targetDir, `${safePathSegment(runId)}_${angle}.png`);
    const copy = mirrorProfileScreenshot(profileRelativePath, targetPath);
    return {
      ...screenshot,
      inspectionRunId: inspectionRunId ?? null,
      profile_relative_path: profileRelativePath,
      local_file_path: copy.copied ? targetPath : null,
      expected_local_file_path: targetPath,
      copied_to_cache: copy.copied,
      copy_warning: copy.warning
    };
  });
}

function asScreenshotRows(input: unknown): Array<Record<string, unknown>> {
  return Array.isArray(input) ? input.map(asRecord) : [];
}

async function startCatalogScanTool(
  state: ArmaMcpState,
  parsed: z.infer<typeof catalogScanToolSchema>
) {
  return withCatalogDb(async (catalogDb) => {
    const scanId = parsed.scanId ?? `catalog-${Date.now()}`;
    writeScanManifest(catalogDb, {
      scanId,
      loadedModsHash: "pending",
      loadedAddonsHash: "pending",
      status: "running"
    });
    initializeScanTargets(catalogDb, scanId, parsed.targets);
    let started;
    try {
      started = await dispatchCatalogAction(
        state,
        "catalog.scanStart",
        {
          scanId,
          targets: parsed.targets,
          chunkSize: parsed.chunkSize,
          includeRaw: parsed.includeRaw
        },
        parsed.timeoutMs
      );
    } catch (error) {
      markScanFinished(catalogDb, scanId, "failed", undefined, error instanceof Error ? error.message : String(error));
      throw error;
    }
    const startPayload = asRecord(started.result);
    writeScanManifest(catalogDb, {
      scanId,
      gameVersion: stringOrNull(startPayload.game_version ?? startPayload.gameVersion),
      worldName: stringOrNull(startPayload.world_name ?? startPayload.worldName),
      loadedModsHash: stableHash(startPayload.loaded_mods ?? startPayload.loadedMods ?? []),
      loadedAddonsHash: stableHash(startPayload.loaded_addons ?? startPayload.loadedAddons ?? []),
      status: "running"
    });
    const job: CatalogScanJob = {
      scanId,
      targets: parsed.targets,
      chunkSize: parsed.chunkSize,
      currentChunkSize: Math.max(1, Math.min(parsed.chunkSize, parsed.chunkSize)),
      minChunkSize: Math.min(parsed.minChunkSize, parsed.chunkSize),
      adaptiveChunkSizing: parsed.adaptiveChunkSizing,
      includeRaw: parsed.includeRaw,
      maxChunks: parsed.maxChunks,
      timeoutMs: parsed.timeoutMs,
      cancelRequested: false
    };
    catalogScanJobs.set(scanId, job);
    if (parsed.background) {
      job.promise = Promise.resolve()
        .then(() => runCatalogScanJob(state, job))
        .finally(() => {
          catalogScanJobs.delete(scanId);
        });
    }
    return jsonToolResult({
      ok: true,
      scanId,
      targets: parsed.targets,
      estimatedWork: {
        targetCount: parsed.targets.length,
        chunkSize: parsed.chunkSize,
        minChunkSize: parsed.minChunkSize,
        adaptiveChunkSizing: parsed.adaptiveChunkSizing,
        maxChunks: parsed.maxChunks
      },
      status: getScanProgress(catalogDb, scanId)
    });
  });
}

async function runCatalogScanJob(state: ArmaMcpState, job: CatalogScanJob): Promise<void> {
  try {
    while (!job.cancelRequested) {
      const result = await pollCatalogScan(state, job.scanId, 1, 55_000, job.timeoutMs, job);
      const status = String(asRecord(asRecord(result).scan).status ?? asRecord(asRecord(asRecord(result).scan).manifest).status ?? "");
      if (["complete", "failed", "cancelled"].includes(status)) {
        break;
      }
      const advanced = Number(asRecord(result).chunksProcessed ?? 0);
      if (advanced <= 0) {
        break;
      }
    }
  } catch (error) {
    await withCatalogDb((catalogDb) => {
      markScanFinished(catalogDb, job.scanId, "failed", undefined, error instanceof Error ? error.message : String(error));
    });
  }
}

async function pollCatalogScan(
  state: ArmaMcpState,
  scanId: string,
  maxChunks: number,
  maxRuntimeMs: number,
  timeoutMs: number,
  job = catalogScanJobs.get(scanId)
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  let chunksProcessed = 0;
  while (chunksProcessed < maxChunks && Date.now() - startedAt < maxRuntimeMs) {
    if (job?.cancelRequested) {
      await withCatalogDb((catalogDb) => markScanFinished(catalogDb, scanId, "cancelled"));
      break;
    }
    const next = await withCatalogDb((catalogDb) => nextScanTarget(catalogDb, scanId));
    if (!next) {
      await finalizeCatalogScan(state, scanId, timeoutMs);
      break;
    }
    if (next.nextChunkIndex >= (job?.maxChunks ?? 50_000)) {
      await withCatalogDb((catalogDb) => {
        writeScanTargetProgress(catalogDb, {
          scanId,
          target: next.target,
          status: "failed",
          error: `Catalog scan exceeded maxChunks while scanning ${next.target}`,
          finishedAt: new Date().toISOString()
        });
        markScanFinished(catalogDb, scanId, "failed");
      });
      break;
    }
    const chunkStartIndex = Math.max(0, Number(next.rowsIngested ?? 0));
    const chunkDispatch = await dispatchAdaptiveScanChunk(state, scanId, next, chunkStartIndex, timeoutMs, job);
    if (!chunkDispatch.ok) {
      const message = chunkDispatch.message;
      const scan = await withCatalogDb((catalogDb) => {
        writeScanTargetProgress(catalogDb, {
          scanId,
          target: next.target,
          targetIndex: next.targetIndex,
          status: "failed",
          error: message,
          finishedAt: new Date().toISOString()
        });
        markScanFinished(catalogDb, scanId, "failed", undefined, message);
        return getScanProgress(catalogDb, scanId);
      });
      catalogScanJobs.delete(scanId);
      return { ok: false, error: { code: "scan_chunk_failed", message }, chunksProcessed, scan };
    }
    const chunkResult = chunkDispatch.result;
    const chunk = asRecord(chunkResult.result) as CatalogChunk;
    const isLast = chunk.is_last_chunk === true || chunk.isLastChunk === true;
    const totalRecords = numberOrNull(chunk.total_records ?? chunk.totalRecords);
    const sourceRecordsScanned = Array.isArray(chunk.records) ? chunk.records.length : 0;
    const rowsIngested = await withCatalogDb((catalogDb) => {
      writeScanTargetProgress(catalogDb, {
        scanId,
        target: next.target,
        targetIndex: next.targetIndex,
        status: "running",
        startedAt: new Date().toISOString()
      });
      const ingested = ingestCatalogChunk(catalogDb, scanId, chunk, { includeRaw: job?.includeRaw ?? false });
      writeScanTargetProgress(catalogDb, {
        scanId,
        target: next.target,
        status: isLast ? "complete" : "running",
        nextChunkIndex: next.nextChunkIndex + 1,
        totalRecords,
        rowsIngestedDelta: sourceRecordsScanned,
        finishedAt: isLast ? new Date().toISOString() : null
      });
      return ingested;
    });
    chunksProcessed += 1;
    if (rowsIngested === 0 && isLast && next.nextChunkIndex === 0) {
      continue;
    }
  }
  return withCatalogDb((catalogDb) => ({
    ok: true,
    chunksProcessed,
    scan: getScanProgress(catalogDb, scanId)
  })).then((result) => {
    clearCatalogScanJobIfTerminal(scanId, asRecord(result.scan));
    return result;
  });
}

async function finalizeCatalogScan(state: ArmaMcpState, scanId: string, timeoutMs: number): Promise<Record<string, unknown>> {
  return withCatalogDb(async (catalogDb) => {
    const progress = getScanProgress(catalogDb, scanId);
    if (!progress) {
      return { ok: false, error: { code: "scan_not_found" } };
    }
    const targets = Array.isArray(progress.targets) ? (progress.targets as Record<string, unknown>[]) : [];
    const incomplete = targets.filter((target) => !["complete", "failed", "cancelled"].includes(String(target.status)));
    const counts = Object.fromEntries(targets.map((target) => [String(target.target), countCatalogClassesForScanTarget(catalogDb, scanId, String(target.target))]));
    if (incomplete.length > 0) {
      markScanFinished(catalogDb, scanId, "partial", counts);
      return { ok: false, error: { code: "scan_incomplete", targets: incomplete.map((target) => target.target) }, scan: getScanProgress(catalogDb, scanId) };
    }
    const failed = targets.filter((target) => target.status === "failed");
    const cancelled = targets.filter((target) => target.status === "cancelled");
    if (failed.length === 0 && cancelled.length === 0) {
      await dispatchCatalogAction(state, "catalog.scanFinish", { scanId, classCounts: counts }, timeoutMs);
    }
    markScanFinished(catalogDb, scanId, failed.length > 0 ? "failed" : cancelled.length > 0 ? "cancelled" : "complete", counts);
    const scan = getScanProgress(catalogDb, scanId);
    clearCatalogScanJobIfTerminal(scanId, asRecord(scan));
    return { ok: failed.length === 0 && cancelled.length === 0, counts, scan };
  });
}

async function dispatchAdaptiveScanChunk(
  state: ArmaMcpState,
  scanId: string,
  next: { target: string; targetIndex: number; nextChunkIndex: number; rowsIngested: number },
  startIndex: number,
  timeoutMs: number,
  job?: CatalogScanJob
): Promise<{ ok: true; result: Awaited<ReturnType<typeof dispatchCatalogAction>> } | { ok: false; message: string }> {
  while (true) {
    const chunkSize = job?.currentChunkSize ?? 100;
    try {
      const result = await dispatchCatalogAction(
        state,
        "catalog.scanChunk",
        {
          scanId,
          configPath: next.target,
          chunkIndex: next.nextChunkIndex,
          startIndex,
          chunkSize,
          includeRaw: job?.includeRaw ?? false
        },
        timeoutMs
      );
      return { ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!reduceCatalogScanChunkSizeAfterTimeout(job, message)) {
        return { ok: false, message };
      }
    }
  }
}

async function createCatalogCompositionPlan(parsed: z.infer<typeof compositionPlanToolSchema>): Promise<Record<string, unknown>> {
  return withCatalogDb((catalogDb) => {
    const classNames =
      parsed.classes && parsed.classes.length > 0
        ? parsed.classes
        : recommendCatalogRole(catalogDb, parsed.role ?? "objective_terminal", 10).map((item) => String(item.class_name));
    return { plan: createDataOnlyCompositionPlan(catalogDb, parsed.name, classNames, parsed.anchor, parsed.role) };
  });
}

function reduceCatalogScanChunkSizeAfterTimeout(job: CatalogScanJob | undefined, message: string): boolean {
  if (!job?.adaptiveChunkSizing || !isCatalogScanTimeout(message)) {
    return false;
  }
  const nextSize = Math.max(job.minChunkSize, Math.floor(job.currentChunkSize / 2));
  if (nextSize >= job.currentChunkSize) {
    return false;
  }
  job.currentChunkSize = nextSize;
  return true;
}

function isCatalogScanTimeout(message: string): boolean {
  return /timed out waiting for arma result for catalog\.scanChunk/i.test(message);
}

function nextScanTarget(
  catalogDb: ReturnType<typeof openCatalogDb>,
  scanId: string
): { target: string; targetIndex: number; nextChunkIndex: number; rowsIngested: number } | null {
  const manifest = getScanManifest(catalogDb, scanId);
  if (!manifest || ["complete", "failed", "cancelled"].includes(String(manifest.status))) {
    return null;
  }
  if (manifest.status === "stale") {
    repairStaleScan(catalogDb, scanId);
  }
  const row = catalogDb.db
    .prepare(
      `SELECT target, target_index AS targetIndex, next_chunk_index AS nextChunkIndex
              , rows_ingested AS rowsIngested
       FROM scan_targets
       WHERE scan_id = ? AND status IN ('pending', 'running')
       ORDER BY target_index, target
       LIMIT 1`
    )
    .get(scanId) as { target: string; targetIndex: number; nextChunkIndex: number; rowsIngested: number } | undefined;
  return row ?? null;
}

function latestScanId(catalogDb: ReturnType<typeof openCatalogDb>): string | undefined {
  const latest = getCatalogStatus(catalogDb).latestScan as Record<string, unknown> | null;
  const manifest = latest?.manifest as Record<string, unknown> | undefined;
  return typeof manifest?.scanId === "string" ? manifest.scanId : undefined;
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
  if (!force && catalogClass.measurement_status === "failed") {
    return { className, status: "skipped", error: "previous_measurement_failed" };
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

function bucketMeasurementResult(
  result: Record<string, unknown>,
  measured: Record<string, unknown>[],
  skipped: Record<string, unknown>[],
  failed: Record<string, unknown>[]
): void {
  const status = String(result.status ?? "");
  if (status === "measured") {
    measured.push(result);
  } else if (status === "skipped") {
    skipped.push(result);
  } else {
    failed.push(result);
  }
}

function isSafeToMeasure(catalogClass: Record<string, unknown>): boolean {
  const kind = String(catalogClass.kind ?? "");
  const subkind = String(catalogClass.subkind ?? "");
  const haystack = [
    catalogClass.class_name,
    catalogClass.display_name,
    catalogClass.simulation,
    catalogClass.editor_category,
    catalogClass.editor_subcategory,
    catalogClass.vehicle_class,
    ...(Array.isArray(catalogClass.tags) ? catalogClass.tags : [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const scope = typeof catalogClass.scope === "number" ? catalogClass.scope : Number(catalogClass.scope ?? 1);
  const modelPath = String(catalogClass.model_path ?? "");
  if (scope <= 0 || !modelPath) {
    return false;
  }
  if (["unit", "vehicle", "ammo", "module", "logic"].includes(kind)) {
    return false;
  }
  if (haystack.match(/\b(mine|ied|explosive|grenade|rocket|missile|submunition|module|logic)\b/)) {
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

export function recommendCatalogRole(catalogDb: ReturnType<typeof openCatalogDb>, role: string, limit: number): Record<string, unknown>[] {
  const roleTags = roleToTags(role);
  const seen = new Set<string>();
  const results: Record<string, unknown>[] = [];
  for (const tag of roleTags.primary) {
    const searchInput = shouldUseRoleQueryRanking(role) ? { query: role, tags: [tag], limit: Math.min(limit * 4, 100) } : { tags: [tag], limit };
    for (const item of searchCatalogClasses(catalogDb, searchInput)) {
      const className = String(item.class_name);
      if (!seen.has(className)) {
        seen.add(className);
        results.push({ ...item, confidence: tag === role ? 0.9 : 0.75, matched_role: tag });
      }
      if (results.length >= limit) {
        return results;
      }
    }
  }
  for (const item of searchCatalogClasses(catalogDb, { query: role, limit })) {
    const className = String(item.class_name);
    if (!seen.has(className)) {
      seen.add(className);
      results.push({ ...item, confidence: 0.55, matched_role: "text_search" });
    }
    if (results.length >= limit) {
      break;
    }
  }
  for (const tag of roleTags.broad) {
    for (const item of searchCatalogClasses(catalogDb, { tags: [tag], limit })) {
      const className = String(item.class_name);
      if (!seen.has(className)) {
        seen.add(className);
        results.push({ ...item, confidence: 0.45, matched_role: tag });
      }
      if (results.length >= limit) {
        return results;
      }
    }
  }
  return results;
}

function shouldUseRoleQueryRanking(role: string): boolean {
  const normalized = role.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ["medical", "medic", "repair", "turret"].includes(normalized);
}

function roleToTags(role: string): { primary: string[]; broad: string[] } {
  const normalized = role.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, { primary: string[]; broad?: string[] }> = {
    console: { primary: ["console", "command_terminal", "objective_terminal", "terminal"] },
    terminal: { primary: ["terminal", "command_terminal", "objective_terminal"] },
    bunker: { primary: ["bunker"], broad: ["fortification"] },
    sandbag: { primary: ["cover_low", "wall_segment"], broad: ["fortification"] },
    medical: { primary: ["medical", "medical_crate"] },
    ammo: { primary: ["ammo_crate"], broad: ["supply"] },
    droid: { primary: ["cis", "infantry_unit"] },
    cis: { primary: ["cis"] },
    republic: { primary: ["republic"] },
    wall: { primary: ["wall_segment"], broad: ["fortification"] },
    gate: { primary: ["gate"], broad: ["wall_segment"] },
    repair: { primary: ["repair"], broad: ["supply"] },
    turret: { primary: ["static_weapon"] },
    task: { primary: ["module_task"], broad: ["module"] },
    respawn: { primary: ["module_respawn"], broad: ["module"] },
    zeus: { primary: ["module_zeus"], broad: ["module"] }
  };
  const mapped = aliases[normalized] ?? { primary: [] };
  return {
    primary: [normalized, ...mapped.primary].filter((tag, index, tags) => tags.indexOf(tag) === index),
    broad: (mapped.broad ?? []).filter((tag, index, tags) => tags.indexOf(tag) === index)
  };
}

function createDataOnlyCompositionPlan(
  catalogDb: ReturnType<typeof openCatalogDb>,
  name: string,
  classNames: string[],
  anchor: { positionATL: [number, number, number]; dir: number },
  role?: string
) {
  return {
    schemaVersion: 1,
    name,
    dryRun: true,
    anchor,
    operations: classNames.map((className, index) => ({
      op: "create_entity",
      clientRef: `catalog_${index + 1}`,
      role: role ?? "catalog_asset",
      type: "Object",
      className,
      reason: compositionReason(catalogDb, className, role),
      dimensionsUsed: catalogDimensions(catalogDb, className),
      transform: {
        positionATL: [index * 2, 0, 0],
        dir: 0
      }
    }))
  };
}

function compositionReason(catalogDb: ReturnType<typeof openCatalogDb>, className: string, role?: string): string {
  const catalogClass = getCatalogClass(catalogDb, className);
  const displayName = String(catalogClass?.display_name ?? className);
  const tags = Array.isArray(catalogClass?.tags) ? catalogClass.tags.join(", ") : "";
  return role
    ? `Selected ${displayName} for role ${role}${tags ? ` using tags ${tags}` : ""}.`
    : `Selected ${displayName} from cached catalog data${tags ? ` using tags ${tags}` : ""}.`;
}

function catalogDimensions(catalogDb: ReturnType<typeof openCatalogDb>, className: string): Record<string, unknown> | null {
  const catalogClass = getCatalogClass(catalogDb, className);
  if (!catalogClass || catalogClass.width_m === null || catalogClass.depth_m === null || catalogClass.height_m === null) {
    return null;
  }
  return {
    width_m: catalogClass.width_m,
    depth_m: catalogClass.depth_m,
    height_m: catalogClass.height_m
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
  const maxAttempts = catalogDbRetryAttempts();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const catalogDb = openCatalogDb();
    try {
      ensureCatalogSchema(catalogDb);
      return await callback(catalogDb);
    } catch (error) {
      lastError = error;
      if (!isDatabaseLockedError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await sleep(catalogDbRetryDelayMs(attempt));
    } finally {
      closeCatalogDb(catalogDb);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function readBridgeStatus(state: ArmaMcpState): Promise<
  | {
      ok: true;
      lastSeenAt: string | null;
      lastSnapshotAt: string | null;
      pendingCommandCount: number;
      pendingActionCount: number;
      diagnostics: unknown;
    }
  | { ok: false; error: string }
> {
  try {
    const lastSeenAt = await state.getLastEdenSeenAt();
    const lastSnapshot = await state.getLastSnapshot();
    return {
      ok: true,
      lastSeenAt,
      lastSnapshotAt: lastSnapshot?.createdAt ?? null,
      pendingCommandCount: await state.pendingCommandCount(),
      pendingActionCount: await state.pendingActionCount(),
      diagnostics: state.getBridgeDiagnostics ? await state.getBridgeDiagnostics() : null
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function catalogDbRetryAttempts(): number {
  const parsed = Number(process.env.ARMA_MCP_CATALOG_BUSY_RETRIES ?? 5);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 5;
  }
  return Math.min(Math.trunc(parsed), 20);
}

function catalogDbRetryDelayMs(attempt: number): number {
  const base = Number(process.env.ARMA_MCP_CATALOG_BUSY_RETRY_DELAY_MS ?? 75);
  const normalizedBase = Number.isFinite(base) && base >= 0 ? Math.min(Math.trunc(base), 5_000) : 75;
  return normalizedBase * attempt;
}

function isDatabaseLockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function registerManagedDiscoveryFallbackTools(
  server: McpServer,
  state: ArmaMcpState,
  bridgeConfig: BridgeConfig,
  runtime: SidecarRuntimeInfo
): void {
  server.registerTool(
    "arma_discovery",
    {
      title: "Arma MCP Discovery",
      description: "List tools covered by the managed-discovery fallback router.",
      inputSchema: emptyInputSchema.shape
    },
    async () =>
      jsonToolResult({
        ok: true,
        fallbackTool: "arma_call",
        fallbackCallableTools: [...MCP_DISCOVERY_FALLBACK_TOOL_NAMES],
        runtime,
        httpBridge: { host: bridgeConfig.host, port: bridgeConfig.port }
      })
  );

  server.registerTool(
    "arma_call",
    {
      title: "Arma MCP Fallback Call",
      description: "Call an allowlisted ArmaMCP tool when managed discovery omits the individual tool name.",
      inputSchema: managedDiscoveryFallbackCallSchema.shape
    },
    async (input) => {
      const parsed = managedDiscoveryFallbackCallSchema.parse(input);
      return jsonToolResult(await callManagedDiscoveryFallbackTool(state, bridgeConfig, runtime, parsed.toolName, parsed.input));
    }
  );
}

async function callManagedDiscoveryFallbackTool(
  state: ArmaMcpState,
  bridgeConfig: BridgeConfig,
  runtime: SidecarRuntimeInfo,
  toolName: (typeof MCP_DISCOVERY_FALLBACK_TOOL_NAMES)[number],
  input: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "arma.bridge.diagnostics": {
      const status = await readBridgeStatus(state);
      return {
        sidecarConnected: true,
        runtime,
        httpBridge: { host: bridgeConfig.host, port: bridgeConfig.port, url: runtime.httpBridgeUrl },
        bridgeReachable: status.ok,
        armaConnected: status.ok ? status.lastSeenAt !== null : false,
        edenAvailable: status.ok ? status.lastSeenAt !== null : false,
        lastSeenAt: status.ok ? status.lastSeenAt : null,
        lastSnapshotAt: status.ok ? status.lastSnapshotAt : null,
        pendingActions: status.ok ? status.pendingCommandCount : null,
        pendingResults: status.ok ? status.pendingActionCount : null,
        diagnostics: status.ok ? status.diagnostics ?? null : null,
        error: status.ok ? null : status.error
      };
    }
    case "arma.bridge.get_capabilities":
      return executeActionTool(state, "bridge.get_capabilities", "read", emptyInputSchema, input);
    case "arma.bridge.ping":
      return executeActionTool(state, "bridge.ping", "read", emptyInputSchema, input);
    case "arma.camera.captureClassAngles": {
      const parsed = cameraCaptureClassAnglesToolSchema.parse(input);
      const result = await captureClassAngles(state, parsed);
      const payload = asRecord(result.result);
      const runId = String(payload.run_id ?? payload.runId ?? parsed.runId ?? `capture_${Date.now().toString(36)}`);
      const screenshots = normalizeScreenshotArtifacts(parsed.className, undefined, asScreenshotRows(payload.screenshots), runId);
      return { ...payload, screenshots };
    }
    case "arma.camera.createPreviewScene":
      return executeCatalogActionTool(state, "camera.createPreviewScene", cameraPreviewSceneToolSchema, input);
    case "arma.camera.inspectClass":
      return inspectClassWithCamera(state, input);
    case "arma_catalog_status":
      emptyInputSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ ok: true, catalog: getCatalogStatus(catalogDb) }));
    case "arma_catalog_search": {
      const parsed = catalogSearchToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        const searchInput = {
          query: parsed.query,
          kind: parsed.kind,
          tags: parsed.tags,
          visualTags: parsed.visual_tags,
          limit: parsed.limit
        };
        const results = searchCatalogClasses(catalogDb, searchInput);
        return { results, diagnostics: getCatalogSearchDiagnostics(catalogDb, searchInput, results.length) };
      });
    }
    case "arma_catalog_get_class": {
      const parsed = catalogClassToolSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ class: getCatalogClass(catalogDb, parsed.className) }));
    }
    case "arma_catalog_find_by_role": {
      const parsed = catalogRoleToolSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ results: recommendCatalogRole(catalogDb, parsed.role, parsed.limit) }));
    }
    case "arma_visual_inspect_class":
    case "arma.eden.inspectClass":
      return inspectClassVisually(state, input);
    case "arma_composition_plan":
    case "arma.eden.planComposition":
      return createCatalogCompositionPlan(compositionPlanToolSchema.parse(input));
    case "arma.catalog.scan":
    case "arma.catalog.scanStart":
      return startCatalogScanTool(state, catalogScanToolSchema.parse(input)).then(extractJsonToolResult);
    case "arma.catalog.scanStatus": {
      const parsed = catalogScanStatusToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        markStaleScans(catalogDb);
        const scanId = parsed.scanId ?? latestScanId(catalogDb);
        return {
          ok: true,
          activeJobs: pruneTerminalCatalogScanJobs(catalogDb),
          scan: scanId ? getScanProgress(catalogDb, scanId) : null,
          catalog: getCatalogStatus(catalogDb)
        };
      });
    }
    case "arma.catalog.scanPoll": {
      const parsed = catalogScanPollToolSchema.parse(input);
      const scanId = parsed.scanId ?? (await withCatalogDb((catalogDb) => latestScanId(catalogDb)));
      return scanId
        ? pollCatalogScan(state, scanId, parsed.maxChunks, parsed.maxRuntimeMs, parsed.timeoutMs)
        : { ok: false, error: { code: "no_scan_available" } };
    }
    case "arma.catalog.scanCancel": {
      const parsed = catalogScanCancelToolSchema.parse(input);
      const job = catalogScanJobs.get(parsed.scanId);
      if (job) {
        job.cancelRequested = true;
      }
      return withCatalogDb((catalogDb) => {
        markScanFinished(catalogDb, parsed.scanId, "cancelled");
        catalogScanJobs.delete(parsed.scanId);
        return { ok: true, scan: getScanProgress(catalogDb, parsed.scanId) };
      });
    }
    case "arma.catalog.scanFinalize": {
      const parsed = catalogScanFinalizeToolSchema.parse(input);
      const scanId = parsed.scanId ?? (await withCatalogDb((catalogDb) => latestScanId(catalogDb)));
      return scanId ? finalizeCatalogScan(state, scanId, parsed.timeoutMs) : { ok: false, error: { code: "no_scan_available" } };
    }
    case "arma.catalog.scanRepair": {
      const parsed = catalogScanStatusToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        markStaleScans(catalogDb, 1);
        const scanId = parsed.scanId ?? latestScanId(catalogDb);
        pruneTerminalCatalogScanJobs(catalogDb);
        return scanId ? repairStaleScan(catalogDb, scanId) : { ok: false, error: "no_scan_available" };
      });
    }
    case "arma.catalog.search": {
      const parsed = catalogSearchToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        const searchInput = {
          query: parsed.query,
          kind: parsed.kind,
          tags: parsed.tags,
          visualTags: parsed.visual_tags,
          limit: parsed.limit
        };
        const results = searchCatalogClasses(catalogDb, searchInput);
        return { results, diagnostics: getCatalogSearchDiagnostics(catalogDb, searchInput, results.length) };
      });
    }
    case "arma.catalog.status":
      emptyInputSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ ok: true, catalog: getCatalogStatus(catalogDb) }));
    case "arma.catalog.getClass": {
      const parsed = catalogClassToolSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ class: getCatalogClass(catalogDb, parsed.className) }));
    }
    case "arma.catalog.getTags": {
      const parsed = catalogTagsToolSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ tags: getCatalogTags(catalogDb, parsed.className) }));
    }
    case "arma.catalog.listMods":
      emptyInputSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ mods: listCatalogMods(catalogDb) }));
    case "arma.catalog.listFactions":
      emptyInputSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ factions: listCatalogFactions(catalogDb) }));
    case "arma.catalog.listCategories":
      emptyInputSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ categories: listCatalogCategories(catalogDb) }));
    case "arma.catalog.measureClass": {
      const parsed = catalogMeasureClassToolSchema.parse(input);
      return withCatalogDb(async (catalogDb) => ({ result: await measureCatalogClass(catalogDb, state, parsed.className, parsed.force, parsed.timeoutMs) }));
    }
    case "arma.catalog.measureSearchResults": {
      const parsed = catalogMeasureSearchResultsToolSchema.parse(input);
      return withCatalogDb(async (catalogDb) => {
        const results = searchCatalogClasses(catalogDb, {
          query: parsed.query,
          kind: parsed.kind,
          tags: parsed.tags,
          visualTags: parsed.visual_tags,
          limit: parsed.limit
        });
        const measured: Record<string, unknown>[] = [];
        const skipped: Record<string, unknown>[] = [];
        const failed: Record<string, unknown>[] = [];
        for (const result of results) {
          const measurement = await measureCatalogClass(catalogDb, state, String(result.class_name), parsed.force, parsed.timeoutMs);
          bucketMeasurementResult(measurement, measured, skipped, failed);
        }
        return { measured, skipped, failed };
      });
    }
    case "arma.catalog.measureMissing": {
      const parsed = catalogMeasureMissingToolSchema.parse(input);
      return withCatalogDb(async (catalogDb) => {
        const candidates = listClassesMissingMeasurements(catalogDb, parsed.limit, parsed.kinds);
        const measured: Record<string, unknown>[] = [];
        const skipped: Record<string, unknown>[] = [];
        const failed: Record<string, unknown>[] = [];
        for (const candidate of candidates) {
          const measurement = await measureCatalogClass(catalogDb, state, String(candidate.className), parsed.force, parsed.timeoutMs);
          bucketMeasurementResult(measurement, measured, skipped, failed);
        }
        return { measured, skipped, failed };
      });
    }
    case "arma.catalog.recommend":
    case "arma.catalog.findByRole": {
      const parsed = catalogRoleToolSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ results: recommendCatalogRole(catalogDb, parsed.role, parsed.limit) }));
    }
    case "arma.catalog.findSimilar": {
      const parsed = findSimilarToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        const catalogClass = getCatalogClass(catalogDb, parsed.className);
        if (!catalogClass) {
          return { results: [] };
        }
        const tags = Array.isArray(catalogClass.tags) ? catalogClass.tags.map(String).slice(0, 3) : [];
        return {
          results: searchCatalogClasses(catalogDb, { kind: String(catalogClass.kind ?? ""), tags, limit: parsed.limit }).filter(
            (item) => item.class_name !== parsed.className
          )
        };
      });
    }
    case "arma.catalog.findByDimensions": {
      const parsed = findByDimensionsToolSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ results: findCatalogByDimensions(catalogDb, parsed) }));
    }
    case "arma.assets.search_classes":
      return executeActionTool(state, "assets.search_classes", "read", assetSearchToolSchema, input);
    case "arma.assets.get_class":
      return executeActionTool(state, "assets.get_class", "read", assetGetClassToolSchema, input);
    case "arma.composition.plan": {
      const parsed = compositionPlanToolSchema.parse(input);
      return createCatalogCompositionPlan(parsed);
    }
    case "arma.composition.previewLocal": {
      const parsed = compositionExportToolSchema.parse(input);
      return { ok: true, previewOnly: true, plan: parsed.plan };
    }
    case "arma.composition.exportSqf": {
      const parsed = compositionExportToolSchema.parse(input);
      return { sqf: exportPlanSqf(parsed.plan) };
    }
    case "arma.composition.exportEdenInstructions": {
      const parsed = compositionExportToolSchema.parse(input);
      return { instructions: exportEdenInstructions(parsed.plan) };
    }
    case "arma.eden.apply_composition":
      return executeActionTool(state, "eden.apply_composition", "write", applyCompositionToolSchema, input);
    case "arma.eden.capture_composition":
      return executeActionTool(state, "eden.capture_composition", "read", captureCompositionToolSchema, input);
    case "arma.eden.exportSelection": {
      const parsed = captureCompositionToolSchema.parse(input);
      const result = await dispatchCatalogAction(state, "eden.capture_composition", parsed, 60_000);
      return result.result;
    }
    case "arma.eden.batch":
      return executeActionTool(state, "eden.batch", "write", batchToolSchema, input);
    case "arma.eden.create_entity":
      return executeActionTool(state, "eden.create_entity", "write", createEntityToolSchema, input);
    case "arma.eden.find_entities":
      return executeActionTool(state, "eden.find_entities", "read", entityListToolSchema, input);
    case "arma.eden.getObject": {
      const parsed = getEntitySnapshotToolSchema.parse(input);
      const result = await dispatchCatalogAction(state, "eden.get_entity_snapshot", parsed, 60_000);
      return withCatalogDb((catalogDb) => enrichEdenResult(catalogDb, result.result));
    }
    case "arma.eden.get_connections":
      return executeActionTool(state, "eden.get_connections", "read", connectionToolSchema, input);
    case "arma.eden.get_synced":
      return executeActionTool(state, "eden.get_synced", "read", connectionToolSchema, input);
    case "arma.eden.getSynced": {
      const parsed = getEntitySnapshotToolSchema.parse(input);
      return executeActionTool(state, "eden.get_synced", "read", connectionToolSchema, { entityId: parsed.entityId });
    }
    case "arma.eden.generate_aa_site":
      return generateAaSite(siteGeneratorSchema.parse(input));
    case "arma.eden.generate_cover_line":
      return generateCoverLine(lineGeneratorSchema.parse(input));
    case "arma.eden.generate_lz":
      return generateLz(siteGeneratorSchema.parse(input));
    case "arma.eden.generate_prop_wall":
      return generatePropWall(lineGeneratorSchema.parse(input));
    case "arma.eden.generate_road_checkpoint":
      return generateRoadCheckpoint(roadCheckpointGeneratorSchema.parse(input));
    case "arma.eden.generate_small_outpost":
      return generateSmallOutpost(smallOutpostGeneratorSchema.parse(input));
    case "arma.eden.listPlaced": {
      const parsed = entityListToolSchema.parse(input);
      const result = await dispatchCatalogAction(state, "eden.list_entities", parsed, 60_000);
      return withCatalogDb((catalogDb) => enrichEdenResult(catalogDb, result.result));
    }
    case "arma_eden_list_placed": {
      const parsed = entityListToolSchema.parse(input);
      const result = await dispatchCatalogAction(state, "eden.list_entities", parsed, 60_000);
      return withCatalogDb((catalogDb) => enrichEdenResult(catalogDb, result.result));
    }
    case "arma.eden.list_entities":
      return executeActionTool(state, "eden.list_entities", "read", entityListToolSchema, input);
    case "arma.eden.list_layers":
      return executeActionTool(state, "eden.list_layers", "read", emptyInputSchema, input);
    case "arma.eden.create_layer":
      return executeActionTool(state, "eden.create_layer", "write", createLayerToolSchema, input);
    case "arma.eden.assign_layer":
      return executeActionTool(state, "eden.assign_layer", "write", assignLayerToolSchema, input);
    case "arma.eden.remove_from_layer":
      return executeActionTool(state, "eden.remove_from_layer", "write", removeFromLayerToolSchema, input);
    case "arma.eden.set_layer_attributes":
      return executeActionTool(state, "eden.set_layer_attributes", "write", setLayerAttributesToolSchema, input);
    case "arma.eden.delete_layer":
      return executeActionTool(state, "eden.delete_layer", "destructive", deleteLayerToolSchema, input);
    case "arma.eden.set_entity_transform":
      return executeActionTool(state, "eden.set_entity_transform", "write", setEntityTransformToolSchema, input);
    case "arma.eden.sync_entities":
      return executeActionTool(state, "eden.sync_entities", "write", mutateConnectionToolSchema, input);
    case "arma.eden.unsync_entities":
      return executeActionTool(state, "eden.unsync_entities", "write", mutateConnectionToolSchema, input);
    case "arma.eden.validate_plan":
      return executeActionTool(state, "eden.validate_plan", "read", validatePlanToolSchema, input);
    case "arma.terrain.sample_area":
      return executeActionTool(state, "terrain.sample_area", "read", terrainSampleAreaToolSchema, input);
    case "arma.terrain.find_flat_area":
      return executeActionTool(state, "terrain.find_flat_area", "read", terrainFindFlatAreaToolSchema, input);
    case "arma.terrain.find_nearest_roads":
      return executeActionTool(state, "terrain.find_nearest_roads", "read", terrainFindNearestRoadsToolSchema, input);
    case "arma.spatial.check_collision":
      return executeActionTool(state, "spatial.check_collision", "read", spatialCheckCollisionToolSchema, input);
    case "arma.spatial.score_placement":
      return executeActionTool(state, "spatial.score_placement", "read", spatialScorePlacementToolSchema, input);
    case "arma.spatial.line_of_sight":
      return executeActionTool(state, "spatial.line_of_sight", "read", spatialLineOfSightToolSchema, input);
    case "arma.spatial.find_cover_positions":
      return executeActionTool(state, "spatial.find_cover_positions", "read", spatialFindCoverPositionsToolSchema, input);
    case "arma.spatial.find_lz_candidates":
      return executeActionTool(state, "spatial.find_lz_candidates", "read", spatialFindLzCandidatesToolSchema, input);
    case "arma.visual.inspectClass":
      return inspectClassVisually(state, input);
    case "arma.visual.getScreenshots": {
      const parsed = catalogClassToolSchema.parse(input);
      return withCatalogDb((catalogDb) => ({ screenshots: listClassScreenshots(catalogDb, parsed.className) }));
    }
    case "arma.visual.addTag": {
      const parsed = visualAddTagToolSchema.parse(input);
      return withCatalogDb((catalogDb) => {
        addCatalogVisualTag(catalogDb, {
          className: parsed.className,
          tag: parsed.tag,
          confidence: parsed.confidence,
          source: parsed.source
        });
        return { ok: true, className: parsed.className, tag: parsed.tag };
      });
    }
    case "arma.visual.findByVisualTags": {
      const parsed = z
        .object({ visual_tags: z.array(z.string().min(1)).min(1).max(20), limit: z.number().int().positive().max(100).default(25) })
        .parse(input);
      return withCatalogDb((catalogDb) => ({ results: searchCatalogClasses(catalogDb, { visualTags: parsed.visual_tags, limit: parsed.limit }) }));
    }
    case "arma_queue_apply_plan": {
      const parsed = queueApplyPlanInputSchema.parse(input);
      if (parsed.plan.dryRun) {
        throw new Error("Refusing to queue a dry-run plan; set dryRun=false after review.");
      }
      const unsupported = validateCheckpointClasses(parsed.plan);
      if (unsupported.length > 0) {
        throw new Error(`Unsupported MVP classname(s): ${unsupported.join(", ")}`);
      }
      const command = await state.queueApplyPlan(parsed.plan);
      return { queued: true, commandId: command.id };
    }
    case "arma_request_editor_snapshot": {
      const parsed = requestSnapshotInputSchema.parse(input);
      const command = await state.queueSnapshotRequest(parsed.scope);
      return { queued: true, commandId: command.id };
    }
  }
}

async function executeCatalogActionTool<T extends z.ZodObject<z.ZodRawShape>>(
  state: ArmaMcpState,
  actionName: ArmaMcpActionName,
  inputSchema: T,
  input: unknown
): Promise<unknown> {
  const parsed = inputSchema.parse(input);
  const result = await dispatchCatalogAction(state, actionName, parsed, "timeoutMs" in parsed ? Number(parsed.timeoutMs) : 60_000);
  return result.result;
}

async function inspectClassWithCamera(state: ArmaMcpState, input: unknown): Promise<unknown> {
  const parsed = cameraCaptureClassAnglesToolSchema.parse(input);
  return withCatalogDb(async (catalogDb) => {
    const runId = createVisualInspectionRun(catalogDb, {
      className: parsed.className,
      status: "running",
      angles: parsed.angles,
      screenshotDir: screenshotCacheDir(parsed.className),
      resolution: [0, 0]
    });
    const result = await captureClassAngles(state, parsed, runId);
    const screenshots = storeCapturedScreenshots(catalogDb, parsed.className, runId, asRecord(result.result));
    const failed = screenshots.filter((shot) => shot.captured === false);
    finishVisualInspectionRun(
      catalogDb,
      runId,
      failed.length > 0 ? "partial" : "complete",
      failed.length > 0 ? "one_or_more_screenshots_failed" : null
    );
    return { ...asRecord(result.result), inspectionRunId: runId, screenshots };
  });
}

async function inspectClassVisually(state: ArmaMcpState, input: unknown): Promise<unknown> {
  const parsed = visualInspectClassToolSchema.parse(input);
  return withCatalogDb((catalogDb) => {
    const catalogClass = getCatalogClass(catalogDb, parsed.className);
    if (!catalogClass) {
      throw new Error(`Class ${parsed.className} is not present in the local catalog cache`);
    }
    if (!parsed.force && !isSafeToMeasure(catalogClass)) {
      throw new Error(`Class ${parsed.className} is not safe for visual inspection without force=true`);
    }
    const screenshotDir = screenshotCacheDir(parsed.className);
    mkdirSync(screenshotDir, { recursive: true });
    const runId = createVisualInspectionRun(catalogDb, {
      className: parsed.className,
      status: "running",
      angles: parsed.angles,
      screenshotDir,
      resolution: parsed.resolution
    });
    return captureClassAngles(state, { ...parsed, runId: String(runId) }, runId).then((result) => {
      const screenshots = storeCapturedScreenshots(catalogDb, parsed.className, runId, asRecord(result.result));
      const failed = screenshots.filter((shot) => shot.captured === false);
      finishVisualInspectionRun(
        catalogDb,
        runId,
        failed.length > 0 ? "partial" : "complete",
        failed.length > 0 ? "one_or_more_screenshots_failed" : null
      );
      return {
        ...asRecord(result.result),
        ok: failed.length === 0,
        inspectionRunId: runId,
        screenshotDir,
        screenshots
      };
    });
  });
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
      return jsonToolResult(await executeActionTool(state, actionName, mode, inputSchema, input));
    }
  );
}

async function executeActionTool<T extends z.ZodObject<z.ZodRawShape>>(
  state: ArmaMcpState,
  actionName: ArmaMcpActionName,
  mode: ArmaMcpActionMode,
  inputSchema: T,
  input: unknown
): Promise<unknown> {
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
  return result.result ?? result;
}

function extractJsonToolResult(result: ReturnType<typeof jsonToolResult>): unknown {
  return JSON.parse(result.content[0].text);
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
