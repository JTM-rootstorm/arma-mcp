params [
    ["_command", createHashMap]
];

private _requestId = _command getOrDefault ["requestId", ""];
private _action = _command getOrDefault ["action", ""];
private _params = _command getOrDefault ["params", createHashMap];
private _startedAt = diag_tickTime;
private _ok = true;
private _result = createHashMap;
private _warnings = [];
private _error = createHashMap;

private _entityMissing = {
    params ["_entityId"];
    createHashMapFromArray [
        ["code", "ENTITY_NOT_FOUND"],
        ["message", format ["No live Eden entity is registered as %1", _entityId]],
        ["details", createHashMapFromArray [["entityId", _entityId]]]
    ]
};
private _isMissingEntity = {
    params ["_entity"];
    _entity isEqualTo objNull
};

switch (_action) do {
    case "bridge.ping": {
        _result = createHashMapFromArray [
            ["ok", true],
            ["eden", is3DEN],
            ["time", time]
        ];
    };
    case "bridge.get_capabilities": {
        _result = [] call AMCP_fnc_getCapabilities;
    };
    case "eden.get_status": {
        _result = [] call AMCP_fnc_edenGetStatus;
    };
    case "eden.get_selection": {
        private _typePairs = [
            ["object", "Object"],
            ["group", "Group"],
            ["trigger", "Trigger"],
            ["logic", "Logic"],
            ["waypoint", "Waypoint"],
            ["marker", "Marker"],
            ["layer", "Layer"]
        ];
        private _entities = [];
        {
            private _edenSelectionType = _x select 0;
            private _entityType = _x select 1;
            {
                _entities pushBack ([_x, _entityType, _params] call AMCP_fnc_buildEntitySnapshot);
            } forEach (get3DENSelected _edenSelectionType);
        } forEach _typePairs;
        _result = createHashMapFromArray [
            ["entities", _entities]
        ];
    };
    case "eden.list_entities": {
        _result = [_params] call AMCP_fnc_edenListEntities;
    };
    case "eden.find_entities": {
        _result = [_params] call AMCP_fnc_edenListEntities;
    };
    case "eden.get_entity_snapshot": {
        private _entityId = _params getOrDefault ["entityId", ""];
        private _entity = [_entityId] call AMCP_fnc_resolveEntity;
        if ([_entity] call _isMissingEntity) then {
            _ok = false;
            _error = [_entityId] call _entityMissing;
        } else {
            private _entityType = "Object";
            if ((_entityId find "eden:marker:") isEqualTo 0) then {_entityType = "Marker"};
            if ((_entityId find "eden:trigger:") isEqualTo 0) then {_entityType = "Trigger"};
            if ((_entityId find "eden:logic:") isEqualTo 0) then {_entityType = "Logic"};
            if ((_entityId find "eden:module:") isEqualTo 0) then {_entityType = "Module"};
            if ((_entityId find "eden:group:") isEqualTo 0) then {_entityType = "Group"};
            if ((_entityId find "eden:waypoint:") isEqualTo 0) then {_entityType = "Waypoint"};
            if ((_entityId find "eden:layer:") isEqualTo 0) then {_entityType = "Layer"};
            _result = createHashMapFromArray [
                ["snapshot", [_entity, _entityType, _params] call AMCP_fnc_buildEntitySnapshot]
            ];
        };
    };
    case "eden.get_entities": {
        private _entityIds = _params getOrDefault ["entityIds", []];
        private _entities = [];
        private _missing = [];
        {
            private _entity = [_x] call AMCP_fnc_resolveEntity;
            if ([_entity] call _isMissingEntity) then {
                _missing pushBack _x;
            } else {
                private _entityType = "Object";
                if ((_x find "eden:marker:") isEqualTo 0) then {_entityType = "Marker"};
                if ((_x find "eden:trigger:") isEqualTo 0) then {_entityType = "Trigger"};
                if ((_x find "eden:logic:") isEqualTo 0) then {_entityType = "Logic"};
                if ((_x find "eden:module:") isEqualTo 0) then {_entityType = "Module"};
                if ((_x find "eden:group:") isEqualTo 0) then {_entityType = "Group"};
                if ((_x find "eden:waypoint:") isEqualTo 0) then {_entityType = "Waypoint"};
                if ((_x find "eden:layer:") isEqualTo 0) then {_entityType = "Layer"};
                _entities pushBack ([_entity, _entityType, _params] call AMCP_fnc_buildEntitySnapshot);
            };
        } forEach _entityIds;
        _result = createHashMapFromArray [
            ["entities", _entities],
            ["missing", _missing]
        ];
    };
    case "eden.get_entity_attributes": {
        private _entityId = _params getOrDefault ["entityId", ""];
        private _entity = [_entityId] call AMCP_fnc_resolveEntity;
        if ([_entity] call _isMissingEntity) then {
            _ok = false;
            _error = [_entityId] call _entityMissing;
        } else {
            private _entityType = "Object";
            if ((_entityId find "eden:marker:") isEqualTo 0) then {_entityType = "Marker"};
            if ((_entityId find "eden:trigger:") isEqualTo 0) then {_entityType = "Trigger"};
            if ((_entityId find "eden:logic:") isEqualTo 0) then {_entityType = "Logic"};
            if ((_entityId find "eden:module:") isEqualTo 0) then {_entityType = "Module"};
            if ((_entityId find "eden:group:") isEqualTo 0) then {_entityType = "Group"};
            if ((_entityId find "eden:waypoint:") isEqualTo 0) then {_entityType = "Waypoint"};
            if ((_entityId find "eden:layer:") isEqualTo 0) then {_entityType = "Layer"};
            _result = [_entity, _entityType, _params getOrDefault ["attributeNames", []]] call AMCP_fnc_readEntityAttributes;
        };
    };
    case "assets.search_classes": {
        _result = [_params] call AMCP_fnc_searchClasses;
    };
    case "assets.get_class": {
        _result = [_params] call AMCP_fnc_getClassDetails;
    };
    case "terrain.sample_area": {
        _result = [_params] call AMCP_fnc_sampleTerrainArea;
    };
    case "terrain.find_flat_area": {
        _result = ["findFlatArea", _params] call AMCP_fnc_spatialOps;
    };
    case "terrain.find_nearest_roads": {
        _result = ["findNearestRoads", _params] call AMCP_fnc_spatialOps;
    };
    case "spatial.check_collision": {
        _result = ["checkCollision", _params] call AMCP_fnc_spatialOps;
    };
    case "spatial.score_placement": {
        _result = ["scorePlacement", _params] call AMCP_fnc_spatialOps;
    };
    case "spatial.line_of_sight": {
        _result = ["lineOfSight", _params] call AMCP_fnc_spatialOps;
    };
    case "spatial.find_cover_positions": {
        _result = ["findCoverPositions", _params] call AMCP_fnc_spatialOps;
    };
    case "spatial.find_lz_candidates": {
        _result = ["findLzCandidates", _params] call AMCP_fnc_spatialOps;
    };
    case "catalog.scanStart": {
        private _targets = _params getOrDefault ["targets", [
            "CfgPatches",
            "CfgVehicles",
            "CfgWeapons",
            "CfgMagazines",
            "CfgAmmo",
            "CfgGroups",
            "CfgFactionClasses",
            "CfgEditorCategories",
            "CfgEditorSubcategories",
            "Cfg3DEN"
        ]];
        private _scanId = _params getOrDefault ["scanId", format ["arma-scan-%1", diag_tickTime]];
        private _addons = ("true" configClasses (configFile >> "CfgPatches")) apply {configName _x};
        missionNamespace setVariable ["AMCP_catalogScanCache", createHashMap];
        _result = createHashMapFromArray [
            ["scan_id", _scanId],
            ["targets", _targets],
            ["chunk_size", _params getOrDefault ["chunkSize", 100]],
            ["game_version", productVersion select 2],
            ["world_name", worldName],
            ["loaded_mods", []],
            ["loaded_addons", _addons]
        ];
    };
    case "catalog.scanChunk": {
        _result = [_params] call AMCP_fnc_scanConfigChunk;
    };
    case "catalog.scanFinish": {
        private _scanId = _params getOrDefault ["scanId", ""];
        private _cache = missionNamespace getVariable ["AMCP_catalogScanCache", createHashMap];
        {
            if ((_x find format ["%1:", _scanId]) == 0) then {
                _cache deleteAt _x;
            };
        } forEach keys _cache;
        missionNamespace setVariable ["AMCP_catalogScanCache", _cache];
        _result = createHashMapFromArray [
            ["scan_id", _scanId],
            ["class_counts", _params getOrDefault ["classCounts", createHashMap]],
            ["finished", true]
        ];
    };
    case "catalog.measureClass": {
        _result = [_params] call AMCP_fnc_measureClass;
    };
    case "camera.createPreviewScene": {
        _result = ["createPreviewScene", _params] call AMCP_fnc_cameraControl;
    };
    case "camera.inspectClass": {
        _result = ["inspectClass", _params] call AMCP_fnc_cameraControl;
    };
    case "camera.captureClassAngles": {
        _result = ["captureClassAngles", _params] call AMCP_fnc_cameraControl;
    };
    case "camera.captureCurrentView": {
        _result = ["captureCurrentView", _params] call AMCP_fnc_cameraControl;
    };
    case "camera.destroyPreviewScene": {
        _result = ["destroyPreviewScene", _params] call AMCP_fnc_cameraControl;
    };
    case "eden.create_entity": {
        _result = [_params] call AMCP_fnc_createEntity;
    };
    case "eden.set_entity_transform": {
        private _entityId = _params getOrDefault ["entityId", ""];
        private _entity = [_entityId] call AMCP_fnc_resolveEntity;
        if ([_entity] call _isMissingEntity) then {
            _ok = false;
            _error = [_entityId] call _entityMissing;
        } else {
            private _previous = createHashMap;
            if (!(_params getOrDefault ["dryRun", true])) then {
                collect3DENHistory {
                    _previous = [_entity, _params getOrDefault ["transform", createHashMap]] call AMCP_fnc_applyTransform;
                };
            };
            _result = createHashMapFromArray [
                ["dryRun", _params getOrDefault ["dryRun", true]],
                ["updated", [_entityId]],
                ["previous", _previous]
            ];
        };
    };
    case "eden.set_entity_attributes": {
        private _entityId = _params getOrDefault ["entityId", ""];
        private _entity = [_entityId] call AMCP_fnc_resolveEntity;
        if ([_entity] call _isMissingEntity) then {
            _ok = false;
            _error = [_entityId] call _entityMissing;
        } else {
            private _attributeResult = createHashMapFromArray [
                ["previous", createHashMap],
                ["updatedAttributes", keys (_params getOrDefault ["attributes", createHashMap])],
                ["warnings", []]
            ];
            if (!(_params getOrDefault ["dryRun", true])) then {
                collect3DENHistory {
                    _attributeResult = [_entity, _params getOrDefault ["attributes", createHashMap]] call AMCP_fnc_applyAttributes;
                };
            };
            _result = createHashMapFromArray [
                ["dryRun", _params getOrDefault ["dryRun", true]],
                ["updated", [_entityId]],
                ["previous", _attributeResult getOrDefault ["previous", createHashMap]],
                ["updatedAttributes", _attributeResult getOrDefault ["updatedAttributes", []]],
                ["warnings", _attributeResult getOrDefault ["warnings", []]]
            ];
        };
    };
    case "eden.append_init": {
        private _entityId = _params getOrDefault ["entityId", ""];
        private _entity = [_entityId] call AMCP_fnc_resolveEntity;
        if ([_entity] call _isMissingEntity) then {
            _ok = false;
            _error = [_entityId] call _entityMissing;
        } else {
            private _previousInit = ((_entity get3DENAttribute "Init") param [0, ""]);
            private _newInit = format ["%1%2%3", _previousInit, _params getOrDefault ["separator", toString [10]], _params getOrDefault ["text", ""]];
            if (!(_params getOrDefault ["dryRun", true])) then {
                collect3DENHistory {
                    _entity set3DENAttribute ["Init", _newInit];
                };
            };
            _result = createHashMapFromArray [
                ["dryRun", _params getOrDefault ["dryRun", true]],
                ["updated", [_entityId]],
                ["previous", createHashMapFromArray [["init", _previousInit]]],
                ["init", _newInit]
            ];
        };
    };
    case "eden.delete_entities": {
        private _ids = _params getOrDefault ["entityIds", []];
        private _deleted = [];
        private _missing = [];
        if (!(_params getOrDefault ["dryRun", true])) then {
            private _entities = [];
            private _groups = [];
            {
                private _entity = [_x] call AMCP_fnc_resolveEntity;
                if ([_entity] call _isMissingEntity) then {
                    _missing pushBack _x;
                } else {
                    if (_entity isEqualType grpNull) then {
                        _entities append (units _entity);
                        _groups pushBack _entity;
                    } else {
                        _entities pushBack _entity;
                    };
                    _deleted pushBack _x;
                };
            } forEach _ids;
            collect3DENHistory {
                if (_entities isNotEqualTo []) then {
                    delete3DENEntities _entities;
                };
                {
                    deleteGroup _x;
                } forEach _groups;
            };
        } else {
            _deleted = _ids;
        };
        _result = createHashMapFromArray [
            ["dryRun", _params getOrDefault ["dryRun", true]],
            ["deleted", _deleted],
            ["missing", _missing]
        ];
    };
    case "eden.set_selection": {
        private _entities = [];
        private _selected = [];
        private _missing = [];
        {
            private _entity = [_x] call AMCP_fnc_resolveEntity;
            if ([_entity] call _isMissingEntity) then {
                _missing pushBack _x;
            } else {
                _entities pushBack _entity;
                _selected pushBack _x;
            };
        } forEach (_params getOrDefault ["entityIds", []]);
        set3DENSelected _entities;
        if (_params getOrDefault ["focus", false]) then {
            do3DENAction "CameraToSelection";
        };
        _result = createHashMapFromArray [
            ["selected", _selected],
            ["missing", _missing]
        ];
    };
    case "eden.clear_selection": {
        set3DENSelected [];
        _result = createHashMapFromArray [["selected", []]];
    };
    case "eden.focus_entities": {
        private _focusParams = +_params;
        _focusParams set ["focus", true];
        _focusParams set ["entityIds", _params getOrDefault ["entityIds", []]];
        private _entities = [];
        private _selected = [];
        private _missing = [];
        {
            private _entity = [_x] call AMCP_fnc_resolveEntity;
            if ([_entity] call _isMissingEntity) then {
                _missing pushBack _x;
            } else {
                _entities pushBack _entity;
                _selected pushBack _x;
            };
        } forEach (_focusParams get "entityIds");
        set3DENSelected _entities;
        do3DENAction "CameraToSelection";
        _result = createHashMapFromArray [
            ["selected", _selected],
            ["missing", _missing]
        ];
    };
    case "eden.batch": {
        _result = [_params] call AMCP_fnc_applyBatch;
    };
    case "eden.validate_plan": {
        private _plan = _params getOrDefault ["plan", createHashMap];
        _result = [_plan] call AMCP_fnc_validateBatch;
    };
    case "eden.capture_composition": {
        _result = [_params] call AMCP_fnc_captureComposition;
    };
    case "eden.apply_composition": {
        _result = [_params] call AMCP_fnc_applyComposition;
    };
    case "eden.get_connections": {
        _result = ["get", _params] call AMCP_fnc_connectionOps;
    };
    case "eden.get_synced": {
        _result = ["getSynced", _params] call AMCP_fnc_connectionOps;
    };
    case "eden.sync_entities": {
        _result = ["sync", _params] call AMCP_fnc_connectionOps;
    };
    case "eden.unsync_entities": {
        _result = ["unsync", _params] call AMCP_fnc_connectionOps;
    };
    case "eden.list_layers": {
        _result = ["list", _params] call AMCP_fnc_layerOps;
    };
    case "eden.create_layer": {
        _result = ["create", _params] call AMCP_fnc_layerOps;
    };
    case "eden.assign_layer": {
        _result = ["assign", _params] call AMCP_fnc_layerOps;
    };
    case "eden.remove_from_layer": {
        _result = ["remove", _params] call AMCP_fnc_layerOps;
    };
    case "eden.set_layer_attributes": {
        _result = ["setAttributes", _params] call AMCP_fnc_layerOps;
    };
    case "eden.delete_layer": {
        _result = ["delete", _params] call AMCP_fnc_layerOps;
    };
    case "eden.create_group": {
        _result = ["createGroup", _params] call AMCP_fnc_groupWaypointOps;
    };
    case "eden.create_unit": {
        _result = ["createUnit", _params] call AMCP_fnc_groupWaypointOps;
    };
    case "eden.list_group_units": {
        _result = ["listGroupUnits", _params] call AMCP_fnc_groupWaypointOps;
    };
    case "eden.assign_unit_to_group": {
        _result = ["assignUnit", _params] call AMCP_fnc_groupWaypointOps;
    };
    case "eden.create_waypoint": {
        _result = ["createWaypoint", _params] call AMCP_fnc_groupWaypointOps;
    };
    case "eden.set_group_attributes": {
        private _groupId = _params getOrDefault ["groupId", _params getOrDefault ["entityId", ""]];
        private _group = [_groupId] call AMCP_fnc_resolveEntity;
        if (!(_group isEqualType grpNull)) then {
            _ok = false;
            _error = [_groupId] call _entityMissing;
        } else {
            private _attributeResult = createHashMapFromArray [
                ["previous", createHashMap],
                ["updatedAttributes", keys (_params getOrDefault ["attributes", createHashMap])],
                ["warnings", []]
            ];
            if (!(_params getOrDefault ["dryRun", true])) then {
                collect3DENHistory {
                    _attributeResult = [_group, _params getOrDefault ["attributes", createHashMap]] call AMCP_fnc_applyAttributes;
                };
            };
            _result = createHashMapFromArray [
                ["dryRun", _params getOrDefault ["dryRun", true]],
                ["updated", [_groupId]],
                ["previous", _attributeResult getOrDefault ["previous", createHashMap]],
                ["updatedAttributes", _attributeResult getOrDefault ["updatedAttributes", []]],
                ["warnings", _attributeResult getOrDefault ["warnings", []]]
            ];
        };
    };
    case "eden.set_waypoint_attributes": {
        _result = ["setWaypointAttributes", _params] call AMCP_fnc_groupWaypointOps;
    };
    case "eden.reorder_waypoints": {
        _result = ["reorderWaypoints", _params] call AMCP_fnc_groupWaypointOps;
    };
    case "eden.attach_waypoint_to_group": {
        _result = ["attachWaypoint", _params] call AMCP_fnc_groupWaypointOps;
    };
    case "eden.delete_waypoint": {
        _result = ["deleteWaypoint", _params] call AMCP_fnc_groupWaypointOps;
    };
    case "eden.get_group_links": {
        _result = ["getGroupLinks", _params] call AMCP_fnc_groupWaypointOps;
    };
    case "eden.get_waypoint_links": {
        _result = ["getWaypointLinks", _params] call AMCP_fnc_groupWaypointOps;
    };
    default {
        _ok = false;
        _error = createHashMapFromArray [
            ["code", "UNSUPPORTED_ACTION"],
            ["message", format ["Unsupported action %1", _action]]
        ];
    };
};

private _durationMs = floor ((diag_tickTime - _startedAt) * 1000);
private _payload = createHashMapFromArray [
    ["schemaVersion", 1],
    ["requestId", _requestId],
    ["ok", _ok],
    ["action", _action],
    ["durationMs", _durationMs],
    ["warnings", _warnings],
    ["audit", createHashMapFromArray [
        ["write", (_command getOrDefault ["mode", "read"]) in ["write", "destructive"]],
        ["dryRun", _command getOrDefault ["dryRun", false]],
        ["confirmed", ((_params getOrDefault ["confirmation", createHashMap]) getOrDefault ["confirmed", false])]
    ]]
];

if (_ok) then {
    _payload set ["result", _result];
} else {
    _payload set ["error", _error];
};

["postResult", toJSON _payload] call AMCP_fnc_callBridge;
_ok
