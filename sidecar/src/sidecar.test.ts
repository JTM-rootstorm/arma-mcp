import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateCheckpointPlan } from "./checkpointPlanner.js";
import {
  closeCatalogDb,
  ensureCatalogSchema,
  getCatalogClass,
  getLatestScanManifest,
  listCatalogCategories,
  listCatalogFactions,
  openCatalogDb,
  searchCatalogClasses,
  upsertCatalogClass,
  upsertClassTags,
  updateFtsIndex,
  writeScanManifest
} from "./catalogDb.js";
import { generateAaSite, generateCoverLine, generateLz, generatePropWall, generateRoadCheckpoint, generateSmallOutpost } from "./generators.js";
import { startHttpBridge, type StartedBridge } from "./httpBridge.js";
import { logger } from "./log.js";
import { compositionPlanSchema } from "./schema.js";
import { createState } from "./state.js";
import { actionPacketSchema, schemaVersion } from "./protocol.js";
import { enforceToolPolicy } from "./policy.js";

const bridges: StartedBridge[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (bridges.length > 0) {
    await bridges.pop()?.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("catalog database", () => {
  function tempCatalogPath() {
    const dir = mkdtempSync(join(tmpdir(), "arma-mcp-catalog-"));
    tempDirs.push(dir);
    return join(dir, ".mcp-cache", "arma", "catalog.sqlite");
  }

  it("creates the schema idempotently and stores catalog rows", () => {
    const catalog = openCatalogDb(tempCatalogPath());
    try {
      ensureCatalogSchema(catalog);
      ensureCatalogSchema(catalog);

      const tables = catalog.db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name")
        .all()
        .map((row) => String((row as { name: string }).name));
      expect(tables).toContain("classes");
      expect(tables).toContain("classes_fts");
      expect(tables).toContain("class_screenshots");
      expect(tables).toContain("class_visual_tags");

      writeScanManifest(catalog, {
        scanId: "scan_test",
        loadedModsHash: "mods",
        loadedAddonsHash: "addons",
        classCounts: { CfgVehicles: 1 },
        status: "complete",
        finishedAt: "2026-06-07T00:00:00.000Z"
      });

      upsertCatalogClass(catalog, {
        className: "Land_Republic_Terminal_F",
        latestScanId: "scan_test",
        configPath: "CfgVehicles",
        displayName: "Republic Terminal",
        kind: "prop",
        subkind: "terminal",
        editorCategory: "EdCat_Structures",
        editorSubcategory: "EdSubcat_Electronics",
        faction: "BLU_F",
        modelPath: "\\a3\\props_f\\terminal.p3d",
        tags: ["terminal", "republic"],
        rawConfig: { scope: 2 }
      });
      upsertClassTags(catalog, "Land_Republic_Terminal_F", [
        { tag: "terminal", confidence: 0.9 },
        { tag: "console", source: "heuristic", confidence: 0.75 }
      ]);
      updateFtsIndex(catalog, "Land_Republic_Terminal_F");

      const manifest = getLatestScanManifest(catalog);
      expect(manifest).toMatchObject({ scanId: "scan_test", status: "complete" });
      const matches = catalog.db
        .prepare(
          `SELECT classes.class_name AS className, classes.display_name AS displayName
           FROM classes_fts
           JOIN classes ON classes.rowid = classes_fts.rowid
           WHERE classes_fts MATCH ?
           LIMIT 10`
        )
        .all("terminal");
      expect(matches).toMatchObject([{ className: "Land_Republic_Terminal_F", displayName: "Republic Terminal" }]);
      expect(searchCatalogClasses(catalog, { query: "terminal", kind: "prop", tags: ["console"] })).toMatchObject([
        {
          class_name: "Land_Republic_Terminal_F",
          display_name: "Republic Terminal",
          kind: "prop",
          subkind: "terminal"
        }
      ]);
      expect(getCatalogClass(catalog, "Land_Republic_Terminal_F")).toMatchObject({
        class_name: "Land_Republic_Terminal_F",
        display_name: "Republic Terminal",
        raw_config: { scope: 2 }
      });
      expect(listCatalogFactions(catalog)).toMatchObject([{ faction: "BLU_F", count: 1 }]);
      expect(listCatalogCategories(catalog)).toMatchObject([
        { editorCategory: "EdCat_Structures", editorSubcategory: "EdSubcat_Electronics", count: 1 }
      ]);
    } finally {
      closeCatalogDb(catalog);
    }
  });
});

describe("sidecar state", () => {
  it("returns ping-like status fields", () => {
    const state = createState();
    expect(state.pendingCommandCount()).toBe(0);
    expect(state.getLastSnapshot()).toBeNull();
  });

  it("queues requestSnapshot commands", () => {
    const state = createState();
    const command = state.queueSnapshotRequest("selection");
    expect(command.type).toBe("requestSnapshot");
    expect(state.pendingCommandCount()).toBe(1);
    expect(state.drainCommands()).toHaveLength(1);
  });

  it("stores snapshots", () => {
    const state = createState();
    const snapshot = state.storeSnapshot({
      id: "snap_test",
      createdAt: "2026-06-07T00:00:00.000Z",
      source: "eden",
      selected: [
        {
          className: "Land_HBarrier_1_F",
          positionATL: [1, 2, 0],
          direction: 90
        }
      ]
    });
    expect(snapshot.id).toBe("snap_test");
    expect(state.getLastSnapshot()?.selected[0]?.className).toBe("Land_HBarrier_1_F");
  });

  it("validates typed action packets", () => {
    expect(() =>
      actionPacketSchema.parse({
        schemaVersion,
        requestId: "req_test",
        action: "eden.get_status",
        mode: "read",
        params: {}
      })
    ).not.toThrow();
    expect(() =>
      actionPacketSchema.parse({
        schemaVersion,
        requestId: "",
        action: "eden.get_status",
        mode: "read",
        params: {}
      })
    ).toThrow();
    expect(() =>
      actionPacketSchema.parse({
        schemaVersion,
        requestId: "req_test",
        action: "eden.run_raw_sqf",
        mode: "debug",
        params: {}
      })
    ).toThrow();
  });

  it("correlates typed action results by requestId", async () => {
    const state = createState();
    const queued = state.queueAction({ action: "eden.get_status", mode: "read" });
    const [command] = state.drainCommands();
    expect(command).toMatchObject({ requestId: queued.action.requestId, action: "eden.get_status" });
    state.completeActionResult({
      schemaVersion,
      requestId: queued.action.requestId,
      ok: true,
      action: "eden.get_status",
      result: { edenOpen: true },
      warnings: []
    });
    await expect(queued.result).resolves.toMatchObject({
      requestId: queued.action.requestId,
      ok: true,
      result: { edenOpen: true }
    });
  });

  it("times out pending actions cleanly", async () => {
    const state = createState(200, 5);
    const queued = state.queueAction({ action: "eden.get_status", mode: "read" });
    await expect(queued.result).rejects.toThrow(/Timed out waiting/);
    expect(state.pendingActionCount()).toBe(0);
  });
});

describe("checkpoint planner", () => {
  it("generates valid operations", () => {
    const { plan } = generateCheckpointPlan({
      prompt: "small CIS checkpoint",
      radiusMeters: 25,
      factionStyle: "cis",
      density: "low"
    });
    expect(() => compositionPlanSchema.parse(plan)).not.toThrow();
    expect(plan.dryRun).toBe(true);
    expect(plan.operations.length).toBeGreaterThan(0);
  });

  it("rejects unsupported operations through schema", () => {
    const { plan } = generateCheckpointPlan({
      prompt: "small checkpoint",
      radiusMeters: 25,
      factionStyle: "generic",
      density: "low"
    });
    expect(() =>
      compositionPlanSchema.parse({
        ...plan,
        dryRun: false,
        operations: [{ type: "deleteObject", id: "bad" }]
      })
    ).toThrow();
  });
});

describe("write policy", () => {
  it("requires confirmation for destructive non-dry-run deletes", () => {
    expect(() =>
      enforceToolPolicy({
        action: "eden.delete_entities",
        dryRun: false
      })
    ).toThrow(/confirmation/);
    expect(() =>
      enforceToolPolicy({
        action: "eden.delete_entities",
        dryRun: false,
        confirmation: { confirmed: true, reason: "remove failed preview" }
      })
    ).not.toThrow();
  });

  it("rejects non-allowlisted write attributes", () => {
    expect(() =>
      enforceToolPolicy({
        action: "eden.set_entity_attributes",
        dryRun: true,
        attributes: { arbitraryCodeField: "nope" }
      })
    ).toThrow(/not allowlisted/);
  });

  it("requires confirmation for risky init writes", () => {
    expect(() =>
      enforceToolPolicy({
        action: "eden.set_entity_attributes",
        dryRun: false,
        attributes: { init: "this callExtension 'x';" }
      })
    ).toThrow(/risky/);
    expect(
      enforceToolPolicy({
        action: "eden.set_entity_attributes",
        dryRun: true,
        attributes: { init: "this callExtension 'x';" }
      }).warnings
    ).toHaveLength(1);
  });
});

describe("procedural generators", () => {
  const generators = [
    generateRoadCheckpoint({ anchor: { positionATL: [100, 200, 0], dir: 90 }, factionTheme: "CIS" }),
    generateSmallOutpost({ anchor: { positionATL: [0, 0, 0], dir: 0 }, factionTheme: "CIS" }),
    generateAaSite({ anchor: { positionATL: [0, 0, 0], dir: 0 } }),
    generateLz({ anchor: { positionATL: [0, 0, 0], dir: 0 } }),
    generateCoverLine({ anchor: { positionATL: [0, 0, 0], dir: 0 } }),
    generatePropWall({ anchor: { positionATL: [0, 0, 0], dir: 0 } })
  ];

  it("returns dry-run batch plans with client refs and layers", () => {
    for (const generated of generators) {
      expect(generated.plan.dryRun).toBe(true);
      expect(generated.plan.operations.length).toBeGreaterThan(0);
      expect(generated.plan.operations.every((operation) => operation.clientRef)).toBe(true);
      expect(generated.plan.operations.every((operation) => operation.layer)).toBe(true);
      expect(generated.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe("HTTP bridge auth", () => {
  it("rejects invalid token", async () => {
    const state = createState();
    const bridge = await startHttpBridge(state, logger, {
      host: "127.0.0.1",
      port: 0,
      token: "test-token",
      generatedToken: false
    });
    bridges.push(bridge);

    const response = await fetch(`${bridge.url}/bridge/commands`, {
      headers: { authorization: "Bearer nope" }
    });
    expect(response.status).toBe(401);
  });

  it("accepts valid token", async () => {
    const state = createState();
    state.queueSnapshotRequest("selection");
    const bridge = await startHttpBridge(state, logger, {
      host: "127.0.0.1",
      port: 0,
      token: "test-token",
      generatedToken: false
    });
    bridges.push(bridge);

    const response = await fetch(`${bridge.url}/bridge/commands`, {
      headers: { authorization: "Bearer test-token" }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { commands: unknown[] };
    expect(body.commands).toHaveLength(1);
  });

  it("stores posted snapshots", async () => {
    const state = createState();
    const bridge = await startHttpBridge(state, logger, {
      host: "127.0.0.1",
      port: 0,
      token: "test-token",
      generatedToken: false
    });
    bridges.push(bridge);

    const response = await fetch(`${bridge.url}/bridge/snapshot`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        source: "eden",
        selected: [{ className: "Land_HBarrier_1_F", positionATL: [0, 0, 0], direction: 0 }]
      })
    });
    expect(response.status).toBe(200);
    expect(state.getLastSnapshot()?.selected).toHaveLength(1);
  });
});
