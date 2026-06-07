# Eden MCP Actions

The Eden action suite exposes typed tools instead of raw SQF execution.

## Health

- `arma.ping`
- `arma.bridge.get_status`
- `arma.bridge.ping`
- `arma.bridge.get_capabilities`
- `arma_get_bridge_events`

## Read Tools

- `arma.eden.get_status`
- `arma.eden.get_selection`
- `arma.eden.list_entities`
- `arma.eden.find_entities`
- `arma.eden.get_entity_snapshot`
- `arma.eden.get_entities`
- `arma.eden.get_entity_attributes`
- `arma.assets.search_classes`
- `arma.terrain.sample_area`

Entity IDs are session-local bridge IDs. They are refreshed as entities are read and are not durable mission identifiers.

## Write Tools

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

Write tools default to dry-run where mutation is possible. Destructive operations require:

```json
{
  "confirmation": {
    "confirmed": true,
    "reason": "reviewed dry-run result"
  }
}
```

Attribute writes are allowlisted. Sensitive scripting fields such as `init`, trigger statements, and waypoint statements are scanned for risky patterns and require confirmation when risky text is present.

## Composition And Generators

- `arma.eden.capture_composition`
- `arma.eden.apply_composition`
- `arma.eden.generate_road_checkpoint`
- `arma.eden.generate_small_outpost`
- `arma.eden.generate_aa_site`
- `arma.eden.generate_lz`
- `arma.eden.generate_cover_line`
- `arma.eden.generate_prop_wall`

Generators return dry-run `arma.eden.batch` plans and do not mutate Eden directly. Apply reviewed plans with `arma.eden.batch`.

## Unsupported Or Best Effort

- Layer creation and assignment are represented in plans but depend on Eden command support and still need a full in-game smoke pass.
- Sync/group connection helpers are reserved in the protocol but are not fully implemented yet.
- Collision and road-aware placement validation are not implemented.
- Class search scans `CfgVehicles` at runtime and is intentionally simple until an asset index exists.
- Terrain sampling provides height, water state, and approximate slope only.
