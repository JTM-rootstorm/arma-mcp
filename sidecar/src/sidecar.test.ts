import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  getCatalogStatus,
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
import { MCP_DISCOVERY_FALLBACK_TOOL_NAMES, pruneTerminalCatalogScanJobIds, recommendCatalogRole } from "./mcpServer.js";
import { mirrorProfileScreenshot } from "./screenshotPaths.js";
import { createRemoteBridgeState } from "./remoteBridgeState.js";
import { compositionPlanSchema } from "./schema.js";
import { createState } from "./state.js";
import { actionNameSchema, actionPacketSchema, schemaVersion } from "./protocol.js";
import { enforceToolPolicy } from "./policy.js";

const bridges: StartedBridge[] = [];
const tempDirs: string[] = [];
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
      addCatalogVisualTag(catalog, { className: "Land_Republic_Terminal_F", tag: "console", confidence: 0.6, source: "manual" });
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
      expect(getCatalogClass(catalog, "Land_Republic_Terminal_F")).toMatchObject({
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

  it("reports screenshot cache mirroring when a standard Arma screenshots directory is autodetected", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    const oldHome = process.env.HOME;
    const oldSourceDir = process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR;
    const home = mkdtempSync(join(tmpdir(), "arma-mcp-home-"));
    tempDirs.push(home);
    try {
      ensureCatalogSchema(catalog);
      delete process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR;
      process.env.HOME = home;
      const screenshotDir = join(home, ".local/share/Arma 3/Screenshots");
      mkdirSync(screenshotDir, { recursive: true });

      expect(getCatalogStatus(catalog).visualInspection).toMatchObject({
        cacheMirroring: true,
        cacheMirroringMode: "auto_detected_standard_path",
        sourceDir: screenshotDir
      });
    } finally {
      if (oldHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = oldHome;
      }
      if (oldSourceDir === undefined) {
        delete process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR;
      } else {
        process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR = oldSourceDir;
      }
      closeCatalogDb(catalog);
    }
  });

  it("does not mark zero-byte screenshots as copied into cache", () => {
    const oldSourceDir = process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR;
    const oldTimeout = process.env.ARMA_MCP_SCREENSHOT_READY_TIMEOUT_MS;
    const dir = mkdtempSync(join(tmpdir(), "arma-mcp-screenshots-"));
    tempDirs.push(dir);
    try {
      process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR = dir;
      process.env.ARMA_MCP_SCREENSHOT_READY_TIMEOUT_MS = "0";
      mkdirSync(join(dir, "arma-mcp", "run"), { recursive: true });
      writeFileSync(join(dir, "arma-mcp", "run", "empty.png"), "");

      expect(mirrorProfileScreenshot("arma-mcp/run/empty.png", join(dir, "cache", "empty.png"))).toMatchObject({
        copied: false,
        warning: expect.stringContaining("source_png_empty")
      });

      writeFileSync(join(dir, "arma-mcp", "run", "full.png"), "png-bytes");
      expect(mirrorProfileScreenshot("arma-mcp/run/full.png", join(dir, "cache", "full.png"))).toMatchObject({
        copied: true
      });
    } finally {
      if (oldSourceDir === undefined) {
        delete process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR;
      } else {
        process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR = oldSourceDir;
      }
      if (oldTimeout === undefined) {
        delete process.env.ARMA_MCP_SCREENSHOT_READY_TIMEOUT_MS;
      } else {
        process.env.ARMA_MCP_SCREENSHOT_READY_TIMEOUT_MS = oldTimeout;
      }
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
      writeScanTargetProgress(catalog, {
        scanId: "scan_progress",
        target: "CfgVehicles",
        status: "running",
        nextChunkIndex: 3,
        totalRecords: 125,
        rowsIngestedDelta: 50
      });

      expect(getScanProgress(catalog, "scan_progress")).toMatchObject({
        currentTarget: "CfgVehicles",
        rowsIngested: 125
      });
      expect((getScanProgress(catalog, "scan_progress")?.targets as Record<string, unknown>[])[0]).toMatchObject({
        target: "CfgVehicles",
        targetIndex: 0,
        status: "running",
        nextChunkIndex: 3,
        catalogRowsIngested: 0
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

  it("prunes terminal foreground catalog scan jobs from active status", () => {
    const jobs = new Map<string, { promise?: Promise<void> }>([
      ["running_foreground", {}],
      ["cancelled_foreground", {}],
      ["missing_foreground", {}],
      ["complete_background", { promise: Promise.resolve() }]
    ]);
    const statuses = new Map<string, string>([
      ["running_foreground", "running"],
      ["cancelled_foreground", "cancelled"],
      ["complete_background", "complete"]
    ]);

    expect(pruneTerminalCatalogScanJobIds(jobs, (scanId) => statuses.get(scanId))).toEqual(["running_foreground"]);
    expect([...jobs.keys()]).toEqual(["running_foreground"]);
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
          },
          {
            class_name: "MainTurret",
            display_name: "",
            scope: 2
          },
          {
            class_name: "ACE_Medical_Menu",
            display_name: "Medical Menu",
            scope: 2
          }
        ]
      });
      expect(ingested).toBe(2);
      expect(getCatalogClass(catalog, "HitPoints")).toBeNull();
      expect(getCatalogClass(catalog, "MainTurret")).toBeNull();
      expect(getCatalogClass(catalog, "ACE_Medical_Menu")).toBeNull();
      expect(getCatalogClass(catalog, "ModuleFuel_F")).toMatchObject({ kind: "module" });
      expect(searchCatalogClasses(catalog, { tags: ["command_terminal"] })[0]).toMatchObject({
        class_name: "Land_Command_Console_F"
      });
      expect(searchCatalogClasses(catalog, { query: "console", kind: "prop" })[0]).toMatchObject({
        class_name: "Land_Command_Console_F"
      });
    } finally {
      closeCatalogDb(catalog);
    }
  });

  it("uses simulation and editor signals to classify flyable LAATs as vehicles", () => {
    const flyable = normalizeCatalogRecord("scan_laat_vehicle", "CfgVehicles", {
      className: "442_laat_2",
      displayName: "LAAT/I Gunship",
      scope: 2,
      simulation: "helicopterrtd",
      vehicleClass: "Air",
      editorSubcategory: "EdSubcat_Helicopters",
      modelPath: "kobra\\442_a_vehicle\\laat\\Laat.p3d",
      parents: ["Helicopter_Base_H"]
    });
    expect(flyable?.catalogClass).toMatchObject({
      className: "442_laat_2",
      kind: "vehicle",
      categorizationSource: "vehicle_signal"
    });
    expect(flyable?.tags).toContain("vehicle_air");

    const cruiser = normalizeCatalogRecord("scan_cruiser", "CfgVehicles", {
      className: "MTCcombat",
      displayName: "Modular Taskforce Cruiser [Combat Module]",
      scope: 2,
      simulation: "house",
      vehicleClass: "Structures_Town",
      editorCategory: "basedship",
      editorSubcategory: "EdSubCat_HeavyCruisers",
      modelPath: "victoryIISD\\MTCcombat.p3d"
    });
    expect(cruiser?.catalogClass.kind).toBe("structure");
    expect(cruiser?.tags).not.toContain("module_task");
  });

  it("keeps package rows out of default cached asset search results", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      writeScanManifest(catalog, {
        scanId: "scan_laat",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        status: "complete"
      });
      upsertCatalogClass(catalog, {
        className: "3AS_LAAT",
        latestScanId: "scan_laat",
        configPath: "CfgPatches",
        displayName: "",
        kind: "config",
        tags: ["config", "republic"]
      });
      updateFtsIndex(catalog, "3AS_LAAT");

      expect(searchCatalogClasses(catalog, { query: "LAAT" })).toEqual([]);
      expect(searchCatalogClasses(catalog, { query: "LAAT", kind: "config" })[0]).toMatchObject({
        class_name: "3AS_LAAT"
      });
    } finally {
      closeCatalogDb(catalog);
    }
  });

  it("ranks flyable LAAT variants above wrecks and doors", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      writeScanManifest(catalog, {
        scanId: "scan_laat_rank",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        status: "complete"
      });
      for (const item of [
        {
          className: "3AS_LAAT_Mk1_StaticWreck",
          displayName: "LAAT/I Mk1 (Wrecked)",
          kind: "structure",
          simulation: "house",
          vehicleClass: "Structures_Town",
          editorSubcategory: "3AS_EditorSubcategory_Wrecks",
          modelPath: "3as\\3AS_laat\\LAATi\\model\\TCW_LAAT_wreck.p3d",
          tags: ["structure", "wreck", "vehicle_air"]
        },
        {
          className: "3AS_LAAT_Door_Left",
          displayName: "LAAT/I Door Left",
          kind: "structure",
          simulation: "house",
          vehicleClass: "Structures_Town",
          editorSubcategory: "3AS_EditorSubcategory_Props",
          modelPath: "3as\\3AS_laat\\LAATi\\model\\TCW_LAAT_door.p3d",
          tags: ["structure", "vehicle_air"]
        },
        {
          className: "442_laat_2",
          displayName: "LAAT/I Gunship",
          kind: "vehicle",
          simulation: "helicopterrtd",
          vehicleClass: "Air",
          editorSubcategory: "EdSubcat_Helicopters",
          modelPath: "kobra\\442_a_vehicle\\laat\\Laat.p3d",
          tags: ["vehicle", "republic", "vehicle_air"]
        }
      ]) {
        upsertCatalogClass(catalog, {
          className: item.className,
          latestScanId: "scan_laat_rank",
          configPath: "CfgVehicles",
          displayName: item.displayName,
          kind: item.kind,
          simulation: item.simulation,
          vehicleClass: item.vehicleClass,
          editorSubcategory: item.editorSubcategory,
          modelPath: item.modelPath,
          scope: 2,
          tags: item.tags
        });
        upsertClassTags(
          catalog,
          item.className,
          item.tags.map((tag) => ({ tag, confidence: 0.9 }))
        );
        updateFtsIndex(catalog, item.className);
      }

      expect(searchCatalogClasses(catalog, { query: "LAAT" }).map((item) => item.class_name)).toEqual([
        "442_laat_2",
        "3AS_LAAT_Door_Left",
        "3AS_LAAT_Mk1_StaticWreck"
      ]);
    } finally {
      closeCatalogDb(catalog);
    }
  });

  it("falls back from console text to terminal-tagged cached assets", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      writeScanManifest(catalog, {
        scanId: "scan_terminal",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        status: "complete"
      });
      upsertCatalogClass(catalog, {
        className: "Land_Airport_center_F",
        latestScanId: "scan_terminal",
        configPath: "CfgVehicles",
        displayName: "Airport Terminal",
        kind: "prop",
        subkind: "terminal",
        modelPath: "\\a3\\structures_f\\airport_center.p3d",
        scope: 2,
        tags: ["prop", "terminal"]
      });
      upsertClassTags(catalog, "Land_Airport_center_F", [{ tag: "terminal", confidence: 0.9 }]);
      updateFtsIndex(catalog, "Land_Airport_center_F");

      expect(searchCatalogClasses(catalog, { query: "console", kind: "prop" })[0]).toMatchObject({
        class_name: "Land_Airport_center_F"
      });
    } finally {
      closeCatalogDb(catalog);
    }
  });


  it("prefers medical-tagged assets over broad supply role results", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      writeScanManifest(catalog, {
        scanId: "scan_medical",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        status: "complete"
      });
      for (const item of [
        { className: "Box_Ammo_F", displayName: "Ammo Supply Box", tags: ["supply", "ammo_crate"] },
        { className: "Box_B_UAV_06_medical_F", displayName: "AL-6 Case (Medical) [NATO]", tags: ["prop", "medical", "medical_crate"] },
        { className: "Land_Medical_Terminal_F", displayName: "Medical Terminal Case", tags: ["prop", "terminal"], subkind: "terminal" },
        { className: "3AS_Medical_Bed", displayName: "Medical Bed", tags: ["prop", "medical"] }
      ]) {
        upsertCatalogClass(catalog, {
          className: item.className,
          latestScanId: "scan_medical",
          configPath: "CfgVehicles",
          displayName: item.displayName,
          kind: "prop",
          subkind: item.subkind,
          modelPath: "\\a3\\props_f\\placeholder.p3d",
          scope: 2,
          tags: item.tags
        });
        upsertClassTags(
          catalog,
          item.className,
          item.tags.map((tag) => ({ tag, confidence: 0.9 }))
        );
        updateFtsIndex(catalog, item.className);
      }

      expect(recommendCatalogRole(catalog, "medical", 5)[0]).toMatchObject({
        class_name: "3AS_Medical_Bed",
          matched_role: "medical"
        });
      expect(searchCatalogClasses(catalog, { query: "medical" })[0]).toMatchObject({
        class_name: "3AS_Medical_Bed"
      });
    } finally {
      closeCatalogDb(catalog);
    }
  });

  it("keeps object-style repair searches from defaulting to units", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      writeScanManifest(catalog, {
        scanId: "scan_repair",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        status: "complete"
      });
      for (const item of [
        { className: "B_soldier_repair_F", displayName: "Repair Specialist", kind: "unit", tags: ["unit"] },
        { className: "B_AssaultPack_rgr_Repair", displayName: "Repair Pack", kind: "prop", tags: ["prop", "repair"] }
      ]) {
        upsertCatalogClass(catalog, {
          className: item.className,
          latestScanId: "scan_repair",
          configPath: "CfgVehicles",
          displayName: item.displayName,
          kind: item.kind,
          modelPath: "\\a3\\props_f\\placeholder.p3d",
          scope: 2,
          tags: item.tags
        });
        upsertClassTags(
          catalog,
          item.className,
          item.tags.map((tag) => ({ tag, confidence: 0.9 }))
        );
        updateFtsIndex(catalog, item.className);
      }

      expect(searchCatalogClasses(catalog, { query: "repair" }).map((item) => item.class_name)).toEqual(["B_AssaultPack_rgr_Repair"]);
      expect(searchCatalogClasses(catalog, { query: "repair", kind: "unit" })[0]).toMatchObject({
        class_name: "B_soldier_repair_F"
      });
    } finally {
      closeCatalogDb(catalog);
    }
  });

  it("ranks useful turret and repair assets above decorative text matches", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      writeScanManifest(catalog, {
        scanId: "scan_rank_polish",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        status: "complete"
      });
      for (const item of [
        {
          className: "lsb_BactaTank_Turret",
          displayName: "Bacta Tank",
          kind: "vehicle",
          editorSubcategory: "lsb_bacta",
          tags: ["vehicle"]
        },
        {
          className: "3AS_BlasterTurret",
          displayName: "Blaster Turret",
          kind: "vehicle",
          editorSubcategory: "EdSubcat_Turrets",
          tags: ["vehicle", "static_weapon"]
        },
        {
          className: "Land_AttachedSign_02_v1_F",
          displayName: "Billboard 6 (Phone Repair)",
          kind: "prop",
          editorSubcategory: "EdSubcat_Services",
          tags: ["prop", "repair"]
        },
        {
          className: "B_Slingload_01_Repair_F",
          displayName: "Huron Repair Container",
          kind: "prop",
          editorSubcategory: "EdSubcat_Storage",
          tags: ["prop", "repair"]
        }
      ]) {
        upsertCatalogClass(catalog, {
          className: item.className,
          latestScanId: "scan_rank_polish",
          configPath: "CfgVehicles",
          displayName: item.displayName,
          kind: item.kind,
          editorSubcategory: item.editorSubcategory,
          modelPath: "\\a3\\props_f\\placeholder.p3d",
          scope: 2,
          tags: item.tags
        });
        upsertClassTags(
          catalog,
          item.className,
          item.tags.map((tag) => ({ tag, confidence: 0.9 }))
        );
        updateFtsIndex(catalog, item.className);
      }

      expect(searchCatalogClasses(catalog, { query: "turret" })[0]).toMatchObject({
        class_name: "3AS_BlasterTurret"
      });
      expect(searchCatalogClasses(catalog, { query: "repair" })[0]).toMatchObject({
        class_name: "B_Slingload_01_Repair_F"
      });
    } finally {
      closeCatalogDb(catalog);
    }
  });


  it("lets prop searches find placeable sandbag-style fortifications", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      writeScanManifest(catalog, {
        scanId: "scan_sandbag",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        status: "complete"
      });
      upsertCatalogClass(catalog, {
        className: "Land_BagFence_Long_F",
        latestScanId: "scan_sandbag",
        configPath: "CfgVehicles",
        displayName: "Sandbag Wall",
        kind: "fortification",
        scope: 2,
        modelPath: "\\a3\\structures_f\\bagfence.p3d",
        tags: ["fortification", "cover_low", "wall_segment"]
      });
      upsertClassTags(catalog, "Land_BagFence_Long_F", [
        { tag: "cover_low", confidence: 0.9 },
        { tag: "wall_segment", confidence: 0.9 }
      ]);
      updateFtsIndex(catalog, "Land_BagFence_Long_F");

      expect(searchCatalogClasses(catalog, { query: "sandbag", kind: "prop" })[0]).toMatchObject({
        class_name: "Land_BagFence_Long_F",
        kind: "fortification"
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
      "arma_catalog_find_by_role",
      "arma_catalog_get_class",
      "arma_catalog_search",
      "arma_catalog_status",
      "arma_composition_plan",
      "arma_eden_list_placed",
      "arma_visual_inspect_class",
      "arma.eden.inspectClass",
      "arma.eden.planComposition",
      "arma.assets.search_classes",
      "arma.catalog.findByDimensions",
      "arma.catalog.findByRole",
      "arma.catalog.findSimilar",
      "arma.catalog.getClass",
      "arma.catalog.getTags",
      "arma.catalog.listCategories",
      "arma.catalog.listFactions",
      "arma.catalog.listMods",
      "arma.catalog.measureClass",
      "arma.catalog.measureMissing",
      "arma.catalog.measureSearchResults",
      "arma.catalog.recommend",
      "arma.catalog.scan",
      "arma.catalog.scanCancel",
      "arma.catalog.scanFinalize",
      "arma.catalog.scanPoll",
      "arma.catalog.scanRepair",
      "arma.catalog.scanStart",
      "arma.catalog.scanStatus",
      "arma.catalog.search",
      "arma.catalog.status",
      "arma.composition.exportEdenInstructions",
      "arma.composition.exportSqf",
      "arma.composition.plan",
      "arma.composition.previewLocal",
      "arma.eden.apply_composition",
      "arma.eden.batch",
      "arma.eden.capture_composition",
      "arma.eden.create_entity",
      "arma.eden.exportSelection",
      "arma.eden.find_entities",
      "arma.eden.getObject",
      "arma.eden.getSynced",
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
      "arma.terrain.find_flat_area",
      "arma.terrain.find_nearest_roads",
      "arma.terrain.sample_area",
      "arma.spatial.check_collision",
      "arma.spatial.find_cover_positions",
      "arma.spatial.find_lz_candidates",
      "arma.spatial.line_of_sight",
      "arma.spatial.score_placement",
      "arma.visual.addTag",
      "arma.visual.findByVisualTags",
      "arma.visual.getScreenshots",
      "arma.visual.inspectClass",
      "arma_queue_apply_plan",
      "arma_request_editor_snapshot"
    ]) {
      expect(fallbackTools.has(toolName)).toBe(true);
    }
  });
});

describe("synthetic Eden action inventory", () => {
  const sqf = (relativePath: string) => readFileSync(join(repoRoot, relativePath), "utf8");

  it("keeps direct protocol actions advertised and dispatched by the addon", () => {
    const capabilities = sqf("addons/main/functions/fn_getCapabilities.sqf");
    const dispatcher = sqf("addons/main/functions/fn_dispatchAction.sqf");

    const protocolActions = actionNameSchema.options;
    const missing = protocolActions
      .filter((action) => !capabilities.includes(`"${action}"`) || !dispatcher.includes(`case "${action}"`))
      .map((action) => ({
        action,
        capability: capabilities.includes(`"${action}"`),
        dispatcher: dispatcher.includes(`case "${action}"`)
      }));

    expect(missing).toEqual([]);
  });

  it("keeps managed-discovery fallback tools callable through arma_call", () => {
    const source = sqf("sidecar/src/mcpServer.ts");
    const missing = MCP_DISCOVERY_FALLBACK_TOOL_NAMES.filter((toolName) => !source.includes(`case "${toolName}"`));

    expect(missing).toEqual([]);
  });

  it("keeps SQF batch validator and executor operation registries aligned", () => {
    const validator = sqf("addons/main/functions/fn_validateBatch.sqf");
    const executor = sqf("addons/main/functions/fn_applyBatch.sqf");
    const requiredOps = [
      "create_entity",
      "create_marker",
      "create_trigger",
      "create_waypoint",
      "create_module",
      "create_layer",
      "set_transform",
      "set_attributes",
      "delete_entity",
      "select_entities",
      "assign_layer",
      "remove_from_layer",
      "sync_entities",
      "unsync_entities"
    ];

    const missing = requiredOps
      .filter((op) => !validator.includes(`"${op}"`) || !executor.includes(`"${op}"`))
      .map((op) => ({
        op,
        validator: validator.includes(`"${op}"`),
        executor: executor.includes(`"${op}"`)
      }));

    expect(missing).toEqual([]);
  });

  it("normalizes marker top-level fields before create/apply", () => {
    const createEntity = sqf("addons/main/functions/fn_createEntity.sqf");

    expect(createEntity).toContain('if (_entityType isEqualTo "Marker")');
    for (const field of ["text", "markerType", "color", "shape", "brush", "alpha", "size", "angle"]) {
      expect(createEntity).toContain(field);
    }
  });

  it("keeps spatial actions routed through a structured SQF helper", () => {
    const spatialOps = sqf("addons/main/functions/fn_spatialOps.sqf");
    const dispatcher = sqf("addons/main/functions/fn_dispatchAction.sqf");

    for (const [action, operation] of [
      ["terrain.find_flat_area", "findFlatArea"],
      ["terrain.find_nearest_roads", "findNearestRoads"],
      ["spatial.check_collision", "checkCollision"],
      ["spatial.score_placement", "scorePlacement"],
      ["spatial.line_of_sight", "lineOfSight"],
      ["spatial.find_cover_positions", "findCoverPositions"],
      ["spatial.find_lz_candidates", "findLzCandidates"]
    ]) {
      expect(dispatcher).toContain(`case "${action}"`);
      expect(spatialOps).toContain(`case "${operation}"`);
    }
    expect(spatialOps).toContain("blocking");
    expect(spatialOps).toContain("warnings");
    expect(spatialOps).toContain("score");
  });

  it("keeps live asset search and class details multi-root", () => {
    const searchClasses = sqf("addons/main/functions/fn_searchClasses.sqf");
    const getClassDetails = sqf("addons/main/functions/fn_getClassDetails.sqf");

    for (const root of [
      "CfgVehicles",
      "CfgWeapons",
      "CfgMagazines",
      "CfgAmmo",
      "CfgGroups",
      "CfgMarkers",
      "CfgFactionClasses",
      "CfgEditorCategories",
      "CfgEditorSubcategories",
      "Cfg3DEN"
    ]) {
      expect(searchClasses).toContain(root);
      expect(getClassDetails).toContain(root);
    }
    for (const field of ["hiddenSelections", "animationSources", "scopeArsenal", "simulation", "parents"]) {
      expect(getClassDetails).toContain(field);
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

  it("removes queued typed actions when they time out before Eden polls", async () => {
    const state = createState();
    const queued = state.queueAction({ action: "bridge.ping", mode: "read", timeoutMs: 1 });

    await expect(queued.result).rejects.toThrow("Timed out waiting for Arma result for bridge.ping");
    expect(state.pendingCommandCount()).toBe(0);
    expect(state.pendingActionCount()).toBe(0);
    expect(state.drainCommands()).toHaveLength(0);
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
