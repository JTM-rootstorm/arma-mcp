params [
    ["_entity", objNull],
    ["_attributes", createHashMap]
];

private _toEdenAttribute = {
    params ["_name"];
    switch (toLower _name) do {
        case "name": {"Name"};
        case "init": {"Init"};
        case "description": {"Description"};
        case "presence": {"Presence"};
        case "presencecondition": {"PresenceCondition"};
        default {_name};
    }
};

private _previous = createHashMap;
private _updated = [];
private _warnings = [];

{
    private _attributeName = _x;
    private _edenName = [_attributeName] call _toEdenAttribute;
    private _oldValue = _entity get3DENAttribute _edenName;
    if (_oldValue isEqualType [] && {_oldValue isNotEqualTo []}) then {
        _oldValue = _oldValue select 0;
    };
    _previous set [_attributeName, _oldValue];
    private _ok = _entity set3DENAttribute [_edenName, _attributes get _attributeName];
    if (_ok) then {
        _updated pushBack _attributeName;
    } else {
        _warnings pushBack format ["Failed to set attribute %1", _attributeName];
    };
} forEach (keys _attributes);

createHashMapFromArray [
    ["previous", _previous],
    ["updatedAttributes", _updated],
    ["warnings", _warnings]
]
