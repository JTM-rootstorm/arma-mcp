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
arma.bridge.diagnostics
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

Use at least two `create_entity` operations, one `create_marker` operation with top-level `text`, and one `create_layer` plus `assign_layer` operation. The first call should use `dryRun=true`; the second can use `dryRun=false` after review.

12. Test layers and syncs:

```text
arma.eden.list_layers
arma.eden.create_layer
arma.eden.assign_layer
arma.eden.get_connections
arma.eden.sync_entities
arma.eden.get_synced
arma.eden.unsync_entities
```

Use `dryRun=true` first for writes, then repeat with `dryRun=false` after review.

13. Test terrain and spatial validators:

```text
arma.terrain.sample_area
arma.terrain.find_flat_area
arma.terrain.find_nearest_roads
arma.spatial.score_placement
arma.spatial.check_collision
arma.spatial.line_of_sight
arma.spatial.find_cover_positions
arma.spatial.find_lz_candidates
```

Try one open flat VR position, one water/steep terrain position if available, and one position near placed objects.

14. Test dedicated authoring wrappers:

```text
arma.eden.create_marker
arma.eden.set_marker_text
arma.eden.set_marker_color
arma.eden.delete_marker
arma.eden.create_trigger
arma.eden.set_trigger_area
arma.eden.set_trigger_activation
arma.eden.set_trigger_statements
arma.eden.create_module
arma.eden.read_module_args
arma.eden.set_module_args
arma.eden.sync_module
```

Use `dryRun=true` first. Risky trigger statements should require confirmation before a real write.

15. Test composition capture and apply:

```text
arma.eden.capture_composition
arma.eden.apply_composition
```

Capture a mixed selected set. Include two synced entities if possible and call capture with `includeConnections=true`. Apply it at a nearby anchor with `dryRun=true`, then apply for real.

16. Test the local procedural generators:

```text
arma.eden.generate_road_checkpoint
arma.eden.generate_small_outpost
arma.eden.generate_aa_site
arma.eden.generate_lz
arma.eden.generate_cover_line
arma.eden.generate_prop_wall
```

Generators return dry-run batch plans only. Review and apply their `plan` through `arma.eden.batch`.

17. Confirm Eden creates objects around the selected or supplied anchor. Press undo and confirm the operation rolls back if `collect3DENHistory` grouped the changes successfully.

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
