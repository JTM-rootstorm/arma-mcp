import type { CompositionPlan, EditorSnapshot, IncomingEditorSnapshot } from "./schema.js";
import {
  actionNameSchema,
  actionPacketSchema,
  normalizeActionResult,
  schemaVersion,
  type ArmaMcpAction,
  type ArmaMcpActionMode,
  type ArmaMcpActionName,
  type ArmaMcpActionResult
} from "./protocol.js";

export type BridgeCommand =
  | { id: string; type: "requestSnapshot"; scope: "selection" | "all"; createdAt: string }
  | { id: string; type: "applyPlan"; plan: CompositionPlan; createdAt: string }
  | ArmaMcpAction;

export type SnapshotRequestCommand = Extract<BridgeCommand, { type: "requestSnapshot" }>;
export type ApplyPlanCommand = Extract<BridgeCommand, { type: "applyPlan" }>;

export type BridgeEvent = {
  id: string;
  createdAt: string;
  type: string;
  message: string;
  payload?: unknown;
};

export type BridgeResult = {
  id: string;
  createdAt: string;
  commandId?: string;
  ok: boolean;
  message: string;
  payload?: unknown;
};

export type AuditEvent = {
  id: string;
  createdAt: string;
  type: "audit";
  message: string;
  payload: {
    requestId: string;
    action: string;
    mode: ArmaMcpActionMode;
    dryRun: boolean;
    confirmed: boolean;
    result: "queued" | "ok" | "error" | "timeout";
    entityCount?: number;
    classesTouched?: string[];
    errorCode?: string;
  };
};

export type QueuedActionInput = {
  action: ArmaMcpActionName;
  mode: ArmaMcpActionMode;
  params?: Record<string, unknown>;
  dryRun?: boolean;
  requiresConfirmation?: boolean;
  context?: Record<string, unknown>;
  timeoutMs?: number;
};

export type QueuedAction = {
  action: ArmaMcpAction;
  result: Promise<ArmaMcpActionResult>;
};

export interface ArmaMcpState {
  queueAction(input: QueuedActionInput): QueuedAction;
  queueSnapshotRequest(scope?: "selection" | "all"): SnapshotRequestCommand | Promise<SnapshotRequestCommand>;
  queueApplyPlan(plan: CompositionPlan): ApplyPlanCommand | Promise<ApplyPlanCommand>;
  drainCommands(): BridgeCommand[];
  pendingCommandCount(): number | Promise<number>;
  pendingActionCount(): number | Promise<number>;
  storeSnapshot(snapshot: IncomingEditorSnapshot): EditorSnapshot;
  rememberBridgeEvent(type: string, message: string, payload?: unknown): BridgeEvent;
  rememberResult(input: Omit<BridgeResult, "id" | "createdAt">): BridgeResult;
  completeActionResult(input: unknown): BridgeResult;
  getLastSnapshot(): EditorSnapshot | null | Promise<EditorSnapshot | null>;
  getLastEdenSeenAt(): string | null | Promise<string | null>;
  recentEvents(limit?: number): Array<BridgeEvent | BridgeResult | AuditEvent> | Promise<Array<BridgeEvent | BridgeResult | AuditEvent>>;
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createState(maxEvents = 200, requestTimeoutMs = 30_000, maxPendingRequests = 100) {
  let lastSnapshot: EditorSnapshot | null = null;
  let lastEdenSeenAt: string | null = null;
  const commands: BridgeCommand[] = [];
  const events: Array<BridgeEvent | BridgeResult | AuditEvent> = [];
  const pendingResults = new Map<
    string,
    {
      action: ArmaMcpAction;
      queuedAt: number;
      timeout: NodeJS.Timeout;
      resolve: (result: ArmaMcpActionResult) => void;
      reject: (error: Error) => void;
    }
  >();

  function rememberEvent(event: BridgeEvent | BridgeResult | AuditEvent): void {
    events.unshift(event);
    events.splice(maxEvents);
  }

  function rememberAudit(
    action: ArmaMcpAction,
    result: AuditEvent["payload"]["result"],
    extra: Partial<AuditEvent["payload"]> = {}
  ): void {
    if (action.mode === "read" && result === "queued") {
      return;
    }
    rememberEvent({
      id: createId("audit"),
      createdAt: new Date().toISOString(),
      type: "audit",
      message: `Action ${action.action} ${result}`,
      payload: {
        requestId: action.requestId,
        action: action.action,
        mode: action.mode,
        dryRun: action.dryRun === true,
        confirmed: Boolean(action.context?.confirmationConfirmed),
        result,
        ...extra
      }
    });
  }

  function legacyResultToActionResult(input: Record<string, unknown>): ArmaMcpActionResult {
    const action = typeof input.action === "string" ? actionNameSchema.safeParse(input.action).data : undefined;
    const requestId =
      typeof input.requestId === "string"
        ? input.requestId
        : typeof input.commandId === "string"
          ? input.commandId
          : createId("legacy");
    return normalizeActionResult(
      {
        schemaVersion,
        requestId,
        ok: input.ok !== false,
        action: action ?? "bridge.ping",
        result: input.result ?? input,
        warnings: Array.isArray(input.warnings) ? input.warnings : [],
        error: input.error
      },
      action
    );
  }

  return {
    queueAction(input: QueuedActionInput) {
      if (pendingResults.size >= maxPendingRequests) {
        throw new Error(`Too many pending Arma MCP requests (${maxPendingRequests})`);
      }
      const requestId = createId("req");
      const action = actionPacketSchema.parse({
        schemaVersion,
        requestId,
        action: input.action,
        mode: input.mode,
        dryRun: input.dryRun,
        requiresConfirmation: input.requiresConfirmation,
        params: input.params ?? {},
        context: {
          source: "mcp",
          client: "codex",
          createdAt: new Date().toISOString(),
          ...(input.context ?? {})
        }
      });
      commands.push(action);
      rememberEvent({
        id: createId("evt"),
        createdAt: new Date().toISOString(),
        type: "commandQueued",
        message: `Queued ${action.action}`,
        payload: { requestId: action.requestId, action: action.action }
      });
      rememberAudit(action, "queued", {
        entityCount: inferEntityCount(action.params),
        classesTouched: inferClassesTouched(action.params)
      });

      const result = new Promise<ArmaMcpActionResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingResults.delete(action.requestId);
          rememberAudit(action, "timeout");
          reject(new Error(`Timed out waiting for Arma result for ${action.action}`));
        }, input.timeoutMs ?? requestTimeoutMs);
        pendingResults.set(action.requestId, {
          action,
          queuedAt: Date.now(),
          timeout,
          resolve,
          reject
        });
      });

      return { action, result };
    },

    queueSnapshotRequest(scope: "selection" | "all" = "selection") {
      const command: BridgeCommand = {
        id: createId("cmd"),
        type: "requestSnapshot",
        scope,
        createdAt: new Date().toISOString()
      };
      commands.push(command);
      rememberEvent({
        id: createId("evt"),
        createdAt: new Date().toISOString(),
        type: "commandQueued",
        message: `Queued ${scope} snapshot request`,
        payload: { commandId: command.id }
      });
      return command;
    },

    queueApplyPlan(plan: CompositionPlan) {
      const command: BridgeCommand = {
        id: createId("cmd"),
        type: "applyPlan",
        plan,
        createdAt: new Date().toISOString()
      };
      commands.push(command);
      rememberEvent({
        id: createId("evt"),
        createdAt: new Date().toISOString(),
        type: "commandQueued",
        message: `Queued plan ${plan.name}`,
        payload: { commandId: command.id, planId: plan.id }
      });
      return command;
    },

    drainCommands() {
      return commands.splice(0, commands.length);
    },

    pendingCommandCount() {
      return commands.length;
    },

    pendingActionCount() {
      return pendingResults.size;
    },

    storeSnapshot(snapshot: IncomingEditorSnapshot) {
      const normalized = {
        ...snapshot,
        id: snapshot.id ?? createId("snap"),
        createdAt: snapshot.createdAt ?? new Date().toISOString(),
        source: "eden" as const
      };
      lastSnapshot = normalized;
      lastEdenSeenAt = new Date().toISOString();
      rememberEvent({
        id: createId("evt"),
        createdAt: new Date().toISOString(),
        type: "snapshotReceived",
        message: `Received ${normalized.selected.length} selected object snapshot(s)`,
        payload: { snapshotId: normalized.id, selectedCount: normalized.selected.length }
      });
      return normalized;
    },

    rememberBridgeEvent(type: string, message: string, payload?: unknown) {
      lastEdenSeenAt = new Date().toISOString();
      const event: BridgeEvent = {
        id: createId("evt"),
        createdAt: new Date().toISOString(),
        type,
        message,
        payload
      };
      rememberEvent(event);
      return event;
    },

    rememberResult(input: Omit<BridgeResult, "id" | "createdAt">) {
      lastEdenSeenAt = new Date().toISOString();
      const result: BridgeResult = {
        id: createId("res"),
        createdAt: new Date().toISOString(),
        ...input
      };
      rememberEvent(result);
      return result;
    },

    completeActionResult(input: unknown) {
      lastEdenSeenAt = new Date().toISOString();
      const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      const result = "requestId" in raw ? normalizeActionResult(raw) : legacyResultToActionResult(raw);
      const pending = pendingResults.get(result.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingResults.delete(result.requestId);
        if (result.ok) {
          pending.resolve(result);
        } else {
          pending.reject(new Error(result.error?.message ?? `Arma action ${result.action} failed`));
        }
        rememberAudit(pending.action, result.ok ? "ok" : "error", {
          errorCode: result.error?.code,
          entityCount: inferEntityCount(result.result),
          classesTouched: inferClassesTouched(pending.action.params)
        });
      }

      const bridgeResult: BridgeResult = {
        id: createId("res"),
        createdAt: new Date().toISOString(),
        commandId: result.requestId,
        ok: result.ok,
        message: result.ok ? `Completed ${result.action}` : (result.error?.message ?? `Failed ${result.action}`),
        payload: result
      };
      rememberEvent(bridgeResult);
      return bridgeResult;
    },

    getLastSnapshot() {
      return lastSnapshot;
    },

    getLastEdenSeenAt() {
      return lastEdenSeenAt;
    },

    recentEvents(limit = 20) {
      return events.slice(0, limit);
    }
  };
}

function inferEntityCount(value: unknown): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["entityIds", "entities", "created", "updated", "deleted"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
  }
  const operations = record.operations;
  if (Array.isArray(operations)) {
    return operations.length;
  }
  return undefined;
}

function inferClassesTouched(value: unknown): string[] | undefined {
  const classes = new Set<string>();
  function visit(candidate: unknown): void {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (typeof record.className === "string") {
      classes.add(record.className);
    }
    if (Array.isArray(record.operations)) {
      record.operations.forEach(visit);
    }
  }
  visit(value);
  return classes.size > 0 ? Array.from(classes).slice(0, 50) : undefined;
}
