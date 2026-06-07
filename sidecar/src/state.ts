import type { CompositionPlan, EditorSnapshot, IncomingEditorSnapshot } from "./schema.js";

export type BridgeCommand =
  | { id: string; type: "requestSnapshot"; scope: "selection" | "all"; createdAt: string }
  | { id: string; type: "applyPlan"; plan: CompositionPlan; createdAt: string };

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

export type ArmaMcpState = ReturnType<typeof createState>;

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createState(maxEvents = 200) {
  let lastSnapshot: EditorSnapshot | null = null;
  let lastEdenSeenAt: string | null = null;
  const commands: BridgeCommand[] = [];
  const events: Array<BridgeEvent | BridgeResult> = [];

  function rememberEvent(event: BridgeEvent | BridgeResult): void {
    events.unshift(event);
    events.splice(maxEvents);
  }

  return {
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
