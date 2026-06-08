params [
    ["_params", createHashMap]
];

private _composition = _params getOrDefault ["composition", createHashMap];
private _anchor = _params getOrDefault ["anchor", createHashMap];
private _anchorPos = _anchor getOrDefault ["positionATL", [0, 0, 0]];
private _anchorDir = _anchor getOrDefault ["dir", 0];
private _layer = _params getOrDefault ["layer", ""];
private _entities = _composition getOrDefault ["entities", []];
private _groupLinks = _composition getOrDefault ["groupLinks", []];
private _waypointLinks = _composition getOrDefault ["waypointLinks", []];
private _connections = _composition getOrDefault ["connections", []];
private _operations = [];
private _entityByRef = createHashMap;
private _groupRefsWithUnits = createHashMap;
private _sin = sin _anchorDir;
private _cos = cos _anchorDir;

private _worldTransform = {
    params ["_entitySpec"];
    private _transform = _entitySpec getOrDefault ["transform", _entitySpec getOrDefault ["relativeTransform", createHashMap]];
    private _offset = _transform getOrDefault ["positionATL", [0, 0, 0]];
    private _worldPos = [
        (_anchorPos select 0) + ((_offset select 0) * _cos) - ((_offset select 1) * _sin),
        (_anchorPos select 1) + ((_offset select 0) * _sin) + ((_offset select 1) * _cos),
        (_anchorPos select 2) + (_offset select 2)
    ];
    createHashMapFromArray [
        ["positionATL", _worldPos],
        ["dir", (_transform getOrDefault ["dir", 0]) + _anchorDir]
    ]
};

{
    private _groupRef = _x getOrDefault ["groupRef", _x getOrDefault ["group", ""]];
    if (_groupRef isNotEqualTo "") then {
        _groupRefsWithUnits set [_groupRef, true];
    };
} forEach _groupLinks;

{
    private _clientRef = _x getOrDefault ["clientRef", format ["composition_%1", _forEachIndex + 1]];
    private _type = _x getOrDefault ["type", "Object"];
    _entityByRef set [_clientRef, _x];

    if (_type isNotEqualTo "Waypoint") then {
        if (_type isEqualTo "Group") then {
            if (isNil {_groupRefsWithUnits get _clientRef}) then {
                private _attributes = _x getOrDefault ["attributes", createHashMap];
                _operations pushBack createHashMapFromArray [
                    ["op", "create_group"],
                    ["clientRef", _clientRef],
                    ["side", _attributes getOrDefault ["side", "WEST"]],
                    ["callsign", _x getOrDefault ["displayName", _x getOrDefault ["variableName", ""]]],
                    ["groupAttributes", _attributes],
                    ["transform", [_x] call _worldTransform]
                ];
            };
        } else {
            private _op = createHashMapFromArray [
                ["op", "create_entity"],
                ["clientRef", _clientRef],
                ["type", _type],
                ["className", _x getOrDefault ["className", ""]],
                ["transform", [_x] call _worldTransform],
                ["attributes", _x getOrDefault ["attributes", createHashMap]]
            ];
            if (_layer isNotEqualTo "") then {
                _op set ["layer", _layer];
            };
            _operations pushBack _op;
        };
    };
} forEach _entities;

{
    private _waypointRef = _x getOrDefault ["waypointRef", _x getOrDefault ["waypoint", ""]];
    private _groupRef = _x getOrDefault ["groupRef", _x getOrDefault ["group", ""]];
    private _waypointSpec = _entityByRef getOrDefault [_waypointRef, createHashMap];
    if ((count _waypointSpec) > 0 && {_groupRef isNotEqualTo ""}) then {
        _operations pushBack createHashMapFromArray [
            ["op", "create_waypoint"],
            ["clientRef", _waypointRef],
            ["groupId", _groupRef],
            ["className", _waypointSpec getOrDefault ["className", _x getOrDefault ["type", "MOVE"]]],
            ["transform", [_waypointSpec] call _worldTransform],
            ["attributes", _waypointSpec getOrDefault ["attributes", createHashMap]],
            ["deferClientRefs", true]
        ];
    };
} forEach _waypointLinks;

{
    private _from = _x getOrDefault ["fromRef", _x getOrDefault ["from", ""]];
    private _to = _x getOrDefault ["toRef", _x getOrDefault ["to", ""]];
    if (_from isNotEqualTo "" && {_to isNotEqualTo ""}) then {
        _operations pushBack createHashMapFromArray [
            ["op", "sync_entities"],
            ["clientRef", format ["connection_%1", _forEachIndex + 1]],
            ["connectionType", _x getOrDefault ["kind", _x getOrDefault ["type", "Sync"]]],
            ["entityIds", [_from]],
            ["targetEntityId", _to],
            ["deferClientRefs", true]
        ];
    };
} forEach _connections;

if (_params getOrDefault ["dryRun", true]) exitWith {
    private _entityCounts = createHashMap;
    {
        private _type = _x getOrDefault ["type", "Object"];
        _entityCounts set [_type, (_entityCounts getOrDefault [_type, 0]) + 1];
    } forEach _entities;
    createHashMapFromArray [
        ["dryRun", true],
        ["operationCount", count _operations],
        ["wouldCreate", count _entities],
        ["wouldCreateGroups", {_x getOrDefault ["type", "Object"] isEqualTo "Group"} count _entities],
        ["wouldCreateWaypoints", count _waypointLinks],
        ["wouldConnect", count _connections],
        ["wouldAssignGroups", count _groupLinks],
        ["entityCounts", _entityCounts],
        ["operations", _operations],
        ["warnings", []],
        ["errors", []]
    ]
};

private _batch = createHashMapFromArray [
    ["dryRun", false],
    ["confirmation", _params getOrDefault ["confirmation", createHashMap]],
    ["historyLabel", format ["Arma MCP: Apply %1", _composition getOrDefault ["name", "composition"]]],
    ["operations", _operations select {!(_x getOrDefault ["deferClientRefs", false])}],
    ["policyWarnings", _params getOrDefault ["policyWarnings", []]]
];

private _result = [_batch] call AMCP_fnc_applyBatch;
private _refToEdenId = createHashMap;
private _refToCreated = createHashMap;
{
    private _clientRef = _x getOrDefault ["clientRef", ""];
    private _edenId = _x getOrDefault ["edenId", ""];
    if (_clientRef isNotEqualTo "" && {_edenId isNotEqualTo ""}) then {
        _refToEdenId set [_clientRef, _edenId];
        _refToCreated set [_clientRef, _x];
    };
} forEach (_result getOrDefault ["created", []]);

private _relationshipUpdated = [];
private _relationshipMissing = [];
private _relationshipCreated = [];
private _warnings = _result getOrDefault ["warnings", []];

{
    private _groupRef = _x getOrDefault ["groupRef", _x getOrDefault ["group", ""]];
    private _unitRef = _x getOrDefault ["unitRef", _x getOrDefault ["unit", ""]];
    private _groupId = _refToEdenId getOrDefault [_groupRef, ""];
    private _unitRecord = _refToCreated getOrDefault [_unitRef, createHashMap];
    if (_groupId isEqualTo "") then {
        _groupId = _unitRecord getOrDefault ["groupId", ""];
        if (_groupId isNotEqualTo "") then {
            _refToEdenId set [_groupRef, _groupId];
        };
    };
} forEach _groupLinks;

{
    private _groupRef = _x getOrDefault ["groupRef", _x getOrDefault ["group", ""]];
    private _unitRef = _x getOrDefault ["unitRef", _x getOrDefault ["unit", ""]];
    private _groupId = _refToEdenId getOrDefault [_groupRef, ""];
    private _unitId = _refToEdenId getOrDefault [_unitRef, ""];
    if (_groupId isEqualTo "" || {_unitId isEqualTo ""}) then {
        _relationshipMissing pushBack _x;
    } else {
        private _groupResult = ["assignUnit", createHashMapFromArray [
            ["dryRun", false],
            ["unitId", _unitId],
            ["groupId", _groupId]
        ]] call AMCP_fnc_groupWaypointOps;
        _relationshipUpdated append (_groupResult getOrDefault ["updated", []]);
        _warnings append (_groupResult getOrDefault ["warnings", []]);
    };
} forEach _groupLinks;

{
    private _waypointRef = _x getOrDefault ["waypointRef", _x getOrDefault ["waypoint", ""]];
    private _groupRef = _x getOrDefault ["groupRef", _x getOrDefault ["group", ""]];
    private _groupId = _refToEdenId getOrDefault [_groupRef, ""];
    private _waypointSpec = _entityByRef getOrDefault [_waypointRef, createHashMap];
    if (_groupId isEqualTo "" || {(count _waypointSpec) isEqualTo 0}) then {
        _relationshipMissing pushBack _x;
    } else {
        private _waypointResult = ["createWaypoint", createHashMapFromArray [
            ["dryRun", false],
            ["groupId", _groupId],
            ["className", _waypointSpec getOrDefault ["className", _x getOrDefault ["type", "MOVE"]]],
            ["transform", [_waypointSpec] call _worldTransform],
            ["attributes", _waypointSpec getOrDefault ["attributes", createHashMap]]
        ]] call AMCP_fnc_groupWaypointOps;
        {
            _x set ["clientRef", _waypointRef];
            _relationshipCreated pushBack _x;
            private _edenId = _x getOrDefault ["edenId", ""];
            if (_edenId isNotEqualTo "") then {
                _refToEdenId set [_waypointRef, _edenId];
            };
        } forEach (_waypointResult getOrDefault ["created", []]);
        _warnings append (_waypointResult getOrDefault ["warnings", []]);
    };
} forEach _waypointLinks;

{
    private _sourceRef = _x getOrDefault ["fromRef", _x getOrDefault ["from", ""]];
    private _targetRef = _x getOrDefault ["toRef", _x getOrDefault ["to", ""]];
    private _sourceId = _refToEdenId getOrDefault [_sourceRef, ""];
    private _targetId = _refToEdenId getOrDefault [_targetRef, ""];
    if (_sourceId isEqualTo "" || {_targetId isEqualTo ""}) then {
        _relationshipMissing pushBack _x;
    } else {
        private _connectionResult = ["sync", createHashMapFromArray [
            ["dryRun", false],
            ["connectionType", _x getOrDefault ["kind", _x getOrDefault ["type", "Sync"]]],
            ["entityIds", [_sourceId]],
            ["targetEntityId", _targetId]
        ]] call AMCP_fnc_connectionOps;
        _relationshipUpdated append (_connectionResult getOrDefault ["updated", []]);
        _warnings append (_connectionResult getOrDefault ["warnings", []]);
    };
} forEach _connections;

_result set ["created", (_result getOrDefault ["created", []]) + _relationshipCreated];
_result set ["relationships", createHashMapFromArray [
    ["updated", _relationshipUpdated],
    ["created", _relationshipCreated],
    ["missing", _relationshipMissing]
]];
_result set ["warnings", _warnings];
_result
