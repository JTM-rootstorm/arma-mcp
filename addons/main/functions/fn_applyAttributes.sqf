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
        case "markertype": {"markerType"};
        case "text": {"text"};
        case "color": {"color"};
        case "alpha": {"alpha"};
        case "size": {"size"};
        case "angle": {"angle"};
        case "brush": {"brush"};
        case "shape": {"shape"};
        case "sizea": {"sizeA"};
        case "sizeb": {"sizeB"};
        case "isrectangle": {"isRectangle"};
        case "activationby": {"activationBy"};
        case "activationtype": {"activationType"};
        case "onactivation": {"onActivation"};
        case "ondeactivation": {"onDeactivation"};
        case "completionradius": {"completionRadius"};
        case "combatmode": {"combatMode"};
        case "speedmode": {"speedMode"};
        default {_name};
    }
};

private _previous = createHashMap;
private _updated = [];
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

if (_entity isEqualType "") exitWith {
    private _markerMetadata = missionNamespace getVariable ["AMCP_markerMetadata", createHashMap];
    private _markerRecord = _markerMetadata getOrDefault [_entity, createHashMap];
    {
        private _attributeName = _x;
        private _value = _attributes get _attributeName;
        switch (toLower _attributeName) do {
            case "text": {
                _previous set [_attributeName, [_entity, "text", markerText _entity] call _firstAttributeValue];
                _entity setMarkerText _value;
                _entity set3DENAttribute ["text", _value];
                _markerRecord set ["text", _value];
                _updated pushBack _attributeName;
            };
            case "markertype": {
                _previous set [_attributeName, [_entity, "markerType", markerType _entity] call _firstAttributeValue];
                _entity setMarkerType _value;
                _entity set3DENAttribute ["markerType", _value];
                _markerRecord set ["markerType", _value];
                _updated pushBack _attributeName;
            };
            case "color": {
                _previous set [_attributeName, [_entity, "color", markerColor _entity] call _firstAttributeValue];
                _entity setMarkerColor _value;
                _entity set3DENAttribute ["color", _value];
                _markerRecord set ["color", _value];
                _updated pushBack _attributeName;
            };
            case "alpha": {
                _previous set [_attributeName, [_entity, "alpha", markerAlpha _entity] call _firstAttributeValue];
                _entity setMarkerAlpha _value;
                _entity set3DENAttribute ["alpha", _value];
                _markerRecord set ["alpha", _value];
                _updated pushBack _attributeName;
            };
            case "size": {
                private _size = if (_value isEqualType []) then {_value} else {[_value, _value]};
                _previous set [_attributeName, [_entity, "size", markerSize _entity] call _firstAttributeValue];
                _entity setMarkerSize _size;
                _entity set3DENAttribute ["size", _size];
                _markerRecord set ["size", _size];
                _updated pushBack _attributeName;
            };
            case "angle": {
                _previous set [_attributeName, [_entity, "angle", markerDir _entity] call _firstAttributeValue];
                _entity setMarkerDir _value;
                _entity set3DENAttribute ["angle", _value];
                _markerRecord set ["angle", _value];
                _updated pushBack _attributeName;
            };
            case "brush": {
                _previous set [_attributeName, [_entity, "brush", markerBrush _entity] call _firstAttributeValue];
                _entity setMarkerBrush _value;
                _entity set3DENAttribute ["brush", _value];
                _markerRecord set ["brush", _value];
                _updated pushBack _attributeName;
            };
            case "shape": {
                _previous set [_attributeName, [_entity, "shape", markerShape _entity] call _firstAttributeValue];
                _entity setMarkerShape _value;
                _entity set3DENAttribute ["shape", _value];
                _markerRecord set ["shape", _value];
                _updated pushBack _attributeName;
            };
            default {
                _warnings pushBack format ["Failed to set marker attribute %1", _attributeName];
            };
        };
    } forEach (keys _attributes);
    _markerMetadata set [_entity, _markerRecord];
    missionNamespace setVariable ["AMCP_markerMetadata", _markerMetadata];

    createHashMapFromArray [
        ["previous", _previous],
        ["updatedAttributes", _updated],
        ["warnings", _warnings]
    ]
};

if (_entity isEqualType objNull && {_entity isKindOf "EmptyDetector"}) then {
    private _area = triggerArea _entity;
    if ("sizeA" in _attributes || {"sizeB" in _attributes} || {"angle" in _attributes} || {"isRectangle" in _attributes}) then {
        _previous set ["sizeA", _area param [0, 0]];
        _previous set ["sizeB", _area param [1, 0]];
        _previous set ["angle", _area param [2, 0]];
        _previous set ["isRectangle", _area param [3, false]];
        private _sizeA = _attributes getOrDefault ["sizeA", _area param [0, 0]];
        private _sizeB = _attributes getOrDefault ["sizeB", _area param [1, 0]];
        private _angle = _attributes getOrDefault ["angle", _area param [2, 0]];
        private _isRectangle = _attributes getOrDefault ["isRectangle", _area param [3, false]];
        _entity setTriggerArea [_sizeA, _sizeB, _angle, _isRectangle];
        {
            if (_x in _attributes) then {_updated pushBack _x};
        } forEach ["sizeA", "sizeB", "angle", "isRectangle"];
    };
};

{
    private _attributeName = _x;
    if !(_entity isEqualType objNull && {_entity isKindOf "EmptyDetector"} && {_attributeName in ["sizeA", "sizeB", "angle", "isRectangle"]}) then {
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
    };
} forEach (keys _attributes);

createHashMapFromArray [
    ["previous", _previous],
    ["updatedAttributes", _updated],
    ["warnings", _warnings]
]
