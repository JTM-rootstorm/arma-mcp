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
  source_mod?: string;
  sourceMod?: string;
  parents?: unknown[];
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
  total_records?: number;
  totalRecords?: number;
  is_last_chunk?: boolean;
  isLastChunk?: boolean;
  records?: CatalogRecord[];
};

export type CatalogIngestOptions = {
  includeRaw?: boolean;
};

export function stableHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function ingestCatalogChunk(catalogDb: CatalogDb, scanId: string, chunk: CatalogChunk, options: CatalogIngestOptions = {}): number {
  const configPath = chunk.config_path ?? chunk.configPath ?? "unknown";
  const records = Array.isArray(chunk.records) ? chunk.records : [];
  let ingested = 0;
  for (const record of records) {
    if (!options.includeRaw && !isUsefulCatalogRecord(configPath, record)) {
      continue;
    }
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
    ingested += 1;
  }
  return ingested;
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
  const rawConfig = { ...(record.raw_config ?? record.rawConfig ?? {}), parents: arrayField(record.parents) };
  const categorized = categorizeClass({
    className,
    configPath,
    displayName,
    simulation: stringField(record.simulation),
    modelPath: stringField(record.model_path ?? record.modelPath),
    vehicleClass: stringField(record.vehicle_class ?? record.vehicleClass),
    editorCategory: stringField(record.editor_category ?? record.editorCategory),
    editorSubcategory: stringField(record.editor_subcategory ?? record.editorSubcategory),
    scope: numberField(record.scope),
    scopeCurator: numberField(record.scope_curator ?? record.scopeCurator),
    rawConfig
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
      sourceModGuess: stringField(record.source_mod ?? record.sourceMod),
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
  scope?: number;
  scopeCurator?: number;
  rawConfig?: Record<string, unknown>;
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
  const parentClasses = rawArray(input.rawConfig?.parents).join(" ").toLowerCase();
  const inheritance = `${haystack} ${parentClasses}`;

  if (input.configPath === "CfgVehicles" && inheritance.match(/\b(module_f|logic|modulecurator|module)\b/)) {
    return { kind: inheritance.includes("logic") && !inheritance.includes("module") ? "logic" : "module", subkind: moduleSubkind(haystack), confidence: 0.9, source: "inheritance" };
  }
  if (input.className.match(/^Module/i) || haystack.match(/\b(module|logic|modules|eden modules|zeus|curator)\b/)) {
    return { kind: haystack.includes("logic") && !haystack.includes("module") ? "logic" : "module", subkind: moduleSubkind(haystack), confidence: 0.85, source: "heuristic" };
  }
  if (haystack.match(/\b(man|soldier|crew|pilot|unit)\b/)) {
    return { kind: "unit", subkind: null, confidence: 0.7, source: "heuristic" };
  }
  if (haystack.match(/\b(car|truck|tank|apc|heli|plane|ship|uav|vehicle)\b/)) {
    return { kind: "vehicle", subkind: null, confidence: 0.7, source: "heuristic" };
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
    ["command_terminal", /\b(command|control|operations|ops).*\b(terminal|console|screen|display|monitor)\b|\b(terminal|console).*\b(command|control|operations|ops)\b/],
    ["objective_terminal", /\b(objective|intel|data|uplink|download|upload|hack).*\b(terminal|console|screen|display|monitor)\b|\b(terminal|console).*\b(objective|intel|data|uplink|download|upload|hack)\b/],
    ["republic", /\b(republic|gar|clone|laat|venator)\b/],
    ["cis", /\b(cis|separat|droid|b1|b2|lucrehulk)\b/],
    ["infantry_unit", /\b(man|soldier|rifleman|trooper|infantry|unit)\b/],
    ["vehicle_ground", /\b(car|truck|tank|apc|ifv|mrap|wheeled|tracked|speeder)\b/],
    ["vehicle_air", /\b(heli|helicopter|plane|vtol|laat|uav|air)\b/],
    ["static_weapon", /\b(static|turret|mortar|hmg|gmg|cannon)\b/],
    ["aa_emplacement", /\b(aa|anti-air|anti air|sam|missile)\b/],
    ["fortification", /\b(wall|barrier|bunker|sandbag|hbarrier|fence|fort)\b/],
    ["bunker", /\b(bunker|pillbox)\b/],
    ["wall_segment", /\b(wall|barrier|hbarrier|fence)\b/],
    ["gate", /\b(gate|door|bar gate|barrier gate)\b/],
    ["watchtower", /\b(watchtower|tower|guard tower|observation)\b/],
    ["barricade", /\b(barricade|roadblock|blockade)\b/],
    ["cover_low", /\b(sandbag|low wall|short wall|hbarrier_1|cover low)\b/],
    ["cover_high", /\b(high wall|tall wall|bunker|hbarrier_5|cover high)\b/],
    ["supply", /\b(crate|box|supply|ammo)\b/],
    ["ammo_crate", /\b(ammo|ammunition).*\b(crate|box|supply)\b|\b(crate|box).*\b(ammo|ammunition)\b/],
    ["medical_crate", /\b(medical|medic|first aid|heal).*\b(crate|box|supply)\b|\b(crate|box).*\b(medical|medic|first aid|heal)\b/],
    ["vehicle_spawn", /\b(vehicle spawn|garage|respawn vehicle|spawn point)\b/],
    ["module_task", /\b(task|objective).*\b(module|logic)\b|\bmodule.*\b(task|objective)\b/],
    ["module_respawn", /\b(respawn|spawn).*\b(module|logic)\b|\bmodule.*\b(respawn|spawn)\b/],
    ["module_zeus", /\b(zeus|curator).*\b(module|logic)\b|\bmodule.*\b(zeus|curator)\b/],
    ["light_source", /\b(light|lamp|reflector|floodlight)\b/],
    ["decor_clutter", /\b(decor|chair|table|trash|clutter|sign|file|barrel)\b/],
    ["decor", /\b(decor|chair|table|crate|sign)\b/]
  ] as const) {
    if (pattern.test(haystack)) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}

function isUsefulCatalogRecord(configPath: string, record: CatalogRecord): boolean {
  if (configPath !== "CfgVehicles") {
    return true;
  }
  const className = stringField(record.class_name ?? record.className) ?? "";
  const displayName = stringField(record.display_name ?? record.displayName) ?? "";
  const scope = numberField(record.scope) ?? -1;
  const scopeCurator = numberField(record.scope_curator ?? record.scopeCurator) ?? -1;
  const editorCategory = stringField(record.editor_category ?? record.editorCategory);
  const editorSubcategory = stringField(record.editor_subcategory ?? record.editorSubcategory);
  const modelPath = stringField(record.model_path ?? record.modelPath);
  const haystack = [
    className,
    displayName,
    stringField(record.simulation),
    editorCategory,
    editorSubcategory,
    stringField(record.vehicle_class ?? record.vehicleClass)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack.match(/\b(hitpoint|hitpoints|damage|glass|destructioneffects|animationsources|texture sources|reflectors|sounds|eventhandlers)\b/)) {
    return false;
  }
  if (!displayName && scope < 2 && scopeCurator < 2) {
    return false;
  }
  if (scope >= 2 || scopeCurator >= 2) {
    return true;
  }
  if (displayName && (editorCategory || editorSubcategory)) {
    return true;
  }
  return Boolean(displayName && modelPath);
}

function moduleSubkind(haystack: string): string | null {
  if (haystack.match(/\b(task|objective)\b/)) {
    return "task";
  }
  if (haystack.match(/\b(respawn|spawn)\b/)) {
    return "respawn";
  }
  if (haystack.match(/\b(zeus|curator)\b/)) {
    return "zeus";
  }
  return null;
}

function rawArray(input: unknown): string[] {
  return Array.isArray(input) ? input.map((item) => String(item)) : [];
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
