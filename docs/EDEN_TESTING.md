# Eden Testing

1. Build the sidecar:

```bash
cd sidecar
npm run build
```

2. Start the sidecar with a local token:

```bash
ARMA_MCP_TOKEN=dev-token node sidecar/dist/index.js
```

3. Build the addon:

```bash
hemtt build
```

4. Build the extension:

```bash
./scripts/build-extension.sh
```

5. Make `ArmaMCP_x64.dll` available to Arma under Proton/Windows and ensure the Arma process can see:

```bash
ARMA_MCP_TOKEN=dev-token
ARMA_MCP_HOST=127.0.0.1
ARMA_MCP_PORT=38473
```

6. Launch Arma with the addon loaded, open Eden, place an object or game logic, and select it.

7. In Codex, call:

```text
arma_ping
arma_request_editor_snapshot
arma_get_editor_snapshot
arma_generate_checkpoint_plan
arma_queue_apply_plan
arma_get_bridge_events
```

8. Review the generated plan before queueing it. `arma_queue_apply_plan` rejects `dryRun=true`, so set `dryRun=false` only after review.

9. Confirm Eden creates objects around the selected anchor. Press undo and confirm the operation rolls back if `collect3DENHistory` grouped the changes successfully.

The addon also attempts throttled selection snapshots via `OnSelectionChange`.
