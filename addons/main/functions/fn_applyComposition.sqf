params [
    ["_params", createHashMap]
];

private _composition = _params getOrDefault ["composition", createHashMap];
private _anchor = _params getOrDefault ["anchor", createHashMap];
private _anchorPos = _anchor getOrDefault ["positionATL", [0, 0, 0]];
private _anchorDir = _anchor getOrDefault ["dir", 0];
private _layer = _params getOrDefault ["layer", ""];
private _operations = [];
private _sin = sin _anchorDir;
private _cos = cos _anchorDir;

{
    private _transform = _x getOrDefault ["transform", createHashMap];
    private _offset = _transform getOrDefault ["positionATL", [0, 0, 0]];
    private _worldPos = [
        (_anchorPos select 0) + ((_offset select 0) * _cos) - ((_offset select 1) * _sin),
        (_anchorPos select 1) + ((_offset select 0) * _sin) + ((_offset select 1) * _cos),
        (_anchorPos select 2) + (_offset select 2)
    ];
    private _op = createHashMapFromArray [
        ["op", "create_entity"],
        ["clientRef", _x getOrDefault ["clientRef", format ["composition_%1", _forEachIndex + 1]]],
        ["type", _x getOrDefault ["type", "Object"]],
        ["className", _x getOrDefault ["className", ""]],
        ["transform", createHashMapFromArray [
            ["positionATL", _worldPos],
            ["dir", (_transform getOrDefault ["dir", 0]) + _anchorDir]
        ]],
        ["attributes", _x getOrDefault ["attributes", createHashMap]]
    ];
    if (_layer isNotEqualTo "") then {
        _op set ["layer", _layer];
    };
    _operations pushBack _op;
} forEach (_composition getOrDefault ["entities", []]);

{
    private _from = _x getOrDefault ["from", ""];
    private _to = _x getOrDefault ["to", ""];
    if (_from isNotEqualTo "" && {_to isNotEqualTo ""}) then {
        _operations pushBack createHashMapFromArray [
            ["op", "sync_entities"],
            ["clientRef", format ["connection_%1", _forEachIndex + 1]],
            ["connectionType", _x getOrDefault ["type", "Sync"]],
            ["entityIds", [_from]],
            ["targetEntityId", _to],
            ["deferClientRefs", true]
        ];
    };
} forEach (_composition getOrDefault ["connections", []]);

if (_params getOrDefault ["dryRun", true]) exitWith {
    private _entityCounts = createHashMap;
    {
        private _type = _x getOrDefault ["type", "Object"];
        _entityCounts set [_type, (_entityCounts getOrDefault [_type, 0]) + 1];
    } forEach (_composition getOrDefault ["entities", []]);
    createHashMapFromArray [
        ["dryRun", true],
        ["operationCount", count _operations],
        ["wouldCreate", count (_composition getOrDefault ["entities", []])],
        ["wouldConnect", count (_composition getOrDefault ["connections", []])],
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
{
    private _clientRef = _x getOrDefault ["clientRef", ""];
    private _edenId = _x getOrDefault ["edenId", ""];
    if (_clientRef isNotEqualTo "" && {_edenId isNotEqualTo ""}) then {
        _refToEdenId set [_clientRef, _edenId];
    };
} forEach (_result getOrDefault ["created", []]);

private _relationshipUpdated = [];
private _relationshipMissing = [];
private _warnings = _result getOrDefault ["warnings", []];
{
    private _sourceRef = _x getOrDefault ["from", ""];
    private _targetRef = _x getOrDefault ["to", ""];
    private _sourceId = _refToEdenId getOrDefault [_sourceRef, ""];
    private _targetId = _refToEdenId getOrDefault [_targetRef, ""];
    if (_sourceId isEqualTo "" || {_targetId isEqualTo ""}) then {
        _relationshipMissing pushBack _x;
    } else {
        private _connectionResult = ["sync", createHashMapFromArray [
            ["dryRun", false],
            ["connectionType", _x getOrDefault ["type", "Sync"]],
            ["entityIds", [_sourceId]],
            ["targetEntityId", _targetId]
        ]] call AMCP_fnc_connectionOps;
        _relationshipUpdated append (_connectionResult getOrDefault ["updated", []]);
        _warnings append (_connectionResult getOrDefault ["warnings", []]);
    };
} forEach (_composition getOrDefault ["connections", []]);

_result set ["relationships", createHashMapFromArray [
    ["updated", _relationshipUpdated],
    ["missing", _relationshipMissing]
]];
_result set ["warnings", _warnings];
_result
