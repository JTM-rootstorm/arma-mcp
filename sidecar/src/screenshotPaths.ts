import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
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
  if (!waitForFile(sourcePath, 3_000)) {
    return { copied: false, warning: `source_png_not_found:${sourcePath}` };
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

function waitForFile(path: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (existsSync(path)) {
      return true;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return false;
}

function safePathSegment(input: string): string {
  return input.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120) || "unknown";
}
