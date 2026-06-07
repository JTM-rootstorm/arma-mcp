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
        private _selected = get3DENSelected "object";
        private _entities = _selected apply {[_x, "Object", _params] call AMCP_fnc_buildEntitySnapshot};
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
        if (isNull _entity) then {
            _ok = false;
            _error = [_entityId] call _entityMissing;
        } else {
            private _entityType = "Object";
            if ((_entityId find "eden:marker:") isEqualTo 0) then {_entityType = "Marker"};
            if ((_entityId find "eden:trigger:") isEqualTo 0) then {_entityType = "Trigger"};
            if ((_entityId find "eden:logic:") isEqualTo 0) then {_entityType = "Logic"};
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
            if (isNull _entity) then {
                _missing pushBack _x;
            } else {
                _entities pushBack ([_entity, "Object", _params] call AMCP_fnc_buildEntitySnapshot);
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
        if (isNull _entity) then {
            _ok = false;
            _error = [_entityId] call _entityMissing;
        } else {
            _result = [_entity, "Object", _params getOrDefault ["attributeNames", []]] call AMCP_fnc_readEntityAttributes;
        };
    };
    case "assets.search_classes": {
        _result = [_params] call AMCP_fnc_searchClasses;
    };
    case "terrain.sample_area": {
        _result = [_params] call AMCP_fnc_sampleTerrainArea;
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
        _result = createHashMapFromArray [
            ["scan_id", _params getOrDefault ["scanId", ""]],
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
        if (isNull _entity) then {
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
        if (isNull _entity) then {
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
        if (isNull _entity) then {
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
            {
                private _entity = [_x] call AMCP_fnc_resolveEntity;
                if (isNull _entity) then {
                    _missing pushBack _x;
                } else {
                    _entities pushBack _entity;
                    _deleted pushBack _x;
                };
            } forEach _ids;
            collect3DENHistory {
                delete3DENEntities _entities;
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
            if (isNull _entity) then {
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
            if (isNull _entity) then {
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
