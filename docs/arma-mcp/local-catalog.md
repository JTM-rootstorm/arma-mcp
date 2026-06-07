# ArmaMCP Local Catalog Cache

ArmaMCP stores loaded Arma catalog data in a local SQLite cache so MCP tools can search classes, enrich Eden objects, and queue later measurement or screenshot work without rescanning every request.

The default cache path is:

```text
.mcp-cache/arma/catalog.sqlite
```

Generated cache files are local artifacts and must not be committed:

```text
.mcp-cache/
*.sqlite
*.sqlite-wal
*.sqlite-shm
```

Screenshot capture output uses:

```text
.mcp-cache/arma/screenshots/
```

The cache may contain class names, loaded addon metadata, generated tags, measurements, and screenshot file paths. It must not contain MCP bearer tokens, private keys, Steam credentials, mission secrets, or any other durable secret material.

Useful inspection commands:

```bash
sqlite3 .mcp-cache/arma/catalog.sqlite ".tables"
sqlite3 .mcp-cache/arma/catalog.sqlite "SELECT COUNT(*) FROM classes;"
sqlite3 .mcp-cache/arma/catalog.sqlite "SELECT class_name, display_name FROM classes_fts WHERE classes_fts MATCH 'terminal' LIMIT 10;"
```

## Agent-Friendly Scans

Large scans should use the job-style MCP tools instead of holding one tool call
open for the whole cache fill:

```text
arma.catalog.scanStart
arma.catalog.scanStatus
arma.catalog.scanPoll
arma.catalog.scanCancel
arma.catalog.scanFinalize
arma.catalog.scanRepair
```

`arma.catalog.scan` is kept as a compatibility alias for starting a background
scan. The scan manifest records per-target progress in `scan_targets`, including
the current target, next chunk index, total records seen, rows ingested, errors,
and final status.

Status values:

```text
pending
running
partial
stale
complete
failed
cancelled
```

If a client timeout leaves a scan behind, use `arma.catalog.scanStatus` first,
then `arma.catalog.scanRepair` to make a stale `running` scan resumable without
deleting the cache. `arma.catalog.scanPoll` advances bounded work and returns
before normal MCP client timeouts.

Catalog search responses include diagnostics with the latest scan status,
relevant target progress, result counts, and a hint when an empty result may
mean the cache is incomplete rather than the asset being unavailable.

By default, `CfgVehicles` ingestion prefers editor-placeable rows and skips
nested helper classes such as hitpoints, damage/effect internals, animation
source internals, and glass fragments. Use `includeRaw=true` on scan start only
when raw full config capture is needed.

The addon captures PNGs with Arma's `screenshot` command, which writes under the
active Arma profile `Screenshots` directory. The sidecar records the profile
relative path returned by Arma and can mirror PNG files into `.mcp-cache` when
this environment variable points to that profile screenshot directory:

```text
ARMA_MCP_SCREENSHOT_SOURCE_DIR=/path/to/Arma 3 - Other Profiles/<profile>/Screenshots
```

Useful tools:

```text
arma.camera.createPreviewScene
arma.camera.captureClassAngles
arma.camera.captureCurrentView
arma.camera.destroyPreviewScene
arma.visual.inspectClass
arma.visual.getScreenshots
arma.visual.addTag
arma.visual.findByVisualTags
```

`arma.visual.inspectClass` creates a temporary local preview object, drives an
internal camera around it, captures requested angles, stores screenshot metadata
in `class_screenshots`, and returns both the Arma profile-relative path and the
local cache path when mirroring succeeds. If mirroring is not configured, the
tool still captures through Arma and returns a `copy_warning` telling the agent
which environment variable is missing.
