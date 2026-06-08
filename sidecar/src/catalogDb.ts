import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const CATALOG_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CATALOG_DB_PATH = ".mcp-cache/arma/catalog.sqlite";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type CatalogDb = {
  db: DatabaseSync;
  path: string;
};

export type ScanManifestInput = {
  scanId: string;
  schemaVersion?: number;
  gameVersion?: string | null;
  worldName?: string | null;
  loadedModsHash: string;
  loadedAddonsHash: string;
  classCounts?: Record<string, number>;
  finishedAt?: string | null;
  status?: ScanStatus;
};

export type ScanStatus = "pending" | "running" | "partial" | "stale" | "complete" | "failed" | "cancelled";

export type ScanTargetStatus = "pending" | "running" | "complete" | "failed" | "cancelled";

export type ScanTargetProgressInput = {
  scanId: string;
  target: string;
  targetIndex?: number;
  status?: ScanTargetStatus;
  nextChunkIndex?: number;
  totalRecords?: number | null;
  rowsIngestedDelta?: number;
  rowsIngested?: number;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

const terminalScanStatuses = new Set(["complete", "failed", "cancelled"]);

export type CatalogClassInput = {
  className: string;
  latestScanId: string;
  configPath: string;
  displayName?: string | null;
  kind?: string | null;
  subkind?: string | null;
  categorizationConfidence?: number;
  categorizationSource?: string | null;
  sourceAddon?: string | null;
  sourceModGuess?: string | null;
  author?: string | null;
  dlc?: string | null;
  scope?: number | null;
  scopeCurator?: number | null;
  scopeArsenal?: number | null;
  editorCategory?: string | null;
  editorSubcategory?: string | null;
  vehicleClass?: string | null;
  faction?: string | null;
  side?: number | null;
  simulation?: string | null;
  modelPath?: string | null;
  picture?: string | null;
  icon?: string | null;
  editorPreview?: string | null;
  isSimpleObjectCompatible?: boolean | null;
  weapons?: unknown[];
  magazines?: unknown[];
  linkedItems?: unknown[];
  rawConfig?: Record<string, unknown>;
  tags?: string[];
};

export type ClassTagInput = {
  tag: string;
  source?: string;
  confidence?: number;
};

export type ClassMeasurementInput = {
  status: "measured" | "failed" | "skipped";
  error?: string | null;
  bboxMin?: [number, number, number] | null;
  bboxMax?: [number, number, number] | null;
  center?: [number, number, number] | null;
  widthM?: number | null;
  depthM?: number | null;
  heightM?: number | null;
  sizeOf?: number | null;
};

export function openCatalogDb(dbPath = DEFAULT_CATALOG_DB_PATH): CatalogDb {
  const resolvedPath = resolve(repoRoot, process.env.ARMA_MCP_CATALOG_DB ?? dbPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`PRAGMA busy_timeout = ${catalogBusyTimeoutMs()};`);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  return { db, path: resolvedPath };
}

function catalogBusyTimeoutMs(): number {
  const parsed = Number(process.env.ARMA_MCP_CATALOG_BUSY_TIMEOUT_MS ?? 10_000);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 10_000;
  }
  return Math.min(Math.trunc(parsed), 120_000);
}

export function getCatalogStatus(catalogDb: CatalogDb): Record<string, unknown> {
  markStaleScans(catalogDb);
  const classCount = scalarCount(catalogDb, "classes");
  const measurementCount = scalarCount(catalogDb, "class_measurements");
  const screenshotCount = scalarCount(catalogDb, "class_screenshots");
  const latestScan = getLatestScanManifest(catalogDb);
  return {
    path: catalogDb.path,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    cacheState: latestScan ? scanCacheState(catalogDb, String(latestScan.scanId)) : "empty",
    latestScan: latestScan ? getScanProgress(catalogDb, String(latestScan.scanId)) : null,
    counts: {
      classes: classCount,
      measurements: measurementCount,
      screenshots: screenshotCount
    },
    visualInspection: {
      screenshotCapture: true,
      status: "implemented",
      cacheMirroring: Boolean(process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR),
      sourceDirEnv: "ARMA_MCP_SCREENSHOT_SOURCE_DIR"
    }
  };
}

function scalarCount(catalogDb: CatalogDb, tableName: string): number {
  const row = catalogDb.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return Number(row.count);
}

export type CatalogSearchInput = {
  query?: string;
  kind?: string;
  tags?: string[];
  visualTags?: string[];
  limit?: number;
};

export function searchCatalogClasses(catalogDb: CatalogDb, input: CatalogSearchInput): Record<string, unknown>[] {
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const filters: string[] = [];
  const values: Array<string | number | null> = [];
  let from = "classes";
  if (input.query?.trim()) {
    from = "classes_fts JOIN classes ON classes.rowid = classes_fts.rowid";
    filters.push("classes_fts MATCH ?");
    values.push(input.query.trim());
  }
  if (input.kind) {
    filters.push("classes.kind = ?");
    values.push(input.kind);
  }
  for (const tag of input.tags ?? []) {
    filters.push(
      `EXISTS (
        SELECT 1 FROM class_tags
        WHERE class_tags.class_name = classes.class_name
          AND class_tags.tag = ?
      )`
    );
    values.push(tag);
  }
  for (const tag of input.visualTags ?? []) {
    filters.push(
      `EXISTS (
        SELECT 1 FROM class_visual_tags
        WHERE class_visual_tags.class_name = classes.class_name
          AND class_visual_tags.tag = ?
      )`
    );
    values.push(tag);
  }
  values.push(limit);

  const rows = catalogDb.db
    .prepare(
      `SELECT
        classes.class_name AS className,
        classes.display_name AS displayName,
        classes.kind,
        classes.subkind,
        classes.tags_json AS tagsJson,
        COALESCE((SELECT json_group_array(tag) FROM class_visual_tags WHERE class_visual_tags.class_name = classes.class_name), '[]') AS visualTagsJson,
        classes.source_addon AS sourceAddon,
        classes.source_mod_guess AS sourceMod,
        classes.editor_category AS editorCategory,
        classes.editor_subcategory AS editorSubcategory,
        class_measurements.width_m AS widthM,
        class_measurements.depth_m AS depthM,
        class_measurements.height_m AS heightM
       FROM ${from}
       LEFT JOIN class_measurements ON class_measurements.class_name = classes.class_name
       ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY classes.display_name IS NULL, classes.display_name, classes.class_name
       LIMIT ?`
    )
    .all(...values);
  return rows.map((row) => formatCatalogSearchRow(row as CatalogSearchRow));
}

export function getCatalogSearchDiagnostics(
  catalogDb: CatalogDb,
  input: CatalogSearchInput,
  resultCount: number
): Record<string, unknown> {
  const latestScan = getLatestScanManifest(catalogDb);
  const relevantTargets = relevantSearchTargets(input);
  const progress = latestScan ? getScanProgress(catalogDb, String(latestScan.scanId)) : null;
  const targets = progress && Array.isArray(progress.targets) ? (progress.targets as Record<string, unknown>[]) : [];
  const targetStates = targets
    .filter((target) => relevantTargets.includes(String(target.target)))
    .map((target) => ({
      target: target.target,
      status: target.status,
      nextChunkIndex: target.nextChunkIndex,
      rowsIngested: target.rowsIngested,
      totalRecords: target.totalRecords
    }));
  const latestStatus = String((progress?.manifest as Record<string, unknown> | undefined)?.status ?? "");
  return {
    resultCount,
    latestScanStatus: latestStatus || null,
    cacheState: latestScan ? scanCacheState(catalogDb, String(latestScan.scanId)) : "empty",
    relevantTargets,
    targetStates,
    hint:
      resultCount === 0 && ["", "pending", "running", "partial", "stale"].includes(latestStatus)
        ? "The catalog may be incomplete. Poll, resume/repair the scan, or use live asset search while cache data is partial."
        : null
  };
}

export function getCatalogClass(catalogDb: CatalogDb, className: string): Record<string, unknown> | null {
  const row = catalogDb.db
    .prepare(
      `SELECT
        classes.*,
        class_measurements.status AS measurement_status,
        class_measurements.error AS measurement_error,
        class_measurements.width_m,
        class_measurements.depth_m,
        class_measurements.height_m,
        class_measurements.size_of
       FROM classes
       LEFT JOIN class_measurements ON class_measurements.class_name = classes.class_name
       WHERE classes.class_name = ?`
    )
    .get(className) as Record<string, unknown> | undefined;
  return row ? formatCatalogClassRow(catalogDb, row) : null;
}

export function writeClassMeasurement(catalogDb: CatalogDb, className: string, measurement: ClassMeasurementInput): void {
  catalogDb.db
    .prepare(
      `INSERT INTO class_measurements (
        class_name,
        status,
        error,
        bbox_min_x,
        bbox_min_y,
        bbox_min_z,
        bbox_max_x,
        bbox_max_y,
        bbox_max_z,
        center_x,
        center_y,
        center_z,
        width_m,
        depth_m,
        height_m,
        size_of,
        measured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(class_name) DO UPDATE SET
        status = excluded.status,
        error = excluded.error,
        bbox_min_x = excluded.bbox_min_x,
        bbox_min_y = excluded.bbox_min_y,
        bbox_min_z = excluded.bbox_min_z,
        bbox_max_x = excluded.bbox_max_x,
        bbox_max_y = excluded.bbox_max_y,
        bbox_max_z = excluded.bbox_max_z,
        center_x = excluded.center_x,
        center_y = excluded.center_y,
        center_z = excluded.center_z,
        width_m = excluded.width_m,
        depth_m = excluded.depth_m,
        height_m = excluded.height_m,
        size_of = excluded.size_of,
        measured_at = CURRENT_TIMESTAMP`
    )
    .run(
      className,
      measurement.status,
      measurement.error ?? null,
      measurement.bboxMin?.[0] ?? null,
      measurement.bboxMin?.[1] ?? null,
      measurement.bboxMin?.[2] ?? null,
      measurement.bboxMax?.[0] ?? null,
      measurement.bboxMax?.[1] ?? null,
      measurement.bboxMax?.[2] ?? null,
      measurement.center?.[0] ?? null,
      measurement.center?.[1] ?? null,
      measurement.center?.[2] ?? null,
      measurement.widthM ?? null,
      measurement.depthM ?? null,
      measurement.heightM ?? null,
      measurement.sizeOf ?? null
    );
}

export function listClassesMissingMeasurements(catalogDb: CatalogDb, limit = 25, kinds?: string[]): Record<string, unknown>[] {
  const filters = ["class_measurements.class_name IS NULL"];
  const values: Array<string | number> = [];
  if (kinds && kinds.length > 0) {
    filters.push(`classes.kind IN (${kinds.map(() => "?").join(", ")})`);
    values.push(...kinds);
  }
  values.push(Math.max(1, Math.min(limit, 200)));
  return catalogDb.db
    .prepare(
      `SELECT classes.class_name AS className, classes.display_name AS displayName, classes.kind, classes.subkind
       FROM classes
       LEFT JOIN class_measurements ON class_measurements.class_name = classes.class_name
       WHERE ${filters.join(" AND ")}
       ORDER BY classes.display_name IS NULL, classes.display_name, classes.class_name
       LIMIT ?`
    )
    .all(...values)
    .map((row) => ({ ...(row as Record<string, unknown>) }));
}

export function getCatalogTags(catalogDb: CatalogDb, className?: string): Record<string, unknown>[] {
  const sql = className
    ? `SELECT tag, source, confidence, COUNT(*) AS count FROM class_tags WHERE class_name = ? GROUP BY tag, source, confidence ORDER BY tag`
    : `SELECT tag, source, AVG(confidence) AS confidence, COUNT(*) AS count FROM class_tags GROUP BY tag, source ORDER BY tag`;
  const rows = className ? catalogDb.db.prepare(sql).all(className) : catalogDb.db.prepare(sql).all();
  return rows.map((row) => ({ ...(row as Record<string, unknown>) }));
}

export function listCatalogMods(catalogDb: CatalogDb): Record<string, unknown>[] {
  return catalogDb.db
    .prepare(
      `SELECT mod_name AS modName, mod_dir AS modDir, mod_hash AS modHash, is_loaded AS isLoaded
       FROM mods
       ORDER BY mod_name, mod_dir`
    )
    .all()
    .map((row) => ({ ...(row as Record<string, unknown>) }));
}

export function listCatalogFactions(catalogDb: CatalogDb): Record<string, unknown>[] {
  return catalogDb.db
    .prepare(
      `SELECT faction, COUNT(*) AS count
       FROM classes
       WHERE faction IS NOT NULL AND faction != ''
       GROUP BY faction
       ORDER BY faction`
    )
    .all()
    .map((row) => ({ ...(row as Record<string, unknown>) }));
}

export function listCatalogCategories(catalogDb: CatalogDb): Record<string, unknown>[] {
  return catalogDb.db
    .prepare(
      `SELECT editor_category AS editorCategory, editor_subcategory AS editorSubcategory, COUNT(*) AS count
       FROM classes
       WHERE editor_category IS NOT NULL AND editor_category != ''
       GROUP BY editor_category, editor_subcategory
       ORDER BY editor_category, editor_subcategory`
    )
    .all()
    .map((row) => ({ ...(row as Record<string, unknown>) }));
}

export function findCatalogByDimensions(
  catalogDb: CatalogDb,
  input: { minWidth?: number; maxWidth?: number; minDepth?: number; maxDepth?: number; minHeight?: number; maxHeight?: number; limit?: number }
): Record<string, unknown>[] {
  const filters = ["class_measurements.status = 'measured'"];
  const values: Array<string | number> = [];
  for (const [field, min, max] of [
    ["width_m", input.minWidth, input.maxWidth],
    ["depth_m", input.minDepth, input.maxDepth],
    ["height_m", input.minHeight, input.maxHeight]
  ] as const) {
    if (min !== undefined) {
      filters.push(`class_measurements.${field} >= ?`);
      values.push(min);
    }
    if (max !== undefined) {
      filters.push(`class_measurements.${field} <= ?`);
      values.push(max);
    }
  }
  values.push(Math.max(1, Math.min(input.limit ?? 25, 100)));
  return catalogDb.db
    .prepare(
      `SELECT
        classes.class_name AS className,
        classes.display_name AS displayName,
        classes.kind,
        classes.subkind,
        classes.tags_json AS tagsJson,
        COALESCE((SELECT json_group_array(tag) FROM class_visual_tags WHERE class_visual_tags.class_name = classes.class_name), '[]') AS visualTagsJson,
        classes.source_addon AS sourceAddon,
        classes.source_mod_guess AS sourceMod,
        classes.editor_category AS editorCategory,
        classes.editor_subcategory AS editorSubcategory,
        class_measurements.width_m AS widthM,
        class_measurements.depth_m AS depthM,
        class_measurements.height_m AS heightM
       FROM classes
       JOIN class_measurements ON class_measurements.class_name = classes.class_name
       WHERE ${filters.join(" AND ")}
       ORDER BY classes.display_name IS NULL, classes.display_name, classes.class_name
       LIMIT ?`
    )
    .all(...values)
    .map((row) => formatCatalogSearchRow(row as CatalogSearchRow));
}

export function addCatalogVisualTag(
  catalogDb: CatalogDb,
  input: { className: string; tag: string; confidence?: number; source?: string; screenshotId?: number; inspectionRunId?: number }
): void {
  catalogDb.db
    .prepare(
      `INSERT INTO class_visual_tags (class_name, tag, confidence, source, screenshot_id, inspection_run_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(class_name, tag, source) DO UPDATE SET
         confidence = excluded.confidence,
         screenshot_id = excluded.screenshot_id,
         inspection_run_id = excluded.inspection_run_id`
    )
    .run(
      input.className,
      input.tag,
      input.confidence ?? 0.5,
      input.source ?? "visual",
      input.screenshotId ?? null,
      input.inspectionRunId ?? null
    );
  updateFtsIndex(catalogDb, input.className);
}

export function listClassScreenshots(catalogDb: CatalogDb, className: string): Record<string, unknown>[] {
  return catalogDb.db
    .prepare(
      `SELECT id, class_name AS className, inspection_run_id AS inspectionRunId, angle, file_path AS filePath, captured_at AS capturedAt
       FROM class_screenshots
       WHERE class_name = ?
       ORDER BY captured_at DESC, id DESC`
    )
    .all(className)
    .map((row) => ({ ...(row as Record<string, unknown>) }));
}

export function insertClassScreenshot(
  catalogDb: CatalogDb,
  input: {
    className: string;
    inspectionRunId?: number | null;
    angle: string;
    filePath: string;
    cameraPosition?: unknown[];
    cameraTarget?: unknown[];
  }
): number {
  const result = catalogDb.db
    .prepare(
      `INSERT INTO class_screenshots (
        class_name,
        inspection_run_id,
        angle,
        file_path,
        camera_position_json,
        camera_target_json
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(class_name, angle, file_path) DO UPDATE SET
        inspection_run_id = excluded.inspection_run_id,
        camera_position_json = excluded.camera_position_json,
        camera_target_json = excluded.camera_target_json`
    )
    .run(
      input.className,
      input.inspectionRunId ?? null,
      input.angle,
      input.filePath,
      JSON.stringify(input.cameraPosition ?? []),
      JSON.stringify(input.cameraTarget ?? [])
    );
  updateFtsIndex(catalogDb, input.className);
  return Number(result.lastInsertRowid);
}

export function createVisualInspectionRun(
  catalogDb: CatalogDb,
  input: { className: string; status: string; error?: string | null; angles?: string[]; screenshotDir?: string; resolution?: [number, number] }
): number {
  const result = catalogDb.db
    .prepare(
      `INSERT INTO visual_inspection_runs (class_name, status, error, angles_json, screenshot_dir, resolution_json, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.className,
      input.status,
      input.error ?? null,
      JSON.stringify(input.angles ?? []),
      input.screenshotDir ?? null,
      JSON.stringify(input.resolution ?? [1280, 720]),
      input.status === "running" ? null : new Date().toISOString()
    );
  return Number(result.lastInsertRowid);
}

export function finishVisualInspectionRun(catalogDb: CatalogDb, runId: number, status: string, error?: string | null): void {
  catalogDb.db
    .prepare(
      `UPDATE visual_inspection_runs
       SET status = ?, error = ?, finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(status, error ?? null, runId);
}

export function closeCatalogDb(catalogDb: CatalogDb): void {
  catalogDb.db.close();
}

export function ensureCatalogSchema(catalogDb: CatalogDb): void {
  runCatalogMigration(catalogDb, CATALOG_SCHEMA_VERSION, "initial catalog schema", CATALOG_SCHEMA_SQL);
}

export function runCatalogMigration(catalogDb: CatalogDb, version = CATALOG_SCHEMA_VERSION, name = "initial catalog schema", sql = CATALOG_SCHEMA_SQL): void {
  catalogDb.db.exec("BEGIN;");
  try {
    catalogDb.db.exec(sql);
    catalogDb.db
      .prepare("INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)")
      .run(version, name);
    catalogDb.db.exec("COMMIT;");
  } catch (error) {
    catalogDb.db.exec("ROLLBACK;");
    throw error;
  }
}

export function getLatestScanManifest(catalogDb: CatalogDb): Record<string, unknown> | null {
  return (
    catalogDb.db
      .prepare(
        `SELECT
          scan_id AS scanId,
          schema_version AS schemaVersion,
          game_version AS gameVersion,
          world_name AS worldName,
          loaded_mods_hash AS loadedModsHash,
          loaded_addons_hash AS loadedAddonsHash,
          class_counts_json AS classCountsJson,
          started_at AS startedAt,
          finished_at AS finishedAt,
          status
        FROM scan_manifests
        ORDER BY started_at DESC, scan_id DESC
        LIMIT 1`
      )
      .get() ?? null
  );
}

export function getScanManifest(catalogDb: CatalogDb, scanId: string): Record<string, unknown> | null {
  return (
    catalogDb.db
      .prepare(
        `SELECT
          scan_id AS scanId,
          schema_version AS schemaVersion,
          game_version AS gameVersion,
          world_name AS worldName,
          loaded_mods_hash AS loadedModsHash,
          loaded_addons_hash AS loadedAddonsHash,
          class_counts_json AS classCountsJson,
          started_at AS startedAt,
          finished_at AS finishedAt,
          status
        FROM scan_manifests
        WHERE scan_id = ?`
      )
      .get(scanId) ?? null
  );
}

export function writeScanManifest(catalogDb: CatalogDb, manifest: ScanManifestInput): void {
  catalogDb.db
    .prepare(
      `INSERT INTO scan_manifests (
        scan_id,
        schema_version,
        game_version,
        world_name,
        loaded_mods_hash,
        loaded_addons_hash,
        class_counts_json,
        finished_at,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scan_id) DO UPDATE SET
        schema_version = excluded.schema_version,
        game_version = excluded.game_version,
        world_name = excluded.world_name,
        loaded_mods_hash = excluded.loaded_mods_hash,
        loaded_addons_hash = excluded.loaded_addons_hash,
        class_counts_json = excluded.class_counts_json,
        finished_at = excluded.finished_at,
        status = excluded.status`
    )
    .run(
      manifest.scanId,
      manifest.schemaVersion ?? CATALOG_SCHEMA_VERSION,
      manifest.gameVersion ?? null,
      manifest.worldName ?? null,
      manifest.loadedModsHash,
      manifest.loadedAddonsHash,
      JSON.stringify(manifest.classCounts ?? {}),
      manifest.finishedAt ?? null,
      manifest.status ?? "running"
    );
}

export function initializeScanTargets(catalogDb: CatalogDb, scanId: string, targets: string[]): void {
  const insert = catalogDb.db.prepare(
    `INSERT INTO scan_targets (scan_id, target, target_index, status)
     VALUES (?, ?, ?, 'pending')
     ON CONFLICT(scan_id, target) DO UPDATE SET
       target_index = excluded.target_index,
       status = CASE WHEN scan_targets.status IN ('complete', 'failed', 'cancelled') THEN scan_targets.status ELSE excluded.status END,
       updated_at = CURRENT_TIMESTAMP`
  );
  catalogDb.db.exec("BEGIN;");
  try {
    targets.forEach((target, index) => insert.run(scanId, target, index));
    catalogDb.db.exec("COMMIT;");
  } catch (error) {
    catalogDb.db.exec("ROLLBACK;");
    throw error;
  }
}

export function writeScanTargetProgress(catalogDb: CatalogDb, input: ScanTargetProgressInput): void {
  const manifest = getScanManifest(catalogDb, input.scanId);
  if (manifest && terminalScanStatuses.has(String(manifest.status))) {
    reconcileTerminalScanTargets(catalogDb, input.scanId, String(manifest.status) as ScanStatus);
    return;
  }
  const existingIndex = input.targetIndex ?? getScanTargetIndex(catalogDb, input.scanId, input.target);
  catalogDb.db
    .prepare(
      `INSERT INTO scan_targets (
        scan_id,
        target,
        target_index,
        status,
        next_chunk_index,
        total_records,
        rows_ingested,
        error,
        started_at,
        finished_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(scan_id, target) DO UPDATE SET
        target_index = COALESCE(excluded.target_index, scan_targets.target_index),
        status = CASE
          WHEN scan_targets.status IN ('complete', 'failed', 'cancelled')
            AND COALESCE(excluded.status, scan_targets.status) NOT IN ('failed', 'cancelled')
            THEN scan_targets.status
          ELSE COALESCE(excluded.status, scan_targets.status)
        END,
        next_chunk_index = CASE
          WHEN scan_targets.status IN ('complete', 'failed', 'cancelled') THEN scan_targets.next_chunk_index
          ELSE COALESCE(excluded.next_chunk_index, scan_targets.next_chunk_index)
        END,
        total_records = CASE
          WHEN scan_targets.status IN ('complete', 'failed', 'cancelled') THEN scan_targets.total_records
          ELSE COALESCE(excluded.total_records, scan_targets.total_records)
        END,
        rows_ingested = CASE
          WHEN scan_targets.status IN ('complete', 'failed', 'cancelled') THEN scan_targets.rows_ingested
          WHEN ? IS NOT NULL THEN scan_targets.rows_ingested + ?
          WHEN ? IS NOT NULL THEN ?
          ELSE scan_targets.rows_ingested
        END,
        error = CASE
          WHEN scan_targets.status IN ('complete', 'failed', 'cancelled') AND excluded.error IS NULL THEN scan_targets.error
          ELSE excluded.error
        END,
        started_at = COALESCE(scan_targets.started_at, excluded.started_at),
        finished_at = CASE
          WHEN scan_targets.status IN ('complete', 'failed', 'cancelled') THEN scan_targets.finished_at
          ELSE COALESCE(excluded.finished_at, scan_targets.finished_at)
        END,
        updated_at = CURRENT_TIMESTAMP`
    )
    .run(
      input.scanId,
      input.target,
      existingIndex ?? 0,
      input.status ?? "pending",
      input.nextChunkIndex ?? 0,
      input.totalRecords ?? null,
      input.rowsIngested ?? input.rowsIngestedDelta ?? 0,
      input.error ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
      input.rowsIngestedDelta ?? null,
      input.rowsIngestedDelta ?? null,
      input.rowsIngested ?? null,
      input.rowsIngested ?? null
    );
}

function getScanTargetIndex(catalogDb: CatalogDb, scanId: string, target: string): number | null {
  const row = catalogDb.db
    .prepare("SELECT target_index AS targetIndex FROM scan_targets WHERE scan_id = ? AND target = ?")
    .get(scanId, target) as { targetIndex: number } | undefined;
  return typeof row?.targetIndex === "number" ? row.targetIndex : null;
}

export function getScanProgress(catalogDb: CatalogDb, scanId: string): Record<string, unknown> | null {
  const manifest = getScanManifest(catalogDb, scanId);
  if (!manifest) {
    return null;
  }
  reconcileTerminalScanTargets(catalogDb, scanId, String(manifest.status) as ScanStatus);
  const targets = catalogDb.db
    .prepare(
      `SELECT
        target,
        target_index AS targetIndex,
        status,
        next_chunk_index AS nextChunkIndex,
        total_records AS totalRecords,
        rows_ingested AS rowsIngested,
        error,
        started_at AS startedAt,
        finished_at AS finishedAt,
        updated_at AS updatedAt
       FROM scan_targets
       WHERE scan_id = ?
       ORDER BY target_index, target`
    )
    .all(scanId)
    .map((row) => ({ ...(row as Record<string, unknown>) }));
  const runningTarget = targets.find((target) => target.status === "running") ?? targets.find((target) => target.status === "pending") ?? null;
  const totalRecords = targets.reduce((sum, target) => sum + Number(target.totalRecords ?? 0), 0);
  const rowsIngested = targets.reduce((sum, target) => sum + Number(target.rowsIngested ?? 0), 0);
  const errors = targets.filter((target) => target.error).map((target) => ({ target: target.target, error: target.error }));
  return {
    manifest,
    status: manifest.status,
    currentTarget: runningTarget ? runningTarget.target : null,
    nextChunkIndex: runningTarget ? runningTarget.nextChunkIndex : null,
    totalRecords,
    rowsIngested,
    targets,
    errors,
    warnings: buildScanWarnings(String(manifest.status), targets)
  };
}

export function markScanFinished(catalogDb: CatalogDb, scanId: string, status: ScanStatus, classCounts?: Record<string, number>, error?: string): void {
  const manifest = getScanManifest(catalogDb, scanId);
  if (!manifest) {
    return;
  }
  catalogDb.db
    .prepare(
      `UPDATE scan_manifests
       SET status = ?,
           class_counts_json = COALESCE(?, class_counts_json),
           finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
       WHERE scan_id = ?`
    )
    .run(status, classCounts ? JSON.stringify(classCounts) : null, scanId);
  reconcileTerminalScanTargets(catalogDb, scanId, status, error);
  if (error) {
    catalogDb.db
      .prepare(
        `UPDATE scan_targets
         SET status = 'failed', error = COALESCE(error, ?), finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
         WHERE scan_id = ? AND status IN ('pending', 'running')`
      )
      .run(error, scanId);
  } else if (status === "cancelled") {
    catalogDb.db
      .prepare(
        `UPDATE scan_targets
         SET status = 'cancelled', finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
         WHERE scan_id = ? AND status IN ('pending', 'running', 'partial')`
      )
      .run(scanId);
  } else if (status === "failed") {
    catalogDb.db
      .prepare(
        `UPDATE scan_targets
         SET status = 'failed', finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
         WHERE scan_id = ? AND status IN ('pending', 'running')`
      )
      .run(scanId);
  }
}

export function markStaleScans(catalogDb: CatalogDb, staleAfterMs = 15 * 60 * 1000): number {
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString().slice(0, 19).replace("T", " ");
  const result = catalogDb.db
    .prepare(
      `UPDATE scan_manifests
       SET status = 'stale'
       WHERE status = 'running'
         AND scan_id IN (
           SELECT scan_manifests.scan_id
           FROM scan_manifests
           LEFT JOIN scan_targets ON scan_targets.scan_id = scan_manifests.scan_id
           GROUP BY scan_manifests.scan_id
           HAVING COALESCE(MAX(scan_targets.updated_at), scan_manifests.started_at) < ?
         )`
    )
    .run(cutoff);
  return Number(result.changes);
}

export function repairStaleScan(catalogDb: CatalogDb, scanId: string): Record<string, unknown> {
  const manifest = getScanManifest(catalogDb, scanId);
  if (!manifest) {
    return { ok: false, error: "scan_not_found" };
  }
  const targets = getScanProgress(catalogDb, scanId)?.targets as Record<string, unknown>[] | undefined;
  const hasIncompleteTargets = (targets ?? []).some((target) => !["complete", "failed", "cancelled"].includes(String(target.status)));
  if (manifest.status === "running" || manifest.status === "stale") {
    catalogDb.db
      .prepare("UPDATE scan_manifests SET status = ? WHERE scan_id = ?")
      .run(hasIncompleteTargets ? "partial" : "complete", scanId);
    catalogDb.db
      .prepare(
        `UPDATE scan_targets
         SET status = 'pending', updated_at = CURRENT_TIMESTAMP
         WHERE scan_id = ? AND status = 'running'`
      )
      .run(scanId);
  }
  return { ok: true, scan: getScanProgress(catalogDb, scanId) };
}

function reconcileTerminalScanTargets(catalogDb: CatalogDb, scanId: string, status: ScanStatus, error?: string): number {
  if (!terminalScanStatuses.has(status)) {
    return 0;
  }
  const targetStatus = status === "cancelled" ? "cancelled" : status === "failed" ? "failed" : "complete";
  const result = catalogDb.db
    .prepare(
      `UPDATE scan_targets
       SET status = ?,
           error = CASE WHEN ? IS NOT NULL THEN COALESCE(error, ?) ELSE error END,
           finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE scan_id = ?
         AND status NOT IN ('complete', 'failed', 'cancelled')`
    )
    .run(targetStatus, error ?? null, error ?? null, scanId);
  return Number(result.changes);
}

export function upsertCatalogClass(catalogDb: CatalogDb, catalogClass: CatalogClassInput): void {
  catalogDb.db
    .prepare(
      `INSERT INTO classes (
        class_name,
        latest_scan_id,
        config_path,
        display_name,
        kind,
        subkind,
        categorization_confidence,
        categorization_source,
        source_addon,
        source_mod_guess,
        author,
        dlc,
        scope,
        scope_curator,
        scope_arsenal,
        editor_category,
        editor_subcategory,
        vehicle_class,
        faction,
        side,
        simulation,
        model_path,
        picture,
        icon,
        editor_preview,
        is_simple_object_compatible,
        weapons_json,
        magazines_json,
        linked_items_json,
        raw_config_json,
        tags_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(class_name) DO UPDATE SET
        latest_scan_id = excluded.latest_scan_id,
        config_path = excluded.config_path,
        display_name = excluded.display_name,
        kind = excluded.kind,
        subkind = excluded.subkind,
        categorization_confidence = excluded.categorization_confidence,
        categorization_source = excluded.categorization_source,
        source_addon = excluded.source_addon,
        source_mod_guess = excluded.source_mod_guess,
        author = excluded.author,
        dlc = excluded.dlc,
        scope = excluded.scope,
        scope_curator = excluded.scope_curator,
        scope_arsenal = excluded.scope_arsenal,
        editor_category = excluded.editor_category,
        editor_subcategory = excluded.editor_subcategory,
        vehicle_class = excluded.vehicle_class,
        faction = excluded.faction,
        side = excluded.side,
        simulation = excluded.simulation,
        model_path = excluded.model_path,
        picture = excluded.picture,
        icon = excluded.icon,
        editor_preview = excluded.editor_preview,
        is_simple_object_compatible = excluded.is_simple_object_compatible,
        weapons_json = excluded.weapons_json,
        magazines_json = excluded.magazines_json,
        linked_items_json = excluded.linked_items_json,
        raw_config_json = excluded.raw_config_json,
        tags_json = excluded.tags_json,
        last_seen_at = CURRENT_TIMESTAMP`
    )
    .run(
      catalogClass.className,
      catalogClass.latestScanId,
      catalogClass.configPath,
      catalogClass.displayName ?? null,
      catalogClass.kind ?? null,
      catalogClass.subkind ?? null,
      catalogClass.categorizationConfidence ?? 0,
      catalogClass.categorizationSource ?? null,
      catalogClass.sourceAddon ?? null,
      catalogClass.sourceModGuess ?? null,
      catalogClass.author ?? null,
      catalogClass.dlc ?? null,
      catalogClass.scope ?? null,
      catalogClass.scopeCurator ?? null,
      catalogClass.scopeArsenal ?? null,
      catalogClass.editorCategory ?? null,
      catalogClass.editorSubcategory ?? null,
      catalogClass.vehicleClass ?? null,
      catalogClass.faction ?? null,
      catalogClass.side ?? null,
      catalogClass.simulation ?? null,
      catalogClass.modelPath ?? null,
      catalogClass.picture ?? null,
      catalogClass.icon ?? null,
      catalogClass.editorPreview ?? null,
      catalogClass.isSimpleObjectCompatible === null || catalogClass.isSimpleObjectCompatible === undefined
        ? null
        : catalogClass.isSimpleObjectCompatible
          ? 1
          : 0,
      JSON.stringify(catalogClass.weapons ?? []),
      JSON.stringify(catalogClass.magazines ?? []),
      JSON.stringify(catalogClass.linkedItems ?? []),
      JSON.stringify(catalogClass.rawConfig ?? {}),
      JSON.stringify(catalogClass.tags ?? [])
    );
}

export function upsertClassTags(catalogDb: CatalogDb, className: string, tags: ClassTagInput[]): void {
  const insert = catalogDb.db.prepare(
    `INSERT INTO class_tags (class_name, tag, source, confidence)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(class_name, tag) DO UPDATE SET
        source = excluded.source,
        confidence = excluded.confidence`
  );
  catalogDb.db.exec("BEGIN;");
  try {
    for (const item of tags) {
      insert.run(className, item.tag, item.source ?? "heuristic", item.confidence ?? 0.5);
    }
    catalogDb.db.exec("COMMIT;");
  } catch (error) {
    catalogDb.db.exec("ROLLBACK;");
    throw error;
  }
}

export function updateFtsIndex(catalogDb: CatalogDb, className: string): void {
  const row = catalogDb.db
    .prepare(
      `SELECT
        rowid,
        class_name AS className,
        display_name AS displayName,
        kind,
        subkind,
        tags_json AS tagsJson,
        editor_category AS editorCategory,
        editor_subcategory AS editorSubcategory,
        faction
      FROM classes
      WHERE class_name = ?`
    )
    .get(className) as
    | {
        rowid: number;
        className: string;
        displayName: string | null;
        kind: string | null;
        subkind: string | null;
        tagsJson: string;
        editorCategory: string | null;
        editorSubcategory: string | null;
        faction: string | null;
      }
    | undefined;
  if (!row) {
    return;
  }

  const visualTags = catalogDb.db
    .prepare("SELECT tag FROM class_visual_tags WHERE class_name = ? ORDER BY tag")
    .all(className)
    .map((tagRow) => String((tagRow as { tag: string }).tag));

  const tags = [
    ...safeJsonArray(row.tagsJson),
    ...catalogDb.db
      .prepare("SELECT tag FROM class_tags WHERE class_name = ? ORDER BY tag")
      .all(className)
      .map((tagRow) => String((tagRow as { tag: string }).tag))
  ];

  const existingFtsRow = catalogDb.db.prepare("SELECT rowid FROM classes_fts WHERE rowid = ?").get(row.rowid);
  if (existingFtsRow) {
    catalogDb.db.prepare("DELETE FROM classes_fts WHERE rowid = ?").run(row.rowid);
  }

  catalogDb.db
    .prepare(
      `INSERT INTO classes_fts (
        rowid,
        class_name,
        display_name,
        kind,
        subkind,
        tags,
        visual_tags,
        editor_category,
        editor_subcategory,
        faction
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.rowid,
      row.className,
      row.displayName ?? "",
      row.kind ?? "",
      row.subkind ?? "",
      tags.join(" "),
      visualTags.join(" "),
      row.editorCategory ?? "",
      row.editorSubcategory ?? "",
      row.faction ?? ""
    );
}

function safeJsonArray(input: string): string[] {
  const parsed = JSON.parse(input) as unknown;
  return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
}

type CatalogSearchRow = {
  className: string;
  displayName: string | null;
  kind: string | null;
  subkind: string | null;
  tagsJson: string;
  visualTagsJson: string;
  sourceAddon: string | null;
  sourceMod: string | null;
  editorCategory: string | null;
  editorSubcategory: string | null;
  widthM: number | null;
  depthM: number | null;
  heightM: number | null;
};

function formatCatalogSearchRow(row: CatalogSearchRow): Record<string, unknown> {
  return {
    class_name: row.className,
    display_name: row.displayName,
    kind: row.kind,
    subkind: row.subkind,
    tags: safeJsonArray(row.tagsJson),
    visual_tags: safeJsonArray(row.visualTagsJson),
    source_addon: row.sourceAddon,
    source_mod: row.sourceMod,
    editor_category: row.editorCategory,
    editor_subcategory: row.editorSubcategory,
    dimensions:
      row.widthM === null || row.depthM === null || row.heightM === null
        ? null
        : { width_m: row.widthM, depth_m: row.depthM, height_m: row.heightM }
  };
}

function formatCatalogClassRow(catalogDb: CatalogDb, row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    weapons_json: undefined,
    magazines_json: undefined,
    linked_items_json: undefined,
    raw_config_json: undefined,
    tags_json: undefined,
    weapons: safeJsonArray(String(row.weapons_json ?? "[]")),
    magazines: safeJsonArray(String(row.magazines_json ?? "[]")),
    linked_items: safeJsonArray(String(row.linked_items_json ?? "[]")),
    raw_config: JSON.parse(String(row.raw_config_json ?? "{}")) as Record<string, unknown>,
    tags: safeJsonArray(String(row.tags_json ?? "[]")),
    class_tags: getCatalogTags(catalogDb, String(row.class_name))
  };
}

function scanCacheState(catalogDb: CatalogDb, scanId: string): ScanStatus | "empty" {
  const progress = getScanProgress(catalogDb, scanId);
  const status = String((progress?.manifest as Record<string, unknown> | undefined)?.status ?? "partial") as ScanStatus;
  if (["complete", "failed", "cancelled", "stale"].includes(status)) {
    return status;
  }
  const targets = Array.isArray(progress?.targets) ? (progress.targets as Record<string, unknown>[]) : [];
  if (targets.length === 0) {
    return status;
  }
  if (targets.every((target) => target.status === "complete")) {
    return "complete";
  }
  if (targets.some((target) => target.status === "running")) {
    return "running";
  }
  if (targets.some((target) => Number(target.rowsIngested ?? 0) > 0 || target.status === "complete")) {
    return "partial";
  }
  return status;
}

function relevantSearchTargets(input: CatalogSearchInput): string[] {
  const kind = input.kind?.toLowerCase();
  if (kind === "weapon") {
    return ["CfgWeapons"];
  }
  if (kind === "magazine") {
    return ["CfgMagazines"];
  }
  if (kind === "ammo") {
    return ["CfgAmmo"];
  }
  if (kind === "group") {
    return ["CfgGroups"];
  }
  return ["CfgVehicles"];
}

function buildScanWarnings(status: string, targets: Record<string, unknown>[]): string[] {
  const warnings: string[] = [];
  if (status === "stale") {
    warnings.push("scan_stale_no_recent_progress");
  }
  if (status === "partial") {
    warnings.push("scan_partial_resume_or_finalize_needed");
  }
  if (targets.some((target) => target.status === "failed")) {
    warnings.push("one_or_more_targets_failed");
  }
  if (targets.some((target) => target.status === "cancelled")) {
    warnings.push("one_or_more_targets_cancelled");
  }
  return warnings;
}

const CATALOG_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scan_manifests (
    scan_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    game_version TEXT,
    world_name TEXT,
    loaded_mods_hash TEXT NOT NULL,
    loaded_addons_hash TEXT NOT NULL,
    class_counts_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS scan_targets (
    scan_id TEXT NOT NULL REFERENCES scan_manifests(scan_id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    target_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    next_chunk_index INTEGER NOT NULL DEFAULT 0,
    total_records INTEGER,
    rows_ingested INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scan_id, target)
);

CREATE TABLE IF NOT EXISTS mods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id TEXT NOT NULL REFERENCES scan_manifests(scan_id) ON DELETE CASCADE,
    mod_name TEXT,
    mod_dir TEXT,
    mod_hash TEXT,
    is_loaded INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS addons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id TEXT NOT NULL REFERENCES scan_manifests(scan_id) ON DELETE CASCADE,
    addon_class TEXT NOT NULL,
    display_name TEXT,
    author TEXT,
    required_addons_json TEXT NOT NULL DEFAULT '[]',
    units_json TEXT NOT NULL DEFAULT '[]',
    weapons_json TEXT NOT NULL DEFAULT '[]',
    UNIQUE(scan_id, addon_class)
);

CREATE TABLE IF NOT EXISTS classes (
    class_name TEXT PRIMARY KEY,
    latest_scan_id TEXT NOT NULL,
    config_path TEXT NOT NULL,
    display_name TEXT,
    kind TEXT,
    subkind TEXT,
    categorization_confidence REAL NOT NULL DEFAULT 0,
    categorization_source TEXT,
    source_addon TEXT,
    source_mod_guess TEXT,
    author TEXT,
    dlc TEXT,
    scope INTEGER,
    scope_curator INTEGER,
    scope_arsenal INTEGER,
    editor_category TEXT,
    editor_subcategory TEXT,
    vehicle_class TEXT,
    faction TEXT,
    side INTEGER,
    simulation TEXT,
    model_path TEXT,
    picture TEXT,
    icon TEXT,
    editor_preview TEXT,
    is_simple_object_compatible INTEGER,
    weapons_json TEXT NOT NULL DEFAULT '[]',
    magazines_json TEXT NOT NULL DEFAULT '[]',
    linked_items_json TEXT NOT NULL DEFAULT '[]',
    raw_config_json TEXT NOT NULL DEFAULT '{}',
    tags_json TEXT NOT NULL DEFAULT '[]',
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS class_tags (
    class_name TEXT NOT NULL REFERENCES classes(class_name) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'heuristic',
    confidence REAL NOT NULL DEFAULT 0.5,
    PRIMARY KEY (class_name, tag)
);

CREATE TABLE IF NOT EXISTS class_measurements (
    class_name TEXT PRIMARY KEY REFERENCES classes(class_name) ON DELETE CASCADE,
    status TEXT NOT NULL,
    error TEXT,
    bbox_min_x REAL,
    bbox_min_y REAL,
    bbox_min_z REAL,
    bbox_max_x REAL,
    bbox_max_y REAL,
    bbox_max_z REAL,
    center_x REAL,
    center_y REAL,
    center_z REAL,
    width_m REAL,
    depth_m REAL,
    height_m REAL,
    size_of REAL,
    measured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS measurement_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_name TEXT NOT NULL REFERENCES classes(class_name) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 100,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS visual_inspection_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_name TEXT NOT NULL REFERENCES classes(class_name) ON DELETE CASCADE,
    status TEXT NOT NULL,
    error TEXT,
    angles_json TEXT NOT NULL DEFAULT '[]',
    screenshot_dir TEXT,
    resolution_json TEXT NOT NULL DEFAULT '[1280,720]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS class_screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_name TEXT NOT NULL REFERENCES classes(class_name) ON DELETE CASCADE,
    inspection_run_id INTEGER REFERENCES visual_inspection_runs(id) ON DELETE SET NULL,
    angle TEXT NOT NULL,
    file_path TEXT NOT NULL,
    camera_position_json TEXT NOT NULL DEFAULT '[]',
    camera_target_json TEXT NOT NULL DEFAULT '[]',
    captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(class_name, angle, file_path)
);

CREATE TABLE IF NOT EXISTS class_visual_tags (
    class_name TEXT NOT NULL REFERENCES classes(class_name) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL DEFAULT 'visual',
    screenshot_id INTEGER REFERENCES class_screenshots(id) ON DELETE SET NULL,
    inspection_run_id INTEGER REFERENCES visual_inspection_runs(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (class_name, tag, source)
);

CREATE TABLE IF NOT EXISTS class_orientation_hints (
    class_name TEXT PRIMARY KEY REFERENCES classes(class_name) ON DELETE CASCADE,
    front_face_guess TEXT,
    long_axis TEXT,
    has_doorway INTEGER,
    has_screen INTEGER,
    has_terminal_face INTEGER,
    notes TEXT,
    confidence REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE IF NOT EXISTS classes_fts USING fts5(
    class_name,
    display_name,
    kind,
    subkind,
    tags,
    visual_tags,
    editor_category,
    editor_subcategory,
    faction,
    content='',
    contentless_delete=1
);
`;
