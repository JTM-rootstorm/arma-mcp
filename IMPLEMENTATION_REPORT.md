# ArmaMCP MVP Implementation Report

Date: 2026-06-07

## Implemented

- Root `AGENTS.md` with project rules, safety defaults, and signed commit requirements.
- TypeScript sidecar with MCP STDIO server and localhost HTTP bridge.
- MCP tools:
  - `arma_ping`
  - `arma_get_editor_snapshot`
  - `arma_request_editor_snapshot`
  - `arma_generate_checkpoint_plan`
  - `arma_queue_apply_plan`
  - `arma_get_bridge_events`
- HTTP bridge endpoints:
  - `GET /health`
  - `POST /bridge/snapshot`
  - `GET /bridge/commands`
  - `POST /bridge/result`
  - `POST /bridge/event`
- In-memory state for snapshots, command queue, results, and events.
- Restrictive zod schemas for snapshots and composition plans.
- Dry-run checkpoint generator using vanilla fallback classnames.
- HEMTT addon skeleton and Eden bridge SQF functions.
- Native `ArmaMCP_x64` C++ extension source, CMake build, and build script.
- Docs for MCP configuration, Eden testing, security, Proton/Linux notes, and known limits.
- Validation script at `scripts/validate.sh`.

## Builds And Checks

Commands run:

```bash
cd sidecar && npm run validate
```

Result: passed when run with local loopback bind permission. The same command built TypeScript and passed 8 Vitest tests. In the restricted sandbox without loopback bind permission, the HTTP tests failed with `listen EPERM: operation not permitted 127.0.0.1`.

```bash
hemtt build
```

Result: passed. HEMTT rapified 1 addon config, compiled 7 SQF files, and built 1 PBO.

```bash
hemtt dev
```

Result: config and SQF compilation succeeded and 1 PBO was built, then deployment failed because the sandbox cannot create `/home/mike/.local/share/Steam/steamapps/common/Arma 3/z`.

```bash
./scripts/build-extension.sh
```

Result: passed. Built `extension/build/ArmaMCP_x64.so` and, because MinGW is available in this environment, `extension/build/ArmaMCP_x64.dll`.

## Codex MCP Local Configuration

Build first:

```bash
cd /home/mike/Documents/Programming/arma-mcp/sidecar
npm run build
```

Example:

```toml
[mcp_servers.arma-mcp]
command = "node"
args = ["/home/mike/Documents/Programming/arma-mcp/sidecar/dist/index.js"]
env = { ARMA_MCP_TOKEN = "replace-with-local-dev-token" }
startup_timeout_sec = 10
tool_timeout_sec = 60
```

CLI form:

```bash
codex mcp add arma-mcp --env ARMA_MCP_TOKEN=replace-with-local-dev-token -- node /home/mike/Documents/Programming/arma-mcp/sidecar/dist/index.js
```

## HEMTT

Build:

```bash
hemtt build
```

Launch/deploy path:

```bash
hemtt dev
```

`hemtt dev` requires a writable local Arma 3 installation path.

## Eden Manual Test

1. Build the sidecar and addon.
2. Set `ARMA_MCP_TOKEN` for the sidecar and put the same token in the local mod's `ArmaMCP.ini`.
3. Place `ArmaMCP_x64.dll` where Arma can load it under Proton/Windows.
4. Start Codex with the MCP sidecar.
5. Open Eden with the addon loaded.
6. Select an object or game logic.
7. Call `arma_request_editor_snapshot`, then `arma_get_editor_snapshot`.
8. Call `arma_generate_checkpoint_plan`.
9. Review the dry-run JSON, set `dryRun=false`, and call `arma_queue_apply_plan`.
10. Call `arma_get_bridge_events` and inspect Eden.
11. Press undo in Eden to verify `collect3DENHistory` grouping.

## Known Gaps

- No in-game Eden smoke test was possible from this environment.
- Marker creation needs live Eden verification.
- The extension reads token/host/port from a local `ArmaMCP.ini` beside the extension, with environment variables as a fallback.
- No asset index or mesh validation exists yet.
- No remote ChatGPT bridge, raw SQF tool, public server control, or destructive editor operations are included.

## Git Proof

Command:

```bash
git status --short --untracked-files=all
```

Output:

```text
?? plans/arma_mcp_codex_mvp_plans/CODEX_COMBINED_PROMPT.md
?? plans/arma_mcp_codex_mvp_plans/MANIFEST.txt
?? plans/arma_mcp_codex_mvp_plans/README.md
?? plans/arma_mcp_codex_mvp_plans/plans/00-CODEX-ONE-SHOT-PROMPT.md
?? plans/arma_mcp_codex_mvp_plans/plans/01-MVP-SCOPE.md
?? plans/arma_mcp_codex_mvp_plans/plans/02-REPO-BOOTSTRAP-GIT-RULES.md
?? plans/arma_mcp_codex_mvp_plans/plans/03-ARCHITECTURE.md
?? plans/arma_mcp_codex_mvp_plans/plans/04-IMPLEMENTATION-TASKS.md
?? plans/arma_mcp_codex_mvp_plans/plans/05-FILE-TREE-AND-CONFIG.md
?? plans/arma_mcp_codex_mvp_plans/plans/06-MCP-SERVER-TOOLS.md
?? plans/arma_mcp_codex_mvp_plans/plans/07-ARMA-ADDON-AND-EXTENSION.md
?? plans/arma_mcp_codex_mvp_plans/plans/08-ASSET-INDEX-OUTPOST-GENERATOR.md
?? plans/arma_mcp_codex_mvp_plans/plans/09-TESTING-AND-ACCEPTANCE.md
?? plans/arma_mcp_codex_mvp_plans/plans/10-SECURITY-PROTON-AND-LIMITS.md
?? plans/arma_mcp_codex_mvp_plans/plans/11-REFERENCE-SOURCES.md
```

Command:

```bash
git check-ignore -v plans || true
git check-ignore -v plans/arma_mcp_codex_mvp_plans/plans/00-CODEX-ONE-SHOT-PROMPT.md || true
```

Output: no output. `plans/` is untracked and not ignored.

Signed commit verification was run with GPG keybox access. Each commit reports a good signature from `JT (Github) <jtm@root-storm.com>` and includes:

```text
Co-authored-by: Codex <codex@openai.com>
```
