import { createHash } from "node:crypto";
import {
  type CatalogDb,
  type CatalogClassInput,
  updateFtsIndex,
  upsertCatalogClass,
  upsertClassTags
} from "./catalogDb.js";

export const DEFAULT_SCAN_TARGETS = [
  "CfgPatches",
  "CfgVehicles",
  "CfgWeapons",
  "CfgMagazines",
  "CfgAmmo",
  "CfgGroups",
  "CfgFactionClasses",
  "CfgEditorCategories",
  "CfgEditorSubcategories",
  "Cfg3DEN"
] as const;

export type CatalogRecord = {
  class_name?: string;
  className?: string;
  config_path?: string;
  configPath?: string;
  display_name?: string;
  displayName?: string;
  scope?: number;
  scope_curator?: number;
  scopeCurator?: number;
  scope_arsenal?: number;
  scopeArsenal?: number;
  simulation?: string;
  model_path?: string;
  modelPath?: string;
  editor_category?: string;
  editorCategory?: string;
  editor_subcategory?: string;
  editorSubcategory?: string;
  vehicle_class?: string;
  vehicleClass?: string;
  faction?: string;
  side?: number;
  author?: string;
  dlc?: string;
  picture?: string;
  icon?: string;
  editor_preview?: string;
  editorPreview?: string;
  source_addon?: string;
  sourceAddon?: string;
  weapons?: unknown[];
  magazines?: unknown[];
  linked_items?: unknown[];
  linkedItems?: unknown[];
  raw_config?: Record<string, unknown>;
  rawConfig?: Record<string, unknown>;
};

export type CatalogChunk = {
  scan_id?: string;
  scanId?: string;
  config_path?: string;
  configPath?: string;
  chunk_index?: number;
  chunkIndex?: number;
  is_last_chunk?: boolean;
  isLastChunk?: boolean;
  records?: CatalogRecord[];
};

export function stableHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function ingestCatalogChunk(catalogDb: CatalogDb, scanId: string, chunk: CatalogChunk): number {
  const configPath = chunk.config_path ?? chunk.configPath ?? "unknown";
  const records = Array.isArray(chunk.records) ? chunk.records : [];
  for (const record of records) {
    const normalized = normalizeCatalogRecord(scanId, configPath, record);
    if (!normalized) {
      continue;
    }
    upsertCatalogClass(catalogDb, normalized.catalogClass);
    upsertClassTags(
      catalogDb,
      normalized.catalogClass.className,
      normalized.tags.map((tag) => ({ tag, confidence: normalized.catalogClass.categorizationConfidence ?? 0.5 }))
    );
    updateFtsIndex(catalogDb, normalized.catalogClass.className);
  }
  return records.length;
}

export function normalizeCatalogRecord(
  scanId: string,
  fallbackConfigPath: string,
  record: CatalogRecord
): { catalogClass: CatalogClassInput; tags: string[] } | null {
  const className = stringField(record.class_name ?? record.className);
  if (!className) {
    return null;
  }
  const configPath = stringField(record.config_path ?? record.configPath) || fallbackConfigPath;
  const displayName = stringField(record.display_name ?? record.displayName);
  const rawConfig = record.raw_config ?? record.rawConfig ?? {};
  const categorized = categorizeClass({
    className,
    configPath,
    displayName,
    simulation: stringField(record.simulation),
    modelPath: stringField(record.model_path ?? record.modelPath),
    vehicleClass: stringField(record.vehicle_class ?? record.vehicleClass),
    editorCategory: stringField(record.editor_category ?? record.editorCategory),
    editorSubcategory: stringField(record.editor_subcategory ?? record.editorSubcategory)
  });
  const tags = generateClassTags({
    className,
    displayName,
    configPath,
    kind: categorized.kind,
    subkind: categorized.subkind,
    simulation: stringField(record.simulation),
    editorCategory: stringField(record.editor_category ?? record.editorCategory),
    editorSubcategory: stringField(record.editor_subcategory ?? record.editorSubcategory),
    faction: stringField(record.faction)
  });

  return {
    catalogClass: {
      className,
      latestScanId: scanId,
      configPath,
      displayName,
      kind: categorized.kind,
      subkind: categorized.subkind,
      categorizationConfidence: categorized.confidence,
      categorizationSource: categorized.source,
      sourceAddon: stringField(record.source_addon ?? record.sourceAddon),
      author: stringField(record.author),
      dlc: stringField(record.dlc),
      scope: numberField(record.scope),
      scopeCurator: numberField(record.scope_curator ?? record.scopeCurator),
      scopeArsenal: numberField(record.scope_arsenal ?? record.scopeArsenal),
      editorCategory: stringField(record.editor_category ?? record.editorCategory),
      editorSubcategory: stringField(record.editor_subcategory ?? record.editorSubcategory),
      vehicleClass: stringField(record.vehicle_class ?? record.vehicleClass),
      faction: stringField(record.faction),
      side: numberField(record.side),
      simulation: stringField(record.simulation),
      modelPath: stringField(record.model_path ?? record.modelPath),
      picture: stringField(record.picture),
      icon: stringField(record.icon),
      editorPreview: stringField(record.editor_preview ?? record.editorPreview),
      weapons: arrayField(record.weapons),
      magazines: arrayField(record.magazines),
      linkedItems: arrayField(record.linked_items ?? record.linkedItems),
      rawConfig,
      tags
    },
    tags
  };
}

function categorizeClass(input: {
  className: string;
  configPath: string;
  displayName?: string;
  simulation?: string;
  modelPath?: string;
  vehicleClass?: string;
  editorCategory?: string;
  editorSubcategory?: string;
}): { kind: string; subkind: string | null; confidence: number; source: string } {
  const haystack = [
    input.className,
    input.displayName,
    input.simulation,
    input.modelPath,
    input.vehicleClass,
    input.editorCategory,
    input.editorSubcategory
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (input.configPath === "CfgWeapons") {
    return { kind: "weapon", subkind: null, confidence: 0.85, source: "config_path" };
  }
  if (input.configPath === "CfgMagazines") {
    return { kind: "magazine", subkind: null, confidence: 0.85, source: "config_path" };
  }
  if (input.configPath === "CfgAmmo") {
    return { kind: "ammo", subkind: null, confidence: 0.85, source: "config_path" };
  }
  if (haystack.match(/\b(man|soldier|crew|pilot|unit)\b/)) {
    return { kind: "unit", subkind: null, confidence: 0.7, source: "heuristic" };
  }
  if (haystack.match(/\b(car|truck|tank|apc|heli|plane|ship|uav|vehicle)\b/)) {
    return { kind: "vehicle", subkind: null, confidence: 0.7, source: "heuristic" };
  }
  if (haystack.match(/\b(module|logic)\b/)) {
    return { kind: "module", subkind: null, confidence: 0.7, source: "heuristic" };
  }
  if (haystack.match(/\b(terminal|console|screen|display|monitor)\b/)) {
    return { kind: "prop", subkind: "terminal", confidence: 0.8, source: "heuristic" };
  }
  if (haystack.match(/\b(wall|barrier|bunker|sandbag|hbarrier|fence|fort)\b/)) {
    return { kind: "fortification", subkind: null, confidence: 0.75, source: "heuristic" };
  }
  if (haystack.match(/\b(crate|box|supply|ammo)\b/)) {
    return { kind: "supply", subkind: null, confidence: 0.7, source: "heuristic" };
  }
  if (input.configPath === "CfgVehicles") {
    return { kind: "prop", subkind: null, confidence: 0.45, source: "config_path" };
  }
  return { kind: "config", subkind: null, confidence: 0.25, source: "fallback" };
}

function generateClassTags(input: {
  className: string;
  displayName?: string;
  configPath: string;
  kind: string;
  subkind: string | null;
  simulation?: string;
  editorCategory?: string;
  editorSubcategory?: string;
  faction?: string;
}): string[] {
  const tags = new Set<string>([input.kind]);
  if (input.subkind) {
    tags.add(input.subkind);
  }
  const haystack = [
    input.className,
    input.displayName,
    input.configPath,
    input.simulation,
    input.editorCategory,
    input.editorSubcategory,
    input.faction
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const [tag, pattern] of [
    ["terminal", /\b(terminal|console|screen|display|monitor)\b/],
    ["republic", /\b(republic|gar|clone|laat|venator)\b/],
    ["cis", /\b(cis|separat|droid|b1|b2|lucrehulk)\b/],
    ["fortification", /\b(wall|barrier|bunker|sandbag|hbarrier|fence|fort)\b/],
    ["supply", /\b(crate|box|supply|ammo)\b/],
    ["light", /\b(light|lamp|reflector)\b/],
    ["decor", /\b(decor|chair|table|crate|sign)\b/]
  ] as const) {
    if (pattern.test(haystack)) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
