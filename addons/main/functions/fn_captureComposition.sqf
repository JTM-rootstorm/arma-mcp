params [
    ["_params", createHashMap]
];

private _selected = get3DENSelected "object";
private _name = _params getOrDefault ["name", "captured-selection"];
private _includeAttributes = _params getOrDefault ["includeAttributes", true];
private _anchorPos = [0, 0, 0];

if ((count _selected) > 0) then {
    {
        private _pos = getPosATL _x;
        _anchorPos = [
            (_anchorPos select 0) + (_pos select 0),
            (_anchorPos select 1) + (_pos select 1),
            (_anchorPos select 2) + (_pos select 2)
        ];
    } forEach _selected;
    _anchorPos = [
        (_anchorPos select 0) / (count _selected),
        (_anchorPos select 1) / (count _selected),
        (_anchorPos select 2) / (count _selected)
    ];
};

private _entities = [];
{
    private _snapshot = [_x, "Object", createHashMapFromArray [
        ["includeAttributes", _includeAttributes],
        ["includeConfig", true],
        ["includeModel", false]
    ]] call AMCP_fnc_buildEntitySnapshot;
    private _transform = _snapshot getOrDefault ["transform", createHashMap];
    private _pos = _transform getOrDefault ["positionATL", [0, 0, 0]];
    private _relative = [
        (_pos select 0) - (_anchorPos select 0),
        (_pos select 1) - (_anchorPos select 1),
        (_pos select 2) - (_anchorPos select 2)
    ];
    _entities pushBack createHashMapFromArray [
        ["clientRef", format ["captured_%1", _forEachIndex + 1]],
        ["type", "Object"],
        ["className", _snapshot getOrDefault ["className", ""]],
        ["transform", createHashMapFromArray [
            ["positionATL", _relative],
            ["dir", (_transform getOrDefault ["dir", 0])]
        ]],
        ["attributes", _snapshot getOrDefault ["attributes", createHashMap]]
    ];
} forEach _selected;

createHashMapFromArray [
    ["composition", createHashMapFromArray [
        ["schemaVersion", 1],
        ["name", _name],
        ["anchor", _anchorPos],
        ["entities", _entities],
        ["connections", []]
    ]]
]
