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

5. Make `ArmaMCP_x64.dll` available to Arma under Proton/Windows and create `ArmaMCP.ini` next to it:

```ini
host=127.0.0.1
port=38473
token=dev-token
```

6. Launch Arma with the addon loaded, open Eden, place an object or game logic, and select it.

7. In Codex, call the health and read tools:

```text
arma.ping
arma.bridge.get_status
arma.bridge.ping
arma.bridge.get_capabilities
arma.eden.get_status
arma.eden.get_selection
arma.eden.list_entities
```

8. With one selected object, run a dry-run create, then a real create:

```text
arma.eden.create_entity
```

Use `dryRun=true` first. When the planned operation looks right, repeat with `dryRun=false`.

9. Read the created object, change its transform, then patch a safe attribute:

```text
arma.eden.get_entity_snapshot
arma.eden.set_entity_transform
arma.eden.set_entity_attributes
```

Use allowlisted attributes such as `name`, `description`, or `init`. Risky init text requires confirmation.

10. Test selection and focus:

```text
arma.eden.set_selection
arma.eden.focus_entities
arma.eden.clear_selection
```

11. Test batch dry-run and apply:

```text
arma.eden.batch
```

Use at least two `create_entity` operations and one `create_marker` operation. The first call should use `dryRun=true`; the second can use `dryRun=false` after review.

12. Test composition capture and apply:

```text
arma.eden.capture_composition
arma.eden.apply_composition
```

Capture a selected set, apply it at a nearby anchor with `dryRun=true`, then apply for real.

13. Test the local procedural generators:

```text
arma.eden.generate_road_checkpoint
arma.eden.generate_small_outpost
arma.eden.generate_aa_site
arma.eden.generate_lz
arma.eden.generate_cover_line
arma.eden.generate_prop_wall
```

Generators return dry-run batch plans only. Review and apply their `plan` through `arma.eden.batch`.

14. Confirm Eden creates objects around the selected or supplied anchor. Press undo and confirm the operation rolls back if `collect3DENHistory` grouped the changes successfully.

The addon also attempts throttled selection snapshots via `OnSelectionChange`.

Compatibility aliases from the MVP are still present:

```text
arma_ping
arma_request_editor_snapshot
arma_get_editor_snapshot
arma_generate_checkpoint_plan
arma_queue_apply_plan
arma_get_bridge_events
```
