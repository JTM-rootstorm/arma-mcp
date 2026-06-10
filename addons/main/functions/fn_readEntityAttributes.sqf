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
private _firstAttributeValue = {
    params ["_target", "_name", "_fallback"];
    private _value = _target get3DENAttribute _name;
    if (_value isEqualType [] && {_value isNotEqualTo []}) then {
        _value = _value select 0;
    };
    if (isNil "_value") exitWith {_fallback};
    if (_value isEqualType _fallback) exitWith {_value};
    _fallback
};

if (_entityType isEqualTo "Layer") exitWith {
    if (_entity isEqualType 0) then {
        _attributes set ["layerId", _entity];
    };
    createHashMapFromArray [
        ["attributes", _attributes],
        ["warnings", ["Layer attribute reads are limited to layerId in this synthetic-safe path."]]
    ]
};

if (_entityType isEqualTo "Marker" && {_entity isEqualType ""}) exitWith {
    private _markerRecord = (missionNamespace getVariable ["AMCP_markerMetadata", createHashMap]) getOrDefault [_entity, createHashMap];
    private _markerValue = {
        params ["_name", "_fallback"];
        private _missing = "__AMCP_MARKER_METADATA_MISSING__";
        private _value = _markerRecord getOrDefault [_name, _missing];
        if (_value isEqualTo _missing) exitWith {_fallback};
        if (_value isEqualType _fallback) exitWith {_value};
        _fallback
    };
    {
        switch (toLower _x) do {
            case "text": {_attributes set [_x, ["text", [_entity, "text", markerText _entity] call _firstAttributeValue] call _markerValue]};
            case "markertype": {_attributes set [_x, ["markerType", [_entity, "markerType", markerType _entity] call _firstAttributeValue] call _markerValue]};
            case "color": {_attributes set [_x, ["color", [_entity, "color", markerColor _entity] call _firstAttributeValue] call _markerValue]};
            case "alpha": {_attributes set [_x, ["alpha", [_entity, "alpha", markerAlpha _entity] call _firstAttributeValue] call _markerValue]};
            case "size": {_attributes set [_x, ["size", [_entity, "size", markerSize _entity] call _firstAttributeValue] call _markerValue]};
            case "angle": {_attributes set [_x, ["angle", [_entity, "angle", markerDir _entity] call _firstAttributeValue] call _markerValue]};
            case "brush": {_attributes set [_x, ["brush", [_entity, "brush", markerBrush _entity] call _firstAttributeValue] call _markerValue]};
            case "shape": {_attributes set [_x, ["shape", [_entity, "shape", markerShape _entity] call _firstAttributeValue] call _markerValue]};
            default {_warnings pushBack format ["Attribute %1 is unsupported for Marker", _x]};
        };
    } forEach _names;
    createHashMapFromArray [
        ["attributes", _attributes],
        ["warnings", _warnings]
    ]
};

if (_entityType isEqualTo "Trigger" && {_entity isEqualType objNull}) then {
    private _area = triggerArea _entity;
    {
        switch (toLower _x) do {
            case "sizea": {_attributes set [_x, _area param [0, 0]]};
            case "sizeb": {_attributes set [_x, _area param [1, 0]]};
            case "angle": {_attributes set [_x, _area param [2, 0]]};
            case "isrectangle": {_attributes set [_x, _area param [3, false]]};
        };
    } forEach _names;
};

{
    private _attributeName = _x;
    if !(_entityType isEqualTo "Trigger" && {_attributeName in ["sizeA", "sizeB", "angle", "isRectangle"]}) then {
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
    };
} forEach _names;

createHashMapFromArray [
    ["attributes", _attributes],
    ["warnings", _warnings]
]
