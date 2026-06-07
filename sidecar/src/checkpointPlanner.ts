import { createId } from "./state.js";
import type { CompositionPlan } from "./schema.js";

const allowedVanillaObjects = new Set([
  "Land_BagFence_Long_F",
  "Land_BagFence_Round_F",
  "Land_Cargo_Patrol_V1_F",
  "Land_HBarrier_1_F",
  "Land_HBarrier_3_F",
  "Land_Cargo_House_V1_F",
  "Land_PortableLight_single_F",
  "Land_Cargo20_military_green_F"
]);

export function generateCheckpointPlan(input: {
  prompt: string;
  radiusMeters: number;
  factionStyle: string;
  density: "low" | "medium";
}): { plan: CompositionPlan; notes: string[] } {
  const scale = Math.min(Math.max(input.radiusMeters / 25, 0.5), 2);
  const operations: CompositionPlan["operations"] = [
    { type: "createObject", className: "Land_HBarrier_3_F", offset: [-6 * scale, 0, 0], directionOffset: 90 },
    { type: "createObject", className: "Land_HBarrier_3_F", offset: [6 * scale, 0, 0], directionOffset: 90 },
    { type: "createObject", className: "Land_BagFence_Long_F", offset: [-4 * scale, 5 * scale, 0], directionOffset: 0 },
    { type: "createObject", className: "Land_BagFence_Long_F", offset: [4 * scale, 5 * scale, 0], directionOffset: 0 },
    { type: "createObject", className: "Land_Cargo20_military_green_F", offset: [0, -8 * scale, 0], directionOffset: 0 },
    { type: "createObject", className: "Land_PortableLight_single_F", offset: [-8 * scale, -4 * scale, 0], directionOffset: 180 },
    { type: "createObject", className: "Land_PortableLight_single_F", offset: [8 * scale, -4 * scale, 0], directionOffset: 180 },
    {
      type: "createMarker",
      nameHint: "amcp_checkpoint",
      markerType: "mil_dot",
      offset: [0, 0, 0],
      text: "ArmaMCP checkpoint"
    }
  ];

  if (input.density === "medium") {
    operations.push(
      { type: "createObject", className: "Land_BagFence_Round_F", offset: [-8 * scale, 7 * scale, 0], directionOffset: 45 },
      { type: "createObject", className: "Land_BagFence_Round_F", offset: [8 * scale, 7 * scale, 0], directionOffset: -45 }
    );
  }

  return {
    plan: {
      id: createId("plan"),
      name: titleFromPrompt(input.prompt),
      dryRun: true,
      anchor: { mode: "selectionCenter" },
      operations
    },
    notes: [
      "Dry-run only; queue a copy with dryRun=false after review.",
      "Uses vanilla fallback classnames until an asset index exists.",
      `Validated ${operations.filter((op) => op.type === "createObject").length} object operation(s) against the MVP allowlist.`
    ]
  };
}

export function validateCheckpointClasses(plan: CompositionPlan): string[] {
  return plan.operations
    .filter((operation) => operation.type === "createObject")
    .map((operation) => operation.className)
    .filter((className) => !allowedVanillaObjects.has(className));
}

function titleFromPrompt(prompt: string): string {
  const cleaned = prompt.trim() || "small checkpoint";
  return cleaned
    .split(/\s+/)
    .slice(0, 6)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
