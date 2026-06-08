import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sidecarRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type ScreenshotMirroringStatus = {
  cacheMirroring: boolean;
  cacheMirroringMode: "configured" | "auto_detected_standard_path" | "auto_detect_standard_paths";
  sourceDirEnv: "ARMA_MCP_SCREENSHOT_SOURCE_DIR";
  sourceDir: string | null;
  candidateSourceDirs: string[];
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

export function getScreenshotMirroringStatus(): ScreenshotMirroringStatus {
  const sourceDir = resolveScreenshotSourceRoot();
  const configured = Boolean(process.env.ARMA_MCP_SCREENSHOT_SOURCE_DIR);
  return {
    cacheMirroring: Boolean(sourceDir),
    cacheMirroringMode: configured ? "configured" : sourceDir ? "auto_detected_standard_path" : "auto_detect_standard_paths",
    sourceDirEnv: "ARMA_MCP_SCREENSHOT_SOURCE_DIR",
    sourceDir: sourceDir ?? null,
    candidateSourceDirs: screenshotSourceRootCandidates()
  };
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

function safePathSegment(input: string): string {
  return input.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120) || "unknown";
}
