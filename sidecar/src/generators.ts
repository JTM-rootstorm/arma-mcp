import { createId } from "./state.js";

export type GeneratedBatchOperation = {
  op: "create_entity" | "create_marker" | "create_trigger";
  clientRef: string;
  type?: "Object" | "Marker" | "Trigger";
  className: string;
  transform: {
    positionATL: [number, number, number];
    dir?: number;
  };
  attributes?: Record<string, unknown>;
  text?: string;
  layer?: string;
};

export type GeneratorCatalogChoice = {
  clientRef?: string;
  role?: string;
  className: string;
  reason?: string;
};

export type GeneratedBatchPlan = {
  schemaVersion: 1;
  id: string;
  name: string;
  dryRun: true;
  historyLabel: string;
  operations: GeneratedBatchOperation[];
};

export type GeneratorAnchor = {
  positionATL?: [number, number, number];
  dir?: number;
};

export function generateRoadCheckpoint(input: {
  anchor?: GeneratorAnchor;
  factionTheme?: string;
  size?: "small" | "medium";
  features?: Record<string, boolean>;
  catalogChoices?: GeneratorCatalogChoice[];
}): { plan: GeneratedBatchPlan; warnings: string[]; catalog?: Record<string, unknown> } {
  const scale = input.size === "medium" ? 1.4 : 1;
  const features = { barriers: true, lights: true, guardPositions: true, trigger: true, marker: true, ...(input.features ?? {}) };
  const layer = layerName(input.factionTheme, "Road Checkpoint");
  const operations: GeneratedBatchOperation[] = [
    object("barrier_left", "Land_HBarrier_3_F", [-5 * scale, 0, 0], 90, layer),
    object("barrier_right", "Land_HBarrier_3_F", [5 * scale, 0, 0], 90, layer),
    object("sandbag_left", "Land_BagFence_Long_F", [-5 * scale, 5 * scale, 0], 0, layer),
    object("sandbag_right", "Land_BagFence_Long_F", [5 * scale, 5 * scale, 0], 0, layer)
  ];
  if (features.lights) {
    operations.push(object("light_left", "Land_PortableLight_single_F", [-8 * scale, -5 * scale, 0], 180, layer));
    operations.push(object("light_right", "Land_PortableLight_single_F", [8 * scale, -5 * scale, 0], 180, layer));
  }
  if (features.guardPositions) {
    operations.push(object("guard_tower", "Land_Cargo_Patrol_V1_F", [0, 10 * scale, 0], 180, layer));
  }
  if (features.marker) {
    operations.push(marker("checkpoint_marker", "mil_dot", [0, 0, 0], "Checkpoint", layer));
  }
  if (features.trigger) {
    operations.push(trigger("checkpoint_trigger", [0, 0, 0], 0, layer, { sizeA: 12 * scale, sizeB: 12 * scale, isRectangle: false }));
  }
  return planResult("Road Checkpoint", operations, input.anchor, input.catalogChoices);
}

export function generateSmallOutpost(input: {
  anchor?: GeneratorAnchor;
  factionTheme?: string;
  radiusMeters?: number;
  objective?: string;
  threatDirectionDeg?: number;
  features?: Record<string, boolean>;
  catalogChoices?: GeneratorCatalogChoice[];
}): { plan: GeneratedBatchPlan; warnings: string[]; catalog?: Record<string, unknown> } {
  const radius = Math.min(Math.max(input.radiusMeters ?? 35, 15), 80);
  const layer = layerName(input.factionTheme, "Small Outpost");
  const threatDir = input.threatDirectionDeg ?? 0;
  const operations: GeneratedBatchOperation[] = [
    object("hq", "Land_Cargo_House_V1_F", [0, 0, 0], threatDir, layer),
    object("ammo", "Box_NATO_AmmoVeh_F", [6, -4, 0], threatDir, layer),
    object("supply", "Land_Cargo20_military_green_F", [-7, -4, 0], threatDir + 90, layer),
    marker("outpost_marker", "mil_objective", [0, 0, 0], input.objective ?? "Outpost", layer)
  ];
  if (objectiveSuggestsTerminal(input.objective)) {
    operations.push(object("objective_terminal", "Land_DataTerminal_01_F", [2.5, 2.5, 0], threatDir, layer));
  }
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * 360;
    const radians = (angle * Math.PI) / 180;
    operations.push(object(`perimeter_${index + 1}`, "Land_HBarrier_1_F", [Math.cos(radians) * radius, Math.sin(radians) * radius, 0], angle + 90, layer));
  }
  return planResult("Small Outpost", operations, input.anchor, input.catalogChoices);
}

export function generateAaSite(input: {
  anchor?: GeneratorAnchor;
  factionTheme?: string;
  radiusMeters?: number;
  catalogChoices?: GeneratorCatalogChoice[];
}): { plan: GeneratedBatchPlan; warnings: string[]; catalog?: Record<string, unknown> } {
  const radius = input.radiusMeters ?? 25;
  const layer = layerName(input.factionTheme, "AA Site");
  const operations: GeneratedBatchOperation[] = [
    object("aa_launcher", "B_static_AA_F", [0, 0, 0], 0, layer),
    object("ammo_cache", "Box_NATO_AmmoVeh_F", [7, -5, 0], 0, layer),
    marker("aa_marker", "mil_triangle", [0, 0, 0], "AA Site", layer),
    trigger("aa_trigger", [0, 0, 0], 0, layer, { sizeA: radius, sizeB: radius, isRectangle: false })
  ];
  for (let index = 0; index < 4; index += 1) {
    const angle = index * 90 + 45;
    const radians = (angle * Math.PI) / 180;
    operations.push(object(`aa_cover_${index + 1}`, "Land_BagFence_Round_F", [Math.cos(radians) * 8, Math.sin(radians) * 8, 0], angle + 180, layer));
  }
  return planResult("AA Site", operations, input.anchor, input.catalogChoices);
}

export function generateLz(input: {
  anchor?: GeneratorAnchor;
  factionTheme?: string;
  radiusMeters?: number;
  catalogChoices?: GeneratorCatalogChoice[];
}): { plan: GeneratedBatchPlan; warnings: string[]; catalog?: Record<string, unknown> } {
  const radius = input.radiusMeters ?? 30;
  const layer = layerName(input.factionTheme, "Landing Zone");
  return planResult(
    "Landing Zone",
    [
      marker("lz_marker", "mil_pickup", [0, 0, 0], "LZ", layer),
      trigger("lz_clear_area", [0, 0, 0], 0, layer, { sizeA: radius, sizeB: radius, isRectangle: false }),
      object("smoke_crate", "Box_NATO_AmmoVeh_F", [radius * 0.4, 0, 0], 0, layer),
      object("landing_light_1", "Land_PortableLight_single_F", [-radius * 0.6, -radius * 0.4, 0], 45, layer),
      object("landing_light_2", "Land_PortableLight_single_F", [radius * 0.6, -radius * 0.4, 0], -45, layer)
    ],
    input.anchor,
    input.catalogChoices
  );
}

export function generateCoverLine(input: {
  anchor?: GeneratorAnchor;
  lengthMeters?: number;
  segmentCount?: number;
  catalogChoices?: GeneratorCatalogChoice[];
}): { plan: GeneratedBatchPlan; warnings: string[]; catalog?: Record<string, unknown> } {
  const segments = Math.min(Math.max(input.segmentCount ?? 5, 1), 25);
  const length = input.lengthMeters ?? 20;
  const layer = "MCP Generated Cover Line";
  const operations = Array.from({ length: segments }, (_, index) => {
    const t = segments === 1 ? 0 : index / (segments - 1) - 0.5;
    return object(`cover_${index + 1}`, "Land_BagFence_Long_F", [t * length, 0, 0], 0, layer);
  });
  return planResult("Cover Line", operations, input.anchor, input.catalogChoices);
}

export function generatePropWall(input: {
  anchor?: GeneratorAnchor;
  lengthMeters?: number;
  segmentCount?: number;
  catalogChoices?: GeneratorCatalogChoice[];
}): { plan: GeneratedBatchPlan; warnings: string[]; catalog?: Record<string, unknown> } {
  const segments = Math.min(Math.max(input.segmentCount ?? 6, 1), 30);
  const length = input.lengthMeters ?? 24;
  const layer = "MCP Generated Prop Wall";
  const operations = Array.from({ length: segments }, (_, index) => {
    const t = segments === 1 ? 0 : index / (segments - 1) - 0.5;
    return object(`wall_${index + 1}`, "Land_HBarrier_1_F", [t * length, 0, 0], 0, layer);
  });
  return planResult("Prop Wall", operations, input.anchor, input.catalogChoices);
}

function object(clientRef: string, className: string, offset: [number, number, number], dir: number, layer: string): GeneratedBatchOperation {
  return { op: "create_entity", clientRef, type: "Object", className, transform: { positionATL: offset, dir }, layer };
}

function marker(clientRef: string, markerType: string, offset: [number, number, number], text: string, layer: string): GeneratedBatchOperation {
  return { op: "create_marker", clientRef, type: "Marker", className: markerType, transform: { positionATL: offset, dir: 0 }, text, layer };
}

function trigger(clientRef: string, offset: [number, number, number], dir: number, layer: string, attributes: Record<string, unknown>): GeneratedBatchOperation {
  return { op: "create_trigger", clientRef, type: "Trigger", className: "EmptyDetector", transform: { positionATL: offset, dir }, attributes, layer };
}

function planResult(
  name: string,
  operations: GeneratedBatchOperation[],
  anchor: GeneratorAnchor = {},
  catalogChoices: GeneratorCatalogChoice[] = []
): { plan: GeneratedBatchPlan; warnings: string[]; catalog?: Record<string, unknown> } {
  const base = anchor.positionATL ?? [0, 0, 0];
  const dir = anchor.dir ?? 0;
  const appliedCatalog = applyCatalogChoices(operations, catalogChoices);
  return {
    plan: {
      schemaVersion: 1,
      id: createId("plan"),
      name,
      dryRun: true,
      historyLabel: `Arma MCP: ${name}`,
      operations: operations.map((operation) => ({
        ...operation,
        transform: {
          ...operation.transform,
          positionATL: rotateOffset(base, dir, operation.transform.positionATL),
          dir: (operation.transform.dir ?? 0) + dir
        }
      }))
    },
    warnings: [
      "Generated plan is dry-run by default; apply through arma.eden.batch after review.",
      ...appliedCatalog.warnings
    ],
    catalog: {
      applied: appliedCatalog.applied,
      missingRoles: appliedCatalog.missingRoles
    }
  };
}

function applyCatalogChoices(
  operations: GeneratedBatchOperation[],
  catalogChoices: GeneratorCatalogChoice[]
): { applied: GeneratorCatalogChoice[]; missingRoles: string[]; warnings: string[] } {
  const choicesByRef = new Map(catalogChoices.filter((choice) => choice.clientRef).map((choice) => [choice.clientRef!, choice]));
  const choicesByRole = new Map(catalogChoices.filter((choice) => choice.role).map((choice) => [choice.role!, choice]));
  const applied: GeneratorCatalogChoice[] = [];
  const missingRoles = new Set<string>();
  for (const operation of operations) {
    if (operation.op !== "create_entity") {
      continue;
    }
    const role = generatorRoleForClientRef(operation.clientRef);
    const choice = choicesByRef.get(operation.clientRef) ?? choicesByRole.get(role);
    if (choice?.className) {
      operation.className = choice.className;
      applied.push({ ...choice, clientRef: operation.clientRef, role });
    } else {
      missingRoles.add(role);
    }
  }
  return {
    applied,
    missingRoles: Array.from(missingRoles),
    warnings:
      catalogChoices.length > 0
        ? []
        : ["No catalog-backed generator preferences were available; using vanilla fallback classnames."]
  };
}

export function generatorRoleForClientRef(clientRef: string): string {
  const normalized = clientRef.toLowerCase();
  if (normalized.includes("terminal") || normalized.includes("console") || normalized.includes("objective")) {
    return "objective_terminal";
  }
  if (normalized.includes("light")) {
    return "generator_light";
  }
  if (normalized.includes("ammo") || normalized.includes("supply") || normalized.includes("crate")) {
    return "generator_supply";
  }
  if (normalized.includes("tower") || normalized.includes("hq") || normalized.includes("house")) {
    return "generator_structure";
  }
  if (normalized.includes("aa_launcher")) {
    return "generator_static_weapon";
  }
  return "generator_fortification";
}

function objectiveSuggestsTerminal(objective: string | undefined): boolean {
  return Boolean(objective?.toLowerCase().match(/\b(console|terminal|uplink|download|upload|hack|data|intel)\b/));
}

function rotateOffset(base: [number, number, number], dir: number, offset: [number, number, number]): [number, number, number] {
  const radians = (dir * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return [base[0] + offset[0] * cos - offset[1] * sin, base[1] + offset[0] * sin + offset[1] * cos, base[2] + offset[2]];
}

function layerName(theme: string | undefined, suffix: string): string {
  const prefix = theme?.trim() ? theme.trim() : "MCP";
  return `${prefix} Generated ${suffix}`;
}
