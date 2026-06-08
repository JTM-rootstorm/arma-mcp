params [
    ["_operation", "get", [""]],
    ["_params", createHashMap]
];

private _dryRun = _params getOrDefault ["dryRun", true];
private _connectionType = _params getOrDefault ["connectionType", "Sync"];

private _isMissingEntity = {
    params ["_entity"];
    _entity isEqualTo objNull
};

private _snapshotConnectionTarget = {
    params ["_target"];
    private _targetType = typeName _target;
    private _targetId = "";
    if (_target isEqualType objNull) then {
        _targetId = [_target, ["Object", "Logic"] select (_target isKindOf "Logic")] call AMCP_fnc_registerEntity;
    } else {
        if (_target isEqualType grpNull) then {
            _targetId = [_target, "Group"] call AMCP_fnc_registerEntity;
        } else {
            if (_target isEqualType []) then {
                private _group = _target param [0, grpNull];
                private _index = _target param [1, -1];
                _targetId = [_target, "Waypoint"] call AMCP_fnc_registerEntity;
                _targetType = "Waypoint";
                createHashMapFromArray [
                    ["edenId", _targetId],
                    ["type", _targetType],
                    ["groupId", if (_group isEqualType grpNull) then {[_group, "Group"] call AMCP_fnc_registerEntity} else {""}],
                    ["waypointIndex", _index]
                ]
            } else {
                _targetId = [_target, "Marker"] call AMCP_fnc_registerEntity;
            };
        };
    };
    createHashMapFromArray [
        ["edenId", _targetId],
        ["type", _targetType]
    ]
};

private _collectConnections = {
    params ["_entityId"];
    private _entity = [_entityId] call AMCP_fnc_resolveEntity;
    if ([_entity] call _isMissingEntity) exitWith {
        createHashMapFromArray [
            ["entityId", _entityId],
            ["missing", true],
            ["connections", []]
        ]
    };
    private _connections = [];
    {
        private _type = _x param [0, ""];
        private _target = _x param [1, objNull];
        if (_connectionType isEqualTo "" || {_type isEqualTo _connectionType}) then {
            _connections pushBack createHashMapFromArray [
                ["type", _type],
                ["to", [_target] call _snapshotConnectionTarget]
            ];
        };
    } forEach (get3DENConnections _entity);
    createHashMapFromArray [
        ["entityId", _entityId],
        ["missing", false],
        ["connections", _connections]
    ]
};

switch (_operation) do {
    case "get": {
        private _ids = _params getOrDefault ["entityIds", []];
        private _singleId = _params getOrDefault ["entityId", ""];
        if ((count _ids) isEqualTo 0 && {_singleId isNotEqualTo ""}) then {
            _ids = [_singleId];
        };
        private _items = _ids apply {[_x] call _collectConnections};
        createHashMapFromArray [
            ["connections", _items]
        ]
    };
    case "getSynced": {
        private _syncParams = +_params;
        _syncParams set ["connectionType", "Sync"];
        ["get", _syncParams] call AMCP_fnc_connectionOps
    };
    case "sync": {
        private _entityIds = _params getOrDefault ["entityIds", []];
        private _targetEntityId = _params getOrDefault ["targetEntityId", ""];
        private _target = [_targetEntityId] call AMCP_fnc_resolveEntity;
        private _missing = [];
        private _sources = [];
        {
            private _entity = [_x] call AMCP_fnc_resolveEntity;
            if ([_entity] call _isMissingEntity) then {
                _missing pushBack _x;
            } else {
                _sources pushBack _entity;
            };
        } forEach _entityIds;
        if ([_target] call _isMissingEntity) then {
            _missing pushBack _targetEntityId;
        };
        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["planned", [createHashMapFromArray [
                    ["op", "sync_entities"],
                    ["connectionType", _connectionType],
                    ["entityIds", _entityIds],
                    ["targetEntityId", _targetEntityId]
                ]]],
                ["missing", _missing]
            ]
        };
        private _ok = false;
        if (_sources isNotEqualTo [] && {!([_target] call _isMissingEntity)}) then {
            _ok = add3DENConnection [_connectionType, _sources, _target];
        };
        createHashMapFromArray [
            ["dryRun", false],
            ["updated", if (_ok) then {_entityIds} else {[]}],
            ["targetEntityId", _targetEntityId],
            ["connectionType", _connectionType],
            ["missing", _missing],
            ["warnings", if (_ok || {(count _sources) isEqualTo 0}) then {[]} else {[format ["Failed to add %1 connection", _connectionType]]}]
        ]
    };
    case "unsync": {
        private _entityIds = _params getOrDefault ["entityIds", []];
        private _targetEntityId = _params getOrDefault ["targetEntityId", ""];
        private _target = [_targetEntityId] call AMCP_fnc_resolveEntity;
        private _missing = [];
        private _sources = [];
        {
            private _entity = [_x] call AMCP_fnc_resolveEntity;
            if ([_entity] call _isMissingEntity) then {
                _missing pushBack _x;
            } else {
                _sources pushBack _entity;
            };
        } forEach _entityIds;
        if ([_target] call _isMissingEntity) then {
            _missing pushBack _targetEntityId;
        };
        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["planned", [createHashMapFromArray [
                    ["op", "unsync_entities"],
                    ["connectionType", _connectionType],
                    ["entityIds", _entityIds],
                    ["targetEntityId", _targetEntityId]
                ]]],
                ["missing", _missing]
            ]
        };
        private _ok = false;
        if (_sources isNotEqualTo [] && {!([_target] call _isMissingEntity)}) then {
            _ok = remove3DENConnection [_connectionType, _sources, _target];
        };
        createHashMapFromArray [
            ["dryRun", false],
            ["updated", if (_ok) then {_entityIds} else {[]}],
            ["targetEntityId", _targetEntityId],
            ["connectionType", _connectionType],
            ["missing", _missing],
            ["warnings", if (_ok || {(count _sources) isEqualTo 0}) then {[]} else {[format ["Failed to remove %1 connection", _connectionType]]}]
        ]
    };
    default {
        createHashMapFromArray [
            ["dryRun", _dryRun],
            ["errors", [createHashMapFromArray [
                ["code", "UNSUPPORTED_OPERATION"],
                ["message", format ["Unsupported connection operation %1", _operation]]
            ]]]
        ]
    };
}
