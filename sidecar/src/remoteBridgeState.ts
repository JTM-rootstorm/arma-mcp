import type { BridgeConfig } from "./httpBridge.js";
import {
  actionPacketSchema,
  schemaVersion,
  type ArmaMcpActionResult
} from "./protocol.js";
import type {
  ArmaMcpState,
  ApplyPlanCommand,
  AuditEvent,
  BridgeEvent,
  BridgeResult,
  QueuedActionInput,
  SnapshotRequestCommand
} from "./state.js";
import { createId } from "./state.js";
import type { CompositionPlan, EditorSnapshot, IncomingEditorSnapshot } from "./schema.js";

type RemoteStatus = {
  armaConnected: boolean;
  edenAvailable: boolean;
  pendingActions: number;
  pendingResults: number;
  lastSeenAt: string | null;
  lastSnapshotAt: string | null;
};

export function createRemoteBridgeState(config: BridgeConfig): ArmaMcpState {
  const baseUrl = `http://${config.host}:${config.port}`;

  async function bridgeFetch<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${config.token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers ?? {})
        }
      });
      const text = await response.text();
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (!response.ok) {
        const error =
          typeof body.message === "string"
            ? body.message
            : typeof body.error === "string"
              ? body.error
              : `HTTP ${response.status}`;
        throw new Error(`Remote Arma MCP bridge request failed: ${error}`);
      }
      return body as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getStatus(): Promise<RemoteStatus> {
    return bridgeFetch<RemoteStatus>("/mcp/status");
  }

  return {
    queueAction(input: QueuedActionInput) {
      const action = actionPacketSchema.parse({
        schemaVersion,
        requestId: createId("remote_req"),
        action: input.action,
        mode: input.mode,
        dryRun: input.dryRun,
        requiresConfirmation: input.requiresConfirmation,
        params: input.params ?? {},
        context: {
          source: "mcp",
          client: "codex",
          createdAt: new Date().toISOString(),
          remoteBridge: true,
          ...(input.context ?? {})
        }
      });
      const result = bridgeFetch<{ result: ArmaMcpActionResult }>(
        "/mcp/actions",
        {
          method: "POST",
          body: JSON.stringify(input)
        },
        (input.timeoutMs ?? 30_000) + 5_000
      ).then((body) => body.result);
      return { action, result };
    },

    async queueSnapshotRequest(scope: "selection" | "all" = "selection") {
      const body = await bridgeFetch<{ command: SnapshotRequestCommand }>("/mcp/snapshot-requests", {
        method: "POST",
        body: JSON.stringify({ scope })
      });
      return body.command;
    },

    async queueApplyPlan(plan: CompositionPlan) {
      const body = await bridgeFetch<{ command: ApplyPlanCommand }>("/mcp/apply-plans", {
        method: "POST",
        body: JSON.stringify({ plan })
      });
      return body.command;
    },

    drainCommands() {
      return [];
    },

    async pendingCommandCount() {
      return (await getStatus()).pendingActions;
    },

    async pendingActionCount() {
      return (await getStatus()).pendingResults;
    },

    storeSnapshot(_snapshot: IncomingEditorSnapshot): EditorSnapshot {
      throw new Error("Remote bridge state cannot store Eden snapshots directly");
    },

    rememberBridgeEvent(_type: string, _message: string, _payload?: unknown): BridgeEvent {
      throw new Error("Remote bridge state cannot store bridge events directly");
    },

    rememberResult(_input: Omit<BridgeResult, "id" | "createdAt">): BridgeResult {
      throw new Error("Remote bridge state cannot store bridge results directly");
    },

    completeActionResult(_input: unknown): BridgeResult {
      throw new Error("Remote bridge state cannot complete action results directly");
    },

    async getLastSnapshot() {
      const body = await bridgeFetch<{ snapshot: EditorSnapshot | null }>("/mcp/snapshot?includeRaw=1");
      return body.snapshot;
    },

    async getLastEdenSeenAt() {
      return (await getStatus()).lastSeenAt;
    },

    async recentEvents(limit = 20) {
      const body = await bridgeFetch<{ events: Array<BridgeEvent | BridgeResult | AuditEvent> }>(
        `/mcp/events?limit=${encodeURIComponent(String(limit))}`
      );
      return body.events;
    }
  };
}
