params [
    ["_params", createHashMap]
];

private _types = _params getOrDefault ["types", []];
private _includeAttributes = _params getOrDefault ["includeAttributes", false];
private _includeConfig = _params getOrDefault ["includeConfig", true];
private _includeModel = _params getOrDefault ["includeModel", false];
private _classFilter = toLower (_params getOrDefault ["classNameContains", ""]);
private _variableFilter = toLower (_params getOrDefault ["variableNameContains", ""]);
private _limit = _params getOrDefault ["limit", 200];
private _radius = _params getOrDefault ["radius", createHashMap];
private _hasRadius = (count _radius) > 0;
private _radiusCenter = _radius getOrDefault ["centerATL", [0, 0, 0]];
private _radiusMeters = _radius getOrDefault ["meters", 0];

private _all = all3DENEntities;
private _typeNames = ["Object", "Group", "Trigger", "Logic", "Waypoint", "Marker"];
private _entities = [];
private _truncated = false;
private _snapshotOptions = createHashMapFromArray [
    ["includeAttributes", _includeAttributes],
    ["includeConfig", _includeConfig],
    ["includeModel", _includeModel]
];

for "_index" from 0 to (((count _all) min (count _typeNames)) - 1) do {
    private _entityType = _typeNames param [_index, format ["Type%1", _index]];
    private _typeAllowed = (count _types) isEqualTo 0 || {_entityType in _types};
    if (_typeAllowed) then {
        {
            if ((count _entities) >= _limit) then {
                _truncated = true;
            } else {
                private _snapshotType = _entityType;
                if (_entityType isEqualTo "Logic" && {_x isEqualType objNull} && {_x isKindOf "Module_F"}) then {
                    _snapshotType = "Module";
                };
                private _snapshot = [_x, _snapshotType, _snapshotOptions] call AMCP_fnc_buildEntitySnapshot;
                private _className = toLower (_snapshot getOrDefault ["className", ""]);
                private _variableName = toLower (_snapshot getOrDefault ["variableName", ""]);
                private _passesClass = _classFilter isEqualTo "" || {(_className find _classFilter) >= 0};
                private _passesVariable = _variableFilter isEqualTo "" || {(_variableName find _variableFilter) >= 0};
                private _passesRadius = true;
                if (_hasRadius && {_radiusMeters > 0}) then {
                    private _transform = _snapshot getOrDefault ["transform", createHashMap];
                    private _positionATL = _transform getOrDefault ["positionATL", [0, 0, 0]];
                    _passesRadius = (_positionATL distance2D _radiusCenter) <= _radiusMeters;
                };
                if (_passesClass && {_passesVariable} && {_passesRadius}) then {
                    _entities pushBack _snapshot;
                };
            };
        } forEach (_all param [_index, []]);
    };
};

createHashMapFromArray [
    ["entities", _entities],
    ["truncated", _truncated]
]
