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

private _batch = createHashMapFromArray [
    ["dryRun", _params getOrDefault ["dryRun", true]],
    ["confirmation", _params getOrDefault ["confirmation", createHashMap]],
    ["historyLabel", format ["Arma MCP: Apply %1", _composition getOrDefault ["name", "composition"]]],
    ["operations", _operations],
    ["policyWarnings", _params getOrDefault ["policyWarnings", []]]
];

[_batch] call AMCP_fnc_applyBatch
