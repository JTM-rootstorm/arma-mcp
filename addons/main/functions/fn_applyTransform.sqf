params [
    ["_entity", objNull],
    ["_transform", createHashMap]
];

private _previous = createHashMap;
if (_entity isEqualType objNull) then {
    _previous = createHashMapFromArray [
        ["positionATL", getPosATL _entity],
        ["positionASL", getPosASL _entity],
        ["dir", getDir _entity],
        ["vectorDir", vectorDir _entity],
        ["vectorUp", vectorUp _entity]
    ];
} else {
    if (_entity isEqualType "") then {
        _previous = createHashMapFromArray [
            ["positionATL", markerPos _entity],
            ["positionASL", ATLToASL (markerPos _entity)],
            ["dir", markerDir _entity]
        ];
    } else {
        if (_entity isEqualType []) then {
            _previous = createHashMapFromArray [
                ["positionATL", waypointPosition _entity],
                ["positionASL", ATLToASL (waypointPosition _entity)]
            ];
        };
    };
};

if ("positionATL" in _transform) then {
    _entity set3DENAttribute ["position", _transform get "positionATL"];
};
if ("dir" in _transform) then {
    _entity set3DENAttribute ["rotation", [0, 0, _transform get "dir"]];
};
if (("vectorDir" in _transform) && {"vectorUp" in _transform}) then {
    if (_entity isEqualType objNull) then {
        _entity setVectorDirAndUp [_transform get "vectorDir", _transform get "vectorUp"];
    };
};
if (_transform getOrDefault ["alignToGround", false]) then {
    private _pos = _transform getOrDefault ["positionATL", _previous getOrDefault ["positionATL", [0, 0, 0]]];
    _pos set [2, 0];
    _entity set3DENAttribute ["position", _pos];
};

_previous
