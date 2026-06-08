import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateCheckpointPlan } from "./checkpointPlanner.js";
import { ingestCatalogChunk, normalizeCatalogRecord } from "./catalog.js";
import {
  closeCatalogDb,
  ensureCatalogSchema,
  addCatalogVisualTag,
  findCatalogByDimensions,
  getCatalogSearchDiagnostics,
  getCatalogClass,
  getLatestScanManifest,
  getScanProgress,
  initializeScanTargets,
  insertClassScreenshot,
  listCatalogCategories,
  listCatalogFactions,
  listClassesMissingMeasurements,
  markScanFinished,
  markStaleScans,
  openCatalogDb,
  repairStaleScan,
  searchCatalogClasses,
  upsertCatalogClass,
  upsertClassTags,
  updateFtsIndex,
  writeClassMeasurement,
  writeScanTargetProgress,
  writeScanManifest
} from "./catalogDb.js";
import { generateAaSite, generateCoverLine, generateLz, generatePropWall, generateRoadCheckpoint, generateSmallOutpost } from "./generators.js";
import { isRecoverableListenError, shouldSkipHttpListen, startHttpBridge, type StartedBridge } from "./httpBridge.js";
import { logger } from "./log.js";
import { MCP_DISCOVERY_FALLBACK_TOOL_NAMES } from "./mcpServer.js";
import { createRemoteBridgeState } from "./remoteBridgeState.js";
import { compositionPlanSchema } from "./schema.js";
import { createState } from "./state.js";
import { actionPacketSchema, schemaVersion } from "./protocol.js";
import { enforceToolPolicy } from "./policy.js";

const bridges: StartedBridge[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (bridges.length > 0) {
    await bridges.pop()?.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("catalog database", () => {
  function tempCatalogPath() {
    const dir = mkdtempSync(join(tmpdir(), "arma-mcp-catalog-"));
    tempDirs.push(dir);
    return join(dir, ".mcp-cache", "arma", "catalog.sqlite");
  }

  it("creates the schema idempotently and stores catalog rows", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      ensureCatalogSchema(catalog);

      const tables = catalog.db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name")
        .all()
        .map((row) => String((row as { name: string }).name));
      expect(tables).toContain("classes");
      expect(tables).toContain("classes_fts");
      expect(tables).toContain("class_screenshots");
      expect(tables).toContain("class_visual_tags");

      writeScanManifest(catalog, {
        scanId: "scan_test",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        classCounts: { CfgVehicles: 1 },
        status: "complete",
        finishedAt: "2026-06-07T00:00:00.000Z"
      });

      upsertCatalogClass(catalog, {
        className: "Land_Republic_Terminal_F",
        latestScanId: "scan_test",
        configPath: "CfgVehicles",
        displayName: "Republic Terminal",
        kind: "prop",
        subkind: "terminal",
        editorCategory: "EdCat_Structures",
        editorSubcategory: "EdSubcat_Electronics",
        faction: "BLU_F",
        modelPath: "\\a3\\props_f\\terminal.p3d",
        tags: ["terminal", "republic"],
        rawConfig: { scope: 2 }
      });
      upsertClassTags(catalog, "Land_Republic_Terminal_F", [
        { tag: "terminal", confidence: 0.9 },
        { tag: "console", source: "heuristic", confidence: 0.75 }
      ]);
      updateFtsIndex(catalog, "Land_Republic_Terminal_F");

      const manifest = getLatestScanManifest(catalog);
      expect(manifest).toMatchObject({ scanId: "scan_test", status: "complete" });
      const matches = catalog.db
        .prepare(
          `SELECT classes.class_name AS className, classes.display_name AS displayName
           FROM classes_fts
           JOIN classes ON classes.rowid = classes_fts.rowid
           WHERE classes_fts MATCH ?
           LIMIT 10`
        )
        .all("terminal");
      expect(matches).toMatchObject([{ className: "Land_Republic_Terminal_F", displayName: "Republic Terminal" }]);
      expect(searchCatalogClasses(catalog, { query: "terminal", kind: "prop", tags: ["console"] })).toMatchObject([
        {
          class_name: "Land_Republic_Terminal_F",
          display_name: "Republic Terminal",
          kind: "prop",
          subkind: "terminal"
        }
      ]);
      expect(getCatalogClass(catalog, "Land_Republic_Terminal_F")).toMatchObject({
        class_name: "Land_Republic_Terminal_F",
        display_name: "Republic Terminal",
        raw_config: { scope: 2 }
      });
      expect(listCatalogFactions(catalog)).toMatchObject([{ faction: "BLU_F", count: 1 }]);
      expect(listCatalogCategories(catalog)).toMatchObject([
        { editorCategory: "EdCat_Structures", editorSubcategory: "EdSubcat_Electronics", count: 1 }
      ]);

      writeClassMeasurement(catalog, "Land_Republic_Terminal_F", {
        status: "measured",
        bboxMin: [-1, -2, 0],
        bboxMax: [1, 2, 3],
        center: [0, 0, 1.5],
        widthM: 2,
        depthM: 4,
        heightM: 3,
        sizeOf: 4
      });
      addCatalogVisualTag(catalog, { className: "Land_Republic_Terminal_F", tag: "console", confidence: 0.8 });
      const screenshotId = insertClassScreenshot(catalog, {
        className: "Land_Republic_Terminal_F",
        angle: "front",
        filePath: ".mcp-cache/arma/screenshots/Land_Republic_Terminal_F/front.png",
        cameraPosition: [0, -8, 2],
        cameraTarget: [0, 0, 1]
      });
      expect(screenshotId).toBeGreaterThanOrEqual(0);
      expect(searchCatalogClasses(catalog, { visualTags: ["console"] })[0]).toMatchObject({
        class_name: "Land_Republic_Terminal_F",
        visual_tags: ["console"]
      });
      expect(findCatalogByDimensions(catalog, { minWidth: 1, maxHeight: 4 })[0]).toMatchObject({
        class_name: "Land_Republic_Terminal_F",
        dimensions: { width_m: 2, depth_m: 4, height_m: 3 }
      });
      expect(listClassesMissingMeasurements(catalog)).toHaveLength(0);
    } finally {
      closeCatalogDb(catalog);
    }
  });

  it("tracks scan targets, diagnostics, and stale repair", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      writeScanManifest(catalog, {
        scanId: "scan_progress",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        status: "running"
      });
      initializeScanTargets(catalog, "scan_progress", ["CfgVehicles", "CfgWeapons"]);
      writeScanTargetProgress(catalog, {
        scanId: "scan_progress",
        target: "CfgVehicles",
        status: "running",
        nextChunkIndex: 3,
        totalRecords: 500,
        rowsIngestedDelta: 120,
        startedAt: "2026-06-07T00:00:00.000Z"
      });

      expect(getScanProgress(catalog, "scan_progress")).toMatchObject({
        currentTarget: "CfgVehicles",
        rowsIngested: 120
      });
      expect((getScanProgress(catalog, "scan_progress")?.targets as Record<string, unknown>[])[0]).toMatchObject({
        target: "CfgVehicles",
        targetIndex: 0,
        status: "running",
        nextChunkIndex: 3
      });
      writeScanTargetProgress(catalog, {
        scanId: "scan_progress",
        target: "CfgWeapons",
        status: "running",
        nextChunkIndex: 1
      });
      expect((getScanProgress(catalog, "scan_progress")?.targets as Record<string, unknown>[])[1]).toMatchObject({
        target: "CfgWeapons",
        targetIndex: 1,
        status: "running",
        nextChunkIndex: 1
      });
      const diagnostics = getCatalogSearchDiagnostics(catalog, { query: "console", kind: "prop" }, 0);
      expect(diagnostics).toMatchObject({
        resultCount: 0,
        latestScanStatus: "running",
        relevantTargets: ["CfgVehicles"]
      });
      expect(markStaleScans(catalog, 1)).toBeGreaterThanOrEqual(0);
      const repaired = repairStaleScan(catalog, "scan_progress");
      expect(repaired).toMatchObject({ ok: true });
      expect(getScanProgress(catalog, "scan_progress")?.manifest).toMatchObject({ status: "partial" });
    } finally {
      closeCatalogDb(catalog);
    }
  });

  it("keeps cancelled scan target status sticky after late progress writes", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      writeScanManifest(catalog, {
        scanId: "scan_cancel",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        status: "running"
      });
      initializeScanTargets(catalog, "scan_cancel", ["CfgPatches", "CfgVehicles"]);
      writeScanTargetProgress(catalog, {
        scanId: "scan_cancel",
        target: "CfgVehicles",
        status: "running",
        nextChunkIndex: 10,
        rowsIngestedDelta: 50
      });
      markScanFinished(catalog, "scan_cancel", "cancelled");
      writeScanTargetProgress(catalog, {
        scanId: "scan_cancel",
        target: "CfgVehicles",
        status: "running",
        nextChunkIndex: 11,
        rowsIngestedDelta: 5
      });

      expect((getScanProgress(catalog, "scan_cancel")?.targets as Record<string, unknown>[])[1]).toMatchObject({
        target: "CfgVehicles",
        targetIndex: 1,
        status: "cancelled",
        nextChunkIndex: 10,
        rowsIngested: 50
      });
    } finally {
      closeCatalogDb(catalog);
    }
  });

  it("repairs terminal manifest targets that were left running in persisted scan state", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      writeScanManifest(catalog, {
        scanId: "scan_persisted_cancel",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        status: "cancelled",
        finishedAt: "2026-06-08T00:25:29.000Z"
      });
      initializeScanTargets(catalog, "scan_persisted_cancel", ["CfgVehicles"]);
      catalog.db
        .prepare(
          `UPDATE scan_targets
           SET status = 'running', next_chunk_index = 14, finished_at = '2026-06-08 00:25:29'
           WHERE scan_id = ? AND target = ?`
        )
        .run("scan_persisted_cancel", "CfgVehicles");

      const progress = getScanProgress(catalog, "scan_persisted_cancel");

      expect(progress?.manifest).toMatchObject({ status: "cancelled" });
      expect(progress?.currentTarget).toBeNull();
      expect((progress?.targets as Record<string, unknown>[])[0]).toMatchObject({
        target: "CfgVehicles",
        status: "cancelled",
        finishedAt: "2026-06-08 00:25:29"
      });
    } finally {
      closeCatalogDb(catalog);
    }
  });

  it("filters noisy vehicle rows and tags module roles", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      writeScanManifest(catalog, {
        scanId: "scan_ingest",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        status: "running"
      });
      const ingested = ingestCatalogChunk(catalog, "scan_ingest", {
        config_path: "CfgVehicles",
        records: [
          {
            class_name: "HitPoints",
            display_name: "",
            scope: 0,
            raw_config: {}
          },
          {
            class_name: "ModuleFuel_F",
            display_name: "Fuel Module",
            scope: 2,
            editor_category: "EdCat_Modules",
            editor_subcategory: "EdSubcat_Sites",
            simulation: "logic",
            model_path: "\\a3\\modules_f\\empty.p3d",
            parents: ["Module_F", "Logic"]
          },
          {
            class_name: "Land_Command_Console_F",
            display_name: "Command Console",
            scope: 2,
            editor_category: "EdCat_Props",
            editor_subcategory: "EdSubcat_Electronics",
            model_path: "\\a3\\props_f\\console.p3d"
          }
        ]
      });
      expect(ingested).toBe(2);
      expect(getCatalogClass(catalog, "HitPoints")).toBeNull();
      expect(getCatalogClass(catalog, "ModuleFuel_F")).toMatchObject({ kind: "module" });
      expect(searchCatalogClasses(catalog, { tags: ["command_terminal"] })[0]).toMatchObject({
        class_name: "Land_Command_Console_F"
      });
    } finally {
      closeCatalogDb(catalog);
    }
  });

  it("normalizes modules before vehicle heuristics", () => {
    expect(
      normalizeCatalogRecord("scan_normalize", "CfgVehicles", {
        class_name: "ModuleAmmo_F",
        display_name: "Vehicle Ammo Module",
        simulation: "logic",
        editor_category: "EdCat_Modules",
        parents: ["Module_F", "Logic"]
      })?.catalogClass
    ).toMatchObject({ kind: "module" });
  });
});

describe("managed MCP discovery fallback", () => {
  it("covers the PLAN-002 managed-discovery absence set", () => {
    const fallbackTools = new Set<string>(MCP_DISCOVERY_FALLBACK_TOOL_NAMES);
    for (const toolName of [
      "arma.bridge.diagnostics",
      "arma.camera.captureClassAngles",
      "arma.camera.createPreviewScene",
      "arma.camera.inspectClass",
      "arma.composition.plan",
      "arma.eden.apply_composition",
      "arma.eden.batch",
      "arma.eden.create_entity",
      "arma.eden.find_entities",
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
      "arma.visual.inspectClass",
      "arma_queue_apply_plan",
      "arma_request_editor_snapshot"
    ]) {
      expect(fallbackTools.has(toolName)).toBe(true);
    }
  });
});

describe("sidecar state", () => {
  it("returns ping-like status fields", () => {
    const state = createState();
    expect(state.pendingCommandCount()).toBe(0);
    expect(state.getLastSnapshot()).toBeNull();
  });

  it("queues requestSnapshot commands", () => {
    const state = createState();
    const command = state.queueSnapshotRequest("selection");
    expect(command.type).toBe("requestSnapshot");
    expect(state.pendingCommandCount()).toBe(1);
    expect(state.drainCommands()).toHaveLength(1);
  });

  it("stores snapshots", () => {
    const state = createState();
    const snapshot = state.storeSnapshot({
      id: "snap_test",
      createdAt: "2026-06-07T00:00:00.000Z",
      source: "eden",
      selected: [
        {
          className: "Land_HBarrier_1_F",
          positionATL: [1, 2, 0],
          direction: 90
        }
      ]
    });
    expect(snapshot.id).toBe("snap_test");
    expect(state.getLastSnapshot()?.selected[0]?.className).toBe("Land_HBarrier_1_F");
  });

  it("validates typed action packets", () => {
    expect(() =>
      actionPacketSchema.parse({
        schemaVersion,
        requestId: "req_test",
        action: "eden.get_status",
        mode: "read",
        params: {}
      })
    ).not.toThrow();
    expect(() =>
      actionPacketSchema.parse({
        schemaVersion,
        requestId: "",
        action: "eden.get_status",
        mode: "read",
        params: {}
      })
    ).toThrow();
    expect(() =>
      actionPacketSchema.parse({
        schemaVersion,
        requestId: "req_test",
        action: "eden.run_raw_sqf",
        mode: "debug",
        params: {}
      })
    ).toThrow();
  });

  it("correlates typed action results by requestId", async () => {
    const state = createState();
    const queued = state.queueAction({ action: "eden.get_status", mode: "read" });
    const [command] = state.drainCommands();
    expect(command).toMatchObject({ requestId: queued.action.requestId, action: "eden.get_status" });
    state.completeActionResult({
      schemaVersion,
      requestId: queued.action.requestId,
      ok: true,
      action: "eden.get_status",
      result: { edenOpen: true },
      warnings: []
    });
    await expect(queued.result).resolves.toMatchObject({
      requestId: queued.action.requestId,
      ok: true,
      result: { edenOpen: true }
    });
  });

  it("times out pending actions cleanly", async () => {
    const state = createState(200, 5);
    const queued = state.queueAction({ action: "eden.get_status", mode: "read" });
    await expect(queued.result).rejects.toThrow(/Timed out waiting/);
    expect(state.pendingActionCount()).toBe(0);
  });
});

describe("checkpoint planner", () => {
  it("generates valid operations", () => {
    const { plan } = generateCheckpointPlan({
      prompt: "small CIS checkpoint",
      radiusMeters: 25,
      factionStyle: "cis",
      density: "low"
    });
    expect(() => compositionPlanSchema.parse(plan)).not.toThrow();
    expect(plan.dryRun).toBe(true);
    expect(plan.operations.length).toBeGreaterThan(0);
  });

  it("rejects unsupported operations through schema", () => {
    const { plan } = generateCheckpointPlan({
      prompt: "small checkpoint",
      radiusMeters: 25,
      factionStyle: "generic",
      density: "low"
    });
    expect(() =>
      compositionPlanSchema.parse({
        ...plan,
        dryRun: false,
        operations: [{ type: "deleteObject", id: "bad" }]
      })
    ).toThrow();
  });
});

describe("write policy", () => {
  it("requires confirmation for destructive non-dry-run deletes", () => {
    expect(() =>
      enforceToolPolicy({
        action: "eden.delete_entities",
        dryRun: false
      })
    ).toThrow(/confirmation/);
    expect(() =>
      enforceToolPolicy({
        action: "eden.delete_entities",
        dryRun: false,
        confirmation: { confirmed: true, reason: "remove failed preview" }
      })
    ).not.toThrow();
  });

  it("rejects non-allowlisted write attributes", () => {
    expect(() =>
      enforceToolPolicy({
        action: "eden.set_entity_attributes",
        dryRun: true,
        attributes: { arbitraryCodeField: "nope" }
      })
    ).toThrow(/not allowlisted/);
  });

  it("requires confirmation for risky init writes", () => {
    expect(() =>
      enforceToolPolicy({
        action: "eden.set_entity_attributes",
        dryRun: false,
        attributes: { init: "this callExtension 'x';" }
      })
    ).toThrow(/risky/);
    expect(
      enforceToolPolicy({
        action: "eden.set_entity_attributes",
        dryRun: true,
        attributes: { init: "this callExtension 'x';" }
      }).warnings
    ).toHaveLength(1);
  });
});

describe("procedural generators", () => {
  const generators = [
    generateRoadCheckpoint({ anchor: { positionATL: [100, 200, 0], dir: 90 }, factionTheme: "CIS" }),
    generateSmallOutpost({ anchor: { positionATL: [0, 0, 0], dir: 0 }, factionTheme: "CIS" }),
    generateAaSite({ anchor: { positionATL: [0, 0, 0], dir: 0 } }),
    generateLz({ anchor: { positionATL: [0, 0, 0], dir: 0 } }),
    generateCoverLine({ anchor: { positionATL: [0, 0, 0], dir: 0 } }),
    generatePropWall({ anchor: { positionATL: [0, 0, 0], dir: 0 } })
  ];

  it("returns dry-run batch plans with client refs and layers", () => {
    for (const generated of generators) {
      expect(generated.plan.dryRun).toBe(true);
      expect(generated.plan.operations.length).toBeGreaterThan(0);
      expect(generated.plan.operations.every((operation) => operation.clientRef)).toBe(true);
      expect(generated.plan.operations.every((operation) => operation.layer)).toBe(true);
      expect(generated.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe("HTTP bridge auth", () => {
  it("detects stdio-only existing bridge startup mode", () => {
    expect(shouldSkipHttpListen(["node", "dist/index.js", "--stdio-only-existing-bridge"], {})).toBe(true);
    expect(shouldSkipHttpListen(["node", "dist/index.js"], { ARMA_MCP_SKIP_HTTP_LISTEN: "true" })).toBe(true);
    expect(shouldSkipHttpListen(["node", "dist/index.js"], { ARMA_MCP_SKIP_HTTP_LISTEN: "0" })).toBe(false);
  });

  it("classifies recoverable localhost listen failures", () => {
    expect(isRecoverableListenError(Object.assign(new Error("listen EPERM: operation not permitted 127.0.0.1:38473"), { code: "EPERM" }))).toBe(true);
    expect(isRecoverableListenError(Object.assign(new Error("listen EADDRINUSE: address already in use 127.0.0.1:38473"), { code: "EADDRINUSE" }))).toBe(true);
    expect(isRecoverableListenError(Object.assign(new Error("bad token"), { code: "EINVAL" }))).toBe(false);
  });

  it("rejects invalid token", async () => {
    const state = createState();
    const bridge = await startHttpBridge(state, logger, {
      host: "127.0.0.1",
      port: 0,
      token: "test-token",
      generatedToken: false
    });
    bridges.push(bridge);

    const response = await fetch(`${bridge.url}/bridge/commands`, {
      headers: { authorization: "Bearer nope" }
    });
    expect(response.status).toBe(401);
  });

  it("accepts valid token", async () => {
    const state = createState();
    state.queueSnapshotRequest("selection");
    const bridge = await startHttpBridge(state, logger, {
      host: "127.0.0.1",
      port: 0,
      token: "test-token",
      generatedToken: false
    });
    bridges.push(bridge);

    const response = await fetch(`${bridge.url}/bridge/commands`, {
      headers: { authorization: "Bearer test-token" }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { commands: unknown[] };
    expect(body.commands).toHaveLength(1);
  });

  it("reports bridge runtime diagnostics and poll counters", async () => {
    const state = createState();
    const bridge = await startHttpBridge(state, logger, {
      host: "127.0.0.1",
      port: 0,
      token: "test-token",
      generatedToken: false
    });
    bridges.push(bridge);

    await fetch(`${bridge.url}/bridge/commands`, {
      headers: { authorization: "Bearer nope" }
    });
    await fetch(`${bridge.url}/bridge/commands`, {
      headers: { authorization: "Bearer test-token" }
    });

    const response = await fetch(`${bridge.url}/mcp/status`, {
      headers: { authorization: "Bearer test-token" }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      armaConnected: boolean;
      lastSeenAt: string | null;
      diagnostics: {
        process: { pid: number; mode: string; ownsHttpListener: boolean; httpBridgeUrl: string };
        bridge: { totalCommandPolls: number; lastCommandPollAt: string | null; recentErrors: Array<{ statusCode: number }> };
      };
    };
    expect(body.armaConnected).toBe(true);
    expect(body.lastSeenAt).toBeTypeOf("string");
    expect(body.diagnostics.process).toMatchObject({
      pid: process.pid,
      mode: "stdio",
      ownsHttpListener: true,
      httpBridgeUrl: bridge.url
    });
    expect(body.diagnostics.bridge.totalCommandPolls).toBe(1);
    expect(body.diagnostics.bridge.lastCommandPollAt).toBeTypeOf("string");
    expect(body.diagnostics.bridge.recentErrors[0]).toMatchObject({ statusCode: 401 });
  });

  it("stores posted snapshots", async () => {
    const state = createState();
    const bridge = await startHttpBridge(state, logger, {
      host: "127.0.0.1",
      port: 0,
      token: "test-token",
      generatedToken: false
    });
    bridges.push(bridge);

    const response = await fetch(`${bridge.url}/bridge/snapshot`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        source: "eden",
        selected: [{ className: "Land_HBarrier_1_F", positionATL: [0, 0, 0], direction: 0 }]
      })
    });
    expect(response.status).toBe(200);
    expect(state.getLastSnapshot()?.selected).toHaveLength(1);
  });

  it("lets stdio-only MCP state reuse an existing HTTP bridge", async () => {
    const state = createState();
    const bridge = await startHttpBridge(state, logger, {
      host: "127.0.0.1",
      port: 0,
      token: "test-token",
      generatedToken: false
    });
    bridges.push(bridge);

    const remoteState = createRemoteBridgeState(bridge.config);
    const command = await remoteState.queueSnapshotRequest("all");
    expect(command).toMatchObject({ type: "requestSnapshot", scope: "all" });

    const response = await fetch(`${bridge.url}/bridge/commands`, {
      headers: { authorization: "Bearer test-token" }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { commands: unknown[] };
    expect(body.commands).toMatchObject([{ id: command.id, type: "requestSnapshot", scope: "all" }]);
  });
});
