params [
    ["_entity", objNull],
    ["_entityType", "Object", [""]],
    ["_attributeNames", [], [[]]]
];

private _defaultAttributes = switch (_entityType) do {
    case "Marker": {["text", "markerType", "color", "alpha", "size", "angle", "brush", "shape"]};
    case "Trigger": {["sizeA", "sizeB", "angle", "isRectangle", "activationBy", "activationType", "repeatable", "condition", "onActivation", "onDeactivation"]};
    case "Waypoint": {["type", "behavior", "combatMode", "speedMode", "formation", "condition", "onActivation", "timeout", "completionRadius"]};
    case "Layer": {["layerId"]};
    default {["name", "init", "description", "presence", "presenceCondition", "lock"]};
};

private _names = +_attributeNames;
if ((count _names) isEqualTo 0) then {
    _names = _defaultAttributes;
};

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

private _attributes = createHashMap;
private _warnings = [];

if (_entityType isEqualTo "Layer") exitWith {
    if (_entity isEqualType 0) then {
        _attributes set ["layerId", _entity];
    };
    createHashMapFromArray [
        ["attributes", _attributes],
        ["warnings", ["Layer attribute reads are limited to layerId in this synthetic-safe path."]]
    ]
};

{
    private _attributeName = _x;
    private _edenName = [_attributeName] call _toEdenAttribute;
    private _value = _entity get3DENAttribute _edenName;
    if (_value isEqualTo []) then {
        _warnings pushBack format ["Attribute %1 is unsupported or empty for %2", _attributeName, _entityType];
    } else {
        if (_value isEqualType [] && {_value isNotEqualTo []}) then {
            _attributes set [_attributeName, _value select 0];
        } else {
            _attributes set [_attributeName, _value];
        };
    };
} forEach _names;

createHashMapFromArray [
    ["attributes", _attributes],
    ["warnings", _warnings]
]
