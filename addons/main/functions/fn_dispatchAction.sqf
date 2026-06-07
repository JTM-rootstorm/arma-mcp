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
        ["write", false],
        ["dryRun", false]
    ]]
];

if (_ok) then {
    _payload set ["result", _result];
} else {
    _payload set ["error", _error];
};

["postResult", toJSON _payload] call AMCP_fnc_callBridge;
_ok
