# ArmaMCP Tool Reference

ArmaMCP exposes typed MCP tools. Write tools default to reviewable dry-runs where mutation is possible, and destructive operations require explicit confirmation.

## Bridge

- `arma.ping`
- `arma.bridge.get_status`
- `arma.bridge.diagnostics`
- `arma.bridge.ping`
- `arma.bridge.get_capabilities`
- `arma_discovery`
- `arma_call`

## Eden Reads

- `arma.eden.get_status`
- `arma.eden.get_selection`
- `arma.eden.list_entities`
- `arma.eden.find_entities`
- `arma.eden.get_entity_snapshot`
- `arma.eden.get_entities`
- `arma.eden.get_entity_attributes`
- `arma.eden.get_connections`
- `arma.eden.get_synced`
- `arma.eden.list_layers`
- `arma.eden.listSelected`
- `arma.eden.listPlaced`
- `arma.eden.getObject`
- `arma.eden.getSynced`
- `arma.eden.exportSelection`

## Eden Writes

- `arma.eden.create_entity`
- `arma.eden.set_entity_transform`
- `arma.eden.set_entity_attributes`
- `arma.eden.append_init`
- `arma.eden.delete_entities`
- `arma.eden.set_selection`
- `arma.eden.clear_selection`
- `arma.eden.focus_entities`
- `arma.eden.batch`
- `arma.eden.validate_plan`
- `arma.eden.sync_entities`
- `arma.eden.unsync_entities`
- `arma.eden.create_layer`
- `arma.eden.assign_layer`
- `arma.eden.remove_from_layer`
- `arma.eden.set_layer_attributes`
- `arma.eden.delete_layer`

## Composition And Generators

- `arma.eden.capture_composition`
- `arma.eden.apply_composition`
- `arma.composition.plan`
- `arma.composition.previewLocal`
- `arma.composition.exportSqf`
- `arma.composition.exportEdenInstructions`
- `arma.eden.generate_road_checkpoint`
- `arma.eden.generate_small_outpost`
- `arma.eden.generate_aa_site`
- `arma.eden.generate_lz`
- `arma.eden.generate_cover_line`
- `arma.eden.generate_prop_wall`

## Catalog, Assets, Terrain, And Visuals

- `arma.assets.search_classes`
- `arma.assets.get_class`
- `arma.terrain.sample_area`
- `arma.catalog.status`
- `arma.catalog.scan`
- `arma.catalog.scanStart`
- `arma.catalog.scanStatus`
- `arma.catalog.scanPoll`
- `arma.catalog.scanCancel`
- `arma.catalog.scanFinalize`
- `arma.catalog.scanRepair`
- `arma.catalog.search`
- `arma.catalog.getClass`
- `arma.catalog.getTags`
- `arma.catalog.listMods`
- `arma.catalog.listFactions`
- `arma.catalog.listCategories`
- `arma.catalog.measureClass`
- `arma.catalog.measureSearchResults`
- `arma.catalog.measureMissing`
- `arma.catalog.recommend`
- `arma.catalog.findByRole`
- `arma.catalog.findSimilar`
- `arma.catalog.findByDimensions`
- `arma.camera.createPreviewScene`
- `arma.camera.inspectClass`
- `arma.camera.captureClassAngles`
- `arma.camera.captureCurrentView`
- `arma.camera.destroyPreviewScene`
- `arma.visual.inspectClass`
- `arma.visual.getScreenshots`
- `arma.visual.addTag`
- `arma.visual.findByVisualTags`

## Legacy Aliases

- `arma_ping`
- `arma_request_editor_snapshot`
- `arma_get_editor_snapshot`
- `arma_generate_checkpoint_plan`
- `arma_queue_apply_plan`
- `arma_get_bridge_events`
