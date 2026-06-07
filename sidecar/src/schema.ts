import { z } from "zod";

export const vector3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const editorObjectSnapshotSchema = z.object({
  edenId: z.string().optional(),
  netId: z.string().optional(),
  variableName: z.string().optional(),
  className: z.string().min(1),
  displayName: z.string().optional(),
  model: z.string().optional(),
  positionATL: vector3Schema,
  direction: z.number(),
  vectorDir: vector3Schema.optional(),
  vectorUp: vector3Schema.optional(),
  boundingBox: z
    .object({
      min: vector3Schema,
      max: vector3Schema
    })
    .optional(),
  selections: z.array(z.string()).optional()
});

export const editorSnapshotSchema = z.object({
  id: z.string().optional(),
  createdAt: z.string().optional(),
  sessionId: z.string().optional(),
  source: z.literal("eden").default("eden"),
  selected: z.array(editorObjectSnapshotSchema),
  allCount: z.number().int().nonnegative().optional(),
  raw: z.unknown().optional()
});

export const createObjectOperationSchema = z.object({
  type: z.literal("createObject"),
  className: z.string().min(1),
  offset: vector3Schema,
  directionOffset: z.number(),
  attributes: z.record(z.string(), z.unknown()).optional()
});

export const createMarkerOperationSchema = z.object({
  type: z.literal("createMarker"),
  nameHint: z.string().min(1),
  markerType: z.string().min(1),
  offset: vector3Schema,
  text: z.string().optional()
});

export const compositionOperationSchema = z.discriminatedUnion("type", [
  createObjectOperationSchema,
  createMarkerOperationSchema
]);

export const compositionPlanSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dryRun: z.boolean(),
  anchor: z.object({
    mode: z.enum(["selectionCenter", "absolute"]),
    positionATL: vector3Schema.optional(),
    direction: z.number().optional()
  }),
  operations: z.array(compositionOperationSchema).max(50)
});

export const requestSnapshotInputSchema = z.object({
  scope: z.enum(["selection", "all"]).default("selection")
});

export const getSnapshotInputSchema = z.object({
  includeRaw: z.boolean().default(false)
});

export const generateCheckpointPlanInputSchema = z.object({
  prompt: z.string().default("small checkpoint"),
  anchor: z.literal("selected").default("selected"),
  radiusMeters: z.number().positive().max(100).default(25),
  factionStyle: z.string().default("generic"),
  density: z.enum(["low", "medium"]).default("low")
});

export const queueApplyPlanInputSchema = z.object({
  plan: compositionPlanSchema
});

export const getBridgeEventsInputSchema = z.object({
  limit: z.number().int().positive().max(100).default(20)
});

export type EditorObjectSnapshot = z.infer<typeof editorObjectSnapshotSchema>;
export type IncomingEditorSnapshot = z.infer<typeof editorSnapshotSchema>;
export type EditorSnapshot = IncomingEditorSnapshot & {
  id: string;
  createdAt: string;
};
export type CompositionOperation = z.infer<typeof compositionOperationSchema>;
export type CompositionPlan = z.infer<typeof compositionPlanSchema>;
