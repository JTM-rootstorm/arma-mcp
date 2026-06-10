import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sidecarRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type ScreenshotMirroringStatus = {
  cacheMirroring: boolean;
  cacheMirroringMode: "configured" | "auto_detected_standard_path" | "auto_detect_standard_paths";
  sourceDirEnv: "ARMA_MCP_SCREENSHOT_SOURCE_DIR";
  sourceDir: string | null;
  candidateSourceDirs: string[];
  screenshotBackend: "arma_then_linux" | "linux";
  linuxFallback: {
    enabled: boolean;
    tool: string | null;
    mode: string;
  };
};

export function screenshotCacheDir(className: string): string {
  return resolve(process.env.ARMA_MCP_SCREENSHOT_CACHE_DIR ?? resolve(sidecarRepoRoot, ".mcp-cache/arma/screenshots"), safePathSegment(className));
}

export function mirrorProfileScreenshot(profileRelativePath: string, targetPath: string): { copied: boolean; warning?: string } {
  if (!profileRelativePath) {
    return { copied: false, warning: "missing_profile_relative_path" };
  }
  const normalizedRelative = profileRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const sourceRoot = resolveScreenshotSourceRoot(normalizedRelative);
  if (!sourceRoot) {
    return { copied: false, warning: "set_ARMA_MCP_SCREENSHOT_SOURCE_DIR_or_use_standard_Arma_profile_Screenshots_path_to_copy_pngs" };
  }
  const sourcePath = resolve(sourceRoot, normalizedRelative);
  const resolvedRoot = resolve(sourceRoot);
  if (sourcePath !== resolvedRoot && !sourcePath.startsWith(`${resolvedRoot}${sep}`)) {
    return { copied: false, warning: "profile_relative_path_escaped_source_root" };
  }
  const ready = waitForReadyFile(sourcePath, screenshotReadyTimeoutMs());
  if (!ready.exists) {
    rmSync(targetPath, { force: true });
    return { copied: false, warning: `source_png_not_found:${sourcePath}` };
  }
  if (!ready.nonEmpty) {
    rmSync(targetPath, { force: true });
    return { copied: false, warning: `source_png_empty:${sourcePath}` };
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return { copied: true };
}

export type LinuxScreenshotFallbackResult = {
  captured: boolean;
  method?: string;
  warning?: string;
};

export function captureLinuxScreenshotFallback(targetPath: string): LinuxScreenshotFallbackResult {
  const enabled = process.env.ARMA_MCP_SCREENSHOT_FALLBACK ?? "auto";
  if (["0", "false", "off", "none"].includes(enabled.toLowerCase())) {
    return { captured: false, warning: "linux_screenshot_fallback_disabled" };
  }

  const tool = resolveFallbackTool();
  if (!tool) {
    return { captured: false, warning: "linux_screenshot_fallback_tool_not_found" };
  }

  const mode = process.env.ARMA_MCP_SCREENSHOT_FALLBACK_MODE ?? "current";
  const args = fallbackArgs(tool, mode, targetPath);
  if (!args) {
    return { captured: false, warning: `linux_screenshot_fallback_mode_unsupported:${mode}` };
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  rmSync(targetPath, { force: true });

  const result = spawnSync(tool, args, {
    env: screenshotFallbackEnv(process.env),
    encoding: "utf8",
    timeout: screenshotFallbackTimeoutMs(),
    windowsHide: true
  });
  if (existsSync(targetPath) && fileSize(targetPath) > 0) {
    return { captured: true, method: fallbackMethod(tool, mode) };
  }
  if (result.error) {
    return { captured: false, method: fallbackMethod(tool, mode), warning: `linux_screenshot_fallback_error:${truncate(result.error.message)}` };
  }
  if (result.status !== 0) {
    const stderr = result.stderr || result.stdout || `exit_${result.status}`;
    return { captured: false, method: fallbackMethod(tool, mode), warning: `linux_screenshot_fallback_failed:${truncate(stderr)}` };
  }
  if (!existsSync(targetPath) || fileSize(targetPath) <= 0) {
    rmSync(targetPath, { force: true });
    return { captured: false, method: fallbackMethod(tool, mode), warning: "linux_screenshot_fallback_empty_output" };
  }
  return { captured: true, method: fallbackMethod(tool, mode) };
}

export function getScreenshotMirroringStatus(): ScreenshotMirroringStatus {
  const sourceDir = resolveScreenshotSourceRoot();
  const configured = Boolean(process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR);
  const tool = resolveFallbackTool();
  return {
    cacheMirroring: Boolean(sourceDir),
    cacheMirroringMode: configured ? "configured" : sourceDir ? "auto_detected_standard_path" : "auto_detect_standard_paths",
    sourceDirEnv: "ARMA_MCP_SCREENSHOT_SOURCE_DIR",
    sourceDir: sourceDir ?? null,
    candidateSourceDirs: screenshotSourceRootCandidates(),
    screenshotBackend: shouldSkipArmaScreenshotCommand() ? "linux" : "arma_then_linux",
    linuxFallback: {
      enabled: !["0", "false", "off", "none"].includes((process.env.ARMA_MCP_SCREENSHOT_FALLBACK ?? "auto").toLowerCase()),
      tool,
      mode: process.env.ARMA_MCP_SCREENSHOT_FALLBACK_MODE ?? "current"
    }
  };
}

export function shouldSkipArmaScreenshotCommand(): boolean {
  const explicit = process.env.ARMA_MCP_SCREENSHOT_SKIP_ARMA;
  if (explicit && ["1", "true", "yes", "on"].includes(explicit.toLowerCase())) {
    return true;
  }
  const backend = (process.env.ARMA_MCP_SCREENSHOT_BACKEND ?? "").toLowerCase();
  return ["linux", "wayland", "external"].includes(backend);
}

function resolveScreenshotSourceRoot(normalizedRelative?: string): string | undefined {
  const configured = process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR;
  if (configured) {
    return resolve(configured);
  }
  const candidates = screenshotSourceRootCandidates();
  if (normalizedRelative) {
    const withFile = candidates.find((candidate) => existsSync(resolve(candidate, normalizedRelative)));
    if (withFile) {
      return withFile;
    }
  }
  return candidates.find((candidate) => existsSync(candidate));
}

function screenshotSourceRootCandidates(): string[] {
  const home = process.env.HOME;
  if (!home) {
    return [];
  }
  const otherProfileRoots = [
    join(home, ".local/share/Arma 3 - Other Profiles"),
    join(home, ".local/share/Steam/steamapps/compatdata/107410/pfx/drive_c/users/steamuser/Documents/Arma 3 - Other Profiles")
  ];
  return [
    join(home, ".local/share/Arma 3/Screenshots"),
    join(home, ".local/share/Arma 3 - Other Profiles/Screenshots"),
    join(home, ".local/share/Steam/steamapps/compatdata/107410/pfx/drive_c/users/steamuser/Documents/Arma 3/Screenshots"),
    join(home, ".local/share/Steam/steamapps/compatdata/107410/pfx/drive_c/users/steamuser/Documents/Arma 3 - Other Profiles/Screenshots"),
    ...otherProfileRoots.flatMap((root) => profileScreenshotDirs(root))
  ];
}

function profileScreenshotDirs(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name, "Screenshots"));
  } catch {
    return [];
  }
}

function waitForReadyFile(path: string, timeoutMs: number): { exists: boolean; nonEmpty: boolean } {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  let stableNonEmptyTicks = 0;
  while (Date.now() <= deadline) {
    if (existsSync(path)) {
      const size = fileSize(path);
      if (size > 0) {
        if (size === lastSize) {
          stableNonEmptyTicks += 1;
          if (stableNonEmptyTicks >= 2) {
            return { exists: true, nonEmpty: true };
          }
        } else {
          lastSize = size;
          stableNonEmptyTicks = 0;
        }
      } else {
        lastSize = size;
        stableNonEmptyTicks = 0;
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (!existsSync(path)) {
    return { exists: false, nonEmpty: false };
  }
  return { exists: true, nonEmpty: fileSize(path) > 0 };
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function screenshotReadyTimeoutMs(): number {
  const parsed = Number(process.env.ARMA_MCP_SCREENSHOT_READY_TIMEOUT_MS ?? 5_000);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 5_000;
  }
  return Math.min(Math.trunc(parsed), 30_000);
}

function screenshotFallbackTimeoutMs(): number {
  const parsed = Number(process.env.ARMA_MCP_SCREENSHOT_FALLBACK_TIMEOUT_MS ?? 10_000);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 10_000;
  }
  return Math.min(Math.trunc(parsed), 60_000);
}

function resolveFallbackTool(): string | null {
  const configured = process.env.ARMA_MCP_SCREENSHOT_FALLBACK_TOOL;
  if (configured) {
    return findOnPath(configured);
  }
  for (const tool of ["spectacle", "gnome-screenshot", "grim", "maim", "import", "scrot"]) {
    const found = findOnPath(tool);
    if (found) {
      return found;
    }
  }
  return null;
}

function fallbackArgs(toolPath: string, mode: string, targetPath: string): string[] | null {
  const tool = toolPath.split(/[\\/]/).pop() ?? toolPath;
  const normalizedMode = mode.toLowerCase();
  if (tool === "spectacle") {
    const captureArg = normalizedMode === "fullscreen" ? "--fullscreen" : normalizedMode === "current" ? "--current" : "--activewindow";
    return ["--background", "--nonotify", captureArg, "--output", targetPath];
  }
  if (tool === "gnome-screenshot") {
    const captureArgs = normalizedMode === "fullscreen" ? [] : normalizedMode === "activewindow" ? ["--window"] : [];
    return [...captureArgs, "--file", targetPath];
  }
  if (tool === "grim") {
    return normalizedMode === "activewindow" ? null : [targetPath];
  }
  if (tool === "maim") {
    return normalizedMode === "activewindow" ? ["-i", ":ACTIVE:", targetPath] : [targetPath];
  }
  if (tool === "import") {
    return normalizedMode === "activewindow" ? ["-window", "root", targetPath] : ["-window", "root", targetPath];
  }
  if (tool === "scrot") {
    return [targetPath];
  }
  return null;
}

function screenshotFallbackEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const runtimeDir = next.XDG_RUNTIME_DIR ?? (uid !== undefined ? `/run/user/${uid}` : undefined);
  if (runtimeDir) {
    next.XDG_RUNTIME_DIR ??= runtimeDir;
    if (!next.DBUS_SESSION_BUS_ADDRESS && existsSync(join(runtimeDir, "bus"))) {
      next.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(runtimeDir, "bus")}`;
    }
    if (!next.WAYLAND_DISPLAY && existsSync(join(runtimeDir, "wayland-0"))) {
      next.WAYLAND_DISPLAY = "wayland-0";
    }
  }
  if (!next.DISPLAY) {
    next.DISPLAY = ":0";
  }
  if (!next.QT_QPA_PLATFORM && next.WAYLAND_DISPLAY) {
    next.QT_QPA_PLATFORM = "wayland";
  }
  return next;
}

function fallbackMethod(toolPath: string, mode: string): string {
  return `${toolPath.split(/[\\/]/).pop() ?? toolPath}:${mode}`;
}

function findOnPath(command: string): string | null {
  if (command.includes("/") && existsSync(command)) {
    return command;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, command);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function truncate(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, 240);
}

function safePathSegment(input: string): string {
  return input.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120) || "unknown";
}
