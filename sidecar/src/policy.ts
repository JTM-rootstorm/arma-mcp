import type { ArmaMcpActionName } from "./protocol.js";

const attributeAllowlist = new Set([
  "name",
  "init",
  "description",
  "presence",
  "presenceCondition",
  "lock",
  "text",
  "markerType",
  "color",
  "alpha",
  "size",
  "angle",
  "brush",
  "shape",
  "sizeA",
  "sizeB",
  "isRectangle",
  "activationBy",
  "activationType",
  "repeatable",
  "condition",
  "onActivation",
  "onDeactivation",
  "type",
  "behavior",
  "combatMode",
  "speedMode",
  "formation",
  "timeout",
  "completionRadius",
  "callsign",
  "Owner",
  "ModuleDescription",
  "Forced",
  "Addons"
]);

const sensitiveAttributeNames = new Set(["init", "condition", "onActivation", "onDeactivation"]);
const riskyPatterns = [
  /callExtension/i,
  /remoteExec(Call)?/i,
  /call\s+compile/i,
  /compile\s+preprocessFile/i,
  /execVM/i,
  /profileNamespace/i,
  /saveProfileNamespace/i,
  /BIS_fnc_MP/i
];

export type ToolPolicyInput = {
  action: ArmaMcpActionName;
  dryRun: boolean;
  confirmation?: { confirmed: boolean; reason: string };
  attributes?: Record<string, unknown>;
  operations?: unknown[];
};

export function enforceToolPolicy(input: ToolPolicyInput): { warnings: string[] } {
  const warnings: string[] = [];
  const destructive =
    input.action === "eden.delete_entities" ||
    input.action === "eden.delete_layer" ||
    input.action === "eden.delete_waypoint" ||
    containsDeleteOperation(input.operations);
  if (destructive && !input.dryRun && input.confirmation?.confirmed !== true) {
    throw new Error("Destructive Eden actions require confirmation.confirmed=true when dryRun=false.");
  }

  const attributes = collectAttributes(input);
  for (const [key, value] of Object.entries(attributes)) {
    if (!attributeAllowlist.has(key)) {
      throw new Error(`Attribute '${key}' is not allowlisted for Eden writes.`);
    }
    if (sensitiveAttributeNames.has(key) && typeof value === "string") {
      const risky = riskyPatterns.find((pattern) => pattern.test(value));
      if (risky) {
        if (!input.dryRun && input.confirmation?.confirmed !== true) {
          throw new Error(`Attribute '${key}' contains a risky scripting pattern and requires confirmation.`);
        }
        warnings.push(`Attribute '${key}' contains a risky scripting pattern.`);
      }
    }
  }

  if (input.operations && input.operations.length > 250) {
    throw new Error("Batch operations exceed the 250 operation limit.");
  }

  return { warnings };
}

function collectAttributes(input: ToolPolicyInput): Record<string, unknown> {
  const collected: Record<string, unknown> = { ...(input.attributes ?? {}) };
  for (const operation of input.operations ?? []) {
    if (!operation || typeof operation !== "object") {
      continue;
    }
    const maybeAttributes = (operation as Record<string, unknown>).attributes;
    if (maybeAttributes && typeof maybeAttributes === "object" && !Array.isArray(maybeAttributes)) {
      Object.assign(collected, maybeAttributes);
    }
  }
  return collected;
}

function containsDeleteOperation(operations: unknown[] | undefined): boolean {
  return (operations ?? []).some((operation) => {
    if (!operation || typeof operation !== "object") {
      return false;
    }
    return ["delete_entity", "delete_layer", "delete_waypoint"].includes(String((operation as Record<string, unknown>).op ?? ""));
  });
}
