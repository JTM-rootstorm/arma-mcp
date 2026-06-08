export type DirectActionMode = "read" | "write" | "destructive" | "debug";
export type DocsCategory =
  | "bridge"
  | "eden-read"
  | "eden-write"
  | "composition"
  | "catalog"
  | "terrain"
  | "spatial"
  | "visual";

export type DirectActionManifestEntry = {
  action: string;
  mode: DirectActionMode;
  publicMcpTool: string | null;
  dryRun: boolean;
  confirmation: "none" | "risky-write" | "required";
  sqfRequired: boolean;
  batchOp?: string;
  docsCategory: DocsCategory;
};

export const DIRECT_BRIDGE_ACTIONS = [
  ["bridge.ping", "read", "arma.bridge.ping", false, "none", "bridge"],
  ["bridge.get_capabilities", "read", "arma.bridge.get_capabilities", false, "none", "bridge"],
  ["eden.get_status", "read", "arma.eden.get_status", false, "none", "eden-read"],
  ["eden.get_selection", "read", "arma.eden.get_selection", false, "none", "eden-read"],
  ["eden.list_entities", "read", "arma.eden.list_entities", false, "none", "eden-read"],
  ["eden.find_entities", "read", "arma.eden.find_entities", false, "none", "eden-read"],
  ["eden.get_entity_snapshot", "read", "arma.eden.get_entity_snapshot", false, "none", "eden-read"],
  ["eden.get_entities", "read", "arma.eden.get_entities", false, "none", "eden-read"],
  ["eden.get_entity_attributes", "read", "arma.eden.get_entity_attributes", false, "none", "eden-read"],
  ["eden.create_entity", "write", "arma.eden.create_entity", true, "risky-write", "eden-write", "create_entity"],
  ["eden.set_entity_transform", "write", "arma.eden.set_entity_transform", true, "none", "eden-write", "set_transform"],
  ["eden.set_entity_attributes", "write", "arma.eden.set_entity_attributes", true, "risky-write", "eden-write", "set_attributes"],
  ["eden.append_init", "write", "arma.eden.append_init", true, "risky-write", "eden-write"],
  ["eden.delete_entities", "destructive", "arma.eden.delete_entities", true, "required", "eden-write", "delete_entity"],
  ["eden.set_selection", "write", "arma.eden.set_selection", false, "none", "eden-write", "select_entities"],
  ["eden.clear_selection", "write", "arma.eden.clear_selection", false, "none", "eden-write"],
  ["eden.focus_entities", "write", "arma.eden.focus_entities", false, "none", "eden-write"],
  ["eden.batch", "write", "arma.eden.batch", true, "risky-write", "eden-write"],
  ["eden.validate_plan", "read", "arma.eden.validate_plan", false, "none", "eden-write"],
  ["eden.capture_composition", "read", "arma.eden.capture_composition", false, "none", "composition"],
  ["eden.apply_composition", "write", "arma.eden.apply_composition", true, "risky-write", "composition"],
  ["eden.get_connections", "read", "arma.eden.get_connections", false, "none", "eden-read"],
  ["eden.get_synced", "read", "arma.eden.get_synced", false, "none", "eden-read"],
  ["eden.sync_entities", "write", "arma.eden.sync_entities", true, "none", "eden-write", "sync_entities"],
  ["eden.unsync_entities", "write", "arma.eden.unsync_entities", true, "none", "eden-write", "unsync_entities"],
  ["eden.list_layers", "read", "arma.eden.list_layers", false, "none", "eden-read"],
  ["eden.create_layer", "write", "arma.eden.create_layer", true, "none", "eden-write", "create_layer"],
  ["eden.assign_layer", "write", "arma.eden.assign_layer", true, "none", "eden-write", "assign_layer"],
  ["eden.remove_from_layer", "write", "arma.eden.remove_from_layer", true, "none", "eden-write", "remove_from_layer"],
  ["eden.set_layer_attributes", "write", "arma.eden.set_layer_attributes", true, "none", "eden-write"],
  ["eden.delete_layer", "destructive", "arma.eden.delete_layer", true, "required", "eden-write"],
  ["terrain.sample_area", "read", "arma.terrain.sample_area", false, "none", "terrain"],
  ["terrain.find_flat_area", "read", "arma.terrain.find_flat_area", false, "none", "terrain"],
  ["terrain.find_nearest_roads", "read", "arma.terrain.find_nearest_roads", false, "none", "terrain"],
  ["spatial.check_collision", "read", "arma.spatial.check_collision", false, "none", "spatial"],
  ["spatial.score_placement", "read", "arma.spatial.score_placement", false, "none", "spatial"],
  ["spatial.line_of_sight", "read", "arma.spatial.line_of_sight", false, "none", "spatial"],
  ["spatial.find_cover_positions", "read", "arma.spatial.find_cover_positions", false, "none", "spatial"],
  ["spatial.find_lz_candidates", "read", "arma.spatial.find_lz_candidates", false, "none", "spatial"],
  ["assets.search_classes", "read", "arma.assets.search_classes", false, "none", "catalog"],
  ["assets.get_class", "read", "arma.assets.get_class", false, "none", "catalog"],
  ["catalog.scanStart", "read", "arma.catalog.scanStart", false, "none", "catalog"],
  ["catalog.scanChunk", "read", null, false, "none", "catalog"],
  ["catalog.scanFinish", "read", null, false, "none", "catalog"],
  ["catalog.measureClass", "read", "arma.catalog.measureClass", false, "none", "catalog"],
  ["camera.createPreviewScene", "write", "arma.camera.createPreviewScene", false, "none", "visual"],
  ["camera.inspectClass", "read", "arma.camera.inspectClass", false, "none", "visual"],
  ["camera.captureClassAngles", "read", "arma.camera.captureClassAngles", false, "none", "visual"],
  ["camera.captureCurrentView", "read", "arma.camera.captureCurrentView", false, "none", "visual"],
  ["camera.destroyPreviewScene", "write", "arma.camera.destroyPreviewScene", false, "none", "visual"]
] as const;

type RawManifestEntry = (typeof DIRECT_BRIDGE_ACTIONS)[number];

export const DIRECT_ACTION_MANIFEST = DIRECT_BRIDGE_ACTIONS.map(
  ([action, mode, publicMcpTool, dryRun, confirmation, docsCategory, batchOp]) =>
    ({
      action,
      mode,
      publicMcpTool,
      dryRun,
      confirmation,
      sqfRequired: true,
      batchOp,
      docsCategory
    }) satisfies DirectActionManifestEntry
);

export const DIRECT_BRIDGE_ACTION_NAMES = DIRECT_BRIDGE_ACTIONS.map((entry) => entry[0]) as [
  RawManifestEntry[0],
  ...RawManifestEntry[0][]
];

export const DIRECT_BRIDGE_ACTION_BY_NAME = new Map(DIRECT_ACTION_MANIFEST.map((entry) => [entry.action, entry]));

export const PUBLIC_DIRECT_MCP_TOOLS = DIRECT_ACTION_MANIFEST.flatMap((entry) =>
  entry.publicMcpTool ? [entry.publicMcpTool] : []
);
