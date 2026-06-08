export type SidecarMode = "stdio" | "http-only" | "stdio-existing-bridge";

export type SidecarRuntimeInfo = {
  mode: SidecarMode;
  pid: number;
  startedAt: string;
  ownsHttpListener: boolean;
  skipHttpListen: boolean;
  httpBridgeUrl: string;
  nodeVersion: string;
};

export function createRuntimeInfo(input: {
  mode: SidecarMode;
  host: string;
  port: number;
  ownsHttpListener: boolean;
  skipHttpListen: boolean;
  startedAt?: string;
}): SidecarRuntimeInfo {
  return {
    mode: input.mode,
    pid: process.pid,
    startedAt: input.startedAt ?? new Date().toISOString(),
    ownsHttpListener: input.ownsHttpListener,
    skipHttpListen: input.skipHttpListen,
    httpBridgeUrl: `http://${input.host}:${input.port}`,
    nodeVersion: process.version
  };
}

export function withRuntimeBridgeUrl(runtime: SidecarRuntimeInfo, host: string, port: number): SidecarRuntimeInfo {
  return {
    ...runtime,
    httpBridgeUrl: `http://${host}:${port}`
  };
}
