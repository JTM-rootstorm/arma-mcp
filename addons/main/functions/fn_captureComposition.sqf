params [
    ["_params", createHashMap]
];

private _name = _params getOrDefault ["name", "captured-selection"];
private _includeAttributes = _params getOrDefault ["includeAttributes", true];
private _includeConnections = _params getOrDefault ["includeConnections", false];
private _typePairs = [
    ["object", "Object"],
    ["group", "Group"],
    ["trigger", "Trigger"],
    ["logic", "Logic"],
    ["waypoint", "Waypoint"],
    ["marker", "Marker"],
    ["layer", "Layer"]
];
private _selectedEntries = [];
{
    private _edenSelectionType = _x select 0;
    private _entityType = _x select 1;
    {
        _selectedEntries pushBack [_x, _entityType];
    } forEach (get3DENSelected _edenSelectionType);
} forEach _typePairs;
private _anchorPos = [0, 0, 0];
private _positionCount = 0;

if (_selectedEntries isNotEqualTo []) then {
    {
        private _snapshot = [_x select 0, _x select 1, createHashMapFromArray [
            ["includeAttributes", false],
            ["includeConfig", false],
            ["includeModel", false]
        ]] call AMCP_fnc_buildEntitySnapshot;
        private _transform = _snapshot getOrDefault ["transform", createHashMap];
        private _pos = _transform getOrDefault ["positionATL", []];
        if ((count _pos) >= 3) then {
            _anchorPos = [
                (_anchorPos select 0) + (_pos select 0),
                (_anchorPos select 1) + (_pos select 1),
                (_anchorPos select 2) + (_pos select 2)
            ];
            _positionCount = _positionCount + 1;
        };
    } forEach _selectedEntries;
    if (_positionCount > 0) then {
        _anchorPos = [
            (_anchorPos select 0) / _positionCount,
            (_anchorPos select 1) / _positionCount,
            (_anchorPos select 2) / _positionCount
        ];
    };
};

private _entities = [];
private _edenToClientRef = createHashMap;
{
    private _entity = _x select 0;
    private _entityType = _x select 1;
    private _clientRef = format ["captured_%1", _forEachIndex + 1];
    private _snapshot = [_entity, _entityType, createHashMapFromArray [
        ["includeAttributes", _includeAttributes],
        ["includeConfig", true],
        ["includeModel", false]
    ]] call AMCP_fnc_buildEntitySnapshot;
    private _transform = _snapshot getOrDefault ["transform", createHashMap];
    private _pos = _transform getOrDefault ["positionATL", [0, 0, 0]];
    if ((count _pos) < 3) then {_pos = [0, 0, 0]};
    private _relative = [
        (_pos select 0) - (_anchorPos select 0),
        (_pos select 1) - (_anchorPos select 1),
        (_pos select 2) - (_anchorPos select 2)
    ];
    _edenToClientRef set [_snapshot getOrDefault ["edenId", ""], _clientRef];
    _entities pushBack createHashMapFromArray [
        ["clientRef", _clientRef],
        ["type", _entityType],
        ["className", _snapshot getOrDefault ["className", ""]],
        ["transform", createHashMapFromArray [
            ["positionATL", _relative],
            ["dir", (_transform getOrDefault ["dir", 0])]
        ]],
        ["attributes", _snapshot getOrDefault ["attributes", createHashMap]]
    ];
} forEach _selectedEntries;

private _connections = [];
if (_includeConnections) then {
    {
        if ((_x select 1) isNotEqualTo "Layer") then {
            private _sourceSnapshot = [_x select 0, _x select 1, createHashMapFromArray [["includeAttributes", false], ["includeConfig", false]]] call AMCP_fnc_buildEntitySnapshot;
            private _sourceId = _sourceSnapshot getOrDefault ["edenId", ""];
            private _sourceRef = _edenToClientRef getOrDefault [_sourceId, ""];
            if (_sourceRef isNotEqualTo "") then {
                {
                    private _type = _x param [0, ""];
                    private _target = _x param [1, objNull];
                    private _targetType = "Object";
                    if (_target isEqualType grpNull) then {_targetType = "Group"};
                    if (_target isEqualType []) then {_targetType = "Waypoint"};
                    if (_target isEqualType "") then {_targetType = "Marker"};
                    private _targetId = [_target, _targetType] call AMCP_fnc_registerEntity;
                    private _targetRef = _edenToClientRef getOrDefault [_targetId, ""];
                    if (_targetRef isNotEqualTo "") then {
                        _connections pushBack createHashMapFromArray [
                            ["type", _type],
                            ["from", _sourceRef],
                            ["to", _targetRef]
                        ];
                    };
                } forEach (get3DENConnections (_x select 0));
            };
        };
    } forEach _selectedEntries;
};

createHashMapFromArray [
    ["composition", createHashMapFromArray [
        ["schemaVersion", 1],
        ["name", _name],
        ["anchor", _anchorPos],
        ["entities", _entities],
        ["connections", _connections]
    ]]
]
