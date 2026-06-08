import { z } from "zod";
import { DIRECT_BRIDGE_ACTION_NAMES } from "./actionManifest.js";

export const schemaVersion = 1 as const;

export const actionModeSchema = z.enum(["read", "write", "destructive", "debug"]);

export const confirmationSchema = z
  .object({
    confirmed: z.boolean(),
    reason: z.string().trim().min(1).max(500)
  })
  .optional();

export const vector3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const transformSchema = z
  .object({
    positionATL: vector3Schema.optional(),
    positionASL: vector3Schema.optional(),
    dir: z.number().optional(),
    vectorDir: vector3Schema.optional(),
    vectorUp: vector3Schema.optional(),
    alignToGround: z.boolean().optional()
  })
  .strict();

export const entityTypeSchema = z.enum(["Object", "Marker", "Trigger", "Logic", "Module", "Group", "Waypoint", "Layer"]);

export const entityRefSchema = z
  .object({
    edenId: z.string().min(1).max(120),
    type: entityTypeSchema.optional(),
    className: z.string().min(1).max(160).optional(),
    variableName: z.string().max(160).optional()
  })
  .strict();

export const entitySnapshotSchema = z
  .object({
    edenId: z.string().min(1),
    type: entityTypeSchema,
    className: z.string().optional(),
    variableName: z.string().optional(),
    displayName: z.string().optional(),
    transform: transformSchema.optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    model: z.record(z.string(), z.unknown()).optional(),
    warnings: z.array(z.string()).optional()
  })
  .passthrough();

export const actionNameSchema = z.enum(DIRECT_BRIDGE_ACTION_NAMES);

export const actionPacketSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    requestId: z.string().min(1).max(120),
    action: actionNameSchema,
    mode: actionModeSchema,
    dryRun: z.boolean().optional(),
    requiresConfirmation: z.boolean().optional(),
    params: z.record(z.string(), z.unknown()).default({}),
    context: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const actionErrorSchema = z
  .object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(1000),
    details: z.unknown().optional()
  })
  .strict();

export const actionResultSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    requestId: z.string().min(1).max(120),
    ok: z.boolean(),
    action: actionNameSchema,
    durationMs: z.number().nonnegative().optional(),
    result: z.unknown().optional(),
    warnings: z.array(z.string()).default([]),
    error: actionErrorSchema.optional(),
    audit: z
      .object({
        write: z.boolean(),
        dryRun: z.boolean(),
        confirmed: z.boolean().optional()
      })
      .optional()
  })
  .strict();

export const actionResultEnvelopeSchema = z.union([
  actionResultSchema,
  z
    .object({
      requestId: z.string().min(1),
      ok: z.boolean(),
      action: actionNameSchema,
      result: z.unknown().optional(),
      warnings: z.array(z.string()).optional(),
      error: actionErrorSchema.optional()
    })
    .passthrough()
]);

export type ArmaMcpAction = z.infer<typeof actionPacketSchema>;
export type ArmaMcpActionResult = z.infer<typeof actionResultSchema>;
export type ArmaMcpActionMode = z.infer<typeof actionModeSchema>;
export type ArmaMcpActionName = z.infer<typeof actionNameSchema>;
export type EntityType = z.infer<typeof entityTypeSchema>;

export function normalizeActionResult(input: unknown, fallbackAction?: ArmaMcpActionName): ArmaMcpActionResult {
  const full = actionResultSchema.safeParse(input);
  if (full.success) {
    return full.data;
  }
  const parsed = actionResultEnvelopeSchema.parse(input);
  return actionResultSchema.parse({
    schemaVersion,
    requestId: parsed.requestId,
    ok: parsed.ok,
    action: parsed.action ?? fallbackAction,
    result: parsed.result,
    warnings: parsed.warnings ?? [],
    error: parsed.error
  });
}
