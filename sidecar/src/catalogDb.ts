import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const CATALOG_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CATALOG_DB_PATH = ".mcp-cache/arma/catalog.sqlite";

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

export function openCatalogDb(dbPath = DEFAULT_CATALOG_DB_PATH): CatalogDb {
  const resolvedPath = resolve(dbPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  return { db, path: resolvedPath };
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
    catalogDb.db
      .prepare(
        `INSERT INTO classes_fts (
          classes_fts,
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
        ) VALUES ('delete', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    content=''
);
`;
