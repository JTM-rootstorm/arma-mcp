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
            private _positionAttribute = _entity get3DENAttribute "position";
            private _positionATL = _positionAttribute param [0, waypointPosition _entity];
            _previous = createHashMapFromArray [
                ["positionATL", _positionATL],
                ["positionASL", ATLToASL _positionATL]
            ];
        };
    };
};

if (_entity isEqualType "") then {
    private _markerMetadata = missionNamespace getVariable ["AMCP_markerMetadata", createHashMap];
    private _markerRecord = _markerMetadata getOrDefault [_entity, createHashMap];
    if ("positionATL" in _transform) then {
        _entity setMarkerPos (_transform get "positionATL");
        _entity set3DENAttribute ["position", _transform get "positionATL"];
        _markerRecord set ["positionATL", _transform get "positionATL"];
    };
    if ("dir" in _transform) then {
        _entity setMarkerDir (_transform get "dir");
        _entity set3DENAttribute ["rotation", [0, 0, _transform get "dir"]];
        _entity set3DENAttribute ["angle", _transform get "dir"];
        _markerRecord set ["angle", _transform get "dir"];
    };
    _markerMetadata set [_entity, _markerRecord];
    missionNamespace setVariable ["AMCP_markerMetadata", _markerMetadata];
} else {
    if (_entity isEqualType []) then {
        if ("positionATL" in _transform) then {
            _entity set3DENAttribute ["position", _transform get "positionATL"];
        };
    } else {
        if ("positionATL" in _transform) then {
            _entity set3DENAttribute ["position", _transform get "positionATL"];
        };
        if ("dir" in _transform) then {
            _entity set3DENAttribute ["rotation", [0, 0, _transform get "dir"]];
        };
    };
};
if (("vectorDir" in _transform) && {"vectorUp" in _transform}) then {
    if (_entity isEqualType objNull) then {
        _entity setVectorDirAndUp [_transform get "vectorDir", _transform get "vectorUp"];
    };
};
if (_transform getOrDefault ["alignToGround", false]) then {
    private _pos = _transform getOrDefault ["positionATL", _previous getOrDefault ["positionATL", [0, 0, 0]]];
    _pos set [2, 0];
    if (_entity isEqualType "") then {
        private _markerMetadata = missionNamespace getVariable ["AMCP_markerMetadata", createHashMap];
        private _markerRecord = _markerMetadata getOrDefault [_entity, createHashMap];
        _entity setMarkerPos _pos;
        _entity set3DENAttribute ["position", _pos];
        _markerRecord set ["positionATL", _pos];
        _markerMetadata set [_entity, _markerRecord];
        missionNamespace setVariable ["AMCP_markerMetadata", _markerMetadata];
    } else {
        if (_entity isEqualType []) then {
            _entity set3DENAttribute ["position", _pos];
        } else {
            _entity set3DENAttribute ["position", _pos];
        };
    };
};

_previous
