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
- `arma.eden.get_connections`
- `arma.eden.get_synced`
- `arma.eden.list_layers`
- `arma.assets.search_classes`
- `arma.assets.get_class`
- `arma.terrain.sample_area`
- `arma.terrain.find_flat_area`
- `arma.terrain.find_nearest_roads`
- `arma.spatial.check_collision`
- `arma.spatial.score_placement`
- `arma.spatial.line_of_sight`
- `arma.spatial.find_cover_positions`
- `arma.spatial.find_lz_candidates`

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
- `arma.eden.sync_entities`
- `arma.eden.unsync_entities`
- `arma.eden.create_layer`
- `arma.eden.assign_layer`
- `arma.eden.remove_from_layer`
- `arma.eden.set_layer_attributes`
- `arma.eden.delete_layer`

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

## Implemented With Live-Smoke Caveats

- Layer tools use Eden layer IDs plus a local name registry for created layers. Display-name reads and rich layer attribute edits are limited by the public 3DEN scripting surface.
- Sync tools use Eden `Sync` connections by default and can read/add/remove other 3DEN connection classes when supplied.
- Mixed composition capture/apply preserves copied local sync links by `clientRef`.
- Marker top-level batch fields such as `text`, `markerType`, `color`, `shape`, `size`, and `alpha` are normalized into Eden marker attributes before apply.
- Spatial tools provide structured terrain summaries, flat-area candidates, nearest-road metadata, broad collision warnings, placement scores, LOS checks, cover candidates, and LZ candidates. They are intended to guide dry-run plan review and need live map smoke tests before relying on exact scores.

## Unsupported Or Best Effort

- Collision checks use broad radius heuristics and nearby terrain-object probes, not exact mesh collision.
- Live class search scans common config roots including vehicles, weapons, magazines, ammo, groups, markers, factions, editor categories, and 3DEN config. The catalog database remains the richer indexed source for recommendations, dimensions, screenshots, and tags.
