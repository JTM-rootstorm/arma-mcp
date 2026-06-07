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
  status?: "running" | "complete" | "failed";
};

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
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  return { db, path: resolvedPath };
}

export function getCatalogStatus(catalogDb: CatalogDb): Record<string, unknown> {
  const classCount = scalarCount(catalogDb, "classes");
  const measurementCount = scalarCount(catalogDb, "class_measurements");
  const screenshotCount = scalarCount(catalogDb, "class_screenshots");
  const latestScan = getLatestScanManifest(catalogDb);
  return {
    path: catalogDb.path,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    latestScan,
    counts: {
      classes: classCount,
      measurements: measurementCount,
      screenshots: screenshotCount
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
